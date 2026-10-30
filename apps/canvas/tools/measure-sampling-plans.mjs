/** Compare the actual legacy artifact closure with its normalized compiler projection. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { makeArtifact, prepare } from "../src/regions/artifacts.ts";
import { samplingJob } from "../src/regions/samplingPlans.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const rows = [],
  csv =
    "noise\n" + Array.from({ length: 10000 }, () => "z".repeat(90)).join("\n");
for (const count of [10, 100, 256]) {
  const page = {
    regions: Array.from({ length: count }, (_, i) => ({
      id: `region-${i + 1}`,
      text: ["k := 10 N/mm", "x := 1 mm", "F := k*x"][i] ?? `Note ${i}`,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    plots: [],
    layout: {},
    origin: { x: 110, y: 110 },
  };
  const measurement = page.regions.at(-2),
    unrelated = page.regions.at(-1);
  measurement.data = { name: "measurements.csv", csv: "k\n10" };
  measurement.text = "Measured stiffness";
  unrelated.data = { name: "large-unrelated.csv", csv };
  unrelated.text = "Unrelated source";
  page.regions[0].source = {
    dataset: measurement.id,
    row: 0,
    column: 0,
    raw: "10",
    unit: "N/mm",
  };
  const artifact = makeArtifact(
      page,
      "region-3",
      "Plot F versus x from 0.5 to 3 mm",
    ),
    session = new RegionSession(page, () => [], undefined, [artifact]),
    current = f.current(session.document, "artifact:" + artifact.id),
    reference = current.body.plans.original,
    legacy = f.prepare(
      session.document,
      "legacy-comparison",
      [
        {
          kind: "revise",
          item: current.item,
          revision: {
            ...current,
            id: "legacy-artifact-comparison",
            schema: "canvas-artifact@1",
            body: {
              document: current.body.document,
              value: current.body.value,
            },
          },
        },
        ...Object.values(current.body.plans).map((r) => ({
          kind: "delete",
          item: r.item,
        })),
      ],
      canvasSchemas,
    ).document,
    oldClosure = f.captureContext(
      legacy,
      f.reference(legacy.document, current.item),
      canvasSchemas,
    ),
    nextClosure = f.captureContext(session.document, reference, canvasSchemas);
  assert.equal(nextClosure.revisions.size, 5);
  assert.equal(nextClosure.heads.get("canvas"), undefined);
  assert.equal(nextClosure.heads.get("region:" + unrelated.id), undefined);
  assert.equal(oldClosure.revisions.size, count + 3);
  const before = f.current(session.document, reference.item),
    firstJob = samplingJob(session.document, artifact.id, "original"),
    started = performance.now();
  for (let i = 0; i < 1000; i++)
    assert.equal(
      samplingJob(session.document, artifact.id, "original"),
      firstJob,
    );
  const reads1000Ms = performance.now() - started;
  assert.deepEqual(
    firstJob,
    (({ legacy, ...job }) => job)(
      prepare(session.state, artifact, session.document),
    ),
  );
  session.write("region-4", "Unrelated edited note");
  assert.equal(f.current(session.document, reference.item), before);
  const backend = f.memoryBackend(),
    store = canvasLocalStore(backend);
  await store.load();
  await store.save(session);
  const editStart = performance.now();
  session.write("region-2", "x := 2 mm");
  const editMs = performance.now() - editStart,
    saved = await store.save(session),
    currentPlan = f.current(session.document, reference.item);
  assert.equal(currentPlan.id, before.id);
  assert.notEqual(
    samplingJob(session.document, artifact.id, "original").key,
    firstJob.key,
  );
  assert.ok(saved.writes.chunkBytes < 16 * 1024);
  const afterEdit = session.document.revisions;
  session.setArtifacts((items) =>
    items.map((a) => ({ ...a, at: { x: a.at.x + 1, y: a.at.y } })),
  );
  assert.equal(session.document.revisions, afterEdit);
  assert.equal(f.current(session.document, reference.item), currentPlan);
  const view = await store.save(session);
  rows.push({
    regions: count,
    unrelatedSourceBytes: f.byteLength(csv),
    legacyClosureRevisions: oldClosure.revisions.size,
    planClosureRevisions: nextClosure.revisions.size,
    planBytes: f.byteLength(f.canonical(before.body)),
    excludesPage: nextClosure.heads.get("canvas") === undefined,
    excludesUnrelatedSource:
      nextClosure.heads.get("region:" + unrelated.id) === undefined,
    reads1000Ms,
    editMs,
    editSaveBytes: saved.writes.chunkBytes,
    viewSaveBytes: view.writes.chunkBytes,
    unmodifiedPlanIdentityPreserved: true,
    parameterEditPreservedPlan: true,
    viewPreservedRevisionMap: true,
  });
  session.dispose();
}
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
  },
  method:
    "10/100/256 worksheet regions, one source-backed sampler request, one unrelated 910,005-byte CSV and one small measured CSV. Compare exact V1 artifact declaration closure with the production sampling-plan root. 1,000 reads share the same immutable job/execution key; selector checks still allocate small temporary metadata. Single local edit/Save and view/Save diagnostics use memory storage. Excludes UI, network, IndexedDB latency, process heap and capacity acceptance. Plan construction/validation still compiles worksheet meaning; full typed receipt unification and affected-record writes remain open.",
  rows,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/sampling-plans-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
