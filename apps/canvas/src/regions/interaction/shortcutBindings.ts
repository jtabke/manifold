/** Personal canvas bindings. Editor keys and gestures are intentionally outside this contract. */
export const shortcutActions = [
  { id: "search.open", label: "Search objects and commands", keys: ["Mod+K"] },
  { id: "canvas.fit", label: "Fit page", keys: ["Shift+1"] },
  { id: "canvas.undo", label: "Undo", keys: ["Mod+Z"] },
  { id: "canvas.redo", label: "Redo", keys: ["Mod+Shift+Z", "Mod+Y"] },
  { id: "help.shortcuts", label: "Keyboard shortcuts", keys: [] },
] as const;
export type ShortcutAction = (typeof shortcutActions)[number]["id"];
export type ShortcutBindings = Readonly<
  Record<ShortcutAction, readonly string[]>
>;
export const SHORTCUT_STORAGE = "manifold.keyboard-bindings.v1";
export const MAX_SHORTCUT_CONFIG_BYTES = 65536;
export const defaultBindings: ShortcutBindings = Object.freeze(
  Object.fromEntries(
    shortcutActions.map((a) => [a.id, Object.freeze([...a.keys])]),
  ),
) as ShortcutBindings;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, expected: string[]) {
  if (
    Object.keys(value).some((key) => !expected.includes(key)) ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw Error(`Expected only: ${expected.join(", ")}.`);
}
const shortcutKey = /^(?:[A-Z0-9]|F[1289])$/;
const functionKey = /^F[1289]$/;
const aliases: Record<string, string> = {
  mod: "Mod",
  ctrl: "Ctrl",
  control: "Ctrl",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};
/** Canonical spelling is used by capture, JSON, validation and actual dispatch. */
export function normalizeShortcut(value: string): string {
  if (value.length > 60) throw Error("Shortcut is too long.");
  const parts = value.split("+").map((p) => p.trim());
  if (parts.some((p) => !p))
    throw Error("Use a key such as Mod+K or F1, not an empty combination.");
  const key = parts.pop()!.toUpperCase();
  if (!shortcutKey.test(key))
    throw Error(
      "Editing/accessibility keys are fixed. Use a letter/digit with Mod, Ctrl or Meta, or F1/F2/F8/F9.",
    );
  const modifiers = parts.map((p) => {
    if (!Object.hasOwn(aliases, p.toLowerCase()))
      throw Error("Unknown modifier. Use Mod, Ctrl, Meta, Alt or Shift.");
    return aliases[p.toLowerCase()];
  });
  if (new Set(modifiers).size !== modifiers.length)
    throw Error("Repeated modifier. Use Mod, Ctrl, Meta, Alt or Shift.");
  if (modifiers.filter((m) => ["Mod", "Ctrl", "Meta"].includes(m)).length > 1)
    throw Error("Use just one of Mod, Ctrl or Meta.");
  const primary = modifiers.some((m) => ["Mod", "Ctrl", "Meta"].includes(m));
  const isFit =
    key === "1" && modifiers.length === 1 && modifiers[0] === "Shift";
  if (!primary && !isFit && !functionKey.test(key))
    throw Error(
      "Plain typing and Alt-only shortcuts are protected. Add Mod, Ctrl or Meta.",
    );
  if (!primary && modifiers.includes("Alt"))
    throw Error(
      "Alt function-key shortcuts are reserved for the operating system.",
    );
  if (
    primary &&
    ["0", "D", "L", "T", "W", "N", "R", "P", "O", "Q"].includes(key)
  )
    throw Error(
      "That browser/window shortcut is protected, including with extra modifiers.",
    );
  if (primary && !modifiers.includes("Alt")) {
    if (
      /^[0-9]$/.test(key) ||
      [
        "A",
        "B",
        "C",
        "E",
        "F",
        "G",
        "H",
        "I",
        "J",
        "S",
        "U",
        "V",
        "X",
      ].includes(key)
    )
      throw Error(
        "That combination is reserved for the browser, navigation or drawing controls. Try adding Alt.",
      );
  }
  if (primary && modifiers.includes("Alt") && ["I", "J"].includes(key))
    throw Error("That combination is reserved for browser developer tools.");
  return [
    ...["Mod", "Ctrl", "Meta", "Alt", "Shift"].filter((m) =>
      modifiers.includes(m),
    ),
    key,
  ].join("+");
}
const signatures = (combo: string) =>
  combo.includes("Mod+")
    ? [combo.replace("Mod+", "Ctrl+"), combo.replace("Mod+", "Meta+")]
    : [combo];

export function parseShortcutConfiguration(text: string): ShortcutBindings {
  if (new TextEncoder().encode(text).byteLength > MAX_SHORTCUT_CONFIG_BYTES)
    throw Error("Shortcut configuration must be at most 64 KiB.");
  const data: unknown = JSON.parse(text);
  if (!object(data)) throw Error("Configuration must be a JSON object.");
  fields(data, ["version", "bindings"]);
  if (
    data.version !== 1 ||
    !Array.isArray(data.bindings) ||
    data.bindings.length > shortcutActions.length
  )
    throw Error("Expected version 1 and at most five canvas binding records.");
  const next: Record<ShortcutAction, readonly string[]> = {
    ...defaultBindings,
  };
  const seen = new Set<string>();
  for (const row of data.bindings) {
    if (!object(row)) throw Error("Each binding must be an object.");
    fields(row, ["action", "context", "keys"]);
    const action = shortcutActions.find((a) => a.id === row.action);
    if (!action) throw Error(`Unknown shortcut action: ${String(row.action)}.`);
    if (row.context !== "canvas")
      throw Error(
        "Only the canvas context is customizable; editor keys and gestures stay fixed.",
      );
    if (seen.has(action.id)) throw Error(`Repeated binding for ${action.id}.`);
    seen.add(action.id);
    if (
      !Array.isArray(row.keys) ||
      row.keys.length > 3 ||
      row.keys.some((key) => typeof key !== "string")
    )
      throw Error(
        "Keys must be an array of at most three shortcut strings; [] means unassigned.",
      );
    const keys = (row.keys as string[]).map(normalizeShortcut);
    if (new Set(keys).size !== keys.length)
      throw Error(`Repeated shortcut for ${action.label}.`);
    next[action.id] = keys;
  }
  const owners = new Map<string, ShortcutAction>();
  for (const action of shortcutActions)
    for (const key of next[action.id])
      for (const signature of signatures(key)) {
        const previous = owners.get(signature);
        if (previous && previous !== action.id)
          throw Error(
            `${key} conflicts with ${shortcutActions.find((a) => a.id === previous)!.label} in the canvas context.`,
          );
        owners.set(signature, action.id);
      }
  return Object.freeze(
    Object.fromEntries(
      shortcutActions.map((a) => [a.id, Object.freeze(next[a.id])]),
    ),
  ) as ShortcutBindings;
}
export function shortcutConfiguration(bindings: ShortcutBindings): string {
  return JSON.stringify(
    {
      version: 1,
      bindings: shortcutActions.map((a) => ({
        action: a.id,
        context: "canvas",
        keys: [...bindings[a.id]],
      })),
    },
    null,
    2,
  );
}
export function shortcutLabel(keys: readonly string[]) {
  return keys.length
    ? keys
        .map((key) =>
          key
            .split("+")
            .map((part) => (part === "Mod" ? "⌘ / Ctrl" : part))
            .join(" + "),
        )
        .join(" / ")
    : "Unassigned";
}
export type ShortcutKey = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "isComposing"
  | "keyCode"
  | "getModifierState"
>;
/** Unmodified text, composition and AltGraph never become configurable actions. */
export function shortcutFromEvent(
  event: ShortcutKey,
  portable = true,
): string | undefined {
  if (
    event.isComposing ||
    ["Dead", "Process", "Unidentified"].includes(event.key) ||
    event.keyCode === 229 ||
    event.getModifierState?.("AltGraph") ||
    (event.ctrlKey && event.metaKey)
  )
    return;
  let key = event.key.toUpperCase();
  if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(-1);
  // Option and non-Latin layouts can produce a glyph for a modified letter.
  // ASCII punctuation remains logical (e.g. Dvorak Ctrl+; must never become Undo).
  if (
    (event.ctrlKey || event.metaKey) &&
    /[^\x00-\x7f]/.test(event.key) &&
    !/^[A-Z]$/.test(key) &&
    /^Key[A-Z]$/.test(event.code)
  )
    key = event.code.slice(3);
  if (!shortcutKey.test(key)) return;
  const primary = event.ctrlKey
    ? portable
      ? "Mod"
      : "Ctrl"
    : event.metaKey
      ? portable
        ? "Mod"
        : "Meta"
      : undefined;
  if (!primary && !(event.shiftKey && key === "1") && !functionKey.test(key))
    return;
  return [
    primary,
    event.altKey ? "Alt" : undefined,
    event.shiftKey ? "Shift" : undefined,
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function resolveShortcut(
  event: ShortcutKey,
  bindings: ShortcutBindings,
): ShortcutAction | undefined {
  const key = shortcutFromEvent(event, false);
  if (!key) return;
  return shortcutActions.find((a) =>
    bindings[a.id].some((combo) => signatures(combo).includes(key)),
  )?.id;
}
