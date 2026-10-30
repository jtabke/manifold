import test from "node:test";
import assert from "node:assert/strict";
import { commitRecords } from "../src/record-backend.ts";
import { memoryBackend } from "../src/storage.ts";
import { StorageEpochChanged } from "../src/local-store.ts";
const head = {
  request: "save",
  root: "root",
  document: "doc",
  package: "chunk-0",
};
const chunks = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: "chunk-" + i,
    text: "data-🧮-" + i,
    links: [],
    assets: [],
  }));
function observedIo(fail) {
  const stores = { assets: new Map(), packages: new Map() };
  let active = 0,
    maxPending = 0,
    reads = 0,
    published = null;
  return {
    stores,
    diagnostics: () => ({ active, maxPending, reads, published }),
    io: {
      state: async () => ({ head: null, epoch: 0, revision: 0 }),
      async get(store, key) {
        reads++;
        maxPending = Math.max(maxPending, ++active);
        try {
          await new Promise(setImmediate);
          if (key === fail) throw Error("Injected read failure");
          return stores[store].get(key);
        } finally {
          active--;
        }
      },
      put(store, key, text) {
        assert.equal(published, null);
        stores[store].set(key, text);
      },
      publish(value) {
        assert.equal(active, 0, "no outstanding reads at publication");
        published = value;
      },
    },
  };
}
test("bulk commit bounds concurrent package/edge reads and completes validation before publication", async () => {
  const observed = observedIo(),
    staged = chunks(140);
  staged[0].links = Array.from({ length: 130 }, (_, i) => "old-" + i);
  staged[0].assets = Array.from({ length: 130 }, (_, i) => "asset-" + i);
  for (const key of staged[0].links)
    observed.stores.packages.set(key, "old bytes");
  for (const key of staged[0].assets)
    observed.stores.assets.set(key, "asset bytes");
  const result = await commitRecords(
    0,
    head,
    staged,
    [],
    "none",
    observed.io,
    0,
  );
  const d = observed.diagnostics();
  assert(d.maxPending > 1 && d.maxPending <= 64);
  assert.equal(d.active, 0);
  assert.equal(d.reads, 140 + 130 + 130);
  assert.equal(d.published, result.head);
  assert.equal(result.writes.chunks, 140);
  assert.equal(
    result.writes.chunkBytes,
    staged.reduce((n, c) => n + Buffer.byteLength(c.text), 0),
  );
  assert.equal(result.writes.assets, 0);
});
test("generation and epoch conflicts refuse before starting record reads", async () => {
  const observed = observedIo();
  await assert.rejects(
    commitRecords(1, head, chunks(140), [], "none", observed.io, 0),
    /Save conflict/,
  );
  await assert.rejects(
    commitRecords(0, head, chunks(140), [], "none", observed.io, 1),
    StorageEpochChanged,
  );
  assert.deepEqual(observed.diagnostics(), {
    active: 0,
    maxPending: 0,
    reads: 0,
    published: null,
  });
});
test("a rejected batch settles its reads and starts neither later batches nor publication", async () => {
  const observed = observedIo("chunk-0");
  await assert.rejects(
    commitRecords(0, head, chunks(140), [], "none", observed.io, 0),
    /Injected read failure/,
  );
  assert.equal(observed.diagnostics().reads, 64);
  assert.equal(observed.diagnostics().active, 0);
  assert.equal(observed.diagnostics().published, null);
  const completed = observed.diagnostics();
  await new Promise(setImmediate);
  assert.deepEqual(observed.diagnostics(), completed);
});
test("late-batch immutable conflicts roll back all staged records and allow a clean retry", async () => {
  const b = memoryBackend(),
    staged = chunks(140);
  await b.putPackage("chunk-70", "different");
  const before = b.diagnostics(),
    state = await b.state();
  await assert.rejects(
    b.commit(0, head, staged, [], "none", 0),
    /Immutable chunk conflict/,
  );
  assert.deepEqual(await b.state(), state);
  assert.deepEqual(b.diagnostics(), before);
  assert.equal(await b.package("chunk-0"), undefined);
  assert.equal(await b.head(), null);
  staged[70].text = "different";
  const result = await b.commit(0, head, staged, [], "none", 0);
  assert.equal(result.writes.chunks, 139);
  assert.equal(result.head.generation, 1);
});
for (const store of ["packages", "assets"])
  test(`late-batch missing ${store} references cannot publish or retain partial writes`, async () => {
    const b = memoryBackend(),
      staged = chunks(1);
    const keys = Array.from({ length: 140 }, (_, i) => "old-" + i);
    staged[0][store === "packages" ? "links" : "assets"] = keys;
    for (const key of keys)
      if (key !== "old-70")
        await b[store === "packages" ? "putPackage" : "putAsset"](key, "bytes");
    const before = b.diagnostics(),
      state = await b.state();
    await assert.rejects(
      b.commit(0, head, staged, [], "none", 0),
      /Missing staged/,
    );
    assert.deepEqual(await b.state(), state);
    assert.deepEqual(b.diagnostics(), before);
    assert.equal(await b.package("chunk-0"), undefined);
    assert.equal(await b.head(), null);
  });
test("asset staging remains ordered so duplicate keys cannot hide conflicts or inflate writes", async () => {
  const b = memoryBackend(),
    staged = chunks(1);
  staged[0].assets = ["asset"];
  const result = await b.commit(
    0,
    head,
    staged,
    [
      ["asset", "same"],
      ["asset", "same"],
    ],
    "none",
    0,
  );
  assert.equal(result.writes.assets, 1);
  const fresh = memoryBackend(),
    state = await fresh.state();
  await assert.rejects(
    fresh.commit(
      0,
      head,
      staged,
      [
        ["asset", "first"],
        ["asset", "second"],
      ],
      "none",
      0,
    ),
    /Immutable asset conflict/,
  );
  assert.deepEqual(await fresh.state(), state);
  assert.deepEqual(fresh.diagnostics(), { assets: 0, packages: 0 });
  assert.equal(await fresh.head(), null);
});
