import assert from "node:assert/strict";
import {
  calculate,
  evaluationWork,
  resetEvaluationWork,
  prepareCalculation,
  solvePrepared,
} from "../src/notebook/math.ts";
import {
  createWorksheetProjection,
  WORKSHEET_CACHE_LIMITS,
  worksheetProjection,
  project,
  curve,
  semanticKey,
} from "../src/regions/worksheetProjection.ts";
import {
  referenceCurve,
  referenceCalculate,
  referenceProject,
  referenceSemanticKey,
} from "./worksheet-reference.mjs";
import * as f from "@manifold/foundation";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { previewPage, proposeValue } from "../src/regions/exploration.ts";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
const make = (lines) => ({
  regions: lines.map((text, i) => ({ id: "r" + i, text })),
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  layout: {},
  plots: [],
  origin: { x: 0, y: 0 },
});
const maps = (value) => {
  if (value && typeof value === "object") {
    if (typeof value.entries === "function" && typeof value.get === "function")
      return [...value.entries()]
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([k, v]) => [k, maps(v)]);
    if (Array.isArray(value)) return value.map(maps);
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, maps(v)]),
    );
  }
  return value;
};
const engine = createWorksheetProjection();
// Inherited Object names are valid scientific variable names, not units. They
// must participate in bindings and incremental invalidation just like other inputs.
for (const mathVersion of [2, 3])
  for (const name of [
    "toString",
    "hasOwnProperty",
    "valueOf",
    "isPrototypeOf",
  ]) {
    const source = make([`${name} := 2`, `result := ${name}*3`, "result <= 9"]);
    source.regions = source.regions.map((r) => ({ ...r, mathVersion }));
    const session = new RegionSession(source);
    try {
      const read = () => project(session.state);
      assert.equal(read().kinds.r1, "equation");
      assert.equal(read().bindings.r1[name], "r0");
      assert.equal(read().solved.values.get("result").value, 6);
      assert.equal(read().solved.constraints.get("r2").pass, true);
      session.write("r0", `${name} := 4`);
      assert.equal(read().solved.values.get("result").value, 12);
      assert.equal(read().solved.constraints.get("r2").pass, false);
      assert.deepEqual(
        maps(read()),
        maps(createWorksheetProjection().project(session.state)),
      );
      session.undo();
      assert.equal(read().solved.values.get("result").value, 6);
      assert.equal(read().solved.constraints.get("r2").pass, true);
      session.redo();
      assert.equal(read().solved.values.get("result").value, 12);
      assert.equal(read().solved.constraints.get("r2").pass, false);
    } finally {
      session.dispose();
    }
  }
const compare = (page) => {
  assert.deepEqual(
    maps(engine.project(page)),
    maps(referenceProject(page)),
    JSON.stringify(page.regions),
  );
  assert.equal(engine.semanticKey(page), referenceSemanticKey(page));
};
let page = make([
  "x = 2 m",
  "y = 3*x",
  "z = y+1 m",
  "z <= 10 m",
  "a = 1 s",
  "b = 2*a",
  "Ordinary thought",
]);
compare(page);
for (const [id, text] of [
  ["r0", "x = 4 m"],
  ["r1", "y = x/0"],
  ["r1", "y = 3*x"],
  ["r0", "x = 4 s"],
  ["r0", "x = 2 m"],
  ["r0", "x = 1."],
  ["r0", "x = "],
  ["r0", "x = 1e+"],
  ["r0", "new_x = 2 m"],
  ["r0", "x = 2 m"],
  ["r4", "x = 5 m"],
  ["r5", "x = 7 m"],
  ["r4", "a = 1 s"],
  ["r5", "b = 2*a"],
  ["r1", "y = z"],
  ["r2", "z = y"],
  ["r1", "y = 3*x"],
  ["r2", "z = y + 1 m"],
  ["r3", "z < 5 s"],
  ["r3", "z < 5 m"],
  ["r3", "z >= 3 m"],
  ["r0", "x = -20 °C"],
  ["r1", "y = x + 5 K"],
  ["r2", "z = y - 10 °C"],
  ["r6", "2 + 3 ="],
  ["r6", "2 + ="],
  ["r6", "2 mm"],
  ["r6", "42"],
  ["r6", "A plain note"],
]) {
  page = {
    ...page,
    regions: page.regions.map((r) => (r.id === id ? { ...r, text } : r)),
  };
  compare(page);
}
page = make(["x = 2 m", "y = 3*x", "y <= 10 m"]);
for (const target of ["r0", "missing", "r1"]) {
  page = { ...page, links: { r1: { x: target }, r2: { y: target } } };
  compare(page);
}
page = {
  ...page,
  links: {},
  contexts: [
    ...page.contexts,
    {
      id: "alt",
      label: "Alternative",
      base: { r0: "x = 4 m" },
      overrides: { r0: "x = 5 m" },
    },
  ],
  active: "alt",
};
compare(page);
page.contexts[1].overrides.r0 = "x = 6 m";
compare(page); // Mutable callers must never hit an identity-only cache.
page.regions.reverse();
compare(page);
page.regions.push({ id: "extra", text: "x = 9 m" });
compare(page);
page.regions.pop();
compare(page);
// Deterministic mixed revisions exercise invalidation against the retained full algorithm.
let seed = 1879;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
};
page = make(Array.from({ length: 24 }, (_, i) => `v${i} = ${i + 1} m`));
for (let i = 0; i < 400; i++) {
  const n = random() % 24,
    name = "v" + n,
    from = "v" + (random() % 24),
    k = random() % 10;
  const text =
    k === 0
      ? `${name} = `
      : k === 1
        ? `${name} = ${from}/0`
        : k === 2
          ? `${name} = ${from}`
          : k === 3
            ? `v${(n + 1) % 24} = 2 m`
            : k === 4
              ? `${name} <= 2 m`
              : k === 5
                ? "A thought"
                : `${name} = ${from} + ${random() % 10} m`;
  page = {
    ...page,
    regions: page.regions.map((r, j) => (j === n ? { ...r, text } : r)),
  };
  compare(page);
}
const rows = Array.from({ length: 256 }, (_, i) => `v${i} = ${i + 1} m`);
page = make(rows);
engine.clear();
resetEvaluationWork();
const before = engine.project(page);
assert.equal(evaluationWork().parses, 256);
assert.equal(evaluationWork().assignments, 256);
resetEvaluationWork();
const moved = { ...page, layout: { r0: { x: 100, y: 200 } } };
assert.equal(engine.project(moved), before);
assert.equal(engine.semanticKey(moved), referenceSemanticKey(moved));
// The reference-key call above deliberately parses; observe actual production paths separately.
resetEvaluationWork();
engine.semanticKey(moved);
assert.equal(evaluationWork().parses, 0);
assert.equal(evaluationWork().assignments, 0);
const changed = {
  ...moved,
  regions: moved.regions.map((r, i) => (i ? r : { ...r, text: "v0 = 8 m" })),
};
resetEvaluationWork();
const after = engine.project(changed);
assert.equal(evaluationWork().parses, 1);
assert.equal(evaluationWork().assignments, 1);
assert.equal(after.solved.values.get("v255"), before.solved.values.get("v255"));
assert.throws(() =>
  after.solved.values.set("v255", { value: 999, dimension: [0, 0, 0, 0] }),
);
assert.throws(() => (after.statements.get("r255").name = "forged"));
assert.throws(() => (after.solved.values.get("v255").dimension[0] = 8));
after.solved.values.forEach((_value, _key, view) =>
  assert.equal(typeof view.set, "undefined"),
);
for (const family of ["chain", "fanout"]) {
  let linked = make(
    Array.from({ length: 256 }, (_, i) =>
      i ? `v${i} = v${family === "chain" ? i - 1 : 0}*1.01` : "v0 = 2 m",
    ),
  );
  engine.clear();
  engine.project(linked);
  resetEvaluationWork();
  linked = {
    ...linked,
    regions: linked.regions.map((r, i) => (i ? r : { ...r, text: "v0 = 3 m" })),
  };
  assert.deepEqual(
    maps(engine.project(linked)),
    maps(referenceProject(linked)),
  );
  // The reference pass uses evaluate(), but cannot affect the solver assignment counter.
  assert.equal(evaluationWork().assignments, 256);
  resetEvaluationWork();
  linked = {
    ...linked,
    regions: linked.regions.map((r, i) =>
      i === 255 ? { ...r, text: "v255 = 5 m" } : r,
    ),
  };
  engine.project(linked);
  assert.equal(evaluationWork().parses, 1);
  assert.equal(evaluationWork().assignments, 1);
}
const parsed = rows.map((text, i) => prepareCalculation("r" + i, text)),
  state = solvePrepared(parsed);
const override = { v0: { value: 2, dimension: [0, 1, 0, 0] } };
const capturedOverride = solvePrepared(parsed, override, state);
override.v0.value = 9;
assert.equal(capturedOverride.overrides.v0.value, 2);
assert.equal(
  calculate([{ id: "x", text: "x = 2 m", x: 0, y: 0 }]).values.get("x").value,
  2,
);
for (const lines of [
  ["x = 2 m", "y = x^2", "y <= 9 m^2"],
  ["x = 25 °C", "y = x + 5 K", "y < 40 °C"],
  ["x = 2", "y = 1/x", "broken = 1."],
  ["x = 2 m", "y = 3*x", "y < 10 m"],
]) {
  const input = make(lines),
    plot = { input: "r0", output: "r1", low: 0, high: 4 };
  assert.deepEqual(
    maps(engine.curve(input, plot)),
    maps(referenceCurve(input, plot)),
  );
  const stale = { ...input, links: { r2: { y: "missing" } } };
  assert.deepEqual(
    maps(engine.curve(stale, plot)),
    maps(referenceCurve(stale, plot)),
  );
}
// Every legal point shares preparation; no parser calls for any of 81 samples or repeated reads.
page = make(["x = 2 m", "y = 3*x", "y <= 10 m", ...rows.slice(3)]);
engine.clear();
engine.project(page);
resetEvaluationWork();
const plot = { input: "r0", output: "r1", low: 0, high: 4 };
const response = engine.curve(page, plot);
assert.equal(response.points.length, 81);
assert.equal(response.points.at(-1).y, 12);
assert.equal(evaluationWork().parses, 0);
assert.equal(evaluationWork().assignments, 81);
assert.equal(evaluationWork().constraints, 81);
resetEvaluationWork();
assert.equal(
  engine.curve({ ...page, layout: { r0: { x: 3, y: 4 } } }, plot),
  response,
);
assert.equal(evaluationWork().assignments, 0);
assert.equal(evaluationWork().parses, 0);
for (let i = 0; i < 50; i++)
  engine.project(make([`x = ${i} m`, ...rows.slice(1)]));
const d = engine.diagnostics();
assert.ok(
  d.snapshots <= WORKSHEET_CACHE_LIMITS.snapshots &&
    d.snapshotWeight <= WORKSHEET_CACHE_LIMITS.snapshotWeight &&
    d.rowWeight <= WORKSHEET_CACHE_LIMITS.rowWeight &&
    d.preparedRows <= WORKSHEET_CACHE_LIMITS.rows,
);
// Accepted history, preview, sources and portable recovery do not depend on warm derivations.
const session = new RegionSession(make(["x = 2 m", "y = 3*x"]));
const id = session.state.regions[0].id;
const baseKey = semanticKey(session.state);
session.write(id, "x = 4 m");
assert.equal(project(session.state).solved.values.get("y").value, 12);
session.undo();
assert.equal(semanticKey(session.state), baseKey);
assert.equal(project(session.state).solved.values.get("y").value, 6);
const proposal = proposeValue(session.state, id, 5),
  preview = previewPage(session.state, proposal);
assert.equal(project(preview).solved.values.get("y").value, 15);
assert.equal(project(session.state).solved.values.get("y").value, 6);
const dataset = session.importData("measurement.csv", "q\n4\n7\n", {
  x: 800,
  y: 0,
});
const measured = session.quantityFromCell(dataset, 0, 0, "measured", "m", {
  x: 100,
  y: 600,
});
const dependent = session.create();
session.write(dependent, "twice = 2*measured");
assert.equal(project(session.state).solved.values.get("twice").value, 8);
session.quantityFromCell(dataset, 1, 0, "measured_new", "m", {
  x: 100,
  y: 800,
});
session.write(dependent, "twice = 2*measured_new");
assert.equal(project(session.state).solved.values.get("twice").value, 14);
session.undo();
assert.equal(project(session.state).solved.values.get("twice").value, 8);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(session);
worksheetProjection.clear();
const loaded = await store.load(),
  recovered = new RegionSession(
    loaded.page,
    () => [],
    loaded.document,
    loaded.artifacts,
    false,
    loaded.recovery,
  );
assert.equal(project(recovered.state).solved.values.get("twice").value, 8);
assert.equal((await store.save(recovered)).writes.chunks, 0);
recovered.dispose();
const text = archive(session.native());
worksheetProjection.clear();
const opened = await stageWorkspaceFile(text);
assert.equal(project(opened.state).solved.values.get("y").value, 6);
assert.equal(opened.executionDiagnostics.running, 0);
session.dispose();
opened.dispose();
console.log(
  "Incremental worksheet: full-reference differential revisions, names/units/drafts/cycles/duplicates/links/contexts, immutable results, sparse/curve work counters, bounded caches and cold Undo/native continuation pass.",
);
