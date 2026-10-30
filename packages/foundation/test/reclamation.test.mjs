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
  preview,
  keep,
  compute,
  apply,
  revision,
  ref,
  id,
  serialized,
} from "./helpers.mjs";
const ticket = (w, g) => ({
  request: id("save"),
  stamp: w.reader.stamp(),
  document: w.reader.read().document,
  expectedGeneration: g,
  capture: w.reader.capture(),
});
const io = (b) => f.incrementalStorage(b, schemas, methods, hash);
async function emptyHistory() {
  return workspace(undefined, await initial(), { historyLimit: 0 });
}
function compact(w) {
  const r = w.reader.reviewCompaction({ evidence: "reachable" });
  assert(w.owner.compact(w.reader.stamp(), id("compact"), r).ok);
}
async function source(w, value, rows = 1) {
  const text = JSON.stringify(Array.from({ length: rows }, () => [value])),
    asset = await f.asset(text, hash),
    resources = await w.reader.resources().add(asset, text, hash),
    rid = id("area");
  const commands = [
    {
      kind: "revise",
      item: "area",
      revision: revision(rid, "area", "source@1", {
        ...f.current(w.reader.read(), "area").body,
        asset,
        rows,
      }),
    },
  ];
  for (const item of ["pressure", "required-force"]) {
    const body = f.current(w.reader.read(), item).body;
    commands.push({
      kind: "revise",
      item,
      revision: revision(id(item), item, "request@1", {
        ...body,
        inputs: {
          ...body.inputs,
          area: {
            ...body.inputs.area,
            selector: { ...body.inputs.area.selector, revision: rid },
          },
        },
      }),
    });
  }
  apply(w, commands, resources);
  return asset;
}
async function orphan(b, text = "unreferenced staged record") {
  const key = await hash(text);
  await b.putPackage(key, text);
  return key;
}

test("physical reclamation removes obsolete generations and source bytes while preserving cited/kept/current meaning", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    store = io(b);
  await compute(w);
  const cited = [...w.reader.evidence().entries()][0][0];
  preview(w, 200);
  await compute(w, ref("pressure"), "preview");
  const alt = keep(w);
  await store.save(ticket(w, 0));
  const stale = await source(w, 5000, 2000);
  await compute(w);
  await store.save(ticket(w, 1));
  await source(w, 7500);
  await compute(w);
  const item = id("conclusion");
  apply(w, [
    {
      kind: "create",
      item,
      label: "Conclusion",
      revision: revision(id("conclusion-r"), item, "conclusion@1", {
        text: "Retain exact evidence",
        receipts: [cited],
      }),
    },
  ]);
  compact(w);
  await store.save(ticket(w, 2));
  const native = JSON.parse(serialized(w)),
    head = await b.head(),
    review = await store.reviewReclamation();
  assert.equal(review.before.assets, 3);
  assert.equal(review.after.assets, 2);
  assert(review.before.bytes > review.after.bytes);
  const result = await store.reclaim(review);
  assert(result.removedPackages > 0);
  assert.equal(result.removedAssets, 1);
  assert.equal(await b.asset(stale.digest), undefined);
  assert.deepEqual(await b.head(), head);
  const recipient = await workspace(undefined, (await store.reopen()).loaded);
  assert.deepEqual(JSON.parse(serialized(recipient)), native);
  assert.equal(
    recipient.reader.result(ref("pressure"), { alternative: alt.alternative })
      .receipt.outcome.output.value,
    0.08,
  );
  assert(recipient.reader.evidence().get(cited));
});

test("a read snapshot survives later publication and cleanup while crypto validation is held", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    writer = io(b);
  await writer.save(ticket(w, 0));
  const oldRoot = w.reader.read().id,
    oldDigest = f.current(w.reader.read(), "area").body.asset.digest;
  let started,
    release,
    hold = true;
  const gate = new Promise((r) => (release = r)),
    ready = new Promise((r) => (started = r)),
    reader = f.incrementalStorage(b, schemas, methods, async (text) => {
      if (hold) {
        hold = false;
        started();
        await gate;
      }
      return hash(text);
    });
  const pending = reader.reopen();
  await ready;
  await source(w, 5000);
  compact(w);
  await writer.save(ticket(w, 1));
  await writer.reclaim(await writer.reviewReclamation());
  assert.equal(await b.asset(oldDigest), undefined);
  release();
  const read = await pending;
  assert.equal(read.head.root, oldRoot);
  assert.equal(
    f.current(read.loaded.document, "area").body.asset.digest,
    oldDigest,
  );
  assert.equal(
    read.loaded.resources.read(
      f.current(read.loaded.document, "area").body.asset,
    ).status,
    "ready",
  );
});

test("cleanup between encoding and publication causes one bounded retry with complete chunk/source restaging", async () => {
  const old = await emptyHistory(),
    b = f.memoryBackend(),
    oldIO = io(b);
  await oldIO.save(ticket(old, 0));
  const current = await workspace(
    undefined,
    await f.decode(serialized(old), schemas, methods, hash),
    { historyLimit: 0 },
  );
  await source(current, 5000);
  compact(current);
  const newer = io(b);
  await newer.save(ticket(current, 1));
  await assert.rejects(oldIO.save(ticket(old, 1)), /Save conflict/);
  let calls = 0;
  const saved = await oldIO.save(ticket(old, 2), "none", async () => {
    calls++;
    await newer.reclaim(await newer.reviewReclamation());
  });
  assert.equal(saved.epochRetries, 1);
  assert.equal(calls, 1);
  assert.equal(saved.writes.assets, 1);
  assert(saved.writes.chunks > 1);
  const read = (await oldIO.reopen()).loaded;
  assert.deepEqual(
    JSON.parse(f.encode(read.document, read.receipts, read.resources, schemas)),
    JSON.parse(serialized(old)),
  );
});

test("a verified layout awaiting adoption cannot reintroduce stale reuse after an epoch change", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    writer = io(b);
  await writer.save(ticket(w, 0));
  const loader = io(b),
    pending = (await loader.reopen()).loaded;
  await source(w, 5000);
  compact(w);
  await writer.save(ticket(w, 1));
  await writer.reclaim(await writer.reviewReclamation());
  const recipient = await workspace(undefined, pending),
    saved = await loader.save(ticket(recipient, 2));
  assert(saved.plannedChunks > 1);
  assert.equal(saved.writes.assets, 1);
  assert.equal((await loader.reopen()).loaded.document.id, pending.document.id);
});

test("review staleness covers publication and legacy staging even when the head is unchanged", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    store = io(b);
  await store.save(ticket(w, 0));
  const review = await store.reviewReclamation();
  await orphan(b);
  await assert.rejects(store.reclaim(review), /stale/);
  const next = await store.reviewReclamation();
  force(w, 200);
  await store.save(ticket(w, 1));
  await assert.rejects(store.reclaim(next), /stale/);
});

test("forged, cross-instance and consumed cleanup reviews reject; aborted cleanup preserves records and clocks", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    store = io(b);
  await store.save(ticket(w, 0));
  const key = await orphan(b),
    review = await store.reviewReclamation(),
    state = await b.state();
  await assert.rejects(store.reclaim({ ...review }), /Unrecognized/);
  await assert.rejects(io(b).reclaim(review), /Unrecognized/);
  await assert.rejects(store.reclaim(review, true), /Aborted/);
  assert.deepEqual(await b.state(), state);
  assert(await b.package(key));
  await store.reclaim(review);
  await assert.rejects(store.reclaim(review), /Unrecognized/);
  assert.equal(await b.package(key), undefined);
});

test("two cleanup reviews serialize through epoch/revision guards and no-op cleanup does not churn epochs", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    a = io(b),
    c = io(b);
  await a.save(ticket(w, 0));
  await orphan(b);
  const [r1, r2] = await Promise.all([
    a.reviewReclamation(),
    c.reviewReclamation(),
  ]);
  const result = await Promise.allSettled([a.reclaim(r1), c.reclaim(r2)]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  const state = await b.state(),
    empty = await a.reclaim(await a.reviewReclamation());
  assert.equal(empty.reclaimedBytes, 0);
  assert.deepEqual(await b.state(), state);
});

test("unpublished orphan cleanup is bounded and never fabricates a durable head", async () => {
  const b = f.memoryBackend(),
    store = io(b);
  await orphan(b);
  const asset = await f.asset("bytes", hash);
  await b.putAsset(asset.digest, "bytes");
  await assert.rejects(
    store.reviewReclamation({ maxStoreBytes: 1 }),
    /inspection budget/,
  );
  await assert.rejects(
    store.reviewReclamation({ maxStoredRecords: 1 }),
    /record inspection budget/,
  );
  const r = await store.reviewReclamation();
  assert.equal(r.after.bytes, 0);
  await store.reclaim(r);
  assert.equal(await b.head(), null);
  assert.deepEqual(b.diagnostics(), { assets: 0, packages: 0 });
});

test("unreadable current roots refuse cleanup rather than erase prior generations", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    store = io(b);
  await store.save(ticket(w, 0));
  force(w, 200);
  await store.save(ticket(w, 1));
  const before = b.diagnostics(),
    a = f.current(w.reader.read(), "area").body.asset;
  b.corruptAsset(a.digest, "corrupt");
  await assert.rejects(store.reviewReclamation(), /digest mismatch/);
  assert.deepEqual(b.diagnostics(), before);
  assert.equal(w.reader.result(ref("pressure")).status, "ready");
});

test("legacy and opaque envelopes preserve their complete snapshot closure through reclamation", async () => {
  for (const opaque of [false, true]) {
    const w = await emptyHistory(),
      e = JSON.parse(serialized(w));
    if (opaque) {
      e.document.revisions["draft-r1"].schema = "future@9";
      e.document.revisions["draft-r1"].required = false;
    }
    const native = JSON.stringify(e),
      loaded = await f.decode(native, schemas, methods, hash),
      recipient = await workspace(undefined, loaded),
      b = f.memoryBackend();
    await f
      .storage(b, schemas, methods, hash)
      .save({ ...ticket(recipient, 0), native });
    await orphan(b);
    const store = io(b),
      r = await store.reviewReclamation();
    await store.reclaim(r);
    const after = (await store.reopen()).loaded;
    assert.equal(after.original, native);
    assert.equal(after.document.readOnly, opaque);
  }
});

test("repeated save/reclaim cycles preserve hot reuse after one epoch rebuild without changing saved acknowledgement", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    store = io(b);
  let generation = 0;
  for (let i = 0; i < 8; i++) {
    force(w, 100 + i);
    compact(w);
    const t = ticket(w, generation),
      saved = await store.save(t);
    generation = saved.head.generation;
    await store.reclaim(await store.reviewReclamation());
    assert(f.acknowledgementApplies(saved.head, t, w.reader.stamp()));
    const cold = await store.save(ticket(w, generation));
    generation = cold.head.generation;
    assert.equal(cold.writes.chunks, 0);
    const warm = await store.save(ticket(w, generation));
    generation = warm.head.generation;
    assert.equal(warm.plannedChunks, 1);
  }
});

test("repeated cleanup during publication exhausts the single retry without changing the durable root", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    writer = io(b);
  await writer.save(ticket(w, 0));
  const original = await b.head();
  force(w, 345);
  let commits = 0;
  const port = {
    ...b,
    async commit(...args) {
      commits++;
      if (commits <= 2) {
        await orphan(b, "churn-" + commits);
        await writer.reclaim(await writer.reviewReclamation());
      }
      return b.commit(...args);
    },
  };
  const store = io(port);
  await assert.rejects(store.save(ticket(w, 1)), /Storage cleanup changed/);
  assert.equal(commits, 2);
  assert.deepEqual(await b.head(), original);
  assert.equal(f.current(w.reader.read(), "force").body.value, 345);
  assert.equal((await store.save(ticket(w, 1))).head.generation, 2);
});

test("legacy staged publication fails safely if reclamation removes its unpublished manifest", async () => {
  const w = await emptyHistory(),
    b = f.memoryBackend(),
    store = io(b);
  await store.save(ticket(w, 0));
  const head = await b.head();
  force(w, 200);
  const t = { ...ticket(w, 1), native: serialized(w) };
  await assert.rejects(
    f.storage(b, schemas, methods, hash).save(t, "none", async () => {
      await store.reclaim(await store.reviewReclamation());
    }),
    /Missing staged records/,
  );
  assert.deepEqual(await b.head(), head);
  await f.storage(b, schemas, methods, hash).save(t);
  assert.equal(
    f.current((await store.reopen()).loaded.document, "force").body.value,
    200,
  );
});

test("retained Undo restores old source selections after physical cleanup and can save them again", async () => {
  const w = await workspace(),
    b = f.memoryBackend(),
    store = io(b);
  await source(w, 5000);
  force(w, 300);
  await store.save(ticket(w, 0));
  await source(w, 7500);
  force(w, 500);
  compact(w);
  await store.save(ticket(w, 1));
  await store.reclaim(await store.reviewReclamation());
  assert(w.owner.undo(w.reader.stamp(), id("undo")).ok);
  assert(w.owner.undo(w.reader.stamp(), id("undo")).ok);
  assert.equal(f.current(w.reader.read(), "force").body.value, 300);
  assert.equal(
    w.reader.read().items.get("area").revision,
    f.current(w.reader.read(), "pressure").body.inputs.area.selector.revision,
  );
  await compute(w);
  assert.equal(
    w.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.06,
  );
  await store.save(ticket(w, 2));
  const loaded = await workspace(undefined, (await store.reopen()).loaded);
  assert.equal(
    loaded.reader.result(ref("pressure")).receipt.outcome.output.value,
    0.06,
  );
});
