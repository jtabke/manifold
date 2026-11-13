/** Actual parser/evaluator work and explicit retained derivation budgets, not a capacity promise. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createWorksheetProjection,
  WORKSHEET_CACHE_LIMITS,
} from "../src/regions/worksheetProjection.ts";
import { evaluationWork, resetEvaluationWork } from "../src/notebook/math.ts";
import { immutable } from "../src/notebook/immutable.ts";
import { referenceProject } from "../tests/worksheet-reference.mjs";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const { values } = parseArgs({
  options: {
    output: { type: "string" },
    baseline: { type: "string" },
  },
});
const output = values.output
  ? resolve(values.output)
  : fileURLToPath(
      new URL(
        "../../../evidence/current/canvas/worksheet-evaluation-results.json",
        import.meta.url,
      ),
    );
// Historical reports are metadata only and are never an implicit input.
const baselinePath = values.baseline ? resolve(values.baseline) : undefined;
const baseline = baselinePath
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : undefined;
if (baselinePath)
  assert.ok(
    typeof baseline?.sourceDigest === "string" && baseline.sourceDigest,
    "An explicit baseline must declare its sourceDigest",
  );
const make = (count, family) =>
  immutable({
    regions: Array.from({ length: count }, (_, i) => ({
      id: "r" + i,
      text:
        i && family !== "independent"
          ? `v${i} = v${family === "chain" ? i - 1 : 0}*1.001`
          : `v${i} = ${i + 1} m`,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 0, y: 0 },
  });
const rows = [];
for (const regions of [64, 256])
  for (const family of ["independent", "chain", "fanout"]) {
    const engine = createWorksheetProjection();
    let page = make(regions, family);
    const observe = (fn) => {
      resetEvaluationWork();
      const start = performance.now();
      const value = fn();
      return {
        value,
        counts: { ...evaluationWork() },
        ms: performance.now() - start,
      };
    };
    const initial = observe(() => engine.project(page));
    assert.equal(initial.counts.parses, regions);
    assert.equal(initial.counts.assignments, regions);
    const beforeLayoutRows = engine.diagnostics().scannedRows;
    const layout = observe(() =>
      engine.project(immutable({ ...page, layout: { r0: { x: 20, y: 30 } } })),
    );
    assert.equal(layout.value, initial.value);
    const layoutScannedRows =
      engine.diagnostics().scannedRows - beforeLayoutRows;
    const semantic = observe(() => engine.semanticKey(page));
    const sparse = [],
      times = [];
    for (let n = 0; n < 35; n++) {
      page = immutable({
        ...page,
        regions: page.regions.map((r, i) =>
          i ? r : { ...r, text: `v0 = ${2 + n} m` },
        ),
      });
      const edit = observe(() => engine.project(page));
      if (n >= 5) {
        sparse.push(edit.counts);
        times.push(edit.ms);
      }
    }
    const expected = referenceProject(page);
    assert.equal(
      engine.project(page).solved.values.get("v" + (regions - 1)).value,
      expected.solved.values.get("v" + (regions - 1)).value,
    );
    const plot = {
      input: "r0",
      output: family === "independent" ? "r1" : "r" + (regions - 1),
      low: 0,
      high: 2,
    };
    const sweep = observe(() => engine.curve(page, plot)),
      repeated = observe(() => engine.curve(page, plot));
    assert.equal(sweep.value, repeated.value);
    for (let n = 0; n < 20; n++)
      engine.project(
        immutable({
          ...page,
          regions: page.regions.map((r, i) =>
            i ? r : { ...r, text: `v0 = ${100 + n} m` },
          ),
        }),
      );
    const limits = engine.diagnostics();
    assert.ok(
      limits.snapshots <= WORKSHEET_CACHE_LIMITS.snapshots &&
        limits.snapshotWeight <= WORKSHEET_CACHE_LIMITS.snapshotWeight &&
        limits.preparedRows <= WORKSHEET_CACHE_LIMITS.rows &&
        limits.rowWeight <= WORKSHEET_CACHE_LIMITS.rowWeight,
    );
    rows.push({
      regions,
      family,
      cold: initial.counts,
      layout: layout.counts,
      layoutScannedRows,
      semantic: semantic.counts,
      maxSparseParses: Math.max(...sparse.map((c) => c.parses)),
      maxSparseAssignments: Math.max(...sparse.map((c) => c.assignments)),
      curve: sweep.counts,
      repeatedCurve: repeated.counts,
      curveSamples: sweep.value.points.length,
      limits,
      editP95Ms: times.toSorted((a, b) => a - b)[
        Math.ceil(times.length * 0.95) - 1
      ],
      curveMs: sweep.ms,
    });
  }
const result = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  ...(baselinePath
    ? {
        baselineSourceDigest: baseline.sourceDigest,
        baseline: { path: baselinePath, sourceDigest: baseline.sourceDigest },
      }
    : {}),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  method:
    "64/256-row independent, chain and fan-out worksheets; five warmups plus 30 sparse root edits. Actual parse/AST-evaluation/assignment/constraint counters, layout/semantic reads, 81-point curves and repeated curve reads. Disposable caches retain at most eight estimated-weight snapshots/eight MiB, 1,024 prepared rows/two MiB and four bounded curves per snapshot. Weight is a conservative policy diagnostic, not measured JS heap. Index/materialization scans and application-shell renders are not claimed eliminated. No document-capacity increase or cross-device latency claim.",
  bounds: WORKSHEET_CACHE_LIMITS,
  rows,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
