/** Source-backed execution/service workloads; excludes transport, React, rendering and heap. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import {
  createTaskScheduler,
  byteLength,
  receiptData,
} from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { restore } from "../src/regions/artifacts.ts";
import {
  createArtifactComputations,
  sourceHash,
} from "../src/regions/artifactComputations.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const fixture = restore(
  readFileSync(
    new URL("../tests/canvas-v2.fixture.json", import.meta.url),
    "utf8",
  ),
);
const csv =
  "gain,noise\n" +
  Array.from({ length: 10000 }, () => "10," + "z".repeat(90)).join("\n");
const rows = [];
for (const count of [1, 8, 16]) {
  const scheduler = createTaskScheduler();
  let jobs = 0,
    peakRunning = 0;
  const execution = {
    scheduler,
    artifactExecutor: async (job) => {
      jobs++;
      peakRunning = Math.max(peakRunning, scheduler.diagnostics().running);
      const [, start, end] = /linspace\(([^,]+), ([^,]+),/.exec(job.code),
        low = Number(start),
        high = Number(end),
        gain = Object.values(job.inputs)[0];
      return {
        points: Array.from({ length: 201 }, (_, index) => {
          const x = index === 200 ? high : low + ((high - low) * index) / 200;
          return [x, gain * x];
        }),
        code_sha256: await sourceHash(job.code),
        runtime: { adapter: "bounded-python-sampler/1", python: "diagnostic" },
      };
    },
  };
  const session = new RegionSession(
      fixture.page,
      () => [],
      fixture.document,
      fixture.artifacts,
      false,
      undefined,
      execution,
    ),
    source = session.importData("measurements.csv", csv, { x: 100, y: 800 });
  session.quantityFromCell(source, 0, 0, "gain", "N/mm", { x: 100, y: 600 });
  session.write(session.artifacts[0].output, "F := gain*x");
  session.setArtifacts(([base]) =>
    Array.from({ length: count }, (_, index) => ({
      ...base,
      id: `artifact-workload-${index}`,
      high: base.high + index * 0.00001,
    })),
  );
  const computations = createArtifactComputations(session);
  let started = performance.now();
  computations.attach();
  const peakAdmitted = scheduler.diagnostics().queued;
  await computations.idle();
  const firstMs = performance.now() - started,
    firstJobs = jobs;
  assert.equal(firstJobs, count);
  const read = () => {
    for (const artifact of session.artifacts)
      for (let view = 0; view < 3; view++)
        assert.equal(
          computations.read(artifact.id, session.state.active).current,
          true,
        );
  };
  started = performance.now();
  read();
  const presentationReadsMs = performance.now() - started;
  assert.equal(jobs, count, "Representations cannot execute");
  const note = session.create();
  session.write(note, "Unrelated authoring");
  await computations.idle();
  const unrelatedJobs = jobs - firstJobs;
  assert.equal(unrelatedJobs, 0);
  const firstPin =
    session.artifacts[0].receipt.sources[0].reference.selection.revision;
  started = performance.now();
  session.write(source, "Data · reviewed measurements");
  await computations.idle();
  const sourceRevisionMs = performance.now() - started,
    sourceRevisionJobs = jobs - firstJobs;
  assert.equal(sourceRevisionJobs, count);
  assert.notEqual(
    session.artifacts[0].receipt.sources[0].reference.selection.revision,
    firstPin,
  );
  read();
  assert.ok(peakRunning <= 4 && peakAdmitted <= 36);
  const diagnostic = computations.diagnostics();
  const receipts = session.foundation.evidence(),
    receiptMetadataBytes = [...receipts.entries()].reduce(
      (n, [, receipt]) => n + byteLength(JSON.stringify(receiptData(receipt))),
      0,
    );
  assert.equal(receipts.size, count * 2);
  assert.ok(receiptMetadataBytes <= 8 * 1024 * 1024);
  assert.equal(diagnostic.activeRequests, 0);
  rows.push({
    artifacts: count,
    representations: count * 3,
    pointsPerAttempt: 201,
    sourceBytes: byteLength(csv),
    firstJobs,
    firstMs,
    presentationReadsMs,
    unrelatedJobs,
    sameValuedSourceRevisionJobs: sourceRevisionJobs,
    sourceRevisionMs,
    peakRunning,
    peakAdmitted,
    sharedReceipts: receipts.size,
    receiptMetadataBytes,
    settledActiveRequests: diagnostic.activeRequests,
    retainedResults: session.artifacts.filter((a) => a.receipt).length,
    evidenceSequence: session.evidenceSequence,
  });
  computations.dispose();
  session.dispose();
  scheduler.dispose();
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
    "One diagnostic per 1/8/16 distinct source-backed requests sharing one 940,010-byte CSV. One shared owner admits at most four jobs, on the root scheduler with four running/32 waiting capacity; 201 points independently checked per attempt. Three presentation readers per request share the same service. Unrelated authoring submits no jobs; a same-valued source revision resubmits affected requests. Timings include preparation, local async executor, SHA-256 and owner numeric admission, excluding source import/setup, transport, React, rendering, IndexedDB and process heap. Receipt metadata bytes are not heap. The separate sampler result cache/clock/storage root is retired; durable receipts use shared admission limits. No product latency/capacity acceptance.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/artifact-computations-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
