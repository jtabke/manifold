import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import { planConnection } from "../src/regions/linking.ts";
const s = new RegionSession();
const add = (text) => {
  const id = s.create();
  assert.ok(s.write(id, text).ok);
  return id;
};
const result = add("P = force*speed"),
  current = add("F_measured := 20 kg*m/s^2"),
  resistance = add("v_measured := 3 m/s");
assert.ok(s.connect(planConnection(s.state, current, result, "force")).ok);
assert.match(project(s.state).texts[result], /F_measured\*speed/);
assert.ok(project(s.state).errors.has(result));
assert.ok(s.connect(planConnection(s.state, resistance, result, "speed")).ok);
assert.equal(project(s.state).solved.values.get("P").value, 60);
console.log(
  "Progressive identity bindings resolve one missing input at a time.",
);

const invalid = new RegionSession();
const put = (text) => {
  const id = invalid.create();
  assert.ok(invalid.write(id, text).ok);
  return id;
};
const bad = put("sum = first + second"),
  mass = put("mass := 1 kg"),
  length = put("length := 1 m");
assert.ok(
  invalid.connect(planConnection(invalid.state, mass, bad, "first")).ok,
);
assert.throws(
  () => planConnection(invalid.state, length, bad, "second"),
  /Units/,
);
assert.match(project(invalid.state).texts[bad], /second/);
