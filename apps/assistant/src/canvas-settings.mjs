export const CANVAS_PERMISSIONS = Object.freeze([
  "read-only",
  "reviewed-edits",
]);
const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Messages from this validator contain no SDK errors or credential material. */
export class CanvasSettingsError extends Error {}

export function canvasSettings(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["provider", "model", "thinking", "permissions"].includes(key),
    ) ||
    typeof value.provider !== "string" ||
    !value.provider.trim() ||
    value.provider.length > 150 ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 300 ||
    !THINKING_LEVELS.includes(value.thinking) ||
    !CANVAS_PERMISSIONS.includes(value.permissions)
  )
    throw new CanvasSettingsError(
      "Choose a valid provider, model, thinking level and canvas permission mode",
    );
  return Object.freeze({
    provider: value.provider,
    model: value.model,
    thinking: value.thinking,
    permissions: value.permissions,
  });
}

export function canvasToolAllowed(name, permissions) {
  return (
    permissions !== "read-only" ||
    (name !== "prepare_edit" && name !== "capabilities")
  );
}
