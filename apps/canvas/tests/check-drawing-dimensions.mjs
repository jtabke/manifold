import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  drawings,
  editDrawings,
  duplicateDrawings,
  scaledDrawingSchema,
  drawingSchema,
} from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import {
  dimensionLineLayout,
  validateDimensionPlacements,
} from "../src/regions/drawingDimensions.ts";
import {
  createScaledArea,
  exactDrawing,
  setDimensionPlacement,
  resetDimensionPlacements,
  updateDrawingScale,
} from "../src/regions/drawingScaleOperations.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const a = { x: 0, y: 0 },
  b = { x: 120, y: 0 };
const normal = dimensionLineLayout(a, b, 1, "120 mm");
near(normal.span, 120);
near(normal.origin.x, 0);
near(normal.origin.y, 28);
near(normal.angle, 0);
assert.equal(normal.outside, false);
near(normal.extensions[0].from.y, 4);
near(normal.extensions[0].to.y, 34);
const reversed = dimensionLineLayout(b, a, 1, "120 mm");
near(reversed.origin.x, normal.origin.x);
near(reversed.origin.y, normal.origin.y);
near(reversed.angle, normal.angle);
near(reversed.label.x, normal.label.x);
const height = dimensionLineLayout(
  { x: 80, y: 60 },
  { x: 80, y: 0 },
  1,
  "60 mm",
  undefined,
  true,
);
near(height.origin.x, 108);
near(height.origin.y, 60);
near(height.angle, -90);
const left = dimensionLineLayout(
  { x: 80, y: 60 },
  { x: 80, y: 0 },
  1,
  "60 mm",
  { offset: -20 },
  true,
);
near(left.origin.x, 60);
assert(left.extensions.every((e) => e.to.x < e.from.x));
for (const zoom of [0.1, 0.5, 1, 2]) {
  const auto = dimensionLineLayout(a, b, zoom, "120 mm");
  near(auto.offset * zoom, 28);
  near(auto.arrow * zoom, 6);
  const pinned = dimensionLineLayout(a, b, zoom, "120 mm", {
    offset: 65,
    label: 12,
  });
  near(pinned.origin.y, 65);
  near(pinned.label.x, 72);
  const short = dimensionLineLayout(a, { x: 1, y: 0 }, zoom, "1 mm");
  assert(short.outside);
  assert(short.label.x > short.span);
  const zero = dimensionLineLayout(a, a, zoom, "0 mm");
  for (const v of [
    zero.span,
    zero.start,
    zero.end,
    zero.origin.x,
    zero.origin.y,
    zero.label.x,
    zero.angle,
  ])
    assert(Number.isFinite(v));
}
const diagonal = dimensionLineLayout(
  { x: 0, y: 0 },
  { x: -100, y: -100 },
  1,
  "141 mm",
);
near(diagonal.angle, 45);
const nearShape = dimensionLineLayout(a, b, 1, "120 mm", { offset: 1 });
assert(
  nearShape.extensions[0].from.y < 1 && nearShape.extensions[0].to.y > 1,
  "extension lines remain connected even close to geometry",
);
for (const value of [
  { width: { offset: Infinity } },
  { width: { offset: NaN } },
  { width: { offset: 1e7 } },
  { width: { offset: 2, label: "bad" } },
  { width: { offset: 2, unknown: 3 } },
  { length: { offset: 2 } },
  {},
  null,
])
  assert.throws(() => validateDimensionPlacements(value, "rectangle"));
const s = new RegionSession(),
  entry = (id) => drawings(s.document).find((e) => e.id === id);
const area = createScaledArea(s, { x: 100, y: 100 });
const rectangle = exactDrawing(s, area, "rectangle", "120 mm", "80 mm", 0);
const original = entry(rectangle),
  before = s.document;
setDimensionPlacement(s, rectangle, "width", { offset: 70 });
setDimensionPlacement(s, rectangle, "height", { offset: 50, label: 12 });
assert.deepEqual(
  entry(rectangle).mark.points,
  original.mark.points,
  "annotation placement never edits physical geometry",
);
assert.deepEqual(entry(rectangle).view, original.view);
const placed = entry(rectangle).mark.dimensionPlacement;
assert.deepEqual(placed, {
  width: { offset: 70 },
  height: { offset: 50, label: 12 },
});
scaledDrawingSchema.validate(entry(rectangle).mark);
assert.throws(() => drawingSchema.validate(entry(rectangle).mark), /field/i);
s.undo();
assert.deepEqual(entry(rectangle).mark.dimensionPlacement, {
  width: { offset: 70 },
});
s.undo();
assert.deepEqual(drawings(s.document), drawings(before));
s.redo();
s.redo();
const root = s.document;
for (const change of [
  { offset: Infinity },
  { offset: 2, label: NaN },
  { offset: 1e7 },
]) {
  assert.throws(() => setDimensionPlacement(s, rectangle, "width", change));
  assert.equal(s.document, root);
}
assert.throws(() =>
  setDimensionPlacement(s, rectangle, "length", { offset: 10 }),
);
assert.equal(s.document, root);
// Native stale-head protection applies even if another object, rather than the shape, changed.
updateDrawingScale(s, area, { ...entry(area).mark.scale, unit: "in" });
const updated = s.document;
assert.throws(
  () => setDimensionPlacement(s, rectangle, "width", { offset: 30 }, root),
  /stale|changed/i,
);
assert.equal(s.document, updated);
assert.deepEqual(entry(rectangle).mark.dimensionPlacement, placed);
const points = drawingGeometry(drawings(s.document)).points(entry(rectangle));
editDrawings(s, [{ entry: entry(rectangle), at: { x: 100, y: 50 } }]);
assert.deepEqual(entry(rectangle).mark.dimensionPlacement, placed);
const moved = drawingGeometry(drawings(s.document)).points(entry(rectangle));
near(moved[0].x - points[0].x, 100);
near(moved[0].y - points[0].y, 50);
exactDrawing(s, area, "rectangle", "240 mm", "160 mm", 0, rectangle);
assert.deepEqual(
  entry(rectangle).mark.dimensionPlacement,
  placed,
  "placement follows edits without changing the measurement or label value",
);
const copy = duplicateDrawings(s, [rectangle])[0];
assert.deepEqual(entry(copy).mark.dimensionPlacement, placed);
const opened = await stageWorkspaceFile(archive(s.native()));
assert.deepEqual(drawings(opened.document), drawings(s.document));
setDimensionPlacement(s, rectangle, "width", null);
assert.deepEqual(entry(rectangle).mark.dimensionPlacement, {
  height: { offset: 50, label: 12 },
});
resetDimensionPlacements(s, [rectangle, copy]);
assert.equal(entry(rectangle).mark.dimensionPlacement, undefined);
assert.equal(entry(copy).mark.dimensionPlacement, undefined);
s.undo();
assert.deepEqual(entry(copy).mark.dimensionPlacement, placed);
assert.deepEqual(entry(rectangle).mark.dimensionPlacement, {
  height: { offset: 50, label: 12 },
});
assert.equal(f.current(s.document, rectangle).schema, "canvas-drawing@2");
console.log(
  "Drafting dimension geometry, short/reversed/vertical/zero spans, zoom legibility, strict placement bounds, independent annotation edits, stale rejection, Undo/Redo, reset/copy and native round trips pass.",
);
