import { assert } from "./value.ts";
import { validateAsset } from "./content.ts";
import type { Asset, Resources, ResourceRead } from "./contracts.ts";
export type Hash = (text: string) => Promise<string>;
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).byteLength;
/** Immutable verified strings; no global cache survives a document binding. Binary/range providers can implement Resources separately. */
export class MemoryResources implements Resources {
  readonly #data: ReadonlyMap<string, Readonly<{ text: string; size: number }>>;
  private constructor(
    data: ReadonlyMap<string, Readonly<{ text: string; size: number }>>,
  ) {
    this.#data = data;
    Object.freeze(this);
  }
  static async verify(
    entries: Iterable<readonly [string, string]>,
    hash: Hash,
    maxBytes = 64 * 1024 * 1024,
  ): Promise<MemoryResources> {
    const data = new Map<string, Readonly<{ text: string; size: number }>>();
    let bytes = 0;
    for (const [key, text] of entries) {
      assert(
        /^sha256:[a-f0-9]{64}$/.test(key) && typeof text === "string",
        "Invalid asset bytes",
      );
      const size = byteLength(text);
      bytes += size;
      assert(bytes <= maxBytes, "Asset byte budget exceeded");
      assert((await hash(text)) === key, "Asset digest mismatch");
      assert(!data.has(key), "Duplicate asset digest");
      data.set(key, Object.freeze({ text, size }));
    }
    return new MemoryResources(data);
  }
  read(asset: Asset): ResourceRead {
    validateAsset(asset);
    const entry = this.#data.get(asset.digest);
    if (entry === undefined)
      return {
        status: asset.disposition === "included" ? "missing" : "unavailable",
        reason: "Source bytes are not available",
      };
    if (entry.size !== asset.size)
      return { status: "corrupt", reason: "Asset size mismatch" };
    return { status: "ready", data: entry.text };
  }
  async add(asset: Asset, text: string, hash: Hash): Promise<MemoryResources> {
    validateAsset(asset);
    assert(
      byteLength(text) === asset.size && (await hash(text)) === asset.digest,
      "New asset integrity mismatch",
    );
    const data = new Map(this.#data);
    data.set(asset.digest, Object.freeze({ text, size: asset.size }));
    return new MemoryResources(data);
  }
  /** Select already verified immutable bytes without rereading/hashing or deleting another provider's data. */
  retain(assets: Iterable<Asset>): MemoryResources {
    const data = new Map<string, Readonly<{ text: string; size: number }>>();
    for (const a of assets) {
      validateAsset(a);
      const entry = this.#data.get(a.digest);
      assert(
        entry || a.disposition === "linked",
        "Missing included resource during retention",
      );
      if (entry) {
        assert(entry.size === a.size, "Retained asset size mismatch");
        data.set(a.digest, entry);
      }
    }
    return new MemoryResources(data);
  }
  diagnostics() {
    let bytes = 0;
    for (const entry of this.#data.values()) bytes += entry.size;
    return Object.freeze({ assets: this.#data.size, bytes });
  }
  *entries() {
    for (const [key, value] of this.#data) yield [key, value.text] as const;
  }
}
export async function asset(
  text: string,
  hash: Hash,
  mediaType = "application/json",
  disposition: Asset["disposition"] = "included",
): Promise<Asset> {
  return Object.freeze({
    digest: await hash(text),
    size: byteLength(text),
    mediaType,
    disposition,
  });
}
export const webHash: Hash = async (text) =>
  "sha256:" +
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
