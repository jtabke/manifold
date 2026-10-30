import { testSession, deliver } from "../tests/sampling-test-helpers.mjs";
/** Physical Save costs for the real application capture, separate from native-file transport. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { makeArtifact, prepare, acceptData } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const distribution = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
const summarize = (values) =>
  Object.fromEntries(
    [
      "ms",
      "hashBytes",
      "plannedChunks",
      "plannedBytes",
      "chunkBytes",
      "chunks",
    ].map((key) => [key, distribution(values.map((v) => v[key]))]),
  );
const csv =
  "value\n" + Array.from({ length: 10000 }, () => "1".repeat(95)).join("\n");
const rows = [];
for (const count of [10, 100, 256]) {
  const page = {
    regions: Array.from({ length: count }, (_, i) => ({
      id: `region-${i + 1}`,
      text: ["k := 10 N/mm", "x := 1 mm", "F := k*x"][i] ?? `Note ${i + 1}`,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    plots: [],
    layout: {},
    origin: { x: 110, y: 110 },
  };
  page.regions.at(-1).data = { name: "measurements.csv", csv };
  page.regions.at(-1).text = "Data · measurements.csv";
  const artifact = makeArtifact(
      page,
      "region-3",
      "Plot F versus x from 0.5 to 3 mm",
    ),
    session = testSession(page, () => [], undefined, [artifact]);
  const backend = f.memoryBackend();
  let hashBytes = 0;
  const hash = async (text) => {
    hashBytes += f.byteLength(text);
    return "sha256:" + createHash("sha256").update(text).digest("hex");
  };
  const store = canvasLocalStore(backend, hash);
  await store.load();
  const save = async (driver, s) => {
    hashBytes = 0;
    const start = performance.now(),
      result = await driver.save(s);
    return {
      ms: performance.now() - start,
      hashBytes,
      plannedChunks: result.plannedChunks,
      plannedBytes: result.plannedBytes,
      chunks: result.writes.chunks,
      chunkBytes: result.writes.chunkBytes,
    };
  };
  // A hot Save must never call the application's native serializer.
  session.native = () => {
    throw Error("Native serialization on local Save");
  };
  const first = await save(store, session),
    edits = [],
    views = [];
  for (let i = 0; i < 35; i++) {
    const result = session.write("region-1", `k := ${10 + (i % 2)} N/mm`);
    if (!result.ok) throw Error(result.error);
    const edit = await save(store, session);
    const revisions = session.document.revisions;
    session.setArtifacts((items) =>
      items.map((a) => ({ ...a, at: { x: 700 + i, y: 200 } })),
    );
    const view = await save(store, session);
    if (revisions !== session.document.revisions)
      throw Error("Layout changed computation");
    if (edit.hashBytes >= csv.length / 2 || view.hashBytes >= csv.length / 2)
      throw Error("Unchanged source was rehashed");
    if (i >= 5) {
      edits.push(edit);
      views.push(view);
    }
  }
  const art = session.artifacts[0],
    job = prepare(session.state, art),
    data = {
      points: [
        [art.low, 10000 * art.low],
        [art.high, 10000 * art.high],
      ],
      code_sha256: createHash("sha256").update(job.code).digest("hex"),
      runtime: { adapter: "bounded-python-sampler/1", python: "diagnostic" },
    };
  const receipt = acceptData(session.state, art, job, data).receipt;
  await deliver(session, art.id, receipt);
  const resultSave = await save(store, session);
  if (resultSave.hashBytes >= csv.length / 2)
    throw Error("New result copied unrelated source data");
  const reader = canvasLocalStore(backend, hash),
    start = performance.now(),
    loaded = await reader.load(),
    readMs = performance.now() - start;
  const adoption = performance.now(),
    resumed = testSession(
      loaded.page,
      () => [],
      loaded.document,
      loaded.artifacts,
      false,
      loaded.recovery,
    );
  reader.acknowledgeRecovery(resumed);
  const adoptMs = performance.now() - adoption;
  resumed.native = () => {
    throw Error("Native serialization on recovered Save");
  };
  const unchanged = await save(reader, resumed);
  if (unchanged.chunks !== 0 || unchanged.plannedChunks !== 1)
    throw Error("Cold recovery lost reuse");
  resumed.setArtifacts((items) =>
    items.map((a) => ({ ...a, at: { x: 900, y: 300 } })),
  );
  const moveAfterReload = await save(reader, resumed);
  if (moveAfterReload.hashBytes >= csv.length / 2)
    throw Error("Recovery rehashed old sources");
  rows.push({
    regions: count,
    sourceBytes: f.byteLength(csv),
    first,
    edits30: summarize(edits),
    views30: summarize(views),
    checkedResultSave: resultSave,
    fullReadMs: readMs,
    ownerAdoptMs: adoptMs,
    firstUnchangedSaveAfterReload: unchanged,
    firstViewSaveAfterReload: moveAfterReload,
  });
}
const result = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "Application captures at 10/100/256 regions, one artifact and one 10,000-row/960,005-byte inline CSV. 5 warmups +30 edit/view Save pairs. Times include planning, hashing and memory-backend transaction, excluding domain edit, React and network. They are not IndexedDB latency. Initial Save, checked-result Save and reload are single diagnostics. Native serializer is disabled during every local Save. Unchanged sources must not be rehashed. Cold recovery includes full domain validation and owner adoption is separate. New result snapshots retain only actual computation definitions/bindings and pinned source evidence; the unrelated CSV must not enter result bytes. No production capacity/latency acceptance.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/canvas-storage-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
