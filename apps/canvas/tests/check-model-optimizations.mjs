import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  setModelInput,
  reviewModelCsv,
  applyModelConnection,
} from "../src/regions/modelCommands.ts";
import {
  createModelOptimization,
  reviewOptimizationRuntime,
  applyOptimizationCandidate,
  keepModelOptimization,
  reviseModelOptimization,
  computeOptimizationResponse,
  undoOptimizationApply,
} from "../src/regions/modelOptimizationCommands.ts";
import {
  modelOptimizations,
  modelAnalyses,
} from "../src/regions/foundationModels.ts";
import {
  programDigest,
  lowerOptimization,
} from "../src/regions/optimizationLowering.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  optimizationQuantity,
  optimizationConvert,
} from "../src/regions/optimizationQuantities.ts";
assert.equal(optimizationQuantity("10 mm", "m"), 0.01);
assert.equal(optimizationQuantity("5 cm", "mm"), 50);
assert.equal(optimizationQuantity("10", "mm"), 10);
assert.equal(optimizationQuantity("1e-8 m", "mm"), 0.00001);
assert.equal(optimizationConvert(10, "mm", "cm"), 1);
for (const text of ["5 s", "x", "sin(1)", "1 + 2", "1;process.exit()"])
  assert.throws(() => optimizationQuantity(text, "mm"));
const python = process.env.PYTHON || "python3";
const py = (code, input) =>
  JSON.parse(
    execFileSync(
      python,
      [
        "-c",
        `import sys,json;sys.path.insert(0,'apps/canvas');import artifact_optimizer as o;${code}`,
      ],
      {
        cwd: new URL("../../..", import.meta.url),
        input: JSON.stringify(input),
        encoding: "utf8",
      },
    ),
  );
assert.equal(
  programDigest({ nodes: [{ op: "const", value: 2 }], output: 0 }),
  "fccf28040726cd9a9be993e6de5e1f5bfb4880c34928df553e2caa695f10dc2b",
);
assert.equal(
  programDigest({ nodes: [{ op: "const", value: -0 }], output: 0 }),
  programDigest({ nodes: [{ op: "const", value: 0 }], output: 0 }),
);
for (const value of [-0, 1e-10, 1e12, Math.PI]) {
  const program = { nodes: [{ op: "const", value }], output: 0 };
  // JSON serialization deliberately normalizes JS -0 to +0 before both hashes.
  assert.equal(
    programDigest(program),
    py("print(json.dumps(o.program_digest(json.load(sys.stdin))))", program),
  );
}
const spec = {
  input: "x",
  output: "y",
  low: -3,
  high: 5,
  mode: "minimize",
  target: null,
  xTolerance: 1e-9,
  residualTolerance: null,
};
function fixture(text = "y = (x - 2)^2", extra = []) {
  const s = new RegionSession();
  const def = publishModel(s, "Quadratic", {
    rows: [
      { id: "x", text: "x = 1", mathVersion: 3 },
      ...extra,
      { id: "y", text, mathVersion: 3 },
    ],
    inputs: ["x", ...extra.map((r) => r.id)],
    outputs: ["y"],
  });
  const instance = instantiateModel(s, modelReference(s.document, def), {
    x: 0,
    y: 0,
  });
  const item = createModelOptimization(s, instance, spec, { x: 450, y: 0 });
  const target = modelReference(s.document, item),
    view = s.document.views.get(item + ":view");
  return { s, def, instance, item, target, view };
}
// Creation/render/reload do not launch work and remain available without SciPy.
{
  const { s, item } = fixture();
  assert.equal(
    s.foundation.result(modelReference(s.document, item)).status,
    "blocked",
  );
  const loaded = await stageWorkspaceFile(archive(s.native()));
  assert.equal(loaded.executionDiagnostics.running, 0);
  loaded.dispose();
  const unchanged = f.current(s.document, item).body;
  reviseModelOptimization(s, item, {
    ...spec,
    displayUnits: { input: "1", output: "1" },
  });
  assert.equal(f.current(s.document, item).body.low, unchanged.low);
  assert.equal(
    f.current(s.document, item).body.xTolerance,
    unchanged.xTolerance,
  );
  const withDisplay = await stageWorkspaceFile(archive(s.native()));
  assert.deepEqual(f.current(withDisplay.document, item).body.displayUnits, {
    input: "1",
    output: "1",
  });
  withDisplay.dispose();
  s.dispose();
}
const capability = py(
  "\ntry:\n identity=o.backend_identity();print(json.dumps(identity if o._supported(identity) else None))\nexcept o.BackendUnavailable: print('null')",
  null,
);
if (!capability) {
  console.log(
    "SKIP numerical model-optimization integration: supported CPython 3.12/SciPy environment absent; creation/digest/offline checks passed.",
  );
} else {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/optimizer/optimize");
    calls++;
    const body = JSON.parse(options.body);
    return new Response(
      JSON.stringify(
        py("print(json.dumps(o.solve(json.load(sys.stdin))))", body.request),
      ),
    );
  };
  try {
    const a = fixture(),
      { s, instance, item, target, view } = a;
    reviewOptimizationRuntime(s, item, capability, s.document);
    const authored = f.current(s.document, item);
    s.applyCommands([
      {
        kind: "revise",
        item,
        revision: {
          ...authored,
          id: "legacy-optimization-settings",
          schema: "canvas-model-optimization@1",
        },
      },
    ]);
    const initial = f.current(s.document, instance),
      before = s.document;
    const settled = await s.compute(target).completion;
    assert.equal(settled.status, "retained", settled.reason);
    assert.equal(
      s.document.id,
      before.id,
      "Run must not publish authored edits",
    );
    assert.equal(f.current(s.document, instance), initial);
    let result = s.foundation.result(target);
    assert.equal(result.status, "current");
    let receipt = result.receipt;
    assert(receipt.outcome.output.body.success);
    assert(Math.abs(receipt.outcome.output.body.candidate.x - 2) < 1e-7);
    const input = receipt.snapshot.input.body,
      output = receipt.outcome.output.body;
    assert.equal(
      input.request.program_sha256,
      py(
        "print(json.dumps(o.program_digest(json.load(sys.stdin))))",
        input.request.program,
      ),
    );
    for (const mutate of [
      (o) => (o.program_sha256 = "0".repeat(64)),
      (o) => (o.backend.source_sha256 = "0".repeat(64)),
      (o) => (o.candidate.output += 1),
      (o) => (o.evaluations = 501),
      (o) => (o.evaluations -= 1),
      (o) => (o.evaluations = null),
      (o) => (o.iterations = -1),
      (o) => (o.bounds[0] -= 1),
      (o) => (o.success = false),
    ]) {
      const bad = structuredClone(output);
      mutate(bad);
      assert.throws(() => modelOptimizations.validateOutput(input, bad));
    }
    const badInput = structuredClone(input);
    badInput.request.program.nodes[0] = { op: "const", value: 5 };
    assert.throws(() => modelOptimizations.validateInput(badInput));
    // Sampling is an explicit ordinary request from the exact reviewed capture, not live inputs.
    const callsBeforeResponse = calls;
    setModelInput(s, instance, "x", 123);
    const sampled = computeOptimizationResponse(s, view, receipt);
    const responseDone = await sampled.job.completion;
    assert.equal(responseDone.status, "retained", responseDone.reason);
    const responseRef = modelReference(s.document, sampled.item);
    const responseResult = s.foundation.result(responseRef);
    assert.equal(responseResult.status, "current");
    const responseReceipt = responseResult.receipt;
    assert.deepEqual(responseReceipt.snapshot.input.body, {
      ...input.scalar,
      points: 41,
    });
    assert.equal(
      calls,
      callsBeforeResponse,
      "native captured sampling never launches SciPy",
    );
    assert.equal(responseReceipt.outcome.output.body.points.length, 41);
    assert.equal(responseReceipt.outcome.output.body.points[0][1], 25);
    const tamperedSeries = structuredClone(responseReceipt.outcome.output.body);
    tamperedSeries.points.pop();
    assert.throws(() =>
      modelAnalyses.method.validateOutput(
        responseReceipt.snapshot.input.body,
        tamperedSeries,
      ),
    );
    // Native annotations are evidence, not free-standing UI hints. Rewriting only
    // markers leaves the projected sweep input unchanged and must still reject.
    for (const mutate of [
      (b) => {
        b.target = b.target === null ? 1 : b.target + 1;
      },
      (b) => {
        b.candidate =
          b.candidate === b.capture.low ? b.capture.high : b.capture.low;
      },
      (b) => {
        b.receipt = "missing-optimization-receipt";
      },
      (b) => {
        b.source.item = sampled.item;
      },
      (b) => {
        b.source.selection.revision = responseReceipt.snapshot.origin.revision;
      },
      (b) => {
        b.capture.high += 1;
      },
      (b) => {
        b.capture.inputs[b.capture.x.port].value += 1;
        b.current += 1;
      },
    ]) {
      const envelope = structuredClone(s.native());
      const revision = Object.values(envelope.document.revisions).find(
        (r) =>
          r.item === sampled.item && r.schema === "canvas-model-response@1",
      );
      assert(revision);
      mutate(revision.body);
      await assert.rejects(() => stageWorkspaceFile(archive(envelope)));
      assert.throws(() =>
        s.applyCommands([
          {
            kind: "revise",
            item: sampled.item,
            revision: {
              ...revision,
              id: "tampered-response-" + crypto.randomUUID(),
            },
          },
        ]),
      );
    }
    const sampledNative = await stageWorkspaceFile(archive(s.native()));
    assert.equal(sampledNative.executionDiagnostics.running, 0);
    assert.deepEqual(
      sampledNative.foundation.result(
        modelReference(sampledNative.document, sampled.item),
      ).receipt.outcome.output.body,
      responseReceipt.outcome.output.body,
    );
    sampledNative.dispose();
    const responseDb = canvasLocalStore(f.memoryBackend());
    await responseDb.load();
    await responseDb.save(s);
    const responseRecovered = await responseDb.load();
    assert(responseRecovered);
    await responseDb.close();
    s.undo(); // Explicit response request creation is one ordinary authored step.
    s.undo(); // Restore pre-sampling live input.
    assert.equal(f.current(s.document, instance), initial);
    const beforeApply = s.document;
    applyOptimizationCandidate(s, view, receipt, beforeApply);
    assert(
      Math.abs(f.current(s.document, instance).body.inputs.x.value - 2) < 1e-7,
    );
    assert.notEqual(s.foundation.result(target).status, "current");
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, s.document),
    );
    undoOptimizationApply(s, s.document);
    assert.equal(f.current(s.document, instance), initial);
    applyOptimizationCandidate(s, view, receipt, s.document);
    const afterApply = s.document;
    setModelInput(s, instance, "x", 7);
    assert.throws(() => undoOptimizationApply(s, afterApply), /Later work/);
    s.undo();
    s.undo();
    assert.equal(f.current(s.document, instance), initial);
    assert.equal(s.foundation.result(target).status, "current");
    s.preview(target, []);
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, s.document),
    );
    s.cancelPreview();
    setModelInput(s, instance, "x", 3);
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, beforeApply),
    );
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, s.document),
    );
    s.undo();
    keepModelOptimization(s, view, { x: 1000, y: 0 });
    const kept = [...s.document.views.entries()]
      .map(([, v]) => v)
      .find((v) => v.alternative);
    assert.throws(() =>
      applyOptimizationCandidate(s, kept, receipt, s.document),
    );
    // Imported receipts retain evidence, not jobs; their validation rechecks captured scalar meaning.
    const native = archive(s.native());
    const loaded = await stageWorkspaceFile(native);
    assert.equal(loaded.executionDiagnostics.running, 0);
    assert.equal(
      loaded.foundation.result(modelReference(loaded.document, item)).receipt
        .outcome.output.body.program_sha256,
      output.program_sha256,
    );
    assert(native.includes(output.program_sha256));
    loaded.dispose();
    const db = canvasLocalStore(f.memoryBackend());
    await db.load();
    await db.save(s);
    const recovered = await db.load();
    assert(recovered);
    await db.close();
    const beforeBinding = f.current(s.document, instance);
    const csv = s.importData("x.csv", "x\n1\n", { x: 0, y: 900 });
    applyModelConnection(s, reviewModelCsv(s, instance, "x", csv, 0, 0, "1"));
    const connected = f.current(s.document, instance);
    assert.equal(connected.body.inputs.x.kind, "reference");
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, s.document),
    );
    await s.compute(target).completion;
    receipt = s.foundation.result(target).receipt;
    applyOptimizationCandidate(s, view, receipt, s.document);
    assert.equal(f.current(s.document, instance).body.inputs.x.kind, "value");
    s.undo();
    assert.equal(f.current(s.document, instance), connected);
    assert.notEqual(connected, beforeBinding);
    reviseModelOptimization(
      s,
      item,
      { ...spec, high: 6 },
      s.document,
      capability,
    );
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, s.document),
    );
    s.undo();
    s.applyCommands([
      { kind: "removeView", id: instance + ":view" },
      { kind: "delete", item: instance },
      { kind: "delete", item: instance + ":result" },
    ]);
    assert.throws(() =>
      applyOptimizationCandidate(s, view, receipt, s.document),
    );
    s.dispose();
    for (const [text, mode, targetValue, expectedCode, expectedX] of [
      ["y = (x - 2)^2", "maximize", null, "converged", -3],
      ["y = x", "minimize", null, "converged", -3],
      ["y = x", "target", 2, "converged", 2],
      ["y = x", "target", -3, "converged", -3],
      ["y = x", "target", 99, "no_bracket", null],
      ["y = floor(x)", "target", 0.5, "residual_not_met", null],
      ["y = sqrt(x)", "minimize", null, "domain_error", null],
    ]) {
      const b = fixture(text);
      reviseModelOptimization(
        b.s,
        b.item,
        {
          ...spec,
          mode,
          target: targetValue,
          residualTolerance: mode === "target" ? 1e-8 : null,
        },
        b.s.document,
        capability,
      );
      await b.s.compute(b.target).completion;
      const r = b.s.foundation.result(b.target).receipt;
      assert.equal(r.outcome.status, "success", r.outcome.reason);
      const out = r.outcome.output.body;
      assert.equal(out.code, expectedCode, text);
      if (expectedX !== null)
        assert(Math.abs(out.candidate.x - expectedX) < 1e-7);
      if (mode === "target" && out.success) {
        assert.equal(
          out.evaluations,
          out.iterations === 0 ? 2 : out.iterations + 4,
        );
        for (const mutate of [
          (o) => (o.evaluations += 1),
          (o) => (o.evaluations -= 1),
          (o) => (o.iterations += 1),
          (o) => {
            o.evaluations = 2;
            o.iterations = 200;
          },
          (o) => {
            o.evaluations = 2;
            o.iterations = 0;
            o.candidate.x = 2;
          },
        ]) {
          const bad = structuredClone(out);
          mutate(bad);
          assert.throws(() =>
            modelOptimizations.validateOutput(r.snapshot.input.body, bad),
          );
        }
      }
      if (expectedCode === "domain_error") {
        const stopped = computeOptimizationResponse(b.s, b.view, r);
        assert.equal((await stopped.job.completion).status, "retained");
        const failure = b.s.foundation.result(
          modelReference(b.s.document, stopped.item),
        );
        assert.equal(failure.receipt.outcome.status, "failed");
        assert.equal(
          "output" in failure.receipt.outcome,
          false,
          "Failed sampling never fabricates a partial series",
        );
      }
      if (!out.success)
        assert.throws(() =>
          applyOptimizationCandidate(b.s, b.view, r, b.s.document),
        );
      b.s.dispose();
    }
    // Every admitted operation differentially checked against the existing scalar engine.
    for (const expression of [
      "x",
      "x+2",
      "x-2",
      "x*2",
      "x/2",
      "x^2",
      "-x",
      "sqrt(x)",
      "abs(x)",
      "sin(x)",
      "cos(x)",
      "tan(x)",
      "asin(x/4)",
      "acos(x/4)",
      "atan(x)",
      "sinh(x)",
      "cosh(x)",
      "tanh(x)",
      "exp(x)",
      "ln(x)",
      "log10(x)",
      "floor(x)",
      "ceil(x)",
      "round(x)",
      "cbrt(x)",
      "atan2(x,2)",
      "min(x,2)",
      "max(x,2)",
      "(-8)^(x/3)",
    ]) {
      const b = fixture("y = " + expression);
      reviewOptimizationRuntime(b.s, b.item, capability, b.s.document);
      // Capture via compute; one real solve checks returned candidate, then independent points compare lowering directly.
      const done = await b.s.compute(b.target).completion;
      assert.equal(done.status, "retained", expression);
      const r = b.s.foundation.result(b.target).receipt;
      assert.equal(
        r.outcome.status,
        "success",
        expression + ": " + r.outcome.reason,
      );
      const capture = r.snapshot.input.body;
      for (const x of expression.startsWith("(-8)")
        ? [1, 2, 3]
        : [1, 1.4999999999999, 2.0000000000001]) {
        const y = py(
          "b=json.load(sys.stdin);print(json.dumps(o._evaluate(b['program'],b['x'])))",
          { program: lowerOptimization(capture.scalar), x },
        );
        const expected = modelAnalyses.evaluator(capture.scalar)(x, 0);
        assert(
          Math.abs(y - expected) <= Math.max(1e-15, Math.abs(expected) * 1e-12),
          expression,
        );
      }
      b.s.dispose();
    }
    // Equivalent-unit source observations normalize through existing scalar binding; mismatches refuse.
    const b = fixture("y = x * force", [
      { id: "force", text: "force = 200 cm", mathVersion: 3 },
    ]);
    const data = b.s.importData("force.csv", "f\n2\n", { x: 0, y: 900 });
    applyModelConnection(
      b.s,
      reviewModelCsv(b.s, b.instance, "force", data, 0, 0, "m"),
    );
    assert.throws(() =>
      reviewModelCsv(b.s, b.instance, "force", data, 0, 0, "s"),
    );
    // Foundation source bindings deliberately require exact units; authored literals normalize equivalent units.
    assert.equal(
      f.current(b.s.document, b.def).body.model.nodes["n-force"].default,
      2,
    );
    reviewOptimizationRuntime(b.s, b.item, capability, b.s.document);
    await b.s.compute(b.target).completion;
    const out = b.s.foundation.result(b.target).receipt.outcome.output.body;
    assert.equal(out.candidate.output, -6);
    b.s.dispose();
    console.log(
      `Model optimization: ${calls} real SciPy jobs, strict lowering/digest/runtime/output/count checks, immutable Run, stale/preview/kept Apply refusal, Undo/source restoration, local/native captures and v3 differential operations pass.`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
