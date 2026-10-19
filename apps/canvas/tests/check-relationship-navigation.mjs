import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import {
  relationshipArrangement,
  relationshipDestination,
  relationshipObjects,
} from "../src/regions/relationshipNavigation.ts";
const s = new RegionSession(),
  add = (t) => {
    const id = s.create();
    s.write(id, t);
    return id;
  };
const output = add("P = force*speed*eta"),
  assumption = add("eta = efficiency*derating"),
  limit = add("P <= 80 W"),
  dataset = s.importData("runs.csv", "force [N],speed [m/s]\n20,3\n24,4", {
    x: 1400,
    y: 700,
  });
const relation = {
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
const distant = add("efficiency := 1");
add("derating := 0.9");
const selected = {
  dataset,
  rows: [1],
  columns: [],
  kind: "record",
  view: relation.id,
};
assert.equal(
  relationshipDestination(s.state, relation, { kind: "source" }, selected).view,
  dataset,
);
assert.equal(
  relationshipDestination(s.state, relation, { kind: "calculation" }, selected)
    .detail,
  "calculation",
);
assert.equal(
  relationshipDestination(
    s.state,
    relation,
    { kind: "requirement", requirement: limit },
    selected,
  ).view,
  limit,
);
assert.deepEqual(relationshipObjects(s.state, relation).assumptions, [
  assumption,
]);
assert.ok(!relationshipObjects(s.state, relation).ids.includes(distant));
const before = structuredClone(s.state),
  positions = relationshipArrangement(s.state, relation, [], { x: 80, y: 80 });
assert.ok(
  positions[dataset] &&
    positions[output] &&
    positions[relation.id] &&
    positions[limit],
);
assert.deepEqual(s.state, before);
console.log(
  "Identity-based relationship destinations and temporary layout leave engineering and saved positions unchanged.",
);
