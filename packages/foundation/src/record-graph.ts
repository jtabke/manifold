/** Shared physical graph primitives. These records are never a portable-domain schema. */
import { assert, canonical, type Json } from "./value.ts";
import { type SharedMap } from "./shared-map.ts";
import { byteLength, type Hash } from "./resources.ts";
import type { Chunk } from "./record-backend.ts";
import {
  storedEdges,
  digest,
  type ReadSnapshot,
  type SnapshotLimits,
} from "./local-store.ts";
export type RecordData = Record<string, Json>;
export type RecordMemo = WeakMap<object, Promise<string>>;
export function recordWriter(
  memos: Map<string, RecordMemo>,
  hash: Hash,
  schedule: (work: () => Promise<string>) => Promise<string> = (work) => work(),
) {
  const chunks = new Map<string, Chunk>(),
    interned = new Map<string, Promise<string>>();
  const updates: [RecordMemo, object, Promise<string>][] = [];
  const shadows = new Map<string, RecordMemo>();
  function cache(kind: string) {
    let saved = memos.get(kind);
    if (!saved) {
      saved = new WeakMap();
      memos.set(kind, saved);
    }
    let local = shadows.get(kind);
    if (!local) {
      local = new WeakMap();
      shadows.set(kind, local);
    }
    const target = saved,
      current = local;
    return {
      has: (key: object) => current.has(key) || target.has(key),
      get: (key: object) => current.get(key) ?? target.get(key),
      set(key: object, value: Promise<string>) {
        current.set(key, value);
        updates.push([target, key, value]);
        return this;
      },
    };
  }
  function pack(
    data: RecordData,
    links: readonly (string | null)[] = [],
    assets: readonly string[] = [],
  ) {
    const refs = [
        ...new Set(links.filter((s): s is string => s !== null)),
      ].sort(),
      bytes = [...new Set(assets)].sort();
    const text = canonical({
      format: "manifold-local-chunk",
      version: 1,
      data,
      assets: bytes,
    });
    const physical = storedEdges(text);
    assert(
      JSON.stringify(refs) ===
        JSON.stringify([...new Set(physical.links)].sort()),
      "Declared record links do not match physical edges",
    );
    let pending = interned.get(text);
    if (!pending) {
      pending = hash(text).then((id) => {
        assert(digest(id), "Invalid storage digest");
        const old = chunks.get(id);
        assert(!old || old.text === text, "Storage hash collision");
        chunks.set(id, Object.freeze({ id, text, links: refs, assets: bytes }));
        return id;
      });
      interned.set(text, pending);
    }
    return pending;
  }
  function map<V>(
    kind: string,
    values: SharedMap<V>,
    encode: (v: V) => Promise<string>,
  ): Promise<string | null> {
    return Promise.resolve(
      values.fold<Promise<string>>(
        async (key, value, left, right) => {
          const [v, l, r] = await Promise.all([encode(value), left, right]);
          return schedule(() =>
            pack({ kind: "map", key, value: v, left: l, right: r }, [v, l, r]),
          );
        },
        cache("map:" + kind),
      ),
    );
  }
  return Object.freeze({
    cache,
    pack,
    map,
    chunks,
    acknowledge() {
      for (const [memo, key, value] of updates) memo.set(key, value);
    },
  });
}
/** Every returned node has verified bytes/edges; maps additionally check ordering and AVL shape. */
export function recordReader(
  snapshot: ReadSnapshot,
  hash: Hash,
  limits: SnapshotLimits = {},
  first?: readonly [string, string],
) {
  const nodes = new Map<string, Promise<RecordData>>(),
    verified = new Map<string, RecordData>(),
    assets = new Set<string>();
  let totalBytes = 0;
  function addBytes(n: number) {
    totalBytes += n;
    assert(
      totalBytes <= (limits.maxBytes ?? 64 * 1024 * 1024),
      "Local byte budget exceeded",
    );
  }
  async function node(key: string): Promise<RecordData> {
    assert(digest(key), "Invalid local chunk link");
    let pending = nodes.get(key);
    if (!pending) {
      assert(
        nodes.size < (limits.maxChunks ?? 1000000),
        "Local chunk budget exceeded",
      );
      pending = (async () => {
        const text =
          key === first?.[0] ? first[1] : await snapshot.package(key);
        assert(text, "Missing local chunk");
        addBytes(byteLength(text));
        assert((await hash(text)) === key, "Corrupt local chunk");
        const c = storedEdges(text);
        assert(c.data, "Invalid local chunk");
        for (const asset of c.assets) assets.add(asset);
        verified.set(key, c.data);
        return c.data;
      })();
      nodes.set(key, pending);
    }
    return pending;
  }
  async function value(key: Json | undefined) {
    assert(digest(key), "Missing local value");
    const n = await node(key);
    assert(n.kind === "value" && n.value !== undefined, "Invalid local value");
    return n.value;
  }
  async function map(
    key: Json | undefined,
    read: (key: Json, id: string) => Promise<Json>,
  ): Promise<Record<string, Json>> {
    assert(key === null || digest(key), "Invalid local map");
    const out: Record<string, Json> = Object.create(null),
      visited: string[] = [];
    const queue: { key: string; low?: string; high?: string; depth: number }[] =
      key === null ? [] : [{ key, depth: 0 }];
    while (queue.length) {
      const at = queue.pop()!;
      assert(at.depth < 128, "Invalid local map depth/cycle");
      const n = await node(at.key);
      assert(
        n.kind === "map" &&
          typeof n.key === "string" &&
          (at.low === undefined || n.key > at.low) &&
          (at.high === undefined || n.key < at.high) &&
          n.value !== undefined,
        "Invalid local map ordering",
      );
      assert(!Object.hasOwn(out, n.key), "Duplicate local map key");
      out[n.key] = await read(n.value, n.key);
      visited.push(at.key);
      if (n.left !== null) {
        assert(digest(n.left), "Invalid map child");
        queue.push({
          key: n.left,
          ...(at.low === undefined ? {} : { low: at.low }),
          high: n.key,
          depth: at.depth + 1,
        });
      }
      if (n.right !== null) {
        assert(digest(n.right), "Invalid map child");
        queue.push({
          key: n.right,
          low: n.key,
          ...(at.high === undefined ? {} : { high: at.high }),
          depth: at.depth + 1,
        });
      }
    }
    const heights = new Map<string, number>();
    for (const token of visited.reverse()) {
      const n = verified.get(token)!,
        left = n.left === null ? 0 : heights.get(n.left as string)!,
        right = n.right === null ? 0 : heights.get(n.right as string)!;
      assert(
        Number.isFinite(left) &&
          Number.isFinite(right) &&
          Math.abs(left - right) <= 1,
        "Unbalanced local map",
      );
      heights.set(token, 1 + Math.max(left, right));
    }
    return out;
  }
  return Object.freeze({ node, value, map, verified, assets, addBytes });
}
