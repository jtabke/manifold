import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  csvQuantity,
  measurementText,
  measurementUnit,
  matchesMeasurementText,
} from "../src/regions/dataSources.ts";
import { parse, quantityLiteral, same } from "../src/notebook/math.ts";
import { archive, decodeWorkspace, restore } from "../src/regions/artifacts.ts";
const s = new RegionSession();
const data = s.importData(
  "measurements.csv",
  'sample,force [kg*m/s^2],speed [m/s]\n"run, one",20,3\nrun two,24,4',
  { x: 650, y: 100 },
);
assert.equal(project(s.state).kinds[data], "note");
assert.equal(project(s.state).solved.values.size, 0);
const force = s.quantityFromCell(data, 0, 1, "F_measured", "kg*m/s^2", {
  x: 100,
  y: 300,
});
assert.equal(project(s.state).solved.values.get("F_measured").value, 20);
assert.deepEqual(s.state.regions.find((r) => r.id === force).source, {
  dataset: data,
  row: 0,
  column: 1,
  raw: "20",
  unit: "kg*m/s^2",
});
assert.throws(
  () => s.quantityFromCell(data, 0, 0, "bad", ""),
  /number|numeric/i,
);
assert.throws(
  () => s.quantityFromCell(data, 0, 2, "bad", "mystery"),
  /Define|unit/i,
);
assert.throws(
  () => s.importData("bad.csv", "a,b\n1,2,3", { x: 0, y: 0 }),
  /column|row/i,
);
assert.throws(
  () => s.importData("bad.csv", 'a,b\n"x"junk,2', { x: 0, y: 0 }),
  /quoted/i,
);
assert.throws(
  () => s.quantityFromCell(data, 0, 1, "constructor", "kg*m/s^2"),
  /name/i,
);
const altered = JSON.parse(legacyWorkspace(s.state, []));
altered.page.regions.find((r) => r.id === force).source.raw = "999";
assert.throws(() => restore(JSON.stringify(altered)), /archive/i);
const restored = restore(legacyWorkspace(s.state, []));
assert.deepEqual(restored.page.regions, s.state.regions);
s.undo();
assert.ok(!s.state.regions.some((r) => r.id === force));
assert.ok(s.state.regions.some((r) => r.id === data));
console.log(
  "CSV remains inert until explicit scalar extraction; units, provenance, Undo and portable recovery pass.",
);

assert.equal(
  csvQuantity({ name: "signed.csv", csv: "q [W]\n+20" }, 0, 0, "q", "W").text,
  "q := 20 W",
);

// New extracted quantities use v3 math. Reject reserved v3 names before changing
// accepted state, rather than adding a draft with no measurement value.
for (const name of ["round", "floor", "ceil", "asin", "cbrt"]) {
  assert.throws(
    () => csvQuantity({ name: "power.csv", csv: "q [W]\n20" }, 0, 0, name, "W"),
    /reserved/,
  );
  const before = s.state,
    document = s.document;
  assert.throws(
    () => s.quantityFromCell(data, 0, 1, name, "N", { x: 0, y: 0 }),
    /reserved/,
  );
  assert.equal(s.state, before);
  assert.equal(s.document, document);
}
const valid = s.quantityFromCell(data, 0, 1, "measured_force", "N", {
  x: 0,
  y: 0,
});
assert.equal(project(s.state).solved.values.get("measured_force").value, 20);
s.undo();
assert.equal(
  s.state.regions.some((r) => r.id === valid),
  false,
);
s.redo();
assert.equal(project(s.state).solved.values.get("measured_force").value, 20);

const compound = new RegionSession();
try {
  const dataset = compound.importData(
    "compound.csv",
    "measurement\n+2\n-20\n0",
    { x: 0, y: 0 },
  );
  for (const [index, [unit, expected, dimension, absolute]] of [
    ["V*A", 2, [1, 2, -3, 0]],
    ["A*ohm", 2, [1, 2, -3, 0, -1]],
    ["1/A", 2, [0, 0, 0, 0, -1]],
    ["1/(V*A)", 2, [-1, -2, 3, 0]],
    ["V/(A*s)", 2, [1, 2, -4, 0, -2]],
    ["A^-2", 2, [0, 0, 0, 0, -2]],
    ["cm^2", 0.0002, [0, 2, 0, 0]],
    ["in*ft", 2 * 0.0254 * 0.3048, [0, 2, 0, 0]],
    ["m^0.5", 2, [0, 0.5, 0, 0]],
    ["min", 120, [0, 0, 1, 0]],
    ["min*V", 120, [1, 2, -2, 0, -1]],
    ["min^-1", 2 / 60, [0, 0, -1, 0]],
    ["1/s", 2, [0, 0, -1, 0]],
    ["1", 2, [0, 0, 0, 0]],
    ["", 2, [0, 0, 0, 0]],
    ["°C", 275.15, [0, 0, 0, 1], true],
    ["degC", 275.15, [0, 0, 0, 1], true],
  ].entries()) {
    const name = `quantity_${index}`,
      id = compound.quantityFromCell(dataset, 0, 0, name, unit, {
        x: 200,
        y: 80 * index,
      }),
      region = compound.state.regions.find((r) => r.id === id),
      projected = project(compound.state),
      quantity = projected.solved.values.get(name);
    assert.equal(projected.errors.size, 0, unit);
    assert.ok(
      Math.abs(quantity.value - expected) <= 1e-12 * Math.abs(expected),
    );
    assert.ok(same(quantity.dimension, dimension), unit);
    assert.equal(!!quantity.absolute, !!absolute, unit);
    assert.equal(
      quantityLiteral(parse(region.text, undefined, 3).expression),
      true,
    );
    assert.equal(region.text, measurementText(name, "+2", unit));
    assert.deepEqual(region.source, {
      dataset,
      row: 0,
      column: 0,
      raw: "+2",
      unit,
    });
  }
  for (const [row, expected] of [
    [1, 253.15],
    [2, 273.15],
  ]) {
    const name = `temperature_${row}`;
    compound.quantityFromCell(dataset, row, 0, name, "°C", { x: 0, y: 0 });
    assert.ok(
      Math.abs(
        project(compound.state).solved.values.get(name).value - expected,
      ) < 1e-12,
    );
  }
  for (const unit of [
    "m+1m",
    "m-1m",
    "2 m",
    "m*2",
    "m/2",
    "pi",
    "e",
    "sqrt(m^2)",
    "sin(0)",
    "force",
    "m*°C",
    "degC^1",
    "0",
    "-1",
    "m^13",
    "m^1e999",
    "((mm^12)^12)^12",
    "(GPa^12)^12",
    "m".repeat(81),
    "(".repeat(33) + "m" + ")".repeat(33),
  ]) {
    const before = compound.state,
      document = compound.document;
    assert.throws(() => measurementUnit(unit), undefined, unit);
    assert.throws(
      () =>
        compound.quantityFromCell(dataset, 0, 0, "invalid_unit", unit, {
          x: 0,
          y: 0,
        }),
      undefined,
      unit,
    );
    assert.equal(compound.state, before, unit);
    assert.equal(compound.document, document, unit);
  }
  for (const [unit, source] of [
    ["W", "20 W"],
    ["kg*m/s^2", "20 kg*m/s^2"],
    ["N", "20 (kg*m/s^2)"],
    ["°C", "20 °C"],
    ["1", "20"],
    ["", "20"],
  ])
    assert.equal(measurementText("q", "20", unit), `q := ${source}`);
  for (const unit of ["1/s", "1/A", "V*A", "in*ft", "min"]) {
    assert.equal(
      matchesMeasurementText(`q := 2 ${unit}`, "q", "+2", unit),
      true,
    );
    assert.equal(
      matchesMeasurementText(measurementText("q", "+2", unit), "q", "+2", unit),
      true,
    );
    assert.equal(
      matchesMeasurementText(`q := 3 ${unit}`, "q", "+2", unit),
      false,
    );
  }
  assert.throws(() => matchesMeasurementText("q := 2 m+1m", "q", "2", "m+1m"));
  const decoded = await decodeWorkspace(archive(compound.native()));
  assert.deepEqual(decoded.page.regions, compound.state.regions);
  assert.deepEqual(
    [...project(decoded.page).solved.values],
    [...project(compound.state).solved.values],
  );
} finally {
  compound.dispose();
  s.dispose();
}
console.log(
  "Compound measurement units, literal editing, independent SI values, Celsius, provenance/native handoff and atomic unit-arithmetic rejection pass.",
);
