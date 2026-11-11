/** Scoped synchronous domain operations. The caller supplies lifetime/conflict guards. */
import * as f from "@manifold/foundation";
import type { RegionSession, Point } from "./regions/document.ts";
import {
  effective,
  mathematical,
  project,
} from "./regions/worksheetProjection.ts";
import { positions } from "./regions/pageLayout.ts";
import { unitLabel } from "./notebook/math.ts";
import {
  insertModel,
  inspectModel,
  setModelInput,
} from "./regions/modelCommands.ts";
import { modelFamilies, type ModelFamily } from "./regions/foundationModels.ts";
import { HeadlessError, headlessOperation } from "./headlessErrors.ts";

export function modelInfo(session: RegionSession, item: string) {
  const revision = f.current(session.document, item);
  if (!revision)
    throw new HeadlessError("ITEM_NOT_FOUND", "Model item not found", { item });
  if (revision.schema !== "scalar-model-instance@1")
    throw new HeadlessError(
      "UNSUPPORTED_CONTENT",
      "Item is not a scalar model instance",
      { item, schema: revision.schema },
    );
  return headlessOperation("inspectModel", () => inspectModel(session, item));
}

export function worksheetSnapshot(session: RegionSession) {
  const page = session.state,
    projection = project(page),
    layout = positions(page);
  return f.freeze({
    documentId: session.document.id,
    context: page.active,
    regions: effective(page).map((region) => {
      const statement = projection.statements.get(region.id);
      const diagnostic = projection.errors.get(region.id) ?? null;
      const quantity =
        !diagnostic && statement
          ? projection.solved.values.get(statement.name)
          : undefined;
      return {
        id: region.id,
        text: region.text,
        kind: projection.kinds[region.id],
        position: layout[region.id],
        name: statement?.anonymous ? null : (statement?.name ?? null),
        quantity: quantity ? { ...quantity, unit: unitLabel(quantity) } : null,
        diagnostic,
        constraint: projection.solved.constraints.get(region.id) ?? null,
        editable: !region.data && !region.external && !region.source,
      };
    }),
  });
}
export type WorksheetSnapshot = ReturnType<typeof worksheetSnapshot>;
export type WorksheetPosition = Readonly<Point>;

export function createHeadlessEdits(
  session: RegionSession,
  guard: () => void,
  onFailure: (error: unknown) => void = () => {},
) {
  function run<T>(operation: string, action: () => T): T {
    try {
      guard();
      return headlessOperation(operation, action);
    } catch (error) {
      onFailure(error);
      throw error;
    }
  }
  function textInput(text: string, kind: "equation" | "note") {
    if (typeof text !== "string" || !text.trim() || text.length > 5000)
      throw new HeadlessError(
        "INVALID_INPUT",
        "Use nonempty worksheet text within 5,000 characters",
        { kind },
      );
    if (mathematical(text) !== (kind === "equation"))
      throw new HeadlessError(
        "INVALID_INPUT",
        kind === "note"
          ? "Note text would be interpreted as mathematics; use an equation instead"
          : "Use mathematical source for an equation",
        { kind },
      );
  }
  function write(item: string, text: string, kind: "equation" | "note") {
    textInput(text, kind);
    const region = session.state.regions.find((region) => region.id === item);
    if (!region)
      throw new HeadlessError("ITEM_NOT_FOUND", "Worksheet region not found", {
        item,
      });
    if (region.data || region.external || region.source)
      throw new HeadlessError(
        "UNSUPPORTED_CONTENT",
        "Use a plain text worksheet region",
        { item },
      );
    const result = session.write(item, text);
    if (!result.ok)
      throw new HeadlessError(
        "OPERATION_REJECTED",
        result.error ?? "Worksheet edit rejected",
        { item },
      );
  }
  function create(
    text: string,
    kind: "equation" | "note",
    at?: WorksheetPosition,
  ) {
    textInput(text, kind);
    if (at && (!Number.isFinite(at.x) || !Number.isFinite(at.y)))
      throw new HeadlessError(
        "INVALID_INPUT",
        "Use finite worksheet coordinates",
        { kind },
      );
    const item = session.create(at);
    write(item, text, kind);
    return item;
  }
  return Object.freeze({
    createEquation(text: string, at?: WorksheetPosition) {
      return run("createEquation", () => create(text, "equation", at));
    },
    updateEquation(item: string, text: string) {
      return run("updateEquation", () => write(item, text, "equation"));
    },
    createNote(text: string, at?: WorksheetPosition) {
      return run("createNote", () => create(text, "note", at));
    },
    updateNote(item: string, text: string) {
      return run("updateNote", () => write(item, text, "note"));
    },
    createModel(family: ModelFamily) {
      return run("createModel", () => {
        if (!Object.hasOwn(modelFamilies, family))
          throw new HeadlessError("INVALID_INPUT", "Unknown model family", {
            family,
          });
        return insertModel(session, family, { x: 100, y: 100 });
      });
    },
    setModelInput(item: string, port: string, value: number) {
      return run("setModelInput", () => {
        const info = modelInfo(session, item);
        if (
          !Object.hasOwn(info.definition.inputs, port) ||
          !Number.isFinite(value) ||
          Math.abs(value) > 1e12
        )
          throw new HeadlessError(
            "INVALID_INPUT",
            "Use an existing input port and a finite model input within ±1e12",
            { item, port },
          );
        setModelInput(session, item, port, value);
      });
    },
  });
}

/** Available only during the synchronous callback. No execution, I/O, history or owner escape. */
export type HeadlessEdits = ReturnType<typeof createHeadlessEdits>;
