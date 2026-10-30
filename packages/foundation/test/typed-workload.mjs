/** Bounded typed execution/storage diagnostics; independent records are unrelated to the selected request. */
import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as d from "./typed-fixture.mjs";
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
const rows = [];
for (const [independentRecords, vertexCount] of [
  [10, 2],
  [1000, 256],
  [10000, 4096],
]) {
  const initial = await d.initial(),
    data = JSON.stringify(
      Array.from({ length: vertexCount }, (_, i) => [i, i + 1, i + 2]),
    ),
    asset = await f.asset(data, f.webHash),
    resources = await initial.resources.add(asset, data, f.webHash),
    commands = [
      d.command(
        "mesh",
        "vertices-source@1",
        {
          ...f.current(initial.document, "mesh").body,
          asset,
          count: vertexCount,
        },
        "revise",
      ),
    ];
  for (let i = 0; i < independentRecords; i++)
    commands.push(
      d.command("unrelated-" + i, "note@1", {
        text: "Unrelated thought " + i,
        mode: "draft",
      }),
    );
  const document = f.prepare(
      initial.document,
      d.id(),
      commands,
      d.schemas,
    ).document,
    w = d.workspace({ ...initial, document, resources }, { historyLimit: 4 }),
    backend = f.memoryBackend();
  let hashedBytes = 0;
  const hash = async (text) => {
      hashedBytes += f.byteLength(text);
      return f.webHash(text);
    },
    io = f.incrementalStorage(backend, d.schemas, d.methods, hash);
  let saved = await io.save(d.ticket(w)),
    executeMs = [],
    saveMs = [],
    saveBytes = [],
    hashOverhead = [],
    receiptBytes = [],
    inputBytes = [],
    outputBytes = [];
  let closure = 0,
    snapshotBytes = 0;
  for (let i = 0; i < 12; i++) {
    d.factor(w, i + 2);
    saved = await io.save(d.ticket(w, saved.head.generation));
    const began = performance.now(),
      pending = w.owner.compute(w.reader.stamp(), d.ref("scaled"));
    assert.equal(pending.ok, true, pending.error);
    assert.equal(w.diagnostics().activeRevisionPayloads, 3);
    const leasedBytes = w.diagnostics().activeInputBytes,
      settled = await pending.value.completion,
      elapsed = performance.now() - began;
    assert.equal(settled.receipt.outcome.status, "success");
    assert.equal(w.diagnostics().activeInputBytes, 0);
    const receipt = settled.receipt,
      bytes = receipt.outcome.output.body.asset.size;
    closure = receipt.context.revisions.size;
    snapshotBytes = f.byteLength(JSON.stringify(receipt.snapshot));
    hashedBytes = 0;
    const saveStart = performance.now();
    saved = await io.save(d.ticket(w, saved.head.generation));
    if (i >= 2) {
      executeMs.push(elapsed);
      saveMs.push(performance.now() - saveStart);
      saveBytes.push(saved.plannedBytes);
      hashOverhead.push(hashedBytes - bytes);
      receiptBytes.push(
        f.byteLength(
          JSON.stringify({
            ...receipt,
            context: f.contextToPlain(receipt.context),
          }),
        ),
      );
      inputBytes.push(leasedBytes);
      outputBytes.push(bytes);
    }
  }
  const native = d.native(w),
    openStart = performance.now(),
    decoded = await f.decode(native, d.schemas, d.methods, f.webHash),
    nativeReadMs = performance.now() - openStart;
  const reopenStart = performance.now(),
    recovered = await io.reopen(),
    localReadMs = performance.now() - reopenStart,
    adopted = d.workspace(recovered.loaded, { typedExecutor: undefined }),
    warm = await io.save(d.ticket(adopted, saved.head.generation));
  assert.equal(decoded.receipts.length, 12);
  assert.equal(adopted.reader.result(d.ref("scaled")).status, "current");
  assert.equal(warm.writes.chunks, 0);
  assert.equal(warm.writes.assets, 0);
  assert.equal(closure, 3);
  assert.equal(
    inputBytes.every((bytes) => bytes === asset.size),
    true,
  );
  assert.ok(snapshotBytes <= 2048);
  assert.ok(Math.max(...hashOverhead) <= 32 * 1024);
  rows.push({
    independentRecords,
    vertexCount,
    sourceBytes: asset.size,
    closedRevisions: closure,
    snapshotBytes,
    execution10Ms: stats(executeMs),
    evidenceSave10Ms: stats(saveMs),
    evidenceSaveMetadataBytes: stats(saveBytes),
    saveHashBytesAboveOutput: stats(hashOverhead),
    receiptMetadataBytes: stats(receiptBytes),
    leasedInputBytes: stats(inputBytes),
    verifiedOutputBytes: stats(outputBytes),
    nativeBytes: f.byteLength(native),
    nativeReadMs,
    localReadMs,
    recoveredUnchangedSave: warm.writes,
  });
  w.owner.dispose();
  adopted.owner.dispose();
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: execFileSync(
    process.execPath,
    ["packages/foundation/test/source-digest.mjs"],
    { encoding: "utf8" },
  ).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "Two warmups +10 sequential source-backed geometry transformations per row, each between an authored input edit/Save and a checked evidence Save. Varies selected geometry and unrelated record counts together, so timings do not isolate either factor. Full SHA verification, independent point/count/unit/frame validation, input byte leases and memory-backend persistence are included. Native/local reads are single diagnostics. No renderer/process-memory/IndexedDB latency, worker isolation, physical-validity or product-capacity claim.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/typed-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
