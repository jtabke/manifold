/** Drafting annotations use relative world coordinates; they never change physical geometry. */
import * as f from "@manifold/foundation";
import type { Point } from "./document.ts";
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
