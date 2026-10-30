import { decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  testSession,
  deliver,
  recovery,
  evidence as evidenceMap,
} from "./sampling-test-helpers.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import {
  restore,
  prepare,
  acceptData,
  archive,
} from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  reviewSavedCleanup,
  reclaimSavedCleanup,
} from "../src/regions/app/canvasCleanup.ts";
const fixture = restore(
  readFileSync(new URL("./canvas-v2.fixture.json", import.meta.url), "utf8"),
);
const make = () =>
  testSession(fixture.page, () => [], fixture.document, fixture.artifacts);
const hash = async (s) =>
  "sha256:" + createHash("sha256").update(s).digest("hex");
async function result(s) {
  const a = s.artifacts[0],
    job = prepare(s.state, a);
  const receipt = acceptData(s.state, a, job, {
    points: [
      [a.low, a.low * 10000],
      [a.high, a.high * 10000],
    ],
    code_sha256: createHash("sha256").update(job.code).digest("hex"),
    runtime: { adapter: "bounded-python-sampler/1", python: "test" },
  }).receipt;
  assert.equal(await deliver(s, a.id, receipt), true);
  return receipt;
}
// Deleted artifacts retain their checked historical observations while Undo can restore them.
const s = make(),
  receipt = await result(s),
  artifact = s.artifacts[0];
s.setArtifacts([]);
let review = s.reviewRetention();
assert.equal(review.after.results, 1);
const events = [];
s.subscribe(() => events.push(s.capture()));
const history = s.document,
  evidence = s.evidenceSequence;
s.compact(review);
assert.equal(events.length, 1, "cleanup publishes both maps once");
assert.ok(s.evidenceSequence > evidence);
assert.equal(s.canUndo, true);
assert.equal(s.document.known, history.known);
assert.equal(s.document.allocated, history.allocated);
assert.throws(() => s.compact(review), /stale|another/);
s.undo();
assert.equal(s.artifacts[0].receipt.key, receipt.key);
assert.deepEqual(s.artifacts[0].receipt.definitions, receipt.definitions);
assert.equal(project(s.state).solved.values.get("F").value, 10);
// Advancing beyond bounded Undo makes the deleted artifact payload/result eligible.
s.setArtifacts([]);
for (let i = 0; i < 270; i++)
  assert.equal(s.write("region-1", `k := ${10 + i} N/mm`).ok, true);
review = s.reviewRetention();
assert.ok(review.before.revisions > review.after.revisions);
assert.equal(review.before.results, 1);
assert.equal(review.after.results, 0);
const before = s.capture(),
  backend = f.memoryBackend(),
  store = canvasLocalStore(backend, hash);
await store.load();
await store.save(s);
const durable = await backend.snapshot();
s.compact(review);
assert.equal(evidenceMap(s).size, 0);
assert.equal(s.document.allocated, before.document.allocated);
assert.equal(s.document.known.get("artifact:" + artifact.id), true);
await assert.rejects(
  store.save(s, s.capture(), "before-publish"),
  /Interrupted|Aborted/,
);
assert.deepEqual((await backend.snapshot()).state, durable.state);
assert.equal(s.isSaved, false);
await assert.rejects(reviewSavedCleanup(s, store), /Save current/);
await store.save(s);
let physical = await reviewSavedCleanup(s, store);
assert.ok(physical.before.bytes > physical.after.bytes);
await assert.rejects(
  reclaimSavedCleanup(s, store, { ...physical }),
  /stale|another/,
);
await assert.rejects(
  reclaimSavedCleanup(s, store, physical, true),
  /Interrupted|Aborted/,
);
assert.equal((await store.inspect()).before.bytes, physical.before.bytes);
const cleaned = await reclaimSavedCleanup(s, store, physical);
assert.ok(cleaned.reclaimedBytes > 0);
await assert.rejects(reclaimSavedCleanup(s, store, physical), /stale|another/);
const reader = canvasLocalStore(backend, hash),
  loaded = await reader.load();
assert.equal(loaded.recovery.foundation.receipts.length, 0);
assert.equal(loaded.document.revisions.size, s.document.revisions.size);
assert.equal(loaded.document.known.get("artifact:" + artifact.id), true);
const native = await decodeWorkspace(archive(s.native()));
assert.equal(native.document.known.get("artifact:" + artifact.id), true);
const portable = testSession(
  native.page,
  () => [],
  native.document,
  native.artifacts,
);
assert.throws(
  () => portable.setArtifacts([artifact]),
  /retired|unavailable|reuse|retained/i,
);
// All retained Undo selections still work after semantic and physical cleanup.
for (let i = 0; i < 256; i++) s.undo();
assert.equal(s.canUndo, false);
assert.equal(
  s.state.regions.find((r) => r.id === "region-1").text,
  "k := 23 N/mm",
);
assert.equal(s.artifacts.length, 0);
// Stale reviews reject atomically after edits, Undo and evidence arrival; foreign owners reject.
const t = make();
for (const action of [
  () => t.write("region-1", "k := 11 N/mm"),
  () => t.undo(),
  () => result(t),
]) {
  review = t.reviewRetention();
  await action();
  const cap = t.capture();
  assert.throws(() => t.compact(review), /stale|another/);
  assert.equal(t.document, cap.document);
  assert.equal(evidenceMap(t), cap.foundation.receipts);
}
assert.throws(() => make().compact(t.reviewRetention()), /stale|another/);
// Checked output already being verified survives maintenance when its current inputs stay valid.
const late = make(),
  lateReview = late.reviewRetention(),
  arriving = result(late);
assert.throws(() => late.compact(lateReview), /stale/);
late.compact(late.reviewRetention());
await arriving;
assert.equal(evidenceMap(late).size, 1);
assert.equal(late.evidenceSequence, 2);
// Legacy kept context and comparison remain numerically coherent through cleanup and Undo.
const kept = make();
kept.keepAlternative(kept.artifacts[0].input, "x := 2 mm", {
  context: kept.state.active,
  key: semanticKey(kept.state),
});
const keptReview = kept.reviewRetention();
assert.equal(keptReview.undoSteps, 1);
kept.compact(keptReview);
assert.equal(project(kept.state).solved.values.get("F").value, 20);
assert.equal(kept.artifacts[0].comparing, true);
kept.undo();
assert.equal(project(kept.state).solved.values.get("F").value, 10);
assert.equal(kept.artifacts[0].comparing, undefined);
// Physical reviews bind the saved app capture and the durable generation, not just the DB handle.
await store.save(s);
physical = await reviewSavedCleanup(s, store);
s.write("region-1", "k := 25 N/mm");
await assert.rejects(reclaimSavedCleanup(s, store, physical), /stale|another/);
await store.save(s);
const competing = canvasLocalStore(backend, hash),
  other = await competing.load(),
  otherSession = testSession(
    other.page,
    () => [],
    other.document,
    other.artifacts,
    false,
    other.recovery,
  );
competing.acknowledgeRecovery(otherSession);
physical = await reviewSavedCleanup(s, store);
otherSession.write("region-1", "k := 26 N/mm");
await competing.save(otherSession);
await assert.rejects(
  reclaimSavedCleanup(s, store, physical),
  /changed|stale|conflict/i,
);
await assert.rejects(reviewSavedCleanup(s, store), /another tab/);
console.log(
  "Canvas retention: protected historical artifacts/results and 256 Undo selections, atomic sealed reviews, identity/evidence continuity, save faults, reclamation rollback, validated reload and cross-tab conflict guards pass.",
);
