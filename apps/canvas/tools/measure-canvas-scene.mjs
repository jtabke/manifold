/** Authored layout costs, including pinned named layouts, over actual checked/source-backed work. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import * as f from "@manifold/foundation";
import { sceneFixture } from "../tests/scene-fixture.mjs";
import { RegionSession } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { SCENE_ITEM, MAX_SCENE_BYTES } from "../src/regions/sceneRecords.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const stats = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
const rows = [];
for (const count of [1, 8, 24]) {
  const { session, csv } = await sceneFixture(count, true);
  const view = session.scene.viewpoints[0];
  session.setScene({
    ...session.scene,
    viewpoints: Array.from({ length: 12 }, (_, i) => ({
      ...view,
      id: "viewpoint-" + i,
      name: "Layout " + i,
    })),
  });
  const sourceResources = session.native().resources;
  const index = f.current(session.document, SCENE_ITEM);
  const captured = session.scene.viewpoints;
  const backend = f.memoryBackend();
  let hashBytes = 0;
  const store = canvasLocalStore(backend, async (text) => {
    hashBytes += f.byteLength(text);
    return "sha256:" + createHash("sha256").update(text).digest("hex");
  });
  await store.load();
  await store.save(session);
  const edits = [],
    hashes = [],
    bytes = [],
    writes = [];
  let changedRevisions = 0;
  for (let i = 0; i < 35; i++) {
    const before = session.document.revisions.size;
    let start = performance.now();
    session.setScene((scene) => ({
      ...scene,
      tools: scene.tools.map((tool, j) =>
        j ? tool : { ...tool, at: { x: 720 + i + 1, y: 140 } },
      ),
    }));
    const editMs = performance.now() - start;
    changedRevisions = Math.max(
      changedRevisions,
      session.document.revisions.size - before,
    );
    assert.equal(f.current(session.document, SCENE_ITEM), index);
    assert.deepEqual(session.scene.viewpoints, captured);
    hashBytes = 0;
    const saved = await store.save(session);
    assert.equal(saved.writes.assetBytes, 0);
    if (i >= 5) {
      edits.push(editMs);
      hashes.push(hashBytes);
      bytes.push(saved.writes.chunkBytes);
      writes.push(saved.writes.chunks);
    }
  }
  assert.equal(changedRevisions, 1);
  assert.ok(
    Math.max(...hashes) <= 16 * 1024,
    "scene move Save hashing must stay bounded and exclude source bytes",
  );
  const cachedScene = session.scene;
  let start = performance.now();
  for (let i = 0; i < 1000; i++) assert.equal(session.scene, cachedScene);
  const reads1000Ms = performance.now() - start;
  const native = archive(session.native());
  assert.equal(native.split(JSON.stringify(csv)).length - 1, 1);
  assert.equal(session.native().resources, sourceResources);
  start = performance.now();
  const decoded = await decodeWorkspace(native);
  const nativeReadMs = performance.now() - start;
  const reader = canvasLocalStore(backend);
  start = performance.now();
  const loaded = await reader.load();
  const localReadMs = performance.now() - start;
  const recovered = new RegionSession(
    loaded.page,
    () => [],
    loaded.document,
    loaded.artifacts,
    false,
    loaded.recovery,
  );
  assert.equal(reader.acknowledgeRecovery(recovered), true);
  const unchanged = await reader.save(recovered);
  assert.equal(unchanged.writes.chunks, 0);
  assert.deepEqual(recovered.scene, session.scene);
  assert.equal(decoded.artifacts[0].receipt.points.length, 201);
  const uniqueSceneRevisions = [...session.document.revisions.entries()].filter(
    ([, revision]) => revision.schema.startsWith("canvas-scene-"),
  );
  const retainedSceneBytes = uniqueSceneRevisions.reduce(
    (sum, [, revision]) => sum + f.byteLength(f.canonical(revision)),
    0,
  );
  assert.ok(retainedSceneBytes <= MAX_SCENE_BYTES);
  rows.push({
    tools: count,
    namedLayouts: 12,
    sourceBytes: f.byteLength(csv),
    sourceCopies: 1,
    changedRevisions,
    edits30Ms: stats(edits),
    saveHashBytes: stats(hashes),
    saveChunkBytes: stats(bytes),
    saveChunks: stats(writes),
    sourceBytesWrittenOnMove: 0,
    reads1000Ms,
    nativeBytes: f.byteLength(native),
    retainedSceneRevisions: uniqueSceneRevisions.length,
    retainedSceneBytes,
    nativeReadMs,
    localReadMs,
    unchangedRecoveredChunks: unchanged.writes.chunks,
  });
  session.dispose();
  recovered.dispose();
  store.close();
  reader.close();
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
  limits: { sceneBytes: MAX_SCENE_BYTES, moveSaveHashBytes: 16 * 1024 },
  method:
    "1/8/24 actual canvas tool representations, 12 pinned named layouts sharing their group/tool revisions, one model, one 900,014-byte CSV and one checked 201-point receipt. Five warmups +30 tool move/Save pairs over the memory backend; exact one new tool revision, unchanged index/named captures, zero source writes. One thousand cached scene reads and full native/local reads are diagnostics. Native contains the source exactly once and local recovery saves zero chunks. Times exclude React/input/rendering, network and IndexedDB latency; this report does not establish interactive or process-memory capacity.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/canvas-scene-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
