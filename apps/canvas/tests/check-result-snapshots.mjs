import {
  testSession,
  deliver,
  recovery,
  evidence as evidenceMap,
} from "./sampling-test-helpers.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { CanvasDocument } from "../src/regions/app/canvasDocument.ts";
import {
  prepare,
  acceptData,
  receiptMatchesJob,
  archive,
  restore,
  decodeWorkspace,
} from "../src/regions/artifacts.ts";
import { validateSourceEvidence } from "../src/regions/resultSnapshot.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
const v3 = restore(
  readFileSync(new URL("./canvas-v3.fixture.json", import.meta.url), "utf8"),
);
const legacyJob = prepare(v3.page, v3.artifacts[0], v3.document);
assert.equal(receiptMatchesJob(v3.artifacts[0].receipt, legacyJob), true);
const old = restore(
    readFileSync(new URL("./canvas-v2.fixture.json", import.meta.url), "utf8"),
  ),
  s = testSession(old.page, () => [], old.document, old.artifacts);
const csv =
    "gain,noise\n" +
    Array.from({ length: 10000 }, () => "10," + "z".repeat(90)).join("\n"),
  dataset = s.importData("measurements.csv", csv, { x: 100, y: 800 }),
  gain = s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", { x: 100, y: 600 });
assert.equal(s.write(s.artifacts[0].output, "F := gain*x").ok, true);
const a = s.artifacts[0];
assert.throws(() => prepare(s.state, a), /source document/);
let job = prepare(s.state, a, s.document);
assert.equal(job.definitions.length, 3);
assert.equal(
  job.definitions.some((r) => r.id === dataset || "data" in r),
  false,
);
assert.equal(job.sources[0].region, gain);
const raw = {
    points: [
      [a.low, 10000 * a.low],
      [a.high, 10000 * a.high],
    ],
    code_sha256: createHash("sha256").update(job.code).digest("hex"),
    runtime: {
      adapter: `bounded-python-sampler/${Math.max(1, ...job.definitions.map((r) => r.mathVersion ?? 1))}`,
      python: "test",
    },
  },
  receipt = acceptData(s.state, a, job, raw, s.document).receipt;
assert.equal(JSON.stringify(receipt).includes("zzzzzzzzzz"), false);
assert.equal(await deliver(s, a.id, receipt), true);
assert.equal(await deliver(s, a.id, { ...receipt, unexpected: true }), false);
// Unrelated equations/notes and layout are absent from actual-input identity.
s.write("region-1", "k := 999 N/mm");
assert.equal(prepare(s.state, a, s.document).key, job.key);
s.move("region-3", { x: 200, y: 900 });
assert.equal(prepare(s.state, a, s.document).key, job.key);
assert.equal(s.write(a.input, "x := 2 mm").ok, true);
assert.notEqual(prepare(s.state, a, s.document).key, job.key);
s.undo();
assert.equal(receiptMatchesJob(receipt, prepare(s.state, a, s.document)), true);
// Old complete snapshots can still be checked; missing/altered legacy data cannot match.
const legacy = {
  ...receipt,
  key: job.legacy.key,
  definitions: job.legacy.definitions,
};
delete legacy.snapshot;
delete legacy.dependencies;
delete legacy.sources;
assert.equal(receiptMatchesJob(legacy, job), true);
assert.equal(
  receiptMatchesJob(
    { ...legacy, definitions: legacy.definitions.slice(1) },
    job,
  ),
  false,
);
// First source-backed result Save does not hash/copy the unchanged 940 KB source again.
let hashed = 0;
const hash = async (text) => {
  hashed += f.byteLength(text);
  return "sha256:" + createHash("sha256").update(text).digest("hex");
};
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend, hash);
await store.load();
await store.save(s);
await deliver(s, a.id, {
  ...receipt,
  time: "2026-10-26T12:01:00.000Z",
});
hashed = 0;
const written = await store.save(s);
assert.ok(hashed < 20000);
assert.ok(written.writes.chunkBytes < 20000);
// Source content has its own revision identity even if the selected raw number is unchanged.
const owner = new CanvasDocument(
  s.state,
  s.document,
  s.artifacts,
  false,
  recovery(s),
);
const changed = {
  ...owner.page,
  regions: owner.page.regions.map((r) =>
    r.id === dataset
      ? { ...r, data: { ...r.data, csv: csv.replace("zzzz", "yyyy") } }
      : r,
  ),
};
assert.throws(() => prepare(changed, a, owner.document), /captured document/);
owner.apply(changed);
assert.notEqual(prepare(owner.page, a, owner.document).key, job.key);
assert.equal(
  receiptMatchesJob(receipt, prepare(owner.page, a, owner.document)),
  false,
);
validateSourceEvidence(owner.document, receipt.sources);
// Deleting the current source never substitutes a newer/current source for historical evidence.
owner.apply({
  ...owner.page,
  regions: owner.page.regions.filter((r) => r.id !== dataset),
  layout: Object.fromEntries(
    Object.entries(owner.page.layout).filter(([id]) => id !== dataset),
  ),
});
for (let i = 0; i < 270; i++)
  owner.apply({
    ...owner.page,
    regions: owner.page.regions.map((r) =>
      r.id === "region-1" ? { ...r, text: `k := ${1000 + i} N/mm` } : r,
    ),
  });
owner.compact(owner.reviewRetention());
const pin = receipt.sources[0].reference;
assert.equal(f.resolve(owner.document, pin).status, "resolved");
assert.throws(() => prepare(owner.page, a, owner.document), /source revision/);
const wire = archive(owner.native());
assert.equal(JSON.parse(wire).version, 9);
assert.equal((wire.match(/zzzzzzzzzz/g) || []).length > 0, true);
const portable = await decodeWorkspace(wire),
  reopened = testSession(
    portable.page,
    () => [],
    portable.document,
    portable.artifacts,
    false,
    portable.recovery,
  );
validateSourceEvidence(
  reopened.document,
  reopened.artifacts[0].receipt.sources,
);
assert.equal(
  f.resolve(reopened.document, pin).revision.body.value.data.csv,
  csv,
);
for (const mutate of [
  (v) =>
    (Object.values(
      v.foundation.snapshots,
    )[0].input.body.capture.sources[0].reference.document = "foreign"),
  (v) =>
    (Object.values(
      v.foundation.snapshots,
    )[0].input.body.capture.sources[0].reference.selection.revision =
      "missing"),
  (v) =>
    (Object.values(
      v.foundation.snapshots,
    )[0].input.body.capture.sources[0].raw = "11"),
]) {
  const bad = JSON.parse(wire);
  mutate(bad);
  await assert.rejects(
    () => decodeWorkspace(JSON.stringify(bad)),
    /source|cell|revision|input/i,
  );
}
// Once the observing artifact also leaves Undo, its otherwise-unused source bytes can leave.
owner.apply(owner.page, false, []);
for (let i = 0; i < 270; i++)
  owner.apply({
    ...owner.page,
    regions: owner.page.regions.map((r) =>
      r.id === "region-1" ? { ...r, text: `k := ${2000 + i} N/mm` } : r,
    ),
  });
owner.compact(owner.reviewRetention());
assert.equal(f.resolve(owner.document, pin).status, "missing");
assert.equal(evidenceMap(owner).size, 0);
console.log(
  "Result snapshots: exact dependency closure, source-backed incremental writes, relevant source-version currency, legacy verification, pinned source retention/deletion/native V7 handoff and corrupt provenance rejection pass.",
);
