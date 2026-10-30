/** Bounded checked sweeps over real authored graphs and one pinned source; no new owner. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  setModelInput,
  reviewModelCsv,
  applyModelConnection,
} from "../src/regions/modelCommands.ts";
import { createModelAnalysis } from "../src/regions/modelAnalysisCommands.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const rows = [],
  csv =
    "F,noise\n" +
    Array.from({ length: 10000 }, () => "30," + "z".repeat(89)).join("\n");
for (const [count, equations] of [
  [1, 3],
  [8, 14],
  [16, 32],
]) {
  const source = {
    rows: [
      { id: "force", text: "F = 20 N" },
      { id: "speed", text: "v = 3 m/s" },
      ...Array.from({ length: equations - 2 }, (_, i) => ({
        id: "out" + i,
        text: i
          ? `out${i} = out${i - 1}*1.001*1.002*1.003*1.004`
          : "out0 = F*v",
      })),
    ],
    inputs: ["force", "speed"],
    outputs: ["out" + (equations - 3)],
  };
  const s = new RegionSession(),
    definition = publishModel(s, "Drive", source),
    instance = instantiateModel(s, modelReference(s.document, definition), {
      x: 0,
      y: 0,
    });
  const dataset = s.importData("force.csv", csv, { x: 0, y: 900 });
  applyModelConnection(
    s,
    reviewModelCsv(s, instance, "force", dataset, 0, 0, "N"),
  );
  const ids = Array.from({ length: count }, (_, i) =>
    createModelAnalysis(
      s,
      instance,
      {
        input: "speed",
        output: source.outputs[0],
        low: 0,
        high: 10,
        points: 201,
      },
      { x: i * 560, y: 700 },
    ),
  );
  const started = performance.now();
  for (let i = 0; i < ids.length; i += 4)
    await Promise.all(
      ids
        .slice(i, i + 4)
        .map((id) => s.compute(modelReference(s.document, id)).completion),
    );
  const computeMs = performance.now() - started;
  const receipts = ids.map(
    (id) => s.foundation.result(modelReference(s.document, id)).receipt,
  );
  assert.ok(
    receipts.every(
      (r) =>
        r?.kind === "typed@1" &&
        r.outcome.status === "success" &&
        r.outcome.output.body.points.length === 201,
    ),
  );
  const sample = receipts[0];
  const expected = 300 * Math.pow(1.001 * 1.002 * 1.003 * 1.004, equations - 3);
  assert.ok(
    Math.abs(sample.outcome.output.body.points.at(-1)[1] - expected) <
      expected * 1e-12,
  );
  const backend = f.memoryBackend();
  let hashBytes = 0;
  const store = canvasLocalStore(backend, async (text) => {
    hashBytes += f.byteLength(text);
    return f.webHash(text);
  });
  await store.load();
  await store.save(s);
  const hashed = [],
    savedBytes = [];
  for (let i = 0; i < 35; i++) {
    setModelInput(s, instance, "speed", 3 + (i % 2));
    hashBytes = 0;
    const saved = await store.save(s);
    assert.equal(saved.writes.assetBytes, 0);
    if (i >= 5) {
      hashed.push(hashBytes);
      savedBytes.push(saved.writes.chunkBytes);
    }
  }
  const native = archive(s.native()),
    decoded = await decodeWorkspace(native);
  assert.equal(decoded.recovery.foundation.receipts.length, count);
  const reader = canvasLocalStore(backend),
    loaded = await reader.load(),
    recovered = new RegionSession(
      loaded.page,
      () => [],
      loaded.document,
      loaded.artifacts,
      false,
      loaded.recovery,
    );
  const unchanged = await reader.save(recovered);
  rows.push({
    analyses: count,
    equations,
    graphNodes: Object.keys(sample.snapshot.input.body.model.nodes).length,
    points: 201,
    sourceBytes: f.byteLength(csv),
    maxClosureRevisions: Math.max(
      ...receipts.map((r) => r.context.revisions.size),
    ),
    maxInputBytes: Math.max(
      ...receipts.map((r) => f.byteLength(f.canonical(r.snapshot.input))),
    ),
    maxOutputBytes: Math.max(
      ...receipts.map((r) => f.byteLength(f.canonical(r.outcome.output))),
    ),
    editSaveHashBytes: Math.max(...hashed),
    editSaveBytes: Math.max(...savedBytes),
    nativeSourceOccurrences:
      native.split(csv.slice(0, 100).replaceAll("\n", "\\n")).length - 1,
    unchangedChunks: unchanged.writes.chunks,
    recoveredRunningJobs: recovered.executionDiagnostics.running,
    computeMs,
  });
  s.dispose();
  recovered.dispose();
}
const result = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  method:
    "1/8/16 analyses, 3/14/32 equations (maximum authored row count), 201 points each and one pinned ~930KB CSV. Four concurrent checked jobs; installed scalar model evaluator branches from a fixed two-record capture. Five warmups plus 30 sparse instance edits/Saves. Exact input/output/closure/write/source-sharing and recovered job counts are structural guards; compute time includes cooperative yielding and is a device diagnostic, not interactive capacity or a general solver claim.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/model-analyses-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
