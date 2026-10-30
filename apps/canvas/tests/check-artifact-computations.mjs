import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { prepare, decodeWorkspace, archive } from "../src/regions/artifacts.ts";
import {
  createArtifactComputations,
  samplerExecutor,
} from "../src/regions/artifactComputations.ts";
import { sampleOutput as output } from "./sampling-test-helpers.mjs";
const fixture = readFileSync(
  new URL("canvas-v2.fixture.json", import.meta.url),
  "utf8",
);
async function session(executor = output, scheduler, text = fixture) {
  const data = await decodeWorkspace(text);
  return new RegionSession(
    data.page,
    () => [],
    data.document,
    data.artifacts,
    false,
    data.recovery,
    { artifactExecutor: executor, scheduler },
  );
}
const tick = () => new Promise((done) => setImmediate(done));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const view = (service, s, context = s.state.active) =>
  service.read(s.artifacts[0].id, context);
// Pure reads and multiple representations share core captures, jobs and checked receipts.
{
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      assert.ok(Object.isFrozen(job) && Object.isFrozen(job.inputs));
      assert.equal("legacy" in job, false);
      assert.throws(() => {
        job.inputs.v0 = 0;
      }, TypeError);
      return output(job);
    }),
    service = createArtifactComputations(s);
  for (let i = 0; i < 100; i++) view(service, s);
  assert.equal(calls, 0);
  const root = s.document.id,
    detach = service.attach();
  await service.idle();
  assert.equal(calls, 1);
  assert.equal(view(service, s).current, true);
  assert.equal(view(service, s).receipt, view(service, s).receipt);
  assert.equal(s.document.id, root);
  assert.equal(s.canUndo, false);
  assert.equal(s.evidenceSequence, 1);
  s.move(s.artifacts[0].input, { x: 120, y: 900 });
  s.setArtifacts((items) => items.map((a) => ({ ...a, renderer: "table" })));
  const note = s.create();
  s.write(note, "An unrelated note");
  service.setContexts([]);
  await service.idle();
  assert.equal(calls, 1);
  detach();
  await tick();
  s.dispose();
}
// Open is paused; saved evidence remains current without any executor or additional evidence.
{
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      return output(job);
    }),
    service = s.computations;
  service.attach();
  await service.idle();
  assert.equal(calls, 0);
  assert.equal(view(service, s).status, "ready");
  view(service, s).run();
  await service.idle();
  assert.equal(calls, 1);
  const capture = s.capture(),
    text = archive(s.native(capture)),
    recipient = await session(null, undefined, text),
    before = recipient.evidenceSequence,
    inert = recipient.computations;
  inert.attach();
  await inert.idle();
  assert.equal(view(inert, recipient).current, true);
  assert.equal(recipient.evidenceSequence, before);
  assert.equal(
    view(inert, recipient).receipt.time,
    capture.artifacts[0].receipt.time,
  );
  s.dispose();
  recipient.dispose();
}
// Relevant edits cancel old admission. Ignored running work retains its slot until actual settlement.
{
  const gate = deferred(),
    started = deferred(),
    scheduler = f.createTaskScheduler({ concurrency: 1, maxQueued: 4 });
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      if (calls === 1) {
        started.resolve();
        await gate.promise;
      }
      return output(job);
    }, scheduler),
    service = createArtifactComputations(s);
  service.attach();
  await started.promise;
  s.write("region-1", "k := 20 N/mm");
  assert.equal(scheduler.diagnostics().running, 1);
  assert.equal(scheduler.diagnostics().cancelling, 1);
  assert.equal(calls, 1);
  gate.resolve();
  await service.idle();
  assert.equal(calls, 2);
  assert.equal(view(service, s).current, true);
  assert.equal(s.foundation.evidence().size, 2);
  assert.equal(
    [...s.foundation.evidence().entries()].filter(
      ([, r]) => r.outcome.status === "failed",
    ).length,
    1,
  );
  service.dispose();
  s.dispose();
  assert.equal(scheduler.diagnostics().closed, false);
  scheduler.dispose();
}
// Exact retained source revision identity matters even when selected measurements have equal values.
{
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      return output(job);
    }),
    dataset = s.importData("source.csv", "gain,noise\n10,a", { x: 0, y: 900 }),
    gain = s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", { x: 0, y: 700 });
  s.write(s.artifacts[0].output, "F := gain*x");
  const service = createArtifactComputations(s);
  service.attach();
  await service.idle();
  const key = view(service, s).job.key;
  s.apply({
    ...s.state,
    regions: s.state.regions.map((region) =>
      region.id === dataset
        ? { ...region, data: { ...region.data, csv: "gain,noise\n10,b" } }
        : region,
    ),
  });
  await service.idle();
  assert.notEqual(view(service, s).job.key, key);
  assert.equal(calls, 2);
  assert.equal(view(service, s).current, true);
  service.dispose();
  s.dispose();
}
// Context observations use one receipt owner; Undo reuses the prior checked outcome without execution.
{
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      return output(job);
    }),
    service = createArtifactComputations(s);
  service.attach();
  await service.idle();
  const original = view(service, s).receipt;
  s.branch();
  s.write("region-1", "k := 20 N/mm");
  service.setContexts(["original"]);
  await service.idle();
  assert.equal(view(service, s).current, true);
  assert.equal(view(service, s, "original").receipt, original);
  assert.ok(s.foundation.evidence().size >= 2);
  s.undo();
  await service.idle();
  const before = calls;
  s.undo();
  await service.idle();
  assert.equal(view(service, s).receipt, original);
  assert.equal(calls, before);
  service.dispose();
  s.dispose();
}
// Oversized captured mathematics remains authored, but does not execute.
{
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      return output(job);
    }),
    names = [];
  for (let i = 0; i < 30; i++) {
    const id = s.create();
    s.write(id, `q${i} := 1 N/mm`.padEnd(4999, " "));
    names.push(`q${i}`);
  }
  s.write(s.artifacts[0].output, `F := (${names.join("+")})*x`);
  const root = s.document,
    service = createArtifactComputations(s);
  service.attach();
  await service.idle();
  assert.equal(view(service, s).status, "blocked");
  assert.match(view(service, s).error, /capture.*budget/i);
  assert.equal(calls, 0);
  assert.equal(s.document, root);
  service.dispose();
  s.dispose();
}
// Strict host mounting reuses its owner; terminal disposal discards late evidence.
{
  const gate = deferred(),
    started = deferred();
  let calls = 0;
  const s = await session(async (job) => {
      calls++;
      started.resolve();
      await gate.promise;
      return output(job);
    }),
    first = s.attach();
  first();
  const second = s.attach();
  view(s.computations, s).run();
  await started.promise;
  assert.equal(calls, 1);
  const service = s.computations;
  second();
  await tick();
  gate.resolve();
  await service.idle();
  assert.equal(s.evidenceSequence, 0);
  assert.equal(service.read("artifact-1", "original").current, false);
  assert.throws(() => service.attach(), /closed/);
}

// The installed transport bounds streamed bytes and sends only declared code/scalar inputs.
{
  const s = await session(),
    job = prepare(s.state, s.artifacts[0], s.document),
    original = globalThis.fetch;
  let sent,
    cancelled = false;
  try {
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify(await output(job)));
    };
    const value = await samplerExecutor(job, new AbortController().signal);
    assert.deepEqual(Object.keys(sent).sort(), ["code", "inputs"]);
    assert.equal(value.points.length, 2);
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(65537));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    await assert.rejects(
      samplerExecutor(job, new AbortController().signal),
      /output budget/,
    );
    assert.equal(cancelled, true);
    await assert.rejects(
      samplerExecutor(
        { ...job, code: "x".repeat(65537) },
        new AbortController().signal,
      ),
      /input budget/,
    );
  } finally {
    globalThis.fetch = original;
  }
}
console.log(
  "Shared receipt observation, host demand, cancellation/backpressure, source identity, contexts/Undo, capture budgets, teardown and bounded transport pass.",
);
