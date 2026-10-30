/** Verified full-reader execution leases and unpublished output staging, owned by the caller's job. */
import { assert, canonical, retained, type Json } from "./value.ts";
import { validateAsset } from "./content.ts";
import { byteLength, webHash, MemoryResources } from "./resources.ts";
import { SharedMap } from "./shared-map.ts";
import type { Asset, Resources, ExecutionIO } from "./contracts.ts";
type Bytes = Readonly<{ data: string; size: number }>;
const key = (asset: Asset) => canonical(asset as unknown as Json);
export function resourceAssets(values: readonly Asset[]): readonly Asset[] {
  assert(
    Array.isArray(values) && values.length <= 64,
    "Execution asset count exceeded",
  );
  const byDescriptor = new Map<string, Asset>(),
    sizes = new Map<string, number>();
  for (const value of values) {
    validateAsset(value);
    assert(
      !sizes.has(value.digest) || sizes.get(value.digest) === value.size,
      "Conflicting execution asset size",
    );
    sizes.set(value.digest, value.size);
    byDescriptor.set(key(value), retained(value as unknown as Json) as Asset);
  }
  assert(
    byteLength(canonical([...byDescriptor.values()] as unknown as Json)) <=
      128 * 1024,
    "Execution asset metadata budget exceeded",
  );
  return Object.freeze(
    [...byDescriptor]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, asset]) => asset),
  );
}
export function declaredResources(
  assets: readonly Asset[],
  provider: Resources,
): Resources {
  const allowed = new Set(assets.map(key));
  return Object.freeze({
    read(asset: Asset) {
      validateAsset(asset);
      assert(allowed.has(key(asset)), "Undeclared execution resource read");
      return provider.read(asset);
    },
  });
}
export function acquireExecutionResources(
  assets: readonly Asset[],
  provider: Resources,
  outputLimit: number,
  signal: () => AbortSignal | undefined,
) {
  const input = new Map<string, Bytes>(),
    staged = new Map<string, Bytes>(),
    writes = new Map<string, { data: string; promise: Promise<void> }>();
  let open = true,
    stagedBytes = 0;
  for (const asset of assets) {
    const read = provider.read(asset);
    assert(read.status === "ready", "Execution input bytes unavailable");
    assert(
      byteLength(read.data) === asset.size,
      "Execution input size mismatch",
    );
    input.set(asset.digest, { data: read.data, size: asset.size });
  }
  const active = () =>
    assert(
      open && !signal()?.aborted,
      "Execution resource scope expired or cancelled",
    );
  const lookup = (asset: Asset) => {
    const bytes = staged.get(asset.digest) ?? input.get(asset.digest);
    return bytes?.size === asset.size
      ? { status: "ready" as const, data: bytes.data }
      : {
          status: "unavailable" as const,
          reason: "Unverified execution bytes",
        };
  };
  const inputPort = declaredResources(assets, { read: lookup });
  const io: ExecutionIO = Object.freeze({
    read(asset: Asset) {
      active();
      return inputPort.read(asset);
    },
    stage(value: Asset, data: string) {
      // Consume late rejections even if an adapter forgets to await its own staged write.
      const promise = (async () => {
        active();
        validateAsset(value);
        const asset = retained(value as unknown as Json) as Asset;
        assert(
          asset.disposition === "included" &&
            typeof data === "string" &&
            byteLength(data) === asset.size,
          "Invalid staged output bytes",
        );
        const prior = writes.get(asset.digest);
        if (prior) {
          assert(prior.data === data, "Conflicting staged output");
          return prior.promise;
        }
        assert(
          writes.size < 64 && stagedBytes + asset.size <= outputLimit,
          "Staged output byte/count budget exceeded",
        );
        stagedBytes += asset.size;
        const verified = (async () => {
          assert(
            (await webHash(data)) === asset.digest,
            "Staged output digest mismatch",
          );
          active();
          staged.set(asset.digest, { data, size: asset.size });
        })();
        verified.catch(() => {});
        writes.set(asset.digest, { data, promise: verified });
        await verified;
      })();
      promise.catch(() => {});
      return promise;
    },
  });
  return {
    io,
    inputBytes: [...input.values()].reduce((sum, value) => sum + value.size, 0),
    async verify() {
      active();
      for (const [digest, value] of input)
        assert(
          (await webHash(value.data)) === digest,
          "Execution input digest mismatch",
        );
      active();
    },
    output(outputAssets: readonly Asset[]) {
      active();
      const allowed = resourceAssets(outputAssets);
      for (const asset of allowed)
        assert(
          lookup(asset).status === "ready",
          "Output references unverified execution bytes",
        );
      return {
        resources: declaredResources([...allowed, ...assets], {
          read: lookup,
        }),
        staged: new Map(
          [...staged].filter(([digest]) =>
            allowed.some((asset) => asset.digest === digest),
          ),
        ),
      };
    },
    close() {
      open = false;
      input.clear();
      staged.clear();
      writes.clear();
    },
  };
}
/** Persistent output map avoids retaining one chained provider per completed job. */
class OutputResources implements Resources {
  readonly base: Resources;
  readonly values: SharedMap<Bytes>;
  constructor(base: Resources, values: SharedMap<Bytes>) {
    this.base = base;
    this.values = values;
    Object.freeze(this);
  }
  read(asset: Asset) {
    const own = this.values.get(asset.digest);
    if (!own) return this.base.read(asset);
    return own.size === asset.size
      ? { status: "ready" as const, data: own.data }
      : { status: "corrupt" as const, reason: "Output asset size mismatch" };
  }
}
const outputSizes = new WeakMap<object, number>();
export function publishExecutionResources(
  current: Resources,
  staged: ReadonlyMap<string, Bytes>,
): Resources {
  if (!staged.size) return current;
  const base = current instanceof OutputResources ? current.base : current;
  let values =
    current instanceof OutputResources
      ? current.values
      : SharedMap.empty<Bytes>();
  for (const [digest, bytes] of staged) values = values.set(digest, bytes);
  assert(
    (values.fold<number>(
      (_key, value, left, right) => value.size + (left ?? 0) + (right ?? 0),
      outputSizes,
    ) ?? 0) <=
      64 * 1024 * 1024,
    "Verified output resource budget exceeded; review retained evidence",
  );
  return new OutputResources(base, values);
}
export function retainExecutionResources(
  current: Resources,
  assets: readonly Asset[],
  next?: Resources,
): Resources {
  let base = next ?? current,
    values =
      current instanceof OutputResources
        ? current.values
        : SharedMap.empty<Bytes>();
  if (base instanceof OutputResources) {
    for (const [digest, bytes] of base.values.entries())
      values = values.set(digest, bytes);
    base = base.base;
  }
  const keep = new Set(assets.map((asset) => asset.digest));
  values = SharedMap.from(
    [...values.entries()].filter(([digest]) => keep.has(digest)),
  );
  if (base instanceof MemoryResources)
    base = base.retain(assets.filter((asset) => !values.get(asset.digest)));
  return values.size ? new OutputResources(base, values) : base;
}
export function replaceExecutionResources(
  current: Resources,
  next: Resources,
): Resources {
  return current === next || !(current instanceof OutputResources)
    ? next
    : publishExecutionResources(next, new Map(current.values.entries()));
}
