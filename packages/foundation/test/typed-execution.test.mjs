import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as d from "./typed-fixture.mjs";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const receiptIds = (w) => [...w.reader.evidence().entries()].map(([id]) => id);
const output = (w, receipt) => {
  assert.equal(receipt.outcome.status, "success");
  return JSON.parse(
    w.reader.resources().read(receipt.outcome.output.body.asset).data,
  );
};
test("typed source-backed and scalar execution share one evidence clock and authored history", async () => {
  const w = d.workspace(await d.initial()),
    before = w.reader.read();
  const typed = await d.compute(w),
    scalar = await d.compute(w, "pressure");
  assert.equal(typed.kind, "typed@1");
  assert.equal(scalar.kind, undefined);
  assert.equal(typed.order, 1);
  assert.equal(scalar.order, 2);
  assert.deepEqual(output(w, typed), [
    [2, 4, 6],
    [8, 10, 12],
  ]);
  assert.equal(w.reader.read().id, before.id);
  assert.equal(w.diagnostics().undoSteps, 0);
  assert.equal(typed.context.revisions.size, 3);
  assert.equal(typed.snapshot.dependencies.length, 2);
  assert.equal(w.reader.result(d.ref("scaled")).status, "current");
  d.factor(w, 3);
  assert.equal(w.reader.result(d.ref("scaled")).status, "ready");
  const changed = await d.compute(w);
  assert.equal(changed.order, 3);
  assert.equal(w.owner.undo(w.reader.stamp(), d.id()).ok, true);
  assert.equal(w.reader.result(d.ref("scaled")).receipt.id, typed.id);
  assert.equal(w.reader.evidence().size, 3);
  w.owner.dispose();
});
test("typed preview, Keep and native/local recovery preserve exact output bytes without executors", async () => {
  const w = d.workspace(await d.initial());
  const preview = w.owner.preview(w.reader.stamp(), d.ref("scaled"), [
    d.command(
      "factor",
      "scalar@1",
      { ...f.current(w.reader.read(), "factor").body, value: 5 },
      "revise",
    ),
  ]);
  assert.equal(preview.ok, true, preview.error);
  const receipt = await d.compute(w, "scaled", "preview");
  const kept = w.owner.keep(
    w.reader.stamp(),
    d.id(),
    "scaled-five",
    "Scale by five",
    {
      id: "scaled-view",
      reference: d.ref("scaled"),
      renderer: "vertices-view@1",
      x: 10,
      y: 20,
      alternative: "scaled-five",
    },
  );
  assert.equal(kept.ok, true, kept.error);
  assert.equal(
    w.reader.result(d.ref("scaled"), { alternative: "scaled-five" }).receipt.id,
    receipt.id,
  );
  const text = d.native(w);
  assert.equal(JSON.parse(text).version, 4);
  const loaded = await f.decode(text, d.schemas, d.methods, f.webHash);
  const reader = d.workspace(loaded, {
    executor: undefined,
    typedExecutor: undefined,
  });
  assert.equal(
    reader.reader.result(d.ref("scaled"), { alternative: "scaled-five" })
      .status,
    "current",
  );
  assert.deepEqual(output(reader, reader.reader.evidence().get(receipt.id)), [
    [5, 10, 15],
    [20, 25, 30],
  ]);
  assert.equal(
    reader.owner.compute(reader.reader.stamp(), d.ref("scaled")).ok,
    false,
  );
  const backend = f.memoryBackend(),
    io = f.incrementalStorage(backend, d.schemas, d.methods, f.webHash);
  const saved = await io.save(d.ticket(w));
  assert.equal(saved.writes.assets, 3);
  const reopened = await io.reopen(),
    recipient = d.workspace(reopened.loaded, {
      executor: undefined,
      typedExecutor: undefined,
    });
  assert.deepEqual(JSON.parse(d.native(recipient)), JSON.parse(text));
  const warm = await io.save(d.ticket(recipient, saved.head.generation));
  assert.equal(warm.plannedChunks, 1);
  assert.equal(warm.writes.chunks, 0);
  assert.equal(warm.writes.assets, 0);
  for (const owner of [w, reader, recipient]) owner.owner.dispose();
});
test("portable typed evidence rejects forged origin, provenance, units, bytes and version downgrade", async () => {
  const w = d.workspace(await d.initial());
  await d.compute(w);
  const good = JSON.parse(d.native(w));
  const corruptions = [
    (e) => {
      e.version = 3;
    },
    (e) => {
      Object.values(e.snapshots)[0].origin.item = "factor";
    },
    (e) => {
      Object.values(e.snapshots)[0].dependencies = [];
    },
    (e) => {
      e.receipts[0].outcome.output.body.unit = "m";
    },
    (e) => {
      delete e.assets[e.receipts[0].outcome.output.body.asset.digest];
    },
    (e) => {
      e.assets[e.receipts[0].outcome.output.body.asset.digest] = "[]";
    },
  ];
  for (const corrupt of corruptions) {
    const value = structuredClone(good);
    corrupt(value);
    await assert.rejects(
      f.decode(JSON.stringify(value), d.schemas, d.methods, f.webHash),
    );
  }
  const noMethod = f.createMethods([]),
    loaded = await f.decode(
      JSON.stringify(good),
      d.schemas,
      noMethod,
      f.webHash,
    );
  const reader = d.workspace(loaded, {
    methods: noMethod,
    typedExecutor: undefined,
  });
  assert.equal(reader.reader.evidence().size, 1);
  assert.equal(reader.reader.result(d.ref("scaled")).status, "blocked");
  assert.deepEqual(
    output(reader, [...reader.reader.evidence().entries()][0][1]),
    [
      [2, 4, 6],
      [8, 10, 12],
    ],
  );
  w.owner.dispose();
  reader.owner.dispose();
});
test("running jobs lease selected input bytes through provider loss and hold their byte budget until settlement", async () => {
  const initial = await d.initial("linked");
  let unavailable = false,
    release,
    capturedIO,
    ready;
  const started = new Promise((done) => {
    ready = done;
  });
  const resources = {
    read(a) {
      return unavailable
        ? { status: "unavailable", reason: "Disconnected" }
        : initial.resources.read(a);
    },
  };
  const w = d.workspace(
    { ...initial, resources },
    {
      maxInputBytes: f.current(initial.document, "mesh").body.asset.size,
      typedExecutor: async (snapshot, signal, io) => {
        capturedIO = io;
        await new Promise((done) => {
          release = done;
          ready();
        });
        return d.execute(snapshot, signal, io);
      },
    },
  );
  const job = w.owner.compute(w.reader.stamp(), d.ref("scaled"));
  assert.equal(job.ok, true, job.error);
  await started;
  assert.equal(
    w.diagnostics().activeInputBytes,
    f.current(initial.document, "mesh").body.asset.size,
  );
  unavailable = true;
  release();
  const done = await job.value.completion;
  assert.equal(done.status, "retained");
  assert.equal(done.receipt.outcome.status, "success");
  assert.deepEqual(output(w, done.receipt), [
    [2, 4, 6],
    [8, 10, 12],
  ]);
  assert.equal(w.diagnostics().activeInputBytes, 0);
  assert.throws(
    () => capturedIO.read(done.receipt.snapshot.assets[0]),
    /expired/,
  );
  assert.equal(w.reader.result(d.ref("scaled")).status, "blocked");
  w.owner.dispose();
});
test("invalid outputs, undeclared reads and staged-byte failures never publish resources", async () => {
  for (const invalid of [
    async (s, _signal, io) => {
      io.read({ ...s.assets[0], mediaType: "other/type" });
    },
    async (s, _signal, io) => {
      await io.stage(s.assets[0], "broken");
    },
    async (s, signal, io) => {
      const out = await d.execute(s, signal, io);
      return { ...out, unit: "m" };
    },
    async (s) => ({
      ...s.input.body.mesh,
      asset: await f.asset("[[99,99,99],[99,99,99]]", f.webHash),
    }),
    async (s, _signal, io) => {
      const data = "[[99,99,99],[99,99,99]]",
        asset = await f.asset(data, f.webHash);
      await io.stage(asset, data);
      return { ...s.input.body.mesh, asset };
    },
  ]) {
    const initial = await d.initial(),
      w = d.workspace(initial, { typedExecutor: invalid }),
      resources = w.reader.resources();
    const receipt = await d.compute(w);
    assert.equal(receipt.outcome.status, "failed");
    assert.equal(w.reader.resources(), resources);
    assert.equal(w.reader.evidence().size, 1);
    w.owner.dispose();
  }
});
test("cancel, Open and terminal disposal discard staged bytes; queued cancellation releases its leases", async () => {
  for (const transition of ["cancel", "open", "dispose"]) {
    let release, staged, io, ready;
    const started = new Promise((done) => {
      ready = done;
    });
    const w = d.workspace(await d.initial(), {
      typedExecutor: async (s, signal, port) => {
        io = port;
        staged = await d.execute(s, signal, port);
        await new Promise((done) => {
          release = done;
          ready();
        });
        return staged;
      },
    });
    const resources = w.reader.resources(),
      job = w.owner.compute(w.reader.stamp(), d.ref("scaled"));
    await started;
    assert.ok(release);
    if (transition === "cancel") job.value.cancel();
    if (transition === "open")
      assert.equal(w.owner.open(w.reader.stamp(), await d.initial()).ok, true);
    if (transition === "dispose") w.owner.dispose();
    assert.equal(w.diagnostics().activeJobs, 1);
    assert.ok(w.diagnostics().activeInputBytes > 0);
    assert.throws(() => io.read(staged.asset));
    release();
    const done = await job.value.completion;
    assert.equal(
      done.status,
      transition === "cancel" ? "retained" : "discarded",
    );
    if (transition === "cancel")
      assert.equal(done.receipt.outcome.status, "failed");
    assert.notEqual(w.reader.resources().read(staged.asset).status, "ready");
    if (transition !== "open") assert.equal(w.reader.resources(), resources);
    assert.equal(w.diagnostics().activeInputBytes, 0);
    w.owner.dispose();
  }
  const scheduler = f.createTaskScheduler({ concurrency: 1, maxQueued: 2 });
  let release;
  const blocker = scheduler.submit(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await tick();
  const w = d.workspace(await d.initial(), { scheduler });
  const job = w.owner.compute(w.reader.stamp(), d.ref("scaled"));
  assert.equal(job.ok, true);
  assert.ok(w.diagnostics().activeInputBytes > 0);
  job.value.cancel();
  assert.equal((await job.value.completion).receipt.outcome.status, "failed");
  assert.equal(w.diagnostics().activeInputBytes, 0);
  release();
  await blocker.completion;
  w.owner.dispose();
  scheduler.dispose();
});
test("reachable retention follows typed input selections and output assets without executing or projecting", async () => {
  const w = d.workspace(await d.initial(), { historyLimit: 0 });
  const first = await d.compute(w);
  d.factor(w, 3);
  const second = await d.compute(w);
  const before = w.reader.reviewCompaction({ evidence: "reachable" });
  assert.deepEqual(before.removedReceipts, [first.id]);
  assert.equal(before.before.includedAssets, 4);
  assert.equal(before.after.includedAssets, 3);
  assert.equal(w.owner.compact(w.reader.stamp(), d.id(), before).ok, true);
  assert.equal(w.reader.evidence().get(first.id), undefined);
  assert.deepEqual(output(w, second), [
    [3, 6, 9],
    [12, 15, 18],
  ]);
  assert.notEqual(
    w.reader.resources().read(first.outcome.output.body.asset).status,
    "ready",
  );
  assert.equal(w.reader.result(d.ref("scaled")).receipt.id, second.id);
  const backend = f.memoryBackend(),
    io = f.incrementalStorage(backend, d.schemas, d.methods, f.webHash);
  await io.save(d.ticket(w));
  await io.reopen();
  w.owner.dispose();
});
test("late evidence rejects stale provider replacement before reserving authored revision identities", async () => {
  const initial = await d.initial(),
    w = d.workspace(initial),
    stamp = w.reader.stamp(),
    command = d.command(
      "factor",
      "scalar@1",
      { ...f.current(initial.document, "factor").body, value: 3 },
      "revise",
    );
  const receipt = await d.compute(w);
  const stale = w.owner.apply(stamp, d.id(), [command], initial.resources);
  assert.equal(stale.ok, false);
  const fresh = w.owner.apply(
    w.reader.stamp(),
    d.id(),
    [command],
    initial.resources,
  );
  assert.equal(fresh.ok, true, fresh.error);
  assert.deepEqual(output(w, receipt), [
    [2, 4, 6],
    [8, 10, 12],
  ]);
  assert.equal(receiptIds(w).length, 1);
  w.owner.dispose();
});
test("overlapping typed jobs merge verified outputs against publication-time resources", async () => {
  let release, ready;
  const started = new Promise((done) => {
    ready = done;
  });
  const w = d.workspace(await d.initial(), {
    typedExecutor: async (s, signal, io) => {
      if (s.input.body.factor === 2)
        await new Promise((done) => {
          release = done;
          ready();
        });
      return d.execute(s, signal, io);
    },
  });
  const first = w.owner.compute(w.reader.stamp(), d.ref("scaled"));
  await started;
  d.factor(w, 3);
  const second = await d.compute(w);
  release();
  const settled = await first.value.completion;
  assert.equal(settled.receipt.order, 2);
  assert.equal(second.order, 1);
  assert.deepEqual(output(w, second), [
    [3, 6, 9],
    [12, 15, 18],
  ]);
  assert.deepEqual(output(w, settled.receipt), [
    [2, 4, 6],
    [8, 10, 12],
  ]);
  assert.equal(w.reader.result(d.ref("scaled")).receipt.id, second.id);
  await f.decode(d.native(w), d.schemas, d.methods, f.webHash);
  w.owner.dispose();
});
test("input byte admission, staged digest and method byte ceilings reject without partial publication", async () => {
  const initial = await d.initial(),
    size = f.current(initial.document, "mesh").body.asset.size;
  const tooSmall = d.workspace(initial, { maxInputBytes: size - 1 });
  assert.equal(
    tooSmall.owner.compute(tooSmall.reader.stamp(), d.ref("scaled")).ok,
    false,
  );
  assert.equal(tooSmall.diagnostics().activeJobs, 0);
  assert.equal(tooSmall.diagnostics().activeInputBytes, 0);
  tooSmall.owner.dispose();
  for (const mode of ["digest", "output-limit", "async-validation"]) {
    const method =
      mode === "output-limit"
        ? { ...d.method, limits: { ...d.method.limits, outputBytes: 1 } }
        : mode === "async-validation"
          ? {
              ...d.method,
              validateOutput: async () => {
                throw Error("Async validation rejected");
              },
            }
          : d.method;
    const w = d.workspace(initial, {
      methods: f.createMethods([], [method]),
      typedExecutor:
        mode === "digest"
          ? async (s, _signal, io) => {
              await io.stage(s.assets[0], "x".repeat(s.assets[0].size));
              return s.input.body.mesh;
            }
          : d.execute,
    });
    const resources = w.reader.resources(),
      receipt = await d.compute(w);
    assert.equal(receipt.outcome.status, "failed");
    assert.equal(w.reader.resources(), resources);
    assert.equal(w.diagnostics().activeInputBytes, 0);
    w.owner.dispose();
  }
  let calls = 0;
  const corrupt = d.workspace(
    {
      ...initial,
      resources: {
        read(asset) {
          const read = initial.resources.read(asset);
          return asset.digest ===
            f.current(initial.document, "mesh").body.asset.digest
            ? { ...read, data: "[[2,3,4],[5,6,7]]" }
            : read;
        },
      },
    },
    {
      typedExecutor: async (...args) => {
        calls++;
        return d.execute(...args);
      },
    },
  );
  const receipt = await d.compute(corrupt);
  assert.equal(receipt.outcome.status, "failed");
  assert.match(receipt.outcome.reason, /digest/);
  assert.equal(calls, 0);
  corrupt.owner.dispose();
});
test("typed method registration rejects incomplete budgets and overlapping method identities", () => {
  assert.throws(
    () => f.createMethods([], [{ ...d.method, limits: {} }]),
    /limits/,
  );
  assert.throws(
    () => f.createMethods([], [{ ...d.method, input: "" }]),
    /identity/,
  );
  assert.throws(
    () =>
      f.createMethods(
        [{ requirements: d.methodRef, inputs: { x: "mm" }, output: "mm" }],
        [d.method],
      ),
    /Duplicate/,
  );
});

test("a fresh process opens typed output and selected sources without any executor", async () => {
  const w = d.workspace(await d.initial()),
    directory = await mkdtemp(join(tmpdir(), "manifold-typed-native-"));
  try {
    await d.compute(w);
    const path = join(directory, "geometry.manifold");
    await writeFile(path, d.native(w));
    const child = JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("typed-recipient.mjs", import.meta.url)), path],
        { encoding: "utf8" },
      ),
    );
    assert.deepEqual(child, {
      status: "current",
      output: [
        [2, 4, 6],
        [8, 10, 12],
      ],
      receipts: 1,
      jobs: 0,
    });
  } finally {
    w.owner.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("explicit compaction providers cannot retain a superseded managed output map", async () => {
  const w = d.workspace(await d.initial(), { historyLimit: 0 }),
    first = await d.compute(w);
  d.factor(w, 3);
  const second = await d.compute(w),
    resources = w.reader.resources(),
    review = w.reader.reviewCompaction({ evidence: "reachable" });
  const result = w.owner.compact(w.reader.stamp(), d.id(), review, resources);
  assert.equal(result.ok, true, result.error);
  assert.notEqual(
    w.reader.resources().read(first.outcome.output.body.asset).status,
    "ready",
  );
  assert.deepEqual(output(w, second), [
    [3, 6, 9],
    [12, 15, 18],
  ]);
  w.owner.dispose();
});
test("one evidence admission budget counts scalar/typed receipts and pending reservations", async () => {
  const initial = await d.initial(),
    w = d.workspace(initial, { maxReceipts: 2 });
  await d.compute(w);
  await d.compute(w, "pressure");
  const before = w.reader.read(),
    refused = w.owner.compute(w.reader.stamp(), d.ref("scaled"));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /evidence budget/);
  assert.equal(w.reader.read(), before);
  assert.equal(w.diagnostics().activeJobs, 0);
  assert.ok(w.diagnostics().evidenceBytes > 0);
  w.owner.dispose();
  let release, ready;
  const started = new Promise((done) => {
      ready = done;
    }),
    held = d.workspace(initial, {
      maxReceipts: 1,
      typedExecutor: async (...args) => {
        ready();
        await new Promise((done) => {
          release = done;
        });
        return d.execute(...args);
      },
    });
  const pending = held.owner.compute(held.reader.stamp(), d.ref("scaled"));
  await started;
  assert.ok(held.diagnostics().reservedEvidenceBytes >= 256 * 1024);
  assert.equal(
    held.owner.compute(held.reader.stamp(), d.ref("pressure")).ok,
    false,
  );
  release();
  await pending.value.completion;
  assert.equal(held.diagnostics().reservedEvidenceBytes, 0);
  held.owner.dispose();
});
test("metadata reservations reject before execution and reviewed retirement frees shared evidence capacity", async () => {
  const initial = await d.initial();
  let calls = 0;
  const limited = d.workspace(initial, {
    maxEvidenceBytes: 1024,
    typedExecutor: async (...args) => {
      calls++;
      return d.execute(...args);
    },
  });
  assert.equal(
    limited.owner.compute(limited.reader.stamp(), d.ref("scaled")).ok,
    false,
  );
  assert.equal(calls, 0);
  assert.equal(limited.diagnostics().activeJobs, 0);
  limited.owner.dispose();
  const w = d.workspace(initial, { maxReceipts: 1, historyLimit: 0 });
  await d.compute(w);
  d.factor(w, 3);
  assert.equal(w.owner.compute(w.reader.stamp(), d.ref("scaled")).ok, false);
  const review = w.reader.reviewCompaction({ evidence: "reachable" });
  assert.equal(review.removedReceipts.length, 1);
  assert.equal(w.owner.compact(w.reader.stamp(), d.id(), review).ok, true);
  assert.equal(w.diagnostics().evidenceBytes, 0);
  assert.equal((await d.compute(w)).outcome.status, "success");
  w.owner.dispose();
});
test("small closed selections store inline, preserve public meaning and warm recovery without map scaffolding", async () => {
  const w = d.workspace(await d.initial());
  await d.compute(w);
  const backend = f.memoryBackend(),
    io = f.incrementalStorage(backend, d.schemas, d.methods, f.webHash),
    saved = await io.save(d.ticket(w));
  const snapshot = await backend.snapshot(),
    reader = f.recordReader(snapshot, f.webHash),
    top = await reader.node(snapshot.state.head.package),
    receipts = await reader.map(top.roots.receipts, async (token) =>
      reader.node(token),
    ),
    first = Object.values(receipts)[0],
    selected = await reader.node(first.context);
  assert.equal(selected.kind, "value");
  assert.deepEqual(
    selected.value,
    f.contextToPlain([...w.reader.evidence().entries()][0][1].context),
  );
  const recovered = d.workspace((await io.reopen()).loaded),
    warm = await io.save(d.ticket(recovered, saved.head.generation));
  assert.equal(warm.writes.chunks, 0);
  assert.equal(warm.plannedChunks, 1);
  assert.equal(recovered.reader.result(d.ref("scaled")).status, "current");
  w.owner.dispose();
  recovered.owner.dispose();
});
