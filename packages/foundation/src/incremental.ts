/** Incremental local snapshots. This encoding is private to storage, never a native file. */
import { assert, fields, object, type Json } from "./value.ts";
import { SharedMap } from "./shared-map.ts";
import {
  recordWriter,
  recordReader,
  type RecordMemo as Memo,
} from "./record-graph.ts";
import { contextToPlain, type Context, type Alternative } from "./document.ts";
import type { Revision, Schemas, Methods, Asset } from "./contracts.ts";
import { receiptAssets, type Receipt } from "./execution.ts";
import type { createWorkspace, Stamp } from "./runtime.ts";
import { isWorkspaceCapture } from "./runtime.ts";
import { rememberLayout } from "./recovery-layout.ts";
import { byteLength, type Hash } from "./resources.ts";
import { decode } from "./portable.ts";
import { validateAsset } from "./content.ts";
import { storage, type Fault, type Head } from "./storage.ts";
import type { RecordBackend, Writes } from "./record-backend.ts";
import {
  StorageEpochChanged,
  type ReadSnapshot,
  type SnapshotLimits,
  type Inspection,
} from "./local-store.ts";
export type SaveCapture = ReturnType<
  ReturnType<typeof createWorkspace>["reader"]["capture"]
>;
export type IncrementalTicket = Readonly<{
  request: string;
  stamp: Stamp;
  document: string;
  expectedGeneration: number;
  capture: SaveCapture;
}>;
export type LocalSaveResult = Readonly<{
  head: Head;
  mode: "opaque" | "incremental";
  plannedChunks: number;
  plannedBytes: number;
  writes: Writes | null;
  epochRetries: number;
}>;
export type ReclamationReview = Readonly<{
  before: Inspection["before"];
  after: Inspection["after"];
  epoch: number;
  generation: number;
}>;
type Reuse = {
  epoch: number;
  memos: Map<string, Memo>;
  assets: Map<string, number>;
};
type RecordData = Record<string, Json>;
const digest = (v: unknown): v is string =>
  typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
/** Soft planning budget, never used inside the backend's atomic transaction. */
function saveWork() {
  let deadline = performance.now() + 8;
  let pause: Promise<void> | undefined;
  return async (work: () => Promise<string>): Promise<string> => {
    // Recheck after a shared pause: releasing all waiters must not create another long burst.
    while (pause || performance.now() >= deadline) {
      pause ??= new Promise<void>((resolve) => {
        // A real task boundary without nested/background timer clamping; close both owned ports.
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          deadline = performance.now() + 8;
          pause = undefined;
          resolve();
        };
        channel.port2.postMessage(null);
      });
      await pause;
    }
    return work();
  };
}
/** Caches contain only acknowledged immutable chunks. Failed saves never establish reuse. */
export function incrementalStorage(
  backend: RecordBackend,
  schemas: Schemas,
  methods: Methods,
  hash: Hash,
) {
  let cache: Reuse | undefined;
  const reviews = new WeakMap<ReclamationReview, Inspection>();
  function forEpoch(epoch: number): Reuse {
    if (cache?.epoch !== epoch)
      cache = { epoch, memos: new Map(), assets: new Map() };
    return cache;
  }
  function memo(reuse: Reuse, kind: string) {
    let value = reuse.memos.get(kind);
    if (!value) {
      value = new WeakMap();
      reuse.memos.set(kind, value);
    }
    return value;
  }
  const legacy = storage(backend, schemas, methods, hash);
  async function save(
    ticket: IncrementalTicket,
    fault: Fault = "none",
    beforePublish: (() => Promise<void>) | undefined,
    attempt: number,
  ): Promise<LocalSaveResult> {
    assert(
      isWorkspaceCapture(ticket.capture),
      "Local save requires an owner capture",
    );
    assert(
      ticket.capture.stamp.binding === ticket.stamp.binding,
      "Save binding mismatch",
    );
    const { document: doc, receipts, resources, original } = ticket.capture;
    assert(
      doc.id === ticket.stamp.root &&
        doc.document === ticket.document &&
        doc.evidenceSequence === ticket.stamp.evidence,
      "Save capture mismatch",
    );
    const currentState = await backend.state(),
      reuse = forEpoch(currentState.epoch),
      knownAssets = reuse.assets;
    assert(
      (currentState.head?.generation ?? 0) === ticket.expectedGeneration,
      "Save conflict: durable generation changed",
    );
    if (doc.readOnly) {
      assert(original, "Opaque save requires original package");
      const head = await legacy.save(
        { ...ticket, native: original },
        fault,
        beforePublish,
      );
      return Object.freeze({
        head,
        mode: "opaque" as const,
        epochRetries: attempt,
        plannedChunks: 0,
        plannedBytes: 0,
        writes: null,
      });
    }
    const run = saveWork(),
      writer = recordWriter(reuse.memos, hash, run),
      { chunks, cache, map } = writer;
    // DTOs here come only from this immutable owner capture; public writer.pack stays immediate.
    const pack: typeof writer.pack = (...args) =>
      run(() => writer.pack(...args));
    const stagedAssets = new Map<string, string>(),
      declaredSizes = new Map<string, number>();
    async function includeAssets(assets: readonly Asset[]) {
      const included: string[] = [];
      for (const a of assets) {
        validateAsset(a);
        if (a.disposition !== "included") continue;
        const previousSize =
          knownAssets.get(a.digest) ?? declaredSizes.get(a.digest);
        assert(
          previousSize === undefined || previousSize === a.size,
          "Conflicting source size during save",
        );
        declaredSizes.set(a.digest, a.size);
        included.push(a.digest);
        if (knownAssets.has(a.digest) || stagedAssets.has(a.digest)) continue;
        const read = resources.read(a);
        assert(read.status === "ready", "Missing included source during save");
        assert(
          byteLength(read.data) === a.size &&
            (await hash(read.data)) === a.digest,
          "Invalid source during save",
        );
        stagedAssets.set(a.digest, read.data);
      }
      return included;
    }
    async function leaf(kind: string, value: unknown): Promise<string> {
      const c = cache("value:" + kind);
      if (object(value) && c.has(value)) return c.get(value)!;
      const promise = (async () => {
        const r = value as Revision;
        const included =
          kind === "revision"
            ? await includeAssets(schemas.get(r.schema)?.assets(r.body) ?? [])
            : [];
        return pack({ kind: "value", value: value as Json }, [], included);
      })();
      if (object(value)) c.set(value, promise);
      return promise;
    }
    function context(c: Context) {
      return cached("context", c, async () => {
        if (c.heads.size + c.revisions.size <= 16)
          return pack({
            kind: "value",
            value: contextToPlain(c) as unknown as Json,
          });
        const heads = await map("heads", c.heads, (v) => leaf("plain", v)),
          revisions = await map("ids", c.revisions, (v) => leaf("plain", v));
        return pack(
          {
            kind: "context",
            root: c.root as unknown as Json,
            heads,
            revisions,
          },
          [heads, revisions],
        );
      });
    }
    function cached(kind: string, value: object, fn: () => Promise<string>) {
      const c = cache("object:" + kind);
      if (c.has(value)) return c.get(value)!;
      const result = fn();
      c.set(value, result);
      return result;
    }
    function alternative(a: Alternative) {
      return cached("alternative", a, async () => {
        const c = await context(a.context);
        return pack(
          { kind: "alternative", id: a.id, label: a.label, context: c },
          [c],
        );
      });
    }
    function receipt(r: Receipt) {
      return cached("receipt", r, async () => {
        const { context: c, snapshot, key: _derived, ...data } = r;
        const [ctx, snap] = await Promise.all([
          context(c),
          leaf("snapshot", snapshot),
        ]);
        return pack(
          {
            kind: "receipt",
            data: data as unknown as Json,
            context: ctx,
            snapshot: snap,
          },
          [ctx, snap],
          await includeAssets(receiptAssets(r)),
        );
      });
    }
    const roots: Record<string, Json> = {};
    const docMaps = [
      ["items", doc.items, "item"],
      ["revisions", doc.revisions, "revision"],
      ["views", doc.views, "view"],
    ] as const;
    for (const [name, values, kind] of docMaps)
      roots[name] = await map(kind, values as SharedMap<unknown>, (v) =>
        leaf(kind, v),
      );
    roots.alternatives = await map(
      "alternatives",
      doc.alternatives,
      alternative,
    );
    roots.receipts = await map("receipts", receipts, receipt);
    roots.known = await map("ids", doc.known, (v) => leaf("plain", v));
    for (const [key, values] of Object.entries(doc.allocated))
      roots["allocated:" + key] = await map("ids", values, (v) =>
        leaf("plain", v),
      );
    const root = await pack(
      {
        kind: "workspace",
        document: doc.document,
        id: doc.id,
        sequence: doc.sequence,
        evidenceSequence: doc.evidenceSequence,
        roots,
      },
      Object.values(roots) as (string | null)[],
    );
    await beforePublish?.();
    const planned = [...chunks.values()];
    let result: Awaited<ReturnType<RecordBackend["commit"]>>;
    try {
      result = await backend.commit(
        ticket.expectedGeneration,
        {
          request: ticket.request,
          root: doc.id,
          document: doc.document,
          package: root,
        },
        planned,
        [...stagedAssets],
        fault,
        currentState.epoch,
      );
    } catch (error) {
      if (error instanceof StorageEpochChanged && attempt === 0)
        return save(ticket, fault, undefined, 1);
      throw error;
    }
    writer.acknowledge();
    for (const key of stagedAssets.keys())
      knownAssets.set(key, declaredSizes.get(key)!);
    return Object.freeze({
      ...result,
      mode: "incremental" as const,
      epochRetries: attempt,
      plannedChunks: planned.length,
      plannedBytes: planned.reduce((n, c) => n + byteLength(c.text), 0),
    });
  }
  return Object.freeze({
    save: (
      ticket: IncrementalTicket,
      fault: Fault = "none",
      beforePublish?: () => Promise<void>,
    ) => save(ticket, fault, beforePublish, 0),
    reopen: async (limits: SnapshotLimits = {}) =>
      reopen(await backend.snapshot(limits), limits),
    reopenSnapshot: (snapshot: ReadSnapshot, limits: SnapshotLimits = {}) =>
      reopen(snapshot, limits),
    async reviewReclamation(limits: SnapshotLimits = {}) {
      const inspection = await backend.inspect(limits);
      if (inspection.snapshot.state.head)
        await reopen(inspection.snapshot, limits);
      const review = Object.freeze({
        before: inspection.before,
        after: inspection.after,
        epoch: inspection.snapshot.state.epoch,
        generation: inspection.snapshot.state.head?.generation ?? 0,
      });
      reviews.set(review, inspection);
      return review;
    },
    async reclaim(review: ReclamationReview, abort = false) {
      const inspection = reviews.get(review);
      assert(inspection, "Unrecognized storage cleanup review");
      const result = await backend.reclaim(inspection, abort);
      reviews.delete(review);
      forEpoch(result.epoch);
      return result;
    },
    /** Reclamation or external storage replacement must invalidate acknowledged reuse. */
    resetCache() {
      cache = undefined;
    },
  });
  async function reopen(snapshot: ReadSnapshot, limits: SnapshotLimits = {}) {
    const head = snapshot.state.head;
    assert(head, "No local save");
    const first = await snapshot.package(head.package);
    assert(
      first && (await hash(first)) === head.package,
      "Missing/corrupt saved manifest",
    );
    const parsed: unknown = JSON.parse(first);
    if (!object(parsed) || parsed.format !== "manifold-local-chunk")
      return legacy.reopen(snapshot);
    const reader = recordReader(snapshot, hash, limits, [head.package, first]),
      { node, value, map, verified: verifiedNodes, assets } = reader;
    async function context(key: Json): Promise<Json> {
      assert(digest(key), "Invalid context link");
      const n = await node(key);
      if (n.kind === "value") {
        assert(object(n.value), "Invalid inline context");
        return n.value;
      }
      assert(
        n.kind === "context" && n.root !== undefined,
        "Invalid local context",
      );
      const heads = await map(n.heads, value),
        revisions = await map(n.revisions, value);
      assert(
        Object.values(revisions).every((v) => v === true),
        "Invalid revision whitelist",
      );
      return {
        root: n.root,
        heads,
        revisions: Object.keys(revisions).sort(),
      };
    }
    const top = await node(head.package);
    assert(
      top.kind === "workspace" && object(top.roots),
      "Invalid local workspace",
    );
    const roots = top.roots;
    fields(roots, [
      "items",
      "revisions",
      "views",
      "alternatives",
      "receipts",
      "known",
      "allocated:revisions",
      "allocated:views",
      "allocated:alternatives",
      "allocated:receipts",
    ]);
    const alternatives = await map(roots.alternatives, async (key) => {
      assert(digest(key), "Invalid alternative link");
      const n = await node(key);
      assert(
        n.kind === "alternative" &&
          n.id !== undefined &&
          n.label !== undefined &&
          n.context !== undefined,
        "Invalid local alternative",
      );
      return { id: n.id, label: n.label, context: await context(n.context) };
    });
    const contexts: Record<string, Json> = Object.create(null),
      snapshots: Record<string, Json> = Object.create(null);
    const receipts = await map(roots.receipts, async (key, id) => {
      assert(digest(key), "Invalid receipt link");
      const n = await node(key);
      assert(
        n.kind === "receipt" &&
          object(n.data) &&
          n.data.id === id &&
          digest(n.context) &&
          digest(n.snapshot),
        "Invalid local receipt",
      );
      contexts[n.context] ??= await context(n.context);
      snapshots[n.snapshot] ??= await value(n.snapshot);
      return { ...n.data, context: n.context, snapshot: n.snapshot } as Json;
    });
    const identities: Record<string, Json> = {};
    for (const kind of [
      "items",
      "revisions",
      "views",
      "alternatives",
      "receipts",
    ]) {
      const ids = await map(
        roots[kind === "items" ? "known" : "allocated:" + kind],
        value,
      );
      assert(
        Object.values(ids).every((v) => v === true),
        "Invalid identity ledger",
      );
      identities[kind] = Object.keys(ids).sort();
    }
    const document = {
      document: top.document,
      id: top.id,
      sequence: top.sequence,
      evidenceSequence: top.evidenceSequence,
      identities,
      items: await map(roots.items, value),
      revisions: await map(roots.revisions, value),
      views: await map(roots.views, value),
      alternatives,
    };
    const bytes: Record<string, string> = Object.create(null);
    for (const key of assets) {
      const text = await snapshot.asset(key);
      assert(text !== undefined, "Missing saved asset");
      reader.addBytes(byteLength(text));
      bytes[key] = text;
    }
    const native = JSON.stringify({
      format: "manifold-foundation",
      version: Object.values(snapshots).some(
        (s) => object(s) && s.kind === "typed@1",
      )
        ? 4
        : Object.values(snapshots).some(
              (s) =>
                object(s) &&
                object(s.inputs) &&
                Object.values(s.inputs).some(
                  (input) => object(input) && input.dependencies !== undefined,
                ),
            )
          ? 3
          : 2,
      document,
      contexts,
      snapshots,
      receipts: Object.values(receipts),
      assets: bytes,
    });
    const loaded = await decode(native, schemas, methods, hash);
    assert(
      loaded.document.id === head.root &&
        loaded.document.document === head.document,
      "Saved head mismatch",
    );
    if (!loaded.document.readOnly)
      rememberLayout(loaded, (validated) => {
        const reuse = forEpoch(snapshot.state.epoch),
          knownAssets = reuse.assets;
        const updates: [Memo, object, Promise<string>][] = [];
        const contexts = new Map<string, Context>();
        function record(token: Json | undefined): RecordData {
          assert(digest(token), "Invalid recovery layout link");
          const n = verifiedNodes.get(token);
          assert(n, "Unverified recovery layout node");
          return n;
        }
        function remember(kind: string, value: object, token: string) {
          updates.push([memo(reuse, kind), value, Promise.resolve(token)]);
        }
        function lookup(root: Json | undefined, key: string): string {
          let at = root;
          while (at !== null) {
            const n = record(at);
            assert(
              n.kind === "map" && typeof n.key === "string",
              "Invalid recovery map",
            );
            if (n.key === key) {
              assert(digest(n.value), "Invalid recovery value");
              return n.value;
            }
            at = key < n.key ? n.left : n.right;
          }
          throw Error("Recovery layout omits key");
        }
        function shaped<V>(
          kind: string,
          values: SharedMap<V>,
          token: Json | undefined,
          valueKind = "plain",
          adapt?: (value: V, token: string) => V,
        ): SharedMap<V> {
          assert(token === null || digest(token), "Invalid recovery map root");
          const source = adapt
            ? SharedMap.from(
                [...values.entries()].map(
                  ([key, value]) =>
                    [key, adapt(value, lookup(token, key))] as const,
                ),
              )
            : values;
          return source.reshape(
            token,
            (at) => {
              const n = record(at);
              assert(
                typeof n.key === "string" &&
                  (n.left === null || digest(n.left)) &&
                  (n.right === null || digest(n.right)),
                "Invalid recovery map node",
              );
              return { key: n.key, left: n.left, right: n.right };
            },
            (at, identity, _key, value) => {
              remember("map:" + kind, identity, at);
              if (object(value)) {
                const n = record(at);
                assert(digest(n.value), "Missing recovery value");
                remember(
                  (valueKind === "receipt" || valueKind === "alternative"
                    ? "object:"
                    : "value:") + valueKind,
                  value,
                  n.value,
                );
              }
            },
          );
        }
        function context(value: Context, token: Json | undefined): Context {
          assert(digest(token), "Missing recovery context");
          const prior = contexts.get(token);
          if (prior) return prior;
          const n = record(token);
          if (n.kind === "value") {
            contexts.set(token, value);
            remember("object:context", value, token);
            return value;
          }
          assert(n.kind === "context", "Invalid recovery context");
          const next = Object.freeze({
            ...value,
            heads: shaped("heads", value.heads, n.heads),
            revisions: shaped("ids", value.revisions, n.revisions),
          });
          contexts.set(token, next);
          remember("object:context", next, token);
          return next;
        }
        const source = validated.document;
        assert(
          source.id === loaded.document.id &&
            source.document === loaded.document.document &&
            source.evidenceSequence === loaded.document.evidenceSequence,
          "Recovery layout binding mismatch",
        );
        const allocated = Object.freeze({
          revisions: shaped(
            "ids",
            source.allocated.revisions,
            roots["allocated:revisions"],
          ),
          views: shaped(
            "ids",
            source.allocated.views,
            roots["allocated:views"],
          ),
          alternatives: shaped(
            "ids",
            source.allocated.alternatives,
            roots["allocated:alternatives"],
          ),
          receipts: shaped(
            "ids",
            source.allocated.receipts,
            roots["allocated:receipts"],
          ),
        });
        const document = Object.freeze({
          ...source,
          allocated,
          known: shaped("ids", source.known, roots.known),
          items: shaped("item", source.items, roots.items, "item"),
          revisions: shaped(
            "revision",
            source.revisions,
            roots.revisions,
            "revision",
          ),
          views: shaped("view", source.views, roots.views, "view"),
          alternatives: shaped(
            "alternatives",
            source.alternatives,
            roots.alternatives,
            "alternative",
            (value, token) =>
              Object.freeze({
                ...value,
                context: context(value.context, record(token).context),
              }),
          ),
        });
        const receipts = shaped(
          "receipts",
          validated.receipts,
          roots.receipts,
          "receipt",
          (value, token) => {
            const n = record(token);
            assert(digest(n.snapshot), "Missing recovery snapshot");
            remember("value:snapshot", value.snapshot, n.snapshot);
            return Object.freeze({
              ...value,
              context: context(value.context, n.context),
            });
          },
        );
        for (const [key, text] of Object.entries(bytes))
          knownAssets.set(key, byteLength(text));
        for (const [cache, key, token] of updates) cache.set(key, token);
        return Object.freeze({ document, receipts });
      });
    return Object.freeze({ head, loaded });
  }
}
