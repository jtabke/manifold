/** Drafting annotations use relative world coordinates; they never change physical geometry. */
import * as f from "@manifold/foundation";
import type { Point } from "./document.ts";
import type { drawingGeometry } from "./drawingGeometry.ts";
import { circularArc } from "./drawingCurves.ts";

export const MAX_ANGLE_DIMENSIONS = 8;
export const isStraightDrawing = (kind: unknown) =>
  kind === "line" || kind === "arrow";
export type RadialDimension = "radius" | "diameter";

/** A circular arc or true circle, not an estimated radius for an ellipse. */
export function radialGeometry(kind: string, points: readonly Point[]) {
  if (kind === "arc") {
    const arc = circularArc(points);
    return (
      arc && {
        center: arc.center,
        radius: arc.radius,
        direction: arc.start + arc.sweep / 2,
      }
    );
  }
  if (kind !== "ellipse" || points.length !== 2) return;
  const [a, b] = points;
  const width = Math.abs(b.x - a.x),
    height = Math.abs(b.y - a.y);
  if (
    Math.min(width, height) < 1 ||
    Math.abs(width - height) > 1e-9 * Math.max(width, height)
  )
    return;
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    radius: width / 2,
    direction: -Math.PI / 4,
  };
}

/** Select the nearest pair of endpoints. They must meet within one canvas
 * unit (not one screen pixel); the directions are away from that joint. */
export function joinedAngle(a: readonly Point[], b: readonly Point[]) {
  if (a.length !== 2 || b.length !== 2) return;
  let first = 0,
    second = 0,
    nearest = Infinity;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      const gap = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
      if (gap < nearest) {
        nearest = gap;
        first = i;
        second = j;
      }
    }
  const p = a[first],
    q = b[second],
    endA = a[1 - first],
    endB = b[1 - second];
  const x = endA.x - p.x,
    y = endA.y - p.y,
    u = endB.x - q.x,
    v = endB.y - q.y;
  const reach = Math.min(Math.hypot(x, y), Math.hypot(u, v));
  if (nearest > 1 || reach <= 1e-6) return;
  const sweep = Math.atan2(x * v - y * u, x * u + y * v);
  if (Math.abs(sweep) < 1e-6) return;
  return {
    vertex: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
    start: Math.atan2(y, x),
    sweep,
    reach,
    degrees: (Math.abs(sweep) * 180) / Math.PI,
  };
}
export function selectedAngle(
  geometry: ReturnType<typeof drawingGeometry>,
  selection: ReadonlySet<string>,
) {
  if (selection.size !== 2) return;
  const [first, second] = [...selection].map((id) => geometry.byId.get(id));
  if (
    !first ||
    !second ||
    !isStraightDrawing(first.mark.kind) ||
    !isStraightDrawing(second.mark.kind)
  )
    return;
  const reversed = second.mark.angleDimensions?.some(
    (ref) => ref.item === first.id,
  );
  const [a, b] = reversed ? [second, first] : [first, second];
  return {
    a,
    b,
    pinned: !!a.mark.angleDimensions?.some((ref) => ref.item === b.id),
    angle: joinedAngle(geometry.points(a), geometry.points(b)),
  };
}
export type DimensionAxis = "length" | "width" | "height";
export type DimensionPlacement = { offset: number; label?: number };
export type DimensionPlacements = Partial<
  Record<DimensionAxis, DimensionPlacement>
>;
export function dimensionAxes(kind: string): DimensionAxis[] {
  return ["rectangle", "ellipse"].includes(kind)
    ? ["width", "height"]
    : ["line", "arrow"].includes(kind)
      ? ["length"]
      : [];
}
export function validateDimensionPlacements(value: f.Json, kind: string) {
  f.assert(f.object(value), "Invalid dimension placement");
  const axes = dimensionAxes(kind);
  f.assert(
    Object.keys(value).length > 0 &&
      Object.keys(value).every((key) => axes.includes(key as DimensionAxis)),
    "Invalid dimension axis",
  );
  for (const p of Object.values(value)) {
    f.assert(f.object(p), "Invalid dimension placement");
    f.fields(p, ["offset", "label"]);
    const finite = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e6;
    f.assert(
      finite(p.offset) && (p.label === undefined || finite(p.label)),
      "Dimension placement must be finite and within the canvas bounds",
    );
  }
}
export function dimensionLineLayout(
  a: Point,
  b: Point,
  zoom: number,
  label: string,
  placement?: DimensionPlacement,
  vertical = false,
) {
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  let tangent = span
    ? { x: (b.x - a.x) / span, y: (b.y - a.y) / span }
    : vertical
      ? { x: 0, y: -1 }
      : { x: 1, y: 0 };
  if (tangent.x < -1e-10 || (Math.abs(tangent.x) <= 1e-10 && tangent.y > 0))
    tangent = { x: -tangent.x, y: -tangent.y };
  const normal = { x: -tangent.y, y: tangent.x };
  const first = (b.x - a.x) * tangent.x + (b.y - a.y) * tangent.y < 0 ? b : a;
  const offset = placement?.offset ?? 28 / zoom;
  const side = offset < 0 ? -1 : 1;
  const shifted = (p: Point, distance: number) => ({
    x: p.x + normal.x * distance,
    y: p.y + normal.y * distance,
  });
  const outside = span * zoom < label.length * 7 + 24;
  const halfLabel = (label.length * 3.5) / zoom;
  const labelX =
    placement?.label !== undefined
      ? span / 2 + placement.label
      : outside
        ? span + 14 / zoom + halfLabel
        : span / 2;
  return {
    span,
    tangent,
    normal,
    offset,
    origin: shifted(first, offset),
    angle: (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI,
    extensions: [a, b].map((p) => ({
      from: shifted(p, side * Math.min(4 / zoom, Math.abs(offset) / 2)),
      to: shifted(p, offset + (side * 6) / zoom),
    })),
    outside,
    arrow: 6 / zoom,
    halfArrow: 2.5 / zoom,
    start: Math.min(
      outside ? -10 / zoom : 0,
      labelX < 0 ? labelX - halfLabel - 8 / zoom : 0,
    ),
    end: Math.max(
      outside ? span + 10 / zoom : span,
      labelX > span ? labelX + halfLabel + 8 / zoom : span,
    ),
    label: { x: labelX, y: -6 / zoom, anchor: "middle" as const },
  };
}
