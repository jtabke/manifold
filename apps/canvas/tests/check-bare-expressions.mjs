import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import { archive, restore } from "../src/regions/artifacts.ts";
import { mathSource } from "../src/regions/editing.ts";
const session = new RegionSession();
const add = (text) => {
  const id = session.create();
  session.write(id, text);
  return id;
};
const first = add("1+1 =");
assert.equal(project(session.state).kinds[first], "equation");
const value = (id) => {
  const p = project(session.state);
  return p.solved.values.get(p.statements.get(id).name).value;
};
assert.equal(value(first), 2);
const second = add("1+1");
assert.equal(value(second), 2);
assert.notEqual(
  project(session.state).statements.get(first).name,
  project(session.state).statements.get(second).name,
);
const input = add("a := 3");
const dependent = add("a*2 =");
assert.equal(value(dependent), 6);
session.write(input, "a := 4");
assert.equal(value(dependent), 8);
session.undo();
assert.equal(value(dependent), 6);
const unitful = add("2 m + 30 cm =");
assert.ok(Math.abs(value(unitful) - 2.3) < 1e-12);
const bad = add("1/0 ="),
  incomplete = add("1+ ="),
  note = add("Explain why the result changes.");
assert.ok(project(session.state).errors.has(bad));
assert.equal(project(session.state).kinds[incomplete], "draft");
assert.equal(project(session.state).kinds[note], "note");
const p = project(session.state),
  s = p.statements.get(first),
  mapped = mathSource(s, p.texts[first]);
assert.deepEqual(mapped.expressions.get(s.expression.left).span, {
  start: 0,
  end: 1,
});
assert.deepEqual(mapped.expressions.get(s.expression.right).span, {
  start: 2,
  end: 3,
});
const before = semanticKey(session.state);
session.write(first, "1+2 =");
assert.notEqual(semanticKey(session.state), before);
assert.equal(value(first), 3);
assert.deepEqual(
  restore(legacyWorkspace(session.state, [])).page,
  session.state,
);
console.log(
  "Bare expressions evaluate without user names; identity, live dependencies, units, incomplete work, errors, source spans, Undo and archives pass.",
);

for (const text of [
  "24 records",
  "2026 concept study",
  "Work on the model",
  "2026 reference brief · 110 lb payload · 4 nmi loaded.",
]) {
  const note = add(text);
  assert.equal(project(session.state).kinds[note], "note", text);
}
