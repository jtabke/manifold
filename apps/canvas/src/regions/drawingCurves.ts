/** Shared path geometry for rendering, bounds and bounded subpixel hit testing. */
import type { Point } from "./document.ts";

export const MAX_SPLINE_POINTS = 128;
export const MAX_ARC_RADIUS = 1_000_000;
export const isCurve = (kind: unknown) =>
  kind === "curve" || kind === "spline" || kind === "arc";
export const isThreePointPath = (kind: unknown) =>
  kind === "curve" || kind === "arc";
export const isVertexPath = (kind: unknown) =>
  kind === "polyline" || kind === "polygon";
export const isPointPath = (kind: unknown) =>
  isCurve(kind) || isVertexPath(kind);
export type Cubic = readonly [Point, Point, Point, Point];
const fullTurn = 2 * Math.PI;
const turn = (angle: number) => (angle + fullTurn) % fullTurn;

/** Solve in start-relative, chord-normalized coordinates. The signed turn
 * chooses the sweep through the middle point, including major arcs. */
export function circularArc(points: readonly Point[]) {
  if (points.length !== 3) return;
  const [a, b, c] = points;
  const scale = Math.max(
    Math.hypot(b.x - a.x, b.y - a.y),
    Math.hypot(c.x - a.x, c.y - a.y),
    Math.hypot(c.x - b.x, c.y - b.y),
  );
  if (!scale || !Number.isFinite(scale)) return;
  const bx = (b.x - a.x) / scale,
    by = (b.y - a.y) / scale;
  const cx = (c.x - a.x) / scale,
    cy = (c.y - a.y) / scale;
  const cross = bx * cy - by * cx;
  if (Math.abs(cross) <= 1e-9) return;
  const bb = bx * bx + by * by,
    cc = cx * cx + cy * cy;
  const x = ((bb * cy - cc * by) / (2 * cross)) * scale;
  const y = ((bx * cc - cx * bb) / (2 * cross)) * scale;
  const radius = Math.hypot(x, y);
  if (!(radius > 0 && radius <= MAX_ARC_RADIUS)) return;
  const start = Math.atan2(-y, -x);
  const end = Math.atan2(c.y - a.y - y, c.x - a.x - x);
  const sweep = cross > 0 ? turn(end - start) : -turn(start - end);
  if (!sweep) return;
  return { center: { x: a.x + x, y: a.y + y }, radius, start, sweep };
}
type Arc = NonNullable<ReturnType<typeof circularArc>>;
const onArc = ({ center, radius }: Arc, θ: number): Point => ({
  x: center.x + radius * Math.cos(θ),
  y: center.y + radius * Math.sin(θ),
});

/** Curves are quadratic Béziers; splines interpolate their knots with Catmull–Rom tangents. */
export function curveSegments(kind: string, points: readonly Point[]): Cubic[] {
  if (points.length < 2 || kind === "arc") return [];
  if (kind === "curve" && points.length === 3) {
    const [a, c, b] = points;
    return [
      [
        a,
        { x: a.x + ((c.x - a.x) * 2) / 3, y: a.y + ((c.y - a.y) * 2) / 3 },
        { x: b.x + ((c.x - b.x) * 2) / 3, y: b.y + ((c.y - b.y) * 2) / 3 },
        b,
      ],
    ];
  }
  return points.slice(1).map((b, i) => {
    const a = points[i],
      before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 2)];
    return [
      a,
      { x: a.x + (b.x - before.x) / 6, y: a.y + (b.y - before.y) / 6 },
      { x: b.x - (after.x - a.x) / 6, y: b.y - (after.y - a.y) / 6 },
      b,
    ];
  });
}
export function curvePath(kind: string, points: readonly Point[]) {
  if (!points.length) return "";
  if (kind === "arc") {
    const arc = circularArc(points);
    if (!arc)
      return points.map(({ x, y }, i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
    const [a, , b] = points;
    return `M${a.x},${a.y} A${arc.radius},${arc.radius} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 1 : 0} ${b.x},${b.y}`;
  }
  return (
    `M${points[0].x},${points[0].y}` +
    curveSegments(kind, points)
      .map(([, a, b, end]) => ` C${a.x},${a.y} ${b.x},${b.y} ${end.x},${end.y}`)
      .join("")
  );
}
const middle = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
/** Convex hull flatness bounds deviation to 0.25 canvas units; depth limits hostile coordinates. */
export function flattenCurve(kind: string, points: readonly Point[]): Point[] {
  if (kind === "arc") {
    const arc = circularArc(points);
    if (!arc) return [...points];
    // A chord's sagitta is 2 r sin²(Δθ/4). Bound it by the shared 0.25 tolerance.
    const step = Math.min(
      Math.PI / 2,
      4 * Math.asin(Math.sqrt(Math.min(1, 0.125 / arc.radius))),
    );
    const n = Math.ceil(Math.abs(arc.sweep) / step);
    return [
      points[0],
      ...Array.from({ length: n - 1 }, (_, i) =>
        onArc(arc, arc.start + (arc.sweep * (i + 1)) / n),
      ),
      points[2],
    ];
  }
  const result: Point[] = points.length ? [points[0]] : [];
  const split = ([a, b, c, d]: Cubic, depth: number) => {
    const dx = d.x - a.x,
      dy = d.y - a.y,
      length2 = dx * dx + dy * dy;
    const distance = (p: Point) => {
      const t = length2
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2),
          )
        : 0;
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    if (depth === 12 || Math.max(distance(b), distance(c)) <= 0.25) {
      result.push(d);
      return;
    }
    const ab = middle(a, b),
      bc = middle(b, c),
      cd = middle(c, d),
      abc = middle(ab, bc),
      bcd = middle(bc, cd),
      center = middle(abc, bcd);
    split([a, ab, abc, center], depth + 1);
    split([center, bcd, cd, d], depth + 1);
  };
  for (const segment of curveSegments(kind, points)) split(segment, 0);
  return result;
}
/** Include spline overshoot or exact arc extrema for broad-phase selection/culling. */
export function curveHull(kind: string, points: readonly Point[]) {
  if (kind === "arc") {
    const arc = circularArc(points);
    if (!arc) return [...points];
    return [
      ...points,
      ...[0, Math.PI / 2, Math.PI, -Math.PI / 2]
        .filter(
          (angle) =>
            turn(Math.sign(arc.sweep) * (angle - arc.start)) <=
            Math.abs(arc.sweep),
        )
        .map((angle) => onArc(arc, angle)),
    ];
  }
  return [
    ...points,
    ...curveSegments(kind, points).flatMap((segment) => [...segment]),
  ];
}
