/** Geometry is derived from immutable entries; visual references never imply computation. */
import * as f from "@manifold/foundation";
import type { Point } from "./document.ts";
import { frameBounds } from "./selection.ts";
import { withAreaMembers } from "./drawingScale.ts";
import type {
  Anchor,
  DrawingEntry,
  DrawingEdit,
  InkPoint,
  Mark,
} from "./drawing.ts";
export type Bounds = Point & { width: number; height: number };
export function pointBounds(
  points: Iterable<Point>,
  offset: Point = { x: 0, y: 0 },
): Bounds {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  return {
    x: left + offset.x,
    y: top + offset.y,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}
export function inside(p: Point, polygon: readonly Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}
const unit = (value: number) => Math.max(0, Math.min(1, value));
function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = unit(
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
  );
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const x = b.x - a.x,
    y = b.y - a.y,
    u = d.x - c.x,
    v = d.y - c.y;
  const denominator = x * v - y * u;
  if (denominator) {
    const t = ((c.x - a.x) * v - (c.y - a.y) * u) / denominator;
    const s = ((c.x - a.x) * y - (c.y - a.y) * x) / denominator;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0;
  }
  return Math.min(
    distance(a, c, d),
    distance(b, c, d),
    distance(c, a, b),
    distance(d, a, b),
  );
}
/** Slab clipping rejects diagonal near-misses without sampling along long sweeps. */
function crossesBounds(a: Point, b: Point, box: Bounds, margin: number) {
  let enter = 0,
    exit = 1;
  for (const [axis, size] of [
    ["x", "width"],
    ["y", "height"],
  ] as const) {
    const start = a[axis],
      delta = b[axis] - start;
    const low = box[axis] - margin,
      high = box[axis] + box[size] + margin;
    if (!delta) {
      if (start < low || start > high) return false;
    } else {
      const t = (low - start) / delta,
        u = (high - start) / delta;
      enter = Math.max(enter, Math.min(t, u));
      exit = Math.min(exit, Math.max(t, u));
      if (enter > exit) return false;
    }
  }
  return true;
}
type PositionedMark = { mark: Mark; view: Point };
export type MarkGeometry = { points: InkPoint[]; bounds: Bounds };
type CachedGeometry = MarkGeometry | { points: undefined; bounds: Bounds };
const scenes = new WeakMap<readonly DrawingEntry[], DrawingGeometry>();
// Bounds-only entries upgrade to full geometry without changing bounds identity.
// Non-connector geometry survives unrelated edits and selection previews.
const fixed = new WeakMap<PositionedMark, CachedGeometry>();
/** Match bounds of translated points exactly, without allocating/freeze-walking those points. */
function translatedBounds(points: readonly Point[], offset: Point): Bounds {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    const x = p.x + offset.x,
      y = p.y + offset.y;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  // pointBounds applies its default zero offset, which also normalizes negative zero.
  return {
    x: left + 0,
    y: top + 0,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}
export function drawingGeometry(entries: readonly DrawingEntry[]) {
  let scene = scenes.get(entries);
  if (!scene) {
    scene = new DrawingGeometry(entries);
    scenes.set(entries, scene);
  }
  return scene;
}
class DrawingGeometry {
  readonly byId: ReadonlyMap<string, DrawingEntry>;
  readonly entries: readonly DrawingEntry[];
  private cache = new WeakMap<PositionedMark, CachedGeometry>();
  constructor(entries: readonly DrawingEntry[]) {
    this.entries = entries;
    this.byId = new Map(entries.map((e) => [e.id, e]));
  }
  geometry(e: PositionedMark): MarkGeometry {
    const cache = e.mark.kind === "connector" ? this.cache : fixed;
    let result = cache.get(e);
    if (!result || !result.points) {
      const bounds = result?.bounds;
      const points = e.mark.points.map((p, i) => {
        const anchor =
          e.mark.kind === "connector"
            ? i === 0
              ? e.mark.start
              : e.mark.end
            : null;
        const target = anchor && this.byId.get(anchor.target.item);
        if (!anchor || !target)
          return { ...p, x: p.x + e.view.x, y: p.y + e.view.y };
        const b = this.bounds(target);
        return {
          x: b.x + anchor.u * b.width,
          y: b.y + anchor.v * b.height,
          pressure: 0.5,
        };
      });
      result = { points, bounds: bounds ?? pointBounds(points) };
      f.freeze(result);
      cache.set(e, result);
    }
    return result;
  }
  points(e: PositionedMark) {
    return this.geometry(e).points;
  }
  /** Preserve visible endpoints when detaching all anchors, or only removed targets. */
  detachedMark(e: PositionedMark, removed?: ReadonlySet<string>): Mark {
    const keep = (a: Anchor | null) =>
      a && removed && !removed.has(a.target.item) ? a : null;
    return {
      ...e.mark,
      points: this.points(e).map((p) => ({
        ...p,
        x: p.x - e.view.x,
        y: p.y - e.view.y,
      })),
      start: keep(e.mark.start),
      end: keep(e.mark.end),
    };
  }
  bounds(e: PositionedMark) {
    if (e.mark.kind === "connector") return this.geometry(e).bounds;
    let result = fixed.get(e);
    if (!result) {
      result = {
        points: undefined,
        bounds: f.freeze(translatedBounds(e.mark.points, e.view)),
      };
      fixed.set(e, result);
    }
    return result.bounds;
  }
  hit(e: DrawingEntry, p: Point, tolerance: number) {
    return this.sweptHit(e, p, p, tolerance);
  }
  sweptHit(e: DrawingEntry, from: Point, to: Point, tolerance: number) {
    const b = this.bounds(e),
      margin = tolerance + e.mark.width / 2;
    if (!crossesBounds(from, to, b, margin)) return false;
    if (e.mark.kind === "area") {
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.width, y: b.y },
        { x: b.x + b.width, y: b.y + b.height },
        { x: b.x, y: b.y + b.height },
      ];
      return corners.some(
        (a, i) => segmentDistance(from, to, a, corners[(i + 1) % 4]) <= margin,
      );
    }
    if (["rectangle", "text"].includes(e.mark.kind)) return true;
    if (e.mark.kind === "ellipse") {
      const normalize = (p: Point) => ({
        x: (p.x - b.x - b.width / 2) / (b.width / 2 + margin),
        y: (p.y - b.y - b.height / 2) / (b.height / 2 + margin),
      });
      return distance({ x: 0, y: 0 }, normalize(from), normalize(to)) <= 1;
    }
    const points = this.points(e),
      stationary = from.x === to.x && from.y === to.y;
    return points.some(
      (a, i) =>
        (stationary
          ? distance(from, a, points[i + 1] || a)
          : segmentDistance(from, to, a, points[i + 1] || a)) <= margin,
    );
  }
  pick(p: Point, tolerance: number, shapesOnly = false) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (
        (!shapesOnly || ["rectangle", "ellipse"].includes(e.mark.kind)) &&
        this.hit(e, p, tolerance)
      )
        return e;
    }
  }
  anchor(p: Point, document: string, tolerance: number): Anchor | null {
    const e = this.pick(p, tolerance, true);
    if (!e) return null;
    const b = this.bounds(e),
      u = unit((p.x - b.x) / b.width),
      v = unit((p.y - b.y) / b.height);
    const target = f.reference(document, e.id);
    if (e.mark.kind === "ellipse") {
      const angle = Math.atan2((v - 0.5) * 2, (u - 0.5) * 2);
      return {
        target,
        u: 0.5 + Math.cos(angle) / 2,
        v: 0.5 + Math.sin(angle) / 2,
      };
    }
    const edge = [u, 1 - u, v, 1 - v].indexOf(Math.min(u, 1 - u, v, 1 - v));
    return {
      target,
      u: edge === 0 ? 0 : edge === 1 ? 1 : u,
      v: edge === 2 ? 0 : edge === 3 ? 1 : v,
    };
  }
  private selected(ids: ReadonlySet<string>) {
    return [...withAreaMembers(this.entries, ids)].flatMap((id) => {
      const e = this.byId.get(id);
      return e ? [e] : [];
    });
  }
  selectionBounds(ids: ReadonlySet<string>) {
    return frameBounds(this.selected(ids).map((e) => this.bounds(e)));
  }
  transform(ids: ReadonlySet<string>, start: Point, resize: boolean) {
    ids = withAreaMembers(this.entries, ids);
    const bounds = this.selectionBounds(ids);
    // Resolve detached connectors and the selection once, not once per pointer sample.
    const selected = this.selected(ids).map((entry) => {
      const m = entry.mark;
      const detach =
        m.kind === "connector" &&
        (m.start || m.end) &&
        ![m.start, m.end].some((a) => a && ids.has(a.target.item));
      return { entry, mark: detach ? this.detachedMark(entry) : m };
    });
    return (end: Point): DrawingEdit[] =>
      selected.map(({ entry, mark }) => {
        const dx = end.x - start.x,
          dy = end.y - start.y;
        let at = { x: entry.view.x + dx, y: entry.view.y + dy };
        if (resize && bounds) {
          const sx = Math.max(8, bounds.width + dx) / bounds.width,
            sy = Math.max(8, bounds.height + dy) / bounds.height;
          at = {
            x: bounds.x + (entry.view.x - bounds.x) * sx,
            y: bounds.y + (entry.view.y - bounds.y) * sy,
          };
          mark = {
            ...mark,
            points: mark.points.map((p) => ({
              ...p,
              x: p.x * sx,
              y: p.y * sy,
            })),
          };
        }
        return { entry, at, ...(mark !== entry.mark ? { mark } : {}) };
      });
  }
}
export function previewDrawings(
  entries: readonly DrawingEntry[],
  edits: readonly DrawingEdit[],
) {
  const changed = new Map(edits.map((e) => [e.entry.id, e]));
  return entries.map((entry) => {
    const edit = changed.get(entry.id);
    return edit
      ? {
          ...entry,
          mark: edit.mark ?? entry.mark,
          view: { ...entry.view, ...edit.at },
        }
      : entry;
  });
}
export function constrain(
  start: InkPoint,
  end: InkPoint,
  kind: string,
): InkPoint {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (["line", "arrow"].includes(kind)) {
    const angle =
        (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
      length = Math.hypot(dx, dy);
    return {
      ...end,
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };
  }
  if (["rectangle", "ellipse"].includes(kind)) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      ...end,
      x: start.x + Math.sign(dx || 1) * size,
      y: start.y + Math.sign(dy || 1) * size,
    };
  }
  return end;
}
