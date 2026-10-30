import { assert, object } from "./value.ts";
import { decode } from "./portable.ts";
import type { Schemas, Methods } from "./contracts.ts";
import type { Hash } from "./resources.ts";
import type { Loaded, Stamp } from "./runtime.ts";
import { commitRecords, type Chunk } from "./record-backend.ts";
import {
  captureRecords,
  advanceClock,
  state,
  reclamationState,
  type ReadSnapshot,
  type SnapshotLimits,
  type Inspection,
  type ReclaimPlan,
} from "./local-store.ts";
export type Head = Readonly<{
  generation: number;
  request: string;
  root: string;
  document: string;
  package: string;
}>;
export type Ticket = Readonly<{
  request: string;
  stamp: Stamp;
  document: string;
  expectedGeneration: number;
  native: string;
}>;
export type Fault =
  | "none"
  | "after-assets"
  | "after-package"
  | "before-publish";
export interface Backend {
  snapshot?(limits?: SnapshotLimits): Promise<ReadSnapshot>;
  putAsset(key: string, data: string): Promise<void>;
  putPackage(key: string, data: string): Promise<void>;
  asset(key: string): Promise<string | undefined>;
  package(key: string): Promise<string | undefined>;
  head(): Promise<Head | null>;
  publish(
    expected: number,
    head: Omit<Head, "generation">,
    required: readonly string[],
    abort: boolean,
  ): Promise<Head>;
}
/** Immutable staging, then one atomic durable-head compare-and-swap. A failed save cannot adopt staged orphans. */
export function storage(
  backend: Backend,
  schemas: Schemas,
  methods: Methods,
  hash: Hash,
) {
  return Object.freeze({
    async save(
      ticket: Ticket,
      fault: Fault = "none",
      beforePublish?: () => Promise<void>,
    ): Promise<Head> {
      const loaded = await decode(ticket.native, schemas, methods, hash);
      assert(
        loaded.document.id === ticket.stamp.root &&
          loaded.document.document === ticket.document &&
          loaded.document.evidenceSequence === ticket.stamp.evidence,
        "Save capture mismatch",
      );
      const e = JSON.parse(ticket.native) as { assets: Record<string, string> };
      const entries = Object.entries(e.assets);
      for (const [key, value] of entries) await backend.putAsset(key, value);
      if (fault === "after-assets") throw Error("Interrupted after assets");
      const metadata = JSON.stringify({
        native: {
          ...e,
          assets: Object.fromEntries(entries.map(([key]) => [key, null])),
        },
        original: loaded.document.readOnly ? ticket.native : null,
      });
      const id = await hash(metadata);
      await backend.putPackage(id, metadata);
      if (fault === "after-package") throw Error("Interrupted after package");
      await beforePublish?.();
      return backend.publish(
        ticket.expectedGeneration,
        {
          request: ticket.request,
          root: ticket.stamp.root,
          document: ticket.document,
          package: id,
        },
        entries.map(([key]) => key),
        fault === "before-publish",
      );
    },
    async reopen(
      captured?: ReadSnapshot,
    ): Promise<Readonly<{ head: Head; loaded: Loaded }>> {
      const source = captured ?? (await backend.snapshot?.()) ?? backend;
      const head = await source.head();
      assert(head, "No local save");
      const metadata = await source.package(head.package);
      assert(
        metadata && (await hash(metadata)) === head.package,
        "Missing/corrupt saved manifest",
      );
      const m: unknown = JSON.parse(metadata);
      assert(
        object(m) && object(m.native) && object(m.native.assets),
        "Invalid saved manifest",
      );
      const bytes: Record<string, string> = Object.create(null);
      for (const key of Object.keys(m.native.assets)) {
        const data = await source.asset(key);
        assert(data !== undefined, "Missing saved asset");
        bytes[key] = data;
      }
      const native =
          typeof m.original === "string"
            ? m.original
            : JSON.stringify({ ...m.native, assets: bytes }),
        loaded = await decode(native, schemas, methods, hash);
      assert(
        loaded.document.id === head.root &&
          loaded.document.document === head.document,
        "Saved head mismatch",
      );
      return Object.freeze({ head, loaded });
    },
  });
}
export function acknowledgementApplies(
  head: Head,
  ticket: Pick<Ticket, "request" | "stamp" | "document">,
  now: Stamp,
) {
  return (
    head.request === ticket.request &&
    head.root === ticket.stamp.root &&
    head.document === ticket.document &&
    now.root === ticket.stamp.root &&
    now.evidence === ticket.stamp.evidence &&
    now.binding === ticket.stamp.binding
  );
}
export function memoryBackend() {
  let bytes = new Map<string, string>(),
    packages = new Map<string, string>();
  let current: Head | null = null,
    epoch = 0,
    revision = 0;
  const inspections = new WeakMap<Inspection, ReclaimPlan>();
  let tail: Promise<unknown> = Promise.resolve();
  function transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  }
  const write = (map: Map<string, string>, key: string, value: string) => {
    assert(
      !map.has(key) || map.get(key) === value,
      "Immutable storage conflict",
    );
    map.set(key, value);
  };
  function scan() {
    return {
      state: async () => state(current, epoch, revision),
      get: async (store: "assets" | "packages", key: string) =>
        (store === "assets" ? bytes : packages).get(key),
      inventory: async (
        store: "assets" | "packages",
        visit: (key: string, text: string) => void,
      ) => {
        for (const [key, text] of store === "assets" ? bytes : packages)
          visit(key, text);
      },
    };
  }
  return Object.freeze({
    async putAsset(k: string, v: string) {
      await transaction(() => {
        if (!bytes.has(k)) revision = advanceClock(revision);
        write(bytes, k, v);
      });
    },
    async putPackage(k: string, v: string) {
      await transaction(() => {
        if (!packages.has(k)) revision = advanceClock(revision);
        write(packages, k, v);
      });
    },
    async asset(k: string) {
      return bytes.get(k);
    },
    async package(k: string) {
      return packages.get(k);
    },
    async head() {
      return current;
    },
    state: async () => state(current, epoch, revision),
    snapshot: (limits?: SnapshotLimits) =>
      transaction(async () => (await captureRecords(scan(), limits)).snapshot),
    inspect: (limits?: SnapshotLimits) =>
      transaction(async () => {
        const { plan } = await captureRecords(scan(), limits, true);
        inspections.set(plan!.inspection, plan!);
        return plan!.inspection;
      }),
    reclaim: (inspection: Inspection, abort = false) =>
      transaction(() => {
        const plan = inspections.get(inspection);
        assert(plan, "Unrecognized storage cleanup review");
        const next = reclamationState(plan, state(current, epoch, revision));
        assert(!abort, "Aborted storage cleanup");
        for (const key of plan.packages) packages.delete(key);
        for (const key of plan.assets) bytes.delete(key);
        epoch = next.epoch;
        revision = next.revision;
        inspections.delete(inspection);
        return Object.freeze({
          epoch,
          removedPackages: plan.packages.length,
          removedAssets: plan.assets.length,
          reclaimedBytes: inspection.before.bytes - inspection.after.bytes,
        });
      }),
    async publish(
      expected: number,
      next: Omit<Head, "generation">,
      required: readonly string[],
      abort: boolean,
    ) {
      return transaction(() => {
        assert(
          (current?.generation ?? 0) === expected,
          "Save conflict: durable generation changed",
        );
        assert(
          packages.has(next.package) && required.every((k) => bytes.has(k)),
          "Missing staged records",
        );
        assert(!abort, "Aborted head transaction");
        const nextRevision = advanceClock(revision),
          generation = advanceClock(expected);
        current = Object.freeze({ ...next, generation });
        revision = nextRevision;
        return current;
      });
    },
    commit(
      expected: number,
      next: Omit<Head, "generation">,
      chunks: readonly Chunk[],
      staged: readonly (readonly [string, string])[],
      fault: Fault,
      expectedEpoch?: number,
    ) {
      return transaction(async () => {
        const nextRevision = advanceClock(revision);
        const nextBytes = new Map(bytes),
          nextPackages = new Map(packages);
        let nextHead = current;
        const result = await commitRecords(
          expected,
          next,
          chunks,
          staged,
          fault,
          {
            state: async () => state(current, epoch, revision),
            get: async (store, key) =>
              (store === "assets" ? nextBytes : nextPackages).get(key),
            put: (store, key, value) =>
              (store === "assets" ? nextBytes : nextPackages).set(key, value),
            publish: (head) => {
              nextHead = head;
            },
          },
          expectedEpoch,
        );
        bytes = nextBytes;
        packages = nextPackages;
        current = nextHead;
        revision = nextRevision;
        return result;
      });
    },
    loseAsset: (key: string) => {
      const e = advanceClock(epoch),
        r = advanceClock(revision);
      epoch = e;
      revision = r;
      return bytes.delete(key);
    },
    corruptAsset: (key: string, value: string) => {
      const e = advanceClock(epoch),
        r = advanceClock(revision);
      epoch = e;
      revision = r;
      return bytes.set(key, value);
    },
    diagnostics: () => ({ assets: bytes.size, packages: packages.size }),
  });
}
