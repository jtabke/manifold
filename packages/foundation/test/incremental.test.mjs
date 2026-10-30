import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as f from "../src/index.ts";
import {
  workspace,
  initial,
  schemas,
  methods,
  hash,
  apply,
  force,
  preview,
  keep,
  compute,
  ref,
  revision,
  id,
  serialized,
  controlled,
} from "./helpers.mjs";
const ticket = (w, g = 0) => ({
  request: id("save"),
  stamp: w.reader.stamp(),
  document: w.reader.read().document,
  expectedGeneration: g,
  capture: w.reader.capture(),
});
const store = (b = f.memoryBackend()) => ({
  b,
  io: f.incrementalStorage(b, schemas, methods, hash),
});
const portable = async (loaded) =>
  JSON.parse(
    f.encode(
      loaded.document,
      loaded.receipts,
      loaded.resources,
      schemas,
      loaded.original,
    ),
  );
const sameMeaning = async (w, loaded) =>
  assert.deepEqual(await portable(loaded), JSON.parse(serialized(w)));

test("incremental local handoff retains alternative/source/citation closure and starts no execution", async () => {
  const w = await workspace();
  await compute(w);
  preview(w, 200);
  await compute(w, ref("pressure"), "preview");
  const kept = keep(w);
  force(w, 300);
  await compute(w);
  const receipt = [...w.reader.evidence().entries()][0][0];
  const item = id("conclusion");
  apply(w, [
    {
      kind: "create",
      item,
      label: "Conclusion",
      revision: revision(id("c-r"), item, "conclusion@1", {
        text: "Keep exact attempt",
        receipts: [receipt],
      }),
    },
  ]);
  const { io } = store();
  const saved = await io.save(ticket(w));
  assert.equal(saved.mode, "incremental");
  assert.equal(saved.writes.assets, 1);
  const reopened = await io.reopen();
  await sameMeaning(w, reopened.loaded);
  let calls = 0;
  const recipient = await workspace(async () => {
    calls++;
    throw Error("must not execute");
  }, reopened.loaded);
  assert.equal(calls, 0);
  assert.equal(recipient.reader.read().alternatives.size, 1);
  assert.equal(
    recipient.reader.result(ref("pressure"), { alternative: kept.alternative })
      .receipt.outcome.output.value,
    0.08,
  );
});

test("acknowledged shared branches skip unchanged map scans and source reads", async () => {
  const loaded = await initial();
  let reads = 0;
  const resources = {
    read(a) {
      reads++;
      return loaded.resources.read(a);
    },
  };
  const w = await workspace(undefined, { ...loaded, resources });
  const { io } = store();
  await io.save(ticket(w));
  const afterFirst = reads;
  const maps = [
    w.reader.read().revisions,
    w.reader.read().known,
    w.reader.read().allocated.revisions,
  ];
  const original = f.SharedMap.prototype.entries;
  f.SharedMap.prototype.entries = function* () {
    assert(!maps.includes(this), "unchanged map scanned");
    yield* original.call(this);
  };
  try {
    apply(w, [
      {
        kind: "view",
        view: { ...w.reader.read().views.get("draft-view"), x: 110 },
      },
    ]);
    const saved = await io.save(ticket(w, 1));
    assert(saved.plannedChunks < 15);
    assert.equal(saved.writes.assets, 0);
    assert.equal(reads, afterFirst);
  } finally {
    f.SharedMap.prototype.entries = original;
  }
  const again = await io.save(ticket(w, 2));
  assert.equal(again.plannedChunks, 1);
  assert.equal(again.writes.chunks, 0);
  assert.equal(again.writes.assets, 0);
});

test("faults roll back the complete transaction, preserve the durable root, and do not poison reuse", async () => {
  const w = await workspace();
  const { b, io } = store();
  await io.save(ticket(w));
  const head = await b.head(),
    before = b.diagnostics();
  force(w, 200);
  for (const fault of ["after-assets", "after-package", "before-publish"]) {
    await assert.rejects(io.save(ticket(w, 1), fault), /Interrupted|Aborted/);
    assert.deepEqual(await b.head(), head);
    assert.deepEqual(b.diagnostics(), before);
    assert.equal(
      (await io.reopen()).loaded.document.items.get("force").revision,
      "force-r1",
    );
  }
  const saved = await io.save(ticket(w, 1));
  assert(saved.writes.chunks > 0);
  await sameMeaning(w, (await io.reopen()).loaded);
});

test("two independent storage instances produce exactly one CAS winner", async () => {
  const w = await workspace();
  const { b, io } = store();
  await io.save(ticket(w));
  force(w, 200);
  const a = ticket(w, 1),
    other = f.incrementalStorage(b, schemas, methods, hash);
  const results = await Promise.allSettled([
    io.save(a),
    other.save({ ...a, request: "other" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await b.head()).generation, 2);
  await sameMeaning(w, (await io.reopen()).loaded);
});

test("captured Save remains coherent across later edits and receipt arrival", async () => {
  const run = controlled(),
    w = await workspace(run.execute);
  const { io } = store();
  await io.save(ticket(w));
  const pending = w.owner.compute(w.reader.stamp(), ref("pressure"));
  assert(pending.ok);
  await Promise.resolve();
  const t = ticket(w, 1);
  let release, held;
  const staged = new Promise((r) => (held = r));
  const saving = io.save(t, "none", async () => {
    held();
    await new Promise((r) => (release = r));
  });
  await staged;
  run.calls[0].resolve({
    value: 0.04,
    unit: "MPa",
    subject: "specimen-A",
    frame: "axial",
    condition: "load-case-A",
  });
  await pending.value.completion;
  force(w, 300);
  release();
  const saved = await saving;
  assert.equal(
    f.acknowledgementApplies(saved.head, t, w.reader.stamp()),
    false,
  );
  const loaded = (await io.reopen()).loaded;
  assert.equal(loaded.document.evidenceSequence, t.stamp.evidence);
  assert.equal(loaded.receipts.length, 0);
  assert.equal(f.current(loaded.document, "force").body.value, 100);
});

test("a v1 or v2 legacy durable envelope upgrades on next incremental Save without replacing native semantics", async () => {
  for (const filename of [
    "portable.fixture.json",
    "portable-v2.fixture.json",
  ]) {
    const text = await readFile(new URL(filename, import.meta.url), "utf8"),
      loaded = await f.decode(text, schemas, methods, hash),
      w = await workspace(undefined, loaded);
    const { b, io } = store();
    await f
      .storage(b, schemas, methods, hash)
      .save({ ...ticket(w), native: serialized(w) });
    await sameMeaning(w, (await io.reopen()).loaded);
    force(w, 220);
    await io.save(ticket(w, 1));
    await sameMeaning(w, (await io.reopen()).loaded);
  }
});

test("missing or corrupt local chunks and assets reject before adoption; chunk/byte budgets are bounded", async () => {
  const w = await workspace();
  const { b, io } = store();
  await io.save(ticket(w));
  const head = await b.head(),
    raw = JSON.parse(await b.package(head.package)),
    child = raw.data.roots.items;
  for (const corruption of ["missing", "corrupt"]) {
    const backend = {
      ...b,
      snapshot: async (...args) => {
        const captured = await b.snapshot(...args);
        return {
          ...captured,
          package: async (key) =>
            key === child
              ? corruption === "missing"
                ? undefined
                : "corrupt"
              : captured.package(key),
        };
      },
    };
    await assert.rejects(
      f.incrementalStorage(backend, schemas, methods, hash).reopen(),
      /Missing local chunk|Corrupt local chunk/,
    );
  }
  await assert.rejects(io.reopen({ maxChunks: 1 }), /chunk budget/);
  await assert.rejects(io.reopen({ maxBytes: 32 }), /byte budget/);
  const digest = [...w.reader.resources().entries()][0][0];
  b.loseAsset(digest);
  await assert.rejects(io.reopen(), /Missing saved asset/);
  assert.equal(w.reader.read().id, head.root);
});

test("a transaction cannot publish a root with missing newly referenced chunks or assets", async () => {
  const b = f.memoryBackend(),
    head = { request: "bad", root: "root", document: "doc", package: "parent" };
  await assert.rejects(
    b.commit(
      0,
      head,
      [{ id: "parent", text: "parent", links: ["missing"], assets: [] }],
      [],
      "none",
    ),
    /Missing staged chunk/,
  );
  assert.equal(await b.head(), null);
  assert.deepEqual(b.diagnostics(), { assets: 0, packages: 0 });
  await assert.rejects(
    b.commit(
      0,
      head,
      [{ id: "parent", text: "parent", links: [], assets: ["missing"] }],
      [],
      "none",
    ),
    /Missing staged asset/,
  );
  assert.equal(await b.head(), null);
});

test("incremental Save after retention preserves retired identities and the evidence high-water clock", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 });
  await compute(w);
  await compute(w);
  const ids = [...w.reader.evidence().entries()].map(([id]) => id);
  const { io } = store();
  await io.save(ticket(w));
  const review = w.reader.reviewCompaction({ evidence: "reachable" });
  assert(w.owner.compact(w.reader.stamp(), id("compact"), review).ok);
  const clock = w.reader.stamp().evidence;
  await io.save(ticket(w, 1));
  const loaded = (await io.reopen()).loaded;
  assert.equal(loaded.document.evidenceSequence, clock);
  assert.equal(loaded.receipts.length, 1);
  for (const id of ids) assert(loaded.document.allocated.receipts.get(id));
});

test("forged captures and mismatched binding/root/evidence reject before storage mutation", async () => {
  const w = await workspace(),
    { b, io } = store(),
    t = ticket(w);
  await assert.rejects(
    io.save({ ...t, capture: { ...t.capture } }),
    /owner capture/,
  );
  for (const field of ["binding", "root", "evidence"])
    await assert.rejects(
      io.save({
        ...t,
        stamp: { ...t.stamp, [field]: field === "root" ? "wrong" : 999 },
      }),
      /Save .*mismatch/,
    );
  assert.equal(await b.head(), null);
  assert.deepEqual(b.diagnostics(), { assets: 0, packages: 0 });
});

test("opaque optional content uses exact original preservation and refuses invented interpretation", async () => {
  const w = await workspace(),
    e = JSON.parse(serialized(w));
  e.document.revisions["draft-r1"].schema = "future@9";
  e.document.revisions["draft-r1"].required = false;
  const native = JSON.stringify(e),
    loaded = await f.decode(native, schemas, methods, hash),
    ro = await workspace(undefined, loaded),
    { io } = store();
  const result = await io.save(ticket(ro));
  assert.equal(result.mode, "opaque");
  assert.equal((await io.reopen()).loaded.original, native);
});

test("new source bytes and their referencing revision roll back together on interrupted Save", async () => {
  const w = await workspace(),
    { b, io } = store();
  await io.save(ticket(w));
  const prior = b.diagnostics(),
    head = await b.head();
  const data = "[[5000]]",
    asset = await f.asset(data, hash),
    resources = await w.reader.resources().add(asset, data, hash);
  apply(
    w,
    [
      {
        kind: "revise",
        item: "area",
        revision: revision(id("new-area"), "area", "source@1", {
          ...f.current(w.reader.read(), "area").body,
          asset,
        }),
      },
    ],
    resources,
  );
  for (const fault of ["after-assets", "after-package", "before-publish"]) {
    await assert.rejects(io.save(ticket(w, 1), fault), /Interrupted|Aborted/);
    assert.deepEqual(b.diagnostics(), prior);
    assert.deepEqual(await b.head(), head);
  }
  const saved = await io.save(ticket(w, 1));
  assert.equal(saved.writes.assets, 1);
  assert.equal(saved.writes.assetBytes, 8);
  await sameMeaning(w, (await io.reopen()).loaded);
});

test("acknowledged asset reuse still rejects conflicting size declarations", async () => {
  const w = await workspace(),
    { io } = store();
  await io.save(ticket(w));
  const body = f.current(w.reader.read(), "area").body;
  apply(w, [
    {
      kind: "revise",
      item: "area",
      revision: revision(id("bad-size"), "area", "source@1", {
        ...body,
        asset: { ...body.asset, size: 99 },
      }),
    },
  ]);
  await assert.rejects(io.save(ticket(w, 1)), /Conflicting source size/);
});

test("map scheduling defers only dependency-ready records, preserving immediate encoding and pack validation", async () => {
  const queued = [],
    writer = f.recordWriter(
      new Map(),
      hash,
      (work) =>
        new Promise((resolve, reject) =>
          queued.push(() => work().then(resolve, reject)),
        ),
    );
  let encodes = 0;
  const pending = writer.map(
    "scheduled",
    f.SharedMap.from([["a", Object.freeze({ text: "source" })]]),
    (value) => {
      encodes++;
      return writer.pack({ kind: "value", value });
    },
  );
  assert.equal(encodes, 1);
  await new Promise(setImmediate);
  assert.equal(queued.length, 1);
  assert.equal(
    writer.chunks.size,
    1,
    "the value is encoded before scheduling its map node",
  );
  const leaf = [...writer.chunks.keys()][0];
  assert.throws(
    () =>
      writer.pack({
        kind: "map",
        key: "bad",
        value: leaf,
        left: null,
        right: null,
      }),
    /Declared record links/,
  );
  assert.equal(queued.length, 1, "direct pack validation remains immediate");
  await queued.shift()();
  const root = await pending;
  assert.deepEqual(writer.chunks.get(root).links, [leaf]);
});

test("generic bundles reuse the same physical graph, verify explicit edges and preserve atomic map closure", async () => {
  const backend = f.memoryBackend(),
    memos = new Map(),
    writer = f.recordWriter(memos, hash);
  const values = f.SharedMap.from([
    ["a", Object.freeze({ text: "first" })],
    ["b", Object.freeze({ text: "second" })],
  ]);
  const root = await writer.map("example", values, (value) =>
    writer.pack({ kind: "value", value }),
  );
  const bundle = await writer.pack(
    {
      kind: "bundle",
      schema: "example-local",
      version: 1,
      metadata: { purpose: "test" },
      roots: { records: root },
    },
    [root],
  );
  await backend.commit(
    0,
    {
      request: "generic-save",
      document: "example",
      root: "root-1",
      package: bundle,
    },
    [...writer.chunks.values()],
    [],
    "none",
    0,
  );
  writer.acknowledge();
  const snapshot = await backend.snapshot(),
    reader = f.recordReader(snapshot, hash),
    top = await reader.node(bundle);
  assert.equal(top.schema, "example-local");
  assert.deepEqual(
    { ...(await reader.map(top.roots.records, reader.value)) },
    { a: { text: "first" }, b: { text: "second" } },
  );
  await assert.rejects(
    f.recordReader(snapshot, hash, { maxBytes: 1 }).node(bundle),
    /budget/,
  );
  assert.throws(
    () =>
      f.recordWriter(new Map(), hash).pack({
        kind: "bundle",
        schema: "example-local",
        version: 1,
        metadata: {},
        roots: { records: root },
      }),
    /Declared record links/,
  );
  await assert.rejects(
    f.incrementalStorage(backend, schemas, methods, hash).reopen(),
    /workspace/,
  );
  const review = await backend.inspect();
  assert.equal(review.after.packages, review.before.packages);
});
