import {
  defaultBindings,
  shortcutLabel,
  type ShortcutAction,
  type ShortcutBindings,
} from "./shortcutBindings.ts";
/** Fixed editor/gesture reference plus IDs resolved from the actual canvas bindings. */
type ShortcutEntry = readonly [
  keys: string,
  action: string,
  scope: string,
  binding?: ShortcutAction,
];
type ShortcutReference = readonly [group: string, ...ShortcutEntry];
const shortcutGroups: Record<string, readonly ShortcutEntry[]> = {
  Files: [
    [
      "⌘ / Ctrl + S",
      "Save workspace file",
      "Downloads a portable .manifold copy after finishing pending edits. Browser autosave does not update downloaded files.",
    ],
    [
      "⌘ / Ctrl + O",
      "Open workspace file",
      "Choose a .manifold or legacy JSON file. Validates it and preserves current work before opening a fresh canvas URL. Never runs loaded code.",
    ],
  ],
  Navigation: [
    [
      "Space + drag / Middle-button drag",
      "Pan canvas",
      "Outside text fields. Escape exits hand mode.",
    ],
    [
      "Scroll / Two-finger scroll",
      "Pan canvas",
      "Over the canvas; Shift + scroll pans sideways.",
    ],
    ["⌘ / Ctrl + scroll / Pinch", "Zoom at the pointer", "Over the canvas."],
    [
      "+ / −",
      "Zoom in / out",
      "Canvas focus, not while typing. Plus / minus keys.",
    ],
    ["Shift + 1", "Fit page", "Canvas focus; customizable.", "canvas.fit"],
    [
      "Double middle-click",
      "Fit page by gesture",
      "Fixed canvas gesture; independent of its configurable keyboard binding.",
    ],
    ["⌘ / Ctrl + 0", "Reset zoom to 100%", "Canvas focus."],
    [
      "Alt + ←",
      "Back in relationship navigation",
      "When relationship navigation has a previous view.",
    ],
  ],
  Writing: [
    [
      "Type / Enter",
      "Start writing or edit the selected region",
      "Canvas focus; Enter edits a selection, or starts a new region.",
    ],
    [
      "Enter",
      "Continue below",
      "In an equation or note editor. Valid text is accepted.",
    ],
    [
      "Shift + Enter",
      "Insert a new line",
      "In a text editor or drawing label.",
    ],
    [
      "Escape",
      "Finish editing",
      "In an equation/note editor; this finishes valid text, it does not discard it.",
    ],
    [
      "Tab / Shift + Tab",
      "Select the next / previous source span",
      "In the equation writer; Tab at the end continues below.",
    ],
    [
      "@",
      "Suggest a reference",
      "While writing. ↑ / ↓ choose; Enter or Tab inserts; Escape dismisses suggestions.",
    ],
  ],
  "Actions & selection": [
    [
      "⌘ / Ctrl + K",
      "Search objects and commands",
      "Canvas binding is customizable. The equation writer, menus and this reference retain fixed ⌘ / Ctrl + K for search.",
      "search.open",
    ],
    [
      "/",
      "Open add-to-canvas actions",
      "Canvas focus or an empty equation writer; elsewhere it is ordinary text.",
    ],
    [
      "Shift + F10 / Context Menu key",
      "Open context actions",
      "Focused canvas work. Includes the overlap chooser where objects overlap.",
    ],
    [
      "Shift + Space",
      "Open the marking menu",
      "Outside text fields. Hold and point, or release to click an action.",
    ],
    [
      "↑ / ↓ / ← / → · Home / End",
      "Choose a menu action",
      "In context/marking menus. Enter or Space activates; 1–8 selects a numbered item.",
    ],
    [
      "Escape / Tab",
      "Dismiss an action menu",
      "Returns focus to its invoker. Escape also closes the shortcut reference.",
    ],
    [
      "↑ / ↓ · Enter",
      "Choose a search result",
      "In command search; Enter runs the focused result or the first result from the search field.",
    ],
    [
      "Shift + click",
      "Toggle an object in a multi-selection",
      "Canvas objects or drawings with the default Select / Edit pointer.",
    ],
    [
      "Alt + click",
      "Inspect a mathematical term",
      "On rendered notation; does not open its source editor.",
    ],
    [
      "Arrow keys / Shift + Arrow keys",
      "Nudge a selected worksheet region by 5 / 20 units",
      "Canvas focus; not in text fields or on buttons.",
    ],
    [
      "Tab · Alt + Arrow · Home / End",
      "Navigate the drawing collection",
      "Drawings use one Tab stop. Alt + Arrow browses drawings; Home/End jumps to the first/last. Enter/Space selects. Arrow keys move selected objects by 5 units, or 20 with Shift. Delete removes the selection; Escape cancels or clears.",
    ],
    [
      "Alt while dragging",
      "Bypass alignment and docking",
      "Releasing Alt starts a fresh docking hover.",
    ],
    [
      "Escape",
      "Cancel the current gesture or clear attention",
      "Context-sensitive: cancels previews, exits temporary overlap attention, or clears selection.",
    ],
  ],
  History: [
    [
      "⌘ / Ctrl + Z",
      "Undo",
      "Canvas work; focused text fields retain native text undo.",
      "canvas.undo",
    ],
    [
      "⌘ / Ctrl + Shift + Z / ⌘ / Ctrl + Y",
      "Redo",
      "Canvas work; focused text fields retain native text redo.",
      "canvas.redo",
    ],
  ],
  Drawing: [
    [
      "Draw + hold",
      "Regularize a pen stroke",
      "Pen only: hold still about 650 ms for a line/circle/rectangle preview. Lift accepts; move resumes ink. Undo restores original ink.",
    ],
    [
      "Regularize button · Enter / Space",
      "Regularize selected ink without holding",
      "One selected pen stroke. Focus the drawing toolbar button; uncertain fits leave the stroke unchanged.",
    ],
    [
      "⌘ / Ctrl + D",
      "Duplicate selected marks",
      "While a drawing tool is active, outside text fields.",
    ],
    [
      "Delete / Backspace",
      "Delete selected marks",
      "While a drawing tool is active; never a shortcut to delete typed text.",
    ],
    [
      "Shift + drag",
      "Constrain a line, arrow, rectangle or ellipse",
      "Lines/arrows snap to 45° angles; rectangles/ellipses keep equal sides.",
    ],
    [
      "Enter / Shift + Enter / Escape",
      "Finish / add a line / cancel a drawing label",
      "In the drawing label editor. Escape here discards the pending label.",
    ],
    [
      "Escape",
      "Cancel drawing and return to Write",
      "Also clears selected marks; does not delete accepted drawings.",
    ],
  ],
  Exploration: [
    [
      "← / →",
      "Adjust a focused Vary value or plot control",
      "Only on an editable value/plot control. ↑ / ↓ also adjust a Vary slider; Vary stays a proposal until Keep.",
    ],
    [
      "Shift + ← / → / Shift + drag",
      "Fine adjustment of a scrub value",
      "On a scrub control: one tenth of its ordinary step. Shift + ↑ / ↓ also gives fine adjustment on a Vary slider.",
    ],
    [
      "Escape",
      "Revert the active exploration",
      "Context-sensitive; closes the current temporary preview before clearing other attention.",
    ],
  ],
  Datasets: [
    [
      "⌘ / Ctrl + Enter",
      "Accept a dataset connection",
      "Only in a valid, paired dataset-to-model connection review.",
    ],
    [
      "Shift + click / Shift + Enter / Shift + Space",
      "Compare dataset records",
      "On a focused record/row, adds the observation to the comparison instead of replacing it.",
    ],
  ],
  "Workspace layout": [
    [
      "← / →",
      "Resize a workspace column",
      "On a focused vertical area divider: 40px per step.",
    ],
    [
      "↑ / ↓",
      "Resize stacked workspace areas",
      "On a focused horizontal area divider: changes the split by 5%.",
    ],
  ],
  "Models & references": [
    [
      "Escape",
      "Dismiss a model/reference/options review",
      "On the relevant review or model control. Exposed model input edits discard their local draft.",
    ],
  ],
  "Dialogs & controls": [
    [
      "Unassigned",
      "Keyboard shortcuts",
      "Optional canvas key. The ? button and Help action always remain available.",
      "help.shortcuts",
    ],
    [
      "Tab / Shift + Tab",
      "Move keyboard focus",
      "Native dialogs keep focus inside; Enter / Space activates buttons and disclosures.",
    ],
  ],
};
export const keyboardShortcuts: readonly ShortcutReference[] = Object.entries(
  shortcutGroups,
).flatMap(([group, rows]) => rows.map((row) => [group, ...row] as const));

const searchable = (text: string) =>
  text
    .toLowerCase()
    .replaceAll("⌘", " command cmd mac ")
    .replaceAll("ctrl", " control ctrl windows ")
    .replaceAll("+", " ")
    .replaceAll("/", " ")
    .replaceAll("·", " ")
    .replaceAll("enter", " enter return ")
    .replaceAll("←", " left arrow ")
    .replaceAll("→", " right arrow ")
    .replaceAll("↑", " up arrow ")
    .replaceAll("↓", " down arrow ")
    .replaceAll("−", " minus - ");
export function shortcutReference(
  bindings: ShortcutBindings = defaultBindings,
): readonly ShortcutReference[] {
  return keyboardShortcuts.map((row) =>
    row[4]
      ? ([
          row[0],
          shortcutLabel(bindings[row[4]]),
          row[2],
          row[3],
          row[4],
        ] as const)
      : row,
  );
}
export function findShortcuts(
  query: string,
  bindings: ShortcutBindings = defaultBindings,
) {
  const key =
    query.trim() === "+" ? "plus" : query.trim() === "-" ? "minus" : query;
  const words = searchable(key).trim().split(/\s+/).filter(Boolean);
  return shortcutReference(bindings).filter((row) => {
    const tokens = searchable(row.join(" ")).match(/[\p{L}\p{N}]+/gu) || [];
    return words.every((word) =>
      tokens.some((token) =>
        word.length === 1 ? token === word : token.startsWith(word),
      ),
    );
  });
}
