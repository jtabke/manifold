/** 10,000-receipt rows explicitly configure count admission; the ordinary default remains 4,096. */
import { performance } from "node:perf_hooks";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import {
  initial,
  workspace,
  schemas,
  methods,
  hash,
  revision,
  meta,
  force,
  apply,
  compute,
  id,
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
const capture = (w, g) => ({
  request: id("save"),
  stamp: w.reader.stamp(),
  document: w.reader.read().document,
  expectedGeneration: g,
  capture: w.reader.capture(),
});
const rows = [];
for (const count of [100, 1000, 10000]) {
  const seed = await initial(),
    p = structuredClone(f.toPlain(seed.document));
  for (let i = 0; i < count; i++) {
    const item = "independent-" + String(i).padStart(5, "0"),
      r = revision(item + "-r1", item, "scalar@1", {
        value: i,
        unit: "N",
        ...meta,
      });
    p.items[item] = { id: item, label: "Independent", revision: r.id };
    p.revisions[r.id] = r;
    p.identities.items.push(item);
    p.identities.revisions.push(r.id);
  }
  const text = JSON.stringify(
    Array.from({ length: 20000 }, (_, i) => [2500 + i]),
  );
  const a = await f.asset(text, hash);
  p.revisions["area-r1"].body.asset = a;
  p.revisions["area-r1"].body.rows = 20000;
  const resources = await f.MemoryResources.verify([[a.digest, text]], hash);
  let reads = 0,
    hashBytes = 0,
    commitMs = 0;
  const w = await workspace(undefined, {
    document: f.fromPlain(p, schemas),
    receipts: [],
    resources: {
      read(asset) {
        reads++;
        return resources.read(asset);
      },
    },
  });
  const backend = f.memoryBackend(),
    port = {
      ...backend,
      async commit(...args) {
        const start = performance.now();
        try {
          return await backend.commit(...args);
        } finally {
          commitMs += performance.now() - start;
        }
      },
    };
  const io = f.incrementalStorage(port, schemas, methods, async (text) => {
    hashBytes += f.byteLength(text);
    return hash(text);
  });
  let generation = 0;
  async function save() {
    const start = performance.now(),
      previousCommit = commitMs,
      previousHash = hashBytes,
      previousReads = reads;
    const result = await io.save(capture(w, generation));
    generation = result.head.generation;
    const totalMs = performance.now() - start;
    return {
      totalMs,
      prepareMs: totalMs - (commitMs - previousCommit),
      commitMs: commitMs - previousCommit,
      hashBytes: hashBytes - previousHash,
      sourceReads: reads - previousReads,
      plannedChunks: result.plannedChunks,
      plannedBytes: result.plannedBytes,
      writes: result.writes,
    };
  }
  const first = await save(),
    edits = [],
    moves = [];
  for (let i = 0; i < 35; i++) {
    force(w, 200 + i);
    const saved = await save();
    assert.equal(saved.writes.assets, 0);
    assert.equal(saved.sourceReads, 0);
    if (i >= 5) edits.push(saved);
  }
  for (let i = 0; i < 35; i++) {
    apply(w, [
      {
        kind: "view",
        view: { ...w.reader.read().views.get("draft-view"), x: 100 + i },
      },
    ]);
    const saved = await save();
    assert.equal(saved.writes.assets, 0);
    assert.equal(saved.sourceReads, 0);
    if (i >= 5) moves.push(saved);
  }
  const unchanged = await save();
  assert.equal(unchanged.writes.chunks, 0);
  assert.equal(unchanged.plannedChunks, 1);
  const fresh = f.incrementalStorage(backend, schemas, methods, hash),
    openStart = performance.now(),
    loaded = await fresh.reopen(),
    reopenMs = performance.now() - openStart,
    adoptStart = performance.now(),
    recipient = await workspace(undefined, loaded.loaded),
    ownerAdoptMs = performance.now() - adoptStart;
  const resumedUnchanged = await fresh.save(capture(recipient, generation));
  generation = resumedUnchanged.head.generation;
  assert.equal(resumedUnchanged.plannedChunks, 1);
  assert.equal(resumedUnchanged.writes.chunks, 0);
  apply(recipient, [
    {
      kind: "view",
      view: { ...recipient.reader.read().views.get("draft-view"), x: 900 },
    },
  ]);
  const coldStart = performance.now(),
    cold = await fresh.save(capture(recipient, generation)),
    firstSaveAfterReopenMs = performance.now() - coldStart;
  assert(cold.plannedChunks <= 5);
  assert.equal(cold.writes.assets, 0);
  const summarize = (xs) => ({
    prepare30Ms: stats(xs.map((x) => x.prepareMs)),
    oracleCommit30Ms: stats(xs.map((x) => x.commitMs)),
    plannedChunks: stats(xs.map((x) => x.plannedChunks)),
    plannedBytes: stats(xs.map((x) => x.plannedBytes)),
    writtenChunks: stats(xs.map((x) => x.writes.chunks)),
    writtenBytes: stats(xs.map((x) => x.writes.chunkBytes)),
    sourceReads: xs.reduce((n, x) => n + x.sourceReads, 0),
    assetBytes: xs.reduce((n, x) => n + x.writes.assetBytes, 0),
  });
  rows.push({
    definitions: count,
    sourceRows: 20000,
    sourceBytes: f.byteLength(text),
    first,
    localEdits: summarize(edits),
    viewMoves: summarize(moves),
    unchanged,
    reopenMs,
    ownerAdoptMs,
    totalRecoveryMs: reopenMs + ownerAdoptMs,
    firstUnchangedSaveAfterReopen: {
      plannedChunks: resumedUnchanged.plannedChunks,
      writes: resumedUnchanged.writes,
    },
    firstSaveAfterReopen: {
      ms: firstSaveAfterReopenMs,
      plannedChunks: cold.plannedChunks,
      plannedBytes: cold.plannedBytes,
      writes: cold.writes,
    },
    stored: backend.diagnostics(),
  });
}
const w = await workspace(undefined, await initial(), { maxReceipts: 10000 }),
  backend = f.memoryBackend(),
  io = f.incrementalStorage(backend, schemas, methods, hash);
let generation = 0;
generation = (await io.save(capture(w, generation))).head.generation;
const receiptRows = [];
for (const count of [100, 1000, 10000]) {
  const samples = [];
  while (w.reader.evidence().size < count - 35) await compute(w);
  generation = (await io.save(capture(w, generation))).head.generation;
  while (w.reader.evidence().size < count) {
    await compute(w);
    const start = performance.now(),
      saved = await io.save(capture(w, generation));
    generation = saved.head.generation;
    if (w.reader.evidence().size > count - 30)
      samples.push({
        ms: performance.now() - start,
        chunks: saved.writes.chunks,
        bytes: saved.writes.chunkBytes,
        planned: saved.plannedChunks,
      });
  }
  receiptRows.push({
    attempts: count,
    saveLast30Ms: stats(samples.map((x) => x.ms)),
    writtenChunks: stats(samples.map((x) => x.chunks)),
    writtenBytes: stats(samples.map((x) => x.bytes)),
    plannedChunks: stats(samples.map((x) => x.planned)),
  });
}
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
    "5 warmups + 30 saves per edit/view/receipt case (receipt history seeded and checkpointed before samples); initial/reopen diagnostics single runs. Preparation includes hash/planning; oracle commits clone Maps for atomicity and are NOT IndexedDB latency. Counts are physical new chunk/source bytes. Fresh storage instance Reopen and full owner adoption are timed separately. Validated saved map layout is restored before first Save. Unchanged and one-view saves after recovery are checked independently. Old generations/orphans are not reclaimed. Native transport unchanged.",
  rows,
  receiptRows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/storage-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
