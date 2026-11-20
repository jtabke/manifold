import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { canvasViewSelection } from "../src/regions/app/canvasViewSelection.ts";
import { drawingFixture } from "./drawing-fixture.mjs";
import { drawings, editDrawings } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  modelViews,
  modelRequest,
} from "../src/regions/modelCommands.ts";
import {
  createModelAnalysis,
  analysisViews,
} from "../src/regions/modelAnalysisCommands.ts";
import {
  createModelOptimization,
  optimizationResponses,
  optimizationViews,
} from "../src/regions/modelOptimizationCommands.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";

const { session, ids } = drawingFixture(20);
const views = canvasViewSelection(session),
  initial = views.read();
let rendered = initial,
  publication,
  notices = 0;
const render = () => {
  rendered = views.read();
  notices++;
};
let stop = views.subscribe(render);
const observe = session.subscribe((change) => (publication = change));
const check = () => {
  assert.equal(rendered, views.read());
  const doc = session.document,
    expected = drawingGeometry(drawings(doc));
  assert.deepEqual(rendered.drawing.entries, expected.entries);
  assert.deepEqual(rendered.drawing.frames, expected.frames);
  assert.deepEqual(rendered.models, modelViews(doc));
  assert.deepEqual(rendered.analyses, analysisViews(doc));
  assert.deepEqual(rendered.optimizations, optimizationViews(doc));
  if (rendered.optimizations.length)
    assert.deepEqual(rendered.responses, optimizationResponses(doc));
};
const entry = (i) => rendered.drawing.byId.get(ids[i]);
const points = (i) => rendered.drawing.points(entry(i));
const unchanged = points(19),
  start = points(9)[0];
const before = session.document;
editDrawings(session, [
  {
    entry: entry(0),
    mark: {
      ...entry(0).mark,
      points: [entry(0).mark.points[0], { ...entry(0).mark.points[1], x: 93 }],
    },
  },
]);
assert.equal(publication.previous, before);
assert.equal(publication.document, session.document);
assert.deepEqual(publication.event.views, []);
assert.deepEqual(publication.event.items, [ids[0]]);
assert(publication.event.affected.includes(ids[9]));
assert.equal(points(9)[0].x, start.x + 13);
assert.equal(
  points(19),
  unchanged,
  "an unrelated connector keeps its projected geometry",
);
assert.equal(
  initial.drawing.frames.find((f) => f.id === ids[19]),
  rendered.drawing.frames.find((f) => f.id === ids[19]),
);
check();
const x = points(9)[0].x;
editDrawings(session, [
  { entry: entry(0), at: { x: entry(0).view.x + 200, y: entry(0).view.y } },
]);
assert.deepEqual(publication.event.items, []);
assert.deepEqual(publication.event.views, [entry(0).view.id]);
assert.equal(
  points(9)[0].x,
  x + 200,
  "a view-only move updates its attached endpoint",
);
session.undo();
assert.equal(points(9)[0].x, x);
session.redo();
assert.equal(points(9)[0].x, x + 200);
check();

const originalView = entry(18).view;
session.applyCommands([
  { kind: "removeView", id: originalView.id },
  { kind: "view", view: { ...originalView, id: "a-drawing-slot" } },
]);
assert.equal(
  rendered.drawing.entries[0].id,
  ids[18],
  "draw, hit and keyboard order follows the view keys, not the item keys",
);
check();
session.undo();
assert.equal(entry(18).view, originalView);

// Use actual authored model, analysis and optimization views, including a view
// whose renderer/target changes while its identity stays allocated.
const definition = publishModel(session, "Parabola", {
  rows: [
    { id: "x", text: "x = 1", mathVersion: 3 },
    { id: "y", text: "y = (x - 2)^2", mathVersion: 3 },
  ],
  inputs: ["x"],
  outputs: ["y"],
});
const at = { x: 50, y: 60 };
const instance = instantiateModel(
  session,
  modelReference(session.document, definition),
  at,
);
const models = rendered.models,
  picture = rendered.drawing;
const spec = { input: "x", output: "y", low: 0, high: 5 };
createModelAnalysis(session, instance, { ...spec, points: 5 }, at);
const analyses = rendered.analyses;
createModelOptimization(
  session,
  instance,
  {
    ...spec,
    mode: "minimize",
    target: null,
    xTolerance: 1e-8,
    residualTolerance: null,
  },
  at,
);
const optimizations = rendered.optimizations;
assert.equal(rendered.models, models);
assert.equal(rendered.analyses, analyses);
assert.equal(models.length, 1);
assert.equal(analyses.length, 1);
assert.equal(optimizations.length, 1);
const add = (view, id) => ({ kind: "view", view: { ...view, id } });
session.applyCommands([add(models[0], "z-view"), add(models[0], "a-view")]);
assert.deepEqual(
  rendered.models.map((v) => v.id),
  ["a-view", models[0].id, "z-view"],
);
session.applyCommands([
  add({ ...analyses[0], x: 213 }, "z-view"),
  { kind: "removeView", id: "a-view" },
]);
assert.deepEqual(rendered.models, models);
assert.deepEqual(
  rendered.analyses.map((v) => v.x),
  [at.x, 213],
);
assert.equal(rendered.optimizations, optimizations);
assert.equal(rendered.drawing, picture);
check();
const beforeRun = rendered,
  request = modelReference(session.document, modelRequest(instance));
await session.compute(request).completion;
assert.equal(publication.event.evidence, true);
assert.equal(publication.event.receiptIds.length, 1);
assert.equal(
  rendered,
  beforeRun,
  "receipt/status uses current results, not new layout selections",
);
session.preview(request, []);
assert.equal(publication.event.preview, true);
session.cancelPreview();
const n = notices;
session.clearRecentCalculations();
assert.equal(publication, undefined);
assert.equal(notices, n + 1, "session-only refresh without a fabricated delta");

stop();
editDrawings(session, [{ entry: entry(0), at: { x: 0, y: 0 } }]);
stop = views.subscribe(render);
session.applyCommands([add(optimizations[0], "b-view")]);
check(); // Last event alone didn't mention the missed drawing move.
assert.equal(points(9)[0].x, 93);
session.undo();
session.undo();
assert.equal(points(9)[0].x, x + 200);
session.redo();
check();
session.compact(session.reviewRetention());
check();
const opened = await stageWorkspaceFile(archive(session.native()));
const restored = canvasViewSelection(opened).read();
assert.deepEqual(restored.drawing.frames, rendered.drawing.frames);
assert.notEqual(
  restored.drawing,
  rendered.drawing,
  "Open reads a newly admitted graph, even with the same root id",
);
assert.equal(restored.models[0], opened.document.views.get(models[0].id));
opened.dispose();
stop();
observe();
session.dispose();
console.log(
  "Published canvas view selections: mark revisions, connected geometry, view families/order, receipts, attention, missed updates, Undo/Redo and native Open pass.",
);
