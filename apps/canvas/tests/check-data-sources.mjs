import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import { csvQuantity } from "../src/regions/dataSources.ts";
import { archive, restore } from "../src/regions/artifacts.ts";
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
