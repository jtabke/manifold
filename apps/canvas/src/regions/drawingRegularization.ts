/** Conservative, dependency-free fitting of a single pen stroke to existing visual marks. */
import { MAX_STROKE_POINTS, type InkPoint, type Mark } from "./drawing.ts";

export const REGULARIZE_HOLD_MS = 650;
export const REGULARIZE_MOVE_PX = 3;

export function regularizeStroke(mark: Mark, zoom = 1): Mark | undefined {
  const points = mark.points;
  if (
    mark.kind !== "pen" ||
    points.length < 2 ||
    points.length > MAX_STROKE_POINTS ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  )
    return;
  let length = 0,
    left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
    if (i) length += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
  }
  const first = points[0],
    last = points[points.length - 1];
  const distance = Math.hypot(last.x - first.x, last.y - first.y);
  const result = (
    kind: Mark["kind"],
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): Mark | undefined => {
    if (
      [a.x, a.y, b.x, b.y].some(
        (n) => !Number.isFinite(n) || Math.abs(n) > 1_000_000,
      )
    )
      return;
    return {
      ...mark,
      kind,
      points: [
        { ...a, pressure: 0.5 },
        { ...b, pressure: 0.5 },
      ],
      start: null,
      end: null,
    };
  };
  if (distance * zoom >= 28 && length <= distance * 1.08) {
    const deviation = Math.max(2 / zoom, distance * 0.025);
    if (
      points.every(
        (p) =>
          Math.abs(
            (last.x - first.x) * (first.y - p.y) -
              (first.x - p.x) * (last.y - first.y),
          ) /
            distance <=
          deviation,
      )
    )
      return result("line", first, last);
  }
  const width = right - left,
    height = bottom - top,
    size = Math.min(width, height);
  if (size * zoom < 24 || distance > Math.max(4 / zoom, size * 0.12)) return;
  // Uniform arc-length samples prevent pauses/dense corners from dominating the fit.
  const samples: InkPoint[] = [first];
  let travelled = 0,
    next = length / 64;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      segment = Math.hypot(b.x - a.x, b.y - a.y);
    while (segment > 0 && next <= travelled + segment && samples.length < 64) {
      const t = (next - travelled) / segment;
      samples.push({
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
        pressure: 0.5,
      });
      next += length / 64;
    }
    travelled += segment;
  }
  const perimeter = 2 * (width + height),
    edgeTolerance = Math.max(4 / zoom, size * 0.04);
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  if (
    length >= perimeter * 0.9 &&
    length <= perimeter * 1.12 &&
    samples.every(
      (p) =>
        Math.min(p.x - left, right - p.x, p.y - top, bottom - p.y) <=
        edgeTolerance,
    ) &&
    corners.every((c) =>
      samples.some(
        (p) =>
          Math.hypot(c.x - p.x, c.y - p.y) <=
          Math.max(4 / zoom, Math.hypot(width, height) * 0.07),
      ),
    )
  )
    return result("rectangle", corners[0], corners[2]);
  if (Math.max(width, height) / size > 1.15) return;
  const cx = (left + right) / 2,
    cy = (top + bottom) / 2;
  const radius =
    samples.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) /
    samples.length;
  const errors = samples.map(
    (p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius) / radius,
  );
  const circumference = 2 * Math.PI * radius;
  if (
    length >= circumference * 0.9 &&
    length <= circumference * 1.12 &&
    Math.max(...errors) <= 0.13 &&
    Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length) <=
      0.055
  )
    return result(
      "ellipse",
      { x: cx - radius, y: cy - radius },
      { x: cx + radius, y: cy + radius },
    );
}
