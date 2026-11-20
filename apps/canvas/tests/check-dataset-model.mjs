import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  createDatasetStatesSelector,
  createDatasetSelector,
  evaluateDataset,
} from "../src/regions/datasetModel.ts";
import { evaluationWork, resetEvaluationWork } from "../src/notebook/math.ts";
import { createDatasetTask } from "../src/regions/datasetExecution.ts";
import { datasetOutcome } from "../src/regions/datasetRows.ts";
import { worksheetProjection } from "../src/regions/worksheetProjection.ts";
import { modelExterior } from "../src/regions/systemExploration.ts";
const noWork = { parses: 0, expressions: 0, assignments: 0, constraints: 0 };
function againstCold(page, relation, state) {
  if (state.result)
    assert.deepEqual(state.result, evaluateDataset(page, relation));
  else
    assert.throws(() => evaluateDataset(page, relation), {
      message: state.error,
    });
  return state;
}
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
const selectEvidence = createDatasetStatesSelector();
const paired = measurementOverlay(scalar.state, output, f, selectEvidence);
resetEvaluationWork();
scalar.move(f, { x: 30, y: 90 });
assert.equal(
  measurementOverlay(scalar.state, output, f, selectEvidence).records,
  paired.records,
);
assert.equal(evaluationWork().assignments, 0);
scalar.write(v, "speed := 6 m/s"); // Changed scalar hypothesis, not paired evidence or units.
project(scalar.state);
resetEvaluationWork();
assert.equal(
  measurementOverlay(scalar.state, output, f, selectEvidence).records,
  paired.records,
);
assert.deepEqual(evaluationWork(), noWork);
const unpaired = structuredClone(scalar.state);
unpaired.regions.find((r) => r.id === v).source.row = 1;
assert.throws(
  () => measurementOverlay(unpaired, output, f, selectEvidence),
  /different source rows/,
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
const manyId = large.bindDataset({ ...binding, dataset: many }),
  select = createDatasetStatesSelector();
project(large.state); // Count dataset work separately from the accepted worksheet.
resetEvaluationWork();
const states = select(large.state),
  all = states[manyId].result;
assert.equal(all.records.length, 10000);
assert.equal(all.records[9999].value.value, 30000);
assert.equal(large.state.regions.length, 4);
assert.equal(evaluationWork().parses, 4); // Two definitions and two measurement units, not per row.
assert.equal(evaluationWork().assignments, 10000);
assert.equal(evaluationWork().constraints, 10000);
resetEvaluationWork();
large.move(manyId, { x: 900, y: 560 });
worksheetProjection.clear(); // Layout reuse does not depend on that shared cache staying warm.
assert.equal(select(large.state), states);
assert.deepEqual(evaluationWork(), noWork);
const unrelated = large.create();
for (const text of ["Field notes", "spare := 3 m", "spare := 8 s"]) {
  assert.ok(large.write(unrelated, text).ok);
  project(large.state); // Only count the selector, not the changed worksheet.
  resetEvaluationWork();
  assert.equal(select(large.state), states, text);
  assert.deepEqual(evaluationWork(), noWork, text);
}
// Hold the transport at the same boundary as a busy browser worker. Exercise
// queued and running cancellation, a late response and the Apply review guard.
{
  const originalWorker = globalThis.Worker,
    workers = [];
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  class HeldWorker {
    postMessage(input) {
      this.input = structuredClone(input);
      workers.push(this);
    }
    terminate() {
      this.stopped = true;
    }
    deliver() {
      this.onmessage({ data: structuredClone(datasetOutcome(this.input)) });
    }
  }
  globalThis.Worker = HeldWorker;
  try {
    const owner = new RegionSession(large.state),
      select = createDatasetSelector(createDatasetTask),
      candidate = { ...binding, dataset: many },
      job = () => select(owner.state, [candidate])[candidate.id];
    const obsolete = job();
    assert.deepEqual(obsolete.read(), { pending: true });
    let reports = 0;
    const stop = obsolete.subscribe(() => reports++);
    await tick();
    assert.equal(workers.length, 1);
    owner.write(unrelated, "An unrelated update");
    assert.equal(job(), obsolete); // A busy solve is not restarted for a note.
    owner.write(limit, "P <= 90 W");
    const queued = job(),
      cancelQueued = queued.subscribe(() =>
        assert.fail("cancelled queued job published"),
      );
    await tick();
    assert.equal(workers.length, 1);
    cancelQueued();
    owner.write(limit, "P <= 120 W");
    const current = job();
    assert.notEqual(current, obsolete);
    const stopCurrent = current.subscribe(() => reports++);
    stop();
    await tick();
    assert.equal(workers[0].stopped, true);
    assert.equal(workers.length, 2);
    workers[0].deliver(); // Even if a message raced with termination.
    await tick();
    assert.equal(reports, 0);
    assert.equal(current.read().pending, true);
    assert.throws(
      () => owner.bindDataset(candidate, undefined, current.read()),
      /Review the current/,
    );
    workers[1].deliver();
    await tick();
    assert.equal(reports, 1);
    assert.equal(workers[1].stopped, true);
    const review = current.read();
    againstCold(owner.state, candidate, review);
    assert.equal(review.result.records[39].pass, true);
    assert.throws(() => {
      review.result.records[0].pass = false;
    }, TypeError);
    const before = owner.state;
    for (const bad of [obsolete.read(), { ...review }])
      assert.throws(
        () => owner.bindDataset(candidate, undefined, bad),
        /Review the current/,
      );
    assert.equal(owner.state, before);
    project(owner.state);
    resetEvaluationWork();
    const item = owner.bindDataset(candidate, undefined, review);
    assert.ok(owner.state.dataRelations.find((r) => r.id === item));
    assert.equal(evaluationWork().assignments, 0); // no synchronous 10,000-row repeat on Apply
    owner.write(limit, "P <= 99 W");
    const edited = owner.state;
    assert.throws(
      () => owner.bindDataset(candidate, undefined, review),
      /Review the current/,
    );
    assert.equal(owner.state, edited);
    stopCurrent();
    owner.dispose();
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
}
// A model's vector status reads those same accepted results, not a second row solve.
const envelope = {
  id: "model-envelope",
  name: "Envelope",
  members: [manyId, output, limit],
  inputs: [],
  outputs: [output],
};
project(large.state);
resetEvaluationWork();
assert.equal(
  modelExterior(large.state, envelope, states).computation,
  "current",
);
assert.equal(
  modelExterior(large.state, envelope, { [manyId]: { pending: true } })
    .computation,
  "calculating",
);
assert.equal(
  modelExterior(large.state, envelope, { [manyId]: { error: "Blocked" } })
    .computation,
  "incomplete",
);
assert.equal(evaluationWork().assignments, 0);
assert.throws(() => all.records.pop(), TypeError);
assert.throws(() => (all.records[0].inputs.force.value = 99), TypeError);
large.write(unrelated, "otherPower := force*speed");
const smallId = large.bindDataset({ ...binding, output: unrelated });
resetEvaluationWork();
const both = select(large.state);
assert.equal(both[manyId], states[manyId]);
assert.equal(both[smallId].result.records[1].value.value, 96);
assert.equal(evaluationWork().assignments, 2); // Only the added relation was solved.
large.write(unrelated, "otherPower := 2*force*speed");
project(large.state);
resetEvaluationWork();
const edited = select(large.state);
assert.equal(edited[manyId], states[manyId]);
assert.equal(edited[smallId].result.records[1].value.value, 192);
assert.equal(evaluationWork().assignments, 2);
assert.equal(evaluationWork().constraints, 0);
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

// A shallow-frozen caller can still change evidence, mappings and the model in place.
// In particular, bound scalar definitions are not in the row solver's definition list.
{
  const page = Object.freeze({
      ...structuredClone(scalar.state),
      links: {},
      dataRelations: [structuredClone(linked)],
    }),
    select = createDatasetStatesSelector(),
    read = (p = page) => againstCold(p, relation, select(p)[linked.id]),
    source = page.regions.find((r) => r.id === dataset).data,
    force = page.regions.find((r) => r.id === f),
    requirement = page.regions.find((r) => r.id === limit),
    relation = page.dataRelations[0];
  assert.equal(read().result.records[1].value.value, 96);
  source.csv = "force [N],speed [m/s]\n20,3\n25,";
  const badRow = read();
  assert.match(badRow.error, /Row 2.*speed/);
  page.regions.push({ id: "unrelated", text: "spare := 1" });
  project(page);
  resetEvaluationWork();
  assert.equal(select(page)[linked.id], badRow);
  assert.deepEqual(evaluationWork(), noWork); // Don't repeat the successful first row.
  source.csv = "force [N],speed [m/s]\n20,3\n25,4";
  assert.equal(read().result.records[1].value.value, 100);
  source.name = "";
  assert.match(read().error, /named CSV/);
  source.name = "paired.csv";

  const upstream = { id: "instrument", text: "measured := 20 N" };
  page.regions.push(upstream);
  force.text = "force := measured";
  assert.equal(read().result.records[1].value.value, 100);
  upstream.text = "measured := 20 s"; // Bound definition itself didn't change.
  assert.match(read().error, /units for force/);
  page.regions.pop(); // Unsolved scalar no longer supplies a unit check.
  assert.equal(read().result.records[1].value.value, 100);
  force.text = "force := 20 N";
  page.regions.push({ ...force, id: "duplicate-force" });
  assert.match(read().error, /force is ambiguous/);
  page.regions.pop();
  page.links[output] = { force: v }; // A stale explicit link, even for a row override.
  assert.match(read().error, /Linked force is unavailable/);
  delete page.links[output];
  assert.equal(read().result.records[1].conditions[limit], false);
  requirement.text = "P <= 100 W";
  assert.equal(read().result.records[1].conditions[limit], true);
  requirement.text = "P <= 100 m";
  assert.match(read().error, /Row 1.*limit has units m/);
  requirement.text = "P <= 100 W";

  page.contexts.push({
    id: "alt",
    label: "Alternative",
    base: {},
    overrides: {},
  });
  const alt = { ...page, active: "alt" };
  assert.notEqual(read().result.key, read(alt).result.key);
  alt.contexts.at(-1).overrides[output] = "P = 2*force*speed";
  assert.equal(read(alt).result.records[1].value.value, 200);
  assert.equal(read().result.records[1].value.value, 100);
  relation.scope = { kind: "records", rows: [1] };
  assert.deepEqual(
    read().result.records.map((r) => r.row),
    [1],
  );
  const subsetKey = read().result.key;
  relation.bindings[0] = Object.fromEntries(
    Object.entries(relation.bindings[0]).reverse(),
  );
  assert.notEqual(read().result.key, subsetKey); // Caller field order is visible in the result key.
  delete relation.scope.rows[0]; // An incomplete mutable selection, then repaired in place.
  assert.ok(read().error);
  relation.scope.rows[0] = 0;
  assert.equal(read().result.records[0].value.value, 60);
  relation.bindings[0].quantity = v;
  assert.match(read().error, /different model input/);
  relation.bindings[0].quantity = f;
  relation.paired = false;
  assert.match(read().error, /Confirm/);
  relation.paired = true;
  const prior = read();
  page.dataRelations.pop();
  assert.deepEqual(select(page), {});
  page.dataRelations.push(relation);
  assert.notEqual(read(), prior); // Removed relations are not retained for Undo.
}
// Explicit preview mapping, including a new requirement and its transitive
// dependencies. A previous closure alone cannot notice names entering scope.
{
  const page = structuredClone(s.state),
    select = createDatasetStatesSelector(),
    read = () =>
      againstCold(page, binding, select(page, [binding])[binding.id]),
    bound = { id: "bound", text: "allowed := threshold" },
    threshold = { id: "threshold", text: "threshold := 90 W" },
    extra = { id: "extra-limit", text: "P < allowed" };
  assert.equal(read().result.requirements.length, 1);
  page.regions.push(extra, bound);
  const missing = read();
  assert.match(missing.error, /Bind threshold/);
  page.regions.push({ id: "unrelated", text: "Another note" });
  project(page);
  resetEvaluationWork();
  assert.equal(select(page, [binding])[binding.id], missing);
  assert.deepEqual(evaluationWork(), noWork);
  page.regions.push(threshold);
  const before = read().result;
  assert.equal(before.records[1].conditions[extra.id], false);
  threshold.mathVersion = 3;
  assert.notEqual(read().result.key, before.key); // Same text and value, different version.
  threshold.text = "threshold := 100 W";
  assert.equal(read().result.records[1].conditions[extra.id], true);
  page.regions.push({ ...threshold, id: "other-threshold" });
  assert.match(read().error, /threshold is ambiguous/);
  page.regions.pop();
  page.links = { [bound.id]: { threshold: output } };
  assert.match(read().error, /Linked threshold is unavailable/);
  page.links[bound.id].threshold = threshold.id;
  assert.equal(read().result.requirements.length, 2);
  page.regions.unshift(page.regions.splice(page.regions.indexOf(extra), 1)[0]);
  assert.deepEqual(
    read().result.requirements.map((r) => r.id),
    [extra.id, limit],
  );
  threshold.text = "renamed := 100 W";
  assert.match(read().error, /Linked threshold is unavailable/);
  extra.text = "renamed < allowed";
  assert.equal(read().result.requirements.length, 1);
  extra.text = "P < allowed";
  // A bad CSV masks the graph error, until the source is repaired.
  const csv = page.regions.find((r) => r.id === dataset).data;
  csv.csv = 'force,speed\n"unfinished';
  assert.match(read().error, /CSV quote/);
  csv.csv = "force,speed\n20,3";
  assert.match(read().error, /Linked threshold/);
  threshold.text = "threshold := 100 W";
  assert.equal(read().result.records[0].pass, true);
}
console.log(
  "Dataset state reuse, source and model invalidation, diagnostics and cold recovery pass.",
);

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
    if (unit === "°C") {
      const page = structuredClone(session.state),
        select = createDatasetStatesSelector(),
        read = () =>
          againstCold(page, relation, select(page, [relation])[relation.id]);
      assert.ok(read().result.records[0].value.absolute);
      page.regions.find((r) => r.id === input).text = `observed := ${raw} K`;
      assert.match(read().error, /units for observed/); // Same dimension, not absolute.
    }
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
