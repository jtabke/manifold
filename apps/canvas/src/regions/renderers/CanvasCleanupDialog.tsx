import { useEffect, useRef, useState } from "react";
import type { RegionSession } from "../document";
import {
  reviewSavedCleanup,
  reclaimSavedCleanup,
  type SavedCleanupReview,
} from "../app/canvasCleanup";
import "../styles/canvasCleanup.css";
const bytes = (n: number) =>
  n < 1024
    ? `${n.toLocaleString()} bytes`
    : `${(n / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`;
const binding = (session: RegionSession) => ({
  document: session.document,
  evidence: session.evidenceSequence,
  recent: session.recentHistory.version,
});
export default function CanvasCleanupDialog({
  session,
  store,
  save,
  close,
}: {
  session: RegionSession;
  store: () => Parameters<typeof reviewSavedCleanup>[1] | undefined;
  save: () => Promise<boolean>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState(() => ({
    review: session.reviewRetention(),
    ...binding(session),
  }));
  const [physical, setPhysical] = useState<
    { review: SavedCleanupReview } & ReturnType<typeof binding>
  >();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      previous?.focus();
    };
  }, []);
  const current = (value: ReturnType<typeof binding>) =>
    value.document === session.document &&
    value.evidence === session.evidenceSequence;
  const historyStale =
      !current(history) || history.recent !== session.recentHistory.version,
    physicalStale = physical && (!current(physical) || !session.isSaved);
  const revisions =
      history.review.before.revisions - history.review.after.revisions,
    results = history.review.before.results - history.review.after.results;
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reviewStorage = async () => {
    if (!(await save()))
      throw Error(
        "Current work could not be saved. Retry local save or export a copy; saved data has not been removed.",
      );
    const local = store();
    if (!local)
      throw Error(
        "Local storage is unavailable; export a copy of current work.",
      );
    const review = await reviewSavedCleanup(session, local);
    setPhysical({ review, ...binding(session) });
  };
  return (
    <dialog
      ref={dialog}
      className="canvas-cleanup"
      aria-labelledby="canvas-cleanup-title"
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
    >
      <header>
        <h2 id="canvas-cleanup-title">Workspace cleanup</h2>
        <button autoFocus disabled={busy} onClick={close}>
          Close
        </button>
      </header>
      <p>
        Current work, kept alternatives and retained Undo/Redo stay available.
        Cleanup removes unused history and cannot itself be undone.
      </p>
      <fieldset disabled={busy}>
        <legend>Retained history</legend>
        <p>
          {revisions.toLocaleString()} unused versions and{" "}
          {results.toLocaleString()} unused checked results can be removed.
        </p>
        <p className="canvas-cleanup-note">
          Results needed by artifacts that Undo or Redo can restore are
          protected. Session calculation history stays intact.
        </p>
        {historyStale && (
          <p role="status">
            Work changed since this review. Review history again before cleaning
            it.
          </p>
        )}
        <button
          onClick={() => {
            setHistory({
              review: session.reviewRetention(),
              ...binding(session),
            });
            setError("");
          }}
        >
          Review history again
        </button>
        <button
          disabled={historyStale || (!revisions && !results)}
          onClick={() =>
            void run(async () => {
              session.compact(history.review);
              setHistory({
                review: session.reviewRetention(),
                ...binding(session),
              });
              setPhysical(undefined);
              setNotice(
                "Unused history was removed from current work. Saving before reviewing obsolete stored data…",
              );
              await reviewStorage();
              setNotice(
                "History cleaned and saved. Review obsolete saved data below.",
              );
            })
          }
        >
          Clean history and save
        </button>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Obsolete saved data</legend>
        <p>
          Review after saving current work. This removes older stored copies and
          interrupted-save leftovers, using the reviewed saved version.
        </p>
        <button onClick={() => void run(reviewStorage)}>
          Save and review stored data
        </button>
        {physical && (
          <>
            <p>
              {bytes(
                physical.review.before.bytes - physical.review.after.bytes,
              )}{" "}
              in{" "}
              {(
                physical.review.before.packages -
                physical.review.after.packages +
                physical.review.before.assets -
                physical.review.after.assets
              ).toLocaleString()}{" "}
              obsolete records can be removed.{" "}
              {bytes(physical.review.after.bytes)} of saved document data stays.
            </p>
            {physicalStale && (
              <p role="status">
                Work changed since the storage review. Save and review again.
              </p>
            )}
            <button
              disabled={
                !!physicalStale ||
                physical.review.before.bytes === physical.review.after.bytes
              }
              onClick={() =>
                void run(async () => {
                  const local = store();
                  if (!local) throw Error("Local storage is unavailable");
                  const result = await reclaimSavedCleanup(
                    session,
                    local,
                    physical.review,
                  );
                  setPhysical(undefined);
                  setNotice(
                    `Removed ${bytes(result.reclaimedBytes)} of obsolete saved data. Current saved work is unchanged.`,
                  );
                })
              }
            >
              Remove obsolete saved data
            </button>
          </>
        )}
        <small>
          Estimates cover saved document data; actual disk space may differ.
          Your older recovery backup stays intact.
        </small>
      </fieldset>
      {busy && <p role="status">Reviewing and saving…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
