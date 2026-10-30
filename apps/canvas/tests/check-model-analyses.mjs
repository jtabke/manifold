import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { modelAnalyses } from "../src/regions/foundationModels.ts";
import {
  createModelAnalysis,
  reviseModelAnalysis,
  keepModelAnalysis,
  analysisViews,
  removeModelAnalysis,
} from "../src/regions/modelAnalysisCommands.ts";
import { MODEL_ANALYSIS } from "../src/regions/modelAnalysis.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  setModelInput,
  reviewModelCsv,
  applyModelConnection,
  reviewInstanceUpdate,
  applyInstanceUpdate,
} from "../src/regions/modelCommands.ts";
const source = {
  rows: [
    { id: "force", text: "F = 20 N" },
    { id: "speed", text: "v = 3 m/s" },
    { id: "power", text: "P = F*v" },
  ],
  inputs: ["force", "speed"],
  outputs: ["power"],
};
const spec = { input: "speed", output: "power", low: 0, high: 10, points: 11 };
const s = new RegionSession();
const definition = publishModel(s, "Drive", source),
  instance = instantiateModel(s, modelReference(s.document, definition), {
    x: 0,
    y: 0,
  });
const csv = s.importData("force.csv", "F\n30\n", { x: 0, y: 900 });
applyModelConnection(s, reviewModelCsv(s, instance, "force", csv, 0, 0, "N"));
let notices = 0;
const off = s.subscribe(() => notices++);
const analysis = createModelAnalysis(s, instance, spec, { x: 450, y: 0 });
assert.equal(notices, 1);
off();
const target = modelReference(s.document, analysis);
const initialBody = f.current(s.document, instance);
assert.equal(s.foundation.result(target).status, "ready");
const result = await s.compute(target).completion;
assert.equal(result.status, "retained", result.reason);
let receipt = s.foundation.result(target).receipt;
assert.equal(receipt.kind, "typed@1");
assert.equal(receipt.outcome.status, "success", receipt.outcome.reason);
const series = receipt.outcome.output.body;
assert.deepEqual(
  series.points,
  Array.from({ length: 11 }, (_, i) => [i, 30 * i]),
);
assert.equal(series.x.unit, "m*s^-1");
assert.equal(series.y.unit, "W");
assert.equal(
  f.current(s.document, instance),
  initialBody,
  "sweep never edits the live instance",
);
assert.equal(
  receipt.context.revisions.size,
  5,
  "request, instance, definition, observation and source are captured once",
);
const capture = f.project(
  s.document,
  target,
  canvasSchemas,
  s.foundation.resources(),
).projection.value.input.body;
for (const bad of [
  { ...series, points: series.points.slice(1) },
  { ...series, y: { ...series.y, unit: "N" } },
  { ...series, points: [[-1, 0], ...series.points.slice(1)] },
  { ...series, points: [[0, NaN], ...series.points.slice(1)] },
])
  assert.throws(() => modelAnalyses.method.validateOutput(capture, bad));
const baseline = s.document;
const currentRequest = f.current(baseline, analysis);
assert.throws(
  () =>
    s.applyCommands([
      {
        kind: "revise",
        item: analysis,
        revision: {
          ...currentRequest,
          id: "forged-analysis-interface",
          schema: MODEL_ANALYSIS,
          body: {
            ...currentRequest.body,
            inputs: {
              ...currentRequest.body.inputs,
              speed: modelReference(baseline, instance, f.modelPort("power")),
            },
          },
        },
      },
    ]),
  /inspection selectors/,
);
assert.equal(s.document, baseline);
for (const bad of [
  { ...spec, low: 10 },
  { ...spec, points: 202 },
  { ...spec, points: 1 },
  { ...spec, high: Infinity },
  { ...spec, input: "missing" },
  { ...spec, low: 1e12, high: 1e12 + 0.0002, points: 201 },
]) {
  assert.throws(() => reviseModelAnalysis(s, analysis, bad));
  assert.equal(s.document, baseline);
}
reviseModelAnalysis(s, analysis, { ...spec, high: 5, points: 6 }, true);
assert.equal(s.document, baseline, "preview leaves baseline unchanged");
await s.compute(target, "preview").completion;
assert.equal(
  s.foundation
    .result(target, "preview")
    .receipt.outcome.output.body.points.at(-1)[1],
  150,
);
const kept = keepModelAnalysis(s, analysis, "Lower speed", { x: 1000, y: 0 });
assert.equal(
  s.foundation.result(target).receipt.outcome.output.body.points.at(-1)[1],
  300,
);
assert.equal(
  s.foundation
    .result(target, { alternative: kept })
    .receipt.outcome.output.body.points.at(-1)[1],
  150,
);
const frozen = s.document.alternatives.get(kept).context;
assert.equal(f.resolve(s.document, target, frozen).revision.body.high, 5);
const oldDefinition = f.current(s.document, definition).id;
publishModel(
  s,
  "Drive revised",
  {
    ...source,
    rows: source.rows.map((r) =>
      r.id === "power" ? { ...r, text: "P = 2*F*v" } : r,
    ),
  },
  definition,
);
assert.equal(
  s.foundation.result(target).status,
  "current",
  "publishing does not change pinned instance",
);
applyInstanceUpdate(s, reviewInstanceUpdate(s, instance));
assert.equal(s.foundation.result(target).status, "ready");
await s.compute(target).completion;
assert.equal(
  s.foundation.result(target).receipt.outcome.output.body.points.at(-1)[1],
  600,
);
assert.equal(
  s.foundation
    .result(target, { alternative: kept })
    .receipt.outcome.output.body.points.at(-1)[1],
  150,
);
assert.equal(
  f.resolve(
    s.document,
    {
      ...modelReference(s.document, definition),
      selection: { kind: "pin", revision: oldDefinition },
    },
    frozen,
  ).revision.id,
  oldDefinition,
);
s.undo();
assert.equal(
  s.foundation.result(target).receipt.outcome.output.body.points.at(-1)[1],
  300,
);
const old = s.document;
const note = s.create();
s.write(note, "Changed work");
assert.throws(
  () => reviseModelAnalysis(s, analysis, spec, false, old),
  /changed/,
);
reviseModelAnalysis(s, analysis, { ...spec, high: 20 });
s.undo();
assert.equal(f.current(s.document, analysis).body.high, 10);
// An unrelated layout move retains currency; a relevant input edit does not.
const view = analysisViews(s.document).find((v) => !v.alternative);
s.applyCommands([{ kind: "view", view: { ...view, x: view.x + 10 } }]);
assert.equal(s.foundation.result(target).status, "current");
setModelInput(s, instance, "force", 40);
assert.equal(
  s.foundation.result(target).status,
  "ready",
  JSON.stringify(s.foundation.result(target)),
);
const job = s.compute(target);
job.cancel();
const cancelled = await job.completion;
assert.equal(cancelled.status, "retained");
assert.equal(s.foundation.result(target).status, "failed");
assert.equal(s.foundation.result(target).receipt.outcome.status, "failed");
await s.compute(target).completion;
assert.equal(
  s.foundation.result(target).receipt.outcome.output.body.points.at(-1)[1],
  400,
);
const keepCurrent = keepModelAnalysis(s, analysis, "Current analysis", {
  x: 1600,
  y: 0,
});
assert.equal(
  s.foundation.result(target, { alternative: keepCurrent }).status,
  "current",
);
// A domain failure is an explicit failed receipt, never a partial curve or live edit.
const divideSource = {
  rows: [
    { id: "x", text: "x = 2" },
    { id: "y", text: "y = 1/x" },
  ],
  inputs: ["x"],
  outputs: ["y"],
};
const divDef = publishModel(s, "Reciprocal", divideSource),
  div = instantiateModel(s, modelReference(s.document, divDef), {
    x: 0,
    y: 1200,
  });
const failure = createModelAnalysis(
  s,
  div,
  { input: "x", output: "y", low: -1, high: 1, points: 3 },
  { x: 450, y: 1200 },
);
const failHead = s.document;
await s.compute(modelReference(s.document, failure)).completion;
assert.equal(s.document.id, failHead.id);
assert.equal(
  s.foundation.result(modelReference(s.document, failure)).status,
  "failed",
);
assert.match(
  s.foundation.result(modelReference(s.document, failure)).receipt.outcome
    .reason,
  /point 2/i,
);
// Late completion stays associated with its original capture, never the newer inputs.
reviseModelAnalysis(s, analysis, { ...spec, points: 201 });
const late = s.compute(target);
setModelInput(s, instance, "force", 50);
assert.equal((await late.completion).status, "retained");
assert.equal(s.foundation.result(target).status, "ready");
await s.compute(target).completion;
const live = analysisViews(s.document).find(
  (v) => !v.alternative && v.reference.item === analysis,
);
removeModelAnalysis(s, live);
assert.equal(
  s.foundation.result(target, { alternative: kept }).status,
  "current",
);
s.undo();
assert.equal(s.foundation.result(target).status, "current");
const opened = await stageWorkspaceFile(archive(s.native()));
assert.equal(opened.executionDiagnostics.running, 0);
assert.equal(
  opened.foundation
    .result(modelReference(opened.document, analysis), { alternative: kept })
    .receipt.outcome.output.body.points.at(-1)[1],
  150,
);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(s);
const loaded = await store.load(),
  recovered = new RegionSession(
    loaded.page,
    () => [],
    loaded.document,
    loaded.artifacts,
    false,
    loaded.recovery,
  );
assert.equal(
  recovered.foundation.result(modelReference(recovered.document, analysis))
    .status,
  "current",
);
assert.equal((await store.save(recovered)).writes.chunks, 0);
for (const session of [s, opened, recovered]) session.dispose();
console.log(
  "Model analyses: source-backed scalar sweeps, checked grid/units, exact closure, preview/Keep/Undo, revision pins, cancellation/domain refusal, native and zero-write local recovery pass.",
);
