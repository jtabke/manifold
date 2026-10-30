import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import {
  initial,
  schemas,
  methods,
  ref,
  revision,
  meta,
  id,
  calculate,
} from "./helpers.mjs";

const force = (value, rid = id("force")) => [
  {
    kind: "revise",
    item: "force",
    revision: revision(rid, "force", "scalar@1", { value, unit: "N", ...meta }),
  },
];
const config = (validateDocument) => ({
  schemas,
  methods,
  namespace: "domain",
  validateDocument,
});
test("one domain validation sees the exact immutable edit candidate before its sole publication", async () => {
  const seen = [],
    initialData = await initial();
  let w;
  w = f.createWorkspace(
    initialData,
    config((candidate) => {
      assert.ok(Object.isFrozen(candidate));
      seen.push(candidate);
      if (w) assert.notEqual(candidate, w.reader.read());
    }),
  );
  assert.equal(seen.length, 1);
  const before = w.reader.read(),
    events = [];
  w.reader.subscribe((event) =>
    events.push({ event, document: w.reader.read() }),
  );
  const result = w.owner.apply(w.reader.stamp(), id("root"), force(200));
  assert.equal(result.ok, true);
  assert.equal(seen.length, 2);
  assert.equal(seen[1], result.value.document);
  assert.equal(seen[1], w.reader.read());
  assert.equal(events.length, 1);
  assert.equal(events[0].document, seen[1]);
  assert.equal(f.current(before, "force").body.value, 100);
  assert.equal(w.diagnostics().undoSteps, 1);
});
test("domain rejection preserves state, resources, evidence, Undo, identities and notifications", async () => {
  const loaded = await initial();
  const w = f.createWorkspace(
    loaded,
    config((candidate) => {
      assert.ok(
        f.current(candidate, "force").body.value <= 200,
        "Load outside app domain",
      );
    }),
  );
  const before = w.reader.capture(),
    events = [];
  w.reader.subscribe((event) => events.push(event));
  const root = id("root"),
    rid = id("force"),
    replacements = {
      read: () => ({ status: "unavailable", reason: "Replacement" }),
    };
  const rejected = w.owner.apply(
    w.reader.stamp(),
    root,
    [
      { kind: "rename", item: "draft", label: "Must not publish" },
      ...force(300, rid),
    ],
    replacements,
  );
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Load outside/);
  assert.equal(w.reader.read(), before.document);
  assert.equal(w.reader.resources(), before.resources);
  assert.equal(w.reader.evidence(), before.receipts);
  assert.equal(w.diagnostics().undoSteps, 0);
  assert.equal(events.length, 0);
  // Rejected candidates never allocated these identities in the owner.
  assert.equal(w.owner.apply(w.reader.stamp(), root, force(200, rid)).ok, true);
  assert.equal(events.length, 1);
});
test("stale and reentrant edits cannot bypass the owner's validation boundary", async () => {
  let w,
    nested,
    count = 0;
  w = f.createWorkspace(
    await initial(),
    config(() => {
      count++;
      if (w) nested = w.owner.apply(w.reader.stamp(), id("nested"), force(150));
    }),
  );
  const stale = w.reader.stamp();
  assert.equal(w.owner.apply(stale, id("root"), force(200)).ok, true);
  assert.equal(nested.ok, false);
  assert.match(nested.error, /Operation in progress/);
  const calls = count;
  assert.equal(w.owner.apply(stale, id("stale"), force(300)).ok, false);
  assert.equal(count, calls);
  assert.equal(f.current(w.reader.read(), "force").body.value, 200);
  assert.equal(w.diagnostics().undoSteps, 1);
});
test("non-synchronous validators reject before publication and leave the owner reusable", async () => {
  let invalid = "";
  const w = f.createWorkspace(
    await initial(),
    config(() =>
      invalid === "reject"
        ? Promise.reject(Error("Async validation failure"))
        : invalid
          ? Promise.resolve()
          : undefined,
    ),
  );
  const before = w.reader.read();
  for (const mode of ["resolve", "reject"]) {
    invalid = mode;
    const rejected = w.owner.apply(w.reader.stamp(), id("root"), force(200));
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /synchronous/);
    assert.equal(w.reader.read(), before);
    await new Promise((resolve) => setImmediate(resolve));
  }
  invalid = "";
  assert.equal(
    w.owner.apply(w.reader.stamp(), id("root"), force(200)).ok,
    true,
  );
});
test("Undo, preview, Keep and cleanup validate before changing any lifecycle state", async () => {
  let reject = false;
  const seen = [];
  const w = f.createWorkspace(
    await initial(),
    config((candidate) => {
      seen.push(candidate);
      assert.equal(reject, false, "Rejected by host");
    }),
  );
  assert.equal(
    w.owner.apply(w.reader.stamp(), id("root"), force(200)).ok,
    true,
  );
  const beforeUndo = w.reader.read();
  reject = true;
  assert.equal(w.owner.undo(w.reader.stamp(), id("undo")).ok, false);
  assert.equal(w.reader.read(), beforeUndo);
  assert.equal(w.diagnostics().undoSteps, 1);
  assert.equal(
    w.owner.preview(w.reader.stamp(), ref("pressure"), [
      { item: "force", revision: force(300)[0].revision },
    ]).ok,
    false,
  );
  assert.equal(w.reader.preview(), undefined);
  reject = false;
  assert.equal(
    w.owner.preview(w.reader.stamp(), ref("pressure"), [
      { item: "force", revision: force(300)[0].revision },
    ]).ok,
    true,
  );
  const preview = w.reader.preview(),
    view = {
      id: id("view"),
      reference: ref("pressure"),
      renderer: "result@1",
      x: 400,
      y: 200,
      alternative: null,
    };
  const aid = id("alt"),
    root = id("keep");
  view.alternative = aid;
  reject = true;
  assert.equal(
    w.owner.keep(w.reader.stamp(), root, aid, "Alternative", view).ok,
    false,
  );
  assert.equal(w.reader.preview(), preview);
  assert.equal(w.reader.read(), beforeUndo);
  reject = false;
  assert.equal(
    w.owner.keep(w.reader.stamp(), root, aid, "Alternative", view).ok,
    true,
  );
  const review = w.reader.reviewCompaction({ evidence: "all" }),
    beforeCleanup = w.reader.capture();
  reject = true;
  assert.equal(
    w.owner.compact(w.reader.stamp(), id("cleanup"), review).ok,
    false,
  );
  assert.equal(w.reader.read(), beforeCleanup.document);
  assert.equal(w.reader.evidence(), beforeCleanup.receipts);
  reject = false;
  assert.equal(
    w.owner.compact(w.reader.stamp(), id("cleanup"), review).ok,
    true,
  );
  assert.equal(seen.at(-1), w.reader.read());
});
test("failed Open preserves old binding, pending jobs, original resources and Undo", async () => {
  const calls = [];
  let reject = false;
  const w = f.createWorkspace(await initial(), {
    ...config(() => {
      assert.equal(reject, false, "Rejected Open");
    }),
    executor: (s, signal) =>
      new Promise((resolve) => calls.push({ s, signal, resolve })),
  });
  assert.equal(
    w.owner.apply(w.reader.stamp(), id("root"), force(200)).ok,
    true,
  );
  const job = w.owner.compute(w.reader.stamp(), ref("pressure"));
  assert.equal(job.ok, true);
  await Promise.resolve();
  const before = w.reader.capture();
  reject = true;
  assert.equal(w.owner.open(w.reader.stamp(), await initial()).ok, false);
  assert.deepEqual(w.reader.stamp(), before.stamp);
  assert.equal(w.reader.read(), before.document);
  assert.equal(w.reader.resources(), before.resources);
  assert.equal(w.diagnostics().undoSteps, 1);
  assert.equal(calls[0].signal.aborted, false);
  reject = false;
  calls[0].resolve(calculate(calls[0].s));
  assert.equal((await job.value.completion).status, "retained");
  assert.equal(w.owner.open(w.reader.stamp(), await initial()).ok, true);
  assert.equal(w.reader.stamp().binding, before.stamp.binding + 1);
});
test("evidence-only arrival uses its own checked lane without rerunning authored domain validation", async () => {
  let calls = 0;
  const w = f.createWorkspace(await initial(), {
    ...config(() => {
      calls++;
    }),
    executor: async (s) => calculate(s),
  });
  const job = w.owner.compute(w.reader.stamp(), ref("pressure"));
  assert.equal(job.ok, true);
  await job.value.completion;
  assert.equal(calls, 1);
  assert.equal(w.diagnostics().receipts, 1);
  assert.equal(w.diagnostics().undoSteps, 0);
});
