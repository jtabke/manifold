import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import { alignSelection } from "../src/regions/alignment.ts";
import { documentKey, restoreMemory } from "../src/regions/workspaceMemory.ts";
const s = new RegionSession(),
  a = s.create();
s.write(a, "a := 2");
const camera = { x: 100, y: 200, zoom: 0.85 };
const memory = {
  version: 1,
  document: documentKey(s.state),
  camera,
  selected: a,
  selection: [a, "missing"],
  history: [{ camera }],
  cameras: { root: camera, removed: camera },
};
let resumed = restoreMemory(JSON.stringify(memory), s.state);
assert.equal(resumed.selected, a);
assert.deepEqual(resumed.selection, [a]);
assert.deepEqual(resumed.cameras, { root: camera });
const priorKey = documentKey(s.state);
s.move(a, { x: 300, y: 400 });
assert.equal(documentKey(s.state), priorKey);
assert.ok(restoreMemory(JSON.stringify(memory), s.state));
s.write(a, "a := 3");
assert.equal(restoreMemory(JSON.stringify(memory), s.state), undefined);
const validCurrent = { ...memory, document: documentKey(s.state) };
for (const patch of [
  { scope: "missing" },
  { camera: { ...camera, zoom: 99 } },
  { camera: { ...camera, x: Infinity } },
  { version: 4 },
]) {
  assert.equal(
    restoreMemory(JSON.stringify({ ...validCurrent, ...patch }), s.state),
    undefined,
  );
}
assert.equal(restoreMemory("invalid JSON", s.state), undefined);
const moving = { x: 104, y: 220, width: 200, height: 60 },
  other = { x: 100, y: 100, width: 200, height: 60 };
const snapshot = JSON.stringify([moving, other]);
assert.equal(alignSelection(moving, [other], 6).dx, -4);
assert.equal(alignSelection(moving, [other], 2).guides.length, 0);
assert.equal(
  alignSelection(moving, [{ ...other, y: 2000 }], 6).guides.length,
  0,
);
assert.equal(
  alignSelection(moving, [{ ...other, y: 500 }], 6).guides.length,
  0,
  "distant alignments stay quiet",
);
assert.equal(alignSelection(moving, [{ ...other, y: 500 }], 6, 500).dx, -4);
assert.equal(JSON.stringify([moving, other]), snapshot);
console.log(
  "Workspace memory validation, layout-independent identity and alignment contracts passed.",
);

// Each fresh canvas keeps its document, camera, title and arrangement independent.
const { workspaceStorage } = await import("../src/regions/workspaceStorage.ts");
const firstCanvas = "225aeedf-8b11-4d9e-8b83-54d65bb5a4e1";
const secondCanvas = "aa5b1088-66ef-4713-bc55-a115ae7e2643";
for (const key of ["document", "attention", "title", "scene"]) {
  const first = workspaceStorage(key, `?canvas=${firstCanvas}`);
  assert.notEqual(first, workspaceStorage(key, ""));
  assert.notEqual(first, workspaceStorage(key, `?canvas=${secondCanvas}`));
  assert.equal(
    first,
    workspaceStorage(key, `?canvas=${firstCanvas}&artifacts=1`),
  );
  assert.equal(workspaceStorage(key, "?canvas=../../invalid"), key);
}

const ordered = JSON.parse(JSON.stringify(s.state));
ordered.regions = ordered.regions.map((r) =>
  Object.fromEntries(Object.entries(r).reverse()),
);
assert.equal(documentKey(ordered), documentKey(s.state));
const stableMemory = {
  ...validCurrent,
  version: 2,
  document: s.document.document,
};
assert.ok(
  restoreMemory(JSON.stringify(stableMemory), ordered, [], s.document.document),
);
assert.equal(
  restoreMemory(
    JSON.stringify(stableMemory),
    ordered,
    [],
    "different-document",
  ),
  undefined,
);
