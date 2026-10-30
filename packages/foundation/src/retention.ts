/** Reachability analysis is explicit maintenance work, never a per-keystroke global scan. */
import { assert, canonical, freeze, type Json } from "./value.ts";
import { SharedMap } from "./shared-map.ts";
import { request, validateAsset, validateReference } from "./content.ts";
import {
  resolve,
  type Document,
  type Context,
  type Selection,
  type ResolutionSource,
} from "./document.ts";
import {
  isScalarReceipt,
  receiptAssets,
  type Receipt,
  type Snapshot,
} from "./execution.ts";
import type { Schemas, Reference, Revision, Asset } from "./contracts.ts";
export type RetentionPolicy = Readonly<{
  evidence: "all" | "latest-per-input" | "reachable";
  keepReceipts?: readonly string[];
  /** Application-owned evidence may retain exact local content without becoming authored state. */
  keepReferences?: readonly Reference[];
}>;
export type ProtectedContext = Readonly<{
  document: ResolutionSource;
  context: Context;
}>;
export type RetentionCounts = Readonly<{
  revisions: number;
  receipts: number;
  includedAssets: number;
  includedBytes: number;
}>;
export type Compaction = Readonly<{
  document: Document;
  receipts: SharedMap<Receipt>;
  assets: readonly Asset[];
  before: RetentionCounts;
  after: RetentionCounts;
  removedRevisions: readonly string[];
  removedReceipts: readonly string[];
}>;
function fingerprint(s: Snapshot) {
  return canonical({
    method: s.method,
    output: s.output,
    subject: s.subject,
    frame: s.frame,
    condition: s.condition,
    inputs: Object.fromEntries(
      Object.entries(s.inputs).map(([slot, i]) => [slot, i.origin]),
    ),
  } as unknown as Json);
}
export function compact(
  doc: Document,
  receipts: SharedMap<Receipt>,
  schemas: Schemas,
  policy: RetentionPolicy,
  history: readonly Selection[] = [],
  active: readonly ProtectedContext[] = [],
): Compaction {
  assert(!doc.readOnly, "Cannot compact an opaque/read-only package");
  assert(
    ["all", "latest-per-input", "reachable"].includes(policy.evidence),
    "Unknown retention policy",
  );
  const keepRevisions = new Set<string>(),
    keepReceipts = new Set<string>(),
    workingFingerprints = new Set<string>(),
    conservativeRequests = new Map<
      string,
      { source: ResolutionSource; context?: Context }[]
    >(),
    extraRecords = new Map<string, Revision>(),
    contextQueue: ProtectedContext[] = [],
    receiptQueue: string[] = [],
    visitedContexts = new Set<Context>();
  const latest = new Map<string, Receipt>();
  for (const [, r] of receipts.entries()) {
    const old = latest.get(r.key);
    if (!old || r.order > old.order) latest.set(r.key, r);
  }
  function receipt(id: string) {
    assert(
      receipts.get(id),
      "Referenced or explicitly retained receipt is unavailable: " + id,
    );
    if (!keepReceipts.has(id)) {
      keepReceipts.add(id);
      receiptQueue.push(id);
    }
  }
  function inspect(
    r: Revision,
    source: ResolutionSource,
    context?: Context,
    working = false,
  ) {
    const schema = schemas.get(r.schema);
    assert(schema, "Cannot trace unsupported content during compaction");
    if (doc.revisions.get(r.id)) {
      assert(doc.revisions.get(r.id) === r, "Conflicting protected revision");
      keepRevisions.add(r.id);
    } else extraRecords.set(r.id, r);
    for (const id of schema.evidence?.(r.body) ?? []) receipt(id);
    if (working) {
      if (r.schema !== "request@1") {
        const selections = conservativeRequests.get(r.id) ?? [];
        selections.push(context ? { source, context } : { source });
        conservativeRequests.set(r.id, selections);
      } else {
        request(r.body);
        const inputs: Record<string, Json> = Object.create(null);
        let complete = true;
        for (const [slot, ref] of Object.entries(r.body.inputs)) {
          const got = resolve(source, ref, context);
          if (got.status !== "resolved") {
            complete = false;
            break;
          }
          inputs[slot] = {
            document: ref.document,
            item: ref.item,
            revision: got.revision.id,
            selector: ref.selector,
          };
        }
        if (complete)
          workingFingerprints.add(
            canonical({
              method: r.body.method,
              output: r.body.output,
              subject: r.body.subject,
              frame: r.body.frame,
              condition: r.body.condition,
              inputs,
            } as Json),
          );
      }
    }
    return schema.references(r.body);
  }
  function context(root: ProtectedContext, working: boolean) {
    assert(
      root.document.document === doc.document,
      "Protected context belongs to another document",
    );
    // A context's revision whitelist is already a complete closed selection. Never use live heads as fallback.
    for (const [rid] of root.context.revisions.entries()) {
      const r = root.document.revisions.get(rid);
      assert(r, "Protected context revision unavailable");
      inspect(r, root.document, root.context, working);
    }
  }
  for (const selection of [undefined, ...history]) {
    const source = selection ? Object.freeze({ ...doc, ...selection }) : doc,
      visited = new Set<string>(),
      queue: Reference[] = [];
    for (const [, item] of source.items.entries())
      if (item.revision)
        queue.push({
          document: doc.document,
          item: item.id,
          selection: { kind: "pin", revision: item.revision },
          selector: null,
        });
    for (const [, view] of source.views.entries()) {
      if (view.alternative) {
        const a = source.alternatives.get(view.alternative);
        assert(a, "Missing comparison context");
        context({ document: doc, context: a.context }, true);
      } else queue.push(view.reference);
    }
    for (const [, a] of source.alternatives.entries())
      context({ document: doc, context: a.context }, true);
    let steps = 0;
    while (queue.length) {
      assert(++steps <= 1000000, "Retention traversal budget exceeded");
      const ref = queue.pop()!,
        got = resolve(source, ref);
      if (got.status !== "resolved" || visited.has(got.revision.id)) continue;
      visited.add(got.revision.id);
      for (const dependency of inspect(got.revision, source, undefined, true))
        queue.push(dependency);
    }
  }
  const pinnedQueue = [...(policy.keepReferences ?? [])],
    pinnedVisited = new Set<string>();
  for (const ref of pinnedQueue) {
    validateReference(ref);
    assert(
      ref.document === doc.document && ref.selection.kind === "pin",
      "Retained evidence requires a local pinned reference",
    );
    assert(
      resolve(doc, ref).status === "resolved",
      "Retained evidence revision is unavailable",
    );
  }
  for (let at = 0; at < pinnedQueue.length; at++) {
    assert(at < 1000000, "Retention traversal budget exceeded");
    const got = resolve(doc, pinnedQueue[at]!);
    if (got.status !== "resolved" || pinnedVisited.has(got.revision.id))
      continue;
    pinnedVisited.add(got.revision.id);
    pinnedQueue.push(...inspect(got.revision, doc));
  }
  for (const root of active) context(root, true);
  if (policy.evidence === "all")
    for (const [id] of receipts.entries()) receipt(id);
  else
    for (const r of latest.values())
      if (
        policy.evidence === "latest-per-input" ||
        (isScalarReceipt(r)
          ? workingFingerprints.has(fingerprint(r.snapshot)) ||
            conservativeRequests.has(r.requestRevision)
          : conservativeRequests
              .get(r.requestRevision)
              ?.some(({ source, context }) =>
                [...r.context.heads.entries()].every(
                  ([item, revision]) =>
                    revision ===
                    (context
                      ? context.heads.get(item)
                      : (source.items?.get(item)?.revision ?? null)),
                ),
              ))
      )
        receipt(r.id);
  for (const id of policy.keepReceipts ?? []) receipt(id);
  for (let n = 0; n < receiptQueue.length; n++) {
    const r = receipts.get(receiptQueue[n]!)!;
    contextQueue.push({ document: doc, context: r.context });
    while (contextQueue.length) {
      const c = contextQueue.pop()!;
      if (visitedContexts.has(c.context)) continue;
      visitedContexts.add(c.context);
      context(c, false);
    }
  }
  const removedRevisions = [...doc.revisions.entries()]
      .map(([id]) => id)
      .filter((id) => !keepRevisions.has(id)),
    removedReceipts = [...receipts.entries()]
      .map(([id]) => id)
      .filter((id) => !keepReceipts.has(id));
  const revisions = SharedMap.from(
      [...doc.revisions.entries()].filter(([id]) => keepRevisions.has(id)),
    ),
    retained = SharedMap.from(
      [...receipts.entries()].filter(([id]) => keepReceipts.has(id)),
    );
  function assetList(
    records: Iterable<Revision>,
    evidence: SharedMap<Receipt>,
  ) {
    const result = new Map<string, Asset>();
    const declared = [...records].flatMap(
      (r) => schemas.get(r.schema)?.assets(r.body) ?? [],
    );
    for (const [, receipt] of evidence.entries())
      declared.push(...receiptAssets(receipt));
    for (const a of declared) {
      validateAsset(a);
      const old = result.get(a.digest);
      assert(
        !old || old.size === a.size,
        "Conflicting retained asset declarations",
      );
      if (!old || a.disposition === "included") result.set(a.digest, a);
    }
    return [...result.values()];
  }
  const beforeAssets = assetList(
      [...doc.revisions.entries()]
        .map(([, r]) => r)
        .concat([...extraRecords.values()]),
      receipts,
    ),
    afterAssets = assetList(
      [...revisions.entries()]
        .map(([, r]) => r)
        .concat([...extraRecords.values()]),
      retained,
    );
  const counts = (
    revisions: number,
    receipts: number,
    assets: readonly Asset[],
  ): RetentionCounts => ({
    revisions,
    receipts,
    includedAssets: assets.filter((a) => a.disposition === "included").length,
    includedBytes: assets.reduce(
      (n, a) => n + (a.disposition === "included" ? a.size : 0),
      0,
    ),
  });
  return Object.freeze({
    document: Object.freeze({ ...doc, revisions }),
    receipts: retained,
    assets: freeze(afterAssets),
    before: freeze(counts(doc.revisions.size, receipts.size, beforeAssets)),
    after: freeze(counts(revisions.size, retained.size, afterAssets)),
    removedRevisions: Object.freeze(removedRevisions),
    removedReceipts: Object.freeze(removedReceipts),
  });
}
