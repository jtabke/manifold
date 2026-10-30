import assert from "node:assert/strict";
import {
  framesAtPoint,
  nextOverlap,
  overlapPoint,
} from "../src/regions/overlap.ts";
import {
  emptyScene,
  restoreScene,
  dockObjects,
  groupPlacements,
  detachMember,
  dockTarget,
  planDock,
  planDetach,
} from "../src/regions/canvasScene.ts";
const frames = [
  { id: "region-1", kind: "region", x: 100, y: 100, width: 500, height: 70 },
  { id: "artifact-1", kind: "plot", x: 650, y: 120, width: 600, height: 410 },
  { id: "tool-1", kind: "plot", x: 650, y: 600, width: 480, height: 260 },
];
let scene = emptyScene();
scene.groups = dockObjects(scene.groups, "tool-1", "artifact-1", "stack");
assert.deepEqual(scene.groups[0].members, ["artifact-1", "tool-1"]);
assert.deepEqual(groupPlacements(scene.groups[0], frames)["tool-1"], {
  x: 650,
  y: 554,
});
scene.groups = dockObjects(scene.groups, "region-1", "artifact-1", "row");
assert.equal(scene.groups.length, 1);
assert.equal(scene.groups[0].members.length, 3);
assert.equal(detachMember(scene.groups, "tool-1")[0].members.length, 2);
assert.equal(
  dockTarget("tool-1", { x: 900, y: 540 }, frames, []).layout,
  "stack",
);
// Docking anchors the target, not the moving object's bounding box.
const retainedFrames = JSON.stringify(frames);
const proposed = planDock([], "region-1", "artifact-1", "row", frames);
assert.deepEqual(proposed.placements["artifact-1"], { x: 650, y: 120 });
assert.deepEqual(proposed.placements["region-1"], { x: 1274, y: 120 });
assert.equal(proposed.destinations.length, 2);
assert.equal(JSON.stringify(frames), retainedFrames);
assert.equal(planDock([], "region-1", "missing", "row", frames), undefined);
const existing = [
  {
    id: "target-group",
    name: "Target",
    members: ["artifact-1", "tool-1"],
    layout: "stack",
    auto: true,
  },
];
const mergedPlan = planDock(existing, "region-1", "artifact-1", "row", frames);
assert.equal(mergedPlan.groups[0].id, "target-group");
assert.equal(mergedPlan.destinations.length, 3);
assert.deepEqual(mergedPlan.placements["tool-1"], { x: 1274, y: 120 });
assert.deepEqual(mergedPlan.placements["region-1"], { x: 1778, y: 120 });
const peers = [
  ...["a", "b", "c"].map((id, index) => ({
    id,
    kind: "region",
    x: index * 184,
    y: 0,
    width: 100,
    height: 50,
  })),
  { id: "target", kind: "plot", x: 1000, y: 100, width: 300, height: 200 },
];
const sourceGroups = [
  {
    id: "source-group",
    name: "Source",
    members: ["a", "b", "c"],
    layout: "row",
    auto: true,
  },
];
const departure = planDetach(sourceGroups, ["b"], peers);
assert.deepEqual(departure.placements.c, { x: 184, y: 0 });
assert.equal(departure.destinations.length, 2);
assert.deepEqual(departure.groups[0].members, ["a", "c"]);
const dissolve = planDetach(sourceGroups, ["a", "b"], peers);
assert.equal(dissolve.groups.length, 0);
assert.deepEqual(dissolve.placements.c, { x: 368, y: 0 });
assert.equal(
  planDetach(
    sourceGroups,
    ["b"],
    peers.filter((f) => f.id !== "c"),
  ),
  undefined,
);
const intact = planDetach(sourceGroups, ["a", "b", "c"], peers);
assert.deepEqual(intact.groups, sourceGroups);
assert.equal(intact.destinations.length, 0);
const split = planDock(sourceGroups, "b", "target", "stack", peers);
assert.equal(
  split.destinations.length,
  4,
  "preview includes compaction of the source's remaining group",
);
assert.deepEqual(split.placements.c, { x: 184, y: 0 });
assert.deepEqual(split.placements.b, { x: 1000, y: 324 });
assert.deepEqual(split.groups.find((g) => g.id === "source-group").members, [
  "a",
  "c",
]);
const whole = planDock(
  sourceGroups,
  "source-group",
  "target",
  "row",
  peers,
  true,
);
assert.equal(whole.destinations.length, 4);
assert.equal(whole.groups.length, 1);
assert.deepEqual(whole.placements.c, { x: 1692, y: 100 });
assert.equal(planDock(sourceGroups, "a", "b", "row", peers), undefined);
const ownNames = planDock([], "constructor", "__proto__", "row", [
  { ...peers[0], id: "constructor" },
  { ...peers[3], id: "__proto__" },
]);
assert.equal(Object.hasOwn(ownNames.placements, "__proto__"), true);
assert.deepEqual(ownNames.placements.constructor, { x: 1324, y: 100 });
const round = restoreScene(JSON.stringify(scene));
assert.deepEqual(round, scene);
const overview = {
  ...scene,
  viewpoints: [
    {
      id: "viewpoint-model",
      name: "Model overview",
      camera: { x: 0, y: 0, zoom: 0.2 },
      positions: {},
      groups: [],
      tools: [],
    },
  ],
};
assert.deepEqual(restoreScene(JSON.stringify(overview)), overview);
assert.throws(() =>
  restoreScene(
    JSON.stringify({
      ...overview,
      viewpoints: [
        { ...overview.viewpoints[0], camera: { x: 0, y: 0, zoom: 0 } },
      ],
    }),
  ),
);
assert.throws(() =>
  restoreScene(
    JSON.stringify({ ...scene, groups: [...scene.groups, scene.groups[0]] }),
  ),
);
assert.throws(() =>
  restoreScene(
    JSON.stringify({
      ...scene,
      tools: [
        {
          id: "tool-1",
          editor: "python",
          object: "region-1",
          at: { x: 0, y: 0 },
          width: 1,
          height: 0,
        },
      ],
    }),
  ),
);
const overlapping = [
  frames[0],
  { ...frames[1], x: 200, y: 110 },
  { ...frames[2], x: 200, y: 110 },
];
assert.deepEqual(
  framesAtPoint(overlapping, { x: 250, y: 120 }).map((f) => f.id),
  overlapping.map((f) => f.id),
);
assert.equal(framesAtPoint(overlapping, { x: -1, y: -1 }).length, 0);
const hit = overlapPoint(overlapping[0], overlapping);
assert.equal(framesAtPoint(overlapping, hit).length, 3);
assert.deepEqual(overlapPoint(frames[0], [frames[0]]), { x: 350, y: 135 });
assert.equal(nextOverlap(["a", "b", "c"], "a"), "b");
assert.equal(nextOverlap(["a", "b", "c"], "c"), "a");
assert.equal(nextOverlap(["a"]), undefined);
console.log(
  "Canvas grouping, docking, overlap hit footprints/cycling and safe layout-only recovery passed.",
);
