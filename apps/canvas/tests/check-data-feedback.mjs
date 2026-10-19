import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import { evaluateDataset } from "../src/regions/datasetModel.ts";
import { recordFeedback } from "../src/regions/dataFeedback.ts";
const s = new RegionSession(),
  add = (t) => {
    const id = s.create();
    s.write(id, t);
    return id;
  };
const output = add("P = force*speed"),
  limit = add("P <= 80 W"),
  dataset = s.importData(
    "test.csv",
    "run,force [N],speed [m/s]\nbench one,20,3\nbench two,24,4",
    { x: 600, y: 100 },
  );
const relation = {
  id: "data-relation-test",
  dataset,
  output,
  bindings: [
    { symbol: "force", column: 1, unit: "N" },
    { symbol: "speed", column: 2, unit: "m/s" },
  ],
  scope: { kind: "all" },
  paired: true,
};
const records = evaluateDataset(s.state, relation).records;
const failed = recordFeedback(s.state, relation, records[1]);
assert.match(failed.observation, /bench two/);
assert.match(failed.expression, /24.*4.*96 W/);
assert.equal(failed.checks[0].text, "Exceeds limit by 16 W");
assert.equal(failed.checks[0].id, limit);
assert.equal(
  recordFeedback(s.state, relation, records[0]).checks[0].text,
  "20 W below limit",
);
console.log(
  "Selected observation identity, substituted model and per-requirement margins pass.",
);
const { placeDataResult } = await import("../src/regions/dataFeedback.ts");
const anchor = {
  id: "eq",
  kind: "region",
  x: 100,
  y: 80,
  width: 300,
  height: 280,
};
const frames = [
  anchor,
  { id: "csv", kind: "region", x: 655, y: 300, width: 480, height: 180 },
];
const at = placeDataResult(anchor, frames, 1870);
assert.ok(at.y < 650);
for (const f of frames)
  assert.ok(
    at.x + 550 <= f.x ||
      at.x >= f.x + f.width ||
      at.y + 470 <= f.y ||
      at.y >= f.y + f.height,
  );
// A few equations above a wide CSV should keep their result beside the work.
const smallEquation = { ...anchor, x: 110, y: 110, width: 240 };
const smallSource = {
  id: "measurements",
  kind: "region",
  x: 110,
  y: 467,
  width: 580,
  height: 250,
};
const compact = placeDataResult(
  smallEquation,
  [smallEquation, smallSource],
  1280,
);
assert.equal(compact.y, smallEquation.y);
assert.ok(compact.x >= smallSource.x + smallSource.width + 28);
assert.ok(compact.x + 550 <= 1280);
assert.deepEqual(
  failed.inputs.map((i) => i.value),
  ["24 N", "4 m/s"],
);
const lower = s.create();
s.write(lower, "P >= 70 W");
const limited = evaluateDataset(s.state, relation).records;
assert.equal(
  recordFeedback(s.state, relation, limited[0]).checks.find(
    (c) => c.id === lower,
  ).text,
  "Below limit by 10 W",
);
assert.equal(
  recordFeedback(s.state, relation, limited[1]).checks.find(
    (c) => c.id === lower,
  ).text,
  "26 W above limit",
);
const t = new RegionSession(),
  outputT = t.create();
t.write(outputT, "T = ambient+rise");
const maxT = t.create();
t.write(maxT, "T <= 100 °C");
const dataT = t.importData("temperatures.csv", "ambient [°C],rise [K]\n80,30", {
  x: 600,
  y: 100,
});
const thermal = {
  id: "data-relation-temp",
  dataset: dataT,
  output: outputT,
  bindings: [
    { symbol: "ambient", column: 0, unit: "°C" },
    { symbol: "rise", column: 1, unit: "K" },
  ],
  scope: { kind: "all" },
  paired: true,
};
const hot = evaluateDataset(t.state, thermal).records[0];
assert.equal(
  recordFeedback(t.state, thermal, hot).checks[0].text,
  "Exceeds limit by 10 K",
);
