import { drawingShortcutActions } from "./shortcutBindings.ts";

export type WheelTool = (typeof drawingShortcutActions)[number]["tool"];
export const DRAWING_WHEEL_STORAGE = "manifold.drawing-wheel.v1";
export const wheelPositions = [
  ["↑", "Top", "select"],
  ["↗", "Top right", "pen"],
  ["→", "Right", "line"],
  ["↘", "Bottom right", "arc"],
  ["↓", "Bottom", "rectangle"],
  ["↙", "Bottom left", "ellipse"],
  ["←", "Left", "text"],
  ["↖", "Top left", "eraser"],
] as const satisfies readonly (readonly [string, string, WheelTool])[];
export const defaultWheel: readonly WheelTool[] = wheelPositions.map(
  ([, , tool]) => tool,
);

export function loadDrawingWheel(): readonly WheelTool[] {
  try {
    const raw = localStorage.getItem(DRAWING_WHEEL_STORAGE);
    if (!raw) return defaultWheel;
    const slots: unknown = JSON.parse(raw);
    if (
      Array.isArray(slots) &&
      slots.length === wheelPositions.length &&
      new Set(slots).size === slots.length &&
      slots.every((slot) =>
        drawingShortcutActions.some(({ tool }) => tool === slot),
      )
    )
      return slots;
  } catch {
    // Unavailable or damaged personal preferences do not disable drawing.
  }
  return defaultWheel;
}

export function assignWheelTool(
  slots: readonly WheelTool[],
  index: number,
  tool: WheelTool,
): WheelTool[] {
  const next = [...slots];
  const existing = next.indexOf(tool);
  if (existing >= 0) next[existing] = next[index];
  next[index] = tool;
  return next;
}
