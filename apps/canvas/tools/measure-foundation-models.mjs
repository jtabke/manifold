/** Actual application model commands, checked scalar evidence and memory-backed Save/recovery. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  insertModel,
  modelReference,
  modelRequest,
  setModelInput,
  reviewModelCsv,
  applyModelConnection,
} from "../src/regions/modelCommands.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const stats = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
const csv =
    "x,noise\n" +
    Array.from({ length: 10000 }, () => "7," + "z".repeat(90)).join("\n"),
  rows = [];
for (const count of [1, 16, 64]) {
  const session = new RegionSession(),
    dataset = session.importData("measurements.csv", csv, { x: 100, y: 800 }),
    models = [];
  for (let i = 0; i < count; i++) {
    const instance = insertModel(session, "spring", {
      x: 100 + (i % 8) * 450,
      y: 100 + Math.floor(i / 8) * 550,
    });
    applyModelConnection(
      session,
      reviewModelCsv(session, instance, "displacement", dataset, i, 0, "mm"),
    );
    models.push(instance);
  }
  let started = performance.now();
  for (let i = 0; i < models.length; i += 4)
    await Promise.all(
      models
        .slice(i, i + 4)
        .map(
          (id) =>
            session.compute(modelReference(session.document, modelRequest(id)))
              .completion,
        ),
    );
  const computeMs = performance.now() - started,
    receipts = [...session.foundation.evidence().entries()].map(
      ([, receipt]) => receipt,
    );
  assert.equal(receipts.length, count);
  const closureRevisions = receipts.map((r) => r.context.revisions.size),
    snapshotBytes = receipts.map((r) => f.byteLength(f.canonical(r.snapshot)));
  assert.ok(closureRevisions.every((n) => n === 5));
  assert.ok(snapshotBytes.every((n) => n < 4096));
  const backend = f.memoryBackend();
  let hashBytes = 0;
  const store = canvasLocalStore(backend, async (text) => {
    hashBytes += f.byteLength(text);
    return f.webHash(text);
  });
  await store.load();
  await store.save(session);
  const editMs = [],
    saveBytes = [],
    savedHashBytes = [],
    viewBytes = [];
  for (let i = 0; i < 35; i++) {
    started = performance.now();
    setModelInput(session, models[0], "stiffness", 10 + (i % 2));
    if (i >= 5) editMs.push(performance.now() - started);
    hashBytes = 0;
    const edited = await store.save(session);
    const revisionMap = session.document.revisions,
      view = session.document.views.get(models[0] + ":view");
    if (i >= 5) {
      saveBytes.push(edited.writes.chunkBytes);
      savedHashBytes.push(hashBytes);
    }
    session.arrange({ [view.id]: { x: view.x + 1, y: view.y } });
    assert.equal(session.document.revisions, revisionMap);
    const moved = await store.save(session);
    if (i >= 5) viewBytes.push(moved.writes.chunkBytes);
  }
  assert.ok(
    Math.max(...savedHashBytes) < csv.length / 4,
    "local model saves cannot rehash the CSV",
  );
  const native = archive(session.native()),
    nativeSourceOccurrences = native.split('"csv":').length - 1;
  assert.equal(nativeSourceOccurrences, 1);
  started = performance.now();
  const decoded = await decodeWorkspace(native),
    nativeReadMs = performance.now() - started;
  const reader = canvasLocalStore(backend);
  started = performance.now();
  const loaded = await reader.load(),
    localReadMs = performance.now() - started;
  started = performance.now();
  const recovered = new RegionSession(
      loaded.page,
      () => [],
      loaded.document,
      loaded.artifacts,
      false,
      loaded.recovery,
    ),
    adoptMs = performance.now() - started;
  assert.equal(reader.acknowledgeRecovery(recovered), true);
  const unchanged = await reader.save(recovered);
  assert.equal(unchanged.writes.chunks, 0);
  assert.equal(decoded.recovery.foundation.receipts.length, count);
  assert.equal(
    f.captureContext(
      session.document,
      modelReference(session.document, modelRequest(models.at(-1))),
      canvasSchemas,
    ).revisions.size,
    5,
  );
  rows.push({
    instances: count,
    definitions: 1,
    sourceBytes: f.byteLength(csv),
    nativeBytes: f.byteLength(native),
    nativeSourceOccurrences,
    receipts: receipts.length,
    closureRevisions: stats(closureRevisions),
    snapshotBytes: stats(snapshotBytes),
    computeMs,
    edits30Ms: stats(editMs),
    editSaveBytes: stats(saveBytes),
    editSaveHashBytes: stats(savedHashBytes),
    viewSaveBytes: stats(viewBytes),
    nativeReadMs,
    localReadMs,
    ownerAdoptMs: adoptMs,
    unchangedRecoveredSaveChunks: unchanged.writes.chunks,
  });
  session.dispose();
  recovered.dispose();
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    arch: arch(),
  },
  method:
    "1/16/64 real canvas spring instances, one shared pinned definition, one 930,007-byte CSV with independently reviewed pinned observations. Compute batches of four; 5 warmups +30 literal stiffness edits and view Save pairs. Memory backend, not IndexedDB latency. Model capture is exactly five revisions regardless of independent instance count; snapshots carry no CSV bytes. Local saves must not rehash the source. Native and local full reads/adoption are single diagnostics. Excludes React, rendering, network, process heap and product capacity acceptance.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/foundation-models-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
