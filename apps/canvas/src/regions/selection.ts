import type { Point } from "./document.ts";
import { REGION_STEP } from "./pageLayout.ts";
export type CanvasFrame = Point & {
  id: string;
  width: number;
  height: number;
  kind: "region" | "plot";
};
export type CanvasRect = Point & { width: number; height: number };
export function selectionRect(a: Point, b: Point): CanvasRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
export function touches(a: CanvasRect, b: CanvasRect) {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}
export function frameBounds<T extends CanvasRect>(
  frames: readonly T[],
): CanvasRect | undefined {
  if (!frames.length) return;
  const x = Math.min(...frames.map((f) => f.x)),
    y = Math.min(...frames.map((f) => f.y));
  return {
    x,
    y,
    width: Math.max(...frames.map((f) => f.x + f.width)) - x,
    height: Math.max(...frames.map((f) => f.y + f.height)) - y,
  };
}
/** Presentation only: a readable calculation stack with plots beside it when they fit. */
export function organizeFrames(
  frames: CanvasFrame[],
  availableWidth: number,
): Record<string, Point> {
  const bounds = frameBounds(frames);
  if (!bounds) return {};
  const ordered = [...frames].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
  );
  const regions = ordered.filter((f) => f.kind === "region"),
    plots = ordered.filter((f) => f.kind === "plot");
  const regionWidth = Math.max(500, ...regions.map((f) => f.width)),
    plotWidth = Math.max(0, ...plots.map((f) => f.width));
  const sideBySide =
    regions.length && regionWidth + 64 + plotWidth <= availableWidth;
  const result: Record<string, Point> = {};
  let y = bounds.y;
  for (const f of regions) {
    result[f.id] = { x: bounds.x, y };
    y += Math.max(REGION_STEP, f.height + 16);
  }
  let plotY = sideBySide ? bounds.y : y + (regions.length ? 16 : 0);
  for (const f of plots) {
    result[f.id] = {
      x: sideBySide ? bounds.x + regionWidth + 64 : bounds.x,
      y: plotY,
    };
    plotY += f.height + 32;
  }
  return result;
}
