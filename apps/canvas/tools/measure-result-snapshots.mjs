import { testSession, deliver } from "../tests/sampling-test-helpers.mjs";
/** Actual sampler-result costs with a large source that is part of the computation's provenance. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cpus, platform, release, arch } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  restore,
  prepare,
  acceptData,
  archive,
} from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const fixture = restore(
    readFileSync(
      new URL("../tests/canvas-v2.fixture.json", import.meta.url),
      "utf8",
    ),
  ),
  s = testSession(fixture.page, () => [], fixture.document, fixture.artifacts),
  csv =
    "gain,noise\n" +
    Array.from({ length: 10000 }, () => "10," + "z".repeat(90)).join("\n"),
  dataset = s.importData("measurements.csv", csv, { x: 100, y: 800 });
s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", { x: 300, y: 800 });
s.write(s.artifacts[0].output, "F := gain*x");
let hashBytes = 0;
const hash = async (text) => {
    hashBytes += f.byteLength(text);
    return "sha256:" + createHash("sha256").update(text).digest("hex");
  },
  backend = f.memoryBackend(),
  local = canvasLocalStore(backend, hash);
const exportNative = s.native.bind(s);
s.native = () => {
  throw Error("Native serialization on local Save");
};
await local.load();
const first = await local.save(s);
const a = s.artifacts[0],
  job = prepare(s.state, a, s.document),
  raw = {
    points: Array.from({ length: 201 }, (_, i) => {
      const x = a.low + ((a.high - a.low) * i) / 200;
      return [x, 10000 * x];
    }),
    code_sha256: createHash("sha256").update(job.code).digest("hex"),
    runtime: { adapter: "bounded-python-sampler/1", python: "diagnostic" },
  },
  baseReceipt = acceptData(s.state, a, job, raw, s.document).receipt,
  rows = [];
for (let i = 0; i < 35; i++) {
  const start = performance.now();
  await deliver(s, a.id, {
    ...baseReceipt,
    time: new Date(Date.UTC(2026, 9, 26, 0, 0, i)).toISOString(),
  });
  const verifyMs = performance.now() - start;
  hashBytes = 0;
  const savedAt = performance.now(),
    out = await local.save(s),
    saveMs = performance.now() - savedAt;
  if (hashBytes > 30000 || out.writes.chunkBytes > 30000)
    throw Error("Result save copied a large source");
  if (i >= 5)
    rows.push({
      verifyMs,
      saveMs,
      hashBytes,
      chunks: out.writes.chunks,
      chunkBytes: out.writes.chunkBytes,
    });
}
const dist = (xs) => {
    xs.sort((a, b) => a - b);
    return {
      min: xs[0],
      median: xs[Math.floor(xs.length / 2)],
      p95: xs[Math.ceil(xs.length * 0.95) - 1],
      max: xs.at(-1),
    };
  },
  wire = archive(exportNative()),
  occurrences = wire.split(JSON.stringify(csv)).length - 1;
if (occurrences !== 1) throw Error("Native file duplicated source bytes");
const report = {
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
    "Three required scalar definitions plus one 940,010-byte/10,000-row CSV, whose selected gain cell feeds F=gain*x. Five warmups +30 checked 201-point result updates/Saves, each attempt receives a new core order/time; input recipe/context/snapshot are shared; independent numerical verification and Save planning/hashing/memory-backend writes measured separately. Source revision pinned and CSV appears once in native V7. No native serializer on local Save, network, React, IndexedDB latency, heap or capacity acceptance.",
  sourceBytes: f.byteLength(csv),
  definitions: job.definitions.length,
  sourcePins: job.sources.length,
  receiptBytes: f.byteLength(JSON.stringify(s.artifacts[0].receipt)),
  firstSaveBytes: first.writes.chunkBytes,
  nativeBytes: f.byteLength(wire),
  nativeSourceOccurrences: occurrences,
  result30: Object.fromEntries(
    Object.keys(rows[0]).map((key) => [key, dist(rows.map((r) => r[key]))]),
  ),
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/result-snapshots-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
