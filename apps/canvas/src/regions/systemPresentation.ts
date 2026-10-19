/** Small presentation-only tools for the system experiment; never an evaluation graph. */
import type { Page, Point } from "./document.ts";
import { modelParent } from "./models.ts";
import { systemArchitecture } from "./systemExploration.ts";
export type ModelRect = Point & { id: string; width: number; height: number };
const crosses = (a: Point, b: Point, r: ModelRect) =>
  a.x === b.x
    ? a.x > r.x &&
      a.x < r.x + r.width &&
      Math.max(a.y, b.y) > r.y &&
      Math.min(a.y, b.y) < r.y + r.height
    : a.y > r.y &&
      a.y < r.y + r.height &&
      Math.max(a.x, b.x) > r.x &&
      Math.min(a.x, b.x) < r.x + r.width;
/** Orthogonal visibility search with a bend cost. No fallback wires through objects. */
export function routeConnection(
  start: Point,
  end: Point,
  obstacles: ModelRect[],
): Point[] | undefined {
  const boxes = obstacles.map((r) => ({
    ...r,
    x: r.x - 12,
    y: r.y - 12,
    width: r.width + 24,
    height: r.height + 24,
  }));
  const xs = [
    ...new Set([start.x, end.x, ...boxes.flatMap((r) => [r.x, r.x + r.width])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([
      start.y,
      end.y,
      ...boxes.flatMap((r) => [r.y, r.y + r.height]),
    ]),
  ].sort((a, b) => a - b);
  const nodes = xs.flatMap((x) => ys.map((y) => ({ x, y }))),
    usable = nodes.map(
      (p) =>
        !boxes.some(
          (r) =>
            p.x > r.x &&
            p.x < r.x + r.width &&
            p.y > r.y &&
            p.y < r.y + r.height,
        ),
    );
  const first = nodes.findIndex((p) => p.x === start.x && p.y === start.y),
    last = nodes.findIndex((p) => p.x === end.x && p.y === end.y);
  if (!usable[first] || !usable[last]) return;
  const neighbors = nodes.map((a, i) =>
    usable[i]
      ? [i - 1, i + 1, i - ys.length, i + ys.length].filter(
          (j) =>
            j >= 0 &&
            j < nodes.length &&
            usable[j] &&
            (a.x === nodes[j].x || a.y === nodes[j].y) &&
            !boxes.some((r) => crosses(a, nodes[j], r)),
        )
      : [],
  );
  const cost = new Map<string, number>([[`${first}:0`, 0]]),
    previous = new Map<string, string>();
  const pending = [
    { node: first, axis: 0, key: `${first}:0`, cost: 0, priority: 0 },
  ];
  let finish: string | undefined;
  while (pending.length) {
    pending.sort((a, b) => b.priority - a.priority);
    const at = pending.pop()!;
    if (at.cost !== cost.get(at.key)) continue;
    if (at.node === last) {
      finish = at.key;
      break;
    }
    for (const next of neighbors[at.node]) {
      const a = nodes[at.node],
        b = nodes[next],
        axis = a.x === b.x ? 1 : 2,
        key = `${next}:${axis}`;
      const value =
        at.cost +
        Math.abs(a.x - b.x) +
        Math.abs(a.y - b.y) +
        (at.axis && at.axis !== axis ? 24 : 0);
      if (value >= (cost.get(key) ?? Infinity)) continue;
      cost.set(key, value);
      previous.set(key, at.key);
      pending.push({
        node: next,
        axis,
        key,
        cost: value,
        priority: value + Math.abs(b.x - end.x) + Math.abs(b.y - end.y),
      });
    }
  }
  if (!finish) return;
  const path: Point[] = [];
  for (let key: string | undefined = finish; key; key = previous.get(key))
    path.unshift(nodes[Number(key.split(":")[0])]);
  return path.filter(
    (p, i) =>
      i === 0 ||
      i === path.length - 1 ||
      !(
        (path[i - 1].x === p.x && p.x === path[i + 1].x) ||
        (path[i - 1].y === p.y && p.y === path[i + 1].y)
      ),
  );
}
export const pathData = (points: Point[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
export function routeLabel(
  points: Point[],
  obstacles: ModelRect[] = [],
  width = 90,
  rows = 1,
): Point | undefined {
  const segments = points
    .slice(1)
    .map((b, i) => ({ a: points[i], b }))
    .filter(({ a, b }) => a.y === b.y)
    .sort((s, t) => Math.abs(t.b.x - t.a.x) - Math.abs(s.b.x - s.a.x));
  for (const { a, b } of segments)
    for (const fraction of [0.5, 0.33, 0.67])
      for (const dy of [-10 - (rows - 1) * 14, 10]) {
        const at = { x: a.x + (b.x - a.x) * fraction, y: a.y + dy },
          box = {
            x: at.x - width / 2,
            y: at.y - 12,
            width,
            height: rows * 14 + 5,
          };
        if (
          !obstacles.some(
            (r) =>
              box.x < r.x + r.width &&
              box.x + box.width > r.x &&
              box.y < r.y + r.height &&
              box.y + box.height > r.y,
          )
        )
          return at;
      }
}
/** Keep mutually dependent model interfaces together; the quantity evaluator remains acyclic. */
export function arrangeSystem(page: Page) {
  const models = (page.models || []).filter((m) => !modelParent(page, m.id)),
    ids = models.map((m) => m.id);
  const edges = systemArchitecture(page).filter(
    (e) => ids.includes(e.from) && ids.includes(e.to),
  );
  const reachable = (from: string, to: string) => {
    const seen = new Set([from]),
      q = [from];
    while (q.length) {
      const id = q.shift()!;
      if (id === to) return true;
      for (const e of edges)
        if (e.from === id && !seen.has(e.to)) {
          seen.add(e.to);
          q.push(e.to);
        }
    }
    return false;
  };
  const groups: string[][] = [];
  for (const id of ids)
    if (!groups.some((g) => g.includes(id)))
      groups.push(
        ids.filter((other) => reachable(id, other) && reachable(other, id)),
      );
  const coupled = groups.filter((g) => g.length > 1),
    positions: Record<string, Point> = {},
    occupied = new Set<string>();
  const put = (id: string, want: Point) => {
    const cells = Array.from(
      { length: Math.max(24, ids.length * 2) },
      (_, i) => ({
        x: 25 + (i % 4) * 360,
        y: 180 + Math.floor(i / 4) * 370,
      }),
    );
    const at = cells
      .filter((p) => !occupied.has(`${p.x},${p.y}`))
      .sort(
        (a, b) =>
          Math.abs(a.x - want.x) * 1.3 +
          Math.abs(a.y - want.y) -
          (Math.abs(b.x - want.x) * 1.3 + Math.abs(b.y - want.y)),
      )[0];
    positions[id] = at;
    occupied.add(`${at.x},${at.y}`);
  };
  for (const group of coupled)
    group.forEach((id, i) => put(id, { x: 25 + i * 360, y: 180 }));
  const remaining = ids.filter((id) => !positions[id]),
    deferred = remaining.filter((id) => !edges.some((e) => e.to === id));
  const pending = remaining.filter((id) => !deferred.includes(id));
  for (let round = 0; pending.length && round < ids.length + 1; round++)
    for (const id of [...pending]) {
      const sources = [
        ...new Set(edges.filter((e) => e.to === id).map((e) => e.from)),
      ];
      if (sources.some((s) => !positions[s] && !deferred.includes(s))) continue;
      const placed = sources.filter((s) => positions[s]),
        sameCluster = coupled.some(
          (g) => placed.length > 0 && placed.every((s) => g.includes(s)),
        );
      put(id, {
        x: placed.length
          ? Math.max(...placed.map((s) => positions[s].x)) +
            (sameCluster ? 0 : 360)
          : 25,
        y: 180,
      });
      pending.splice(pending.indexOf(id), 1);
    }
  for (const id of [...pending, ...deferred]) {
    const target = edges.find((e) => e.from === id && positions[e.to]);
    put(
      id,
      target
        ? { x: positions[target.to].x, y: positions[target.to].y + 370 }
        : { x: 25, y: 180 },
    );
  }
  return { positions, coupled };
}

/** Only the explicit Arrange action uses this spacing pass. Opening a disclosure
 * never moves a neighbor or changes the engineer's saved free-canvas positions. */
export function spaceArrangedModels(
  positions: Record<string, Point>,
  sizes: Record<string, { width: number; height: number }>,
): Record<string, Point> {
  const result: Record<string, Point> = {};
  const rows = [...new Set(Object.values(positions).map((at) => at.y))].sort(
    (a, b) => a - b,
  );
  let bottom = 90;
  for (const row of rows) {
    const y = Math.max(row, bottom + 90);
    let right = -55;
    for (const [id, at] of Object.entries(positions)
      .filter(([, at]) => at.y === row)
      .sort(([, a], [, b]) => a.x - b.x)) {
      const x = Math.max(at.x, right + 80);
      result[id] = { x, y };
      right = x + (sizes[id]?.width || 280);
    }
    bottom = Math.max(
      ...Object.entries(result)
        .filter(([, at]) => at.y === y)
        .map(([id, at]) => at.y + (sizes[id]?.height || 180)),
    );
  }
  return result;
}

/** Place a temporary view in nearby free space. Existing object positions are untouched. */
export function placeInvestigation(
  anchor: ModelRect,
  others: ModelRect[],
  size: { width: number; height: number },
): Point {
  const gap = 36;
  const candidates: Point[] = [
    { x: anchor.x + anchor.width + gap, y: anchor.y },
    { x: anchor.x - size.width - gap, y: anchor.y },
    { x: anchor.x, y: anchor.y + anchor.height + gap },
    { x: anchor.x, y: anchor.y - size.height - gap },
    ...others.flatMap((r) => [
      { x: r.x + r.width + gap, y: anchor.y },
      { x: anchor.x, y: r.y + r.height + gap },
    ]),
  ];
  const free = candidates.filter(
    (at) =>
      at.x >= 20 &&
      at.y >= 170 &&
      !others.some(
        (r) =>
          at.x < r.x + r.width + 16 &&
          at.x + size.width + 16 > r.x &&
          at.y < r.y + r.height + 16 &&
          at.y + size.height + 16 > r.y,
      ),
  );
  return (
    free.find((at) => candidates.indexOf(at) < 4) ||
    free.sort(
      (a, b) =>
        Math.hypot(a.x - anchor.x, a.y - anchor.y) -
        Math.hypot(b.x - anchor.x, b.y - anchor.y),
    )[0] || {
      x:
        Math.max(...others.map((r) => r.x + r.width), anchor.x + anchor.width) +
        gap,
      y: Math.max(170, anchor.y),
    }
  );
}
