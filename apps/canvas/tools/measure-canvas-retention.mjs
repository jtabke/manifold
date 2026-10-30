import { testSession, deliver } from "../tests/sampling-test-helpers.mjs";
/** Maintenance work is explicit and measured separately from ordinary edits/saves. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cpus, platform, release, arch } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { restore, prepare, acceptData } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  reviewSavedCleanup,
  reclaimSavedCleanup,
} from "../src/regions/app/canvasCleanup.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const fixture = restore(
  readFileSync(
    new URL("../tests/canvas-v2.fixture.json", import.meta.url),
    "utf8",
  ),
);
const hash = async (s) =>
  "sha256:" + createHash("sha256").update(s).digest("hex");
const dist = (xs) => {
  xs.sort((a, b) => a - b);
  return {
    min: xs[0],
    median: xs[Math.floor(xs.length / 2)],
    p95: xs[Math.ceil(xs.length * 0.95) - 1],
    max: xs.at(-1),
  };
};
const rows = [];
for (const edits of [100, 1000]) {
  const s = testSession(
      fixture.page,
      () => [],
      fixture.document,
      fixture.artifacts,
    ),
    backend = f.memoryBackend(),
    local = canvasLocalStore(backend, hash);
  await local.load();
  await local.save(s);
  const csv =
    "value\n" +
    Array.from({ length: 2000 }, (_, i) => i.toString().padStart(50, "0")).join(
      "\n",
    );
  s.importData("measurements.csv", csv, { x: 200, y: 800 });
  const a = s.artifacts[0],
    job = prepare(s.state, a);
  const receipt = acceptData(s.state, a, job, {
    points: [
      [a.low, a.low * 10000],
      [a.high, a.high * 10000],
    ],
    code_sha256: createHash("sha256").update(job.code).digest("hex"),
    runtime: { adapter: "bounded-python-sampler/1", python: "diagnostic" },
  }).receipt;
  await deliver(s, a.id, receipt);
  await local.save(s);
  s.setArtifacts([]);
  for (let i = 0; i < edits; i++) {
    s.write("region-1", `k := ${10 + i} N/mm`);
    await local.save(s);
  }
  const captured = s.capture(),
    undoBefore = s.canUndo,
    reviews = [];
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    s.reviewRetention();
    if (i >= 5) reviews.push(performance.now() - start);
  }
  const review = s.reviewRetention(),
    applyStart = performance.now();
  s.compact(review);
  const applyMs = performance.now() - applyStart;
  const saveStart = performance.now();
  await local.save(s);
  const saveMs = performance.now() - saveStart;
  const physicalStart = performance.now(),
    physical = await reviewSavedCleanup(s, local),
    physicalReviewMs = performance.now() - physicalStart;
  const reclaimStart = performance.now(),
    reclaimed = await reclaimSavedCleanup(s, local, physical),
    reclaimMs = performance.now() - reclaimStart;
  const reader = canvasLocalStore(backend, hash),
    openStart = performance.now(),
    loaded = await reader.load(),
    reopenMs = performance.now() - openStart;
  if (
    loaded.document.revisions.size !== review.after.revisions ||
    loaded.recovery.foundation.receipts.length !== review.after.results ||
    s.canUndo !== undoBefore
  )
    throw Error("Maintenance changed protected state");
  rows.push({
    edits,
    sourceBytes: f.byteLength(csv),
    historySteps: review.undoSteps,
    before: review.before,
    after: review.after,
    beforeBudgetUpperBytes: captured.storageUpperBytes,
    afterBudgetUpperBytes: s.capture().storageUpperBytes,
    review30Ms: dist(reviews),
    applyMs,
    followingSaveMs: saveMs,
    physicalBefore: physical.before,
    physicalAfter: physical.after,
    physicalReviewMs,
    reclaimMs,
    reclaimed,
    fullReopenMs: reopenMs,
    retiredItemMarkers: s.document.known.size,
  });
}
const result = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "100/1000 edits, each saved, with one unchanged 102,005-byte CSV and one removed artifact checked result. Retain 256 Undo selections. 5 warmups +30 full history reviews; apply, Save, physical review/reclaim and full reopen are single diagnostics. Memory-backend timings are not IndexedDB latency. Actual serialized payload bytes exclude keys/index/disk overhead; conservative budget includes per-record allowances. 100 edits preserve the removed artifact result via Undo; 1000 edits make that result unreachable. The CSV remains active in both cases. Lifetime identity markers and session calculation history remain. No product capacity, heap or latency claim.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/canvas-retention-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
