import type { Page, Point } from "./document.ts";
export const REGION_STEP = 72;
/** Room for a normal math line or the authored note’s wrapped lines, plus breathing space. */
export function regionAdvance(text: string, height = 0) {
  return Math.max(REGION_STEP, text.split("\n").length * 29 + 24, height + 16);
}
/** Find space for a new authored line, leaving every occupied rectangle untouched. */
export function freeRegionPosition(
  at: Point,
  height: number,
  occupied: readonly (Point & { width: number; height: number })[],
): Point {
  let y = at.y;
  for (const box of [...occupied].sort((a, b) => a.y - b.y))
    if (
      at.x < box.x + box.width &&
      at.x + 500 > box.x &&
      y < box.y + box.height + 16 &&
      y + height > box.y
    )
      y = box.y + box.height + 16;
  return { x: at.x, y };
}
export function positions(
  page: Page,
  heights: Readonly<Record<string, number>> = {},
): Record<string, Point> {
  let y = page.origin.y;
  const out: Record<string, Point> = {};
  for (const r of page.regions) {
    if (page.layout[r.id]) out[r.id] = page.layout[r.id];
    else {
      out[r.id] = { x: page.origin.x, y };
    }
    // Moving one region leaves the other authored lines in their flow slots.
    y += regionAdvance(
      r.text,
      Object.hasOwn(heights, r.id) ? heights[r.id] : 0,
    );
  }
  for (const plot of page.plots)
    out[plot.id] = plot.at || {
      x: (out[plot.output]?.x || page.origin.x) + 555,
      y: out[plot.output]?.y || page.origin.y,
    };
  for (const relation of page.dataRelations || [])
    out[relation.id] = page.layout[relation.id] || { x: 650, y: 420 };
  return out;
}
