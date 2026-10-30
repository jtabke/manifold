import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { decodeWorkspace, archive } from "../src/regions/artifacts.ts";
import {
  samplingReference,
  samplingJob,
} from "../src/regions/samplingPlans.ts";
import { sourceHash } from "../src/regions/samplingExecution.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  insertModel,
  modelReference,
  modelRequest,
} from "../src/regions/modelCommands.ts";
const fixture = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
async function output(job) {
  const [, low, high] = /linspace\(([^,]+), ([^,]+),/.exec(job.code),
    gain = Object.values(job.inputs)[0];
  return {
    points: [
      [Number(low), gain * Number(low)],
      [Number(high), gain * Number(high)],
    ],
    code_sha256: await sourceHash(job.code),
    runtime: { adapter: "bounded-python-sampler/1", python: "test" },
  };
}
async function session(
  executor = output,
  text = fixture("canvas-v2.fixture.json"),
) {
  const data = await decodeWorkspace(text);
  return new RegionSession(
    data.page,
    () => [],
    data.document,
    data.artifacts,
    false,
    data.recovery,
    { artifactExecutor: executor },
  );
}
async function compute(s, context = s.state.active) {
  const job = s.compute(
      samplingReference(s.document, s.artifacts[0].id, context),
    ),
    done = await job.completion;
  assert.equal(done.status, "retained", done.reason);
  return done.receipt;
}
const native = (s) => {
  const capture = s.capture();
  return archive(s.native(capture));
};
// Actual sampler and independent model results now share one core receipt map/clock.
{
  const s = await session(),
    artifact = s.artifacts[0],
    authored = s.document.id,
    typed = await compute(s);
  assert.equal(typed.outcome.status, "success");
  assert.equal(s.document.id, authored);
  assert.equal(s.canUndo, false);
  assert.equal(s.evidenceSequence, s.foundation.stamp().evidence);
  assert.equal(s.evidenceSequence, 1);
  assert.equal(
    s.artifacts[0].receipt.key,
    samplingJob(s.document, artifact.id, s.state.active).key,
  );
  assert.equal("results" in s.capture(), false);
  assert.equal("recordArtifactResult" in s, false);
  assert.equal(s.computations.read(artifact.id, s.state.active).current, true);
  const model = insertModel(s, "spring", { x: 100, y: 100 }),
    scalar = await s.compute(modelReference(s.document, modelRequest(model)))
      .completion;
  assert.equal(scalar.receipt.order, typed.order + 1);
  assert.equal(s.foundation.evidence().size, 2);
  const bytes = native(s),
    envelope = JSON.parse(bytes);
  assert.equal(envelope.version, 7);
  assert.equal("results" in envelope, false);
  const recipient = await session(null, bytes);
  assert.equal(recipient.executionDiagnostics.running, 0);
  assert.equal(
    recipient.computations.read(artifact.id, s.state.active).current,
    true,
  );
  assert.equal(
    recipient.artifacts[0].receipt.time,
    s.artifacts[0].receipt.time,
  );
  assert.equal(
    recipient.foundation.result(
      modelReference(recipient.document, modelRequest(model)),
    ).status,
    "current",
  );
  s.dispose();
  recipient.dispose();
}
// Ordinary source pins, contexts, Undo and recovery keep one copy of the selected source payload.
{
  const s = await session(),
    dataset = s.importData(
      "large.csv",
      "gain,noise\n10," + "z".repeat(900000),
      { x: 10, y: 900 },
    ),
    gain = s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", { x: 10, y: 700 });
  assert.equal(s.write(s.artifacts[0].output, "F := gain*x").ok, true);
  const result = await compute(s);
  assert.equal(result.outcome.status, "success");
  assert.equal(result.context.revisions.size, 5);
  assert.ok(JSON.stringify(result.snapshot).length < 3000);
  assert.equal(result.snapshot.input.body.capture.sources[0].region, gain);
  const backend = f.memoryBackend(),
    store = canvasLocalStore(backend);
  await store.load();
  await store.save(s);
  const snapshot = await backend.snapshot(),
    top = await f
      .recordReader(snapshot, f.webHash)
      .node(snapshot.state.head.package);
  assert.equal(
    top.kind,
    "workspace",
    "No application result bundle is written",
  );
  const reopened = await store.load(),
    recipient = new RegionSession(
      reopened.page,
      () => [],
      reopened.document,
      reopened.artifacts,
      false,
      reopened.recovery,
      { artifactExecutor: null },
    );
  assert.equal(store.acknowledgeRecovery(recipient), true);
  assert.equal((await store.save(recipient)).writes.chunks, 0);
  assert.equal(
    recipient.computations.read(s.artifacts[0].id, s.state.active).current,
    true,
  );
  const bytes = native(s);
  assert.equal(bytes.split("z".repeat(50)).length, 18001);
  const before = s.artifacts[0].receipt.key;
  s.write(s.artifacts[0].input, "x := 2 mm");
  assert.equal(
    s.computations.read(s.artifacts[0].id, s.state.active).status,
    "ready",
  );
  s.undo();
  assert.equal(
    s.computations.read(s.artifacts[0].id, s.state.active).receipt.key,
    before,
  );
  s.dispose();
  recipient.dispose();
}
// Legacy complete snapshots and compact snapshots migrate once, preserving historical request settings.
{
  const old = JSON.parse(fixture("canvas-v3.fixture.json")),
    migrated = await session(null, JSON.stringify(old));
  assert.equal(migrated.foundation.evidence().size, 1);
  assert.equal(
    migrated.computations.read(migrated.artifacts[0].id, migrated.state.active)
      .current,
    true,
  );
  const modern = JSON.parse(native(migrated));
  assert.equal(modern.version, 7);
  assert.equal("results" in modern, false);
  // Change current range while preserving the legacy observation's original request and output.
  const authored = old.foundation.document,
    artifactRecord = Object.values(authored.revisions).find(
      (r) => r.schema === "canvas-artifact@1",
    );
  artifactRecord.body.value.high = 0.004;
  const historical = await session(null, JSON.stringify(old));
  assert.equal(historical.foundation.evidence().size, 1);
  const receipt = [...historical.foundation.evidence().entries()][0][1];
  assert.equal(receipt.snapshot.input.body.request.high, 0.003);
  assert.equal(historical.artifacts[0].high, 0.004);
  assert.equal(
    historical.computations.read(
      historical.artifacts[0].id,
      historical.state.active,
    ).current,
    false,
  );
  assert.equal(
    historical.document.items.get(receipt.snapshot.origin.item).revision,
    null,
  );
  await decodeWorkspace(native(historical));
  migrated.dispose();
  historical.dispose();
}
// Source SHA and numerical checks precede evidence/resource success; failures share the same clock.
for (const bad of [
  async (job) => ({ ...(await output(job)), code_sha256: "0".repeat(64) }),
  async (job) => ({
    ...(await output(job)),
    points: [
      [0.0005, 99],
      [0.003, 99],
    ],
  }),
]) {
  const s = await session(bad),
    resources = s.foundation.resources(),
    root = s.document.id,
    receipt = await compute(s);
  assert.equal(receipt.outcome.status, "failed");
  assert.equal(s.foundation.resources(), resources);
  assert.equal(s.document.id, root);
  assert.equal(s.canUndo, false);
  assert.equal(s.evidenceSequence, 1);
  s.dispose();
}
// Demand observation cannot execute, and opened work stays paused until an explicit Run.
{
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      return output(job);
    }),
    service = s.computations,
    id = s.artifacts[0].id;
  for (let i = 0; i < 100; i++) service.read(id, s.state.active);
  assert.equal(calls, 0);
  service.attach();
  await service.idle();
  assert.equal(calls, 0);
  service.read(id, s.state.active).run();
  await service.idle();
  assert.equal(calls, 1);
  assert.equal(service.read(id, s.state.active).current, true);
  s.move(s.artifacts[0].input, { x: 300, y: 600 });
  await service.idle();
  assert.equal(calls, 1);
  s.dispose();
}
console.log(
  "Shared sampler/scalar evidence, source closure, one snapshot/clock, legacy historical migration, checked code/numerics, inert Open and zero-write recovery pass.",
);
// Old local result bundles migrate after both old clocks and require a fresh durable acknowledgement.
{
  const s = await session(),
    artifact = s.artifacts[0],
    job = samplingJob(s.document, artifact.id, s.state.active),
    raw = await output(job),
    legacyReceipt = { ...job, ...raw, time: "2026-10-26T00:00:00.000Z" },
    backend = f.memoryBackend(),
    initial = canvasLocalStore(backend);
  await initial.load();
  await initial.save(s);
  const head = await backend.head(),
    writer = f.recordWriter(new Map(), f.webHash),
    results = await writer.map(
      "canvas-results",
      f.SharedMap.from([
        [artifact.id, { artifact: artifact.id, receipt: legacyReceipt }],
      ]),
      (result) => writer.pack({ kind: "value", value: result }),
    ),
    bundle = await writer.pack(
      {
        kind: "bundle",
        schema: "manifold-canvas-local",
        version: 1,
        metadata: { document: head.document, root: head.root, evidence: 17 },
        roots: { foundation: head.package, results },
      },
      [head.package, results],
    );
  await backend.commit(
    head.generation,
    { ...head, request: "legacy-save", package: bundle },
    [...writer.chunks.values()],
    [],
    "none",
    0,
  );
  const store = canvasLocalStore(backend),
    data = await store.load(),
    migrated = new RegionSession(
      data.page,
      () => [],
      data.document,
      data.artifacts,
      false,
      data.recovery,
      { artifactExecutor: null },
    );
  assert.equal(migrated.evidenceSequence, 18);
  assert.equal(migrated.foundation.evidence().size, 1);
  assert.equal(migrated.artifacts[0].receipt.time, legacyReceipt.time);
  assert.equal(store.acknowledgeRecovery(migrated), false);
  assert.equal(
    migrated.computations.read(artifact.id, migrated.state.active).current,
    true,
  );
  await store.save(migrated);
  const snapshot = await backend.snapshot();
  assert.equal(
    (
      await f
        .recordReader(snapshot, f.webHash)
        .node(snapshot.state.head.package)
    ).kind,
    "workspace",
  );
  const fresh = canvasLocalStore(backend),
    reopened = await fresh.load(),
    recovered = new RegionSession(
      reopened.page,
      () => [],
      reopened.document,
      reopened.artifacts,
      false,
      reopened.recovery,
      { artifactExecutor: null },
    );
  assert.equal(fresh.acknowledgeRecovery(recovered), true);
  assert.equal((await fresh.save(recovered)).writes.chunks, 0);
  s.dispose();
  migrated.dispose();
  recovered.dispose();
}
// Default observations prefer the authoritative current receipt after context changes and Undo.
{
  const s = await session(),
    original = await compute(s),
    artifact = s.artifacts[0].id,
    key = s.artifacts[0].receipt.key;
  s.branch();
  s.write(s.artifacts[0].input, "x := 2 mm");
  await compute(s);
  s.undo();
  s.undo();
  assert.equal(s.state.active, "original");
  assert.equal(s.artifacts[0].receipt.key, key);
  assert.equal(
    s.computations.read(artifact, s.state.active).receipt.time,
    original.time,
  );
  s.write(s.artifacts[0].input, "x := 3 mm");
  await compute(s);
  s.undo();
  assert.equal(s.artifacts[0].receipt.key, key);
  const file = await decodeWorkspace(native(s));
  assert.equal(file.artifacts[0].receipt.key, key);
  const backend = f.memoryBackend(),
    store = canvasLocalStore(backend);
  await store.load();
  await store.save(s);
  assert.equal((await store.load()).artifacts[0].receipt.key, key);
  assert.equal(s.foundation.evidence().size, 3);
  s.dispose();
}
