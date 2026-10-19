/** Presentation only. No Page, quantity, or execution records belong here. */
export type EditorKind =
  | "canvas"
  | "equations"
  | "response"
  | "table"
  | "dependencies"
  | "python"
  | "notes";
export const editorNames: Record<EditorKind, string> = {
  canvas: "Canvas",
  equations: "Equations",
  response: "Response",
  table: "Table",
  dependencies: "Relationships",
  python: "Python",
  notes: "Notes",
};
export type Area = {
  id: string;
  editor: EditorKind;
  weight: number;
  object?: string;
  artifact?: string;
  context?: string;
};
export type Column = { id: string; width: number; areas: Area[] };
export type Arrangement = { id: string; name: string; columns: Column[] };
export type Layouts = { version: 1; active: string; workspaces: Arrangement[] };
export const AREA_STORAGE = "manifold.workspace-areas.v1";
const uid = () => crypto.randomUUID();
const area = (editor: EditorKind, extra: Partial<Area> = {}): Area => ({
  id: uid(),
  editor,
  weight: 1,
  ...extra,
});
const column = (width: number, areas: Area[]): Column => ({
  id: uid(),
  width,
  areas,
});
export function starter(name: string): Arrangement {
  return {
    id: uid(),
    name,
    columns:
      name === "Model"
        ? [
            column(650, [area("equations")]),
            column(600, [area("response"), area("dependencies")]),
            column(500, [area("python")]),
          ]
        : name === "Explore"
          ? [column(600, [area("equations")]), column(740, [area("response")])]
          : name === "Review"
            ? [
                column(550, [area("equations")]),
                column(600, [area("response")]),
                column(600, [area("response", { context: "original" })]),
              ]
            : [column(900, [area("canvas")])],
  };
}
export function initialLayouts(): Layouts {
  const workspaces = ["Think", "Model", "Explore", "Review"].map(starter);
  return { version: 1, active: workspaces[0].id, workspaces };
}
export function restoreLayouts(raw: string): Layouts {
  const value = JSON.parse(raw) as Layouts;
  const safeId = (v: unknown) =>
    typeof v === "string" &&
    /^[a-zA-Z0-9-]{1,100}$/.test(v) &&
    v !== "constructor" &&
    v !== "prototype";
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  if (
    raw.length > 100_000 ||
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.workspaces) ||
    !value.workspaces.length ||
    value.workspaces.length > 12
  )
    throw Error("Unsupported workspace layout.");
  const ids = new Set<string>();
  for (const w of value.workspaces) {
    if (
      !object(w) ||
      !safeId(w.id) ||
      ids.has(w.id) ||
      typeof w.name !== "string" ||
      !w.name.trim() ||
      w.name.length > 60 ||
      !Array.isArray(w.columns) ||
      w.columns.length > 12
    )
      throw Error("Invalid workspace.");
    ids.add(w.id);
    let canvases = 0,
      count = 0;
    for (const c of w.columns) {
      if (
        !object(c) ||
        !safeId(c.id) ||
        ids.has(c.id) ||
        !Number.isFinite(c.width) ||
        c.width < 320 ||
        c.width > 1800 ||
        !Array.isArray(c.areas) ||
        !c.areas.length ||
        c.areas.length > 8
      )
        throw Error("Invalid workspace column.");
      ids.add(c.id);
      for (const a of c.areas) {
        if (
          !object(a) ||
          !safeId(a.id) ||
          ids.has(a.id) ||
          !Object.hasOwn(editorNames, a.editor) ||
          !Number.isFinite(a.weight) ||
          a.weight <= 0 ||
          a.weight > 100 ||
          [a.object, a.artifact, a.context].some(
            (v) => v !== undefined && !safeId(v),
          )
        )
          throw Error("Invalid workspace area.");
        ids.add(a.id);
        if (a.editor === "canvas") canvases++;
        count++;
      }
    }
    if (canvases > 1 || count > 32) throw Error("Too many workspace areas.");
  }
  if (!value.workspaces.some((w) => w.id === value.active))
    throw Error("Missing active workspace.");
  // Reconstruct the presentation contract; unknown properties cannot become model state.
  return {
    version: 1,
    active: value.active,
    workspaces: value.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      columns: w.columns.map((c) => ({
        id: c.id,
        width: c.width,
        areas: c.areas.map((a) => ({
          id: a.id,
          editor: a.editor,
          weight: a.weight,
          ...(a.object ? { object: a.object } : {}),
          ...(a.artifact ? { artifact: a.artifact } : {}),
          ...(a.context ? { context: a.context } : {}),
        })),
      })),
    })),
  };
}
export type AreaAction =
  | { type: "editor"; id: string; editor: EditorKind }
  | { type: "split"; id: string; direction: "right" | "down" }
  | { type: "close" | "duplicate" | "left" | "right"; id: string };
export function arrangeAreas(w: Arrangement, action: AreaAction): Arrangement {
  const next = structuredClone(w),
    ci = next.columns.findIndex((c) => c.areas.some((a) => a.id === action.id));
  if (ci < 0) return w;
  const c = next.columns[ci],
    i = c.areas.findIndex((a) => a.id === action.id),
    a = c.areas[i];
  const count = next.columns.reduce((sum, col) => sum + col.areas.length, 0);
  if (action.type === "editor") {
    // The full freeform authoring surface has one owner. Changing its location swaps
    // editors; linked equation editors can be duplicated without copying definitions.
    if (action.editor === "canvas")
      for (const col of next.columns)
        for (const other of col.areas)
          if (other.editor === "canvas") other.editor = a.editor;
    a.editor = action.editor;
  } else if (action.type === "close") {
    c.areas.splice(i, 1);
    if (!c.areas.length) next.columns.splice(ci, 1);
  } else if (action.type === "left" || action.type === "right") {
    const to = ci + (action.type === "left" ? -1 : 1);
    if (to >= 0 && to < next.columns.length)
      [next.columns[ci], next.columns[to]] = [
        next.columns[to],
        next.columns[ci],
      ];
  } else if (count < 32) {
    const copy = {
      ...a,
      id: uid(),
      editor: a.editor === "canvas" ? ("equations" as const) : a.editor,
    };
    if (
      action.type === "split" &&
      action.direction === "down" &&
      c.areas.length < 8
    )
      c.areas.splice(i + 1, 0, copy);
    else if (next.columns.length < 12)
      next.columns.splice(ci + 1, 0, column(c.width, [copy]));
  }
  return next;
}
export function duplicateWorkspace(w: Arrangement, name: string): Arrangement {
  return {
    id: uid(),
    name,
    columns: w.columns.map((c) =>
      column(
        c.width,
        c.areas.map((a) => ({ ...a, id: uid() })),
      ),
    ),
  };
}
