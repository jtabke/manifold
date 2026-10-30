import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import {
  RegionSession,
  project,
  semanticKey,
  positions,
} from "../src/regions/document.ts";
import {
  modelBoundary,
  modelParent,
  modelPath,
  validateModels,
} from "../src/regions/models.ts";
import { archive, restore } from "../src/regions/artifacts.ts";
import { planConnection } from "../src/regions/linking.ts";
const s = new RegionSession(),
  add = (t) => {
    const id = s.create();
    assert.ok(s.write(id, t).ok);
    return id;
  };
const q = add("loss := 800 W"),
  a = add("area := 0.2 m^2"),
  h = add("convection := 60 W/(m^2*K)"),
  ambient = add("ambient := 25 °C"),
  t = add("temperature = ambient+loss/(convection*area)"),
  req = add("temperature <= 100 °C");
const csv = s.importData("tests.csv", "force [N],speed [m/s]\n20,3\n24,4", {
  x: 800,
  y: 300,
});
const note = add("An assumed steady-state thermal balance."),
  plot = s.addPlot(t, a);
const members = [a, h, ambient, t, note, plot, csv],
  before = structuredClone(s.state),
  values = [...project(s.state).solved.values],
  key = semanticKey(s.state),
  layout = positions(s.state);
const boundary = modelBoundary(s.state, members);
assert.ok(boundary.requiredInputs.includes(q));
assert.ok(boundary.requiredOutputs.includes(t));
s.makeModel(
  {
    id: "model-thermal",
    name: "Thermal balance",
    members,
    inputs: [q, a, h, ambient],
    outputs: [t],
  },
  { x: 110, y: 110 },
);
assert.equal(semanticKey(s.state), key);
assert.deepEqual([...project(s.state).solved.values], values);
assert.deepEqual(s.state.regions, before.regions);
assert.deepEqual(positions(s.state), layout);
assert.equal(modelParent(s.state, t), "model-thermal");
const created = structuredClone(s.state);
s.undo();
assert.deepEqual(s.state, before);
s.makeModel(created.models[0], created.layout["model-thermal"]);
const inner = s.create({ x: 200, y: 800 }, "model-thermal");
s.write(inner, "margin = 100 °C-temperature", true);
assert.equal(modelParent(s.state, inner), "model-thermal");
// A second level uses the same IDs, not copies.
s.makeModel(
  {
    id: "model-balance",
    name: "Calculation",
    members: [t],
    inputs: [q, a, h, ambient],
    outputs: [t],
  },
  { x: 100, y: 100 },
);
assert.deepEqual(
  modelPath(s.state, "model-balance").map((m) => m.id),
  ["model-thermal", "model-balance"],
);
s.write(a, "area := 0.25 m^2");
assert.ok(
  Math.abs(
    project(s.state).solved.values.get("temperature").value -
      (273.15 + 78.333333333),
  ) < 1e-6,
);
assert.equal(project(s.state).solved.constraints.get(req).pass, true);
const data = restore(legacyWorkspace(s.state, []));
assert.deepEqual(data.page.models, s.state.models);
assert.deepEqual(
  [...project(data.page).solved.values],
  [...project(s.state).solved.values],
);
const cyclic = structuredClone(s.state);
cyclic.models[1].members.push("model-thermal");
assert.throws(() => validateModels(cyclic), /cycle/);
const doubled = structuredClone(s.state);
doubled.models[0].members.push(t);
assert.throws(() => validateModels(doubled), /one model/);
const broken = structuredClone(s.state);
broken.models[0].inputs.push("region-missing");
assert.throws(() => restore(legacyWorkspace(broken, [])), /references/);
// Grouping and navigating do not link independently authored assumptions.
const source = add("supply := 20 W"),
  target = add("load := 10 W");
s.makeModel(
  {
    id: "model-source",
    name: "Source",
    members: [source],
    inputs: [],
    outputs: [source],
  },
  { x: 600, y: 100 },
);
s.makeModel(
  {
    id: "model-target",
    name: "Target",
    members: [target],
    inputs: [target],
    outputs: [target],
  },
  { x: 1000, y: 100 },
);
assert.equal(project(s.state).solved.values.get("load").value, 10);
const proposal = planConnection(s.state, source, target);
assert.equal(project(s.state).solved.values.get("load").value, 10);
assert.ok(s.connect(proposal).ok);
assert.equal(project(s.state).solved.values.get("load").value, 20);
assert.equal(s.state.links[target].supply, source);
assert.ok(modelBoundary(s.state, [target]).requiredInputs.includes(target));
s.undo();
assert.equal(project(s.state).solved.values.get("load").value, 10);
const grouped = structuredClone(s.state);
s.undo();
assert.equal(modelParent(s.state, target), undefined);
assert.deepEqual(s.state.regions, grouped.regions);
console.log(
  "Nested identity, unchanged grouping/evaluation, boundary review, scoped authoring, nested edit propagation, portable recovery, invalid hierarchy rejection and reviewed cross-model linking pass.",
);

const flow = new RegionSession(),
  first = flow.create();
flow.write(first, "a := 2 m");
const second = flow.create();
flow.write(second, "b = a*2");
const outside = flow.create();
flow.write(outside, "A parent note stays here.");
const beforeFlow = positions(flow.state);
flow.makeModel(
  {
    id: "model-flow",
    name: "Flow",
    members: [first, second],
    inputs: [first],
    outputs: [second],
  },
  { x: 100, y: 120 },
);
const placedBeforeContinuation = positions(flow.state);
const inserted = flow.write(first, "a := 2 m", true).next;
flow.write(inserted, "An internal note.");
assert.equal(modelParent(flow.state, inserted), "model-flow");
assert.deepEqual(positions(flow.state)[outside], beforeFlow[outside]);
assert.deepEqual(
  positions(flow.state)[second],
  placedBeforeContinuation[second],
  "continuation leaves placed model members untouched",
);
assert.ok(positions(flow.state)[inserted].y > positions(flow.state)[second].y);
assert.equal(project(flow.state).solved.values.get("b").value, 4);
