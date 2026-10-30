import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as h from "./helpers.mjs";
const redo = (w) => {
  const got = w.owner.redo(w.reader.stamp(), h.id("redo"));
  assert(got.ok, got.error);
};
const force = (w) => f.current(w.reader.read(), "force").body.value;
test("Redo shares bounded authored history, preserves evidence and clears only on accepted new branches", async () => {
  const w = await h.workspace(undefined, undefined, { historyLimit: 2 });
  h.force(w, 100);
  h.force(w, 200);
  h.force(w, 300);
  await h.compute(w);
  const receipts = w.reader.evidence();
  h.undo(w);
  h.undo(w);
  assert.equal(force(w), 100);
  assert.equal(w.diagnostics().redoSteps, 2);
  const stale = w.reader.stamp();
  redo(w);
  assert.equal(force(w), 200);
  assert.equal(w.owner.redo(stale, h.id("stale")).ok, false);
  assert.equal(w.diagnostics().redoSteps, 1);
  redo(w);
  assert.equal(force(w), 300);
  assert.equal(w.reader.evidence(), receipts);
  assert.equal(w.diagnostics().undoSteps, 2);
  h.undo(w);
  const before = w.reader.read();
  assert.equal(
    w.owner.apply(w.reader.stamp(), h.id("bad"), [
      { kind: "delete", item: "missing" },
    ]).ok,
    false,
  );
  assert.equal(w.reader.read(), before);
  assert.equal(w.diagnostics().redoSteps, 1);
  h.force(w, 400);
  assert.equal(w.diagnostics().redoSteps, 0);
  assert.equal(w.owner.redo(w.reader.stamp(), h.id("empty")).ok, false);
  w.owner.dispose();
});
test("Redo candidate validation is atomic; preview blocks Redo and Open clears it", async () => {
  let reject = false;
  const w = await h.workspace(undefined, undefined, {
    validateState: () => {
      if (reject) throw Error("Capacity refused");
    },
  });
  h.force(w, 200);
  h.undo(w);
  const before = w.reader.read();
  reject = true;
  assert.equal(w.owner.redo(w.reader.stamp(), h.id("refused")).ok, false);
  assert.equal(w.reader.read(), before);
  assert.equal(w.diagnostics().redoSteps, 1);
  assert.equal(w.diagnostics().undoSteps, 0);
  reject = false;
  h.preview(w, 300);
  assert.equal(w.owner.redo(w.reader.stamp(), h.id("preview-redo")).ok, false);
  assert.equal(w.diagnostics().redoSteps, 1);
  assert(w.owner.cancelPreview(w.reader.stamp()).ok);
  redo(w);
  assert.equal(force(w), 200);
  h.undo(w);
  assert(w.owner.open(w.reader.stamp(), await h.initial()).ok);
  assert.equal(w.diagnostics().redoSteps, 0);
  w.owner.dispose();
});
test("reviewed compaction protects the Redo closure without persisting session history", async () => {
  const w = await h.workspace();
  h.force(w, 200);
  const revision = f.current(w.reader.read(), "force").id;
  h.undo(w);
  const review = w.reader.reviewCompaction({ evidence: "reachable" });
  assert(!review.removedRevisions.includes(revision));
  assert(w.owner.compact(w.reader.stamp(), h.id("compact"), review).ok);
  redo(w);
  assert.equal(f.current(w.reader.read(), "force").id, revision);
  h.undo(w);
  const loaded = await f.decode(h.serialized(w), h.schemas, h.methods, h.hash);
  const fresh = await h.workspace(undefined, loaded);
  assert.equal(fresh.diagnostics().redoSteps, 0);
  w.owner.dispose();
  fresh.owner.dispose();
});
