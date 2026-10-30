import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as h from "./helpers.mjs";
import * as typed from "./typed-fixture.mjs";

test("retained policy sees complete immutable candidates before authored and evidence publication", async () => {
  const seen = [];
  const w = await h.workspace(undefined, undefined, {
    validateState: (state) => {
      assert.ok(Object.isFrozen(state));
      seen.push(state);
    },
  });
  assert.equal(seen.length, 1);
  h.force(w, 200);
  assert.equal(seen.at(-1).document, w.reader.read());
  const before = w.reader.capture();
  const started = w.owner.compute(w.reader.stamp(), h.ref("pressure"));
  assert.equal(started.ok, true, started.error);
  assert.equal((await started.value.completion).status, "retained");
  const state = seen.at(-1);
  assert.equal(state.document, w.reader.read());
  assert.equal(state.receipts, w.reader.evidence());
  assert.equal(state.resources, w.reader.resources());
  assert.equal(before.receipts.size, 0);
  assert.equal(state.receipts.size, 1);
  assert.equal(w.diagnostics().undoSteps, 1);
  assert.equal(
    f.isWorkspaceCapture(state),
    false,
    "policy is not a forged Save capture capability",
  );
  w.owner.dispose();
});

test("retained policy rejects Undo, preview, Keep, Open and compaction without partial publication", async () => {
  let reject = false;
  const w = await h.workspace(undefined, undefined, {
    validateState: () => {
      if (reject) throw Error("Capacity refused");
    },
  });
  h.force(w, 200);
  const before = w.reader.capture();
  reject = true;
  assert.equal(w.owner.undo(w.reader.stamp(), h.id("undo")).ok, false);
  assert.equal(w.reader.read(), before.document);
  assert.equal(w.diagnostics().undoSteps, 1);
  assert.throws(() => h.preview(w, 300), /Capacity refused/);
  assert.equal(w.reader.preview(), undefined);
  reject = false;
  h.preview(w, 300);
  const preview = w.reader.preview();
  reject = true;
  assert.throws(() => h.keep(w), /Capacity refused/);
  assert.equal(w.reader.preview(), preview);
  const opened = w.owner.open(w.reader.stamp(), await h.initial());
  assert.equal(opened.ok, false);
  assert.equal(w.reader.read(), before.document);
  assert.equal(w.reader.resources(), before.resources);
  assert.equal(w.reader.evidence(), before.receipts);
  const review = w.reader.reviewCompaction({ evidence: "all" });
  assert.equal(
    w.owner.compact(w.reader.stamp(), h.id("compact"), review).ok,
    false,
  );
  assert.equal(w.reader.read(), before.document);
  reject = false;
  assert.equal(
    w.owner.compact(w.reader.stamp(), h.id("compact"), review).ok,
    true,
  );
  w.owner.dispose();
});

test("rejected typed evidence publishes neither staged bytes nor receipts and retries on the same clock", async () => {
  let reject = true,
    staged;
  const w = typed.workspace(await typed.initial(), {
    validateState: (state) => {
      const receipt = [...state.receipts.entries()].at(-1)?.[1];
      if (receipt?.kind === "typed@1") {
        staged = receipt.outcome.output.body.asset;
        assert.equal(state.resources.read(staged).status, "ready");
        if (reject) throw Error("Output exceeds shared capacity");
      }
    },
  });
  const before = w.reader.capture();
  const job = w.owner.compute(w.reader.stamp(), typed.ref("scaled"));
  assert.equal(job.ok, true, job.error);
  const result = await job.value.completion;
  assert.equal(result.status, "discarded");
  assert.match(result.reason, /shared capacity/);
  assert.equal(w.reader.read(), before.document);
  assert.equal(w.reader.evidence(), before.receipts);
  assert.equal(w.reader.resources(), before.resources);
  assert.equal(w.reader.resources().read(staged).status, "missing");
  reject = false;
  assert.equal((await typed.compute(w)).order, 1);
  w.owner.dispose();
});

test("policy cannot reenter writes or teardown during evidence publication", async () => {
  let w, nested;
  w = await h.workspace(undefined, undefined, {
    validateState: (state) => {
      if (!w || !state.receipts.size) return;
      nested = w.owner.apply(w.reader.stamp(), h.id("nested"), []);
      assert.throws(() => w.owner.dispose(), /Operation in progress/);
    },
  });
  const job = w.owner.compute(w.reader.stamp(), h.ref("pressure"));
  assert.equal((await job.value.completion).status, "retained");
  assert.equal(nested.ok, false);
  assert.equal(w.owner.apply(w.reader.stamp(), h.id("after"), []).ok, true);
  w.owner.dispose();
});

test("async state policy rejects initialization/admission and consumes rejected promises", async () => {
  const data = await h.initial();
  assert.throws(
    () =>
      f.createWorkspace(data, {
        schemas: h.schemas,
        namespace: h.id("async"),
        validateState: async () => {
          throw Error("async denied");
        },
      }),
    /State validation must be synchronous/,
  );
  let reject = false;
  const w = await h.workspace(undefined, undefined, {
    validateState: () =>
      reject ? Promise.reject(Error("async denied")) : undefined,
  });
  const before = w.reader.read();
  reject = true;
  const job = w.owner.compute(w.reader.stamp(), h.ref("pressure"));
  assert.equal((await job.value.completion).status, "discarded");
  assert.equal(w.reader.read(), before);
  assert.equal(w.reader.evidence().size, 0);
  await new Promise((resolve) => setImmediate(resolve));
  w.owner.dispose();
});

test("policy checks candidate replacement resources before any authored publication", async () => {
  const data = await typed.initial(),
    asset = f.current(data.document, "mesh").body.asset;
  const w = typed.workspace(data, {
    validateState: (state) => {
      assert.equal(
        state.resources.read(asset).status,
        "ready",
        "Included input must stay exportable",
      );
    },
  });
  const before = w.reader.capture(),
    root = typed.id();
  const rejected = w.owner.apply(w.reader.stamp(), root, [], {
    read: () => ({ status: "missing", reason: "Replacement lacks source" }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(w.reader.read(), before.document);
  assert.equal(w.reader.resources(), before.resources);
  assert.equal(
    w.owner.apply(w.reader.stamp(), root, []).ok,
    true,
    "failed policy did not consume the root identity",
  );
  w.owner.dispose();
});
