import assert from "node:assert/strict";
import {
  defaultBindings,
  normalizeShortcut,
  parseShortcutConfiguration,
  resolveShortcut,
  shortcutConfiguration,
  shortcutFromEvent,
  shortcutActions,
} from "../src/regions/interaction/shortcutBindings.ts";
import { shortcutReference } from "../src/regions/interaction/keyboardShortcuts.ts";
const config = (bindings = []) => JSON.stringify({ version: 1, bindings });
const row = (action, keys, context = "canvas") => ({ action, context, keys });
assert.deepEqual(parseShortcutConfiguration(config()), defaultBindings);
assert.deepEqual(
  parseShortcutConfiguration(shortcutConfiguration(defaultBindings)),
  defaultBindings,
);
assert.equal(normalizeShortcut(" control + alt + k "), "Ctrl+Alt+K");
const remapped = parseShortcutConfiguration(
  config([
    row("search.open", ["Mod+Shift+K"]),
    row("help.shortcuts", ["F1"]),
    row("canvas.undo", []),
  ]),
);
assert.deepEqual(remapped["canvas.undo"], []);
assert.deepEqual(remapped["canvas.redo"], defaultBindings["canvas.redo"]);
assert.ok(
  Object.isFrozen(remapped) && Object.isFrozen(remapped["search.open"]),
);
assert.throws(() => remapped["search.open"].push("F2"));
assert.throws(
  () => remapped["canvas.redo"].push("F2"),
  "omitted/default bindings are equally immutable",
);
assert.deepEqual(defaultBindings["canvas.redo"], ["Mod+Shift+Z", "Mod+Y"]);
const event = (key, flags = {}) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  keyCode: 0,
  getModifierState: () => false,
  ...flags,
});
for (const modifier of ["ctrlKey", "metaKey"]) {
  assert.equal(
    resolveShortcut(event("k", { [modifier]: true }), defaultBindings),
    "search.open",
  );
  assert.equal(
    resolveShortcut(event("z", { [modifier]: true }), defaultBindings),
    "canvas.undo",
  );
  assert.equal(
    resolveShortcut(
      event("z", { [modifier]: true, shiftKey: true }),
      defaultBindings,
    ),
    "canvas.redo",
  );
  assert.equal(
    resolveShortcut(event("y", { [modifier]: true }), defaultBindings),
    "canvas.redo",
  );
  assert.equal(
    resolveShortcut(event("k", { [modifier]: true }), remapped),
    undefined,
  );
  assert.equal(
    resolveShortcut(event("k", { [modifier]: true, shiftKey: true }), remapped),
    "search.open",
  );
}
assert.equal(
  resolveShortcut(
    event("!", { code: "Digit1", shiftKey: true }),
    defaultBindings,
  ),
  "canvas.fit",
);
assert.equal(
  resolveShortcut(event("F1", { code: "F1" }), remapped),
  "help.shortcuts",
);
assert.equal(
  resolveShortcut(event("z", { ctrlKey: true }), remapped),
  undefined,
);
for (const flags of [
  { isComposing: true },
  { keyCode: 229 },
  { getModifierState: () => true },
  { metaKey: true },
  { altKey: true },
])
  assert.equal(
    resolveShortcut(event("k", { ctrlKey: true, ...flags }), defaultBindings),
    undefined,
  );
for (const [key, code, shiftKey] of [
  [";", "KeyZ", false],
  [":", "KeyZ", true],
  ["\\", "KeyY", false],
])
  assert.equal(
    resolveShortcut(
      event(key, { code, ctrlKey: true, shiftKey }),
      defaultBindings,
    ),
    undefined,
    "ASCII punctuation must not fall back to an unrelated physical letter",
  );
const option = parseShortcutConfiguration(
  config([row("help.shortcuts", ["Mod+Alt+K"])]),
);
assert.equal(
  resolveShortcut(
    event("˚", { code: "KeyK", metaKey: true, altKey: true }),
    option,
  ),
  "help.shortcuts",
);
assert.equal(
  resolveShortcut(event("я", { code: "KeyZ", ctrlKey: true }), defaultBindings),
  "canvas.undo",
);
assert.equal(
  resolveShortcut(
    event("Dead", { code: "KeyK", metaKey: true, altKey: true }),
    option,
  ),
  undefined,
);
assert.equal(
  resolveShortcut(
    event("Process", { code: "KeyK", ctrlKey: true }),
    defaultBindings,
  ),
  undefined,
);
assert.equal(
  shortcutFromEvent(event("p")),
  undefined,
  "plain writing is never a configurable shortcut",
);
for (const keys of [
  "Escape",
  "Tab",
  "Enter",
  "ArrowLeft",
  "Space",
  "Delete",
  "Backspace",
  "P",
  "Alt+K",
  "Mod+L",
  "Mod+Alt+W",
  "Ctrl+C",
  "Meta+V",
  "Mod+D",
  "Mod+Alt+D",
  "Mod+0",
  "Mod+Alt+0",
  "Shift+F10",
  "F5",
  "Shift+Space",
  "constructor+F1",
  "__proto__+F1",
  "Mod+Ctrl+K",
  "Ctrl+Control+K",
])
  assert.throws(() => normalizeShortcut(keys), keys);
for (const invalid of [
  { version: 2, bindings: [] },
  { version: 1, bindings: [], extra: true },
  { version: 1, bindings: [row("unknown", ["F1"])] },
  { version: 1, bindings: [row("help.shortcuts", ["F1"], "editor")] },
  {
    version: 1,
    bindings: [row("help.shortcuts", ["F1"]), row("help.shortcuts", [])],
  },
  { version: 1, bindings: [row("help.shortcuts", [null])] },
  { version: 1, bindings: [{ ...row("help.shortcuts", ["F1"]), unknown: 1 }] },
])
  assert.throws(() => parseShortcutConfiguration(JSON.stringify(invalid)));
assert.throws(() => parseShortcutConfiguration(" ".repeat(65537)), /64 KiB/);
assert.throws(
  () => parseShortcutConfiguration(config([row("help.shortcuts", ["Ctrl+K"])])),
  /conflicts/,
);
assert.throws(
  () => parseShortcutConfiguration(config([row("help.shortcuts", ["Mod+Z"])])),
  /conflicts/,
);
assert.throws(
  () =>
    parseShortcutConfiguration(config([row("help.shortcuts", ["F1", "f1"])])),
  /Repeated/,
);
// Simultaneous swaps must be evaluated as one complete configuration.
const swapped = parseShortcutConfiguration(
  config([row("search.open", ["F1"]), row("help.shortcuts", ["Mod+K"])]),
);
assert.equal(
  resolveShortcut(event("k", { ctrlKey: true }), swapped),
  "help.shortcuts",
);
assert.equal(resolveShortcut(event("F1"), swapped), "search.open");
const reference = shortcutReference(remapped);
for (const action of shortcutActions)
  assert.equal(reference.filter((r) => r[4] === action.id).length, 1);
assert.match(reference.find((r) => r[4] === "search.open")[1], /Shift/);
assert.equal(reference.find((r) => r[4] === "canvas.undo")[1], "Unassigned");
assert.ok(
  reference.some((r) => r[1] === "Double middle-click"),
  "fit gesture is never remapped",
);
console.log(
  "Shortcut configuration: strict schema/limits, defaults, atomic swaps, cross-alias conflicts, protected keys, composition, dispatch and live reference passed.",
);
