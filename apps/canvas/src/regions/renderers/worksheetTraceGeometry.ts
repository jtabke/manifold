/** Presentation only. Geometry is measured in displayed CSS pixels relative to
 * the overlay, including at non-unit canvas zoom. */
import type { Point } from "../document";
import { frameBounds, touches, type CanvasRect } from "../selection";
import { crosses, pathData, routeConnection } from "../orthogonalRoute";
import { canvasObjectSelector } from "../app/useCanvasOverlaps";
import { radicalShape } from "./WorksheetRadical";

const bottom = (r: CanvasRect) => r.y + r.height;
const mid = (r: CanvasRect) => r.x + r.width / 2;
const pad = (r: CanvasRect, n: number) => ({
  x: r.x - n,
  y: r.y - n,
  width: r.width + 2 * n,
  height: r.height + 2 * n,
});
const maxEnds = 24;
type Side = -1 | 1; // above / below
const edge = (r: CanvasRect, side: Side) => (side < 0 ? r.y : bottom(r));
type Row = { line: Element; box: CanvasRect; block: CanvasRect };
type Branch = { occurrence: string; lead: string; path: string };
type Route = { to: string; trunk: string; branches: Branch[] };
export type TraceGeometry = { routes: Route[]; other: string[] };
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const clear = (a: Point, b: Point, boxes: readonly CanvasRect[]) =>
  !boxes.some((box) => crosses(a, b, box));
const cost = (points: Point[]) =>
  points.reduce((n, p, i) => {
    if (!i) return n;
    const a = points[i - 1],
      b = points[i - 2];
    return (
      n +
      Math.abs(a.x - p.x) +
      Math.abs(a.y - p.y) +
      (b && (a.x === p.x) !== (b.x === a.x) ? 18 : 0)
    );
  }, 0);

// All trunk segments have four pixels of obstacle clearance. A three-pixel
// corner stays inside that margin and leaves the proof for the ports intact.
function roundedTrunk(points: Point[]) {
  const first = points[0];
  let path = pathData([first]);
  const toward = (a: Point, b: Point, n: number) => ({
    x: a.x + Math.sign(b.x - a.x) * n,
    y: a.y + Math.sign(b.y - a.y) * n,
  });
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1],
      b = points[i],
      c = points[i + 1];
    if ((a.x === b.x) === (b.x === c.x)) {
      if ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0)
        path += ` L${b.x},${b.y}`;
      continue;
    }
    const radius = Math.min(
      3,
      Math.hypot(a.x - b.x, a.y - b.y) / 2,
      Math.hypot(c.x - b.x, c.y - b.y) / 2,
    );
    const before = toward(b, a, radius),
      after = toward(b, c, radius);
    path += ` L${before.x},${before.y} Q${b.x},${b.y} ${after.x},${after.y}`;
  }
  const last = points.at(-1)!;
  return path + ` L${last.x},${last.y}`;
}

/** A brief interruption behind a containing radical's top rule preserves the
 * notation. Never take this shortcut through another glyph or a fraction bar. */
function crossingBands(
  term: Element,
  row: Row,
  side: Side,
  x: number,
  rect: (e: Element) => CanvasRect,
  continuousRoots: boolean,
) {
  const bands: [number, number][] = [];
  for (
    let child = term, p = child.parentElement;
    p && p !== row.line;
    child = p, p = p.parentElement
  ) {
    if (p.localName === "mfrac" && (p.firstElementChild === child) === side > 0)
      return;
    if (
      (p.localName === "mover" && side < 0 && p.firstElementChild === child) ||
      (p.localName === "munder" && side > 0 && p.firstElementChild === child)
    )
      return;
    if (p.localName === "mroot" && side < 0) return;
    if (p.localName !== "msqrt" || side > 0) continue;
    const argument = p.firstElementChild;
    if (!argument) return;
    const root = p.getBoundingClientRect(),
      arg = argument.getBoundingClientRect();
    const shape = radicalShape(root, arg);
    const box = rect(p);
    if (!shape || x < box.x + shape.bar.x - root.left + 2) return;
    const band =
      continuousRoots && p.hasAttribute("data-radical-painted")
        ? [
            box.y + shape.bar.y - root.top - 1.4,
            box.y + shape.bar.y - root.top + shape.bar.height + 1.4,
          ]
        : [box.y - 1, box.y + arg.top - root.top];
    bands.push([band[0], band[1]]);
  }
  return bands.sort(([a], [b]) => a - b);
}

/** Try short paths in the gap between the rows before searching around boxes.
 * Keep the search bounded regardless of work on the rest of the canvas. */
function connect(
  start: Point,
  ends: Point[],
  blocks: CanvasRect[],
  area: CanvasRect,
  visible: (p: Point) => boolean,
) {
  const valid = (path: Point[]) =>
    path.every((p, i) => visible(p) && (!i || clear(path[i - 1], p, blocks)));
  const candidates = ends
    .flatMap((end) => {
      const y = (start.y + end.y) / 2;
      return [
        [start, { x: start.x, y }, { x: end.x, y }, end],
        [start, { x: start.x, y: end.y }, end],
        [start, { x: end.x, y: start.y }, end],
      ];
    })
    .map((pts) => pts.filter((p, i) => !i || !same(pts[i - 1], p)))
    .filter(valid);
  // The ports are vertical; include the turns into and out of them when
  // comparing equally short paths. Keep bends in the whitespace, not on the row.
  const withPorts = (path: Point[]) =>
    cost(path) +
    (path.length < 2
      ? 0
      : (path[0].y === path[1].y ? 19 : 0) +
        (path.at(-2)!.y === path.at(-1)!.y ? 19 : 0));
  if (candidates.length)
    return candidates.sort((a, b) => withPorts(a) - withPorts(b))[0];
  const nearby = blocks.filter((r) => touches(area, r));
  if (nearby.length > 24) return;
  return ends
    .flatMap((end) => {
      const path = routeConnection(start, end, nearby, 0);
      return path && valid(path) ? [path] : [];
    })
    .sort((a, b) => cost(a) - cost(b))[0];
}

export function traceGeometry(
  root: HTMLElement,
  layer: SVGSVGElement,
  source: { id: string },
  consumers: readonly string[],
): TraceGeometry {
  const origin = layer.getBoundingClientRect();
  const rect = (el: Element): CanvasRect => {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - origin.left,
      y: r.top - origin.top,
      width: r.width,
      height: r.height,
    };
  };
  const view = rect(root),
    inView = (r: CanvasRect) => r.width > 0 && r.height > 0 && touches(r, view),
    visible = (p: Point) =>
      p.x >= view.x + 2 &&
      p.x <= view.x + view.width - 2 &&
      p.y >= view.y + 2 &&
      p.y <= bottom(view) - 2;
  const rows = new Map<string, Row>(),
    blocks: CanvasRect[] = [];
  const add = (r: CanvasRect) => {
    const block = pad(r, 4);
    if (inView(r)) blocks.push(block);
    return block;
  };
  for (const host of root.querySelectorAll(canvasObjectSelector)) {
    if (
      host.hasAttribute("data-canvas-offscreen") ||
      !host.getClientRects().length
    )
      continue;
    const id = host.getAttribute("data-region-id");
    if (!id) {
      add(rect(host));
      continue;
    }
    const line = host.querySelector(":scope > .er-math-line");
    if (line) {
      const box = frameBounds([
        rect(line),
        ...Array.from(
          line.querySelectorAll(":scope > *, :scope > math > mrow"),
          rect,
        ),
      ])!;
      if (inView(box)) rows.set(id, { line, box, block: add(box) });
    }
    for (const part of host.querySelectorAll(
      '.er-note,.er-data,.er-external-reference,.er-source-caption,.er-record-feedback,.er-region-error,.er-region-error-details,textarea,[role="toolbar"]',
    ))
      add(rect(part));
  }
  const tray = root.querySelector(".er-trace-tray");
  if (tray) add(rect(tray));
  const routes: Route[] = [],
    other = new Set<string>();
  const from = rows.get(source.id),
    anchor = from?.line.querySelector("[data-trace-origin]");
  const continuousRoots = matchMedia("(forced-colors: none)").matches;
  // Only the final vertical approach enters each row. Test all its ink, including
  // non-ancestor compound notation whose rules aren't exposed as DOM leaves.
  const port = (term: Element, row: Row, side: Side) => {
    const body = rect(term);
    const base =
      side < 0 ? term.querySelector(":scope > msub > :first-child") : null;
    const target = base ? rect(base) : body;
    const x = mid(target),
      tip = { x, y: edge(target, side) + side * 2 },
      outside = { x, y: edge(row.box, side) + side * 7 };
    if (
      !inView(body) ||
      !visible(tip) ||
      !visible(outside) ||
      (tip.y - outside.y) * side >= 0 ||
      !clear(
        tip,
        outside,
        blocks.filter((b) => b !== row.block),
      )
    )
      return;
    const ink = Array.from(
      row.line.querySelectorAll(
        "mi,mn,mo,mtext,mfrac,msqrt,mroot,:scope > :not(math)",
      ),
    )
      .filter((el) => !term.contains(el) && !el.contains(term))
      .map((el) => pad(rect(el), 1.8));
    if (!clear(tip, outside, ink)) return;
    const bands = crossingBands(term, row, side, x, rect, continuousRoots);
    if (!bands) return;
    let last = outside.y,
      lead = "";
    // Only top entry has bands. Merge touching gaps for nested radicals.
    for (const [a, b] of bands) {
      if (a >= tip.y || b <= outside.y) continue;
      if (a > last)
        lead +=
          pathData([
            { x, y: last },
            { x, y: a },
          ]) + " ";
      last = Math.max(last, b);
    }
    if (
      Math.abs(tip.y - last) < (bands.length ? 3.5 : 1) ||
      (tip.y - last) * side >= 0
    )
      return;
    return { tip, outside, lead, path: pathData([{ x, y: last }, tip]) };
  };
  if (!from || !anchor)
    return { routes, other: [...new Set([source.id, ...consumers])] };
  const exits = ([-1, 1] as const).map((side) => ({
    side,
    port: port(anchor, from, side),
  }));
  if (!exits.some((e) => e.port))
    return { routes, other: [...new Set([source.id, ...consumers])] };
  let count = 0;
  for (const to of consumers) {
    const row = rows.get(to);
    if (!row || count >= maxEnds) {
      other.add(to);
      continue;
    }
    const terms = [
      ...row.line.querySelectorAll(
        `[data-trace-use="${CSS.escape(source.id)}"]`,
      ),
    ];
    const branches: Branch[] = [],
      trunks: string[] = [],
      routed = new Set<Element>();
    const preferred: Side =
      rect(anchor).y + rect(anchor).height / 2 < row.box.y + row.box.height / 2
        ? -1
        : 1;
    for (const side of [preferred, -preferred] as Side[]) {
      const slots = terms
        .filter((t) => !routed.has(t))
        .flatMap((term) => {
          const target = port(term, row, side);
          return target ? [{ term, ...target }] : [];
        })
        .slice(0, maxEnds - count)
        .sort((a, b) => a.tip.x - b.tip.x);
      if (!slots.length) continue;
      const left = slots[0].outside,
        right = slots.at(-1)!.outside;
      if (!clear(left, right, blocks)) continue;
      const paths = exits
        .flatMap((exit) => {
          if (!exit.port) return [];
          const { tip, outside } = exit.port;
          const junction = {
            x: Math.min(Math.max(outside.x, left.x), right.x),
            y: left.y,
          };
          const ends = [junction, left, right].filter(
            (p, i, all) => all.findIndex((q) => same(p, q)) === i,
          );
          const link = connect(
            outside,
            ends,
            blocks,
            pad(frameBounds([from.box, row.box])!, 48),
            visible,
          );
          return link
            ? [
                {
                  points: [tip, ...link],
                  rank: cost(link) + (exit.side === -preferred ? 0 : 18),
                },
              ]
            : [];
        })
        .sort((a, b) => a.rank - b.rank);
      if (!paths.length) continue;
      const trunk =
        roundedTrunk(paths[0].points) +
        (left.x === right.x ? "" : " " + pathData([left, right]));
      trunks.push(trunk);
      for (const slot of slots) {
        routed.add(slot.term);
        branches.push({
          occurrence: slot.term.getAttribute("data-source-start")!,
          lead: slot.lead,
          path: slot.path,
        });
      }
      count += slots.length;
    }
    if (routed.size !== terms.length || !terms.length) other.add(to);
    if (branches.length) routes.push({ to, trunk: trunks.join(" "), branches });
  }
  return { routes, other: [...other] };
}
