import {
  assert,
  object,
  fields,
  freeze,
  canonical,
  identity,
  json,
  type Json,
} from "./value.ts";
import type { Schemas, Methods, Asset, Resources } from "./contracts.ts";
import { validateAsset } from "./content.ts";
import {
  toPlain,
  fromPlain,
  contextToPlain,
  contextFromPlain,
  type Document,
  type PlainDocument,
  type PlainContext,
} from "./document.ts";
import {
  validateReceipt,
  snapshotKey,
  isTypedSnapshot,
  receiptAssets,
  type Receipt,
  type ExecutionSnapshot,
} from "./execution.ts";
import { SharedMap } from "./shared-map.ts";
import { MemoryResources, byteLength, type Hash } from "./resources.ts";
import type { Loaded } from "./runtime.ts";
/** These are package-local references, never domain identities or physical map nodes. */
type Plain<R extends Receipt> = R extends Receipt
  ? Omit<R, "context" | "snapshot" | "key"> &
      Readonly<{ context: string; snapshot: string }>
  : never;
export type PlainReceipt = Plain<Receipt>;
export type Envelope = Readonly<{
  format: "manifold-foundation";
  version: 2 | 3 | 4;
  document: PlainDocument;
  contexts: Readonly<Record<string, PlainContext>>;
  snapshots: Readonly<Record<string, ExecutionSnapshot>>;
  receipts: readonly PlainReceipt[];
  assets: Readonly<Record<string, string>>;
}>;
export function assets(
  doc: Document,
  schemas: Schemas,
  receipts: Iterable<Receipt> = [],
): ReadonlyMap<string, Asset> {
  const out = new Map<string, Asset>();
  const declared = [...doc.revisions.entries()].flatMap(
    ([, r]) => schemas.get(r.schema)?.assets(r.body) ?? [],
  );
  for (const receipt of receipts) declared.push(...receiptAssets(receipt));
  for (const a of declared) {
    validateAsset(a);
    const old = out.get(a.digest);
    assert(!old || old.size === a.size, "Conflicting asset declarations");
    if (!old || a.disposition === "included") out.set(a.digest, a);
  }
  return out;
}
export function encode(
  doc: Document,
  receipts: Iterable<Receipt>,
  resources: Resources,
  schemas: Schemas,
  original?: string,
): string {
  if (doc.readOnly) {
    assert(original, "Preserve the original unsupported document");
    return original;
  }
  return JSON.stringify(encodeEnvelope(doc, receipts, resources, schemas));
}
/** Build a writable native envelope without serializing it. Unsupported data uses encode's original-text path. */
export function encodeEnvelope(
  doc: Document,
  receipts: Iterable<Receipt>,
  resources: Resources,
  schemas: Schemas,
): Envelope {
  assert(!doc.readOnly, "Preserve the original unsupported document");
  const retained = [...receipts];
  const included: Record<string, string> = Object.create(null);
  for (const a of assets(doc, schemas, retained).values())
    if (a.disposition === "included") {
      const read = resources.read(a);
      assert(
        read.status === "ready",
        "Cannot save missing/unverified included source bytes",
      );
      included[a.digest] = read.data;
    }
  const contexts: Record<string, PlainContext> = Object.create(null),
    snapshots: Record<string, ExecutionSnapshot> = Object.create(null),
    contextKeys = new Map<string, string>(),
    snapshotKeys = new Map<string, string>();
  const records = retained
    .sort((a, b) => a.order - b.order)
    .map((r) => {
      const c = contextToPlain(r.context),
        ck = canonical(c as unknown as Json);
      let cid = contextKeys.get(ck);
      if (!cid) {
        cid = "c" + contextKeys.size;
        contextKeys.set(ck, cid);
        contexts[cid] = c;
      }
      let sid = snapshotKeys.get(r.key);
      if (!sid) {
        sid = "s" + snapshotKeys.size;
        snapshotKeys.set(r.key, sid);
        snapshots[sid] = r.snapshot;
      }
      const { key: _, context: __, snapshot: ___, ...metadata } = r;
      return { ...metadata, context: cid, snapshot: sid };
    });
  const plain = toPlain(doc);
  const envelope: Envelope = {
    format: "manifold-foundation",
    version: Object.values(snapshots).some(isTypedSnapshot)
      ? 4
      : Object.values(snapshots).some(
            (snapshot) =>
              !isTypedSnapshot(snapshot) &&
              Object.values(snapshot.inputs).some(
                (input) => input.dependencies !== undefined,
              ),
          )
        ? 3
        : 2,
    document: {
      ...plain,
      evidenceSequence: records.reduce(
        (n, r) => Math.max(n, r.order),
        doc.evidenceSequence,
      ),
      identities: {
        ...plain.identities!,
        receipts: [
          ...new Set(
            [...doc.allocated.receipts.entries()]
              .map(([id]) => id)
              .concat(records.map((r) => r.id)),
          ),
        ].sort(),
      },
    },
    contexts,
    snapshots,
    receipts: records,
    assets: included,
  };
  return envelope;
}
export type DecodeLimits = Readonly<{
  maxBytes?: number;
  /** Total records across all native tables (identity ledgers are bounded separately). */
  maxRecords?: number;
  maxReceipts?: number;
  maxNodes?: number;
}>;
export async function decode(
  text: string,
  schemas: Schemas,
  methods: Methods,
  hash: Hash,
  limits: DecodeLimits = {},
): Promise<Loaded> {
  assert(
    byteLength(text) <= (limits.maxBytes ?? 64 * 1024 * 1024),
    "Native document byte budget exceeded",
  );
  return readEnvelope(JSON.parse(text), schemas, methods, hash, limits, text);
}
/** Validate an already parsed envelope. The host must bound transport bytes before parsing.
 * Caller-owned objects are copied before asynchronous verification; only decode(text) preserves exact original text.
 */
export async function decodeEnvelope(
  e: unknown,
  schemas: Schemas,
  methods: Methods,
  hash: Hash,
  limits: DecodeLimits = {},
): Promise<Loaded> {
  return readEnvelope(e, schemas, methods, hash, limits, undefined, true);
}
async function readEnvelope(
  e: unknown,
  schemas: Schemas,
  methods: Methods,
  hash: Hash,
  limits: DecodeLimits,
  original?: string,
  copy = false,
): Promise<Loaded> {
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024,
    maxRecords = limits.maxRecords ?? 100000,
    maxReceipts = limits.maxReceipts ?? 100000,
    maxNodes = limits.maxNodes ?? 1000000;
  for (const limit of [maxBytes, maxRecords, maxReceipts, maxNodes])
    assert(
      Number.isSafeInteger(limit) && limit >= 0,
      "Invalid native read limit",
    );
  // Check depth, node count and JSON safety before structuredClone or recursive freezing.
  json(e, "$", new Set(), { remainingNodes: maxNodes });
  if (copy) e = structuredClone(e);
  assert(object(e), "Invalid native document");
  fields(e, [
    "format",
    "version",
    "document",
    "contexts",
    "snapshots",
    "receipts",
    "assets",
  ]);
  assert(
    e.format === "manifold-foundation" &&
      typeof e.version === "number" &&
      [1, 2, 3, 4].includes(e.version) &&
      object(e.document) &&
      Array.isArray(e.receipts) &&
      object(e.assets) &&
      object(e.contexts) &&
      object(e.snapshots),
    "Unsupported native document contract",
  );
  const tables = [
    e.document.items,
    e.document.revisions,
    e.document.views,
    e.document.alternatives,
    e.contexts,
    e.snapshots,
    e.assets,
  ];
  let records = e.receipts.length;
  for (const table of tables) {
    assert(object(table), "Invalid native record table");
    records += Object.keys(table).length;
    assert(records <= maxRecords, "Native record budget exceeded");
  }
  assert(e.receipts.length <= maxReceipts, "Native receipt budget exceeded");
  if (e.version !== 1) {
    assert(
      object(e.document.identities) &&
        Number.isSafeInteger(e.document.evidenceSequence),
      "Missing v2 lifecycle metadata",
    );
    for (const ids of Object.values(e.document.identities))
      assert(
        Array.isArray(ids) && ids.length <= maxRecords,
        "Identity ledger budget exceeded",
      );
  } else
    assert(
      e.document.identities === undefined &&
        e.document.evidenceSequence === undefined,
      "Unexpected v1 lifecycle metadata",
    );
  const doc = fromPlain(e.document as unknown as PlainDocument, schemas),
    resources = await MemoryResources.verify(
      Object.entries(e.assets) as [string, string][],
      hash,
      maxBytes,
    );
  for (const a of assets(doc, schemas).values())
    if (a.disposition === "included")
      assert(
        resources.read(a).status === "ready",
        "Missing/corrupt included asset",
      );
  if (doc.readOnly)
    return Object.freeze({
      document: doc,
      receipts: Object.freeze([]),
      resources,
      original: original ?? JSON.stringify(e),
    });
  const contexts = new Map(
      Object.entries(e.contexts).map(([id, c]) => {
        identity(id);
        return [id, contextFromPlain(c as PlainContext)] as const;
      }),
    ),
    snapshots = new Map(
      Object.entries(e.snapshots).map(([id, s]) => {
        identity(id);
        assert(object(s), "Invalid input snapshot");
        return [id, freeze(structuredClone(s)) as ExecutionSnapshot] as const;
      }),
    );
  const ids = new Set<string>(),
    orders = new Set<number>(),
    usedContexts = new Set<string>(),
    usedSnapshots = new Set<string>();
  const receipts = (e.receipts as unknown as PlainReceipt[]).map((p) => {
    assert(object(p), "Invalid receipt");
    fields(p, [
      "id",
      "order",
      "context",
      "snapshot",
      "requestRevision",
      "outcome",
      "physicalValidity",
      "kind",
      "time",
    ]);
    const context = contexts.get(p.context),
      snapshot = snapshots.get(p.snapshot);
    assert(context && snapshot, "Receipt selection/snapshot is absent");
    assert(
      e.version === 4 ||
        (!isTypedSnapshot(snapshot) &&
          (e.version === 3 ||
            !Object.values(snapshot.inputs).some(
              (input) => input.dependencies !== undefined,
            ))),
      "Typed evidence requires native v4; projection provenance requires v3",
    );
    const r: Receipt = Object.freeze({
      ...p,
      context,
      snapshot,
      key: snapshotKey(snapshot),
      outcome: freeze(structuredClone(p.outcome)),
    }) as Receipt;
    assert(
      !ids.has(r.id) && !orders.has(r.order),
      "Duplicate receipt identity/order",
    );
    validateReceipt(doc, r, schemas, methods, resources);
    if (e.version !== 1)
      assert(
        doc.allocated.receipts.get(r.id) && r.order <= doc.evidenceSequence,
        "Receipt missing from lifecycle metadata",
      );
    ids.add(r.id);
    orders.add(r.order);
    usedContexts.add(p.context);
    usedSnapshots.add(p.snapshot);
    return r;
  });
  const declaredAssets = assets(doc, schemas, receipts);
  assert(
    Object.keys(e.assets).every((digest) => declaredAssets.has(digest)),
    "Unreferenced package asset",
  );
  for (const asset of declaredAssets.values())
    if (asset.disposition === "included")
      assert(
        resources.read(asset).status === "ready",
        "Missing/corrupt included execution asset",
      );
  for (const [, r] of doc.revisions.entries())
    for (const rid of schemas.get(r.schema)?.evidence?.(r.body) ?? [])
      assert(ids.has(rid), "Cited receipt missing from package");
  assert(
    usedContexts.size === contexts.size &&
      usedSnapshots.size === snapshots.size,
    "Unreferenced package metadata",
  );
  return Object.freeze({
    document:
      e.version === 1
        ? Object.freeze({
            ...doc,
            evidenceSequence: receipts.reduce(
              (n, r) => Math.max(n, r.order),
              0,
            ),
            allocated: Object.freeze({
              ...doc.allocated,
              receipts: SharedMap.from(
                receipts.map((r) => [r.id, true] as const),
              ),
            }),
          })
        : doc,
    receipts: Object.freeze(receipts),
    resources,
    ...(original === undefined ? {} : { original }),
  });
}
export const receiptData = (r: Receipt) =>
  ({ ...r, context: contextToPlain(r.context) }) as unknown as Json;
