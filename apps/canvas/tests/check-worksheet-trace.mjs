import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import { worksheetTrace } from "../src/regions/worksheetTrace.ts";
const session = new RegionSession();
const add = (text) => {
  const id = session.create();
  assert.ok(session.write(id, text).ok);
  return id;
};
const i = add("I := 2 A"),
  r = add("R := 6 ohm"),
  u = add("U = I*R"),
  power = add("P = U*I"),
  square = add("sq = I*I"),
  condition = add("P <= 30 W");
const trace = (root, source, page = session.state, uses = false) =>
  worksheetTrace(page, project(page), {
    root,
    source,
    uses,
    context: page.active,
    values: true,
  });
assert.deepEqual(
  trace(power).edges.map((e) => [e.from.id, e.to]),
  [[u, power]],
);
assert.equal(trace(power).inputs.find((p) => p.id === u).editable, false);
assert.equal(trace(power).inputs.find((p) => p.id === i).editable, true);
assert.deepEqual(
  trace(power, i).edges.map((e) => e.to),
  [power],
);
assert.deepEqual(
  trace(power).inputs.map((p) => p.id),
  [u, i],
);
assert.deepEqual(
  trace(power, i, session.state, true).edges.map((e) => e.to),
  [u, power, square],
);
assert.deepEqual(
  trace(condition).edges.map((e) => e.from.id),
  [power],
);
assert.deepEqual(
  trace(i).edges.map((e) => e.to),
  [u, power, square],
);
const at = { x: 0, y: 0 };
const data = session.importData("meter.csv", "current\n2", at);
const measured = session.quantityFromCell(data, 0, 0, "reading", "A", at);
const measuredOutput = add("twice = 2*reading");
assert.equal(trace(measuredOutput, measured).source.editable, false);
const computed = add("k := 2+3");
assert.equal(trace(computed).own.editable, false);
const wrong = structuredClone(session.state);
wrong.links = { [power]: { I: r } };
assert.deepEqual(trace(power, undefined, wrong).missing, ["I"]);
assert.deepEqual(
  worksheetTrace(wrong, project(wrong), {
    root: power,
    symbol: "I",
    context: wrong.active,
    values: false,
  }).edges,
  [],
);
assert.equal(
  trace(power, undefined, wrong).edges.some((e) => e.from.id === r),
  false,
);
assert(!trace(i, undefined, wrong).edges.some((e) => e.to === power));
const duplicate = add("I := 9 A");
assert(trace(power).missing.includes("I"));
assert(
  !trace(power).inputs.some(
    (input) => input.id === i || input.id === duplicate,
  ),
);
assert.equal(
  worksheetTrace(session.state, project(session.state), {
    root: i,
    context: "another",
    values: true,
  }),
  undefined,
);
session.dispose();
console.log(
  "Worksheet trace: exact one-hop sources and uses, repeated names, constraints, units, measured and derived read-only inputs, context and ambiguous/broken bindings pass.",
);
