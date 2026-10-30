import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import {
  workspace,
  initial,
  schemas,
  methods,
  hash,
  force,
  compute,
  preview,
  keep,
  apply,
  revision,
  ref,
  id,
  serialized,
  controlled,
} from "./helpers.mjs";
const ticket = (w, g) => ({
  request: id("save"),
  stamp: w.reader.stamp(),
  document: w.reader.read().document,
  expectedGeneration: g,
  capture: w.reader.capture(),
});
const local = (b) => f.incrementalStorage(b, schemas, methods, hash);
function layout(map) {
  return map.fold(
    (key, _value, left, right) => ({ key, left, right }),
    new WeakMap(),
  );
}

test("map reshape preserves exact values across independently evolved AVL shapes", () => {
  let seed = 123;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  for (let run = 0; run < 60; run++) {
    const keys = Array.from({ length: 1 + (rand() % 70) }, (_, i) =>
      String(i).padStart(3, "0"),
    );
    const source = f.SharedMap.from(
      keys.map((key) => [key, Object.freeze({ key, run })]),
    );
    let other = f.SharedMap.empty();
    const order = [...keys];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rand() % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const key of order) other = other.set(key, true);
    const shape = layout(other),
      memo = new WeakMap();
    const restored = source.reshape(
      shape,
      (token) => token,
      (token, node) => memo.set(node, token),
    );
    restored.validate();
    assert.deepEqual([...restored.entries()], [...source.entries()]);
    for (const key of keys) assert.equal(restored.get(key), source.get(key));
    let visits = 0;
    assert.equal(
      restored.fold(() => {
        visits++;
        throw Error("cached branch visited");
      }, memo),
      shape,
    );
    assert.equal(visits, 0);
  }
  const undefinedValue = f.SharedMap.from([["x", undefined]]).reshape(
    { key: "x", left: null, right: null },
    (x) => x,
  );
  assert.equal(undefinedValue.size, 1);
  assert.equal([...undefinedValue.entries()][0][1], undefined);
});

test("map reshape rejects altered, missing, repeated, unordered, cyclic and unbalanced keys before caching", () => {
  const m = f.SharedMap.from([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]),
    leaf = (key) => ({ key, left: null, right: null });
  let remembered = 0;
  const invalid = [
    null,
    leaf("b"),
    { key: "b", left: leaf("x"), right: leaf("c") },
    { key: "b", left: leaf("b"), right: leaf("c") },
    { key: "a", left: leaf("b"), right: leaf("c") },
    { key: "a", left: null, right: { key: "b", left: null, right: leaf("c") } },
  ];
  const cycle = leaf("b");
  cycle.left = cycle;
  invalid.push(cycle);
  for (const shape of invalid)
    assert.throws(
      () =>
        m.reshape(
          shape,
          (x) => x,
          () => remembered++,
        ),
      /layout|order|keys/,
    );
  assert.equal(remembered, 0);
  assert.equal(f.SharedMap.empty().reshape(null, (x) => x).size, 0);
  assert.throws(() => f.SharedMap.empty().reshape(leaf("a"), (x) => x));
});

test("fresh local loader preserves first-save reuse through createWorkspace, alternatives, sources and evidence", async () => {
  const w = await workspace();
  for (let i = 0; i < 40; i++) {
    force(w, 100 + i);
    if (i % 5 === 0) {
      preview(w, 200 + i);
      await compute(w, ref("pressure"), "preview");
      keep(w);
    }
  }
  await compute(w);
  const b = f.memoryBackend();
  await local(b).save(ticket(w, 0));
  let hashCalls = 0,
    hashBytes = 0;
  const io = f.incrementalStorage(b, schemas, methods, async (text) => {
    hashCalls++;
    hashBytes += f.byteLength(text);
    return hash(text);
  });
  const loaded = (await io.reopen()).loaded,
    recipient = await workspace(undefined, loaded);
  hashCalls = 0;
  hashBytes = 0;
  const same = await io.save(ticket(recipient, 1));
  assert.equal(same.plannedChunks, 1);
  assert.equal(same.writes.chunks, 0);
  assert.equal(same.writes.assets, 0);
  assert.equal(hashCalls, 1);
  assert(hashBytes < 2000);
  assert.deepEqual(
    JSON.parse(serialized(recipient)),
    JSON.parse(serialized(w)),
  );
  apply(recipient, [
    {
      kind: "view",
      view: { ...recipient.reader.read().views.get("draft-view"), x: 999 },
    },
  ]);
  const moved = await io.save(ticket(recipient, 2));
  const bound =
    Math.ceil(2 * Math.log2(recipient.reader.read().views.size + 1)) + 2;
  assert(moved.plannedChunks <= bound);
  assert(moved.writes.chunks <= bound);
  assert.equal(moved.writes.assets, 0);
  for (const [, alt] of recipient.reader.read().alternatives.entries())
    alt.context.revisions.validate();
});

test("owner Open preserves validated layout, input-specific evidence and retired IDs without carrying session Undo", async () => {
  const w = await workspace(undefined, await initial(), { historyLimit: 0 });
  await compute(w);
  await compute(w);
  const old = [...w.reader.evidence().entries()][0][0];
  const review = w.reader.reviewCompaction({ evidence: "reachable" });
  assert(w.owner.compact(w.reader.stamp(), id("compact"), review).ok);
  const b = f.memoryBackend();
  await local(b).save(ticket(w, 0));
  const io = local(b),
    saved = await io.reopen(),
    recipient = await workspace();
  force(recipient, 999);
  assert(recipient.owner.open(recipient.reader.stamp(), saved.loaded).ok);
  assert.equal(recipient.diagnostics().undoSteps, 0);
  assert(recipient.reader.read().allocated.receipts.get(old));
  assert.equal(recipient.reader.result(ref("pressure")).status, "current");
  const result = await io.save(ticket(recipient, 1));
  assert.equal(result.plannedChunks, 1);
  assert.equal(result.writes.chunks, 0);
  force(recipient, 200);
  const changed = await io.save(ticket(recipient, 2));
  assert(changed.plannedChunks < 30);
  assert.equal(changed.writes.assets, 0);
});

test("layout hints cannot bypass validation or leak through copied Loaded values", async () => {
  const w = await workspace();
  await compute(w);
  const b = f.memoryBackend();
  await local(b).save(ticket(w, 0));
  const io = local(b),
    saved = await io.reopen();
  const run = controlled(),
    recipient = await workspace(run.execute);
  const pending = recipient.owner.compute(
    recipient.reader.stamp(),
    ref("pressure"),
  );
  assert(pending.ok);
  await Promise.resolve();
  const before = recipient.reader.stamp();
  const corrupt = {
    ...saved.loaded,
    receipts: saved.loaded.receipts.map((r) => ({
      ...r,
      outcome: { status: "success", output: { value: 999, unit: "wrong" } },
    })),
  };
  assert.equal(recipient.owner.open(before, corrupt).ok, false);
  assert.deepEqual(recipient.reader.stamp(), before);
  assert.equal(run.calls[0].signal.aborted, false);
  const copied = await workspace(undefined, { ...saved.loaded });
  const full = await io.save(ticket(copied, 1));
  assert(full.plannedChunks > 1);
  assert.equal(full.writes.assets, 0);
});

test("recovered memoization stays local to the loading destination and failed saves establish no new reuse", async () => {
  const w = await workspace();
  const b = f.memoryBackend();
  await local(b).save(ticket(w, 0));
  const io = local(b),
    saved = await io.reopen(),
    recipient = await workspace(undefined, saved.loaded);
  const other = f.memoryBackend(),
    first = await local(other).save(ticket(recipient, 0));
  assert(first.writes.chunks > 40);
  assert.equal(first.writes.assets, 1);
  force(recipient, 275);
  await assert.rejects(
    io.save(ticket(recipient, 1), "after-package"),
    /Interrupted/,
  );
  const retry = await io.save(ticket(recipient, 1));
  assert(retry.writes.chunks > 0);
  assert.equal(retry.writes.assets, 0);
  const restored = await workspace(undefined, (await io.reopen()).loaded);
  assert.equal(f.current(restored.reader.read(), "force").body.value, 275);
});

test("local graphs reopened without a formerly supported optional handler remain opaque and preserve native meaning", async () => {
  const optional = {
    id: "optional@1",
    validate(body) {
      assert.equal(typeof body.text, "string");
    },
    references() {
      return [];
    },
    assets() {
      return [];
    },
    project() {
      return { status: "text", text: "future" };
    },
  };
  const extended = f.createSchemas([optional]),
    seed = await initial(),
    w = f.createWorkspace(seed, {
      schemas: extended,
      methods,
      namespace: "extension",
    });
  const item = id("optional");
  const result = w.owner.apply(w.reader.stamp(), id("root"), [
    {
      kind: "create",
      item,
      label: "Future optional",
      revision: {
        id: id("optional-r"),
        item,
        schema: "optional@1",
        required: false,
        body: { text: "retain" },
      },
    },
  ]);
  assert(result.ok);
  const b = f.memoryBackend();
  await f.incrementalStorage(b, extended, methods, hash).save(ticket(w, 0));
  const io = local(b),
    saved = await io.reopen();
  assert(saved.loaded.document.readOnly);
  const ro = await workspace(undefined, saved.loaded);
  assert.equal(
    f.encode(
      ro.reader.read(),
      [],
      ro.reader.resources(),
      schemas,
      ro.reader.original(),
    ),
    saved.loaded.original,
  );
  const again = await io.save(ticket(ro, 1));
  assert.equal(again.mode, "opaque");
});

test("hash-valid local graphs reject unbalanced maps and receipt map identity mismatches before adoption", async () => {
  for (const corrupt of ["unbalanced-items", "receipt-key"]) {
    const w = await workspace();
    await compute(w);
    const b = f.memoryBackend();
    const saved = await local(b).save(ticket(w, 0));
    const original = await b.package(saved.head.package),
      root = JSON.parse(original);
    async function put(data) {
      const text = f.canonical({
          format: "manifold-local-chunk",
          version: 1,
          data,
          assets: [],
        }),
        key = await hash(text);
      await b.putPackage(key, text);
      return key;
    }
    if (corrupt === "receipt-key") {
      const n = JSON.parse(await b.package(root.data.roots.receipts)).data;
      root.data.roots.receipts = await put({ ...n, key: "wrong-receipt-key" });
    } else {
      const entries = [],
        queue = [root.data.roots.items];
      while (queue.length) {
        const n = JSON.parse(await b.package(queue.pop())).data;
        entries.push([n.key, n.value]);
        if (n.left) queue.push(n.left);
        if (n.right) queue.push(n.right);
      }
      let right = null;
      for (const [key, value] of entries.sort(([a], [b]) => (a < b ? 1 : -1)))
        right = await put({ kind: "map", key, value, left: null, right });
      root.data.roots.items = right;
    }
    const text = f.canonical(root),
      key = await hash(text);
    await b.putPackage(key, text);
    await b.publish(
      1,
      { ...saved.head, package: key, request: "corrupt" },
      [],
      false,
    );
    const before = w.reader.stamp();
    await assert.rejects(
      local(b).reopen(),
      /Unbalanced local map|Invalid local receipt/,
    );
    assert.deepEqual(w.reader.stamp(), before);
  }
});

test("Open can install an availability port without copying the verified Loaded value or losing reuse", async () => {
  const w = await workspace();
  await compute(w);
  const b = f.memoryBackend();
  await local(b).save(ticket(w, 0));
  const io = local(b),
    saved = await io.reopen(),
    recipient = await workspace();
  const unavailable = {
    read() {
      return { status: "unavailable", reason: "offline" };
    },
  };
  assert(
    recipient.owner.open(recipient.reader.stamp(), saved.loaded, unavailable)
      .ok,
  );
  assert.equal(recipient.reader.resources(), unavailable);
  assert.equal(recipient.reader.result(ref("pressure")).status, "blocked");
  const result = await io.save(ticket(recipient, 1));
  assert.equal(result.plannedChunks, 1);
  assert.equal(result.writes.chunks, 0);
  assert.equal(result.writes.assets, 0);
});

test("setting any existing map key to its identical value retains the entire root and allocates no paths", () => {
  const values = Array.from({ length: 127 }, (_, i) => [
      String(i).padStart(3, "0"),
      Object.freeze({ i }),
    ]),
    map = f.SharedMap.from(values);
  for (const [key, value] of values) {
    const work = f.mapWork();
    assert.equal(map.set(key, value, work), map);
    assert.equal(work.nodesAllocated, 0);
    assert.equal(work.entriesWritten, 0);
    assert(work.nodesRead <= 7);
  }
  const changed = map.set("002", { i: -1 });
  assert.notEqual(changed, map);
  assert.equal(map.get("002").i, 2);
  assert.equal(changed.get("002").i, -1);
  changed.validate();
});
