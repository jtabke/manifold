import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  ARC_DRAWING,
  CURVED_DRAWING,
  DRAFTING_DRAWING,
  curvedDrawingSchema,
  createDrawing,
  drawings,
  drawingSchema,
  scaledDrawingSchema,
  validateMark,
  editDrawings,
  duplicateDrawings,
  deleteDrawings,
} from "../src/regions/drawing.ts";
import {
  circularArc,
  curveSegments,
  curvePath,
  flattenCurve,
  MAX_SPLINE_POINTS,
} from "../src/regions/drawingCurves.ts";
import {
  drawingGeometry,
  previewDrawings,
} from "../src/regions/drawingGeometry.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
const p = (x, y) => ({ x, y, pressure: 0.5 });
const mark = (kind, points) => ({
  kind,
  points,
  color: "#123456",
  width: 2,
  text: "",
  start: null,
  end: null,
});
const curve = mark("curve", [p(0, 0), p(100, 200), p(200, 0)]);
assert.equal(curvePath("curve", curve.points).startsWith("M0,0 C"), true);
const [segment] = curveSegments("curve", curve.points);
assert.equal(segment[1].y, (200 * 2) / 3);
assert.equal(segment[2].y, (200 * 2) / 3);
const flat = flattenCurve("curve", curve.points);
assert(
  flat.some((point) => point.x === 100 && Math.abs(point.y - 100) < 1e-12),
);
assert.deepEqual(flat[0], curve.points[0]);
assert.deepEqual(flat.at(-1), curve.points.at(-1));
for (const invalid of [
  mark("curve", [p(0, 0), p(1, 1)]),
  mark("curve", [...curve.points, p(1, 1)]),
  mark("spline", [p(0, 0)]),
  mark(
    "spline",
    Array.from({ length: MAX_SPLINE_POINTS + 1 }, () => p(0, 0)),
  ),
  { ...curve, start: { target: f.reference("doc", "item"), u: 0, v: 0 } },
])
  assert.throws(() => validateMark(invalid));
assert.throws(() => drawingSchema.validate(curve), /@3/);
assert.throws(() => scaledDrawingSchema.validate(curve), /@3/);
validateMark(
  mark(
    "spline",
    Array.from({ length: MAX_SPLINE_POINTS }, () => p(0, 0)),
  ),
);
const s = new RegionSession();
const id = createDrawing(s, curve, { x: 30, y: -20 });
const entry = () => drawings(s.document).find((entry) => entry.id === id);
assert.equal(f.current(s.document, id).schema, CURVED_DRAWING);
let geometry = drawingGeometry(drawings(s.document));
assert(geometry.hit(entry(), p(130, 80), 0), "hit the actual curve");
assert(
  !geometry.hit(entry(), p(130, 180), 0),
  "do not hit the control polygon",
);
assert(!geometry.hit(entry(), p(130, -20), 0), "do not hit the endpoint chord");
assert(geometry.sweptHit(entry(), p(130, 50), p(130, 110), 0));
assert(!geometry.sweptHit(entry(), p(130, 150), p(130, 200), 0));
const edits = geometry.transform(new Set([id]), p(0, 0), true)(p(200, 200));
assert.deepEqual(edits[0].mark.points, [p(0, 0), p(200, 400), p(400, 0)]);
const preview = previewDrawings(drawings(s.document), edits);
assert(
  drawingGeometry(preview).bounds(preview[0]).width >
    geometry.bounds(entry()).width,
);
const old = entry();
editDrawings(s, [
  {
    entry: old,
    mark: { ...old.mark, points: [p(0, 0), p(100, 300), p(200, 0)] },
  },
]);
s.undo();
assert.deepEqual(entry(), old);
s.redo();
assert.equal(entry().mark.points[1].y, 300);
const spline = mark("spline", [p(0, 0), p(100, 0), p(100, 100), p(200, 100)]);
const splineId = createDrawing(s, spline);
const knots = curveSegments("spline", spline.points);
assert.equal(knots.length, 3);
knots.forEach((segment, i) => {
  assert.deepEqual(segment[0], spline.points[i]);
  assert.deepEqual(segment[3], spline.points[i + 1]);
});
geometry = drawingGeometry(drawings(s.document));
const splineEntry = drawings(s.document).find((entry) => entry.id === splineId);
assert(geometry.bounds(splineEntry).y < 0, "bounds include spline overshoot");
assert(geometry.hit(splineEntry, p(50, -6.25), 0), "select spline overshoot");
assert(!geometry.hit(splineEntry, p(50, 40), 0));
const copies = duplicateDrawings(s, [id, splineId]);
assert.equal(copies.length, 2);
assert.deepEqual(
  drawings(s.document)
    .filter((e) => copies.includes(e.id))
    .map((e) => e.mark)
    .toSorted((a, b) => a.kind.localeCompare(b.kind)),
  [entry().mark, splineEntry.mark].toSorted((a, b) =>
    a.kind.localeCompare(b.kind),
  ),
  "both curve copies preserve their source marks regardless of document view order",
);
deleteDrawings(s, copies);
s.undo();
assert.equal(drawings(s.document).length, 4);
s.redo();
const opened = await stageWorkspaceFile(archive(s.native()));
assert.deepEqual(drawings(opened.document), drawings(s.document));
const store = canvasLocalStore(f.memoryBackend());
await store.load();
await store.save(s);
assert.deepEqual(drawings((await store.load()).document), drawings(s.document));
const arc = mark("arc", [p(150, 100), p(50, 100), p(100, 150)]);
const circle = circularArc(arc.points);
assert.ok(Math.abs(circle.radius - 50) < 1e-10);
assert.ok(
  Math.abs(circle.sweep + 1.5 * Math.PI) < 1e-10,
  "the through point selects the major arc",
);
assert.match(curvePath("arc", arc.points), / A[^ ]+ 0 1 0 100,150$/);
for (const entry of flattenCurve("arc", arc.points))
  assert.ok(Math.abs(Math.hypot(entry.x - 100, entry.y - 100) - 50) < 1e-9);
assert.equal(circularArc([p(0, 0), p(50, -50), p(100, 0)]).sweep, Math.PI);
for (const bad of [
  [p(0, 0), p(20, 0), p(50, 0)],
  [p(0, 0), p(20, 1), p(0, 0)],
  [p(0, 0), p(2, 1)],
  [p(0, 0), p(1000, 0.01), p(2000, 0)],
]) {
  assert.throws(
    () => validateMark(mark("arc", bad)),
    /three distinct, non-collinear/,
  );
}
assert.throws(() => curvedDrawingSchema.validate(arc), /@4/);
const arcId = createDrawing(s, arc, p(25, -10));
const arcEntry = drawings(s.document).find((e) => e.id === arcId);
assert.equal(f.current(s.document, arcId).schema, ARC_DRAWING);
geometry = drawingGeometry(drawings(s.document));
assert.ok(
  Math.abs(geometry.bounds(arcEntry).y - 40) < 1e-9,
  "bounds include an unclicked cardinal point",
);
assert(geometry.hit(arcEntry, p(125, 40), 0));
assert(!geometry.hit(arcEntry, p(125, 90), 0));
assert(
  !geometry.hit(arcEntry, p(160.355, 125.355), 0),
  "do not hit the complementary sweep",
);
const [arcEdit] = geometry.transform(
  new Set([arcId]),
  p(200, 200),
  true,
)(p(300, 200));
const resized = circularArc(arcEdit.mark.points);
assert.ok(Math.abs(resized.radius - 75) < 1e-9);
assert.ok(
  Math.abs(resized.sweep - circle.sweep) < 1e-9,
  "resize preserves circular proportions",
);
editDrawings(s, [arcEdit]);
s.undo();
assert.deepEqual(drawings(s.document).find((e) => e.id === arcId).mark, arc);
s.redo();
assert.deepEqual(
  drawings((await stageWorkspaceFile(archive(s.native()))).document),
  drawings(s.document),
);
const corners = [p(0, 0), p(90, 0), p(90, 90)];
for (const bad of [
  mark("polyline", [p(0, 0)]),
  mark("polygon", [p(0, 0), p(90, 0), p(30, 0)]),
  mark("polygon", [...corners, corners[0]]),
  mark("polyline", [corners[0], corners[0]]),
])
  assert.throws(() => validateMark(bad));
assert.throws(
  () => curvedDrawingSchema.validate(mark("polygon", corners)),
  /@5/,
);
const polygonId = createDrawing(s, mark("polygon", corners), p(300, 200));
const polylineId = createDrawing(s, mark("polyline", corners), p(300, 200));
geometry = drawingGeometry(drawings(s.document));
const polygon = geometry.byId.get(polygonId),
  polyline = geometry.byId.get(polylineId);
assert.equal(f.current(s.document, polygonId).schema, DRAFTING_DRAWING);
assert(
  geometry.hit(polygon, p(345, 245), 0),
  "Polygon's closing edge is selectable",
);
assert(!geometry.hit(polyline, p(345, 245), 0), "Open polyline does not close");
assert(
  !geometry.hit(polygon, p(375, 240), 0),
  "An outline doesn't claim its interior",
);
assert(
  geometry.sweptHit(polygon, p(342, 247), p(347, 242), 0),
  "Eraser crosses closing edge",
);
assert.deepEqual(
  drawings((await stageWorkspaceFile(archive(s.native()))).document),
  drawings(s.document),
);
console.log(
  "Drawing paths: Bézier, spline, circular arc and polygon geometry, transforms, history, native file and recovery passed",
);
