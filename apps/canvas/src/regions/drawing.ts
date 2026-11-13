/** Portable visual marks. References preserve connector identity, not computation. */
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "./document.ts";
import { drawingGeometry } from "./drawingGeometry.ts";
import { detachMember } from "./canvasScene.ts";
import { sameJson } from "./immutableJson.ts";
export const DRAWING = "canvas-drawing@1";
export const DRAWING_RENDERER = "canvas-drawing-view@1";
export const MAX_DRAWINGS = 2000;
export const MAX_STROKE_POINTS = 8192;
export const MAX_LABEL_LENGTH = 4096;
export const isInk = (kind: unknown) =>
  kind === "pen" || kind === "highlighter";
export type InkPoint = Point & { pressure: number };
export type DrawingKind = (typeof kinds)[number];
export type Anchor = { target: f.Reference; u: number; v: number };
export type Mark = {
  kind: DrawingKind;
  color: string;
  width: number;
  points: InkPoint[];
  text: string;
  start: Anchor | null;
  end: Anchor | null;
};
export type DrawingEntry = { id: string; view: f.View; mark: Mark };
export type DrawingEdit = { entry: DrawingEntry; mark?: Mark; at?: Point };
const kinds = [
  "pen",
  "highlighter",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "text",
  "connector",
] as const;
const checked = new WeakSet<object>();
const projections = new WeakMap<f.Document, DrawingEntry[]>();
const entriesByView = new WeakMap<f.View, DrawingEntry>();

const finite = (n: unknown, max = 1_000_000) =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= max;
export function validateMark(raw: f.Json): asserts raw is f.Json & Mark {
  f.assert(f.object(raw), "Invalid drawing");
  if (checked.has(raw)) return;
  f.fields(raw, ["kind", "color", "width", "points", "text", "start", "end"]);
  f.assert(kinds.includes(raw.kind as DrawingKind), "Unknown drawing tool");
  f.assert(
    typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color),
    "Invalid drawing color",
  );
  f.assert(
    finite(raw.width, 40) && (raw.width as number) >= 0.5,
    "Invalid stroke width",
  );
  f.assert(
    Array.isArray(raw.points) &&
      raw.points.length >= 1 &&
      raw.points.length <= MAX_STROKE_POINTS,
    `A stroke supports 1–${MAX_STROKE_POINTS} points`,
  );
  for (const p of raw.points) {
    f.assert(f.object(p), "Invalid stroke point");
    f.fields(p, ["x", "y", "pressure"]);
    f.assert(
      finite(p.x) &&
        finite(p.y) &&
        finite(p.pressure, 1) &&
        (p.pressure as number) >= 0,
      "Invalid stroke point",
    );
  }
  f.assert(
    typeof raw.text === "string" && raw.text.length <= MAX_LABEL_LENGTH,
    `Drawing labels support up to ${MAX_LABEL_LENGTH} characters`,
  );
  if (!isInk(raw.kind))
    f.assert(raw.points.length === 2, "Shapes require two corners");
  if (raw.kind !== "text")
    f.assert(raw.text === "", "Only labels contain text");
  for (const a of [raw.start, raw.end]) {
    if (a === null) continue;
    f.assert(
      raw.kind === "connector" && f.object(a),
      "Only connectors attach to shapes",
    );
    f.fields(a, ["target", "u", "v"]);
    f.validateReference(a.target);
    f.assert(
      a.target.selection.kind === "follow" &&
        sameJson(a.target.selector, f.wholeSelector),
      "Invalid drawing attachment",
    );
    f.assert(
      finite(a.u, 1) &&
        finite(a.v, 1) &&
        (a.u as number) >= 0 &&
        (a.v as number) >= 0,
      "Invalid attachment anchor",
    );
  }
  if (f.deeplyFrozen(raw)) checked.add(raw);
}
export const drawingSchema: f.Schema = {
  id: DRAWING,
  validate: validateMark,
  references(body) {
    validateMark(body);
    return [body.start, body.end].flatMap((a) => (a ? [a.target] : []));
  },
  assets: () => [],
  project(body) {
    validateMark(body);
    return { type: DRAWING, value: body };
  },
};
export function drawings(document: f.Document): DrawingEntry[] {
  const known = projections.get(document);
  if (known) return known;
  const result: DrawingEntry[] = [];
  for (const [, view] of document.views.entries()) {
    if (view.renderer !== DRAWING_RENDERER) continue;
    const revision = f.current(document, view.reference.item);
    f.assert(revision?.schema === DRAWING, "Missing drawing");
    validateMark(revision.body);
    let entry = entriesByView.get(view);
    if (entry?.mark !== revision.body) {
      entry = { id: view.reference.item, view, mark: revision.body };
      entriesByView.set(view, entry);
    }
    result.push(entry);
  }
  f.freeze(result);
  projections.set(document, result);
  return result;
}
export function validateDrawingDocument(document: f.Document) {
  const entries = drawings(document),
    byId = drawingGeometry(entries).byId;
  f.assert(
    entries.length <= MAX_DRAWINGS && byId.size === entries.length,
    "The canvas supports 2000 unique drawings",
  );
  for (const e of entries) {
    f.assert(
      !e.view.alternative &&
        e.view.reference.document === document.document &&
        e.view.reference.selection.kind === "follow" &&
        sameJson(e.view.reference.selector, f.wholeSelector),
      "Invalid drawing view",
    );
    for (const a of [e.mark.start, e.mark.end])
      if (a) {
        const target = byId.get(a.target.item);
        f.assert(
          a.target.document === document.document &&
            target &&
            ["rectangle", "ellipse"].includes(target.mark.kind),
          "Connectors must attach to live drawing shapes",
        );
      }
  }
}
const uid = () => "drawing-" + crypto.randomUUID();
const revision = (item: string, mark: Mark): f.Revision => ({
  item,
  id: uid(),
  schema: DRAWING,
  required: true,
  body: mark as unknown as f.Json,
});
function createCommands(
  document: string,
  item: string,
  mark: Mark,
  at: Point,
): f.Command[] {
  return [
    {
      kind: "create",
      item,
      label: mark.kind === "text" ? mark.text.slice(0, 80) : mark.kind,
      revision: revision(item, mark),
    },
    {
      kind: "view",
      view: {
        id: item + ":view",
        reference: f.reference(document, item),
        renderer: DRAWING_RENDERER,
        x: at.x,
        y: at.y,
        alternative: null,
      },
    },
  ];
}
export function createDrawing(
  session: RegionSession,
  mark: Mark,
  at: Point = { x: 0, y: 0 },
  expected = session.document,
) {
  const item = uid();
  session.applyCommands(
    createCommands(expected.document, item, mark, at),
    expected,
  );
  return item;
}
export function editDrawings(
  session: RegionSession,
  changes: readonly DrawingEdit[],
  expected = session.document,
) {
  const commands: f.Command[] = [];
  for (const { entry, mark, at } of changes) {
    f.assert(
      expected.views.get(entry.view.id) === entry.view &&
        f.current(expected, entry.id)?.body === entry.mark,
      "Drawing changed; start the edit again",
    );
    if (mark && !sameJson(mark, entry.mark))
      commands.push({
        kind: "revise",
        item: entry.id,
        revision: revision(entry.id, mark),
      });
    if (at && (at.x !== entry.view.x || at.y !== entry.view.y))
      commands.push({
        kind: "view",
        view: { ...entry.view, x: at.x, y: at.y },
      });
  }
  session.applyCommands(commands, expected);
}
export function deleteDrawings(
  session: RegionSession,
  ids: string[],
  expected = session.document,
) {
  if (
    session.scene.groups.some((group) =>
      group.members.some((id) => ids.includes(id)),
    )
  ) {
    f.assert(
      session.document === expected,
      "Drawing changed; start the edit again",
    );
    session.atomic((staged) => {
      staged.setScene((scene) => ({
        ...scene,
        groups: ids.reduce(
          (groups, id) => detachMember(groups, id),
          scene.groups,
        ),
      }));
      deleteDrawings(staged, ids);
    });
    return;
  }
  const entries = drawings(expected),
    geometry = drawingGeometry(entries),
    removed = new Set(ids),
    commands: f.Command[] = [];
  // Detach surviving connectors at their visible position in the same Undo operation.
  for (const e of entries) {
    if (removed.has(e.id)) {
      commands.push(
        { kind: "removeView", id: e.view.id },
        { kind: "delete", item: e.id },
      );
    } else if (
      [e.mark.start, e.mark.end].some((a) => a && removed.has(a.target.item))
    ) {
      commands.push({
        kind: "revise",
        item: e.id,
        revision: revision(e.id, geometry.detachedMark(e, removed)),
      });
    }
  }
  session.applyCommands(commands, expected);
}
export function duplicateDrawings(session: RegionSession, ids: string[]) {
  const expected = session.document,
    selected = new Set(ids);
  const entries = drawings(expected).filter((e) => selected.has(e.id));
  const mapping = new Map(entries.map((e) => [e.id, uid()]));
  const anchor = (a: Anchor | null) =>
    a && {
      ...a,
      target: f.reference(
        expected.document,
        mapping.get(a.target.item) ?? a.target.item,
      ),
    };
  session.applyCommands(
    entries.flatMap((e) =>
      createCommands(
        expected.document,
        mapping.get(e.id)!,
        { ...e.mark, start: anchor(e.mark.start), end: anchor(e.mark.end) },
        { x: e.view.x + 24, y: e.view.y + 24 },
      ),
    ),
    expected,
  );
  return [...mapping.values()];
}
