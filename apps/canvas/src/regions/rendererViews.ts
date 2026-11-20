import type { Document, View } from "@manifold/foundation";

// View membership/order depends only on this immutable map, not on item heads,
// receipts, or the document wrapper. Cold admission and all renderers share it.
const indexes = new WeakMap<Document["views"], Map<string, View[]>>();
const empty: readonly View[] = Object.freeze([]);
export function rendererViews(
  document: Document,
  renderer: string,
): readonly View[] {
  let index = indexes.get(document.views);
  if (!index) {
    index = new Map();
    for (const [, view] of document.views.entries()) {
      const list = index.get(view.renderer);
      if (list) list.push(view);
      else index.set(view.renderer, [view]);
    }
    for (const list of index.values()) Object.freeze(list);
    indexes.set(document.views, index);
  }
  return index.get(renderer) ?? empty;
}
