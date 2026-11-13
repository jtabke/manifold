import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as f from "@manifold/foundation";
import {
  parse,
  evaluate,
  references,
  mathSource,
} from "../src/notebook/math.ts";
import { mathSource as locations } from "../src/regions/editing.ts";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  archive,
  decodeWorkspace,
  makeArtifact,
  prepare,
  acceptCapturedData,
} from "../src/regions/artifacts.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
} from "../src/regions/modelCommands.ts";
import { createModelAnalysis } from "../src/regions/modelAnalysisCommands.ts";
import { samplingReference } from "../src/regions/samplingPlans.ts";
import {
  createHeadlessWorkspace,
  openHeadlessWorkspace,
} from "manifold-canvas/headless";
import { editWorkspace } from "../src/agent.ts";
import { validateWorksheetReceipt } from "../src/regions/worksheetHistory.ts";
const close = (a, b) =>
  assert.ok(Math.abs(a - b) < 1e-10 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const eval3 = (text) =>
  evaluate(
    parse(`z := ${text}`, undefined, 3).expression,
    () => {
      throw Error("reference");
    },
    3,
  );
for (const [text, expected] of [
  ["floor(0.9999999999999999)", 1],
  ["ceil(1.0000000000000002)", 1],
  ["floor(-1.0000000000000002)", -1],
  ["ceil(-0.9999999999999999)", -1],
  ["round(0.49999999999999994)", 1],
  ["round(-0.49999999999999994)", -1],
  ["round(1.4999999999999998)", 2],
  ["round(-1.5)", -2],
  ["sin(asin(0.5))", 0.5],
  ["cos(acos(-0.5))", -0.5],
  ["tan(atan(2))", 2],
])
  close(eval3(text).value, expected);
// Differential boundary fixtures use the actual worksheet kernels as the oracle,
// including relative/absolute tolerance selection and both signs. Python executes
// through its AST whitelist, not a special numerical test-only path.
const boundaries = [
  0.49999999999999994, -0.49999999999999994, 0.9999999999999999,
  1.0000000000000002, -1.0000000000000002,
];
for (const base of [0, 0.5, 1, 1.5, 2, 10.5, 1000, 1e9, 1e12 - 1])
  for (const sign of [-1, 1])
    for (const delta of [
      0, 1e-16, -1e-16, 4e-13, -4e-13, 6e-13, -6e-13, 2e-12, -2e-12, 1e-9,
      -1e-9,
    ])
      boundaries.push(sign * (base + delta));
const differential = ["round", "floor", "ceil"].flatMap((name) =>
  boundaries.map((value) => ({ name, value })),
);
const pythonBoundaryResults = JSON.parse(
  execFileSync(
    process.env.PYTHON || "python3",
    [
      "-I",
      "-c",
      `import sys,json; sys.path.insert(0,sys.argv[1]); from artifact_sampler import execute; print(json.dumps([execute({"code":"x = linspace(0, 1, 2)\\ny = ["+v["name"]+"(v0) for a in x]", "inputs":{"v0":v["value"]}, "mathVersion":3})["points"][0][1] for v in json.load(sys.stdin)]))`,
      fileURLToPath(new URL("../", import.meta.url)),
    ],
    { input: JSON.stringify(differential), encoding: "utf8", timeout: 10000 },
  ),
);
for (const [i, { name, value }] of differential.entries())
  assert.ok(
    pythonBoundaryResults[i] === eval3(`${name}(${value})`).value,
    `${name}(${value}) Python/worksheet`,
  );
for (const [body, expected] of [
  ["(-8)^(1/3)", -2],
  ["(-8)^(2/3)", 4],
  ["(-32)^0.2", -2],
])
  close(
    evaluate(
      parse(`z := ${body}`, undefined, 2).expression,
      () => {
        throw Error("reference");
      },
      2,
    ).value,
    expected,
  );
for (const name of [
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "floor",
  "ceil",
  "round",
  "cbrt",
]) {
  assert.throws(() => parse(`${name} := 2`, undefined, 3), /reserved/);
  assert.throws(() => parse(`z := ${name}()`, undefined, 3), /1 arguments/);
  assert.throws(() => parse(`z := ${name}(1,2)`, undefined, 3), /1 arguments/);
  assert.throws(() => parse(`z := ${name}`, undefined, 3), /parentheses/);
  const statement = parse(`z := ${name}(x+1)`, undefined, 3),
    source = locations(statement, statement.raw);
  assert.deepEqual(references(statement.expression), ["x"]);
  assert.equal(
    statement.raw.slice(
      source.expressions.get(statement.expression).operator.start,
      source.expressions.get(statement.expression).operator.end,
    ),
    name,
  );
}
assert.deepEqual(references(parse("z := x(y+1)", undefined, 3).expression), [
  "x",
  "y",
]);
for (const text of ["foo()", "foo(1,2)"])
  assert.throws(
    () => parse(`z := ${text}`, undefined, 3),
    /Unsupported scientific function foo/,
  );
// Every new function is exercised through authored worksheet, compiler, native model
// analysis and actual bounded Python, against independent JS numerical references.
const cases = [
  ["asin(x)/(1 rad)", Math.asin, -0.5, 0.5],
  ["acos(x)/(1 rad)", Math.acos, -0.5, 0.5],
  ["atan(x)/(1 rad)", Math.atan, -2, 2],
  ["sinh(x)", Math.sinh, -2, 2],
  ["cosh(x)", Math.cosh, -2, 2],
  ["tanh(x)", Math.tanh, -2, 2],
  ["floor(x)", Math.floor, -2.5, 2.5],
  ["floor(x)", (n) => eval3(`floor(${n})`).value, 0.9999999999999999, 1.5],
  ["ceil(x)", (n) => eval3(`ceil(${n})`).value, 1.0000000000000002, 2.5],
  ["ceil(x)", Math.ceil, -2.5, 2.5],
  ["round(x)", (n) => Math.sign(n) * Math.floor(Math.abs(n) + 0.5), -2.5, 2.5],
  ["cbrt(x m^3)", Math.cbrt, -8, 8],
];
const sample = (job) =>
  JSON.parse(
    execFileSync(
      process.env.PYTHON || "python3",
      [
        "-I",
        fileURLToPath(new URL("../artifact_sampler.py", import.meta.url)),
        "--child",
      ],
      {
        input: JSON.stringify({
          code: job.code,
          inputs: job.inputs,
          mathVersion: Math.max(
            1,
            ...job.definitions.map((r) => r.mathVersion ?? 1),
          ),
        }),
        encoding: "utf8",
        timeout: 5000,
      },
    ),
  );
for (const [body, reference, low, high] of cases) {
  const session = new RegionSession();
  const x = session.create();
  session.write(x, `x := ${low}`);
  const y = session.create();
  session.write(y, `y := ${body}`);
  assert.equal(session.state.regions.find((r) => r.id === y).mathVersion, 3);
  close(project(session.state).solved.values.get("y").value, reference(low));
  const definition = publishModel(session, "v3", {
    rows: session.state.regions.map(mathSource),
    inputs: [x],
    outputs: [y],
  });
  const instance = instantiateModel(
    session,
    modelReference(session.document, definition),
    { x: 0, y: 500 },
  );
  const output = f.project(
    session.document,
    modelReference(session.document, instance, f.modelPort(y)),
    canvasSchemas,
    session.foundation.resources(),
  );
  assert.equal(output.status, "resolved");
  close(output.projection.value.value, reference(low));
  const analysis = createModelAnalysis(
    session,
    instance,
    { input: x, output: y, low, high, points: 11 },
    { x: 500, y: 500 },
  );
  const target = modelReference(session.document, analysis);
  assert.equal((await session.compute(target).completion).status, "retained");
  for (const [a, b] of session.foundation.result(target).receipt.outcome.output
    .body.points)
    close(b, reference(a));
  const artifact = makeArtifact(
    session.state,
    y,
    `Plot y versus x from ${low} to ${high}`,
  );
  const job = prepare(session.state, artifact, session.document),
    data = sample(job);
  assert.equal(data.runtime.adapter, "bounded-python-sampler/3");
  const checked = acceptCapturedData(artifact, job, data).receipt;
  for (const [a, b] of checked.points) close(b, reference(a));
  assert.throws(
    () =>
      acceptCapturedData(artifact, job, {
        ...data,
        runtime: { ...data.runtime, adapter: "bounded-python-sampler/2" },
      }),
    /Unsupported Python result/,
  );
  const receipt = session.currentCalculation();
  assert.equal(receipt.version, 3);
  validateWorksheetReceipt(receipt);
  session.keepCurrentCalculation("v3");
  const bytes = archive(session.native());
  assert.equal(JSON.parse(bytes).version, 9);
  const decoded = await decodeWorkspace(bytes),
    reopened = new RegionSession(
      decoded.page,
      undefined,
      decoded.document,
      decoded.artifacts,
      false,
      decoded.recovery,
      { artifactExecutor: null },
    );
  close(project(reopened.state).solved.values.get("y").value, reference(low));
  assert.equal(
    reopened.foundation.result(modelReference(reopened.document, analysis))
      .status,
    "current",
  );
  session.dispose();
  reopened.dispose();
}
// A new-authoring default must not change the interpretation of old notes when
// ordinary edits run the alternative-context shared-equation guard.
for (const version of [undefined, 2]) {
  const session = new RegionSession({
    regions: [
      {
        id: "note",
        text: "round(1)",
        ...(version === undefined ? {} : { mathVersion: version }),
      },
    ],
    contexts: [
      { id: "original", label: "Original", base: {}, overrides: {} },
      { id: "alternative", label: "Alternative", base: {}, overrides: {} },
    ],
    active: "alternative",
    plots: [],
    layout: {},
    origin: { x: 0, y: 0 },
  });
  try {
    assert.equal(project(session.state).kinds.note, "note");
    for (const text of ["round(2)", "A revised explanatory note"]) {
      assert.equal(session.write("note", text).ok, true);
      assert.equal(project(session.state).texts.note, text);
      assert.equal(project(session.state).kinds.note, "note");
      assert.equal(session.state.regions[0].mathVersion, version);
    }
    session.undo();
    assert.equal(project(session.state).texts.note, "round(2)");
    session.undo();
    assert.equal(project(session.state).texts.note, "round(1)");
  } finally {
    session.dispose();
  }
}
// Saved v2 names, old receipts, ordinary edits, upgrade collisions, Undo and import.
const old = new RegionSession({
  regions: [
    { id: "r", text: "round:=2", mathVersion: 2 },
    { id: "x", text: "x:=3", mathVersion: 2 },
    { id: "y", text: "y:=round(x+1)", mathVersion: 2 },
  ],
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  plots: [],
  layout: {},
  origin: { x: 0, y: 0 },
});
const receipt = old.currentCalculation();
assert.equal(receipt.version, 2);
validateWorksheetReceipt(receipt);
old.keepCurrentCalculation("saved v2");
old.write("y", "y:=round(x+1)+0");
assert.equal(old.state.regions[2].mathVersion, 2);
close(project(old.state).solved.values.get("y").value, 8);
old.enableScientificMathV3("r");
assert.match(project(old.state).errors.get("r"), /reserved/);
old.undo();
old.enableScientificMathV3("y");
close(project(old.state).solved.values.get("y").value, 4);
assert.notEqual(old.currentCalculation().key, receipt.key);
old.enableScientificMath("y");
assert.equal(old.state.regions[2].mathVersion, 3); // old API never downgrades
old.undo();
close(project(old.state).solved.values.get("y").value, 8);
// Retain actual v2 Python evidence, then reopen without installing an executor.
const oldArtifact = makeArtifact(old.state, "y", "Plot y versus x from 2 to 4");
const oldJob = prepare(old.state, oldArtifact, old.document);
const oldData = sample(oldJob);
assert.equal(oldData.runtime.adapter, "bounded-python-sampler/2");
assert.doesNotMatch(oldJob.code, /round\(/);
const oldChecked = acceptCapturedData(oldArtifact, oldJob, oldData).receipt;
assert.equal(oldChecked.points[0][1], 6);
assert.equal(oldChecked.points.at(-1)[1], 10);
const evidenceOwner = new RegionSession(
  old.state,
  undefined,
  old.document,
  [],
  false,
  undefined,
  { artifactExecutor: async (job) => sample(job) },
);
evidenceOwner.setArtifacts([oldArtifact]);
const oldTarget = samplingReference(
  evidenceOwner.document,
  oldArtifact.id,
  evidenceOwner.state.active,
);
assert.equal(
  (await evidenceOwner.compute(oldTarget).completion).status,
  "retained",
);
assert.equal(
  evidenceOwner.foundation.result(oldTarget).receipt.snapshot.method.version,
  "2",
);
const oldDecoded = await decodeWorkspace(archive(evidenceOwner.native()));
const evidenceReopened = new RegionSession(
  oldDecoded.page,
  undefined,
  oldDecoded.document,
  oldDecoded.artifacts,
  false,
  oldDecoded.recovery,
  { artifactExecutor: null },
);
assert.equal(
  evidenceReopened.artifacts[0].receipt.runtime.adapter,
  "bounded-python-sampler/2",
);
assert.equal(
  evidenceReopened.computations.read(oldArtifact.id, "original").current,
  true,
);
assert.equal(oldDecoded.page.calculations[0].snapshot.version, 2);
evidenceOwner.dispose();
evidenceReopened.dispose();
const api = await openHeadlessWorkspace(archive(old.native()));
editWorkspace(api, {
  expectedDocumentId: api.read().id,
  edits: [{ operation: "enableScientificMathV3", region: "y" }],
});
assert.equal(
  api.worksheet().regions.find((r) => r.id === "y").quantity.value,
  4,
);
api.undo(api.read().id);
assert.equal(
  api.worksheet().regions.find((r) => r.id === "y").quantity.value,
  8,
);
const fresh = createHeadlessWorkspace();
editWorkspace(fresh, {
  expectedDocumentId: fresh.read().id,
  edits: [
    { operation: "createEquation", text: "z:=cbrt(-8 m^3)" },
    { operation: "createEquation", text: "a:=asin(0.5)" },
    { operation: "createEquation", text: "r:=round(-1.5)" },
  ],
});
const reopened = await openHeadlessWorkspace(fresh.export());
assert.equal(
  reopened.worksheet().regions.find((r) => r.name === "z").quantity.value,
  -2,
);
assert.equal(
  reopened.worksheet().regions.find((r) => r.name === "r").quantity.value,
  -2,
);
const dir = mkdtempSync(join(tmpdir(), "manifold-v3-cli-"));
try {
  const path = join(dir, "v3.manifold");
  writeFileSync(path, fresh.export());
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url)),
        "worksheet",
        path,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(result.regions.find((r) => r.name === "z").mathVersion, 3);
  close(result.regions.find((r) => r.name === "a").quantity.value, Math.PI / 6);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
for (const owner of [old, api, fresh, reopened]) owner.dispose();
console.log(
  "Scientific v3: ten functions across worksheet/model/analysis/Python, Math.js-tolerant rounding, domains, spans, versioned evidence, native/headless/CLI and saved-v2 upgrade/Undo pass.",
);
