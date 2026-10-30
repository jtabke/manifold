import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import {
  SCROLL_SURFACE,
  attachCanvasViewport,
  canvasScroll,
  canvasOrigin,
  scrollCanvasTo,
  recenterCanvas,
} from "../src/regions/interaction/canvasViewport.ts";
import { RegionSession, semanticKey } from "../src/regions/document.ts";
import { archive, restore } from "../src/regions/artifacts.ts";
import { documentKey, restoreMemory } from "../src/regions/workspaceMemory.ts";
import { restoreScene } from "../src/regions/canvasScene.ts";
const world = { style: {} };
const node = {
  dataset: {},
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 1400,
  clientHeight: 900,
  querySelector: () => world,
  scrollTo(x, y) {
    const o = typeof x === "number" ? { left: x, top: y } : x;
    this.scrollLeft = Math.max(
      0,
      Math.min(SCROLL_SURFACE - this.clientWidth, o.left),
    );
    this.scrollTop = Math.max(
      0,
      Math.min(SCROLL_SURFACE - this.clientHeight, o.top),
    );
  },
};
attachCanvasViewport(node);
assert.deepEqual(canvasScroll(node), { x: 0, y: 0 });
for (const [x, y] of [
  [-500, -800],
  [1e8, -1e8],
  [-2e8, 3e8],
  [0, 0],
]) {
  scrollCanvasTo(node, { left: x, top: y });
  assert.deepEqual(canvasScroll(node), { x, y });
  assert.ok(Math.abs(canvasOrigin(node).x - node.scrollLeft + x) < 1e-8);
  assert.ok(Math.abs(canvasOrigin(node).y - node.scrollTop + y) < 1e-8);
}
node.scrollTo(0, 0);
const before = canvasScroll(node);
recenterCanvas(node);
assert.deepEqual(
  canvasScroll(node),
  before,
  "Native edge recentering is visually invariant",
);
assert.ok(node.scrollLeft > 10000 && node.scrollTop > 10000);
const session = new RegionSession();
const id = session.create({ x: -1200, y: -900 });
session.write(id, "load := 12 N");
const key = semanticKey(session.state);
assert.deepEqual(
  restore(legacyWorkspace(session.state, [])).page,
  session.state,
);
const memory = {
  version: 1,
  document: documentKey(session.state),
  camera: { x: -2200, y: -1900, zoom: 0.8 },
  selection: [],
  cameras: { root: { x: -100, y: -200, zoom: 1 } },
  history: [],
};
assert.deepEqual(
  restoreMemory(JSON.stringify(memory), session.state).camera,
  memory.camera,
);
assert.equal(semanticKey(session.state), key);
const scene = {
  version: 1,
  groups: [],
  tools: [],
  viewpoints: [
    {
      id: "negative-view",
      name: "Negative world",
      positions: {},
      groups: [],
      tools: [],
      camera: { x: -500, y: -600, zoom: 1 },
      closed: [],
      pins: {},
    },
  ],
};
assert.equal(restoreScene(JSON.stringify(scene)).viewpoints[0].camera.x, -500);
console.log(
  "Signed cameras recenter past browser limits without shifting world content; negative authored positions, saved attention and viewpoints round-trip.",
);
