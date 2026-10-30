/** Whole retained-state bounds, transport expansion and validated warm recovery. */
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir, cpus, platform, arch, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  MAX_CANVAS_LOCAL_BYTES,
  MAX_CANVAS_FILE_BYTES,
} from "../src/regions/app/canvasStorageBudget.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";

if (process.argv[2] === "--recipient") {
  const data = await decodeWorkspace(readFileSync(process.argv[3], "utf8"));
  const session = new RegionSession(
    data.page,
    () => [],
    data.document,
    data.artifacts,
    false,
    data.recovery,
  );
  const sources = session.state.regions.map((region) => region.data.csv);
  console.log(
    JSON.stringify({
      sources: sources.length,
      characters: sources[0].length,
      storageUpperBytes: session.capture().storageUpperBytes,
      activeJobs:
        session.executionDiagnostics.running +
        session.executionDiagnostics.queued,
    }),
  );
  session.dispose();
  process.exit(0);
}
const rows = [];
for (const [name, count, payload] of [
  ["ascii-small", 1, "u".repeat(900000)],
  ["ascii-handoff", 9, "u".repeat(900000)],
  ["unicode-escaped", 9, "λ\\".repeat(300000)],
  ["control-expanded", 12, "\u0001".repeat(800000)],
]) {
  const csv = "gain,noise\n10," + payload;
  const page = {
    regions: Array.from({ length: count }, (_, index) => ({
      id: "region-data-" + index,
      text: "Source " + index,
      data: { name: index + ".csv", csv },
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    origin: { x: 110, y: 110 },
    layout: {},
    plots: [],
  };
  const began = performance.now(),
    session = new RegionSession(page),
    capture = session.capture();
  const native = archive(session.native(capture));
  const nativeBytes = f.byteLength(native),
    backend = f.memoryBackend(),
    store = canvasLocalStore(backend);
  await store.load();
  const saveStart = performance.now(),
    saved = await store.save(session);
  const saveMs = performance.now() - saveStart,
    physical = await backend.inspect();
  const readStart = performance.now(),
    recipientStore = canvasLocalStore(backend),
    data = await recipientStore.load();
  const readMs = performance.now() - readStart;
  const recipient = new RegionSession(
    data.page,
    () => [],
    data.document,
    data.artifacts,
    false,
    data.recovery,
  );
  recipientStore.acknowledgeRecovery(recipient);
  const unchanged = await recipientStore.save(recipient);
  const fileStart = performance.now(),
    file = await decodeWorkspace(native);
  if (
    file.page.regions.length !== count ||
    file.page.regions.some((region) => region.data.csv !== csv)
  )
    throw Error("Source mismatch");
  let freshProcess;
  if (name === "ascii-handoff") {
    const directory = mkdtempSync(join(tmpdir(), "manifold-capacity-"));
    try {
      const path = join(directory, "work.manifold");
      writeFileSync(path, native);
      freshProcess = JSON.parse(
        execFileSync(
          process.execPath,
          [fileURLToPath(import.meta.url), "--recipient", path],
          { encoding: "utf8" },
        ),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  rows.push({
    name,
    sources: count,
    sourceCharacters: csv.length,
    rawSourceBytes: f.byteLength(csv) * count,
    nativeBytes,
    storageUpperBytes: capture.storageUpperBytes,
    physicalBytes: physical.after.bytes,
    chunks: saved.writes.chunks,
    unchangedChunks: unchanged.writes.chunks,
    unchangedAssetBytes: unchanged.writes.assetBytes,
    localSaveMs: saveMs,
    localReadMs: readMs,
    nativeDecodeAndFreshProcessMs: performance.now() - fileStart,
    totalMs: performance.now() - began,
    freshProcess,
  });
  session.dispose();
  recipient.dispose();
  store.close();
  recipientStore.close();
}
// Rejection happens before publication, not after exhausting the durable store.
const near = new RegionSession(),
  expanded = "gain,noise\n10," + "\u0001".repeat(800000);
let admitted = 0,
  refusal;
for (; admitted < 20; admitted++) {
  const before = near.capture();
  try {
    near.importData("expanded.csv", expanded, { x: 100, y: admitted * 100 });
  } catch (error) {
    if (
      near.document !== before.document ||
      near.evidenceSequence !== before.evidence
    )
      throw Error("Partial capacity publication");
    refusal = {
      message: error.message,
      preservedRoot: true,
      storageUpperBytes: before.storageUpperBytes,
    };
    break;
  }
}
if (!refusal) throw Error("Missing capacity refusal");
near.dispose();
const result = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    arch: arch(),
    release: release(),
  },
  method:
    "Single cold diagnostics per 1/9/9/12-source ASCII/Unicode-backslash/control-byte worksheet; count UTF-8 and JSON escaping separately, compare native and full reachable physical bytes with the conservative admitted-state bound. Native >8 MB hands off to a fresh Node process without execution. Warm recovery must write no chunks/assets. Repeated expanded-source import must refuse atomically before durable writes. Includes full decode/domain validation and memory storage; timings are not distributions, browser interaction, process-heap or product capacity acceptance.",
  limits: {
    retainedBytes: MAX_CANVAS_LOCAL_BYTES,
    fileBytes: MAX_CANVAS_FILE_BYTES,
  },
  rows,
  admission: { admittedSources: admitted, ...refusal },
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/canvas-capacity-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
