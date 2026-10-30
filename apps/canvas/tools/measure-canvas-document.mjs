import { testSession, deliver } from "../tests/sampling-test-helpers.mjs";
import { observeAuthoring } from "../tests/authoring-probe.mjs";
/** Diagnostic bridge costs, not a UI latency or product-capacity acceptance test. */
import { canvasSourceDigest } from "./canvas-source-digest.mjs";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cpus, platform, release, arch } from "node:os";
import { CanvasDocument } from "../src/regions/app/canvasDocument.ts";
import { RegionSession, semanticKey } from "../src/regions/document.ts";
import {
  archive,
  restore,
  decodeWorkspace,
  makeArtifact,
  prepare,
  acceptData,
} from "../src/regions/artifacts.ts";
const sourceDigest = canvasSourceDigest();
if (process.argv.includes("--digest")) {
  console.log(sourceDigest);
  process.exit(0);
}
const distribution = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
const timed = (fn) => {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
};
const rows = [];
for (const count of [10, 100, 256]) {
  const page = {
    regions: Array.from({ length: count }, (_, i) => ({
      id: `region-${i + 1}`,
      text: `Thought ${i + 1}`,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 110, y: 110 },
  };
  const initial = timed(() => new CanvasDocument(page)),
    owner = initial.value;
  const edit = [],
    move = [];
  for (let i = 0; i < 35; i++) {
    const candidate = structuredClone(owner.page);
    candidate.regions[0].text = `Thought edited ${i}`;
    const e = timed(() => owner.apply(candidate));
    const arranged = {
      ...owner.page,
      layout: { ...owner.page.layout, "region-1": { x: 400 + i, y: 200 } },
    };
    const revisions = owner.document.revisions;
    const m = timed(() => owner.apply(arranged));
    if (owner.document.revisions !== revisions)
      throw Error("Movement allocated content");
    if (i >= 5) {
      edit.push(e.ms);
      move.push(m.ms);
    }
  }
  const encode = timed(() => archive(owner.native()));
  const open = [];
  for (let n = 0; n < 5; n++) {
    const began = performance.now(),
      data = await decodeWorkspace(encode.value),
      resumed = new CanvasDocument(
        data.page,
        data.document,
        data.artifacts,
        false,
        data.recovery,
      );
    open.push(performance.now() - began);
    resumed.dispose();
  }
  const decoded = await decodeWorkspace(encode.value);
  if (decoded.document.document !== owner.document.document)
    throw Error("Lost document identity");
  rows.push({
    regions: count,
    initialOwnerMs: initial.ms,
    normalizedEdit30Ms: distribution(edit),
    normalizedRegionMove30Ms: distribution(move),
    nativeEncodeValidateMs: encode.ms,
    nativeOpenOwner5Ms: distribution(open),
    nativeBytes: Buffer.byteLength(encode.value),
    legacyBytes: Buffer.byteLength(
      JSON.stringify({
        format: "manifold-region-artifacts",
        version: 1,
        page: owner.page,
        artifacts: [],
      }),
    ),
    retainedRevisions: owner.document.revisions.size,
    exportedRevisions: decoded.document.revisions.size,
    retiredRevisionMarkers: decoded.document.allocated.revisions.size,
    undoSteps: owner.historySize,
  });
}
const operations = [];
for (const count of [10, 100, 256]) {
  const page = {
    regions: Array.from({ length: count }, (_, i) => ({
      id: `region-${i + 1}`,
      text: ["k := 10 N/mm", "x := 1 mm", "F := k*x"][i] ?? `Thought ${i + 1}`,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 110, y: 110 },
  };
  const artifact = makeArtifact(
    page,
    "region-3",
    "Plot F versus x from 0.5 to 3 mm",
  );
  const session = testSession(page, () => [], undefined, [artifact]);
  const keeps = [],
    undos = [],
    moves = [];
  for (let n = 0; n < 35; n++) {
    const keep = timed(() =>
      session.keepAlternative("region-2", "x := 2 mm", {
        context: session.state.active,
        key: semanticKey(session.state),
      }),
    );
    const undo = timed(() => session.undo());
    const revisions = session.document.revisions;
    const move = timed(() =>
      session.setArtifacts((items) =>
        items.map((a) => ({ ...a, at: { x: 700 + n, y: 200 } })),
      ),
    );
    if (revisions !== session.document.revisions)
      throw Error("Artifact movement revised computation");
    if (n >= 5) {
      keeps.push(keep.ms);
      undos.push(undo.ms);
      moves.push(move.ms);
    }
  }
  const a = session.artifacts[0],
    job = prepare(session.state, a);
  const data = {
    points: Array.from({ length: 201 }, (_, i) => {
      const x = a.low + ((a.high - a.low) * i) / 200;
      return [x, x * 10000];
    }),
    code_sha256: createHash("sha256").update(job.code).digest("hex"),
    runtime: { adapter: "bounded-python-sampler/1", python: "diagnostic" },
  };
  const checked = acceptData(session.state, a, job, data).receipt;
  const evidence = [];
  for (let n = 0; n < 6; n++) {
    const start = performance.now();
    const ok = await deliver(session, a.id, {
      ...checked,
      time: new Date(Date.UTC(2026, 9, 26, 0, 0, n)).toISOString(),
    });
    if (!ok) throw Error("Rejected current checked data");
    if (n) evidence.push(performance.now() - start);
  }
  const capture = session.capture(),
    native = timed(() => archive(session.native(capture)));
  operations.push({
    regions: count,
    atomicKeep30Ms: distribution(keeps),
    undo30Ms: distribution(undos),
    artifactMove30Ms: distribution(moves),
    verifyAndRetain201Points5Ms: distribution(evidence),
    nativeEncodeValidateMs: native.ms,
    nativeBytes: Buffer.byteLength(native.value),
    documentSequence: session.capture().document.sequence,
    evidenceSequence: session.evidenceSequence,
  });
}
const authoring = [];
for (const count of [10, 100, 256]) {
  const source = "gain,noise\n10," + "u".repeat(900_000);
  const page = {
    regions: [
      {
        id: "region-k",
        text: "k := 10 N/mm",
        source: {
          dataset: "region-data",
          row: 0,
          column: 0,
          raw: "10",
          unit: "N/mm",
        },
      },
      { id: "region-x", text: "x := 1 mm" },
      ...Array.from({ length: count - 3 }, (_, index) => ({
        id: "region-f-" + index,
        text: `F_${index} := k*x`,
      })),
      {
        id: "region-data",
        text: "Measurements",
        data: { name: "measurements.csv", csv: source },
      },
    ],
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 110, y: 110 },
  };
  const session = new RegionSession(page);
  session.keepCurrentCalculation("Pinned worksheet");
  const csv = session.state.regions.at(-1),
    calculation = session.state.calculations[0];
  const edits = [],
    views = [],
    keeps = [],
    editTimes = [];
  function observed(operation) {
    const { counters, value } = observeAuthoring(source, operation);
    if (value?.ok === false) throw Error(value.error);
    if (
      csv !== session.state.regions.at(-1) ||
      calculation !== session.state.calculations[0]
    )
      throw Error("Authoring replaced an unrelated source or kept record");
    return counters;
  }
  for (let index = 0; index < 35; index++) {
    const before = session.document;
    const edit = observed(() =>
      session.write("region-x", `x := ${index + 2} mm`),
    );
    const changedHeads = [...session.document.items.entries()].filter(
      ([id, item]) => before.items.get(id)?.revision !== item.revision,
    ).length;
    const revisions = session.document.revisions;
    const view = observed(() =>
      session.move("region-x", { x: 200 + index, y: 200 }),
    );
    if (session.document.revisions !== revisions)
      throw Error("Placement revised content");
    const keep = observed(() => {
      session.keepAlternative("region-x", "x := 2 mm", {
        context: session.state.active,
        key: semanticKey(session.state),
      });
      session.undo();
    });
    if (index >= 5) {
      edits.push({ ...edit, changedHeads });
      views.push(view);
      keeps.push(keep);
    }
  }
  const fanoutBefore = session.document;
  const rename = observed(() =>
    session.write("region-k", "stiffness := 10 N/mm"),
  );
  const renamedHeads = [...session.document.items.entries()].filter(
    ([id, item]) => fanoutBefore.items.get(id)?.revision !== item.revision,
  ).length;
  session.undo();
  for (let index = 0; index < 35; index++) {
    const edit = timed(() =>
      session.write("region-x", `x := ${index + 100} mm`),
    );
    if (!edit.value.ok) throw Error(edit.value.error);
    if (index >= 5) editTimes.push(edit.ms);
  }
  const summarize = (samples) =>
    Object.fromEntries(
      Object.keys(samples[0]).map((key) => [
        key,
        distribution(samples.map((sample) => sample[key])),
      ]),
    );
  authoring.push({
    regions: count,
    sourceBytes: Buffer.byteLength(source),
    sourceShared: csv === session.state.regions.at(-1),
    keptCalculationShared: calculation === session.state.calculations[0],
    edit30: summarize(edits),
    view30: summarize(views),
    keepUndo30: summarize(keeps),
    highFanoutRename: {
      ...rename,
      changedHeads: renamedHeads,
      dependentEquations: count - 3,
    },
    uninstrumentedEdit30Ms: distribution(editTimes),
  });
  session.dispose();
}
const result = {
  date: new Date().toISOString(),
  sourceDigest,
  sourceScope:
    "All canvas src/tests/tools TypeScript/CSS/MJS and native compatibility fixtures, foundation runtime, and canvas package/TS/Vite plus foundation package config",
  environment: {
    node: process.version,
    cpu: cpus()[0].model,
    platform: platform(),
    release: release(),
    arch: arch(),
  },
  method:
    "10/100/256 note regions, 5 warmups and 30 edit/move pairs; 5 full native Open+owner adoptions. Includes adapter scans, excludes React rendering, math, CSV bytes, Web Storage and browser I/O. Random UUID lengths are fixed. Single initial/encode timings are diagnostics. No capacity/latency acceptance.",
  operationMethod:
    "10/100/256 regions including k/x/F and one artifact: 5 warmups +30 Keep/Undo/move operations, including synchronous staging/math; 1 warmup +5 SHA-256/domain checks of 201-point results. Excludes React, network, CSVs and actual browser storage. Shared evidence is separate from authored Undo. No product latency/capacity acceptance.",
  authoringMethod:
    "10/100/256 regions, one 900 KB pinned CSV and kept worksheet, with all equations depending on k/x. Five warmups +30 literal edit, view and Keep/Undo pairs; one high-fanout rename. Instrument actual structuredClone/JSON.stringify arguments for source inclusion and clone object counts; counters are not heap/total-allocation estimates and inspect wrappers add overhead. Report separately five warmups +30 uninstrumented edit timings including domain validation, solving and recent worksheet capture. Excludes React, async execution, storage and recovery. Changes in all dependent equations legitimately cost more than a sparse edit.",
  rows,
  operations,
  authoring,
};
writeFileSync(
  new URL(
    "../../../evidence/current/canvas/canvas-document-results.json",
    import.meta.url,
  ),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
