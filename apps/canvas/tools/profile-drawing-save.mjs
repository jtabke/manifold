/** Node/memory-backend save diagnostic, not an IndexedDB/disk latency benchmark. */
import assert from "node:assert/strict";
import { Session } from "node:inspector";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { memoryBackend } from "@manifold/foundation";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { drawingFixture } from "../tests/drawing-fixture.mjs";
import { drawings, editDrawings } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import { stats, summarize } from "../tests/drawing-publication-profile.mjs";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const inspector = new Session();
inspector.connect();
const post = (method, params = {}) =>
  new Promise((resolve, reject) =>
    inspector.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
const samples = [],
  profiles = [],
  writes = [];
await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 100 });
try {
  for (let pass = 0; pass < 13; pass++) {
    const { session, ids } = drawingFixture(1999),
      store = canvasLocalStore(memoryBackend());
    try {
      await store.load();
      await store.save(session);
      const entries = drawings(session.document),
        edits = drawingGeometry(entries).transform(
          new Set(ids),
          { x: 0, y: 0 },
          true,
        )({ x: 12, y: 12 });
      editDrawings(session, edits);
      const capture = session.capture();
      if (pass >= 10) await post("Profiler.start");
      const start = performance.now(),
        saved = await store.save(session, capture),
        ms = performance.now() - start;
      if (pass >= 10)
        profiles.push(summarize((await post("Profiler.stop")).profile));
      assert.equal(saved.current, true);
      assert.equal(session.isSaved, true);
      assert(saved.writes.chunks > 0);
      if (pass >= 2 && pass < 10) {
        samples.push(ms);
        writes.push(saved.writes);
      }
    } finally {
      store.close();
      session.dispose();
    }
  }
} finally {
  inspector.disconnect();
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  node: process.version,
  cpu: cpus()[0].model,
  method:
    "1999 mixed marks with one 8192-point stroke; fresh owner and memory backend each pass, initial baseline save outside timer, fixed full-scene resize and owned capture outside timer, then production canvasLocalStore.save using webHash. Two warmups plus eight clean samples. Three additional instrumented inspector captures at 100us interval, reported separately; inspector overhead is not target CPU. Includes packing, hashing, memory-backend commit and ACK; excludes publication, React, IndexedDB, disk and reopen. Self-sample buckets partition time; contexts overlap. These are small device-specific diagnostics, not an end-to-end saving guarantee.",
  saveMs: stats(samples),
  writes,
  profiles,
};
await writeFile(
  new URL(
    "../../../evidence/current/canvas/drawing-save-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { saveMs: report.saveMs, buckets: profiles.map((p) => p.selfBucketsMs) },
    null,
    2,
  ),
);
