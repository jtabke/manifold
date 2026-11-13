import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  createDrawing,
  drawings,
  editDrawings,
  deleteDrawings,
  duplicateDrawings,
  DRAWING,
  MAX_STROKE_POINTS,
  MAX_LABEL_LENGTH,
  validateMark,
} from "../src/regions/drawing.ts";
import {
  drawingGeometry,
  previewDrawings,
  pointBounds,
  constrain,
} from "../src/regions/drawingGeometry.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  duplicateSelection,
  deleteSelection,
  positionDrawings,
} from "../src/regions/selectionOperations.ts";
const p = (x, y, pressure = 0.5) => ({ x, y, pressure });
const mark = (kind = "rectangle") => ({
  kind,
  color: "#374151",
  width: 3,
  points: [p(0, 0), p(120, 80)],
  text: "",
  start: null,
  end: null,
});
// The schema and gesture/editor boundaries must share the same portable limits.
assert.equal(MAX_STROKE_POINTS, 8192);
assert.equal(MAX_LABEL_LENGTH, 4096);
for (const value of [
  {
    ...mark("pen"),
    points: Array.from({ length: MAX_STROKE_POINTS }, () => p(0, 0)),
  },
  { ...mark("text"), text: "x".repeat(MAX_LABEL_LENGTH) },
]) {
  validateMark(value);
  const beyond =
    value.kind === "pen"
      ? { ...value, points: [...value.points, p(0, 0)] }
      : { ...value, text: value.text + "x" };
  assert.throws(() => validateMark(beyond), /supports|support/);
}
const s = new RegionSession();
const a = createDrawing(s, mark(), { x: -150, y: 70 });
const b = createDrawing(s, mark("ellipse"), { x: 300, y: 70 });
const connector = createDrawing(s, {
  ...mark("connector"),
  start: { target: f.reference(s.document.document, a), u: 1, v: 0.5 },
  end: { target: f.reference(s.document.document, b), u: 0, v: 0.5 },
});
const entry = (id) => drawings(s.document).find((e) => e.id === id);
assert.deepEqual(
  drawingGeometry(drawings(s.document))
    .points(entry(connector))
    .map(({ x, y }) => ({
      x,
      y,
    })),
  [
    { x: -30, y: 110 },
    { x: 300, y: 110 },
  ],
);
const initial = drawings(s.document),
  geometry = drawingGeometry(initial);
assert.equal(drawingGeometry(initial), geometry);
const originalA = entry(a),
  originalPoints = geometry.points(originalA);
assert.equal(
  geometry.points(originalA),
  originalPoints,
  "geometry is cached by immutable entry",
);
assert.deepEqual(geometry.bounds(entry(connector)), {
  x: -30,
  y: 110,
  width: 330,
  height: 1,
});
assert.equal(
  geometry.hit(entry(b), p(301, 71), 0),
  false,
  "ellipse corners are not painted shape interiors",
);
assert.equal(
  geometry.sweptHit(entry(connector), p(100, 80), p(100, 130), 0),
  true,
  "sweeps resolve attached connector endpoints, not stored fallback points",
);
assert.equal(
  geometry.sweptHit(entry(connector), p(100, 20), p(100, 50), 0),
  false,
);
// Bounds-only reads must preserve the old world-coordinate arithmetic without allocating points.
for (const [points, offset] of [
  [[p(-4, 10), p(6, -2)], { x: 0, y: 0 }],
  [[p(0.1, -0.2), p(0.2, 0.1)], { x: 1e16, y: -1e16 }],
  [[p(-0, -0), p(0, 0)], { x: -0, y: -0 }],
  [[p(Number.MAX_VALUE, 0), p(0, 1)], { x: Number.MAX_VALUE, y: 0 }],
  [[p(1e20, -1e20), p(1e20 + 16384, -1e20 + 16384)], { x: -1e20, y: 1e20 }],
]) {
  const sample = f.freeze({
    ...originalA,
    mark: { ...originalA.mark, kind: "pen", points },
    view: { ...originalA.view, ...offset },
  });
  const scene = drawingGeometry([sample]),
    expected = pointBounds(
      points.map((point) => ({
        ...point,
        x: point.x + offset.x,
        y: point.y + offset.y,
      })),
    );
  const freeze = Object.freeze;
  const inheritedPoints = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "points",
  );
  let pointFreezes = 0,
    cachedBounds,
    full;
  Object.freeze = (value) => {
    if (value && Object.hasOwn(value, "pressure")) pointFreezes++;
    return freeze(value);
  };
  try {
    cachedBounds = scene.bounds(sample);
    assert.equal(
      pointFreezes,
      0,
      "bounds-only queries must not clone/freeze any stroke points",
    );
    assert.deepEqual(cachedBounds, expected);
    assert.equal(scene.bounds(sample), cachedBounds);
    const otherScene = drawingGeometry([sample]);
    assert.equal(otherScene.bounds(sample), cachedBounds);
    Object.defineProperty(Object.prototype, "points", {
      value: [],
      configurable: true,
      writable: true,
    });
    full = otherScene.geometry(sample);
    assert.equal(
      scene.geometry(sample),
      full,
      "cache upgrades are shared across scenes",
    );
    assert.equal(scene.bounds(sample), cachedBounds);
    assert.equal(
      pointFreezes,
      points.length,
      "actual geometry still materializes owned absolute points",
    );
  } finally {
    Object.freeze = freeze;
    if (inheritedPoints)
      Object.defineProperty(Object.prototype, "points", inheritedPoints);
    else delete Object.prototype.points;
  }
  assert.equal(full.bounds, cachedBounds);
  assert.deepEqual(
    full.points,
    points.map((point) => ({
      ...point,
      x: point.x + offset.x,
      y: point.y + offset.y,
    })),
  );
  assert(
    Object.isFrozen(cachedBounds) &&
      Object.isFrozen(full) &&
      Object.isFrozen(full.points),
  );
  assert.notEqual(full.points, points);
}
const eraserSession = new RegionSession();
for (const kind of [
  "pen",
  "highlighter",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "text",
  "connector",
]) {
  const id = createDrawing(
    eraserSession,
    {
      ...mark(kind),
      points: [p(0, 0), p(10, 10)],
      text: kind === "text" ? "Label" : "",
    },
    { x: -100, y: -100 },
  );
  const all = drawings(eraserSession.document),
    scene = drawingGeometry(all),
    e = all.find((e) => e.id === id);
  const from = p(-150, -95),
    to = p(-50, -95);
  assert.equal(scene.hit(e, from, 0), false);
  assert.equal(scene.hit(e, to, 0), false);
  assert.equal(
    scene.sweptHit(e, from, to, 0),
    true,
    `${kind}: sparse input must not skip a crossed mark`,
  );
  assert.equal(
    scene.sweptHit(e, to, from, 0),
    true,
    `${kind}: sweep direction is symmetric`,
  );
  assert.equal(
    scene.sweptHit(e, p(-200, -50), p(-50, -200), 0),
    false,
    `${kind}: overlapping bounding boxes alone are insufficient`,
  );
  assert.equal(
    scene.sweptHit(e, from, from, 0),
    scene.hit(e, from, 0),
    `${kind}: stationary samples retain point-hit semantics`,
  );
  for (let i = 0; i < 40; i++) {
    const a = p(-120 + i, -110 + Math.sin(i) * 25),
      b = p(-90 + Math.cos(i) * 25, -120 + i);
    const swept = scene.sweptHit(e, a, b, 2);
    assert.equal(swept, scene.sweptHit(e, b, a, 2));
    const sampled = Array.from({ length: 65 }, (_, j) =>
      p(a.x + ((b.x - a.x) * j) / 64, a.y + ((b.y - a.y) * j) / 64),
    ).some((p) => scene.hit(e, p, 2));
    assert(
      swept || !sampled,
      `${kind}: analytic sweep must include every dense point-hit witness`,
    );
  }
}
const ellipse = drawings(eraserSession.document).find(
  (e) => e.mark.kind === "ellipse",
);
assert.equal(
  drawingGeometry(drawings(eraserSession.document)).sweptHit(
    ellipse,
    p(-110, -92),
    p(-92, -110),
    0,
  ),
  false,
  "ellipse corner near-misses are not erased",
);
eraserSession.dispose();
const ids = new Set([a, b, connector]);
const movedPreview = previewDrawings(
  initial,
  geometry.transform(ids, p(0, 0), false)(p(20, -30)),
);
assert.equal(
  drawingGeometry(movedPreview).points(
    movedPreview.find((e) => e.id === connector),
  )[0].y,
  80,
);
assert.equal(
  geometry.points(entry(connector))[0].y,
  110,
  "transform preview leaves accepted geometry intact",
);
const detached = geometry.transform(
  new Set([connector]),
  p(0, 0),
  false,
)(p(10, 20));
assert.equal(
  detached[0].entry,
  entry(connector),
  "edits retain their authored source for stale guards",
);
assert.equal(detached[0].mark.start, null);
// Moving and deleting must rebase the same resolved endpoints, including nonzero view offsets.
const offsetConnector = {
  ...entry(connector),
  view: { ...entry(connector).view, x: 35, y: -25 },
};
const offsetEntries = initial.map((e) =>
  e.id === connector ? offsetConnector : e,
);
const offsetScene = drawingGeometry(offsetEntries);
for (const removed of [
  undefined,
  new Set([a]),
  new Set([b]),
  new Set([a, b]),
]) {
  const mark = offsetScene.detachedMark(offsetConnector, removed);
  assert.equal(
    mark.start,
    removed && !removed.has(a) ? offsetConnector.mark.start : null,
  );
  assert.equal(
    mark.end,
    removed && !removed.has(b) ? offsetConnector.mark.end : null,
  );
  const resolved = previewDrawings(offsetEntries, [
    { entry: offsetConnector, mark },
  ]);
  assert.deepEqual(
    drawingGeometry(resolved).points(resolved.find((e) => e.id === connector)),
    offsetScene.points(offsetConnector),
    "detaching preserves world endpoints before the subsequent move",
  );
}
assert.equal(offsetConnector.mark, entry(connector).mark);
assert.deepEqual(pointBounds([p(-4, 10), p(6, -2)]), {
  x: -4,
  y: -2,
  width: 10,
  height: 12,
});
assert.deepEqual(constrain(p(0, 0), p(-3, 6), "rectangle"), p(-6, 6));
assert.equal(constrain(p(0, 0), p(20, 3), "line").y, 0);
const unchanged = s.document;
editDrawings(s, [
  {
    entry: entry(a),
    mark: structuredClone(entry(a).mark),
    at: { x: -150, y: 70 },
  },
]);
assert.equal(
  s.document,
  unchanged,
  "no-op edits allocate no revision or Undo step",
);
let notices = 0;
const off = s.subscribe(() => notices++);
editDrawings(s, [
  { entry: entry(a), at: { x: -100, y: 150 } },
  { entry: entry(b), at: { x: 350, y: 150 } },
]);
assert.equal(notices, 1, "multi-selection move publishes once");
const movedDocument = s.document;
assert.throws(
  () => editDrawings(s, [{ entry: originalA, at: { x: 1, y: 2 } }]),
  /Drawing changed/,
);
assert.equal(
  s.document,
  movedDocument,
  "a stale entry cannot be paired with a newer expected root",
);
s.undo();
assert.equal(drawingGeometry(drawings(s.document)).bounds(entry(a)).x, -150);
assert(s.canRedo);
s.redo();
assert.equal(drawingGeometry(drawings(s.document)).bounds(entry(a)).x, -100);
s.undo();
const before = s.document;
assert.throws(
  () => createDrawing(s, { ...mark(), points: [p(Infinity, 0), p(1, 1)] }),
  /point/,
);
assert.equal(s.document, before, "invalid input is atomic");
assert.throws(
  () => createDrawing(s, { ...mark(), unexpected: true }),
  /field/i,
);
assert.equal(s.document, before);
const stale = s.document;
const ink = createDrawing(s, {
  ...mark("pen"),
  points: [p(1, 2, 0.1), p(20, 30, 0.9), p(42, 10, 0.3)],
});
assert.throws(
  () => editDrawings(s, [{ entry: entry(a), at: { x: 9, y: 9 } }], stale),
  /changed|stale/i,
);
assert.equal(
  entry(a),
  originalA,
  "unchanged entries survive unrelated accepted edits",
);
assert.equal(
  drawingGeometry(drawings(s.document)).points(entry(a)),
  originalPoints,
  "unrelated edits reuse geometry without traversing the stroke again",
);
for (const invalid of [
  { width: 0 },
  { text: "x".repeat(4097) },
  { points: Array.from({ length: 8193 }, () => p(0, 0)) },
  { points: [p(0, 0, 2)] },
]) {
  const root = s.document;
  assert.throws(() => createDrawing(s, { ...mark("pen"), ...invalid }));
  assert.equal(s.document, root);
}
for (const kind of ["highlighter", "line", "arrow"])
  createDrawing(s, mark(kind));
createDrawing(s, {
  ...mark("text"),
  text: "Load <script>not markup</script>\nF = 20 N",
});
const prior = drawings(s.document);
deleteDrawings(s, [a]);
assert.equal(entry(connector).mark.start, null);
assert.equal(entry(connector).mark.end.target.item, b);
assert.equal(
  drawingGeometry(drawings(s.document)).points(entry(connector))[0].x,
  -30,
  "shape deletion detaches connector at its visible endpoint",
);
s.undo();
assert.deepEqual(
  drawings(s.document),
  prior,
  "one Undo restores shape and attachments",
);
notices = 0;
const apply = s.applyCommands;
let batches = 0,
  copies;
s.applyCommands = function (...args) {
  batches++;
  return apply.apply(this, args);
};
try {
  copies = duplicateDrawings(s, [a, b, connector]);
} finally {
  s.applyCommands = apply;
}
assert.equal(
  batches,
  1,
  "diagram duplication lowers one complete batch without staged per-mark owners",
);
assert.equal(notices, 1);
const copiedConnector = copies
  .map(entry)
  .find((e) => e.mark.kind === "connector");
assert(copies.includes(copiedConnector.mark.start.target.item));
assert(copies.includes(copiedConnector.mark.end.target.item));
s.undo();
assert.equal(drawings(s.document).length, prior.length);
s.redo();
assert.equal(drawings(s.document).length, prior.length + 3);
s.undo();
const nonShape = f.reference(s.document.document, ink);
assert.throws(
  () =>
    createDrawing(s, {
      ...mark("connector"),
      start: { target: nonShape, u: 0.5, v: 0.5 },
    }),
  /shapes/,
);
assert.equal(drawings(s.document).length, prior.length);
const opened = await stageWorkspaceFile(archive(s.native()));
assert.deepEqual(drawings(opened.document), drawings(s.document));
assert.deepEqual(
  entry(ink).mark.points.map((p) => p.pressure),
  [0.1, 0.9, 0.3],
);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(s);
const loaded = await store.load();
const recovered = new RegionSession(
  loaded.page,
  () => [],
  loaded.document,
  loaded.artifacts,
  false,
  loaded.recovery,
);
assert.deepEqual(drawings(recovered.document), drawings(s.document));
assert.equal((await store.save(recovered)).writes.chunks, 0);
assert.equal(
  [...s.document.items.entries()].filter(
    ([, item]) => s.document.revisions.get(item.revision)?.schema === DRAWING,
  ).length,
  prior.length,
);
assert.equal(s.canRedo, true, "rejected edits preserve Redo");
createDrawing(s, mark("line"));
assert.equal(s.canRedo, false, "a new accepted edit clears the redo branch");
off();
// Mixed selections share one publication/history boundary without rebinding engineering definitions.
const mixed = new RegionSession();
const input = mixed.create({ x: 100, y: 100 });
assert.equal(mixed.write(input, "force = 20 N").ok, true);
const output = mixed.create({ x: 100, y: 200 });
assert.equal(mixed.write(output, "work = force * 2 m").ok, true);
const doodle = createDrawing(mixed, mark(), { x: 400, y: 100 });
const mixedPage = structuredClone(mixed.state),
  mixedMarks = drawings(mixed.document);
const assertMixed = () => {
  assert.deepEqual(mixed.state, mixedPage);
  assert.deepEqual(drawings(mixed.document), mixedMarks);
};
let publications = 0;
const stopMixed = mixed.subscribe(() => publications++);
const mixedCopies = duplicateSelection(mixed, [input, output, doodle], {
  [input]: { x: 100, y: 100 },
  [output]: { x: 100, y: 200 },
});
assert.equal(publications, 1);
assert.equal(mixedCopies.length, 3);
assert(mixed.state.regions.some((r) => r.text === "force_copy = 20 N"));
assert(
  mixed.state.regions.some((r) => r.text === "work_copy = force_copy * 2 m"),
);
assert.equal(mixed.state.links?.[mixedCopies[1]]?.force_copy, mixedCopies[0]);
mixed.undo();
assertMixed();
const beforeRejected = mixed.document;
assert.throws(() => deleteSelection(mixed, [input, doodle]), /depend/);
assert.equal(
  mixed.document,
  beforeRejected,
  "Rejected mixed deletion publishes nothing",
);
publications = 0;
deleteSelection(mixed, [input, output, doodle]);
assert.equal(publications, 1);
assert.equal(mixed.state.regions.length, 0);
assert.equal(drawings(mixed.document).length, 0);
mixed.undo();
assertMixed();
const beforePosition = drawings(mixed.document)[0];
mixed.atomic((staged) => {
  positionDrawings(staged, { [doodle]: { x: 430, y: 140 } });
  staged.arrange({ [input]: { x: 130, y: 140 } });
});
assert.deepEqual(drawings(mixed.document)[0].mark, beforePosition.mark);
assert.deepEqual(
  {
    x: drawings(mixed.document)[0].view.x,
    y: drawings(mixed.document)[0].view.y,
  },
  { x: 430, y: 140 },
);
mixed.undo();
assertMixed();
mixed.setScene((scene) => ({
  ...scene,
  groups: [
    {
      id: "group-mixed",
      name: "Mixed",
      members: [input, doodle],
      layout: "stack",
      auto: false,
    },
  ],
}));
const mixedOpened = await stageWorkspaceFile(archive(mixed.native()));
assert.deepEqual(mixedOpened.scene.groups[0].members, [input, doodle]);
assert.equal(drawings(mixedOpened.document).length, 1);
deleteSelection(mixed, [input, output, doodle]);
assert.equal(mixed.scene.groups.length, 0);
mixed.undo();
assert.equal(mixed.scene.groups.length, 1);
stopMixed();
for (const owner of [s, opened, recovered, mixed, mixedOpened]) owner.dispose();
console.log(
  "Drawing: typed marks, pressure, atomic move/delete/duplicate/Undo/Redo, attached connectors, stale rejection and native/local round trips pass.",
);
