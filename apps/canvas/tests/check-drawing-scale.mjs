import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  createDrawing,
  drawings,
  deleteDrawings,
  duplicateDrawings,
  editDrawings,
  DRAWING,
  SCALED_DRAWING,
  drawingSchema,
  scaledDrawingSchema,
} from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import {
  defaultDrawingScale,
  parseDrawingLength,
  lengthUnit,
  validateDrawingScale,
  snapDrawingPoint,
  drawingGridStep,
} from "../src/regions/drawingScale.ts";
import {
  createScaledArea,
  calibrateDrawingSelection,
  exactDrawing,
  updateDrawingScale,
  assignDrawingArea,
} from "../src/regions/drawingScaleOperations.ts";
import {
  positionDrawings,
  duplicateSelection,
  deleteSelection,
} from "../src/regions/selectionOperations.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
const near = (a, b) =>
  assert(Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
near(parseDrawingLength("120 mm", "ft"), 0.12);
near(parseDrawingLength("6 ft", "mm"), 1.8288);
near(parseDrawingLength("1/2 in", "mm"), 0.0127);
near(parseDrawingLength("1e3", "mm"), 1);
near(parseDrawingLength("1 um", "mm"), 1e-6);
near(parseDrawingLength("1 km", "mm"), 1000);
near(parseDrawingLength("1 yd", "mm"), 0.9144);
near(parseDrawingLength("1 mi", "mm"), 1609.344);
near(parseDrawingLength("1 inch", "mm"), 0.0254);
for (const value of [
  "0",
  "-2 mm",
  "1/0 in",
  "NaN m",
  "Infinity m",
  "1 kg",
  "1 deg",
  "1 K",
  "2 unknown",
  "alert(1)",
  "1e99 m",
  "1e-99 m",
])
  assert.throws(() => parseDrawingLength(value, "mm"));
assert.throws(() => lengthUnit("kg"));
for (const change of [
  { unit: "kg" },
  { metresPerUnit: 0 },
  { gridMetres: -1 },
  { snap: "yes" },
  { dimensions: null },
  { name: "" },
  { name: "bad\nname" },
  { metresPerUnit: Infinity },
  { unknown: 1 },
])
  assert.throws(() =>
    validateDrawingScale({ ...defaultDrawingScale(), ...change }),
  );
const s = new RegionSession(),
  entry = (id) => drawings(s.document).find((e) => e.id === id),
  points = (id) => drawingGeometry(drawings(s.document)).points(entry(id));
const area = createScaledArea(s, { x: 40, y: 60 });
const rect = exactDrawing(s, area, "rectangle", "120 mm", "80 mm", 0);
const line = exactDrawing(s, area, "line", "6 ft", "", 30);
assert.equal(f.current(s.document, area).schema, SCALED_DRAWING);
assert.equal(f.current(s.document, rect).schema, SCALED_DRAWING);
assert.throws(() => drawingSchema.validate(entry(rect).mark), /field/i);
scaledDrawingSchema.validate(entry(rect).mark);
near(points(rect)[1].x - points(rect)[0].x, 120);
near(points(rect)[1].y - points(rect)[0].y, 80);
near(
  Math.hypot(
    points(line)[1].x - points(line)[0].x,
    points(line)[1].y - points(line)[0].y,
  ),
  1828.8,
);
assert.equal(entry(rect).mark.area.item, area);
const geometryBefore = entry(rect).mark.points;
updateDrawingScale(s, area, { ...entry(area).mark.scale, unit: "in" });
assert.deepEqual(
  entry(rect).mark.points,
  geometryBefore,
  "display conversion never changes geometry",
);
assert.equal(entry(area).mark.scale.metresPerUnit, 0.001);
const other = createScaledArea(s, { x: 1000, y: 1000 }, 800, 500, {
  ...defaultDrawingScale(),
  name: "Building",
  unit: "ft",
  metresPerUnit: lengthUnit("ft") / 20,
  gridMetres: lengthUnit("ft") / 4,
});
const otherLine = exactDrawing(s, other, "line", "6 ft", "", 0);
near(points(otherLine)[1].x - points(otherLine)[0].x, 120);
assert.equal(
  entry(area).mark.scale.unit,
  "in",
  "drawing areas have independent units",
);
const markBefore = entry(rect).mark;
for (const args of [
  [area, "rectangle", "1 kg", "80 mm", 0, rect],
  [area, "line", "0 mm", "", 0],
  [area, "line", "1e12 m", "", 0],
  [area, "line", "10 mm", "", Infinity],
  [other, "rectangle", "120 mm", "80 mm", 0, rect],
]) {
  const root = s.document;
  assert.throws(() => exactDrawing(s, ...args));
  assert.equal(s.document, root);
}
assert.equal(entry(rect).mark, markBefore);
const rootBeforeEdit = s.document;
exactDrawing(s, area, "rectangle", "1/2 in", "2 in", 0, rect);
near(points(rect)[1].x - points(rect)[0].x, 12.7);
s.undo();
assert.deepEqual(drawings(s.document), drawings(rootBeforeEdit));
s.redo();
near(points(rect)[1].x - points(rect)[0].x, 12.7);
s.undo();
// Physical-grid snapping is relative to the drawing area's world origin and independent of zoom.
assert.deepEqual(
  snapDrawingPoint(
    { x: 53, y: 72, pressure: 0.7 },
    { x: 40, y: 60 },
    defaultDrawingScale(),
  ),
  { x: 55, y: 70, pressure: 0.7 },
);
assert.deepEqual(
  snapDrawingPoint(
    { x: 53, y: 72 },
    { x: 40, y: 60 },
    { ...defaultDrawingScale(), snap: false },
  ),
  { x: 53, y: 72 },
);
for (const zoom of [0.1, 0.5, 1, 2])
  assert(drawingGridStep(defaultDrawingScale(), zoom) * zoom >= 10);
// Area moves include members exactly once; view translation does not change physical size.
const rectWorld = points(rect),
  beforeMove = s.document;
positionDrawings(s, { [area]: { x: 140, y: 160 } });
near(points(rect)[0].x, rectWorld[0].x + 100);
near(points(rect)[0].y, rectWorld[0].y + 100);
assert.equal(entry(area).mark.scale.metresPerUnit, 0.001);
s.undo();
assert.deepEqual(drawings(s.document), drawings(beforeMove));
const g = drawingGeometry(drawings(s.document));
editDrawings(
  s,
  g.transform(new Set([area]), { x: 40, y: 60 }, false)({ x: 65, y: 95 }),
);
near(points(rect)[0].x, rectWorld[0].x + 25);
near(points(rect)[0].y, rectWorld[0].y + 35);
s.undo();
// Area copies carry their members and rewrite membership references to the copied area.
const beforeCopy = s.document,
  copies = duplicateDrawings(s, [area]);
assert.equal(copies.length, 3);
const copiedArea = copies.map(entry).find((e) => e.mark.kind === "area");
assert(
  copies
    .map(entry)
    .filter((e) => e.mark.kind !== "area")
    .every((e) => e.mark.area.item === copiedArea.id),
);
s.undo();
assert.deepEqual(drawings(s.document), drawings(beforeCopy));
const mixedCopies = duplicateSelection(s, [area], {});
assert.equal(mixedCopies.length, 3);
s.undo();
const beforeDelete = s.document;
assert.throws(() => deleteDrawings(s, [area]), /still contains/);
assert.equal(s.document, beforeDelete);
deleteSelection(s, [area, rect, line]);
assert(!entry(area));
assert(!entry(rect));
s.undo();
assert.deepEqual(drawings(s.document), drawings(beforeDelete));
// Calibrating an unscaled sketch creates the area and memberships in one Undo operation.
const raw = (kind, a, b) => ({
  kind,
  color: "#334455",
  width: 2,
  points: [
    { ...a, pressure: 0.5 },
    { ...b, pressure: 0.5 },
  ],
  text: "",
  start: null,
  end: null,
});
const sketch = createDrawing(
  s,
  raw("line", { x: 200, y: 300 }, { x: 400, y: 300 }),
);
const sketchRect = createDrawing(
  s,
  raw("rectangle", { x: 220, y: 320 }, { x: 320, y: 380 }),
);
assert.equal(
  f.current(s.document, sketch).schema,
  DRAWING,
  "unscaled drawings retain their original version and meaning",
);
drawingSchema.validate(entry(sketch).mark);
assert.equal(drawingSchema.project(entry(sketch).mark).type, DRAWING);
const legacyOpened = await stageWorkspaceFile(archive(s.native()));
assert.equal(f.current(legacyOpened.document, sketch).schema, DRAWING);
const sketchPoints = entry(sketch).mark.points,
  beforeCalibration = s.document;
const calibrated = calibrateDrawingSelection(
  s,
  [sketch, sketchRect],
  "2 m",
  "m",
);
assert.deepEqual(entry(sketch).mark.points, sketchPoints);
assert.equal(
  f.current(s.document, sketch).schema,
  SCALED_DRAWING,
  "explicit calibration upgrades the selected revision",
);
assert.equal(entry(sketchRect).mark.area.item, calibrated);
near(entry(calibrated).mark.scale.metresPerUnit, 0.01);
s.undo();
assert.deepEqual(drawings(s.document), drawings(beforeCalibration));
assert.equal(entry(sketch).mark.area, undefined);
assert.equal(
  f.current(s.document, sketch).schema,
  DRAWING,
  "Undo restores the exact legacy schema and physical interpretation",
);
s.redo();
const oldOtherScale = entry(other).mark.scale;
calibrateDrawingSelection(s, [sketch], "4 m", "m");
near(entry(calibrated).mark.scale.metresPerUnit, 0.02);
assert.equal(entry(other).mark.scale, oldOtherScale);
const beforeBad = s.document;
assert.throws(
  () => calibrateDrawingSelection(s, [sketch, line], "1 m", "m"),
  /exactly one/,
);
assert.throws(
  () => assignDrawingArea(s, [rect], other),
  /different area's scale/,
);
assert.equal(s.document, beforeBad);
assert.throws(
  () =>
    createDrawing(s, {
      ...raw("line", { x: 0, y: 0 }, { x: 20, y: 20 }),
      area: f.reference(s.document.document, rect),
    }),
  /live drawing area/,
);
assert.equal(s.document, beforeBad);
const opened = await stageWorkspaceFile(archive(s.native()));
assert.deepEqual(
  drawings(opened.document),
  drawings(s.document),
  "units, calibration, grid, dimensions and native references survive download/open",
);
console.log(
  "Scaled drawing units, exact geometry, calibration, independent areas, safe edits, references, copies, moves and native round trips pass.",
);
