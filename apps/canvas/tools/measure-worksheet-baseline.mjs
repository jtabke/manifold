/** Reproducible full-rebuild reference costs; not a current production workload. */
import { writeFileSync, existsSync } from "node:fs";
import {
  referenceProject,
  referenceSemanticKey,
} from "../tests/worksheet-reference.mjs";
import { evaluationWork, resetEvaluationWork } from "../src/notebook/math.ts";
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
const rows = [];
for (const regions of [64, 256]) {
  const page = {
    regions: Array.from({ length: regions }, (_, i) => ({
      id: "r" + i,
      text: `q${i} = ${i + 1} m`,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 0, y: 0 },
  };
  const observe = (operation) => {
    resetEvaluationWork();
    const start = performance.now();
    operation();
    const { parses, expressions } = evaluationWork();
    return { parses, expressions, ms: performance.now() - start };
  };
  rows.push({
    regions,
    cold: observe(() => referenceProject(page)),
    layout: observe(() =>
      referenceProject({ ...page, layout: { r0: { x: 10, y: 20 } } }),
    ),
    sparse: observe(() =>
      referenceProject({
        ...page,
        regions: page.regions.map((r, i) =>
          i ? r : { ...r, text: "q0 = 2 m" },
        ),
      }),
    ),
    semantic: observe(() => referenceSemanticKey(page)),
  });
}
const result = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  method:
    "Pre-incremental full projection and semantic-key algorithm preserved in worksheet-reference.mjs. Real parser and arithmetic expression entry counters; independent 64/256-row worksheets. Each layout and sparse edit rebuilds projection. Timings are device diagnostics. This report is a historical baseline, not current acceptance.",
  rows,
};
if (process.argv.includes("--record")) {
  const path = new URL(
    "../../../evidence/archive/canvas/incremental-worksheet-reference-results.json",
    import.meta.url,
  );
  if (existsSync(path))
    throw Error(
      "Archive checkpoint already exists; measurements never overwrite historical reports",
    );
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));
