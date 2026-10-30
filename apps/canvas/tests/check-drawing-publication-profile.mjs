import assert from "node:assert/strict";
import { windowMetrics } from "./drawing-save-trace.mjs";
assert.deepEqual(
  windowMetrics(
    100,
    300,
    [
      { start: 50, ms: 120 },
      { start: 200, ms: 120 },
      { start: 400, ms: 80 },
    ],
    [
      { start: 80, ms: 100 },
      { start: 180, ms: 20 },
    ],
  ),
  {
    windowMs: 200,
    longTaskCount: 2,
    longestLongTaskOverlapMs: 100,
    blockingOver50Ms: 70,
    maxRafGapOverlapMs: 80,
  },
);
assert.equal(windowMetrics(10, 10, [{ start: 0, ms: 100 }], []).windowMs, 0);
assert.throws(() => windowMetrics(10, 5, [], []));
import {
  stats,
  summarize,
  unionMs,
  bundleRanges,
} from "./drawing-publication-profile.mjs";
const frame = (functionName, url = "", lineNumber = 0, columnNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  columnNumber,
});
const nodes = [
  {
    id: 1,
    callFrame: frame("estimate", "file:///app/canvasStorageBudget.ts"),
    children: [2, 4, 5],
  },
  {
    id: 2,
    callFrame: frame("retained", "file:///foundation/src/value.ts"),
    children: [3],
  },
  { id: 3, callFrame: frame("json", "file:///foundation/src/value.ts") },
  { id: 4, callFrame: frame("(idle)") },
  { id: 5, callFrame: frame("(garbage collector)") },
];
const result = summarize({
  nodes,
  samples: [3, 4, 5],
  timeDeltas: [1000, 2000, 3000],
});
assert.equal(result.sampledMs, 6);
const profiler = summarize({
  nodes: [
    { id: 1, callFrame: frame("post", "node:inspector"), children: [2] },
    { id: 2, callFrame: frame("json", "file:///foundation/src/value.ts") },
  ],
  samples: [2],
  timeDeltas: [2000],
});
assert.equal(
  profiler.selfBucketsMs["Profiler overhead"],
  2,
  "profiler initialization must not masquerade as target CPU",
);
assert.deepEqual(result.selfBucketsMs, {
  "JSON validation": 1,
  Idle: 2,
  GC: 3,
});
assert.equal(result.inclusiveContextsMs["Retention other"], 1);
assert.equal(result.inclusiveContextsMs["Capacity other"], 6);
assert.equal(
  unionMs([
    { start: 5, end: 10 },
    { start: 1, end: 7 },
    { start: 12, end: 15 },
  ]),
  12,
);
assert.throws(() => unionMs([{ start: 4, end: 2 }]));
assert.deepEqual(stats([4, 1, 3, 2]), {
  count: 4,
  median: 2.5,
  p95: 4,
  max: 4,
  samples: [4, 1, 3, 2],
});
assert.throws(() => stats([]));
assert.throws(() => stats([NaN]));
assert.throws(() => bundleRanges("function a() {}"), /minify=false/);
const source = `function json(v) { throw Error("Cyclic JSON"); }
function freezeRetained(v) { return v; }
class CanvasStorageBudget { estimate() { return 1; } }
function requireReactDomClient_production() { return null; }
function indexedBackend() { return null; }`;
const bundle = bundleRanges(source);
const mapped = summarize(
  {
    nodes: [
      {
        id: 1,
        callFrame: frame(
          "minified-name-is-not-used",
          "http://localhost/assets/index-test.js",
          0,
          10,
        ),
      },
    ],
    samples: [1],
    timeDeltas: [1234],
  },
  bundle,
);
assert.equal(mapped.selfBucketsMs["JSON validation"], 1.234);
const parsed = summarize({
  nodes: [
    {
      id: 1,
      callFrame: frame("parsedJson", "file:///foundation/src/local-store.ts"),
    },
  ],
  samples: [1],
  timeDeltas: [1500],
});
assert.equal(parsed.selfBucketsMs["Parsed JSON checks"], 1.5);
assert.equal(parsed.inclusiveContextsMs["Storage JS"], 1.5);
const notification = summarize({
  nodes: [
    { id: 1, callFrame: frame("notify", "file:///foundation/src/runtime.ts") },
  ],
  samples: [1],
  timeDeltas: [500],
});
assert.equal(notification.selfBucketsMs["Subscriber notification"], 0.5);
console.log(
  "Drawing profile: self-time partition, overlapping contexts, generated ranges, raw samples and transaction interval union pass.",
);
