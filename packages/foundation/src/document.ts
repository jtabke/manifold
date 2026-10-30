import {
  assert,
  object,
  fields,
  identity,
  freeze,
  retained,
  json,
  canonical,
  deeplyFrozen,
  type Json,
} from "./value.ts";
import { SharedMap, mapWork, type MapWork } from "./shared-map.ts";
import {
  resolveRevision as resolve,
  captureSelection,
  checkSelection,
} from "./selection.ts";
export { resolve };
export type { ResolutionSource } from "./selection.ts";
import { validateReference } from "./content.ts";
import type {
  Schemas,
  Revision,
  Item,
  View,
  Reference,
  Resources,
  ProjectionResult,
  Projection,
  ProjectionOrigin,
} from "./contracts.ts";
export type Context = Readonly<{
  root: Reference;
  heads: SharedMap<string | null>;
  revisions: SharedMap<true>;
}>;
export type PlainContext = Readonly<{
  root: Reference;
  heads: Readonly<Record<string, string | null>>;
  revisions: readonly string[];
}>;
export type Alternative = Readonly<{
  id: string;
  label: string;
  context: Context;
}>;
export type PlainAlternative = Readonly<{
  id: string;
  label: string;
  context: PlainContext;
}>;
export type PlainIdentities = Readonly<{
  items: readonly string[];
  revisions: readonly string[];
  views: readonly string[];
  alternatives: readonly string[];
  receipts: readonly string[];
}>;
export type Allocations = Readonly<{
  revisions: SharedMap<true>;
  views: SharedMap<true>;
  alternatives: SharedMap<true>;
  receipts: SharedMap<true>;
}>;
export type PlainDocument = Readonly<{
  document: string;
  id: string;
  sequence: number;
  evidenceSequence?: number;
  identities?: PlainIdentities;
  items: Readonly<Record<string, Item>>;
  revisions: Readonly<Record<string, Revision>>;
  views: Readonly<Record<string, View>>;
  alternatives: Readonly<Record<string, PlainAlternative>>;
}>;
type Index = SharedMap<SharedMap<true>>;
export type Document = Readonly<{
  document: string;
  id: string;
  sequence: number;
  evidenceSequence: number;
  allocated: Allocations;
  items: SharedMap<Item>;
  known: SharedMap<true>;
  revisions: SharedMap<Revision>;
  views: SharedMap<View>;
  alternatives: SharedMap<Alternative>;
  dependents: Index;
  readOnly: boolean;
}>;
export type Command = Readonly<
  | { kind: "create"; item: string; label: string; revision: Revision }
  | { kind: "revise"; item: string; revision: Revision }
  | { kind: "restore"; item: string; revision: string; label: string }
  | { kind: "rename"; item: string; label: string }
  | { kind: "delete"; item: string }
  | { kind: "view"; view: View }
  | { kind: "removeView"; id: string }
  | { kind: "removeAlternative"; id: string }
>;
export type Changes = Readonly<{
  items: readonly string[];
  affected: readonly string[];
  views: readonly string[];
  alternatives: readonly string[];
}>;
export const current = (doc: Document, item: string) => {
  const r = doc.items.get(item)?.revision;
  return r ? doc.revisions.get(r) : undefined;
};
function validateRevision(r: Revision, schemas: Schemas) {
  assert(object(r), "Invalid revision");
  fields(r, ["id", "item", "schema", "required", "body"]);
  identity(r.id);
  identity(r.item);
  assert(
    typeof r.schema === "string" &&
      r.schema.includes("@") &&
      typeof r.required === "boolean",
    "Invalid content contract",
  );
  const schema = schemas.get(r.schema);
  if (!schema) {
    assert(!r.required, "Unsupported required content " + r.schema);
    return false;
  }
  schema.validate(r.body);
  for (const ref of schema.references(r.body)) validateReference(ref);
  for (const id of schema.evidence?.(r.body) ?? []) identity(id);
  return true;
}
function validateView(v: View) {
  assert(object(v), "Invalid view");
  fields(v, ["id", "reference", "renderer", "x", "y", "alternative"]);
  identity(v.id);
  validateReference(v.reference);
  assert(
    typeof v.renderer === "string" &&
      Number.isFinite(v.x) &&
      Number.isFinite(v.y),
    "Invalid renderer/position",
  );
  if (v.alternative !== null) identity(v.alternative);
}
function key(ref: Reference) {
  return JSON.stringify(
    ref.selection.kind === "follow"
      ? ["item", ref.document, ref.item]
      : ["revision", ref.document, ref.selection.revision],
  );
}
function dependencies(r: Revision | undefined, schemas: Schemas) {
  return new Set(
    r ? (schemas.get(r.schema)?.references(r.body) ?? []).map(key) : [],
  );
}
function reindex(
  deps: Index,
  item: string,
  old: Revision | undefined,
  next: Revision | undefined,
  schemas: Schemas,
  work?: MapWork,
) {
  const before = dependencies(old, schemas),
    after = dependencies(next, schemas);
  for (const k of before)
    if (!after.has(k)) {
      const members = deps.get(k, work)!.delete(item, work);
      deps = members.size ? deps.set(k, members, work) : deps.delete(k, work);
    }
  for (const k of after)
    if (!before.has(k))
      deps = deps.set(
        k,
        (deps.get(k, work) ?? SharedMap.empty<true>()).set(item, true, work),
        work,
      );
  return deps;
}
export function project(
  doc: Document,
  ref: Reference,
  schemas: Schemas,
  resources: Resources,
  context?: Context,
): ProjectionResult {
  const cache = new Map<string, ProjectionResult>(),
    active = new Set<string>(),
    owners = new WeakMap<Projection, Revision>();
  let steps = 0;
  const origin = (p: Projection): ProjectionOrigin => ({
    document: p.document,
    item: p.item,
    revision: p.revision,
    selector: p.selector,
  });
  function read(target: Reference): ProjectionResult {
    try {
      validateReference(target);
      const result = resolve(doc, target, context);
      if (result.status !== "resolved") return result;
      const key = canonical([
        target.document,
        target.item,
        result.revision.id,
        target.selector,
      ]);
      if (active.has(key))
        return { status: "ambiguous", reason: "Cyclic projection dependency" };
      const hit = cache.get(key);
      if (hit) return hit;
      assert(
        ++steps <= 4096 && active.size < 64,
        "Projection dependency/depth budget exceeded",
      );
      const schema = schemas.get(result.revision.schema);
      if (!schema)
        return {
          status: "unsupported",
          reason: "Content handler is unavailable",
        };
      active.add(key);
      try {
        const dependencies = new Map<string, ProjectionOrigin>();
        function dependency(from: Revision, reference: Reference) {
          validateReference(reference);
          const declared =
            schemas.get(from.schema)?.references(from.body) ?? [];
          assert(
            declared.some(
              (ref) =>
                canonical(ref as unknown as Json) ===
                canonical(reference as unknown as Json),
            ),
            "Projection read is not a declared dependency",
          );
          const projected = read(reference);
          if (projected.status === "resolved") {
            for (const p of [
              origin(projected.projection),
              ...(projected.projection.dependencies ?? []),
            ])
              dependencies.set(canonical(p as unknown as Json), p);
            assert(
              dependencies.size <= 4096,
              "Projection provenance budget exceeded",
            );
          }
          return projected;
        }
        const reader = Object.freeze({
          read: (ref: Reference) => dependency(result.revision, ref),
          readFrom(parent: Projection, ref: Reference) {
            const source = owners.get(parent);
            assert(source, "Projection parent belongs to another read");
            return dependency(source, ref);
          },
        });
        const output = schema.project(
          result.revision.body,
          target.selector,
          resources,
          result.revision,
          reader,
        );
        if ("status" in output) {
          assert(
            [
              "missing",
              "unavailable",
              "unsupported",
              "ambiguous",
              "loading",
              "corrupt",
            ].includes(output.status) && typeof output.reason === "string",
            "Invalid projection status",
          );
          fields(output as unknown as Record<string, unknown>, [
            "status",
            "reason",
          ]);
          cache.set(key, freeze(output));
          return output;
        }
        fields(output as unknown as Record<string, unknown>, ["type", "value"]);
        assert(
          typeof output.type === "string" && output.type.length > 0,
          "Invalid projection type",
        );
        json(output.value);
        const projection: Projection = freeze({
          ...output,
          value: deeplyFrozen(output.value)
            ? output.value
            : retained(output.value),
          document: doc.document,
          item: target.item,
          revision: result.revision.id,
          selector: deeplyFrozen(target.selector)
            ? target.selector
            : retained(target.selector),
          ...(dependencies.size
            ? {
                dependencies: [...dependencies.entries()]
                  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                  .map(([, v]) => v),
              }
            : {}),
        });
        owners.set(projection, result.revision);
        const projected = freeze({ status: "resolved" as const, projection });
        cache.set(key, projected);
        return projected;
      } finally {
        active.delete(key);
      }
    } catch (e) {
      return { status: "corrupt", reason: String(e) };
    }
  }
  return read(ref);
}
/** Capture only the reachable selection. Iterative traversal supports cyclic authored references. */
export function captureContext(
  doc: Document,
  target: Reference,
  schemas: Schemas,
  limit = 100000,
): Context {
  return captureSelection(doc, target, schemas, limit).context;
}

export const contextToPlain = (c: Context): PlainContext => ({
  root: c.root,
  heads: c.heads.toRecord(),
  revisions: [...c.revisions.entries()].map(([id]) => id),
});
export function contextFromPlain(p: PlainContext): Context {
  assert(object(p), "Invalid context");
  fields(p, ["root", "heads", "revisions"]);
  validateReference(p.root);
  assert(
    object(p.heads) && Array.isArray(p.revisions),
    "Invalid frozen selections",
  );
  for (const [k, v] of Object.entries(p.heads)) {
    identity(k);
    if (v !== null) identity(v);
  }
  const seen = new Set<string>();
  for (const id of p.revisions) {
    identity(id);
    assert(!seen.has(id), "Duplicate context revision");
    seen.add(id);
  }
  return Object.freeze({
    root: retained(p.root as unknown as Json) as Reference,
    heads: SharedMap.from(Object.entries(p.heads)),
    revisions: SharedMap.from(p.revisions.map((id) => [id, true] as const)),
  });
}
export function validateContext(doc: Document, c: Context, schemas: Schemas) {
  checkSelection(doc, c, schemas);
}
export function empty(document: string, root = "initial"): Document {
  identity(document);
  identity(root);
  return Object.freeze({
    document,
    id: root,
    sequence: 0,
    evidenceSequence: 0,
    allocated: Object.freeze({
      revisions: SharedMap.empty<true>(),
      views: SharedMap.empty<true>(),
      alternatives: SharedMap.empty<true>(),
      receipts: SharedMap.empty<true>(),
    }),
    items: SharedMap.empty<Item>(),
    known: SharedMap.empty<true>(),
    revisions: SharedMap.empty<Revision>(),
    views: SharedMap.empty<View>(),
    alternatives: SharedMap.empty<Alternative>(),
    dependents: SharedMap.empty<SharedMap<true>>(),
    readOnly: false,
  });
}
export function fromPlain(p: PlainDocument, schemas: Schemas): Document {
  assert(object(p), "Invalid document");
  fields(p, [
    "document",
    "id",
    "sequence",
    "identities",
    "evidenceSequence",
    "items",
    "revisions",
    "views",
    "alternatives",
  ]);
  identity(p.document);
  identity(p.id);
  assert(
    Number.isSafeInteger(p.sequence) && p.sequence >= 0,
    "Invalid document sequence",
  );
  for (const map of [p.items, p.revisions, p.views, p.alternatives])
    assert(object(map), "Invalid document map");
  const clone = retained(p as unknown as Json) as unknown as PlainDocument;
  const ledger = (name: keyof PlainIdentities, fallback: Iterable<string>) => {
    const values = clone.identities?.[name] ?? [...fallback];
    assert(Array.isArray(values), "Invalid identity ledger");
    const seen = new Set<string>();
    for (const value of values) {
      identity(value);
      assert(!seen.has(value), "Duplicate identity ledger entry");
      seen.add(value);
    }
    return SharedMap.from(values.map((value) => [value, true] as const));
  };
  if (p.identities) {
    assert(object(p.identities), "Invalid identity ledgers");
    fields(p.identities, [
      "items",
      "revisions",
      "views",
      "alternatives",
      "receipts",
    ]);
    assert(
      Object.keys(p.identities).length === 5,
      "Incomplete identity ledgers",
    );
  }
  assert(
    p.evidenceSequence === undefined ||
      (Number.isSafeInteger(p.evidenceSequence) && p.evidenceSequence >= 0),
    "Invalid evidence sequence",
  );

  let readOnly = false;
  const revisions = Object.entries(clone.revisions).map(([id, r]) => {
    assert(id === r.id, "Revision key mismatch");
    if (!validateRevision(r, schemas)) readOnly = true;
    return [id, r] as const;
  });
  const items = Object.entries(clone.items).map(([id, i]) => {
    assert(object(i), "Invalid item");
    fields(i, ["id", "label", "revision"]);
    identity(id);
    assert(
      i.id === id &&
        typeof i.label === "string" &&
        (i.revision === null || clone.revisions[i.revision]?.item === id),
      "Invalid selected item",
    );
    return [id, i] as const;
  });
  let doc: Document = Object.freeze({
    ...empty(p.document, p.id),
    sequence: p.sequence,
    items: SharedMap.from(items),
    revisions: SharedMap.from(revisions),
    evidenceSequence: clone.evidenceSequence ?? 0,
    known: ledger(
      "items",
      new Set([
        ...revisions.map(([, r]) => r.item),
        ...items.map(([id]) => id),
      ]),
    ),
    allocated: Object.freeze({
      revisions: ledger(
        "revisions",
        revisions.map(([id]) => id),
      ),
      views: ledger("views", Object.keys(clone.views)),
      alternatives: ledger("alternatives", Object.keys(clone.alternatives)),
      receipts: ledger("receipts", []),
    }),
    views: SharedMap.from(Object.entries(clone.views)),
    alternatives: SharedMap.from(
      Object.entries(clone.alternatives).map(([id, a]) => {
        assert(object(a), "Invalid alternative");
        fields(a, ["id", "label", "context"]);
        identity(id);
        assert(
          id === a.id && typeof a.label === "string",
          "Invalid alternative identity",
        );
        return [
          id,
          Object.freeze({ ...a, context: contextFromPlain(a.context) }),
        ] as const;
      }),
    ),
    readOnly,
  });
  for (const [id, r] of doc.revisions.entries())
    assert(
      doc.allocated.revisions.get(id) && doc.known.get(r.item),
      "Revision missing from identity ledgers",
    );
  for (const [id] of doc.items.entries())
    assert(doc.known.get(id), "Item missing from identity ledger");
  for (const [id] of doc.views.entries())
    assert(doc.allocated.views.get(id), "View missing from identity ledger");
  for (const [id] of doc.alternatives.entries())
    assert(
      doc.allocated.alternatives.get(id),
      "Alternative missing from identity ledger",
    );
  let dependents = doc.dependents;
  for (const [id] of doc.items.entries())
    dependents = reindex(dependents, id, undefined, current(doc, id), schemas);
  doc = Object.freeze({ ...doc, dependents });
  for (const [id, v] of doc.views.entries()) {
    validateView(v);
    assert(
      id === v.id && (!v.alternative || doc.alternatives.get(v.alternative)),
      "Invalid view context",
    );
  }
  for (const [, a] of doc.alternatives.entries())
    validateContext(doc, a.context, schemas);
  return doc;
}
export function toPlain(d: Document): PlainDocument {
  return {
    document: d.document,
    id: d.id,
    sequence: d.sequence,
    evidenceSequence: d.evidenceSequence,
    identities: {
      items: [...d.known.entries()].map(([id]) => id),
      revisions: [...d.allocated.revisions.entries()].map(([id]) => id),
      views: [...d.allocated.views.entries()].map(([id]) => id),
      alternatives: [...d.allocated.alternatives.entries()].map(([id]) => id),
      receipts: [...d.allocated.receipts.entries()].map(([id]) => id),
    },
    items: d.items.toRecord(),
    revisions: d.revisions.toRecord(),
    views: d.views.toRecord(),
    alternatives: Object.fromEntries(
      [...d.alternatives.entries()].map(([id, a]) => [
        id,
        { ...a, context: contextToPlain(a.context) },
      ]),
    ),
  };
}
export const selection = (d: Document) =>
  Object.freeze({
    items: d.items,
    views: d.views,
    alternatives: d.alternatives,
    dependents: d.dependents,
  });
export type Selection = ReturnType<typeof selection>;
export const restore = (d: Document, s: Selection, id: string): Document =>
  Object.freeze({ ...d, ...s, id, sequence: d.sequence + 1 });
function affected(
  doc: Document,
  changed: readonly string[],
  newRevisions: readonly string[],
  work: MapWork,
) {
  const result = new Set(changed),
    queue = [
      ...changed.map((item) =>
        key({
          document: doc.document,
          item,
          selection: { kind: "follow" },
          selector: null,
        }),
      ),
      ...newRevisions.map((id) =>
        JSON.stringify(["revision", doc.document, id]),
      ),
    ];
  for (let n = 0; n < queue.length; n++) {
    const k = queue[n]!;
    for (const [item] of doc.dependents.get(k, work)?.entries() ?? []) {
      if (result.has(item)) continue;
      result.add(item);
      queue.push(JSON.stringify(["item", doc.document, item]));
    }
  }
  return [...result];
}
export function prepare(
  doc: Document,
  id: string,
  commands: readonly Command[],
  schemas: Schemas,
) {
  assert(
    !doc.readOnly,
    "Unknown optional content: preserve original document read-only",
  );
  identity(id);
  assert(Number.isSafeInteger(doc.sequence + 1), "Sequence exhausted");
  const work = mapWork();
  let items = doc.items,
    known = doc.known,
    allocated = doc.allocated,
    revisions = doc.revisions,
    views = doc.views,
    alternatives = doc.alternatives,
    deps = doc.dependents;
  const changed = new Set<string>(),
    presentation = new Set<string>(),
    viewIds = new Set<string>(),
    altIds = new Set<string>(),
    newIds: string[] = [];
  for (const c of commands) {
    if (c.kind === "create" || c.kind === "revise") {
      identity(c.item);
      const old = items.get(c.item, work);
      assert(
        c.kind === "create" ? !known.get(c.item, work) : old?.revision,
        "Missing item or reused lineage",
      );
      assert(c.revision.item === c.item, "Revision lineage mismatch");
      assert(
        !allocated.revisions.get(c.revision.id, work),
        "Revision identity reused",
      );
      const r = retained(c.revision as unknown as Json) as unknown as Revision;
      assert(validateRevision(r, schemas), "Cannot author unsupported content");
      revisions = revisions.set(r.id, r, work);
      allocated = Object.freeze({
        ...allocated,
        revisions: allocated.revisions.set(r.id, true, work),
      });
      known = known.set(c.item, true, work);
      items = items.set(
        c.item,
        freeze({
          id: c.item,
          label: c.kind === "create" ? c.label : old!.label,
          revision: r.id,
        }),
        work,
      );
      assert(typeof items.get(c.item)!.label === "string", "Invalid label");
      changed.add(c.item);
      presentation.add(c.item);
      newIds.push(r.id);
    } else if (c.kind === "restore") {
      identity(c.item);
      identity(c.revision);
      const old = items.get(c.item, work),
        r = revisions.get(c.revision, work);
      assert(
        known.get(c.item, work) && !old?.revision,
        "Restore requires an inactive known item",
      );
      assert(
        r?.item === c.item && allocated.revisions.get(r.id, work),
        "Retained restore revision is unavailable or belongs to another item",
      );
      assert(typeof c.label === "string", "Invalid label");
      items = items.set(
        c.item,
        freeze({ id: c.item, label: c.label, revision: r.id }),
        work,
      );
      changed.add(c.item);
      presentation.add(c.item);
    } else if (c.kind === "delete" || c.kind === "rename") {
      const old = items.get(c.item, work);
      assert(old?.revision, "Missing item");
      if (c.kind === "delete") {
        items = items.set(
          c.item,
          Object.freeze({ ...old, revision: null }),
          work,
        );
        changed.add(c.item);
      } else {
        assert(typeof c.label === "string", "Invalid label");
        items = items.set(
          c.item,
          Object.freeze({ ...old, label: c.label }),
          work,
        );
      }
      presentation.add(c.item);
    } else if (c.kind === "view") {
      const v = retained(c.view as unknown as Json) as unknown as View;
      validateView(v);
      assert(
        views.get(v.id, work) || !allocated.views.get(v.id, work),
        "View identity reused",
      );
      allocated = Object.freeze({
        ...allocated,
        views: allocated.views.set(v.id, true, work),
      });
      views = views.set(v.id, v, work);
      viewIds.add(v.id);
    } else if (c.kind === "removeView") {
      assert(views.get(c.id, work), "Missing view");
      views = views.delete(c.id, work);
      viewIds.add(c.id);
    } else {
      assert(alternatives.get(c.id, work), "Missing alternative");
      alternatives = alternatives.delete(c.id, work);
      altIds.add(c.id);
    }
  }
  for (const item of changed) {
    const before = current(doc, item),
      rid = items.get(item, work)?.revision,
      after = rid ? revisions.get(rid, work) : undefined;
    deps = reindex(deps, item, before, after, schemas, work);
  }
  const next: Document = Object.freeze({
    ...doc,
    id,
    sequence: doc.sequence + 1,
    items,
    known,
    allocated,
    revisions,
    views,
    alternatives,
    dependents: deps,
  });
  for (const v of viewIds) {
    const view = views.get(v);
    assert(
      !view?.alternative || alternatives.get(view.alternative),
      "Missing view alternative",
    );
  }
  if (altIds.size)
    for (const [, v] of views.entries())
      assert(
        !v.alternative || alternatives.get(v.alternative),
        "Remove comparison views in the same operation",
      );
  const impacted = new Set(affected(doc, [...changed], newIds, work));
  if (next.dependents !== doc.dependents)
    for (const item of affected(next, [...changed], newIds, work))
      impacted.add(item);
  return {
    document: next,
    changes: freeze({
      items: [...presentation],
      affected: [...impacted],
      views: [...viewIds],
      alternatives: [...altIds],
    }),
    cost: work,
  };
}
export function keep(
  doc: Document,
  id: string,
  alternative: Alternative,
  view: View,
  preview: Document,
  schemas: Schemas,
) {
  assert(
    !doc.readOnly && !doc.allocated.alternatives.get(alternative.id),
    "Alternative identity reused or read-only",
  );
  identity(alternative.id);
  assert(!doc.allocated.views.get(view.id), "Comparison view identity reused");
  assert(
    typeof alternative.label === "string" &&
      view.alternative === alternative.id,
    "Invalid comparison",
  );
  let revisions = doc.revisions,
    known = doc.known,
    allocated = doc.allocated;
  const work = mapWork();
  for (const [rid] of alternative.context.revisions.entries()) {
    const r = preview.revisions.get(rid);
    assert(r, "Missing preview record");
    const prior = revisions.get(rid, work);
    assert(!prior || prior === r, "Conflicting immutable revision");
    if (!prior) {
      assert(
        !allocated.revisions.get(rid, work),
        "Retired revision identity reused",
      );
      allocated = Object.freeze({
        ...allocated,
        revisions: allocated.revisions.set(rid, true, work),
      });
      revisions = revisions.set(rid, r, work);
      known = known.set(r.item, true, work);
    }
  }
  const staged = Object.freeze({ ...doc, revisions, known, allocated });
  validateContext(staged, alternative.context, schemas);
  validateView(view);
  assert(
    view.reference.document === alternative.context.root.document &&
      view.reference.item === alternative.context.root.item,
    "Comparison target differs from frozen root",
  );
  const b = prepare(staged, id, [], schemas);
  return {
    document: Object.freeze({
      ...b.document,
      allocated: Object.freeze({
        ...allocated,
        views: allocated.views.set(view.id, true, work),
        alternatives: allocated.alternatives.set(alternative.id, true, work),
      }),
      alternatives: doc.alternatives.set(
        alternative.id,
        Object.freeze({ ...alternative }),
        work,
      ),
      views: doc.views.set(
        view.id,
        retained(view as unknown as Json) as unknown as View,
        work,
      ),
    }),
    changes: freeze({
      items: [],
      affected: [],
      views: [view.id],
      alternatives: [alternative.id],
    }),
    cost: work,
  };
}
