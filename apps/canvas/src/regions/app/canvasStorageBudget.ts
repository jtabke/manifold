/** Conservative reachable-payload bound for this application's full-reader storage contract. */
import {
  SharedMap,
  json,
  byteLength,
  type Document,
  type SaveCapture,
  type Schemas,
  receiptData,
  contextToPlain,
  receiptAssets,
  assert,
  type WorkspaceState,
} from "@manifold/foundation";
export const MAX_CANVAS_LOCAL_BYTES = 64 * 1024 * 1024;
/** Transport has headroom for validated legacy rescue; it does not increase admitted work. */
export const MAX_CANVAS_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_CANVAS_RECEIPTS = 4096;
export const CANVAS_NATIVE_LIMITS = Object.freeze({
  maxBytes: MAX_CANVAS_FILE_BYTES,
  maxRecords: 100000,
  maxReceipts: 100000,
});
/** Ordering changes JSON byte order, not its UTF-8 length. Keep full validation, not canonicalization. */
function jsonBytes(value: unknown) {
  json(value);
  return byteLength(JSON.stringify(value));
}
export class CanvasStorageBudget {
  readonly #maps = new Map<string, WeakMap<object, number>>();
  readonly #values = new WeakMap<object, number>();
  estimate(
    document: Document,
    foundation: Pick<SaveCapture, "receipts"> | undefined,
    schemas: Schemas,
  ): number {
    const valueBytes = (
      value: unknown,
      project: (value: unknown) => unknown,
    ) => {
      if (value !== null && typeof value === "object") {
        const old = this.#values.get(value);
        if (old !== undefined) return old;
        const size = jsonBytes(project(value));
        this.#values.set(value, size);
        return size;
      }
      return jsonBytes(project(value));
    };
    const map = <T>(
      kind: string,
      values: SharedMap<T>,
      project: (value: T) => unknown = (value) => value,
      extra: (value: T) => number = () => 0,
    ) => {
      let memo = this.#maps.get(kind);
      if (!memo) {
        memo = new WeakMap();
        this.#maps.set(kind, memo);
      }
      return (
        values.fold(
          (key, value, left, right) =>
            (left ?? 0) +
            (right ?? 0) +
            jsonBytes(key) +
            valueBytes(value, (v) => project(v as T)) +
            extra(value) +
            896,
          memo,
        ) ?? 0
      );
    };
    let assetMemo = this.#maps.get("asset-bounds");
    if (!assetMemo) {
      assetMemo = new WeakMap();
      this.#maps.set("asset-bounds", assetMemo);
    }
    const assetBytes =
      document.revisions.fold(
        (_key, revision, left, right) =>
          (left ?? 0) +
          (right ?? 0) +
          (schemas.get(revision.schema)?.assets(revision.body) ?? []).reduce(
            (n, asset) =>
              n + (asset.disposition === "included" ? asset.size * 6 + 896 : 0),
            0,
          ),
        assetMemo,
      ) ?? 0;
    // Map-node/value envelopes are at most this fixed overhead plus their actual key/value JSON.
    // Counting shared values more than once is intentional: the result is an upper bound.
    return (
      4096 +
      map("items", document.items) +
      map("revisions", document.revisions) +
      map("views", document.views) +
      map(
        "alternatives",
        document.alternatives,
        (value) => ({ ...value, context: contextToPlain(value.context) }),
        (value) =>
          896 * (value.context.heads.size + value.context.revisions.size),
      ) +
      map("known", document.known) +
      Object.entries(document.allocated).reduce(
        (n, [kind, ids]) => n + map("allocated:" + kind, ids),
        0,
      ) +
      (foundation
        ? map(
            "core-receipts",
            foundation.receipts,
            receiptData,
            (value) =>
              896 * (value.context.heads.size + value.context.revisions.size) +
              receiptAssets(value).reduce(
                (n, asset) =>
                  n +
                  (asset.disposition === "included" ? asset.size * 6 + 896 : 0),
                0,
              ),
          )
        : 0) +
      assetBytes
    );
  }
  check(state: WorkspaceState, schemas: Schemas) {
    const bytes = this.estimate(state.document, state, schemas);
    assert(
      Number.isSafeInteger(bytes) &&
        bytes <= MAX_CANVAS_LOCAL_BYTES &&
        state.receipts.size <= MAX_CANVAS_RECEIPTS,
      "Workspace exceeds its shared recovery budget; review retained history or use a smaller workspace",
    );
    return bytes;
  }
}
