import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import { initial, schemas, methods, ref, calculate } from "./helpers.mjs";
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test("task admission bounds concurrency and waiting, preserving FIFO across different adapters", async () => {
  const pool = f.createTaskScheduler({ concurrency: 2, maxQueued: 1 });
  const gates = [deferred(), deferred(), deferred()],
    started = [];
  const tasks = gates.map((gate, index) =>
    pool.submit(async () => {
      started.push(index);
      await gate.promise;
      return index ? [index, index] : 1;
    }),
  );
  assert.throws(() => pool.submit(() => 4), /queue full/);
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(pool.diagnostics(), {
    running: 2,
    queued: 1,
    cancelling: 0,
    closed: false,
  });
  gates[1].resolve();
  assert.deepEqual(await tasks[1].completion, {
    status: "success",
    value: [1, 1],
  });
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);
  gates[0].resolve();
  gates[2].resolve();
  await Promise.all(tasks.map((task) => task.completion));
  assert.equal(pool.diagnostics().running, 0);
});
test("queued cancellation never enters an adapter and frees its admission immediately", async () => {
  const pool = f.createTaskScheduler({ concurrency: 1, maxQueued: 1 }),
    gate = deferred();
  const first = pool.submit(() => gate.promise);
  let calls = 0;
  const cancelled = pool.submit(() => {
    calls++;
  });
  cancelled.cancel();
  cancelled.cancel();
  assert.equal((await cancelled.completion).status, "cancelled");
  assert.equal(cancelled.state(), "settled");
  assert.equal(calls, 0);
  const next = pool.submit(() => 3);
  gate.resolve(1);
  await first.completion;
  assert.equal((await next.completion).value, 3);
});
test("ignored running cancellation keeps its slot and cannot publish a late success", async () => {
  const pool = f.createTaskScheduler({ concurrency: 1, maxQueued: 0 }),
    gate = deferred();
  let signal;
  const job = pool.submit((abort) => {
    signal = abort;
    return gate.promise;
  });
  await Promise.resolve();
  job.cancel();
  job.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(job.state(), "running");
  assert.equal(pool.diagnostics().cancelling, 1);
  assert.throws(() => pool.submit(() => 2), /queue full/);
  gate.resolve(42);
  assert.equal((await job.completion).status, "cancelled");
  assert.equal(pool.diagnostics().running, 0);
  assert.equal((await pool.submit(() => 2).completion).value, 2);
});
test("deadlines abort queued and running work without fabricating running settlement", async () => {
  const pool = f.createTaskScheduler({
      concurrency: 1,
      maxQueued: 1,
      deadlineMs: 5,
    }),
    gate = deferred();
  let signal;
  const running = pool.submit((abort) => {
      signal = abort;
      return gate.promise;
    }),
    queued = pool.submit(() => 2);
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(signal.aborted, true);
  assert.equal(pool.diagnostics().running, 1);
  assert.match((await queued.completion).reason, /deadline/);
  gate.resolve(1);
  assert.match((await running.completion).reason, /deadline/);
});
test("throwing/rejecting adapters have bounded failures and leave the pool reusable", async () => {
  const pool = f.createTaskScheduler({ concurrency: 1, maxQueued: 0 });
  for (const execute of [
    () => {
      throw Error("x".repeat(4000));
    },
    () =>
      Promise.reject({
        toString() {
          throw Error("bad error");
        },
      }),
  ]) {
    const result = await pool.submit(execute).completion;
    assert.equal(result.status, "failed");
    assert.ok(result.reason.length <= 2000);
    assert.equal(pool.diagnostics().running, 0);
  }
  assert.equal((await pool.submit(() => 7).completion).value, 7);
});
test("disposing a shared host cancels queued work and preserves ignored running admission", async () => {
  const pool = f.createTaskScheduler({ concurrency: 1, maxQueued: 1 }),
    gate = deferred();
  const running = pool.submit(() => gate.promise),
    queued = pool.submit(() => 2);
  await Promise.resolve();
  pool.dispose();
  pool.dispose();
  assert.equal((await queued.completion).status, "cancelled");
  assert.equal(pool.diagnostics().running, 1);
  assert.throws(() => pool.submit(() => 3), /closed/);
  gate.resolve(1);
  assert.equal((await running.completion).status, "cancelled");
});
test("scheduler options reject invalid resource limits", () => {
  for (const options of [
    { concurrency: 0 },
    { concurrency: 65 },
    { concurrency: 1.5 },
    { maxQueued: -1 },
    { maxQueued: 1025 },
    { deadlineMs: 0 },
    { deadlineMs: Infinity },
  ])
    assert.throws(() => f.createTaskScheduler(options), /limits/);
});
test("scalar owners share admission while Open cancels only its own binding", async () => {
  const scheduler = f.createTaskScheduler({ concurrency: 1, maxQueued: 1 }),
    gate = deferred();
  const calls = [];
  const a = f.createWorkspace(await initial(), {
      schemas,
      methods,
      namespace: "a",
      scheduler,
      executor: async (snapshot, signal) => {
        calls.push(signal);
        await gate.promise;
        return calculate(snapshot);
      },
    }),
    b = f.createWorkspace(await initial(), {
      schemas,
      methods,
      namespace: "b",
      scheduler,
      executor: async (snapshot) => calculate(snapshot),
    });
  const first = a.owner.compute(a.reader.stamp(), ref("pressure")),
    second = b.owner.compute(b.reader.stamp(), ref("pressure"));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  await Promise.resolve();
  assert.equal(scheduler.diagnostics().running, 1);
  assert.equal(scheduler.diagnostics().queued, 1);
  assert.equal(a.owner.open(a.reader.stamp(), await initial()).ok, true);
  assert.equal(calls[0].aborted, true);
  assert.equal(b.diagnostics().activeJobs, 1);
  gate.resolve();
  assert.equal((await first.value.completion).status, "discarded");
  assert.equal((await second.value.completion).status, "retained");
  assert.equal(a.diagnostics().receipts, 0);
  assert.equal(b.diagnostics().receipts, 1);
});
test("terminal owner disposal rejects writes and late evidence while leaving a shared host usable", async () => {
  const scheduler = f.createTaskScheduler({ concurrency: 1, maxQueued: 1 }),
    gate = deferred();
  let signal;
  const a = f.createWorkspace(await initial(), {
    schemas,
    methods,
    namespace: "dispose-a",
    scheduler,
    executor: async (snapshot, abort) => {
      signal = abort;
      await gate.promise;
      return calculate(snapshot);
    },
  });
  const b = f.createWorkspace(await initial(), {
    schemas,
    methods,
    namespace: "dispose-b",
    scheduler,
    executor: async (snapshot) => calculate(snapshot),
  });
  const first = a.owner.compute(a.reader.stamp(), ref("pressure")),
    second = b.owner.compute(b.reader.stamp(), ref("pressure"));
  await Promise.resolve();
  const document = a.reader.read();
  a.owner.dispose();
  a.owner.dispose();
  assert.equal(signal.aborted, true);
  assert.equal(scheduler.diagnostics().closed, false);
  assert.equal(a.owner.apply(a.reader.stamp(), "after-close", []).ok, false);
  assert.equal(a.owner.compute(a.reader.stamp(), ref("pressure")).ok, false);
  assert.equal(a.owner.open(a.reader.stamp(), await initial()).ok, false);
  gate.resolve();
  assert.equal((await first.value.completion).status, "discarded");
  assert.equal((await second.value.completion).status, "retained");
  assert.equal(a.reader.read(), document);
  assert.equal(a.reader.evidence().size, 0);
});
