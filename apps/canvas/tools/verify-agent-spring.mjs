/** Independent, read-only acceptance oracle. Never edits or computes the submitted candidate. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import { validateWorkspace } from "manifold-canvas/agent";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { RegionSession } from "../src/regions/document.ts";

export const springBaseline = new URL(
  "../tests/fixtures/agent-spring/baseline.manifold",
  import.meta.url,
);

function only(values, predicate, description) {
  const matches = values.filter(predicate);
  assert.equal(matches.length, 1, `Expected one ${description}`);
  return matches[0];
}
function scalar(projection, value, unit) {
  assert.equal(projection.status, "resolved");
  assert.equal(projection.projection.type, "scalar");
  assert.equal(projection.projection.value.value, value);
  assert.equal(projection.projection.value.unit, unit);
}

export async function verifyAgentSpring(candidateText, report) {
  const baseline = await openHeadlessWorkspace(
    await readFile(springBaseline, "utf8"),
  );
  let candidate, canvas;
  try {
    candidate = await openHeadlessWorkspace(candidateText);
    assert.equal(
      candidate.read().document,
      baseline.read().document,
      "Preserve stable document identity",
    );
    assert.notEqual(
      candidate.read().id,
      baseline.read().id,
      "Return changed work, not the baseline",
    );
    const oldSheet = baseline.worksheet(),
      sheet = candidate.worksheet();
    assert.equal(
      sheet.context,
      oldSheet.context,
      "Do not switch worksheet context",
    );
    assert.deepEqual(
      sheet.regions.map((region) => region.id),
      oldSheet.regions.map((region) => region.id),
      "Preserve all worksheet regions and their order",
    );
    const oldX = only(
      oldSheet.regions,
      (region) => region.name === "x",
      "worksheet displacement",
    );
    const x = only(
      sheet.regions,
      (region) => region.id === oldX.id,
      "candidate displacement",
    );
    assert.equal(
      x.quantity?.value,
      4 / 1000,
      "Worksheet displacement must be 4 mm, not 4 base-unit metres",
    );
    assert.equal(x.quantity.unit, "m");
    const force = only(
      sheet.regions,
      (region) => region.text === "F = k*x",
      "worksheet force",
    );
    assert.equal(
      force.quantity?.value,
      4 * 10,
      "Independently expected force: 4 mm × 10 N/mm",
    );
    assert.equal(force.quantity.unit, "N");
    const limit = only(
      sheet.regions,
      (region) => region.text === "F < 30 N",
      "unchanged constraint",
    );
    assert.equal(
      limit.constraint?.pass,
      false,
      "Do not conceal or loosen the failed force constraint",
    );
    for (const region of sheet.regions) {
      const old = oldSheet.regions.find((before) => before.id === region.id);
      assert.equal(
        region.diagnostic,
        null,
        "The final candidate must have no worksheet drafts/diagnostics",
      );
      assert.deepEqual(
        region.position,
        old.position,
        "Do not move unrelated work",
      );
      if (region.id !== x.id)
        assert.equal(
          region.text,
          old.text,
          "Preserve all other worksheet source and notes",
        );
    }
    const oldModels = baseline.models(),
      models = candidate.models();
    assert.deepEqual(
      models.map((model) => model.id),
      oldModels.map((model) => model.id),
      "Preserve both model identities",
    );
    const oldSpring = only(
      oldModels,
      (model) =>
        model.inputs.some(
          (input) => input.id === "displacement" && input.unit === "mm",
        ),
      "spring model",
    );
    const spring = only(
      models,
      (model) => model.id === oldSpring.id,
      "candidate spring",
    );
    const displacement = only(
      spring.inputs,
      (input) => input.id === "displacement",
      "spring displacement input",
    );
    scalar(displacement.projection, 4, "mm");
    assert.deepEqual(displacement.binding, {
      kind: "value",
      value: 4,
      unit: "mm",
    });
    scalar(
      only(
        spring.outputs,
        (output) => output.id === "force",
        "spring force output",
      ).projection,
      40,
      "N",
    );
    const request = only(
      spring.requests,
      (request) => request.outputs.includes("force"),
      "spring force request",
    );
    assert.equal(
      request.result.status,
      "current",
      "A projection is not current checked computation evidence",
    );
    const receipt = request.result.receipt;
    assert.equal(receipt.outcome.status, "success");
    assert.equal(receipt.outcome.output.value, 40);
    assert.equal(receipt.outcome.output.unit, "N");
    assert.equal(receipt.physicalValidity, "not-assessed");
    assert.notEqual(
      receipt.id,
      oldSpring.requests[0].result.receipt.id,
      "Do not reuse baseline spring evidence",
    );

    // Compare accepted authored records, not just the visible quantities or the agent's report.
    const oldItems = baseline.items(),
      items = candidate.items();
    assert.deepEqual(
      items.map((item) => item.id),
      oldItems.map((item) => item.id),
      "Do not add or delete authored items",
    );
    for (const item of items) {
      const old = oldItems.find((before) => before.id === item.id);
      assert.equal(item.label, old.label, "Preserve labels");
      assert.equal(item.revision.schema, old.revision.schema);
      let expected = old.revision.body;
      if (item.id === spring.id)
        expected = {
          ...expected,
          inputs: {
            ...expected.inputs,
            displacement: { kind: "value", value: 4, unit: "mm" },
          },
        };
      else if (expected.kind === "region" && expected.value.id === x.id)
        expected = { ...expected, value: { ...expected.value, text: x.text } };
      assert.deepEqual(
        item.revision.body,
        expected,
        `Unrequested authored change: ${item.id}`,
      );
    }
    for (const model of models.filter((model) => model.id !== spring.id)) {
      const old = oldModels.find((before) => before.id === model.id);
      assert.deepEqual(
        model.requests.map((request) => ({
          id: request.id,
          result: request.result,
        })),
        old.requests.map((request) => ({
          id: request.id,
          result: request.result,
        })),
        "Do not replace the unrelated model's checked evidence",
      );
    }
    const validation = validateWorkspace(candidate);
    assert.equal(validation.admitted, true);
    assert.equal(validation.clean, false);
    assert.deepEqual(
      validation.issues.map((issue) => ({
        kind: issue.kind,
        target: issue.target,
      })),
      [{ kind: "constraint-failed", target: limit.id }],
      "Only the intended failed constraint should remain",
    );

    // Exercise the canvas-native reader/owner, not a fabricated report-only file.
    const decoded = await decodeWorkspace(candidateText);
    assert.equal(decoded.sceneError, undefined);
    canvas = new RegionSession(
      decoded.page,
      () => [],
      decoded.document,
      decoded.artifacts,
      false,
      decoded.recovery,
      { artifactExecutor: null },
    );
    assert.equal(canvas.document.document, baseline.read().document);
    assert.equal(canvas.foundation.result(request.reference).status, "current");
    assert.equal(
      canvas.state.regions.find((region) => region.id === x.id).text,
      x.text,
    );

    assert(
      report && typeof report === "object" && !Array.isArray(report),
      "Provide the required report object",
    );
    for (const [key, expected] of Object.entries({
      worksheetDisplacementMm: 4,
      worksheetForceN: 40,
      modelDisplacementMm: 4,
      modelForceN: 40,
      constraintPass: false,
      validationExitCode: 3,
      requestId: request.id,
      receiptId: receipt.id,
      resultStatus: "current",
      computationOutcome: "success",
      physicalValidity: "not-assessed",
    }))
      assert.equal(
        report[key],
        expected,
        `Report must match independently checked ${key}`,
      );
    assert.equal(typeof report.summary, "string");
    assert(
      report.summary.trim(),
      "Provide a human-readable summary, not just numbers",
    );
    return {
      passed: true,
      worksheetForceN: 40,
      modelForceN: 40,
      constraintPass: false,
      resultStatus: "current",
      physicalValidity: "not-assessed",
    };
  } finally {
    canvas?.dispose();
    candidate?.dispose();
    baseline.dispose();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.equal(
      process.argv.length,
      4,
      "Usage: node apps/canvas/tools/verify-agent-spring.mjs CANDIDATE REPORT_JSON",
    );
    const candidatePath = resolve(process.argv[2]);
    assert.notEqual(
      candidatePath,
      fileURLToPath(springBaseline),
      "Candidate must be a separate file",
    );
    const report = JSON.parse(await readFile(process.argv[3], "utf8"));
    assert.equal(
      report.candidate,
      candidatePath,
      "Report candidate path must match the submitted absolute path",
    );
    const result = await verifyAgentSpring(
      await readFile(candidatePath, "utf8"),
      report,
    );
    console.log(JSON.stringify({ ...result, candidate: candidatePath }));
  } catch (error) {
    console.error(JSON.stringify({ passed: false, error: error.message }));
    process.exitCode = 1;
  }
}
