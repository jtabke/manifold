/** Shared Bézier geometry for rendering and bounded, subpixel hit testing. */
import type { Point } from "./document.ts";

export const MAX_SPLINE_POINTS = 128;
export const isCurve = (kind: unknown) => kind === "curve" || kind === "spline";
export type Cubic = readonly [Point, Point, Point, Point];

/** Curves are quadratic Béziers; splines interpolate their knots with Catmull–Rom tangents. */
export function curveSegments(kind: string, points: readonly Point[]): Cubic[] {
  if (points.length < 2) return [];
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
/** Control hull includes spline overshoot and is safe for broad-phase selection/culling. */
export function curveHull(kind: string, points: readonly Point[]) {
  return [
    ...points,
    ...curveSegments(kind, points).flatMap((segment) => [...segment]),
  ];
}
