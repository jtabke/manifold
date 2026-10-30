import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  proposeValue,
  previewPage,
  variationRange,
  boundedValue,
} from "../src/regions/exploration.ts";

const session = new RegionSession();
const add = (text) => {
  const id = session.create();
  assert.equal(session.write(id, text).ok, true);
  return id;
};
const power = add("P = F*v");
const force = add("F = 20 N");
add("v = 3 m/s");
const limit = add("P <= 75 W");
const original = session.state;
const proposal = proposeValue(original, force, 30);
assert.equal(
  proposeValue(original, force, 20).text,
  "F = 20 N",
  "opening Vary preserves the accepted definition exactly",
);
const preview = previewPage(original, proposal);
assert.equal(project(original).solved.values.get("P").value, 60);
assert.equal(project(preview).solved.values.get("P").value, 90);
assert.equal(project(original).solved.constraints.get(limit).pass, true);
assert.equal(project(preview).solved.constraints.get(limit).pass, false);
assert.equal(session.state, original);
const moved = new RegionSession(original);
moved.move(force, { x: 400, y: -250 });
assert.equal(
  project(previewPage(moved.state, proposal)).solved.values.get("P").value,
  90,
  "moving a representation preserves the same engineering proposal",
);
assert.deepEqual(moved.state.contexts, original.contexts);
moved.dispose();

assert.deepEqual(
  session.receipts
    .map((r) => r.values.P?.value)
    .filter(Boolean)
    .at(-1),
  60,
);
const id = session.branchValue(force, proposal.text);
assert.equal(session.state.active, id);
assert.equal(project(session.state).solved.values.get("P").value, 90);
assert.equal(
  project({ ...session.state, active: "original" }).solved.values.get("P")
    .value,
  60,
);
assert.equal(session.state.regions.find((r) => r.id === power).text, "P = F*v");
session.undo();
assert.deepEqual(
  session.state,
  original,
  "one Undo removes the alternative and restores the baseline",
);
assert.throws(() => session.branchValue(force, "F = 1 m"), /dimension/);
assert.equal(
  session.state,
  original,
  "invalid alternative publishes no partial context",
);

const reciprocal = add("R = 1/F");
const beforeInvalid = session.state;
assert.throws(
  () => session.branchValue(force, "F = 0 N"),
  /affected calculation/,
);
assert.equal(session.state, beforeInvalid);
assert.ok(project(session.state).solved.values.get("R"));
assert.equal(
  previewPage(session.state, proposal),
  session.state,
  "stale previews cannot apply after a model edit",
);
assert.equal(
  previewPage({ ...original, active: "other" }, proposal).active,
  "other",
);

const q = project(original).solved.values.get("F");
const range = variationRange(q);
assert.equal(range.step, 0.2);
assert.equal(boundedValue(1000, range), range.high);
assert.equal(boundedValue(-1000, range), range.low);
for (const bad of [
  { ...range, step: 0 },
  { ...range, low: range.high },
  { ...range, high: Infinity },
])
  assert.throws(() => boundedValue(20, bad));
assert.throws(() => boundedValue(NaN, range));
const temperature = add("T = 20 degC");
const temperatureQ = project(session.state).solved.values.get("T");
assert.ok(temperatureQ?.absolute);
const warmer = proposeValue(session.state, temperature, temperatureQ.value + 5);
assert.equal(
  project(previewPage(session.state, warmer)).solved.values.get("T").value,
  298.15,
);
assert.ok(Math.abs(variationRange(temperatureQ).step - 0.2) < 1e-10);
console.log(
  "Exploration: transient linked values and requirements, atomic alternative/Undo, invalid and stale recovery, finite bounds and affine units pass.",
);
