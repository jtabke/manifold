/** 10,000-receipt rows explicitly configure count admission; the ordinary default remains 4,096. */
import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import {
  workspace,
  initial,
  schemas,
  methods,
  hash,
  compute,
  preview,
  keep,
  apply,
  revision,
  id,
  ref,
  serialized,
} from "./helpers.mjs";
const stats = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return {
    min: a[0],
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    max: a.at(-1),
  };
};
const ticket = (w, g) => ({
  request: id("save"),
  stamp: w.reader.stamp(),
  document: w.reader.read().document,
  expectedGeneration: g,
  capture: w.reader.capture(),
});
function compact(w) {
  const review = w.reader.reviewCompaction({ evidence: "reachable" }),
    resources = w.reader.resources().retain(review.assets);
  assert(
    w.owner.compact(w.reader.stamp(), id("compact"), review, resources).ok,
  );
}
async function reclaimAndCheck(w, b, store, generation) {
  const native = JSON.parse(serialized(w)),
    head = await b.head(),
    times = [];
  let review;
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    review = await store.reviewReclamation();
    if (i >= 5) times.push(performance.now() - start);
  }
  const start = performance.now(),
    result = await store.reclaim(review),
    applyMs = performance.now() - start;
  assert.deepEqual(await b.head(), head);
  assert(result.reclaimedBytes > 0);
  const loaded = (await store.reopen()).loaded;
  assert.deepEqual(
    JSON.parse(
      f.encode(loaded.document, loaded.receipts, loaded.resources, schemas),
    ),
    native,
  );
  const begin = performance.now(),
    cold = await store.save(ticket(w, generation)),
    firstSaveAfterEpochMs = performance.now() - begin;
  assert.equal(cold.writes.chunks, 0);
  assert.equal(cold.writes.assets, 0);
  const warm = await store.save(ticket(w, generation + 1));
  assert.equal(warm.plannedChunks, 1);
  return {
    before: review.before,
    after: review.after,
    review30Ms: stats(times),
    applyMs,
    result,
    firstSaveAfterEpoch: {
      ms: firstSaveAfterEpochMs,
      plannedChunks: cold.plannedChunks,
      writes: cold.writes,
    },
    nextSavePlannedChunks: warm.plannedChunks,
    receiptIdentityMarkers: w.reader.read().allocated.receipts.size,
  };
}
const repeatedAttempts = [];
for (const attempts of [100, 1000, 10000]) {
  const w = await workspace(undefined, await initial(), {
      historyLimit: 0,
      maxReceipts: attempts,
    }),
    b = f.memoryBackend(),
    store = f.incrementalStorage(b, schemas, methods, hash);
  for (let i = 0; i < attempts; i++) await compute(w);
  await store.save(ticket(w, 0));
  compact(w);
  await store.save(ticket(w, 1));
  const data = await reclaimAndCheck(w, b, store, 2);
  repeatedAttempts.push({ attempts, ...data });
}
const w = await workspace(undefined, await initial(), { historyLimit: 0 }),
  b = f.memoryBackend(),
  store = f.incrementalStorage(b, schemas, methods, hash);
preview(w, 200);
await compute(w, ref("pressure"), "preview");
keep(w);
await store.save(ticket(w, 0));
let generation = 1,
  cited;
for (let version = 0; version < 30; version++) {
  const text = JSON.stringify(
      Array.from({ length: 2000 }, (_, row) => [5000 + version + row]),
    ),
    asset = await f.asset(text, hash),
    resources = await w.reader.resources().add(asset, text, hash),
    rid = id("area"),
    commands = [
      {
        kind: "revise",
        item: "area",
        revision: revision(rid, "area", "source@1", {
          ...f.current(w.reader.read(), "area").body,
          asset,
          rows: 2000,
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
  await compute(w);
  if (version === 3)
    cited = [...w.reader.evidence().entries()]
      .map(([, r]) => r)
      .sort((a, b) => b.order - a.order)[0].id;
  await store.save(ticket(w, generation++));
}
const conclusion = id("conclusion");
apply(w, [
  {
    kind: "create",
    item: conclusion,
    label: "Recorded result",
    revision: revision(id("conclusion-r"), conclusion, "conclusion@1", {
      text: "Keep evidence",
      receipts: [cited],
    }),
  },
]);
compact(w);
await store.save(ticket(w, generation++));
const sources = {
  versions: 30,
  rowsPerSource: 2000,
  ...(await reclaimAndCheck(w, b, store, generation)),
};
assert.equal(sources.before.assets, 31);
assert.equal(sources.after.assets, 3);
const report = {
  date: new Date().toISOString(),
  sourceDigest: execFileSync(
    process.execPath,
    [new URL("source-digest.mjs", import.meta.url).pathname],
    { encoding: "utf8" },
  ).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "Semantic compaction and Save precede physical reclamation. Review: 5 warmups + 30 samples; apply and first post-epoch Save are single diagnostics. Counts are serialized package/asset payload bytes, excluding keys/index/disk overhead. Memory oracle timings are not IndexedDB latency. Root generation, portable meaning, cited/kept closure and retired ID markers are checked. Post-epoch Save replans once; new payload writes remain zero.",
  repeatedAttempts,
  sources,
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/reclamation-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
