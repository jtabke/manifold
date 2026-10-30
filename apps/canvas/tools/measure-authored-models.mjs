/** Actual authored graphs, typed receipts, pinned CSV and incremental owner/storage contracts. */
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
  modelRequest,
  setModelInput,
  reviewModelCsv,
  applyModelConnection,
} from "../src/regions/modelCommands.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const rows = [],
  csv =
    "v,noise\n" +
    Array.from({ length: 10000 }, () => "3," + "z".repeat(90)).join("\n");
for (const [count, equations] of [
  [1, 4],
  [16, 12],
  [64, 24],
]) {
  const source = {
    rows: [
      { id: "force", text: "F = 20 N" },
      { id: "speed", text: "v = 3 m/s" },
      ...Array.from({ length: equations - 2 }, (_, i) => ({
        id: "output-" + i,
        text: i ? `out${i} = out${i - 1} * 1.01` : "out0 = F*v",
      })),
    ],
    inputs: ["force", "speed"],
    outputs: ["output-0", "output-1", "output-" + (equations - 3)],
  };
  source.outputs = [...new Set(source.outputs)];
  const session = new RegionSession(),
    definition = publishModel(session, "Drive", source),
    ids = [];
  const dataset = session.importData("measurements.csv", csv, { x: 0, y: 900 });
  for (let i = 0; i < count; i++) {
    const id = instantiateModel(
      session,
      modelReference(session.document, definition),
      { x: (i % 8) * 450, y: Math.floor(i / 8) * 700 },
    );
    applyModelConnection(
      session,
      reviewModelCsv(session, id, "speed", dataset, i, 0, "m*s^-1"),
    );
    ids.push(id);
  }
  const started = performance.now();
  for (let i = 0; i < count; i += 4)
    await Promise.all(
      ids
        .slice(i, i + 4)
        .map(
          (id) =>
            session.compute(modelReference(session.document, modelRequest(id)))
              .completion,
        ),
    );
  const receipts = [...session.foundation.evidence().entries()].map(
    ([, receipt]) => receipt,
  );
  assert.equal(receipts.length, count);
  assert.ok(
    receipts.every(
      (r) =>
        r.kind === "typed@1" &&
        r.outcome.status === "success" &&
        r.outcome.output.body["output-0"].value === 60,
    ),
  );
  const computeMs = performance.now() - started;
  const storeBackend = f.memoryBackend();
  let hashBytes = 0;
  const store = canvasLocalStore(storeBackend, async (text) => {
    hashBytes += f.byteLength(text);
    return f.webHash(text);
  });
  await store.load();
  await store.save(session);
  const hashed = [],
    bytes = [],
    times = [];
  for (let n = 0; n < 35; n++) {
    const start = performance.now();
    setModelInput(session, ids[0], "force", 20 + (n % 2));
    const elapsed = performance.now() - start;
    hashBytes = 0;
    const saved = await store.save(session);
    if (n >= 5) {
      hashed.push(hashBytes);
      bytes.push(saved.writes.chunkBytes);
      times.push(elapsed);
    }
    assert.equal(saved.writes.assetBytes, 0);
  }
  const native = archive(session.native());
  const decoded = await decodeWorkspace(native);
  assert.equal(decoded.recovery.foundation.receipts.length, count);
  const reader = canvasLocalStore(storeBackend),
    loaded = await reader.load(),
    recovered = new RegionSession(
      loaded.page,
      () => [],
      loaded.document,
      loaded.artifacts,
      false,
      loaded.recovery,
    );
  reader.acknowledgeRecovery(recovered);
  const unchanged = await reader.save(recovered);
  rows.push({
    instances: count,
    equations,
    graphNodes: Object.keys(
      f.current(session.document, definition).body.model.nodes,
    ).length,
    sourceBytes: f.byteLength(csv),
    outputs: source.outputs.length,
    closureRevisions: Math.max(
      ...receipts.map((r) => r.context.revisions.size),
    ),
    snapshotBytes: Math.max(
      ...receipts.map((r) => f.byteLength(f.canonical(r.snapshot))),
    ),
    editSaveHashBytes: Math.max(...hashed),
    editSaveBytes: Math.max(...bytes),
    editP95Ms: times.toSorted((a, b) => a - b)[28],
    nativeSourceOccurrences: native.split('"csv"').length - 1,
    unchangedChunks: unchanged.writes.chunks,
    computeMs,
  });
  session.dispose();
  recovered.dispose();
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  method:
    "1/16/64 independent authored instances sharing one 4/12/24-equation pinned definition, two scalar inputs, 2/3 public outputs and one 930,007-byte CSV with exact-cell bindings. Explicit typed computations in batches of four. Five warmups plus 30 instance edits/Saves. Structural snapshot/hash/closure/write limits; timing is a memory-backend device diagnostic. Native decode and local recovery preserve receipts; unchanged recovered Save writes no chunks. No interactive or general solver capacity claim.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/authored-models-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
