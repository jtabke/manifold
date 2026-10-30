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
  ref,
  meta,
  revision,
  current,
  apply,
  force,
  preview,
  keep,
  compute,
  serialized,
  id,
} from "./helpers.mjs";
const stats = (xs) => {
  const a = [...xs].sort((a, b) => a - b);
  return {
    min: a[0],
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    max: a.at(-1),
  };
};
const rows = [];
async function bytesAndLoad(w) {
  const start = performance.now(),
    native = serialized(w),
    encoded = performance.now() - start,
    begin = performance.now();
  await f.decode(native, schemas, methods, hash);
  return {
    nativeBytes: f.byteLength(native),
    encodeMs: encoded,
    decodeMs: performance.now() - begin,
  };
}
for (const attempts of [100, 1000, 10000]) {
  const w = await workspace(undefined, await initial(), {
    historyLimit: 0,
    maxReceipts: attempts,
  });
  for (let i = 0; i < attempts; i++) await compute(w);
  const before = await bytesAndLoad(w),
    times = [];
  let review;
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    review = w.reader.reviewCompaction({ evidence: "reachable" });
    if (i >= 5) times.push(performance.now() - start);
  }
  const start = performance.now(),
    committed = w.owner.compact(w.reader.stamp(), id("compacted"), review);
  assert.equal(committed.ok, true, committed.error);
  const commitMs = performance.now() - start,
    after = await bytesAndLoad(w);
  assert.equal(w.diagnostics().receipts, 1);
  assert.equal(w.reader.read().allocated.receipts.size, attempts);
  assert.equal(w.reader.result(ref("pressure")).status, "current");
  rows.push({
    attempts,
    before,
    after,
    review30Ms: stats(times),
    commitMs,
    retainedReceipts: w.diagnostics().receipts,
    receiptIdentityMarkers: w.reader.read().allocated.receipts.size,
    evidenceSequence: w.reader.stamp().evidence,
    prunedReceipts: review.removedReceipts.length,
  });
}
const history = [];
for (const historyLimit of [0, 32]) {
  const w = await workspace(undefined, await initial(), { historyLimit });
  for (let i = 0; i < 1000; i++) force(w, i + 1);
  const before = await bytesAndLoad(w),
    times = [];
  let review;
  for (let i = 0; i < 35; i++) {
    const start = performance.now();
    review = w.reader.reviewCompaction({ evidence: "reachable" });
    if (i >= 5) times.push(performance.now() - start);
  }
  const committed = w.owner.compact(w.reader.stamp(), id("compacted"), review);
  assert.equal(committed.ok, true, committed.error);
  const after = await bytesAndLoad(w);
  history.push({
    edits: 1000,
    historyLimit,
    retainedUndo: w.diagnostics().undoSteps,
    before,
    after,
    review30Ms: stats(times),
    removedRevisions: review.removedRevisions.length,
    retainedRevisions: w.reader.read().revisions.size,
    revisionIdentityMarkers: w.reader.read().allocated.revisions.size,
  });
}
const sourceWorkspace = await workspace(undefined, await initial(), {
  historyLimit: 0,
});
preview(sourceWorkspace, 200);
const saved = keep(sourceWorkspace);
await compute(sourceWorkspace, ref("pressure"), {
  alternative: saved.alternative,
});
for (let n = 0; n < 30; n++) {
  const text = JSON.stringify(
      Array.from({ length: 2000 }, (_, row) => [5000 + n + row]),
    ),
    a = await f.asset(text, hash),
    resources = await sourceWorkspace.reader.resources().add(a, text, hash),
    rid = id("source"),
    commands = [
      {
        kind: "revise",
        item: "area",
        revision: revision(rid, "area", "source@1", {
          asset: a,
          rows: 2000,
          columns: 1,
          interpretation: [{ unit: "mm2", ...meta }],
        }),
      },
    ];
  for (const item of ["pressure", "required-force"]) {
    const old = current(sourceWorkspace.reader.read(), item).body;
    commands.push({
      kind: "revise",
      item,
      revision: revision(id(item), item, "request@1", {
        ...old,
        inputs: {
          ...old.inputs,
          area: {
            ...old.inputs.area,
            selector: {
              kind: "cell",
              version: 1,
              revision: rid,
              row: 0,
              column: 0,
            },
          },
        },
      }),
    });
  }
  apply(sourceWorkspace, commands, resources);
  await compute(sourceWorkspace);
  if (n === 5) {
    const receipt = [...sourceWorkspace.reader.evidence().entries()]
      .map(([, r]) => r)
      .sort((a, b) => b.order - a.order)[0];
    const item = id("conclusion");
    apply(sourceWorkspace, [
      {
        kind: "create",
        item,
        label: "Pinned source evidence",
        revision: revision(id("conclusion-revision"), item, "conclusion@1", {
          text: "Retain this recorded attempt",
          receipts: [receipt.id],
        }),
      },
    ]);
  }
}
const beforeSources = await bytesAndLoad(sourceWorkspace),
  beforeResources = sourceWorkspace.reader.resources().diagnostics(),
  review = sourceWorkspace.reader.reviewCompaction({ evidence: "reachable" }),
  resources = sourceWorkspace.reader.resources().retain(review.assets),
  committed = sourceWorkspace.owner.compact(
    sourceWorkspace.reader.stamp(),
    id("compacted"),
    review,
    resources,
  );
assert.equal(committed.ok, true, committed.error);
const afterSources = await bytesAndLoad(sourceWorkspace);
assert.equal(
  sourceWorkspace.reader.result(ref("pressure"), {
    alternative: saved.alternative,
  }).receipt.outcome.output.value,
  0.08,
);
assert.equal(sourceWorkspace.diagnostics().receipts, 3);
const result = {
  date: new Date().toISOString(),
  sourceDigest: execFileSync(
    process.execPath,
    ["packages/foundation/test/source-digest.mjs"],
    { encoding: "utf8" },
  ).trim(),
  environment: {
    node: process.version,
    cpu: cpus()[0]?.model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "Explicit maintenance only: 5 warmups + 30 review samples. Encode/decode before/after are single diagnostics. Sources are 30 distinct verified 2000-row tables with a kept baseline and a cited historical attempt. Logical store/portable bytes are measured; process heap and old database generations are not reclaimed/measured.",
  repeatedAttempts: rows,
  history,
  sources: {
    versions: 30,
    rowsPerSource: 2000,
    before: beforeSources,
    after: afterSources,
    beforeResources,
    afterResources: resources.diagnostics(),
    removedRevisions: review.removedRevisions.length,
    removedReceipts: review.removedReceipts.length,
    retainedReceipts: sourceWorkspace.diagnostics().receipts,
    retainedAlternatives: sourceWorkspace.reader.read().alternatives.size,
  },
};
writeFileSync(
  new URL(
    "../../../evidence/current/foundation/retention-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
