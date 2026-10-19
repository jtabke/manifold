import assert from "node:assert/strict";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import {
  archive,
  restore,
  makeArtifact,
  prepare,
} from "../src/regions/artifacts.ts";
const s = new RegionSession();
const enter = (text) => {
  const id = s.create();
  assert.ok(s.write(id, text).ok);
  return id;
};
const temperature = enter("T = T_inf + Q/(h*A)");
enter("T_inf := 25 °C");
const heat = enter("Q := 800 W");
enter("h := 60 W/(m² K)");
const area = enter("A := 0.2 m²");
enter("T <= 100 °C");
const twice = s.create();
s.write(twice, "area_twice = 2*A", false, { A: area });
assert.equal(s.state.links?.[twice]?.A, area);
const { planConnection, plotChoices } = await import(
  "../src/regions/linking.ts"
);
assert.equal(project(s.state).bindings[twice].A, area);
assert.equal(project(s.state).solved.values.get("area_twice").value, 0.4);
assert.ok(plotChoices(s.state, area).some((v) => v.output === temperature));
const plotting = makeArtifact(
  s.state,
  temperature,
  "Plot T versus A from .05 to .5 m²",
);
const before = semanticKey(s.state),
  job = prepare(s.state, plotting);
s.move(area, { x: 300, y: 700 });
assert.equal(semanticKey(s.state), before);
assert.equal(prepare(s.state, plotting).key, job.key);
assert.equal(s.write(area, "A_cool := 0.2 m²").ok, true);
assert.match(project(s.state).texts[twice], /2\*A_cool/);
assert.match(project(s.state).texts[temperature], /h\*A_cool/);
assert.equal(project(s.state).bindings[twice].A_cool, area);
assert.ok(
  Math.abs(
    project(s.state).solved.values.get("T").value -
      273.15 -
      (25 + 800 / (60 * 0.2)),
  ) < 1e-10,
);
s.undo();
const pin = enter("P_in := 1000 W");
enter("eta := .8");
const loss = enter("Q_loss = P_in*(1-eta)");
const proposal = planConnection(s.state, loss, heat);
assert.equal(proposal.kind, "compute");
assert.ok(s.connect(proposal).ok);
assert.equal(project(s.state).bindings[heat].Q_loss, loss);
assert.ok(
  Math.abs(
    project(s.state).solved.values.get("T").value -
      273.15 -
      (25 + 200 / (60 * 0.2)),
  ) < 1e-10,
);
s.undo();
assert.equal(project(s.state).solved.values.get("Q").value, 800);
assert.throws(() => planConnection(s.state, area, heat), /units|dimensions/i);
const feedback = enter("feedback = 2*Q");
assert.throws(() => planConnection(s.state, feedback, heat), /cycle|depends/i);
const strict = enter("T_other <= 90 °C");
assert.ok(s.connect(planConnection(s.state, strict, temperature)).ok);
assert.equal(project(s.state).solved.constraints.get(strict).pass, false);
assert.equal(project(s.state).bindings[strict].T, temperature);
const roundTrip = restore(
  archive(s.state, [{ ...plotting, requirement: strict }]),
);
assert.equal(roundTrip.page.links[strict].T, temperature);
assert.equal(roundTrip.artifacts[0].requirement, strict);
assert.equal(
  project(roundTrip.page).solved.constraints.get(strict).pass,
  false,
);
s.branch();
assert.ok(s.connect(planConnection(s.state, loss, heat)).ok);
assert.equal(project(s.state, "original").solved.values.get("Q").value, 800);
assert.ok(
  Math.abs(project(s.state).solved.values.get("Q").value - 200) < 1e-10,
);
s.undo();
const stale = planConnection(s.state, loss, heat);
s.write(pin, "P_in := 900 W");
assert.equal(s.connect(stale).ok, false);
// A missing bound identity must not fall through to another quantity with its name.
const damaged = structuredClone(roundTrip.page);
damaged.regions.find((r) => r.id === area).text = "";
damaged.regions.push({ id: "region-999", text: "A := 0.5 m²" });
assert.ok(project(damaged).errors.has(twice));
assert.ok(!project(damaged).solved.values.has("area_twice"));
// Shared authoring and linked-assumption edits also work while comparing alternatives.
const local = s.create();
assert.ok(s.write(local, "area_copy = A", false, { A: area }).ok);
assert.equal(project(s.state).bindings[local].A, area);
assert.equal(
  project(s.state, "original").solved.values.get("area_copy").value,
  0.2,
);
assert.ok(s.write(heat, "Q := Q_loss", false, { Q_loss: loss }).ok);
assert.ok(s.write(heat, "Q := 700 W").ok);
assert.equal(project(s.state).solved.values.get("Q").value, 700);
assert.equal(project(s.state, "original").solved.values.get("Q").value, 800);
// Renaming carries frozen alternative definitions and explicit identities with it.
s.switchContext("original");
assert.equal(s.write(area, "h := 0.2 m²").ok, false);
assert.ok(s.write(area, "A_cool := 0.2 m²").ok);
for (const context of s.state.contexts) {
  const projection = project(s.state, context.id);
  assert.equal(projection.bindings[twice].A_cool, area);
  assert.equal(projection.solved.values.get("area_copy").value, 0.2);
  // Rebuilding from portable definitions must agree with the working session.
  const clean = new RegionSession(restore(archive(s.state, [])).page);
  assert.equal(
    semanticKey(clean.state, context.id),
    semanticKey(s.state, context.id),
  );
  assert.deepEqual(
    [...project(clean.state, context.id).solved.values],
    [...projection.solved.values],
  );
}
for (const links of [
  { missing: { A: area } },
  { [twice]: { A: "region-999999" } },
  { [twice]: { "bad alias": area } },
  JSON.parse(`{"${twice}":{"__proto__":"${area}"}}`),
]) {
  const invalid = JSON.parse(archive(s.state, []));
  invalid.page.links = links;
  assert.throws(
    () => restore(JSON.stringify(invalid)),
    /workspace|archive|valid|format/i,
  );
}
console.log(
  "Identity-bound references, rename, reviewed linking, unit/cycle rejection, contexts, layout independence and analytical parity passed.",
);
