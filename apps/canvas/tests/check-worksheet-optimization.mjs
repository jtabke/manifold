import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { RegionSession, project } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  captureDesign,
  designChoices,
  reviewDesign,
  scanDesignRange,
  mapDesignResponses,
  studyFixedInputs,
  decodeDesign,
} from "../src/regions/worksheetOptimization.ts";
import { shelfRail, railSpec, sagThickness } from "./shelf-rail.mjs";
import { curve } from "../src/regions/worksheetProjection.ts";

const page = shelfRail(),
  inputs = designChoices(page, "mass").inputs;
assert(
  inputs.some(
    (v) => v.id === "thickness" && v.unit === "mm" && v.current === 15,
  ),
);
const c = captureDesign(page, railSpec),
  x = 12,
  output = 0.04 * 0.012 * 7800;
const checked = () => ({ x: [x], output });
const review = reviewDesign(page, c, checked());
assert.deepEqual(
  review.rows.map((r) => r.name),
  ["thickness", "mass", "deflection", "stress", "cost"],
);
assert.equal(review.rows[0].proposed, "12 mm");
assert.equal(review.rows.at(-1).value, output * 3);
assert.throws(
  () => reviewDesign(page, c, { x: [8], output: 7800 * 0.04 * 0.008 }),
  /fails deflection/,
);
assert.throws(() => reviewDesign(page, c, { x: [21], output }), /bounds/);
assert.throws(
  () => reviewDesign(page, c, { x: [12], output: 100 }),
  /disagree/,
);
assert.throws(
  () =>
    captureDesign(page, {
      ...railSpec,
      axes: [{ id: "thickness", low: "1 s", high: "20 mm" }],
    }),
  /units/,
);
assert.throws(
  () =>
    captureDesign(page, {
      ...railSpec,
      axes: [railSpec.axes[0], railSpec.axes[0]],
    }),
  /distinct/,
);

// The scan and worksheet response plot use the same point semantics.
const range = scanDesignRange(page, railSpec);
assert.equal(range.unit, "mm");
assert.equal(range.points.length, 81);
assert.deepEqual(
  range.points.map((p) => p.pass),
  range.points.map((p) => p.x >= sagThickness(40, 2)),
);
const response = curve(page, {
  input: "thickness",
  output: "deflection",
  low: 0.005,
  high: 0.02,
});
assert.deepEqual(
  response.points.map((p) => p.pass),
  range.points.map((p) => p.checks[0]),
);
const tighterRange = scanDesignRange(shelfRail("1 mm"), railSpec);
assert.deepEqual(
  tighterRange.points.map((p) => p.pass),
  tighterRange.points.map((p) => p.x >= sagThickness(40, 1)),
);
assert(
  scanDesignRange(shelfRail("0.01 mm"), railSpec).points.every(
    (p) => p.pass === false,
  ),
);
const sheet = {
  ...page,
  regions: [
    ["input", "input := 3"],
    ["response", "response := 1 / (input - 2)"],
    ["limit", "response >= input - 3"],
    ["other", "response < 0"],
  ].map(([id, text]) => ({ id, text, mathVersion: 3 })),
};
const responseRange = scanDesignRange(sheet, {
  goal: "response",
  mode: "minimize",
  axes: [{ id: "input", low: "1", high: "4" }],
  requirements: ["limit"],
  reports: [],
});
assert(
  responseRange.points.some((p) => p.pass === true),
  "Unselected failed requirements are not enforced",
);
const singular = scanDesignRange(sheet, {
  goal: "response",
  mode: "minimize",
  axes: [{ id: "input", low: "0", high: "4" }],
  requirements: ["limit", "other"],
  reports: [],
});
assert.deepEqual(singular.points[40], {
  x: 2,
  checks: [null, null],
  pass: null,
});
assert(singular.points.some((p) => p.pass === false));
assert(
  Object.isFrozen(singular) && Object.isFrozen(singular.points[40].checks),
);

const railMapSpec = {
  ...railSpec,
  axes: [{ id: "width", low: "25 mm", high: "6 cm" }, ...railSpec.axes],
};
const mapped = mapDesignResponses(page, railMapSpec);
assert.deepEqual(mapped.xAxis.bounds, [25, 60]);
assert.deepEqual(mapped.yAxis.bounds, [5, 20]);
assert.deepEqual(
  mapped.outputs.map(({ id, unit, default: visible }) => [id, unit, visible]),
  [
    ["mass", "kg", true],
    ["deflection", "mm", true],
    ["stress", "MPa", true],
    ["cost", "", false],
  ],
);
assert.equal(mapped.points.length, 25 * 25);
assert.deepEqual([mapped.points[0].x, mapped.points[0].y], [25, 5]);
assert.deepEqual([mapped.points.at(-1).x, mapped.points.at(-1).y], [60, 20]);
assert.equal(mapped.current.x, 40);
assert.equal(mapped.current.y, 15);
assert.equal(mapped.current.pass, true);
assert.deepEqual(
  mapped.requirements.map((r) => r.unit),
  ["mm", "MPa"],
);
const near = (a, b) =>
  assert(Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b)));
near(mapped.current.margins[0].value, 2 - 0.9259259259259259);
near(mapped.current.margins[1].value, 100 - 50 / 3);
near(review.limits[0].mapMargin.value, 2 - 2 * (sagThickness(40, 2) / x) ** 3);
for (const p of mapped.points) {
  const mass = 7800 * (p.x / 1000) * (p.y / 1000);
  const sag = 2 * (sagThickness(p.x, 2) / p.y) ** 3;
  const stress = 150000 / (p.x * p.y ** 2);
  near(p.values[0], mass);
  near(p.values[1], sag);
  near(p.values[2], stress);
  near(p.values[3], mass * 3);
  assert.deepEqual(p.checks, [sag <= 2, stress <= 100]);
  near(p.margins[0].value, 2 - sag);
  near(p.margins[1].value, 100 - stress);
  assert.equal(p.pass, p.checks.every(Boolean));
}
assert(Object.isFrozen(mapped.points[0].values));
assert(Object.isFrozen(mapped.points[0].margins[0]));
assert.deepEqual(
  studyFixedInputs(page, railMapSpec).map(({ id }) => id),
  ["span", "force", "modulus", "density", "allowable"],
);
assert.equal(
  studyFixedInputs(
    {
      ...page,
      contexts: [
        { ...page.contexts[0], overrides: { force: "force := 120 N" } },
      ],
    },
    railMapSpec,
  ).find(({ id }) => id === "force").value,
  "120 N",
);
const domainMap = mapDesignResponses(
  {
    ...sheet,
    regions: [
      ...sheet.regions,
      { id: "offset", text: "offset := 1", mathVersion: 3 },
      { id: "rhs", text: "response > offset", mathVersion: 3 },
      { id: "report", text: "report := 1 / offset", mathVersion: 3 },
    ],
  },
  {
    goal: "response",
    mode: "minimize",
    requirements: ["rhs"],
    reports: ["report"],
    axes: [
      { id: "input", low: "2", high: "3" },
      { id: "offset", low: "0", high: "1" },
    ],
  },
);
assert.equal(
  domainMap.points[0].pass,
  null,
  "Undefined objective and constraint are not feasible",
);
assert.equal(
  domainMap.points[1].pass,
  true,
  "An undefined observation does not change feasibility",
);
near(domainMap.points[1].values[0], 24);
assert.equal(domainMap.points[1].values[1], null);
assert.equal(
  domainMap.points.at(-1).pass,
  false,
  "A varying strict limit rejects equality",
);
assert.deepEqual(domainMap.points.at(-1).margins[0], {
  value: 0,
  atLimit: true,
  roundoff: false,
});
assert.equal(domainMap.points[0].margins[0], null);
near(domainMap.points[1].margins[0].value, 24);
near(domainMap.points.at(-2).margins[0].value, 24 / 23 - 1);

const thermalMap = mapDesignResponses(
  {
    ...page,
    regions: [
      ["ambient", "ambient := 20 degC"],
      ["rise", "rise := 5 K"],
      ["extra", "extra := 3 K"],
      ["temperature", "temperature := ambient + rise + extra"],
      ["limit", "temperature <= 30 degC"],
    ].map(([id, text]) => ({ id, text, mathVersion: 3 })),
  },
  {
    goal: "temperature",
    mode: "minimize",
    reports: [],
    requirements: ["limit"],
    axes: [
      { id: "rise", low: "0", high: "10" },
      { id: "extra", low: "0", high: "4" },
    ],
  },
);
assert.equal(thermalMap.outputs[0].unit, "°C");
assert.equal(thermalMap.requirements[0].unit, "K");
near(thermalMap.current.values[0], 28);
near(thermalMap.current.margins[0].value, 2);
near(thermalMap.points.at(-1).margins[0].value, -4);

const session = new RegionSession(
  page,
  undefined,
  undefined,
  [],
  false,
  undefined,
  { worksheetOptimizer: async () => checked() },
);
const before = session.document;
const run = async () => {
  const result = await session.optimizeWorksheet(railSpec).completion;
  assert.equal(result.status, "success", result.reason);
  return result.value;
};
assert.equal(mapDesignResponses(session.state, railMapSpec).points.length, 625);
assert.equal(session.document, before, "Mapping is not an edit or a receipt");
const first = await run();
assert.equal(
  session.document,
  before,
  "Run is not a document edit or a receipt",
);
assert.throws(
  () => session.adoptWorksheetDesign({ ...first }, false),
  /changed/,
);
assert(session.write("width", "width := 41 mm").ok);
assert.throws(() => session.adoptWorksheetDesign(first, false), /changed/);
session.undo();
const alternative = await run();
session.adoptWorksheetDesign(alternative, true);
assert.notEqual(session.state.active, "original");
assert.equal(project(session.state).texts.thickness, "thickness := 12 mm");
assert.equal(
  project(session.state, "original").texts.thickness,
  "thickness := 15 mm",
);
session.undo();
assert.equal(session.state.active, "original");
assert.equal(session.state.contexts.length, 1);
session.adoptWorksheetDesign(await run(), false);
assert.equal(project(session.state).texts.thickness, "thickness := 12 mm");
session.undo();
assert.equal(project(session.state).texts.thickness, "thickness := 15 mm");
let runs = 0;
const studyOwner = new RegionSession(
  page,
  undefined,
  undefined,
  [],
  false,
  undefined,
  {
    worksheetOptimizer: async () => {
      runs++;
      return checked();
    },
  },
);
const studyId = studyOwner.addResponseStudy(
  railMapSpec,
  { x: 560, y: 100 },
  860,
);
const stored = studyOwner.state.plots[0];
assert.equal(stored.id, studyId);
assert.deepEqual(stored.study.axes[1], {
  id: "thickness",
  low: "5 mm",
  high: "20 mm",
});
assert.deepEqual(
  (await decodeWorkspace(archive(studyOwner.native()))).page.plots,
  [stored],
);
assert.throws(
  () => studyOwner.deleteRegions(["cost"]),
  /plot or artifact references/,
);
assert.deepEqual(project(studyOwner.state).texts, project(page).texts);
studyOwner.updateResponseStudy(studyId, { ...railMapSpec, reports: [] });
assert.deepEqual(studyOwner.state.plots[0].study.reports, []);
studyOwner.undo();
assert.deepEqual(studyOwner.state.plots[0].study.reports, ["cost"]);
studyOwner.removeResponseStudy(studyId);
assert.equal(studyOwner.state.plots.length, 0);
studyOwner.undo();
assert.equal(studyOwner.state.plots[0].id, studyId);
assert.equal(
  runs,
  0,
  "Study creation, settings, archive and Undo never run optimization",
);
studyOwner.dispose();
session.dispose();

const py = (code, input) =>
  JSON.parse(
    execFileSync(
      process.env.PYTHON || "python3",
      [
        "-c",
        `import json,sys;sys.path.insert(0,'apps/canvas');import artifact_optimizer as o;${code}`,
      ],
      {
        cwd: new URL("../../..", import.meta.url),
        input: JSON.stringify(input),
        encoding: "utf8",
      },
    ),
  );
assert.equal(
  py(
    "r=json.load(sys.stdin);print(json.dumps(o.program_digest(r['program'],r['version'])))",
    c.request,
  ),
  c.request.program_sha256,
);
const backend = py(
  "\ntry: b=o.backend_identity()\nexcept o.BackendUnavailable: b=None\nprint(json.dumps(b if b and o._supported(b) else None))",
  null,
);
if (backend) {
  const solve = (p, spec) => {
    const c = captureDesign(p, spec),
      result = py("print(json.dumps(o.solve(json.load(sys.stdin))))", {
        ...c.request,
        backend,
      });
    return reviewDesign(p, c, decodeDesign(c, backend, result));
  };
  const one = solve(page, railSpec);
  const mm = (r, id) => r.rows.find((q) => q.id === id).value * 1000;
  assert(Math.abs(mm(one, "thickness") - sagThickness(40, 2)) < 2e-5);
  assert(one.limits[0].active && !one.limits[1].active);
  assert(
    Math.abs(
      one.rows.at(-1).value - (3 * 7800 * 0.04 * sagThickness(40, 2)) / 1000,
    ) < 1e-5,
  );
  const tighter = solve(shelfRail("1 mm"), railSpec);
  assert(Math.abs(mm(tighter, "thickness") - sagThickness(40, 1)) < 2e-5);
  const two = solve(page, {
    ...railSpec,
    axes: [...railSpec.axes, { id: "width", low: "25 mm", high: "6 cm" }],
  });
  assert(Math.abs(mm(two, "width") - 25) < 1e-5);
  assert(Math.abs(mm(two, "thickness") - sagThickness(25, 2)) < 2e-5);
  assert.throws(
    () => solve(shelfRail("0.01 mm"), railSpec),
    /No feasible candidate found/,
  );
  const max = solve(page, { ...railSpec, mode: "maximize" });
  assert(Math.abs(mm(max, "thickness") - 20) < 1e-6);
  console.log(
    "Pinned SciPy: one and two variables, tighter and impossible sag, maximize checked against hand calculations.",
  );
} else {
  assert.notEqual(
    process.env.MANIFOLD_REQUIRE_OPTIMIZER,
    "1",
    "Pinned numerical runtime required",
  );
  console.log(
    "Optional SciPy not available; checked capture, verification, review, adoption and Undo only.",
  );
}
