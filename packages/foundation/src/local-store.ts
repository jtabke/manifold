/** Coordinated physical storage protocol. Domain and portable-file identities are separate. */
import { assert, canonical, fields, object, type Json } from "./value.ts";
import { byteLength } from "./resources.ts";
import type { Head } from "./storage.ts";
export type StoreName = "assets" | "packages";
export type StoreState = Readonly<{
  head: Head | null;
  epoch: number;
  revision: number;
}>;
export type SnapshotLimits = Readonly<{
  maxBytes?: number;
  maxChunks?: number;
  maxStoreBytes?: number;
  maxStoredRecords?: number;
}>;
export type StoreCounts = Readonly<{
  packages: number;
  assets: number;
  bytes: number;
}>;
export interface ReadSnapshot {
  readonly state: StoreState;
  head(): Promise<Head | null>;
  package(key: string): Promise<string | undefined>;
  asset(key: string): Promise<string | undefined>;
  records(): Iterable<readonly [StoreName, string, string]>;
}
export type Inspection = Readonly<{
  snapshot: ReadSnapshot;
  before: StoreCounts;
  after: StoreCounts;
}>;
export type ReclaimPlan = Readonly<{
  inspection: Inspection;
  packages: readonly string[];
  assets: readonly string[];
}>;
export class StorageEpochChanged extends Error {
  constructor() {
    super("Storage cleanup changed the epoch; rebuild the Save batch");
    this.name = "StorageEpochChanged";
  }
}
export function advanceClock(value: number) {
  assert(Number.isSafeInteger(value + 1), "Storage clock exhausted");
  return value + 1;
}
export const digest = (v: unknown): v is string =>
  typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
export function state(head: Head | null, epoch = 0, revision = 0): StoreState {
  assert(
    Number.isSafeInteger(epoch) &&
      epoch >= 0 &&
      Number.isSafeInteger(revision) &&
      revision >= 0,
    "Invalid storage clock",
  );
  assert(
    !head ||
      (Number.isSafeInteger(head.generation) &&
        head.generation > 0 &&
        digest(head.package) &&
        typeof head.root === "string" &&
        typeof head.document === "string" &&
        typeof head.request === "string"),
    "Invalid storage head",
  );
  return Object.freeze({
    head: head ? Object.freeze({ ...head }) : null,
    epoch,
    revision,
  });
}
/** Private to the fresh JSON.parse graph below: syntax guarantees plain data, dense arrays and no cycles.
 * Numeric overflow and the JSON object-depth budget still require explicit checks. */
function parsedJson(value: Json, path = "$", depth = 0) {
  if (typeof value === "number") {
    assert(Number.isFinite(value), "Nonfinite JSON at " + path);
  } else if (value !== null && typeof value === "object") {
    assert(depth < 128, "JSON nesting limit exceeded");
    for (const key of Object.keys(value))
      parsedJson(
        (value as Record<string, Json>)[key]!,
        path + "." + key,
        depth + 1,
      );
  }
}
/** Traverse only explicit physical edges; legacy envelopes carry their complete asset table. */
export function storedEdges(text: string): Readonly<{
  links: readonly string[];
  assets: readonly string[];
  data?: Record<string, Json>;
}> {
  const c: unknown = JSON.parse(text);
  assert(object(c), "Invalid stored record");
  if (c.format !== "manifold-local-chunk") {
    assert(
      object(c.native) && object(c.native.assets),
      "Unsupported stored manifest",
    );
    const assets = Object.keys(c.native.assets);
    assert(assets.every(digest), "Invalid legacy asset link");
    return { links: [], assets };
  }
  fields(c, ["format", "version", "data", "assets"]);
  assert(
    c.version === 1 &&
      object(c.data) &&
      Array.isArray(c.assets) &&
      c.assets.every(digest),
    "Invalid local chunk",
  );
  const d = c.data as Record<string, Json>;
  parsedJson(d);
  const link = (v: Json | undefined): string[] => {
    assert(v === null || digest(v), "Invalid local link");
    return v === null ? [] : [v];
  };
  let links: string[];
  switch (d.kind) {
    case "value":
      fields(d, ["kind", "value"]);
      links = [];
      break;
    case "map":
      fields(d, ["kind", "key", "value", "left", "right"]);
      links = [...link(d.value), ...link(d.left), ...link(d.right)];
      break;
    case "context":
      fields(d, ["kind", "root", "heads", "revisions"]);
      links = [...link(d.heads), ...link(d.revisions)];
      break;
    case "alternative":
      fields(d, ["kind", "id", "label", "context"]);
      links = link(d.context);
      break;
    case "receipt":
      fields(d, ["kind", "data", "context", "snapshot"]);
      links = [...link(d.context), ...link(d.snapshot)];
      break;
    case "bundle":
      fields(d, ["kind", "schema", "version", "metadata", "roots"]);
      assert(
        typeof d.schema === "string" &&
          Number.isSafeInteger(d.version) &&
          (d.version as number) > 0 &&
          object(d.metadata) &&
          object(d.roots),
        "Invalid local bundle",
      );
      links = Object.values(d.roots).flatMap(link);
      break;
    case "workspace":
      fields(d, [
        "kind",
        "document",
        "id",
        "sequence",
        "evidenceSequence",
        "roots",
      ]);
      assert(object(d.roots), "Missing local map roots");
      links = Object.values(d.roots).flatMap(link);
      break;
    default:
      throw Error("Unsupported local chunk kind");
  }
  assert(
    d.kind === "value" ||
      (d.kind === "receipt" && object(d.data) && d.data.kind === "typed@1") ||
      c.assets.length === 0,
    "Assets on non-value chunk",
  );
  return { links, assets: c.assets as string[], data: d };
}
export type ScanIO = {
  state(): Promise<StoreState>;
  get(store: StoreName, key: string): Promise<string | undefined>;
  inventory?(
    store: StoreName,
    visit: (key: string, text: string) => void,
  ): Promise<void>;
};
/** Only storage requests run inside this call. Crypto/domain validation run on its immutable result. */
export async function captureRecords(
  io: ScanIO,
  limits: SnapshotLimits = {},
  inspect = false,
): Promise<Readonly<{ snapshot: ReadSnapshot; plan?: ReclaimPlan }>> {
  const captured = await io.state(),
    packages = new Map<string, string>(),
    assets = new Map<string, string>(),
    queued = new Set<string>(),
    assetKeys = new Set<string>();
  let bytes = 0;
  const queue: string[] = [];
  const enqueue = (key: string) => {
    assert(digest(key), "Invalid saved chunk link");
    if (!queued.has(key)) {
      assert(
        queued.size < (limits.maxChunks ?? 1000000),
        "Local chunk budget exceeded",
      );
      queued.add(key);
      queue.push(key);
    }
  };
  if (captured.head) enqueue(captured.head.package);
  const add = (text: string) => {
    bytes += byteLength(text);
    assert(
      bytes <= (limits.maxBytes ?? 64 * 1024 * 1024),
      "Local byte budget exceeded",
    );
  };
  while (queue.length) {
    const keys = queue.splice(0, 256),
      values = await Promise.all(keys.map((key) => io.get("packages", key)));
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!,
        text = values[i];
      assert(typeof text === "string", "Missing local chunk");
      add(text);
      packages.set(key, text);
      const edges = storedEdges(text);
      for (const child of edges.links) enqueue(child);
      for (const asset of edges.assets) assetKeys.add(asset);
    }
  }
  const wanted = [...assetKeys];
  for (let start = 0; start < wanted.length; start += 256) {
    const keys = wanted.slice(start, start + 256),
      values = await Promise.all(keys.map((key) => io.get("assets", key)));
    for (let i = 0; i < keys.length; i++) {
      const text = values[i];
      assert(typeof text === "string", "Missing saved asset");
      add(text);
      assets.set(keys[i]!, text);
    }
  }
  const snapshot: ReadSnapshot = Object.freeze({
    state: captured,
    head: async () => captured.head,
    package: async (key: string) => packages.get(key),
    asset: async (key: string) => assets.get(key),
    *records() {
      for (const [key, text] of packages)
        yield ["packages", key, text] as const;
      for (const [key, text] of assets) yield ["assets", key, text] as const;
    },
  });
  if (!inspect) return Object.freeze({ snapshot });
  assert(io.inventory, "Storage inspection is unsupported");
  const before = { packages: 0, assets: 0, bytes: 0 },
    removePackages: string[] = [],
    removeAssets: string[] = [];
  for (const store of ["packages", "assets"] as const)
    await io.inventory(store, (key, text) => {
      before[store]++;
      assert(
        before.packages + before.assets <= (limits.maxStoredRecords ?? 1000000),
        "Stored record inspection budget exceeded",
      );
      before.bytes += byteLength(text);
      assert(
        before.bytes <= (limits.maxStoreBytes ?? 512 * 1024 * 1024),
        "Stored byte inspection budget exceeded",
      );
      if (!(store === "packages" ? packages : assets).has(key))
        (store === "packages" ? removePackages : removeAssets).push(key);
    });
  const inspection = Object.freeze({
    snapshot,
    before: Object.freeze(before),
    after: Object.freeze({
      packages: packages.size,
      assets: assets.size,
      bytes,
    }),
  });
  return Object.freeze({
    snapshot,
    plan: Object.freeze({
      inspection,
      packages: Object.freeze(removePackages),
      assets: Object.freeze(removeAssets),
    }),
  });
}
export function reclamationState(plan: ReclaimPlan, now: StoreState) {
  assert(
    canonical(now as unknown as Json) ===
      canonical(plan.inspection.snapshot.state as unknown as Json),
    "Storage cleanup review is stale",
  );
  const changed = plan.packages.length + plan.assets.length > 0;
  return changed
    ? state(now.head, advanceClock(now.epoch), advanceClock(now.revision))
    : now;
}
