import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import { evaluateDataset } from "../src/regions/datasetModel.ts";
const s = new RegionSession();
const add = (t) => {
  const id = s.create();
  assert.ok(s.write(id, t).ok);
  return id;
};
const output = add("P = force*speed"),
  limit = add("P <= 80 W");
const dataset = s.importData(
  "paired.csv",
  "force [N],speed [m/s]\n20,3\n24,4",
  { x: 650, y: 100 },
);
const binding = {
  id: "data-relation-test",
  dataset,
  output,
  bindings: [
    { symbol: "force", column: 0, unit: "N" },
    { symbol: "speed", column: 1, unit: "m/s" },
  ],
  scope: { kind: "all" },
  paired: true,
};
const result = evaluateDataset(s.state, binding);
assert.deepEqual(
  result.records.map((r) => r.value.value),
  [60, 96],
);
assert.deepEqual(
  result.records.map((r) => r.pass),
  [true, false],
);
assert.equal(project(s.state).solved.values.has("P"), false);
const selected = evaluateDataset(s.state, {
  ...binding,
  scope: { kind: "records", rows: [1] },
});
assert.equal(selected.records.length, 1);
assert.equal(selected.records[0].row, 1);
assert.equal(selected.records[0].value.value, 96);
assert.throws(
  () =>
    evaluateDataset(s.state, { ...binding, bindings: [binding.bindings[0]] }),
  /speed/,
);
const bad = structuredClone(s.state);
bad.regions.find((r) => r.id === dataset).data.csv =
  "force [N],speed [m/s]\n20,3\n24,";
assert.throws(() => evaluateDataset(bad, binding), /row 2.*speed/i);
assert.throws(
  () =>
    evaluateDataset(s.state, {
      ...binding,
      bindings: [binding.bindings[0], { ...binding.bindings[1], unit: "kg" }],
    }),
  /unit|dimension/i,
);
const id = s.bindDataset(binding);
assert.equal(s.state.dataRelations.length, 1);
assert.equal(
  evaluateDataset(s.state, s.state.dataRelations[0]).records[1].value.value,
  96,
);
s.move(id, { x: 200, y: 700 });
assert.equal(
  evaluateDataset(s.state, s.state.dataRelations[0]).key,
  result.key,
);
console.log(
  "Paired per-record evaluation, explicit scope, units, missing values and layout independence pass.",
);

// Reproduction from a clean document, context changes, archived identities and failure recovery.
const { archive, restore } = await import("../src/regions/artifacts.ts");
const { measurementOverlay } = await import("../src/regions/datasetModel.ts");
const saved = archive(s.state, []),
  loaded = new RegionSession(restore(saved).page);
assert.deepEqual(
  evaluateDataset(loaded.state, loaded.state.dataRelations[0]).records,
  result.records,
);
const tampered = JSON.parse(saved);
tampered.page.dataRelations[0].scope = { kind: "records", rows: [9999] };
assert.throws(() => restore(JSON.stringify(tampered)), /archive/i);
assert.throws(
  () => evaluateDataset(s.state, { ...binding, paired: false }),
  /Confirm/,
);
assert.throws(
  () =>
    evaluateDataset(s.state, {
      ...binding,
      bindings: [
        binding.bindings[0],
        { ...binding.bindings[1], symbol: "force" },
      ],
    }),
  /different/,
);
assert.throws(
  () =>
    evaluateDataset(s.state, {
      ...binding,
      scope: { kind: "records", rows: [0, 0] },
    }),
  /records/,
);
s.undo();
s.undo();
assert.equal(s.state.dataRelations?.length || 0, 0);
const scalar = new RegionSession(s.state),
  f = scalar.quantityFromCell(dataset, 0, 0, "force", "N", { x: 0, y: 0 }),
  v = scalar.quantityFromCell(dataset, 0, 1, "speed", "m/s", { x: 0, y: 100 });
const over = measurementOverlay(scalar.state, output, f);
assert.deepEqual(
  over.records.map((r) => r.value.value),
  [60, 96],
);
assert.equal(project(scalar.state).solved.values.get("P").value, 60);
scalar.write(v, "speed := 5 m/s");
assert.equal(project(scalar.state).solved.values.get("P").value, 100);
assert.deepEqual(
  measurementOverlay(scalar.state, output, f).records.map((r) => r.value.value),
  [60, 96],
);
const linked = {
  ...binding,
  bindings: [
    { ...binding.bindings[0], quantity: f },
    { ...binding.bindings[1], quantity: v },
  ],
};
assert.deepEqual(evaluateDataset(scalar.state, linked).records, over.records);
const clean = new RegionSession(structuredClone(scalar.state));
assert.deepEqual(
  evaluateDataset(clean.state, linked).records,
  evaluateDataset(scalar.state, linked).records,
);
const large = new RegionSession(s.state);
const many = large.importData(
  "large.csv",
  "force [N],speed [m/s]\n" +
    Array.from({ length: 10000 }, (_, i) => `${i + 1},3`).join("\n"),
  { x: 0, y: 0 },
);
const all = evaluateDataset(large.state, { ...binding, dataset: many });
assert.equal(all.records.length, 10000);
assert.equal(all.records[9999].value.value, 30000);
assert.equal(large.state.regions.length, 4);
console.log(
  "Clean recovery, invalid bindings, Undo, independent scalar hypotheses, paired evidence and 10,000-row evaluation pass.",
);
const multiple = new RegionSession(s.state);
const looser = multiple.create();
multiple.write(looser, "P <= 100 W");
const checked = evaluateDataset(multiple.state, binding);
assert.deepEqual(
  checked.records.map((r) => r.conditions[looser]),
  [true, true],
);
assert.deepEqual(
  checked.records.map((r) => r.conditions[limit]),
  [true, false],
);
const ambiguous = new RegionSession(s.state),
  duplicate = ambiguous.create();
ambiguous.write(duplicate, "P = force+speed");
assert.throws(() => evaluateDataset(ambiguous.state, binding), /ambiguous/);
