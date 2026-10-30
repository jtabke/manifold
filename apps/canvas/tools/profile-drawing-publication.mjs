/** Bounded source-owner diagnostic: fresh owned fixture per pass avoids history/capacity drift. */
import assert from "node:assert/strict";
import { Session } from "node:inspector";
import { writeFile } from "node:fs/promises";
import { cpus } from "node:os";
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
const timings = { geometry: [], commit: [], undo: [] },
  profiles = [],
  cloneTimings = [];
await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 100 });
try {
  // Two clean warmups, eight clean samples, then three separately instrumented samples.
  for (let pass = 0; pass < 13; pass++) {
    const { session, ids } = drawingFixture(1999);
    let phase,
      commits = 0,
      undos = 0;
    const unsubscribe = session.foundation.subscribe(() => {
      if (phase === "commit") commits++;
      if (phase === "undo") undos++;
    });
    try {
      const entries = drawings(session.document),
        transform = drawingGeometry(entries).transform(
          new Set(ids),
          { x: 0, y: 0 },
          true,
        );
      let start = performance.now();
      const edits = transform({ x: 12, y: 12 }),
        geometryMs = performance.now() - start;
      const clone = globalThis.structuredClone;
      let cloneMs = 0,
        cloneCalls = 0;
      if (pass >= 10) {
        await post("Profiler.start");
        globalThis.structuredClone = (...args) => {
          const began = performance.now();
          cloneCalls++;
          try {
            return clone(...args);
          } finally {
            cloneMs += performance.now() - began;
          }
        };
      }
      phase = "commit";
      start = performance.now();
      let commitMs;
      try {
        editDrawings(session, edits);
        commitMs = performance.now() - start;
      } finally {
        if (pass >= 10) globalThis.structuredClone = clone;
      }
      if (pass >= 10) {
        profiles.push((await post("Profiler.stop")).profile);
        cloneTimings.push({ calls: cloneCalls, ms: cloneMs });
      }
      phase = "undo";
      start = performance.now();
      session.undo();
      const undoMs = performance.now() - start;
      assert.equal(
        commits,
        1,
        "a bulk edit publishes exactly one foundation event",
      );
      assert.equal(undos, 1, "Undo publishes exactly one foundation event");
      assert.deepEqual(drawings(session.document), entries);
      assert(session.capture().storageUpperBytes <= 64 * 1024 * 1024);
      if (pass >= 2 && pass < 10) {
        timings.geometry.push(geometryMs);
        timings.commit.push(commitMs);
        timings.undo.push(undoMs);
      }
    } finally {
      unsubscribe();
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
  environment: { cpu: cpus()[0].model },
  method:
    "1999 mixed marks including one 8192-point stroke. Fresh owner-backed fixture per pass, fixed full-scene resize, then asserted Undo. Two warmups plus eight uninstrumented samples. Three additional inspector samples at 100us sampling interval, pooled separately; structuredClone calls are counted/timed only in these instrumented passes. Timings include probe overhead, overlap sampled CPU, and are not timing-comparable/additive to clean samples. Geometry lowering excludes lazy transform construction; commit includes validation/admission/subscriber notification but no React or storage. Buckets partition sampled self time using stack ancestry; inclusive contexts overlap. Inspector transport/initialization samples are classified as Profiler overhead, not target CPU. GC is unattributed to its initiating allocation. Native work without a recognizable frame remains other. No validation, history, admission or storage policy changes.",
  instrumentedClone: cloneTimings,
  notificationContract:
    "Exactly one foundation event per accepted bulk commit and per Undo, asserted on every pass. Notification CPU is sampled separately; absent samples are not proof of zero cost.",
  cleanMs: Object.fromEntries(
    Object.entries(timings).map(([k, v]) => [k, stats(v)]),
  ),
  cpu: summarize({ nodes: [], samples: [], timeDeltas: [] }),
};
// Profile node IDs are local to each capture; aggregate only after attribution.
const summaries = profiles.map((p) => summarize(p));
for (const s of summaries) {
  report.cpu.sampledMs += s.sampledMs;
  for (const field of ["selfBucketsMs", "inclusiveContextsMs"])
    for (const [key, value] of Object.entries(s[field]))
      report.cpu[field][key] = (report.cpu[field][key] ?? 0) + value;
}
report.cpu.profiles = summaries;
await writeFile(
  new URL(
    "../../../evidence/current/canvas/drawing-publication-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    { cleanMs: report.cleanMs, cpu: report.cpu.selfBucketsMs },
    null,
    2,
  ),
);
