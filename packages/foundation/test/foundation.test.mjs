import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as f from "../src/index.ts";
import {
  workspace,
  initial,
  schemas,
  methods,
  hash,
  calculate,
  ref,
  meta,
  revision,
  current,
  apply,
  force,
  preview,
  keep,
  undo,
  compute,
  serialized,
  controlled,
  id,
} from "./helpers.mjs";
test("promoted persistent map preserves old roots under randomized writes", () => {
  let map = f.SharedMap.empty(),
    oracle = new Map(),
    seed = 7;
  const saved = [];
  for (let n = 0; n < 2000; n++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const key = String(seed % 257);
    if (n % 4 === 0) {
      map = map.delete(key);
      oracle.delete(key);
    } else {
      map = map.set(key, n);
      oracle.set(key, n);
    }
    if (n % 80 === 0) saved.push([map, new Map(oracle)]);
    map.validate();
  }
  for (const [m, o] of saved)
    assert.deepEqual(
      [...m.entries()],
      [...o].sort(([a], [b]) => (a < b ? -1 : 1)),
    );
});
test("notes remain incomplete, identity is label-independent, view movement does no content work", async () => {
  const w = await workspace(),
    before = w.reader.read(),
    record = current(before, "force");
  apply(w, [
    { kind: "rename", item: "force", label: "Same label as another item" },
  ]);
  assert.equal(current(w.reader.read(), "force"), record);
  const changed = apply(w, [
    {
      kind: "view",
      view: { ...w.reader.read().views.get("draft-view"), x: 900, y: -5 },
    },
  ]);
  assert.equal(changed.document.revisions, before.revisions);
  assert.deepEqual(changed.changes.affected, []);
  assert.equal(
    f.project(w.reader.read(), ref("draft"), schemas, w.reader.resources())
      .projection.value,
    "F =",
  );
});
test("failed compound operations publish nothing and cannot retain mutable caller data", async () => {
  const w = await workspace(),
    before = w.reader.stamp(),
    bad = revision(id("bad"), "force", "scalar@1", {
      value: NaN,
      unit: "N",
      ...meta,
    });
  assert.equal(
    w.owner.apply(before, id("bad-root"), [
      { kind: "rename", item: "force", label: "Wrong" },
      { kind: "revise", item: "force", revision: bad },
    ]).ok,
    false,
  );
  assert.deepEqual(w.reader.stamp(), before);
  const body = { value: 200, unit: "N", ...meta };
  apply(w, [
    {
      kind: "revise",
      item: "force",
      revision: revision(id("new"), "force", "scalar@1", body),
    },
  ]);
  body.value = 99;
  assert.equal(current(w.reader.read(), "force").body.value, 200);
});
test("direct dependencies notify only affected descendants; pins keep old meaning", async () => {
  const w = await workspace();
  const changes = force(w, 200).changes;
  assert.deepEqual([...changes.affected].sort(), ["force", "pressure"].sort());
  const old = f.project(
    w.reader.read(),
    { ...ref("force"), selection: { kind: "pin", revision: "force-r1" } },
    schemas,
    w.reader.resources(),
  );
  assert.equal(old.projection.value.value, 100);
  assert.equal(changes.affected.includes("required-force"), false);
});
test("explicit methods use exact versions and current verified inputs", async () => {
  const w = await workspace();
  await compute(w);
  await compute(w, ref("required-force"));
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.04,
  );
  assert.equal(
    w.reader.result(ref("required-force")).receipt.outcome.output.value,
    200,
  );
  assert.equal(w.diagnostics().undoSteps, 0);
  const method = current(w.reader.read(), "pressure").body;
  apply(w, [
    {
      kind: "revise",
      item: "pressure",
      revision: revision(id("unsupported"), "pressure", "request@1", {
        ...method,
        method: { ...method.method, version: "2" },
      }),
    },
  ]);
  assert.equal(w.reader.result(ref("pressure")).status, "blocked");
  assert.equal(w.owner.compute(w.reader.stamp(), ref("pressure")).ok, false);
});
test("preview/cancel does not author baseline or create Undo", async () => {
  const w = await workspace(),
    before = w.reader.stamp();
  preview(w, 200);
  assert.deepEqual(w.reader.stamp(), before);
  await compute(w, ref("pressure"), "preview");
  assert.equal(
    w.reader.result(ref("pressure"), "preview").receipt.outcome.output.value,
    0.08,
  );
  assert.equal(current(w.reader.read(), "force").body.value, 100);
  assert.equal(w.owner.cancelPreview(w.reader.stamp()).ok, true);
  assert.equal(w.reader.read().id, before.root);
  assert.equal(w.reader.read().alternatives.size, 0);
  assert.equal(w.diagnostics().undoSteps, 0);
  assert.equal(w.diagnostics().receipts, 1);
});
test("Keep publishes complete frozen meaning and comparison together; Undo restores both", async () => {
  const w = await workspace();
  preview(w, 200);
  await compute(w, ref("pressure"), "preview");
  const events = [];
  w.reader.subscribe((e) =>
    events.push({
      e,
      alts: w.reader.read().alternatives.size,
      views: w.reader.read().views.size,
      preview: !!w.reader.preview(),
    }),
  );
  const kept = keep(w);
  assert.equal(events.length, 1);
  assert.equal(events[0].alts, 1);
  assert.equal(events[0].preview, false);
  assert.equal(
    w.reader.read().views.get(kept.view).alternative,
    kept.alternative,
  );
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.08,
  );
  force(w, 300);
  await compute(w);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.12,
  );
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.08,
  );
  undo(w);
  undo(w);
  assert.equal(w.reader.read().alternatives.size, 0);
  assert.equal(w.reader.read().views.get(kept.view), undefined);
  assert.equal(w.diagnostics().receipts, 2);
});
test("preview stays valid after view movement and unrelated draft edits, rejects changed inputs", async () => {
  const w = await workspace();
  preview(w, 200);
  apply(w, [
    {
      kind: "view",
      view: { ...w.reader.read().views.get("draft-view"), x: 200, y: 300 },
    },
    {
      kind: "revise",
      item: "draft",
      revision: revision(id("draft"), "draft", "note@1", {
        text: "F = unfinished",
        mode: "draft",
      }),
    },
  ]);
  keep(w);
  preview(w, 400);
  force(w, 500);
  const before = w.reader.stamp();
  const result = w.owner.keep(before, id("stale-keep"), id("alt"), "Stale", {
    id: id("view"),
    reference: ref("pressure"),
    renderer: "result@1",
    x: 0,
    y: 0,
    alternative: "not-matching",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /stale/);
  assert.deepEqual(w.reader.stamp(), before);
});
async function replaceArea(w, value) {
  const text = JSON.stringify([[value]]),
    a = await f.asset(text, hash),
    resources = await w.reader.resources().add(a, text, hash),
    rid = id("area");
  const commands = [
    {
      kind: "revise",
      item: "area",
      revision: revision(rid, "area", "source@1", {
        ...current(w.reader.read(), "area").body,
        asset: a,
      }),
    },
  ];
  for (const name of ["pressure", "required-force"]) {
    const old = current(w.reader.read(), name);
    commands.push({
      kind: "revise",
      item: name,
      revision: revision(id(name), name, "request@1", {
        ...old.body,
        inputs: {
          ...old.body.inputs,
          area: {
            ...old.body.inputs.area,
            selector: { ...old.body.inputs.area.selector, revision: rid },
          },
        },
      }),
    });
  }
  return apply(w, commands, resources);
}
test("source reimport updates baseline explicitly and kept alternatives keep old source bytes", async () => {
  const w = await workspace();
  preview(w, 200);
  const kept = keep(w);
  await compute(w, ref("pressure"), { alternative: kept.alternative });
  await replaceArea(w, 5000);
  await compute(w);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.02,
  );
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.08,
  );
  const copy = await workspace(
    undefined,
    await f.decode(serialized(w), schemas, methods, hash),
  );
  assert.equal(
    copy.reader.result(ref("pressure"), { alternative: kept.alternative })
      .receipt.outcome.output.value,
    0.08,
  );
  assert.equal([...f.assets(copy.reader.read(), schemas)].length, 2);
});
test("following coordinates never infer continuity after a source changes", async () => {
  const w = await workspace();
  const old = current(w.reader.read(), "area");
  apply(w, [
    { kind: "revise", item: "area", revision: { ...old, id: id("reimport") } },
  ]);
  assert.equal(w.reader.result(ref("pressure")).status, "blocked");
  assert.equal(
    f.project(
      w.reader.read(),
      current(w.reader.read(), "pressure").body.inputs.area,
      schemas,
      w.reader.resources(),
    ).status,
    "ambiguous",
  );
});
test("out-of-order and cancelled-preview jobs cannot alter baseline, views or alternatives", async () => {
  const e = controlled(),
    w = await workspace(e.execute);
  const old = w.owner.compute(w.reader.stamp(), ref("pressure"));
  await Promise.resolve();
  force(w, 200);
  const newer = w.owner.compute(w.reader.stamp(), ref("pressure"));
  await Promise.resolve();
  e.calls[1].resolve(calculate(e.calls[1].snapshot));
  await newer.value.completion;
  e.calls[0].resolve(calculate(e.calls[0].snapshot));
  await old.value.completion;
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.08,
  );
  preview(w, 400);
  const pending = w.owner.compute(w.reader.stamp(), ref("pressure"), "preview");
  await Promise.resolve();
  w.owner.cancelPreview(w.reader.stamp());
  const before = w.reader.stamp();
  e.calls[2].resolve(calculate(e.calls[2].snapshot));
  await pending.value.completion;
  assert.equal(w.reader.stamp().root, before.root);
  assert.equal(w.reader.read().alternatives.size, 0);
  assert.equal(w.reader.read().views.size, 2);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.08,
  );
  assert.equal(w.diagnostics().undoSteps, 1);
});
test("held preview completion remains valid for an alternative kept before it finishes", async () => {
  const e = controlled(),
    w = await workspace(e.execute);
  preview(w, 200);
  const j = w.owner.compute(w.reader.stamp(), ref("pressure"), "preview");
  await Promise.resolve();
  const kept = keep(w);
  force(w, 500);
  e.calls[0].resolve(calculate(e.calls[0].snapshot));
  await j.value.completion;
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).receipt
      .outcome.output.value,
    0.08,
  );
  assert.equal(w.reader.result(ref("pressure")).status, "ready");
});
test("incomplete frozen selections do not fall back to a later baseline", async () => {
  const w = await workspace(),
    body = current(w.reader.read(), "pressure").body;
  apply(w, [
    {
      kind: "revise",
      item: "pressure",
      revision: revision(id("missing-ref"), "pressure", "request@1", {
        ...body,
        inputs: { ...body.inputs, force: ref("not-created-yet") },
      }),
    },
  ]);
  preview(w, 200);
  const kept = keep(w);
  apply(w, [
    {
      kind: "create",
      item: "not-created-yet",
      label: "New",
      revision: revision(id("new-force"), "not-created-yet", "scalar@1", {
        value: 800,
        unit: "N",
        ...meta,
      }),
    },
  ]);
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: kept.alternative }).status,
    "blocked",
  );
  assert.equal(w.reader.result(ref("pressure")).status, "ready");
});
test("wrong-shaped/nonfinite/unit/frame outputs and adapter failures remain failed evidence", async () => {
  for (const output of [
    2,
    { value: Infinity, unit: "MPa", ...meta },
    { value: 2, unit: "N", ...meta },
    { value: 2, unit: "MPa", ...meta, frame: "other" },
  ]) {
    const w = await workspace(async () => output);
    await compute(w);
    assert.equal(w.reader.result(ref("pressure")).status, "failed");
    assert.equal(w.diagnostics().undoSteps, 0);
  }
  const w = await workspace(async () => {
    throw Error("external tool missing");
  });
  await compute(w);
  assert.match(
    w.reader.result(ref("pressure")).receipt.outcome.reason,
    /external tool missing/,
  );
});
test("new bindings discard late jobs and noncooperative adapters cannot bypass the job bound", async () => {
  const e = controlled(),
    w = await workspace(e.execute);
  const pending = [];
  for (let i = 0; i < 4; i++) {
    const j = w.owner.compute(w.reader.stamp(), ref("pressure"));
    assert.equal(j.ok, true);
    pending.push(j);
    await Promise.resolve();
    assert.equal(w.owner.open(w.reader.stamp(), await initial()).ok, true);
  }
  assert.equal(w.diagnostics().activeJobs, 4);
  assert.equal(w.owner.compute(w.reader.stamp(), ref("pressure")).ok, false);
  for (const c of e.calls) c.resolve(calculate(c.snapshot));
  await Promise.all(pending.map((j) => j.value.completion));
  assert.equal(w.diagnostics().receipts, 0);
});
test("native handoff carries alternatives, views, source pins and receipts to a fresh process without jobs", async () => {
  const w = await workspace();
  preview(w, 200);
  const kept = keep(w);
  await compute(w, ref("pressure"), { alternative: kept.alternative });
  force(w, 300);
  await compute(w);
  const dir = await mkdtemp(join(tmpdir(), "manifold-foundation-"));
  try {
    const path = join(dir, "work.manifold");
    await writeFile(path, serialized(w));
    const out = JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(new URL("./fresh-reader.mjs", import.meta.url)), path],
        { encoding: "utf8" },
      ),
    );
    assert.equal(out.alternatives, 1);
    assert.equal(out.jobs, 0);
    assert.equal(out.baseline, 0.12);
    assert.equal(out.alternative, 0.08);
    assert.equal(out.executions, 0);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("corrupt bytes, missing pins, unsupported required data and tampered receipts reject before adoption", async () => {
  const w = await workspace();
  preview(w, 200);
  keep(w);
  await compute(w);
  const original = serialized(w),
    before = w.reader.stamp();
  for (const mutate of [
    (e) => (e.assets[Object.keys(e.assets)[0]] = "bad"),
    (e) =>
      (e.document.alternatives[
        Object.keys(e.document.alternatives)[0]
      ].context.heads.force = "missing"),
    (e) => (e.document.revisions["draft-r1"].schema = "future@1"),
    (e) =>
      (e.snapshots[e.receipts[0].snapshot].inputs.force.scalar.value = 999),
  ]) {
    const e = JSON.parse(original);
    mutate(e);
    await assert.rejects(f.decode(JSON.stringify(e), schemas, methods, hash));
    assert.deepEqual(w.reader.stamp(), before);
  }
});
test("unknown optional content round-trips exactly read-only instead of inventing behavior", async () => {
  const w = await workspace(),
    e = JSON.parse(serialized(w));
  e.document.revisions["draft-r1"] = {
    ...e.document.revisions["draft-r1"],
    schema: "native-cad@9",
    required: false,
    body: { opaque: ["owner-specific", 1] },
  };
  const text = JSON.stringify(e, null, 2),
    loaded = await f.decode(text, schemas, methods, hash),
    opened = await workspace(undefined, loaded);
  assert.equal(opened.reader.read().readOnly, true);
  assert.equal(
    opened.owner.apply(opened.reader.stamp(), id("edit"), []).ok,
    false,
  );
  assert.equal(serialized(opened), text);
});
test("a new content handler reuses identity, views, operations and portable closure without core branches", async () => {
  const extension = {
      id: "checklist@1",
      validate(v) {
        assert.ok(Array.isArray(v));
        for (const x of v) assert.equal(typeof x, "string");
      },
      references: () => [],
      assets: () => [],
      project(b, s) {
        return s.kind === "whole"
          ? { type: "text", value: b.join("\n") }
          : { status: "unsupported", reason: "selector" };
      },
    },
    registry = f.createSchemas([extension]),
    loaded = await initial();
  const doc = f.prepare(
    loaded.document,
    id("extension-root"),
    [
      {
        kind: "create",
        item: "review",
        label: "Review",
        revision: revision(id("review"), "review", "checklist@1", [
          "Check sources",
          "Check units",
        ]),
      },
    ],
    registry,
  ).document;
  const data = f.encode(doc, [], loaded.resources, registry),
    read = await f.decode(data, registry, methods, hash);
  assert.equal(
    f.project(read.document, ref("review"), registry, read.resources).projection
      .value,
    "Check sources\nCheck units",
  );
});
test("head CAS, all interruption points and receipt-aware acknowledgements preserve the previous save", async () => {
  const e = controlled(),
    w = await workspace(e.execute),
    backend = f.memoryBackend(),
    io = f.storage(backend, schemas, methods, hash);
  const ticket = () => ({
    request: id("save"),
    stamp: w.reader.stamp(),
    document: w.reader.read().document,
    expectedGeneration: 0,
    native: serialized(w),
  });
  const first = ticket(),
    head = await io.save(first);
  assert.equal(f.acknowledgementApplies(head, first, w.reader.stamp()), true);
  for (const fault of ["after-assets", "after-package", "before-publish"]) {
    await assert.rejects(
      io.save({ ...ticket(), expectedGeneration: 1 }, fault),
    );
    assert.deepEqual(await backend.head(), head);
  }
  const job = w.owner.compute(w.reader.stamp(), ref("pressure"));
  await Promise.resolve();
  const captured = { ...ticket(), expectedGeneration: 1 };
  let release;
  const wait = new Promise((r) => (release = r)),
    saving = io.save(captured, "none", () => wait);
  e.calls[0].resolve(calculate(e.calls[0].snapshot));
  await job.value.completion;
  release();
  const old = await saving;
  assert.equal(
    f.acknowledgementApplies(old, captured, w.reader.stamp()),
    false,
  );
  await assert.rejects(io.save(captured), /conflict/);
  const before = w.reader.stamp();
  backend.loseAsset(Object.keys(JSON.parse(first.native).assets)[0]);
  await assert.rejects(io.reopen(), /Missing saved asset/);
  assert.deepEqual(w.reader.stamp(), before);
});
test("late Open cannot drop an arriving receipt; evidence arrival does not block unrelated authoring", async () => {
  const e = controlled(),
    w = await workspace(e.execute),
    stamp = w.reader.stamp(),
    j = w.owner.compute(stamp, ref("pressure"));
  await Promise.resolve();
  e.calls[0].resolve(calculate(e.calls[0].snapshot));
  await j.value.completion;
  assert.equal(w.owner.open(stamp, await initial()).ok, false);
  const r = w.owner.apply(stamp, id("draft-root"), [
    { kind: "rename", item: "draft", label: "Still editable" },
  ]);
  assert.equal(r.ok, true);
});
test("bounded Undo and reentrant publication are independent of evidence", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 2 });
  let entered = 0;
  w.reader.subscribe(() => {
    entered++;
    assert.equal(w.owner.apply(w.reader.stamp(), id("nested"), []).ok, false);
    throw Error("bad renderer");
  });
  for (let i = 0; i < 4; i++) force(w, i);
  assert.equal(w.diagnostics().undoSteps, 2);
  assert.equal(entered, 4);
  assert.equal(w.diagnostics().notificationErrors, 4);
  undo(w);
  undo(w);
  assert.equal(w.owner.undo(w.reader.stamp(), id("none")).ok, false);
});
test("bounded parsed-source cache rechecks availability and evicts by weight", async () => {
  const registry = f.createSchemas([], {
      sourceCacheBytes: 32,
      maxSourceCells: 10,
    }),
    loaded = await initial(),
    doc = loaded.document,
    source = current(doc, "pressure").body.inputs.area;
  assert.equal(
    f.project(doc, source, registry, loaded.resources).status,
    "resolved",
  );
  assert.equal(
    f.project(doc, source, registry, loaded.resources).status,
    "resolved",
  );
  assert.equal(registry.diagnostics().sourceParses, 1);
  assert.equal(registry.diagnostics().sourceCacheWeight, 32);
  assert.equal(
    f.project(doc, source, registry, {
      read: () => ({ status: "unavailable", reason: "offline" }),
    }).status,
    "unavailable",
  );
  const bytes = "[[3000]]",
    a = await f.asset(bytes, hash),
    resources = await loaded.resources.add(a, bytes, hash),
    original = current(doc, "area");
  const changed = f.prepare(
    doc,
    "cache-source-root",
    [
      {
        kind: "revise",
        item: "area",
        revision: {
          ...original,
          id: "cache-source-r2",
          body: { ...original.body, asset: a },
        },
      },
    ],
    registry,
  ).document;
  const nextRef = {
    ...source,
    selector: { ...source.selector, revision: "cache-source-r2" },
  };
  f.project(changed, nextRef, registry, resources);
  assert.equal(registry.diagnostics().sourceParses, 2);
  assert.equal(registry.diagnostics().sourceCacheEntries, 1);
  f.project(
    changed,
    { ...source, selection: { kind: "pin", revision: "area-r1" } },
    registry,
    resources,
  );
  assert.equal(registry.diagnostics().sourceParses, 3);
  assert.equal(registry.diagnostics().sourceCacheWeight, 32);
  const zero = f.createSchemas([], { sourceCacheBytes: 0 });
  f.project(doc, source, zero, loaded.resources);
  f.project(doc, source, zero, loaded.resources);
  assert.equal(zero.diagnostics().sourceCacheEntries, 0);
  assert.equal(zero.diagnostics().sourceParses, 2);
});
test("JSON contracts reject silent serialization loss and cyclic data", () => {
  let invoked = false;
  assert.throws(
    () =>
      f.retained({
        get bad() {
          invoked = true;
          return 1;
        },
      }),
    /Accessors/,
  );
  assert.equal(invoked, false);
  assert.throws(() => f.retained(Array(2)), /Sparse/);
  assert.throws(() => f.retained({ x: undefined }), /Non-JSON/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => f.retained(cycle), /Cyclic/);
  assert.throws(() => f.retained({ [Symbol("hidden")]: 1 }), /Symbol/);
});
test("private native fixture is stable and its source closure remains editable after reopen", async () => {
  const { portableFixture } = await import("./fixture.mjs"),
    { readFile } = await import("node:fs/promises");
  const text = (
    await readFile(new URL("portable-v2.fixture.json", import.meta.url), "utf8")
  ).trimEnd();
  assert.equal(await portableFixture(), text);
  const loaded = await f.decode(text, schemas, methods, hash),
    w = await workspace(undefined, loaded);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.12,
  );
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: "higher-load" }).receipt
      .outcome.output.value,
    0.08,
  );
  force(w, 500);
  assert.equal(
    w.reader.result(ref("pressure"), { alternative: "higher-load" }).receipt
      .outcome.output.value,
    0.08,
  );
});
test("unknown optional data inside a frozen context preserves the entire package without interpreting receipts", async () => {
  const w = await workspace();
  preview(w, 200);
  keep(w);
  await compute(w, ref("pressure"), {
    alternative: [...w.reader.read().alternatives.entries()][0][0],
  });
  const e = JSON.parse(serialized(w));
  e.document.revisions["pressure-r1"].schema = "future-request@2";
  e.document.revisions["pressure-r1"].required = false;
  e.document.revisions["pressure-r1"].body = {
    native: { preserve: "without decoding" },
  };
  const text = JSON.stringify(e, null, 2),
    loaded = await f.decode(text, schemas, methods, hash),
    read = await workspace(undefined, loaded);
  assert.equal(read.reader.read().readOnly, true);
  assert.equal(read.diagnostics().receipts, 0);
  assert.equal(read.reader.result(ref("pressure")).status, "blocked");
  assert.equal(serialized(read), text);
  const backend = f.memoryBackend(),
    io = f.storage(backend, schemas, methods, hash);
  await io.save({
    request: "opaque",
    stamp: read.reader.stamp(),
    document: read.reader.read().document,
    expectedGeneration: 0,
    native: serialized(read),
  });
  assert.equal((await io.reopen()).loaded.original, text);
});
test("portable retries share context/snapshot tables without losing individual outcomes or order", async () => {
  let n = 0;
  const w = await workspace(async (s) => ({ ...calculate(s), value: ++n }));
  for (let i = 0; i < 20; i++) await compute(w);
  const native = serialized(w),
    e = JSON.parse(native);
  assert.equal(e.receipts.length, 20);
  assert.equal(Object.keys(e.contexts).length, 1);
  assert.equal(Object.keys(e.snapshots).length, 1);
  const restored = await workspace(
    undefined,
    await f.decode(native, schemas, methods, hash),
  );
  assert.equal(restored.diagnostics().receipts, 20);
  assert.equal(
    restored.reader.result(ref("pressure")).receipt.outcome.output.value,
    20,
  );
});
test("cyclic authored relationships terminate context/invalidation traversal without inventing an execution DAG", async () => {
  const w = await workspace();
  apply(w, [
    {
      kind: "create",
      item: "cycle-a",
      label: "A",
      revision: revision("cycle-a-r1", "cycle-a", "relation@1", {
        role: "documents",
        from: ref("cycle-b"),
        to: ref("force"),
      }),
    },
    {
      kind: "create",
      item: "cycle-b",
      label: "B",
      revision: revision("cycle-b-r1", "cycle-b", "relation@1", {
        role: "documents",
        from: ref("cycle-a"),
        to: ref("force"),
      }),
    },
  ]);
  assert.equal(
    f.captureContext(w.reader.read(), ref("cycle-a"), schemas).revisions.size,
    3,
  );
  const change = force(w, 200);
  assert.equal(
    change.changes.affected.filter((x) => x.startsWith("cycle-")).length,
    2,
  );
});
test("ordinary edit/view paths do not iterate global document maps", async () => {
  const loaded = await initial(),
    doc = loaded.document,
    blocked = new Set([
      doc.items,
      doc.revisions,
      doc.views,
      doc.alternatives,
      doc.known,
    ]),
    original = f.SharedMap.prototype.entries;
  f.SharedMap.prototype.entries = function* () {
    assert.equal(
      blocked.has(this),
      false,
      "Global-map scan on local operation",
    );
    yield* original.call(this);
  };
  try {
    f.prepare(
      doc,
      "bounded-local",
      [
        {
          kind: "revise",
          item: "force",
          revision: revision("bounded-force", "force", "scalar@1", {
            value: 200,
            unit: "N",
            ...meta,
          }),
        },
      ],
      schemas,
    );
    f.prepare(
      doc,
      "bounded-view",
      [{ kind: "view", view: { ...doc.views.get("draft-view"), x: 2, y: 3 } }],
      schemas,
    );
  } finally {
    f.SharedMap.prototype.entries = original;
  }
});
test("basic authoring needs neither a method registry nor an executor", async () => {
  const resources = await f.MemoryResources.verify([], hash),
    w = f.createWorkspace(
      { document: f.empty("notes-only"), receipts: [], resources },
      { schemas, namespace: "author" },
    );
  const made = w.owner.apply(w.reader.stamp(), "first-thought", [
    {
      kind: "create",
      item: "thought",
      label: "Unfinished",
      revision: revision("thought-r1", "thought", "note@1", {
        text: "What if…",
        mode: "draft",
      }),
    },
  ]);
  assert.equal(made.ok, true);
  assert.equal(
    f.project(
      w.reader.read(),
      f.reference("notes-only", "thought"),
      schemas,
      resources,
    ).projection.value,
    "What if…",
  );
  assert.equal(
    w.owner.compute(w.reader.stamp(), f.reference("notes-only", "thought")).ok,
    false,
  );
});

test("restoring an inactive identity selects retained content without allocating a revision", async () => {
  const w = await workspace(),
    before = w.reader.read(),
    original = current(before, "force");
  apply(w, [{ kind: "delete", item: "force" }]);
  const deleted = w.reader.read(),
    allocated = deleted.allocated.revisions;
  const restored = apply(w, [
    {
      kind: "restore",
      item: "force",
      revision: original.id,
      label: "Restored force",
    },
  ]);
  assert.equal(current(w.reader.read(), "force"), original);
  assert.equal(w.reader.read().revisions, deleted.revisions);
  assert.equal(w.reader.read().allocated.revisions, allocated);
  assert.ok(restored.changes.affected.includes("pressure"));
  assert.equal(
    f.project(w.reader.read(), ref("pressure"), schemas, w.reader.resources())
      .status,
    "resolved",
  );
  undo(w);
  assert.equal(current(w.reader.read(), "force"), undefined);
  apply(w, [
    { kind: "restore", item: "force", revision: original.id, label: "Force" },
  ]);
  for (const command of [
    { kind: "restore", item: "force", revision: original.id, label: "Active" },
    {
      kind: "restore",
      item: "never-seen",
      revision: original.id,
      label: "Unknown",
    },
  ]) {
    const stamp = w.reader.stamp();
    assert.equal(w.owner.apply(stamp, id("bad-restore"), [command]).ok, false);
    assert.deepEqual(w.reader.stamp(), stamp);
  }
  apply(w, [{ kind: "delete", item: "force" }]);
  for (const revision of ["missing-revision", current(before, "area").id]) {
    const stamp = w.reader.stamp();
    assert.equal(
      w.owner.apply(stamp, id("bad-restore"), [
        { kind: "restore", item: "force", revision, label: "Force" },
      ]).ok,
      false,
    );
    assert.deepEqual(w.reader.stamp(), stamp);
  }
  assert.equal(
    w.owner.apply(w.reader.stamp(), id("reuse-root"), [
      {
        kind: "create",
        item: "force",
        label: "Reused",
        revision: revision(id("reuse-revision"), "force", "note@1", {
          text: "Other",
        }),
      },
    ]).ok,
    false,
  );
});

test("a creation undone in this session can restore only its retained revision", async () => {
  const w = await workspace(),
    r = revision(id("new-note-revision"), "new-note", "note@1", {
      text: "Draft",
      mode: "draft",
    });
  apply(w, [{ kind: "create", item: r.item, label: "Draft", revision: r }]);
  undo(w);
  assert.equal(w.reader.read().items.get(r.item), undefined);
  assert.equal(w.reader.read().known.get(r.item), true);
  apply(w, [{ kind: "restore", item: r.item, revision: r.id, label: "Draft" }]);
  assert.equal(current(w.reader.read(), r.item).id, r.id);
});
