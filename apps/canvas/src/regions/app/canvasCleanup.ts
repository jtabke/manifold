/** App-capture checks complement the backend's atomic saved-head/epoch/revision guards. */
import { assert } from "@manifold/foundation";
import type { RegionSession } from "../document.ts";
import type { CanvasLocalStore } from "./canvasLocalStore.ts";
type Inspection = Awaited<ReturnType<CanvasLocalStore["inspect"]>>;
export type SavedCleanupReview = Readonly<Pick<Inspection, "before" | "after">>;
const reviews = new WeakMap<
  SavedCleanupReview,
  {
    session: RegionSession;
    store: CanvasLocalStore;
    capture: ReturnType<RegionSession["capture"]>;
    inspection: Inspection;
  }
>();
function current(
  session: RegionSession,
  capture: ReturnType<RegionSession["capture"]>,
) {
  return (
    session.isSaved &&
    session.document === capture.document &&
    session.evidenceSequence === capture.evidence
  );
}
export async function reviewSavedCleanup(
  session: RegionSession,
  store: CanvasLocalStore,
): Promise<SavedCleanupReview> {
  assert(session.isSaved, "Save current work before reviewing saved storage");
  const capture = session.capture(),
    inspection = await store.inspect();
  assert(
    current(session, capture),
    "Work changed during storage review; review again",
  );
  const head = inspection.snapshot.state.head;
  assert(
    head &&
      head.root === capture.document.id &&
      head.generation === store.generation,
    "Saved storage changed in another tab; export current work before reloading",
  );
  const review = Object.freeze({
    before: inspection.before,
    after: inspection.after,
  });
  reviews.set(review, { session, store, capture, inspection });
  return review;
}
export async function reclaimSavedCleanup(
  session: RegionSession,
  store: CanvasLocalStore,
  review: SavedCleanupReview,
  abort = false,
) {
  const state = reviews.get(review);
  assert(
    state &&
      state.session === session &&
      state.store === store &&
      current(session, state.capture),
    "Storage cleanup review is stale or belongs to another workspace",
  );
  const result = await store.reclaim(state.inspection, abort);
  reviews.delete(review);
  return result;
}
