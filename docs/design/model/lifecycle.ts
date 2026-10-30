/** Executable design fixture; intentionally not a production parser, store or validator. */
import type {
  AcceptedWorkspace,
  Archive,
  ContextId,
  ContextRevision,
  ContextRevisionId,
  DefinitionBody,
  DefinitionId,
  DefinitionRevision,
  Id,
  NumericType,
  NumericValue,
  RecordStore,
  SemanticSnapshot,
  SourceRevision,
  ValueTarget,
} from "./contracts.ts";

// Human-readable fixture identifiers, not the production ID allocator.
const id = <K extends string>(value: string): Id<K> => value as Id<K>;
const document = id<"document">("spring-document");
const scope = id<"scope">("root");
const original = id<"context">("original");
const alternative = id<"context">("alternative");
const k = id<"definition">("stiffness");
const x = id<"definition">("displacement");
const force = id<"definition">("force");
const formula = id<"definition">("force-expression");
const note = id<"definition">("assumption-note");
const source = id<"source">("measurements");
const blob = id<"blob">("csv-v1");
const view = id<"view">("force-view");
const types = {
  k: {
    shape: [],
    unit: { registry: "fixture-units", revision: "1", unit: "N/mm" },
    space: "linear",
  },
  x: {
    shape: [],
    unit: { registry: "fixture-units", revision: "1", unit: "mm" },
    space: "linear",
  },
  force: {
    shape: [],
    unit: { registry: "fixture-units", revision: "1", unit: "N" },
    space: "linear",
  },
} as const satisfies Record<string, NumericType>;
const scalar = (value: number, type: NumericType): NumericValue => ({
  kind: "numeric",
  type,
  data: { kind: "scalar", value },
});
const quantity = (quantity: DefinitionId): ValueTarget => ({
  kind: "quantity",
  quantity,
});
const output: ValueTarget = {
  kind: "output",
  computation: formula,
  slot: "value",
};
const revision = (
  name: string,
  definition: DefinitionId,
  body: DefinitionBody,
): DefinitionRevision => ({
  id: id<"revision">(name),
  definition,
  scope,
  body,
});
const formulaBody = (double = false): DefinitionBody => ({
  kind: "computation",
  label: "Force law",
  outputs: [{ slot: "value", type: types.force }],
  method: {
    kind: "expression",
    expression: {
      language: { id: "fixture-product", version: "1" },
      text: double ? "2 * k * x" : "k * x",
      syntax: "complete",
      references: [
        {
          id: "k-occurrence",
          span: double ? [4, 5] : [0, 1],
          spelling: "k",
          resolution: { kind: "bound", target: quantity(k) },
        },
        {
          id: "x-occurrence",
          span: double ? [8, 9] : [4, 5],
          spelling: "x",
          resolution: { kind: "bound", target: quantity(x) },
        },
      ],
    },
  },
});
const definitions = [
  revision("k-literal", k, {
    kind: "quantity",
    symbol: "k",
    description: "Spring stiffness",
    type: types.k,
    provider: { kind: "literal", value: scalar(10, types.k) },
  }),
  revision("x-1", x, {
    kind: "quantity",
    symbol: "x",
    description: "Displacement",
    type: types.x,
    provider: { kind: "literal", value: scalar(1, types.x) },
  }),
  revision("F", force, {
    kind: "quantity",
    symbol: "F",
    description: "Spring force",
    type: types.force,
    provider: { kind: "computed", output },
  }),
  revision("law-1", formula, formulaBody()),
  revision("note-1", note, {
    kind: "note",
    text: "Linear spring assumption",
    format: "plain",
  }),
];
const snapshot: SemanticSnapshot = {
  id: id<"snapshot">("snapshot-authored"),
  document,
  definitions: Object.fromEntries(definitions.map((r) => [r.definition, r.id])),
  sources: {},
  scopes: { [scope]: {} },
};
const context: ContextRevision = {
  id: id<"context-revision">("original-authored"),
  context: original,
  snapshot: snapshot.id,
};
const store: RecordStore = {
  definitions: Object.fromEntries(definitions.map((r) => [r.id, r])),
  sources: {},
  snapshots: { [snapshot.id]: snapshot },
  contexts: { [context.id]: context },
};
const workspace: AcceptedWorkspace = {
  format: "manifold-model-proposal",
  version: 1,
  document,
  sequence: 0,
  contexts: { [original]: { label: "Original", head: context.id } },
  views: {
    [view]: {
      id: view,
      target: force,
      context: { kind: "follow", context: original },
      renderer: { id: "equation", version: "1" },
      settings: {},
      placement: { x: 0, y: 0, width: 300, height: 100 },
    },
  },
  comparisons: [],
};
const initial: Archive = { workspace, records: store, receipts: [], blobs: [] };
export const fixtureIds = {
  original,
  alternative,
  k,
  x,
  force,
  formula,
  note,
  source,
  view,
};
export const authored = initial;

export function head(
  archive: Archive,
  contextId: ContextId,
): ContextRevisionId {
  const entry = archive.workspace.contexts[contextId];
  if (!entry) throw Error("Missing context");
  return entry.head;
}
export function selected(
  archive: Archive,
  contextRevision: ContextRevisionId,
): SemanticSnapshot {
  const context = archive.records.contexts[contextRevision];
  const snapshot = context && archive.records.snapshots[context.snapshot];
  if (!snapshot) throw Error("Missing snapshot");
  return snapshot;
}
export function definition(
  archive: Archive,
  contextRevision: ContextRevisionId,
  target: DefinitionId,
): DefinitionRevision {
  const rev = selected(archive, contextRevision).definitions[target];
  const record = rev && archive.records.definitions[rev];
  if (!record || record.definition !== target)
    throw Error("Missing or mismatched definition");
  return record;
}

/** Build one full logical selection. Plain object copies here are deliberately O(N). */
export function revise(
  archive: Archive,
  contextId: ContextId,
  tag: string,
  replacements: readonly DefinitionRevision[],
  imported?: SourceRevision,
  from = head(archive, contextId),
): Archive {
  for (const replacement of replacements) {
    const existing = archive.records.definitions[replacement.id];
    if (existing && JSON.stringify(existing) !== JSON.stringify(replacement))
      throw Error("Immutable revision collision");
  }
  if (imported) {
    const existing = archive.records.sources[imported.id];
    if (existing && JSON.stringify(existing) !== JSON.stringify(imported))
      throw Error("Immutable source revision collision");
  }
  const previous = selected(archive, from);
  const previousHead = archive.workspace.contexts[contextId]?.head;
  const baseRevision = archive.records.contexts[from];
  const basedOn =
    baseRevision?.context !== contextId ? from : baseRevision.basedOn;
  const snapshotId = id<"snapshot">(`snapshot-${tag}`);
  const contextRevisionId = id<"context-revision">(`context-${tag}`);
  if (
    archive.records.snapshots[snapshotId] ||
    archive.records.contexts[contextRevisionId]
  )
    throw Error("Snapshot identity collision");
  const nextSnapshot: SemanticSnapshot = {
    ...previous,
    id: snapshotId,
    definitions: {
      ...previous.definitions,
      ...Object.fromEntries(replacements.map((r) => [r.definition, r.id])),
    },
    sources: imported
      ? { ...previous.sources, [imported.source]: imported.id }
      : previous.sources,
  };
  return {
    ...archive,
    workspace: {
      ...archive.workspace,
      sequence: archive.workspace.sequence + 1,
      contexts: {
        ...archive.workspace.contexts,
        [contextId]: { label: String(contextId), head: contextRevisionId },
      },
    },
    records: {
      definitions: {
        ...archive.records.definitions,
        ...Object.fromEntries(replacements.map((r) => [r.id, r])),
      },
      sources: imported
        ? { ...archive.records.sources, [imported.id]: imported }
        : archive.records.sources,
      snapshots: { ...archive.records.snapshots, [snapshotId]: nextSnapshot },
      contexts: {
        ...archive.records.contexts,
        [contextRevisionId]: {
          id: contextRevisionId,
          context: contextId,
          snapshot: snapshotId,
          ...(previousHead ? { previous: previousHead } : {}),
          ...(basedOn ? { basedOn } : {}),
        },
      },
    },
  };
}
const measured = revision("k-measured", k, {
  kind: "quantity",
  symbol: "k",
  description: "Spring stiffness",
  type: types.k,
  provider: {
    kind: "measurement",
    read: {
      source,
      selector: { kind: "cell", row: 0, column: 0 },
      interpretedAs: types.k,
      decoder: { id: "fixture-csv", version: "1" },
    },
  },
});
const csv: SourceRevision = {
  id: id<"revision">("source-v1"),
  source,
  mediaType: "text/csv",
  byteLength: 5,
  digest:
    "sha256:681cb1cdd5a7b2ca40c2ff2c935debcf38c2501ab76ee43048a731ea3eb66396",
  content: { kind: "embedded", blob },
  derivedFrom: [],
};
export const connected: Archive = {
  ...revise(initial, original, "connected", [measured], csv),
  blobs: [
    {
      id: blob,
      digest: csv.digest,
      byteLength: 5,
      content: { kind: "inline", encoding: "utf8", data: "k\n10\n" },
    },
  ],
};
export const displacement2 = revision("x-2", x, {
  kind: "quantity",
  symbol: "x",
  description: "Displacement",
  type: types.x,
  provider: { kind: "literal", value: scalar(2, types.x) },
});
export const doubledLaw = revision("law-2", formula, formulaBody(true));

/** Tiny fixture interpreter: only two declared formulae and linear scalar units. */
export function evaluate(
  archive: Archive,
  contextRevision: ContextRevisionId,
  target = force,
): number {
  const visiting = new Set<DefinitionId>();
  const read = (target: ValueTarget): number => {
    if (target.kind === "port")
      throw Error("Ports are outside fixture interpreter");
    const id =
      target.kind === "quantity" ? target.quantity : target.computation;
    if (visiting.has(id)) throw Error("Cycle");
    visiting.add(id);
    try {
      const body = definition(archive, contextRevision, id).body;
      if (target.kind === "quantity" && body.kind === "quantity") {
        const provider = body.provider;
        if (
          provider.kind === "literal" &&
          provider.value.data.kind === "scalar"
        )
          return provider.value.data.value;
        if (provider.kind === "computed") return read(provider.output);
        if (provider.kind === "measurement") {
          const revision = selected(archive, contextRevision).sources[
            provider.read.source
          ];
          const source = revision && archive.records.sources[revision];
          if (!source || source.content.kind !== "embedded")
            throw Error("Unavailable source");
          const blobId = source.content.blob;
          const blob = archive.blobs.find((b) => b.id === blobId);
          if (
            !blob ||
            blob.content.kind !== "inline" ||
            blob.content.encoding !== "utf8"
          )
            throw Error("Unavailable bytes");
          const raw = blob.content.data
            .trim()
            .split("\n")
            [provider.read.selector.row + 1]?.split(",")[
            provider.read.selector.column
          ];
          if (raw === undefined || !raw.trim() || !Number.isFinite(Number(raw)))
            throw Error("Invalid cell");
          return Number(raw);
        }
        throw Error("Unassigned or unsupported input");
      }
      if (
        target.kind === "output" &&
        body.kind === "computation" &&
        body.method.kind === "expression"
      ) {
        if (!body.outputs.some((o) => o.slot === target.slot))
          throw Error("Missing output");
        const expression = body.method.expression;
        if (expression.syntax !== "complete")
          throw Error("Incomplete expression");
        const values = expression.references.map((r) => {
          if (expression.text.slice(...r.span) !== r.spelling)
            throw Error("Invalid occurrence span");
          if (r.resolution.kind !== "bound")
            throw Error("Unresolved reference");
          return read(r.resolution.target);
        });
        if (values.length !== 2) throw Error("Unsupported fixture arity");
        if (expression.text === "k * x") return values[0]! * values[1]!;
        if (expression.text === "2 * k * x") return 2 * values[0]! * values[1]!;
      }
      throw Error("Unsupported fixture computation");
    } finally {
      visiting.delete(id);
    }
  };
  return read(quantity(target));
}

/** Semantic dependency descriptor only; production canonicalization needs a versioned hash. */
export function dependencyKey(
  archive: Archive,
  contextRevision: ContextRevisionId,
  target = force,
): string {
  const snapshot = selected(archive, contextRevision);
  // This fixture knows its exact closure. Production must traverse typed dependencies.
  const definitions = [k, x, force, formula].map((id) => [
    id,
    snapshot.definitions[id],
  ]);
  return JSON.stringify({
    definitions,
    source: snapshot.sources[source],
    target,
    method: "fixture-product/1",
    runtime: "fixture/1",
  });
}
