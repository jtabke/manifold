import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import {
  makeArtifact,
  prepare,
  acceptData,
  receiptMatchesJob,
  archive,
  restore,
} from "../src/regions/artifacts.ts";
const session = new RegionSession();
const ids = [];
for (const text of [
  "T = T_inf + Q/(h*A)",
  "T_inf := 25 °C",
  "Q := 800 W",
  "h := 60 W/(m^2 K)",
  "A := 0.2 m^2",
  "T <= 100 °C",
]) {
  const id = session.create();
  session.write(id, text);
  ids.push(id);
}
let artifact = makeArtifact(
  session.state,
  ids[0],
  "Plot temperature versus cooling area from 0.05 to 0.5 m²",
);
assert.equal(artifact.input, ids[4]);
assert.equal(artifact.output, ids[0]);
const job = prepare(session.state, artifact);
const centimetres = makeArtifact(
  session.state,
  ids[0],
  "Plot T versus A from 500 to 5000 cm^2",
);
assert.equal(centimetres.low, 0.05);
assert.equal(centimetres.high, 0.5);
const ambient = makeArtifact(
  session.state,
  ids[0],
  "Plot T versus T_inf from 0 to 50 °C",
);
assert.equal(ambient.low, 273.15);
assert.equal(ambient.high, 323.15);
assert.throws(
  () => makeArtifact(session.state, ids[0], "Plot T versus A from 1 to 2 W"),
  /units/,
);
assert.match(job.code, /linspace\(0.05, 0.5, 201\)/);
const data = {
  points: Array.from({ length: 201 }, (_, i) => {
    const x = 0.05 + (0.45 * i) / 200;
    return [x, 25 + 800 / (60 * x)];
  }),
  code_sha256: "f".repeat(64),
  runtime: {
    adapter: job.definitions.some((r) => r.mathVersion === 2)
      ? "bounded-python-sampler/2"
      : "bounded-python-sampler/1",
    python: "test",
  },
};
artifact = acceptData(session.state, artifact, job, data);
assert.equal(artifact.receipt.points.length, 201);
assert.equal(
  receiptMatchesJob(
    {
      ...artifact.receipt,
      definitions: artifact.receipt.definitions.map((r) =>
        Object.fromEntries(Object.entries(r).reverse()),
      ),
    },
    job,
  ),
  true,
);
assert.equal(
  receiptMatchesJob(
    {
      ...artifact.receipt,
      definitions: [...artifact.receipt.definitions].reverse(),
    },
    job,
  ),
  false,
);
assert.equal(
  receiptMatchesJob({ ...artifact.receipt, inputs: undefined }, job),
  false,
);
const before = semanticKey(session.state),
  count = session.receipts.length;
session.move(artifact.id, { x: 560, y: 500 });
assert.equal(prepare(session.state, artifact).key, job.key);
artifact = { ...artifact, renderer: "table" };
assert.equal(prepare(session.state, artifact).key, job.key);
assert.equal(semanticKey(session.state), before);
assert.equal(session.receipts.length, count);
assert.throws(
  () =>
    acceptData(session.state, artifact, job, {
      ...data,
      points: [
        [0.05, 0],
        [0.5, 0],
      ],
    }),
  /differ|sample/i,
);
session.branch();
session.write(ids[3], "h := 40 W/(m^2 K)");
assert.notEqual(prepare(session.state, artifact).key, job.key);
assert.throws(() => acceptData(session.state, artifact, job, data), /changed/i);
const snapshot = legacyWorkspace(session.state, [artifact]);
const restored = restore(snapshot);
assert.equal(restored.artifacts[0].id, artifact.id);
const linked = {
  ...artifact,
  views: [
    {
      id: "view-linked-table",
      renderer: "table",
      at: { x: 600, y: 500 },
      width: 600,
      height: 410,
    },
  ],
  compareContext: "original",
  comparing: true,
};
assert.equal(
  restore(legacyWorkspace(session.state, [linked])).artifacts[0].views[0].id,
  "view-linked-table",
);
assert.throws(
  () =>
    restore(
      legacyWorkspace(session.state, [
        { ...linked, views: [{ ...linked.views[0], input: ids[2] }] },
      ]),
    ),
  /archive/,
);
assert.throws(
  () =>
    restore(
      legacyWorkspace(session.state, [
        { ...linked, views: [{ ...linked.views[0], id: artifact.id }] },
      ]),
    ),
  /archive/,
);
assert.equal(restored.page.active, session.state.active);
assert.equal(project(restored.page).solved.values.get("h").value, 40);
const reopened = new RegionSession(restored.page);
const oldIds = reopened.state.regions.map((r) => r.id);
assert.ok(!oldIds.includes(reopened.create()));
assert.throws(() => restore('{"version":99}'));
assert.throws(() =>
  restore(
    JSON.stringify({
      ...JSON.parse(snapshot),
      artifacts: [{ ...artifact, input: "unknown" }],
    }),
  ),
);
session.write(ids[0], "T = invalid/(h*A)"); // shared edits unavailable in alternative
console.log(
  "Artifact identity, model-derived Python, analytical data parity, stale rejection, presentation independence, context and portable recovery passed.",
);

// A committed point can become an alternative without overwriting its source context.
const comparison = new RegionSession();
const inputId = comparison.create();
comparison.write(inputId, "A := .2 m^2");
const outputId = comparison.create();
comparison.write(outputId, "T = 800/(60*A)");
const baseline = comparison.state;
comparison.write(inputId, "A := .25 m^2");
const committed = comparison.state;
const candidate = comparison.branchEdit(inputId, baseline);
assert.equal(
  project(comparison.state, "original").solved.values.get("A").value,
  0.2,
);
assert.equal(
  project(comparison.state, candidate).solved.values.get("A").value,
  0.25,
);
assert.equal(
  project(comparison.state, candidate).bindings[outputId].A,
  inputId,
);
comparison.undo();
assert.equal(comparison.state, committed);
comparison.write(outputId, "T = 900/(60*A)");
assert.throws(
  () => comparison.branchEdit(inputId, baseline),
  /changed|compatible/i,
);
