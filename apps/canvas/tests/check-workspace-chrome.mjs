import assert from "node:assert/strict";
import {
  defaultChrome,
  movePanel,
  panelSide,
  restoreChrome,
} from "../src/regions/workspaceChrome.ts";
const original = defaultChrome();
let layout = movePanel(original, "relationships", "left");
assert.deepEqual(original, defaultChrome());
layout = movePanel(layout, "response", "left");
assert.deepEqual(layout.groups.left.tabs, ["relationships", "response"]);
assert.equal(layout.groups.left.active, "response");
layout.groups.right.collapsed = true;
layout = movePanel(layout, "response", "right");
assert.deepEqual(layout.groups.left.tabs, ["relationships"]);
assert.equal(layout.groups.left.active, "relationships");
assert.equal(layout.groups.right.collapsed, false);
assert.equal(panelSide(layout, "response"), "right");
layout = movePanel(layout, "response");
assert.equal(panelSide(layout, "response"), undefined);
assert.equal(layout.groups.right.active, undefined);
const preferences = {
  version: 1,
  layout,
  presets: [{ name: "Analysis", layout: defaultChrome() }],
};
assert.deepEqual(restoreChrome(JSON.stringify(preferences)), preferences);
for (const mutate of [
  (p) => {
    p.version = 2;
  },
  (p) => {
    p.layout.toolbar = "floating";
  },
  (p) => {
    p.layout.groups.left.size = 9000;
  },
  (p) => {
    p.layout.groups.left.active = "assistant";
  },
  (p) => {
    p.layout.groups.left.tabs = ["constructor"];
  },
  (p) => {
    p.layout.groups.right.tabs = ["relationships"];
    p.layout.groups.right.active = "relationships";
  },
  (p) => {
    p.presets.push(p.presets[0]);
  },
  (p) => {
    p.presets[0].layout.groups.bottom.size = null;
  },
]) {
  const next = structuredClone(preferences);
  mutate(next);
  assert.throws(() => restoreChrome(JSON.stringify(next)));
}
assert.throws(() => restoreChrome(" ".repeat(30001)));
console.log(
  "Workspace chrome: immutable docking, unique tabs, active-tab repair, preset roundtrip and bounded validation pass.",
);
