import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as f from "@manifold/foundation";
import {
  calculate,
  parse,
  evaluate,
  references,
  same,
  mathSource,
  quantityLiteral,
} from "../src/notebook/math.ts";
import {
  csvQuantity,
  matchesMeasurementText,
} from "../src/regions/dataSources.ts";
import {
  optimizationQuantity,
  optimizationConvert,
} from "../src/regions/optimizationQuantities.ts";
import { mathSource as spans } from "../src/regions/editing.ts";
import {
  scientificScalarCall,
  v3ScalarFunctions,
  scientificFunctions,
} from "../src/notebook/scientific.ts";
import { engineeringValue } from "../src/regions/systemExploration.ts";
import { RegionSession, project, curve } from "../src/regions/document.ts";
import { proposeValue, previewPage } from "../src/regions/exploration.ts";
import {
  archive,
  decodeWorkspace,
  makeArtifact,
  prepare,
  acceptCapturedData,
} from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { validateWorksheetReceipt } from "../src/regions/worksheetHistory.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  modelRequest,
  setModelInput,
} from "../src/regions/modelCommands.ts";
import { createModelAnalysis } from "../src/regions/modelAnalysisCommands.ts";
import { samplingReference } from "../src/regions/samplingPlans.ts";
import {
  openHeadlessWorkspace,
  createHeadlessWorkspace,
} from "manifold-canvas/headless";
import {
  editWorkspace as applyAgentEdits,
  agentCapabilities,
} from "../src/agent.ts";

const close = (a, b) =>
  assert.ok(
    Math.abs(a - b) <= 1e-11 * Math.max(1, Math.abs(b)),
    `${a} != ${b}`,
  );
const resolveNone = () => {
  throw Error("Unexpected reference");
};
const expression = (text) =>
  evaluate(parse(`result = ${text}`, undefined, 2).expression, resolveNone, 2);
// Unit-only entry fields share one bounded suffix grammar. Worksheet formulas
// retain ordinary variable binding outside explicit numeric unit suffixes.
for (const [unit, canonical, scale] of [
  ["min", "s", 60],
  ["min^-1", "s^-1", 1 / 60],
  ["V*A", "W", 1],
  ["A*ohm", "V", 1],
  ["1/A", "A^-1", 1],
  ["1/(V*A)", "W^-1", 1],
  ["V/(A*s)", "kg*m^2*s^-4*A^-2", 1],
  ["cm^2", "m^2", 0.0001],
  ["in*ft", "m^2", 0.0254 * 0.3048],
]) {
  const expected = 2 * scale,
    imported = csvQuantity(
      { name: "entry.csv", csv: "reading\n2" },
      0,
      0,
      "q",
      unit,
    ),
    statement = parse(imported.text, undefined, 3),
    q = evaluate(statement.expression, resolveNone, 3);
  close(q.value, expected);
  assert.equal(quantityLiteral(statement.expression), true, unit);
  close(optimizationQuantity(`2 ${unit}`, canonical), expected);
  close(optimizationQuantity(`2 (${unit})`, canonical), expected);
  close(optimizationConvert(2, unit, canonical), expected);
  close(optimizationQuantity("2", unit), 2);
  const session = new RegionSession();
  try {
    const area = session.create();
    session.write(area, "A := 50 m^2");
    const input = session.create();
    session.write(input, imported.text);
    const proposal = proposeValue(session.state, input, expected + 1),
      preview = project(previewPage(session.state, proposal));
    assert.equal(preview.errors.size, 0, unit);
    close(preview.solved.values.get("q").value, expected + 1);
    assert.ok(same(preview.solved.values.get("q").dimension, q.dimension));
    close(project(session.state).solved.values.get("q").value, expected);
  } finally {
    session.dispose();
  }
}
for (const [body, expected, dimension] of [
  ["2 min", 120],
  ["2*min", 120, [0, 0, 1, 0]],
  ["1/min", 1 / 60, [0, 0, -1, 0]],
  ["2 m/min", 2 / 60, [0, 1, -1, 0]],
  ["min(2 min,3 min)", 120],
  ["2 (V*min)", 120],
  ["2 min(1,3)", 2],
  ["min(4,3)", 3],
]) {
  const statement = parse(`duration := ${body}`, undefined, 3);
  const quantity = evaluate(statement.expression, resolveNone, 3);
  close(quantity.value, expected);
  if (dimension) assert.ok(same(quantity.dimension, dimension), body);
}
for (const body of ["min", "x*min"])
  assert.throws(
    () => parse(`duration := ${body}`, undefined, 3),
    /parentheses/,
  );
for (const version of [1, 2]) {
  const legacy = parse("duration := 2 min", undefined, version);
  assert.deepEqual(references(legacy.expression), version === 1 ? ["min"] : []);
  if (version === 1)
    close(
      evaluate(
        legacy.expression,
        () => ({ value: 3, dimension: [0, 0, 0, 0] }),
        1,
      ).value,
      6,
    );
  else close(evaluate(legacy.expression, resolveNone, 2).value, 120);
  for (const [body, value] of [
    ["2*min", 6],
    ["1/min", 1 / 3],
  ]) {
    const prior = parse(`duration := ${body}`, undefined, version);
    assert.deepEqual(references(prior.expression), ["min"]);
    close(
      evaluate(
        prior.expression,
        () => ({ value: 3, dimension: [0, 0, 0, 0] }),
        version,
      ).value,
      value,
    );
  }
}
assert.equal(matchesMeasurementText("q := 120 (s)", "q", "2", "min"), true);
assert.equal(matchesMeasurementText("q := 180 (s)", "q", "2", "min"), false);
assert.equal(matchesMeasurementText("q := 275.15 (K)", "q", "2", "°C"), false);
close(optimizationQuantity("1e20", "m"), 1e20);
close(optimizationQuantity("-2 V*A", "W"), -2);
for (const text of [
  "A",
  "h",
  "min(1,2)",
  "floor(2)",
  "sin(1)",
  "pi",
  "2*pi",
  "2+3",
  "2*3",
  "2/3",
  "2*1",
  "2/1",
  "2 m+1 m",
  "2*3 m",
  "2 (m+1m)",
  "2 m^13",
  "1e999",
  "2 (GPa^12)^12",
  "25 °C",
]) {
  assert.throws(() => optimizationQuantity(text, "m"), undefined, text);
  assert.throws(() => optimizationQuantity(text, "1"), undefined, text);
}
for (const [text, unit] of [
  ["2 s", "m"],
  ["2 min", "m"],
  ["2 V*A", "A"],
  ["2", "°C"],
])
  assert.throws(() => optimizationQuantity(text, unit));
for (const [value, from, to] of [
  [Infinity, "m", "m"],
  [1e308, "GPa", "Pa"],
  [2, "s", "m"],
  [2, "°C", "K"],
  [2, "K", "°C"],
])
  assert.throws(() => optimizationConvert(value, from, to));
for (const [text, expected, dimension] of [
  ["sin(30 deg)", 0.5, [0, 0, 0, 0]],
  ["cos(pi rad)", -1, [0, 0, 0, 0]],
  ["tan(45 deg)", 1, [0, 0, 0, 0]],
  ["sqrt(100 mm^2)", 0.01, [0, 1, 0, 0]],
  ["abs(-3 m)", 3, [0, 1, 0, 0]],
  ["exp(0)", 1, [0, 0, 0, 0]],
  ["ln(e)", 1, [0, 0, 0, 0]],
  ["log10(100)", 2, [0, 0, 0, 0]],
  ["min(1 m, 20 cm)", 0.2, [0, 1, 0, 0]],
  ["max(1 m, 20 cm)", 1, [0, 1, 0, 0]],
  ["atan2(1 m, 1 m)", Math.PI / 4, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["1 in", 0.0254, [0, 1, 0, 0]],
  ["1 ft", 0.3048, [0, 1, 0, 0]],
  ["1 lbf", 4.4482216152605, [1, 1, -2, 0]],
  ["2 V / (4 ohm)", 0.5, [0, 0, 0, 0, 1]],
  ["25 degC + 5 K", 303.15, [0, 0, 0, 1]],
  ["100 degC - 25 degC", 75, [0, 0, 0, 1]],
  ["-2^2", -4, [0, 0, 0, 0]],
  ["2^3^2", 512, [0, 0, 0, 0]],
]) {
  const q = expression(text);
  close(q.value, expected);
  assert.ok(same(q.dimension, dimension), text);
}
// Staged numerical kernels. These names MUST NOT enter the saved v2 grammar:
// existing source uses them as ordinary variables and juxtaposition products.
const candidate = (name, text) =>
  evaluate(
    parse(`result = ${name}(${text})`, undefined, 3).expression,
    resolveNone,
    3,
  );
for (const [name, input, expected, dimension] of [
  ["asin", "0.5", Math.PI / 6, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["asin", "-1", -Math.PI / 2, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["acos", "-1", Math.PI, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["acos", "1", 0, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["atan", "1", Math.PI / 4, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["atan", "-1", -Math.PI / 4, [0, 0, 0, 0, 0, 0, 0, 1]],
  ["sinh", "1", Math.sinh(1), [0, 0, 0, 0]],
  ["cosh", "-1", Math.cosh(-1), [0, 0, 0, 0]],
  ["tanh", "-2", Math.tanh(-2), [0, 0, 0, 0]],
  ["tanh", "1000", 1, [0, 0, 0, 0]],
  ["floor", "-1.2", -2, [0, 0, 0, 0]],
  ["ceil", "-1.2", -1, [0, 0, 0, 0]],
  ["round", "-1.5", -2, [0, 0, 0, 0]],
  ["round", "1.5", 2, [0, 0, 0, 0]],
  ["round", "-0.5", -1, [0, 0, 0, 0]],
  ["round", "2.49", 2, [0, 0, 0, 0]],
  ["cbrt", "-8", -2, [0, 0, 0, 0]],
  ["cbrt", "0", 0, [0, 0, 0, 0]],
  ["cbrt", "-8 m^3", -2, [0, 1, 0, 0]],
  ["cbrt", "8 cm^3", 0.02, [0, 1, 0, 0]],
  ["cbrt", "8 m", 2, [0, 1 / 3, 0, 0]],
  ["cbrt", "8 m^3/s^3", 2, [0, 1, -1, 0]],
  ["cbrt", "8 K^3", 2, [0, 0, 0, 1]],
]) {
  const q = candidate(name, input);
  close(q.value, expected);
  assert.ok(same(q.dimension, dimension), `${name}(${input})`);
}
for (const name of Object.keys(v3ScalarFunctions)) {
  assert.equal(Object.hasOwn(scientificFunctions, name), false);
  assert.throws(() => candidate(name, "25 degC"), /absolute Celsius/);
  for (const value of [Infinity, -Infinity, NaN])
    assert.throws(
      () => scientificScalarCall(name, { value, dimension: [0, 0, 0, 0] }),
      /finite real/,
    );
  if (name !== "cbrt")
    for (const input of ["1 m", "1 rad", "1 deg", "1 K"])
      assert.throws(() => candidate(name, input), /dimensionless/);
  const saved = parse(`y = ${name}(x+1)`, undefined, 2);
  assert.deepEqual(references(saved.expression), [name, "x"]);
  assert.equal(saved.expression.kind, "binary");
  assert.equal(saved.expression.op, "*");
  const locations = spans(saved, saved.raw);
  const productLocation = locations.expressions.get(saved.expression);
  assert.equal(productLocation.operator.start, productLocation.operator.end);
  assert.equal(
    saved.raw.slice(
      locations.expressions.get(saved.expression.left).span.start,
      locations.expressions.get(saved.expression.left).span.end,
    ),
    name,
  );
  for (const mathVersion of [1, 2]) {
    const solved = calculate(
      [`${name} = 2`, "x = 3", `y = ${name}(x+1)`].map((text, i) => ({
        id: String(i),
        text,
        x: 0,
        y: 0,
        ...(mathVersion === 2 ? { mathVersion } : {}),
      })),
    );
    assert.equal(solved.errors.size, 0, `${name}, v${mathVersion}`);
    assert.equal(solved.values.get("y").value, 8);
  }
}
for (const name of ["asin", "acos"])
  for (const input of ["1.000000000001", "-1.000000000001"])
    assert.throws(() => candidate(name, input), /from −1 to 1/);
for (const name of ["sinh", "cosh"])
  assert.throws(() => candidate(name, "1000"), /finite real/);
assert.throws(
  () => scientificScalarCall("constructor", expression("1")),
  /Unsupported scalar function/,
);

for (const text of [
  "ln(0)",
  "sqrt(-1)",
  "exp(2 m)",
  "sin(1 m)",
  "atan2(1 m, 1 s)",
  "atan2(0,0)",
  "min(1 m, 1 s)",
  "sqrt(1,2)",
  "exp(10000)",
  "1/0",
  "25 degC * 2",
  "25 degC + 30 degC",
  "5 K - 25 degC",
  "cos(25 degC)",
  "x[1]",
  "x.constructor",
  "__proto__",
  "constructor",
  "[1,2]",
  'import("x")',
  "2;3",
  "1e999",
  "(".repeat(33) + "1" + ")".repeat(33),
  "1" + "+1".repeat(130),
])
  assert.throws(() => expression(text), text);
const call = parse("Fx = F*cos(theta)", undefined, 2);
assert.deepEqual(references(call.expression), ["F", "theta"]);
assert.ok(
  [...spans(call, call.raw).expressions].some(
    ([e, s]) =>
      e.kind === "call" &&
      call.raw.slice(s.span.start, s.span.end) === "cos(theta)",
  ),
);
const nested = parse("L = sqrt((abs(-4 m^2)))", undefined, 2);
assert.equal(
  [...spans(nested, nested.raw).expressions].find(
    ([e]) => e === nested.expression,
  )[1].span.end,
  nested.raw.length,
);
// New unit symbols do not consume common variable names or reciprocal expressions.
for (const mathVersion of [2, 3]) {
  const variables = calculate(
    [
      "A = 2 m^2",
      "h = 3 W/(m^2 K)",
      "R = 1/A",
      "q = h*A",
      "power = 1 W/m^2*A",
    ].map((text, i) => ({
      id: String(i),
      text,
      x: 0,
      y: 0,
      mathVersion,
    })),
  );
  assert.equal(variables.errors.size, 0);
  close(variables.values.get("R").value, 0.5);
  close(variables.values.get("power").value, 2);
  assert.ok(same(variables.values.get("power").dimension, [1, 2, -3, 0]));
}
const mixed = calculate([
  { id: "angle", text: "angle=30 deg", x: 0, y: 0, mathVersion: 2 },
  { id: "old", text: "old=2*angle", x: 0, y: 0 },
]);
assert.match(mixed.errors.get("old"), /Enable scientific math/);
// Historical parser/evaluator and symbol meanings are fixed, including variables named sin/pi.
const historical = new RegionSession({
  regions: [
    { id: "s", text: "sin = 2" },
    { id: "x", text: "x = 3" },
    { id: "y", text: "y = sin(x+1)" },
  ],
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  layout: {},
  plots: [],
  origin: { x: 0, y: 0 },
});
assert.equal(project(historical.state).solved.values.get("y").value, 8);
const oldReceipt = historical.currentCalculation();
validateWorksheetReceipt(oldReceipt);
assert.equal(oldReceipt.version, 1);
historical.keepCurrentCalculation("Historical interpretation");
historical.enableScientificMath("y");
close(project(historical.state).solved.values.get("y").value, Math.sin(4));
historical.undo();
assert.equal(project(historical.state).solved.values.get("y").value, 8);

const sampler = (job) =>
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
          ...(job.definitions.some((r) => r.mathVersion)
            ? {
                mathVersion: Math.max(
                  ...job.definitions.map((r) => r.mathVersion ?? 1),
                ),
              }
            : {}),
        }),
        encoding: "utf8",
        timeout: 5000,
      },
    ),
  );
for (const rows of [
  [
    "x = 1",
    "y = sqrt(x^2)+abs(-x)+sin(x)+cos(x)+tan(x)+exp(x)+ln(x)+log10(x)+min(x,2)+max(x,2)+atan2(x,1)/(1 rad)",
  ],
  ["x = 60 degC", "y = x-25 degC"],
  ["A = 2 m^2", "y = 1 W/m^2*A"],
  ...Object.keys(v3ScalarFunctions).map((name) => [
    "x = 1",
    `y = ${name}(x+1)`,
    `${name} = 2`,
  ]),
]) {
  const fixture = new RegionSession({
    regions: rows.map((text, i) => ({
      id: `saved-${i}`,
      text,
      mathVersion: 2,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    plots: [],
    layout: {},
    origin: { x: 0, y: 0 },
  });
  const output = fixture.state.regions.find((r) => r.text === rows[1]).id;
  const artifact = makeArtifact(
    fixture.state,
    output,
    rows[0].startsWith("A")
      ? "Plot y versus A from 1 to 3 m^2"
      : rows[0].includes("degC")
        ? "Plot y versus x from 30 to 80 degC"
        : "Plot y versus x from 0.5 to 1",
  );
  const captured = prepare(fixture.state, artifact, fixture.document);
  const receipt = acceptCapturedData(
    artifact,
    captured,
    sampler(captured),
  ).receipt;
  assert.equal(receipt.points.length, 201);
  assert.throws(
    () =>
      acceptCapturedData(artifact, captured, {
        ...sampler(captured),
        runtime: { adapter: "bounded-python-sampler/1", python: "wrong" },
      }),
    /Unsupported Python result/,
  );
  if (rows[0].includes("degC")) {
    close(receipt.points[0][1], 5);
    close(receipt.points.at(-1)[1], 55);
  }
  if (rows[0].startsWith("A")) {
    close(receipt.points[0][1], artifact.low);
    close(receipt.points.at(-1)[1], artifact.high);
  }
  if (rows.length === 3) {
    // Persisted v2 names survive worksheet projection, model compilation and
    // canonical Python lowering without being mistaken for new function calls.
    close(receipt.points[0][1], 3);
    close(receipt.points.at(-1)[1], 4);
    assert.doesNotMatch(
      captured.code,
      /\b(?:asin|acos|atan|sinh|cosh|tanh|floor|ceil|round|cbrt)\(/,
    );
    const input = fixture.state.regions.find((r) => r.text === rows[0]).id;
    const definition = publishModel(fixture, "Saved v2 name", {
      rows: fixture.state.regions.map(mathSource),
      inputs: [input],
      outputs: [output],
    });
    const instance = instantiateModel(
      fixture,
      modelReference(fixture.document, definition),
      { x: 0, y: 500 },
    );
    const projected = f.project(
      fixture.document,
      modelReference(fixture.document, instance, f.modelPort(output)),
      canvasSchemas,
      fixture.foundation.resources(),
    );
    assert.equal(projected.status, "resolved");
    close(projected.projection.value.value, 4);
  }
  fixture.dispose();
}
const s = new RegionSession(
  undefined,
  undefined,
  undefined,
  [],
  false,
  undefined,
  { artifactExecutor: async (job) => sampler(job) },
);
const add = (text) => {
  const id = s.create();
  assert.equal(s.write(id, text).ok, true);
  return id;
};
const theta = add("theta := 30 deg"),
  force = add("F := 500 N"),
  fx = add("Fx := F*cos(theta)"),
  requirement = add("Fx >= 400 N");
close(project(s.state).solved.values.get("Fx").value, (500 * Math.sqrt(3)) / 2);
assert.equal(project(s.state).solved.constraints.get(requirement).pass, true);
const baseline = s.state;
assert.equal(
  engineeringValue(
    {
      ...baseline,
      regions: baseline.regions.map((r) =>
        r.id === theta ? { ...r, displayUnit: "deg" } : r,
      ),
    },
    theta,
  ),
  "30 deg",
);
const proposal = proposeValue(baseline, theta, Math.PI / 3),
  preview = previewPage(baseline, proposal);
close(project(preview).solved.values.get("Fx").value, 250);
assert.equal(project(preview).solved.constraints.get(requirement).pass, false);
assert.equal(s.state, baseline);
s.branchValue(theta, proposal.text);
close(project(s.state).solved.values.get("Fx").value, 250);
s.undo();
assert.equal(s.state, baseline);
const sampled = curve(s.state, {
  input: theta,
  output: fx,
  low: 0,
  high: Math.PI / 2,
});
close(sampled.points[0].y, 500);
close(sampled.points.at(-1).y, 0);
const receipt = s.currentCalculation();
validateWorksheetReceipt(receipt);
assert.equal(receipt.method, "manifold-worksheet/3");
const kept = s.keepCurrentCalculation("Original force projection");
const corrupt = structuredClone(receipt);
corrupt.method = "manifold-worksheet/1";
assert.throws(() => validateWorksheetReceipt(corrupt));
// Real bounded Python sampling uses captured scientific source, shared checked admission and versioned methods.
const artifact = makeArtifact(
  s.state,
  fx,
  "Plot Fx versus theta from 0 to 90 deg",
);
s.setArtifacts([artifact]);
const samplingTarget = samplingReference(
  s.document,
  artifact.id,
  s.state.active,
);
assert.equal((await s.compute(samplingTarget).completion).status, "retained");
assert.equal(
  s.foundation.result(samplingTarget).receipt.snapshot.method.version,
  "3",
);
assert.equal(
  s.artifacts[0].receipt.runtime.adapter,
  "bounded-python-sampler/3",
);
close(s.artifacts[0].receipt.points[0][1], 500);
close(s.artifacts[0].receipt.points.at(-1)[1], 0);
const job = prepare(s.state, s.artifacts[0], s.document);
assert.throws(() =>
  acceptCapturedData(s.artifacts[0], job, {
    ...sampler(job),
    runtime: { adapter: "bounded-python-sampler/1", python: "fake" },
  }),
);
const source = {
  rows: s.state.regions
    .filter((r) => [theta, force, fx].includes(r.id))
    .map(mathSource),
  inputs: [theta, force],
  outputs: [fx],
};
const definition = publishModel(s, "Force projection", source);
const a = instantiateModel(s, modelReference(s.document, definition), {
  x: 0,
  y: 500,
});
const b = instantiateModel(s, modelReference(s.document, definition), {
  x: 500,
  y: 500,
});
const output = (session, id) => {
  const value = f.project(
    session.document,
    modelReference(session.document, id, f.modelPort(fx)),
    canvasSchemas,
    session.foundation.resources(),
  );
  assert.equal(value.status, "resolved", JSON.stringify(value));
  return value.projection.value.value;
};
close(output(s, a), (500 * Math.sqrt(3)) / 2);
setModelInput(s, b, theta, Math.PI / 3);
close(output(s, b), 250);
close(output(s, a), (500 * Math.sqrt(3)) / 2);
assert.equal(
  (await s.compute(modelReference(s.document, modelRequest(a))).completion)
    .status,
  "retained",
);
const analysis = createModelAnalysis(
  s,
  a,
  { input: theta, output: fx, low: 0, high: Math.PI / 2, points: 201 },
  { x: 1000, y: 500 },
);
const analysisTarget = modelReference(s.document, analysis);
assert.equal((await s.compute(analysisTarget).completion).status, "retained");
const points =
  s.foundation.result(analysisTarget).receipt.outcome.output.body.points;
assert.equal(points.length, 201);
for (const [i, point] of points.entries()) {
  close(point[0], (i * Math.PI) / 400);
  close(point[1], 500 * Math.cos((i * Math.PI) / 400));
}
// No executor installed on fresh native Open: all checked evidence survives without new jobs.
const native = archive(s.native());
const decoded = await decodeWorkspace(native);
const reopened = new RegionSession(
  decoded.page,
  undefined,
  decoded.document,
  decoded.artifacts,
  false,
  decoded.recovery,
  { artifactExecutor: null },
);
close(
  project(reopened.state).solved.values.get("Fx").value,
  (500 * Math.sqrt(3)) / 2,
);
assert.equal(
  reopened.state.calculations.find((c) => c.id === kept).snapshot.method,
  "manifold-worksheet/3",
);
assert.equal(
  reopened.foundation.result(modelReference(reopened.document, analysis))
    .status,
  "current",
);
assert.equal(reopened.computations.read(artifact.id, "original").current, true);
const store = canvasLocalStore(f.memoryBackend());
await store.load();
await store.save(s);
const recovered = await store.load();
assert.ok(recovered);
close(
  project(recovered.page).solved.values.get("Fx").value,
  (500 * Math.sqrt(3)) / 2,
);
assert.equal(
  recovered.page.calculations.find((c) => c.id === kept).snapshot.version,
  3,
);
const oldDecoded = await decodeWorkspace(archive(historical.native()));
const oldReopened = new RegionSession(
  oldDecoded.page,
  undefined,
  oldDecoded.document,
  oldDecoded.artifacts,
  false,
  oldDecoded.recovery,
  { artifactExecutor: null },
);
assert.equal(project(oldReopened.state).solved.values.get("y").value, 8);
validateWorksheetReceipt(oldReopened.state.calculations[0].snapshot);
const api = createHeadlessWorkspace();
applyAgentEdits(api, {
  expectedDocumentId: api.read().id,
  edits: [
    { operation: "createEquation", text: "theta = 30 deg" },
    { operation: "createEquation", text: "F = 500 N" },
    { operation: "createEquation", text: "Fx = F*cos(theta)" },
  ],
});
close(
  api.worksheet().regions.find((r) => r.name === "Fx").quantity.value,
  (500 * Math.sqrt(3)) / 2,
);
assert.ok(agentCapabilities().mathematics.functions.includes("cos"));
const apiRound = await openHeadlessWorkspace(api.export());
assert.equal(
  apiRound.worksheet().regions.find((r) => r.name === "Fx").mathVersion,
  3,
);
const oldApi = await openHeadlessWorkspace(archive(historical.native()));
assert.equal(
  oldApi.worksheet().regions.find((r) => r.id === "y").mathVersion,
  1,
);
applyAgentEdits(oldApi, {
  expectedDocumentId: oldApi.read().id,
  edits: [{ operation: "enableScientificMath", region: "y" }],
});
close(
  oldApi.worksheet().regions.find((r) => r.id === "y").quantity.value,
  Math.sin(4),
);
oldApi.undo(oldApi.read().id);
assert.equal(
  oldApi.worksheet().regions.find((r) => r.id === "y").quantity.value,
  8,
);
for (const owner of [
  s,
  reopened,
  historical,
  oldReopened,
  api,
  apiRound,
  oldApi,
])
  owner.dispose();
console.log(
  "Scientific math: units/functions/domains, v1/v2 source and history, Vary/Undo/curves, real Python evidence, independent models/201-point analysis, native/local recovery and agent/headless handoff pass.",
);
