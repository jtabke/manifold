/** Internal shared resolution/traversal mechanism; Context remains the existing public contract. */
import { assert, retained, freeze, type Json } from "./value.ts";
import { validateReference } from "./content.ts";
import { SharedMap } from "./shared-map.ts";
import type { Document, Context } from "./document.ts";
import type {
  Reference,
  Revision,
  Schemas,
  ProjectionResult,
} from "./contracts.ts";
export type ResolutionSource = Pick<Document, "document" | "revisions"> &
  Partial<Pick<Document, "items">>;
export function resolveRevision(
  doc: ResolutionSource,
  ref: Reference,
  context?: Context,
):
  | Readonly<{ status: "resolved"; revision: Revision }>
  | Exclude<ProjectionResult, { status: "resolved" }> {
  if (ref.document !== doc.document)
    return {
      status: "unavailable",
      reason: "Referenced document is not mounted",
    };
  if (context && context.root.document !== doc.document)
    return {
      status: "unavailable",
      reason: "Context belongs to another document",
    };
  const id =
    ref.selection.kind === "pin"
      ? ref.selection.revision
      : context
        ? context.heads.get(ref.item)
        : doc.items?.get(ref.item)?.revision;
  if (context && ref.selection.kind === "follow" && id === undefined)
    return {
      status: "missing",
      reason: "Frozen selection is absent; baseline fallback is forbidden",
    };
  if (!id || (context && !context.revisions.get(id)))
    return {
      status: "missing",
      reason: "Selected revision was unavailable in this context",
    };
  const revision = doc.revisions.get(id);
  return revision?.item === ref.item
    ? { status: "resolved", revision }
    : { status: "missing", reason: "Referenced revision is missing" };
}
/** Ephemeral traversal state is consumed immediately; it never retains a whole source Document in a cache. */
function walk(
  doc: Document,
  target: Reference,
  schemas: Schemas,
  context?: Context,
  limit = 100000,
) {
  validateReference(target);
  assert(
    Number.isSafeInteger(limit) && limit > 0,
    "Invalid context reference budget",
  );
  const heads = new Map<string, string | null>(),
    revisions = new Map<string, Revision>(),
    pins = new Set<string>(),
    queue = [target];
  let count = 0;
  while (queue.length) {
    assert(++count <= limit, "Context reference budget exceeded");
    const ref = queue.pop()!;
    if (ref.document !== doc.document) continue;
    if (ref.selection.kind === "follow") {
      const selected = context
        ? context.heads.get(ref.item)
        : (doc.items.get(ref.item)?.revision ?? null);
      assert(selected !== undefined, "Incomplete frozen selection");
      heads.set(ref.item, selected);
    } else pins.add(ref.selection.revision);
    const got = resolveRevision(doc, ref, context);
    if (got.status !== "resolved" || revisions.has(got.revision.id)) continue;
    revisions.set(got.revision.id, got.revision);
    queue.push(
      ...(schemas.get(got.revision.schema)?.references(got.revision.body) ??
        []),
    );
  }
  return { heads, revisions, pins };
}
export function captureSelection(
  doc: Document,
  target: Reference,
  schemas: Schemas,
  limit = 100000,
) {
  const trace = walk(doc, target, schemas, undefined, limit);
  const context: Context = Object.freeze({
    root: retained(target as unknown as Json) as Reference,
    heads: SharedMap.from(trace.heads),
    revisions: SharedMap.from(
      [...trace.revisions.keys()].map((id) => [id, true] as const),
    ),
  });
  return { context, pins: trace.pins, revisions: trace.revisions };
}
export function checkSelection(
  doc: Document,
  context: Context,
  schemas: Schemas,
) {
  assert(context.root.document === doc.document, "Cross-document context root");
  if (doc.readOnly) {
    for (const [item, id] of context.heads.entries())
      assert(
        id === null ||
          (doc.revisions.get(id)?.item === item && context.revisions.get(id)),
        "Invalid frozen head",
      );
    for (const [id] of context.revisions.entries())
      assert(doc.revisions.get(id), "Missing retained context revision");
    return; // Unknown handlers cannot establish closure; retain opaque preservation semantics.
  }
  const trace = walk(doc, context.root, schemas, context);
  for (const [item, id] of context.heads.entries()) {
    assert(trace.heads.has(item), "Extraneous context selection");
    assert(
      id === null ||
        (doc.revisions.get(id)?.item === item && context.revisions.get(id)),
      "Invalid frozen head",
    );
  }
  for (const [id] of context.revisions.entries())
    assert(
      trace.revisions.has(id) && doc.revisions.get(id),
      "Invalid/unreachable context revision",
    );
}
export type SelectionGuard = Readonly<{
  heads: Readonly<Record<string, string | null>>;
  pins: Readonly<Record<string, boolean>>;
  /** A preview's own immutable records may later be retained by its completed execution. */
  admissions: Readonly<Record<string, Revision>>;
}>;
/** Baseline guards cover the union of old and candidate dependencies, including a pinned root. */
export function guardSelection(
  baseline: Document,
  ...selections: readonly ReturnType<typeof captureSelection>[]
): SelectionGuard {
  const heads: Record<string, string | null> = Object.create(null),
    pins: Record<string, boolean> = Object.create(null),
    admissions: Record<string, Revision> = Object.create(null);
  for (const selected of selections) {
    for (const [item] of selected.context.heads.entries())
      heads[item] = baseline.items.get(item)?.revision ?? null;
    for (const id of selected.pins) {
      pins[id] = !!baseline.revisions.get(id);
      const staged = selected.revisions.get(id);
      if (!pins[id] && staged) admissions[id] = staged;
    }
  }
  return freeze({ heads, pins, admissions });
}
export function assertSelectionUnchanged(doc: Document, guard: SelectionGuard) {
  for (const [item, revision] of Object.entries(guard.heads))
    assert(
      (doc.items.get(item)?.revision ?? null) === revision,
      "Preview is stale; baseline inputs changed",
    );
  for (const [id, present] of Object.entries(guard.pins))
    assert(
      !!doc.revisions.get(id) === present ||
        (!present &&
          guard.admissions[id] !== undefined &&
          doc.revisions.get(id) === guard.admissions[id]),
      "Preview is stale; pinned dependency availability changed",
    );
}
