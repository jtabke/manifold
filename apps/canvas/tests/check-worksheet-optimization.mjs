import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  captureDesign,
  designChoices,
  reviewDesign,
  decodeDesign,
} from "../src/regions/worksheetOptimization.ts";
import { shelfRail, railSpec, sagThickness } from "./shelf-rail.mjs";

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
