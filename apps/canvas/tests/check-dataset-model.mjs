import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
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
const { archive, restore, decodeWorkspace } = await import(
  "../src/regions/artifacts.ts"
);
const { measurementOverlay } = await import("../src/regions/datasetModel.ts");
const saved = legacyWorkspace(s.state, []),
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

// Unit fields describe a measurement, not an equation. Both use paths must
// retain the same independently calculated SI value and dimensions.
for (const [unit, raw, value, dimension, absolute = false] of [
  ["V*A", 2, 2, [1, 2, -3, 0]],
  ["A*ohm", 3, 3, [1, 2, -3, 0, -1]],
  ["1/A", 4, 4, [0, 0, 0, 0, -1]],
  ["V/(A*s)", 5, 5, [1, 2, -4, 0, -2]],
  ["cm^2", 2, 0.0002, [0, 2, 0, 0]],
  ["in*ft", 2, 2 * 0.0254 * 0.3048, [0, 2, 0, 0]],
  ["min", 2, 120, [0, 0, 1, 0]],
  ["degC", -20, 253.15, [0, 0, 0, 1], true],
  ["°C", 25, 298.15, [0, 0, 0, 1], true],
  ["1", 7, 7, [0, 0, 0, 0]],
]) {
  const session = new RegionSession();
  try {
    const output = session.create();
    session.write(output, "result := observed");
    const area = session.create();
    session.write(area, "A := 50 m^2");
    const dataset = session.importData("units.csv", `reading\n${raw}`, {
      x: 0,
      y: 0,
    });
    const relation = {
      id: "data-relation-units",
      dataset,
      output,
      bindings: [{ symbol: "observed", column: 0, unit }],
      scope: { kind: "all" },
      paired: true,
    };
    const fromTable = evaluateDataset(session.state, relation).records[0].value;
    const input = session.quantityFromCell(dataset, 0, 0, "observed", unit, {
      x: 0,
      y: 100,
    });
    const projection = project(session.state);
    assert.equal(projection.kinds[input], "quantity", unit);
    for (const quantity of [
      fromTable,
      projection.solved.values.get("observed"),
      projection.solved.values.get("result"),
    ]) {
      assert.ok(Math.abs(quantity.value - value) < 1e-12, unit);
      assert.deepEqual(quantity.dimension, dimension, unit);
      assert.equal(!!quantity.absolute, absolute, unit);
    }
    assert.deepEqual(projection.bindings[input] || {}, {}, unit);
    session.bindDataset(relation);
    const decoded = await decodeWorkspace(archive(session.native()));
    const reopened = new RegionSession(decoded.page);
    try {
      assert.deepEqual(
        evaluateDataset(reopened.state, reopened.state.dataRelations[0])
          .records,
        evaluateDataset(session.state, session.state.dataRelations[0]).records,
        unit,
      );
      assert.deepEqual(
        project(reopened.state).solved.values.get("observed"),
        projection.solved.values.get("observed"),
        unit,
      );
    } finally {
      reopened.dispose();
    }
  } finally {
    session.dispose();
  }
}

for (const unit of ["m+1m", "2*m", "pi", "sin(1)", "unknown", "degC*m"]) {
  const session = new RegionSession();
  try {
    const output = session.create();
    session.write(output, "result := observed");
    const dataset = session.importData("units.csv", "reading\n2", {
      x: 0,
      y: 0,
    });
    const before = session.document;
    assert.throws(() =>
      session.bindDataset({
        id: "data-relation-invalid-unit",
        dataset,
        output,
        bindings: [{ symbol: "observed", column: 0, unit }],
        scope: { kind: "all" },
        paired: true,
      }),
    );
    assert.equal(session.document, before, unit);
  } finally {
    session.dispose();
  }
}
console.log(
  "Compound CSV units: scalar/table SI parity, affine Celsius, independent variable names, atomic invalid-unit rejection and native reopen pass.",
);

// An alias output must not let overflowed unit conversion escape as Infinity.
{
  const session = new RegionSession();
  try {
    const output = session.create();
    session.write(output, "result := observed");
    const dataset = session.importData("overflow.csv", "reading\n1e12", {
      x: 0,
      y: 0,
    });
    const before = session.document;
    assert.throws(
      () =>
        session.bindDataset({
          id: "data-relation-overflow",
          dataset,
          output,
          bindings: [
            { symbol: "observed", column: 0, unit: "GPa^11*GPa^11*GPa^11" },
          ],
          scope: { kind: "all" },
          paired: true,
        }),
      /Row 1.*finite real quantity/,
    );
    assert.equal(session.document, before);
  } finally {
    session.dispose();
  }
}
