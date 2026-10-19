import assert from "node:assert/strict";
import {
  emptyScene,
  restoreScene,
  dockObjects,
  groupPlacements,
  detachMember,
  dockTarget,
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
console.log(
  "Canvas grouping, edge previews, detach and safe layout-only recovery passed.",
);
