import { decodeWorkspace } from "../src/regions/artifacts.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  canvasSchemas,
  canvasMethods,
} from "../src/regions/app/canvasDocument.ts";
import { restore, archive, prepare } from "../src/regions/artifacts.ts";
import { readSamplingPlan, samplingJob } from "../src/regions/samplingPlans.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
const legacy = restore(
    readFileSync(new URL("./canvas-v2.fixture.json", import.meta.url), "utf8"),
  ),
  s = new RegionSession(
    legacy.page,
    () => [],
    legacy.document,
    legacy.artifacts,
  ),
  artifact = s.artifacts[0];
assert.equal(
  f.current(s.document, "artifact:" + artifact.id).schema,
  "canvas-artifact@2",
);
assert.equal(s.canUndo, false, "migration is not an authored Undo step");
const planReference = () =>
    f.current(s.document, "artifact:" + artifact.id).body.plans[s.state.active],
  selected = () => f.current(s.document, planReference().item);
let plan = selected();
assert.deepEqual(
  samplingJob(s.document, artifact.id, s.state.active),
  (({ legacy, ...job }) => job)(prepare(s.state, artifact, s.document)),
);
assert.equal(
  "key" in plan.body,
  false,
  "canonical key is derived rather than serialized twice",
);
const closure = f.captureContext(s.document, planReference(), canvasSchemas);
assert.equal(closure.revisions.size, 4);
assert.equal(closure.heads.get("canvas"), undefined);
const note = s.create();
s.write(note, "Unrelated note");
assert.equal(selected(), plan);
s.move(note, { x: 500, y: 500 });
assert.equal(selected(), plan);
let notices = 0;
const off = s.subscribe(() => notices++);
s.write(artifact.input, "x := 2 mm");
off();
assert.equal(notices, 1);
assert.equal(
  selected().id,
  plan.id,
  "a literal edit changes its record, not the recipe",
);
s.undo();
assert.equal(selected().id, plan.id);
const nextContext = s.branch();
s.write(artifact.input, "x := 3 mm");
assert.notEqual(
  samplingJob(s.document, artifact.id, nextContext).key,
  samplingJob(s.document, artifact.id, "original").key,
);
s.switchContext("original");
const dataset = s.importData("measurements.csv", "gain,noise\n10,unused", {
  x: 20,
  y: 700,
});
s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", { x: 10, y: 300 });
assert.equal(s.write(artifact.output, "F := gain*x").ok, true);
assert.equal(selected().body.status, "ready", selected().body.reason);
const sourceClosure = f.captureContext(
  s.document,
  planReference(),
  canvasSchemas,
);
assert.equal(
  sourceClosure.revisions.size,
  5,
  "recipe, three selected definitions and exact CSV revision",
);
assert.equal(sourceClosure.heads.get("canvas"), undefined);
plan = selected();
const source = plan.body.sources[0].reference.selection.revision;
s.write(dataset, "Reviewed measurements");
assert.notEqual(selected().id, plan.id);
assert.notEqual(
  selected().body.sources[0].reference.selection.revision,
  source,
);
assert.equal(
  samplingJob(s.document, artifact.id, s.state.active).inputs.v0,
  10000,
);

// The public command port cannot publish a forged or stale compiler projection.
const before = s.document,
  forged = structuredClone(selected().body);
forged.request.high *= 2;
assert.throws(
  () =>
    s.applyCommands([
      {
        kind: "revise",
        item: selected().item,
        revision: {
          ...selected(),
          id: "forged-plan-revision",
          body: forged,
        },
      },
    ]),
  /worksheet meaning/,
);
assert.equal(s.document, before);
// Even correctly hashed local records must pass the app compiler before establishing a write binding.
{
  const dishonest = f.prepare(
      s.document,
      "dishonest-root",
      [
        {
          kind: "revise",
          item: selected().item,
          revision: { ...selected(), id: "dishonest-plan", body: forged },
        },
      ],
      canvasSchemas,
    ).document,
    owner = f.createWorkspace(
      {
        document: dishonest,
        receipts: [],
        resources: s.foundation.resources(),
      },
      { schemas: canvasSchemas, namespace: "structural-only" },
    ),
    backend = f.memoryBackend(),
    core = f.incrementalStorage(
      backend,
      canvasSchemas,
      canvasMethods,
      f.webHash,
    );
  const capture = owner.reader.capture();
  await core.save({
    request: "dishonest-save",
    stamp: capture.stamp,
    document: dishonest.document,
    expectedGeneration: 0,
    capture,
  });
  const head = await backend.head(),
    snapshot = await backend.snapshot(),
    writer = f.recordWriter(new Map(), f.webHash),
    bundle = await writer.pack(
      {
        kind: "bundle",
        schema: "manifold-canvas-local",
        version: 1,
        metadata: {
          document: dishonest.document,
          root: dishonest.id,
          evidence: 0,
        },
        roots: { foundation: head.package, results: null },
      },
      [head.package],
    );
  await backend.commit(
    head.generation,
    { ...head, generation: head.generation + 1, package: bundle },
    [...writer.chunks.values()],
    [],
    "none",
    snapshot.state.epoch,
  );
  const invalid = canvasLocalStore(backend);
  await assert.rejects(() => invalid.load(), /worksheet meaning/);
  await assert.rejects(() => invalid.save(s), /Open and validate/);
}
const droppedPlans = structuredClone(
  f.current(s.document, "artifact:" + artifact.id),
);
delete droppedPlans.body.plans;
droppedPlans.id = "legacy-downgrade";
droppedPlans.schema = "canvas-artifact@1";
assert.throws(
  () =>
    s.applyCommands([
      { kind: "revise", item: droppedPlans.item, revision: droppedPlans },
      ...Object.values(f.current(s.document, droppedPlans.item).body.plans).map(
        (ref) => ({ kind: "delete", item: ref.item }),
      ),
    ]),
  /migration/,
);
assert.equal(s.document, before);
const badPage = structuredClone(s.state);
badPage.extra = { unexpected: true };
const detached = new RegionSession(badPage, () => [], s.document, s.artifacts);
assert.deepEqual(
  detached.state,
  s.state,
  "an existing document remains the source of accepted Page meaning",
);
const bytes = archive(s.native()),
  opened = await decodeWorkspace(bytes),
  fresh = new RegionSession(
    opened.page,
    () => [],
    opened.document,
    opened.artifacts,
  );
assert.equal(
  samplingJob(fresh.document, artifact.id, nextContext).key,
  samplingJob(s.document, artifact.id, nextContext).key,
);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(s);
const reader = canvasLocalStore(backend),
  loaded = await reader.load(),
  recovered = new RegionSession(
    loaded.page,
    () => [],
    loaded.document,
    loaded.artifacts,
    false,
    loaded.recovery,
  );
assert.equal(reader.acknowledgeRecovery(recovered), true);
assert.equal((await reader.save(recovered)).writes.chunks, 0);
assert.equal(recovered.computations.diagnostics().running, 0);
const oldPlanItem = planReference().item;
s.setArtifacts([]);
assert.equal(f.current(s.document, oldPlanItem), undefined);
s.undo();
assert.ok(f.current(s.document, oldPlanItem));
console.log(
  "Sampling plans: one-owner compilation, exact small source closure, stable unrelated/layout keys, contexts, source revisions, atomic Undo, forged-plan rejection and portable/recovery reuse pass.",
);
