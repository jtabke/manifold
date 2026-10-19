import type { CanvasRect } from "./selection.ts";
export type AlignmentGuide = {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
};
/** A presentation-only translation. Tolerance is supplied in world coordinates. */
export function alignSelection(
  moving: CanvasRect,
  others: CanvasRect[],
  tolerance: number,
) {
  let dx = 0,
    dy = 0;
  const guides: AlignmentGuide[] = [];
  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height",
      cross = axis === "x" ? "y" : "x",
      crossSize = axis === "x" ? "height" : "width";
    let best: { delta: number; at: number; other: CanvasRect } | undefined;
    for (const other of others) {
      // Nearby content supplies useful alignment, not unrelated objects far away.
      if (
        moving[cross] > other[cross] + other[crossSize] + 500 ||
        other[cross] > moving[cross] + moving[crossSize] + 500
      )
        continue;
      for (const offset of [0, 0.5, 1]) {
        const at = other[axis] + other[size] * offset;
        const delta = at - (moving[axis] + moving[size] * offset);
        if (
          Math.abs(delta) <= tolerance &&
          (!best || Math.abs(delta) < Math.abs(best.delta))
        )
          best = { delta, at, other };
      }
    }
    if (!best) continue;
    if (axis === "x") dx = best.delta;
    else dy = best.delta;
    guides.push({
      axis,
      at: best.at,
      from: Math.min(moving[cross], best.other[cross]) - 12,
      to:
        Math.max(
          moving[cross] + moving[crossSize],
          best.other[cross] + best.other[crossSize],
        ) + 12,
    });
  }
  return { dx, dy, guides };
}
