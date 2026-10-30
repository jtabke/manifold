import type { CanvasFrame } from "./selection.ts";
import type { Point } from "./document.ts";

/** Content footprints, not the wide transparent hit areas of worksheet rows. */
export function framesAtPoint(frames: readonly CanvasFrame[], point: Point) {
  return frames.filter(
    (f) =>
      point.x >= f.x &&
      point.x <= f.x + f.width &&
      point.y >= f.y &&
      point.y <= f.y + f.height,
  );
}

export function overlapPoint(
  frame: CanvasFrame,
  others: readonly CanvasFrame[],
): Point {
  for (const other of others) {
    if (other.id === frame.id) continue;
    const left = Math.max(frame.x, other.x),
      top = Math.max(frame.y, other.y),
      right = Math.min(frame.x + frame.width, other.x + other.width),
      bottom = Math.min(frame.y + frame.height, other.y + other.height);
    if (right > left && bottom > top)
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

export function nextOverlap(ids: readonly string[], selected?: string) {
  return ids.length > 1
    ? ids[(Math.max(0, ids.indexOf(selected || "")) + 1) % ids.length]
    : undefined;
}
