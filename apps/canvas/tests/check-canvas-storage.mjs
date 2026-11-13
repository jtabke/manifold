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
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  RegionSession,
  semanticKey,
  project,
} from "../src/regions/document.ts";
import {
  restore,
  decodeWorkspace,
  prepare,
  acceptData,
  archive,
} from "../src/regions/artifacts.ts";
const hash = async (text) =>
  "sha256:" + createHash("sha256").update(text).digest("hex");
const fixture = restore(
  readFileSync(new URL("./canvas-v2.fixture.json", import.meta.url), "utf8"),
);
const session = () =>
  testSession(fixture.page, () => [], fixture.document, fixture.artifacts);
const resume = (data) =>
  testSession(
    data.page,
    () => [],
    data.document,
    data.artifacts,
    false,
    data.recovery,
  );
function receipt(s, time = "2026-10-26T00:00:00.000Z") {
  const a = s.artifacts[0],
    job = prepare(s.state, a),
    data = {
      points: [
        [a.low, 10000 * a.low],
        [a.high, 10000 * a.high],
      ],
      code_sha256: createHash("sha256").update(job.code).digest("hex"),
      runtime: {
        adapter: `bounded-python-sampler/${Math.max(1, ...job.definitions.map((r) => r.mathVersion ?? 1))}`,
        python: "test",
      },
    };
  return { ...acceptData(s.state, a, job, data).receipt, time };
}
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend, hash),
  s = session();
await assert.rejects(store.save(s), /Open and validate/);
assert.equal(await store.load(), undefined);
const first = await store.save(s);
assert.equal(first.current, true);
assert.ok(first.writes.chunks > 0);
const baselineHead = await backend.head(),
  bytes = archive(s.native());
s.keepAlternative(s.artifacts[0].input, "x := 2 mm", {
  context: s.state.active,
  key: semanticKey(s.state),
});
await deliver(s, s.artifacts[0].id, receipt(s));
const held = s.capture();
for (const fault of ["after-assets", "after-package", "before-publish"]) {
  await assert.rejects(store.save(s, held, fault), /Interrupted|Aborted/);
  assert.deepEqual(await backend.head(), baselineHead);
  assert.equal(s.isSaved, false);
  const old = await canvasLocalStore(backend, hash).load();
  assert.equal(old.page.contexts.length, 1);
}
const saved = await store.save(s, held);
assert.equal(saved.current, true);
const reader = canvasLocalStore(backend, hash),
  data = await reader.load(),
  r = resume(data);
assert.equal(project(r.state).solved.values.get("F").value, 20);
assert.equal(r.artifacts[0].comparing, true);
assert.equal(r.artifacts[0].receipt.time, held.artifacts[0].receipt.time);
assert.equal(r.canUndo, false);
assert.equal(reader.acknowledgeRecovery(r), true);
assert.equal(r.isSaved, true);
const unchanged = await reader.save(r);
assert.equal(unchanged.writes.chunks, 0);
assert.equal(unchanged.plannedChunks, 1);
const revs = r.document.revisions;
r.setArtifacts((items) => items.map((a) => ({ ...a, at: { x: 900, y: 300 } })));
const moved = await reader.save(r);
assert.equal(r.document.revisions, revs);
assert.ok(moved.plannedChunks < 12);
// Evidence arriving during Save stays unsaved; both maps publish in one durable head.
const capture = r.capture();
await deliver(r, r.artifacts[0].id, receipt(r, "2026-10-26T01:00:00.000Z"));
const oldAck = await reader.save(r, capture);
assert.equal(oldAck.current, false);
assert.equal(r.isSaved, false);
assert.equal(
  (await canvasLocalStore(backend, hash).load()).artifacts[0].receipt.time,
  held.artifacts[0].receipt.time,
);
await reader.save(r);
assert.equal(r.isSaved, true);
// Two independent stores with the same generation cannot silently overwrite each other.
const a = canvasLocalStore(backend, hash),
  b = canvasLocalStore(backend, hash),
  ad = await a.load(),
  bd = await b.load(),
  as = resume(ad),
  bs = resume(bd);
as.setArtifacts((items) => items.map((a) => ({ ...a, renderer: "table" })));
bs.setArtifacts((items) => items.map((a) => ({ ...a, width: 700 })));
const results = await Promise.allSettled([a.save(as), b.save(bs)]);
assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
assert.equal(results.filter((r) => r.status === "rejected").length, 1);
assert.equal(as.isSaved !== bs.isSaved, true);
// Missing or hash-corrupt records cannot be adopted or establish a new write binding.
const snapshot = await backend.snapshot(),
  head = snapshot.state.head;
const broken = {
  ...backend,
  snapshot: async () => ({
    ...snapshot,
    package: async (key) =>
      key === head.package ? "{}" : snapshot.package(key),
  }),
};
const corrupt = canvasLocalStore(broken, hash);
await assert.rejects(corrupt.load(), /Corrupt/);
await assert.rejects(corrupt.save(r), /Open and validate/);
assert.equal((await decodeWorkspace(bytes)).page.contexts.length, 1);
// Reviewed reclamation traverses the foundation snapshot and does not change current meaning.
const cleanup = canvasLocalStore(backend, hash);
const current = await cleanup.load();
const review = await cleanup.inspect();
await cleanup.reclaim(review);
const after = await canvasLocalStore(backend, hash).load();
assert.deepEqual(after.page, current.page);
assert.deepEqual(after.artifacts, current.artifacts);
// Independent file recipients keep existing identities but allocate distinct new objects.
const left = session(),
  right = session();
const lid = left.create(),
  rid = right.create();
assert.notEqual(lid, rid);
assert.equal(left.write(lid, "Left new work").ok, true);
assert.equal(right.write(rid, "Right new work").ok, true);
assert.equal(left.document.document, right.document.document);
const la = left.branch(),
  ra = right.branch();
assert.notEqual(la, ra);
// The owner rejects work beyond its supported recovery contract before publication.
const bound = session();
for (let n = bound.state.contexts.length; n < 16; n++) bound.branch();
const prior = bound.capture();
assert.throws(() => bound.branch(), /16 scenarios/);
assert.equal(bound.document, prior.document);
const fullPage = {
  regions: Array.from({ length: 256 }, (_, i) => ({
    id: `region-${i + 1}`,
    text: `Note ${i + 1}`,
  })),
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  origin: { x: 110, y: 110 },
  layout: {},
  plots: [],
};
const full = testSession(fullPage),
  accepted = full.document,
  empty = full.create();
assert.equal(full.write(empty, "Beyond supported recovery").ok, false);
assert.equal(full.document, accepted);
// A snapshot larger than the configured recovery budget is rejected before any write.
const largeBase = session(),
  retired = f.SharedMap.from(
    Array.from({ length: 75000 }, (_, i) => ["retired-revision:" + i, true]),
  );
const largeDocument = Object.freeze({
  ...largeBase.document,
  allocated: Object.freeze({
    ...largeBase.document.allocated,
    revisions: f.SharedMap.from([
      ...largeBase.document.allocated.revisions.entries(),
      ...retired.entries(),
    ]),
  }),
});
assert.throws(
  () =>
    testSession(largeBase.state, () => [], largeDocument, largeBase.artifacts),
  /recovery budget/,
  "oversize retained state rejects before live adoption, rather than at Save",
);
const bounded = resume(after),
  size = bounded.capture().storageUpperBytes,
  inventory = await backend.inspect();
assert.ok(
  size >= inventory.after.bytes,
  "reachable payload bound covers the stored graph",
);
console.log(
  "Canvas storage: one authored/evidence snapshot, three rollback points, stale ACKs, validated warm recovery, incremental moves, two-writer CAS, corrupt input rejection and snapshot reclamation pass.",
);
