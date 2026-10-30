/** Private local encoding; portable work never depends on these chunk identities. */
import { assert } from "./value.ts";
import type { Backend, Head, Fault } from "./storage.ts";
import {
  StorageEpochChanged,
  type StoreState,
  type SnapshotLimits,
  type ReadSnapshot,
  type Inspection,
} from "./local-store.ts";
export type Chunk = Readonly<{
  id: string;
  text: string;
  links: readonly string[];
  assets: readonly string[];
}>;
export type Writes = Readonly<{
  chunks: number;
  chunkBytes: number;
  assets: number;
  assetBytes: number;
}>;
export interface RecordBackend extends Backend {
  state(): Promise<StoreState>;
  snapshot(limits?: SnapshotLimits): Promise<ReadSnapshot>;
  inspect(limits?: SnapshotLimits): Promise<Inspection>;
  reclaim(
    inspection: Inspection,
    abort?: boolean,
  ): Promise<
    Readonly<{
      epoch: number;
      removedPackages: number;
      removedAssets: number;
      reclaimedBytes: number;
    }>
  >;
  commit(
    expected: number,
    head: Omit<Head, "generation">,
    chunks: readonly Chunk[],
    assets: readonly (readonly [string, string])[],
    fault: Fault,
    expectedEpoch?: number,
  ): Promise<Readonly<{ head: Head; writes: Writes }>>;
}
/** Bound request pressure and settle the whole batch before propagating a failure. */
async function inBatches<T>(
  values: readonly T[],
  visit: (value: T) => Promise<void>,
) {
  for (let i = 0; i < values.length; i += 64) {
    const results = await Promise.allSettled(
      values.slice(i, i + 64).map(visit),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
/** Shared transaction logic. Implementations serialize this call with the durable head. */
export async function commitRecords(
  expected: number,
  next: Omit<Head, "generation">,
  chunks: readonly Chunk[],
  assets: readonly (readonly [string, string])[],
  fault: Fault,
  io: {
    state(): Promise<StoreState>;
    get(store: "assets" | "packages", key: string): Promise<string | undefined>;
    put(store: "assets" | "packages", key: string, value: string): void;
    publish(head: Head): void;
  },
  expectedEpoch?: number,
) {
  const currentState = await io.state(),
    current = currentState.head;
  if (expectedEpoch !== undefined && currentState.epoch !== expectedEpoch)
    throw new StorageEpochChanged();
  assert(
    (current?.generation ?? 0) === expected,
    "Save conflict: durable generation changed",
  );
  assert(Number.isSafeInteger(expected + 1), "Durable generation exhausted");
  const writes = { chunks: 0, chunkBytes: 0, assets: 0, assetBytes: 0 };
  const size = (text: string) => new TextEncoder().encode(text).byteLength;
  // Asset keys may repeat: preserve ordered duplicate/conflicting-byte checks.
  for (const [key, text] of assets) {
    const old = await io.get("assets", key);
    assert(old === undefined || old === text, "Immutable asset conflict");
    if (old === undefined) {
      io.put("assets", key, text);
      writes.assets++;
      writes.assetBytes += size(text);
    }
  }
  assert(fault !== "after-assets", "Interrupted after assets");
  const supplied = new Map(chunks.map((c) => [c.id, c]));
  assert(supplied.size === chunks.length, "Duplicate staged chunk");
  await inBatches(chunks, async (c) => {
    const old = await io.get("packages", c.id);
    assert(old === undefined || old === c.text, "Immutable chunk conflict");
    if (old === undefined) {
      io.put("packages", c.id, c.text);
      writes.chunks++;
      writes.chunkBytes += size(c.text);
    }
  });
  // New edges must already exist or be in this transaction. Committed chunks are immutable;
  // no collector may remove their descendants without a separate coordinated protocol.
  const links = new Set(chunks.flatMap((c) => [...c.links]));
  links.add(next.package);
  await inBatches(
    [...links].filter((key) => !supplied.has(key)),
    async (key) => {
      assert(
        (await io.get("packages", key)) !== undefined,
        "Missing staged chunk",
      );
    },
  );
  await inBatches(
    [...new Set(chunks.flatMap((c) => [...c.assets]))],
    async (key) => {
      assert(
        (await io.get("assets", key)) !== undefined,
        "Missing staged asset",
      );
    },
  );
  assert(fault !== "after-package", "Interrupted after package");
  const head = Object.freeze({ ...next, generation: expected + 1 });
  io.publish(head);
  assert(fault !== "before-publish", "Aborted head transaction");
  return Object.freeze({ head, writes: Object.freeze(writes) });
}
