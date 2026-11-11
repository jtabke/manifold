/** Read-only staged-recovery oracle. Never edits or computes submitted work. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import { validateWorkspace } from "manifold-canvas/agent";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { RegionSession } from "../src/regions/document.ts";

export const recoveryBaseline = new URL(
  "../tests/fixtures/agent-recovery/baseline.manifold",
  import.meta.url,
);
function only(values, predicate, description) {
  const found = values.filter(predicate);
  assert.equal(found.length, 1, `Expected one ${description}`);
  return found[0];
}
function quantity(row, value, unit, dimension) {
  assert.equal(row.quantity?.value, value, `Incorrect ${row.name} value`);
  assert.equal(row.quantity.unit, unit);
  assert.deepEqual(row.quantity.dimension, dimension);
}
function receiptFacts(receipts) {
  return receipts
    .map((receipt) => ({
      ...receipt,
      context: {
        ...receipt.context,
        heads: [...receipt.context.heads.entries()],
        revisions: [...receipt.context.revisions.entries()],
      },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function issues(workspace) {
  return validateWorkspace(workspace).issues.map(({ kind, target }) => ({
    kind,
    target,
  }));
}
export async function verifyAgentRecovery(repairedText, candidateText, report) {
  const owners = [];
  let canvas;
  const open = async (text) => {
    const owner = await openHeadlessWorkspace(text);
    owners.push(owner);
    return owner;
  };
  try {
    const baselineText = await readFile(recoveryBaseline, "utf8");
    const baseline = await open(baselineText);
    const repaired = await open(repairedText),
      candidate = await open(candidateText);
    const oldRows = baseline.worksheet().regions;
    const x = only(oldRows, (row) => row.name === "x", "displacement");
    const reserve = only(oldRows, (row) => row.name === "reserve", "reserve");
    const limit = only(
      oldRows,
      (row) => row.text === "F < 30 N",
      "force requirement",
    );
    const spring = only(
      baseline.models(),
      (model) => model.inputs.some((input) => input.id === "displacement"),
      "spring",
    );
    const requestId = spring.requests[0].id;
    assert.equal(x.text, "x := 4 s");
    assert.equal(x.quantity.unit, "s");
    assert.equal(reserve.quantity, null);
    assert(reserve.diagnostic);
    assert.equal(spring.requests[0].result.status, "ready");
    assert.deepEqual(issues(baseline), [
      { kind: "worksheet-diagnostic", target: limit.id },
      { kind: "worksheet-diagnostic", target: reserve.id },
      { kind: "computation-not-current", target: requestId },
    ]);
    const oldItems = baseline.items();
    for (const workspace of [repaired, candidate]) {
      assert.equal(workspace.read().document, baseline.read().document);
      assert.equal(workspace.worksheet().context, baseline.worksheet().context);
      assert.notEqual(workspace.read().id, baseline.read().id);
      const rows = workspace.worksheet().regions;
      assert.deepEqual(
        rows.map((row) => row.id),
        oldRows.map((row) => row.id),
      );
      for (const row of rows) {
        const old = oldRows.find((old) => old.id === row.id);
        assert.deepEqual(
          row.position,
          old.position,
          "Preserve every region position",
        );
        assert.equal(
          row.diagnostic,
          null,
          "Repair diagnostics without leaving drafts",
        );
        if (![x.id, reserve.id].includes(row.id))
          assert.equal(
            row.text,
            old.text,
            "Only repair the two authorized sources",
          );
      }
      quantity(
        rows.find((row) => row.id === x.id),
        4 / 1000,
        "m",
        [0, 1, 0, 0],
      );
      const reserveRow = rows.find((row) => row.id === reserve.id);
      assert.equal(reserveRow.name, "reserve");
      assert.equal(
        reserveRow.kind,
        "quantity",
        "Repair the existing reserve with a literal, not another reference",
      );
      quantity(reserveRow, 5, "N", [1, 1, -2, 0]);
      quantity(
        only(rows, (row) => row.text === "F = k*x", "derived spring force"),
        4 * 10,
        "N",
        [1, 1, -2, 0],
      );
      assert.equal(
        rows.find((row) => row.id === limit.id).constraint?.pass,
        false,
      );
      const items = workspace.items();
      assert.deepEqual(
        items.map((item) => item.id),
        oldItems.map((item) => item.id),
        "No additions/deletions",
      );
      for (const old of oldItems) {
        const item = items.find((item) => item.id === old.id);
        const regionId =
          old.revision.body.kind === "region"
            ? old.revision.body.value.id
            : null;
        if ([x.id, reserve.id].includes(regionId)) {
          assert.notEqual(item.revision.id, old.revision.id);
          const text = rows.find((row) => row.id === regionId).text;
          assert.deepEqual(
            item,
            {
              ...old,
              revision: {
                ...old.revision,
                id: item.revision.id,
                body: {
                  ...old.revision.body,
                  value: { ...old.revision.body.value, text },
                },
              },
            },
            "Preserve all non-source fields of repaired records",
          );
        } else
          assert.deepEqual(
            item,
            old,
            "Preserve every unrelated record and revision header",
          );
      }
      assert.deepEqual(
        [...workspace.read().views.entries()],
        [...baseline.read().views.entries()],
        "Preserve all views",
      );
      for (const model of workspace.models()) {
        if (model.id === spring.id) continue;
        const old = baseline.models().find((old) => old.id === model.id);
        assert.deepEqual(
          model.requests,
          old.requests,
          "Do not recompute unrelated work",
        );
      }
    }
    assert.deepEqual(
      candidate.items(),
      repaired.items(),
      "Computation must not edit authored records",
    );
    // Native export intentionally drops unpinned superseded source heads, not receipt-pinned history.
    const replacedHeads = new Set(
      oldItems
        .filter(
          (item) =>
            item.revision.body.kind === "region" &&
            [x.id, reserve.id].includes(item.revision.body.value.id),
        )
        .map((item) => item.revision.id),
    );
    for (const [id, revision] of baseline.read().revisions.entries())
      if (!replacedHeads.has(id))
        assert.deepEqual(
          repaired.read().revisions.get(id),
          revision,
          "Preserve protected baseline historical revisions",
        );
    const portableRepaired = await open(repaired.export());
    for (const [id, revision] of portableRepaired.read().revisions.entries())
      assert.deepEqual(
        candidate.read().revisions.get(id),
        revision,
        "Computation must preserve native-retained revision history",
      );
    for (const [id, revision] of candidate.read().revisions.entries())
      assert.deepEqual(
        repaired.read().revisions.get(id),
        revision,
        "Computation cannot add or alter revision history",
      );
    assert.equal(
      repaired.read().evidenceSequence,
      baseline.read().evidenceSequence,
      "Save repaired stage before execution",
    );
    assert.equal(
      candidate.read().evidenceSequence,
      baseline.read().evidenceSequence + 1,
      "Compute only the requested spring job",
    );
    const repairedResult = repaired
      .models()
      .find((model) => model.id === spring.id).requests[0].result;
    const result = candidate.models().find((model) => model.id === spring.id)
      .requests[0].result;
    assert.equal(repairedResult.status, "ready");
    assert.equal(
      result.status,
      "current",
      "Derived output or retained old evidence is not a current receipt",
    );
    assert.equal(result.receipt.outcome.status, "success");
    assert.equal(result.receipt.outcome.output.value, 4 * 10);
    assert.equal(result.receipt.outcome.output.unit, "N");
    assert.equal(result.receipt.physicalValidity, "not-assessed");
    const modelForce = candidate
      .models()
      .find((model) => model.id === spring.id)
      .outputs.find((output) => output.id === "force").projection;
    assert.equal(modelForce.status, "resolved");
    assert.equal(modelForce.projection.value.value, 40);
    assert.equal(modelForce.projection.value.unit, "N");
    assert.deepEqual(issues(repaired), [
      { kind: "constraint-failed", target: limit.id },
      { kind: "computation-not-current", target: requestId },
    ]);
    assert.deepEqual(issues(candidate), [
      { kind: "constraint-failed", target: limit.id },
    ]);

    const [baselineDecoded, repairedDecoded, decoded] = await Promise.all(
      [baselineText, repairedText, candidateText].map((text) =>
        decodeWorkspace(text),
      ),
    );
    const oldReceipts = receiptFacts(
      baselineDecoded.recovery.foundation.receipts,
    );
    const repairedReceipts = receiptFacts(
      repairedDecoded.recovery.foundation.receipts,
    );
    const finalReceipts = receiptFacts(decoded.recovery.foundation.receipts);
    assert.deepEqual(
      repairedReceipts,
      oldReceipts,
      "Repair must preserve every retained receipt",
    );
    assert(
      !oldReceipts.some((receipt) => receipt.id === result.receipt.id),
      "Require a new spring receipt",
    );
    assert.equal(
      finalReceipts.length,
      repairedReceipts.length + 1,
      "Retain exactly the permitted new receipt",
    );
    assert.deepEqual(
      finalReceipts.filter((receipt) => receipt.id !== result.receipt.id),
      repairedReceipts,
      "Computation must preserve historical receipts and their contexts",
    );
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
    assert.equal(
      canvas.foundation.result(candidate.reference(requestId)).status,
      "current",
    );
    assert.equal(
      canvas.state.regions.find((row) => row.id === x.id).text,
      candidate.worksheet().regions.find((row) => row.id === x.id).text,
    );

    assert(report && typeof report === "object" && !Array.isArray(report));
    assert(Array.isArray(report.diagnoses), "Report the three diagnoses");
    const byKind = (a, b) => a.kind.localeCompare(b.kind);
    assert.deepEqual(
      report.diagnoses.toSorted(byKind),
      [
        { kind: "incompatible-units", target: x.id },
        { kind: "unresolved-reference", target: reserve.id },
        { kind: "computation-not-current", target: requestId },
      ].toSorted(byKind),
      "Report all three distinct causes using discovered IDs",
    );
    for (const [key, expected] of Object.entries({
      initialValidationExitCode: 3,
      repairedValidationExitCode: 3,
      validationExitCode: 3,
      initialResultStatus: "ready",
      repairedResultStatus: "ready",
      resultStatus: "current",
      worksheetDisplacementMm: 4,
      reserveN: 5,
      worksheetForceN: 40,
      modelForceN: 40,
      constraintPass: false,
      requestId,
      receiptId: result.receipt.id,
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
      "Explain causes, residual failure and limitations",
    );
    return {
      passed: true,
      diagnoses: 3,
      resultStatus: "current",
      constraintPass: false,
      physicalValidity: "not-assessed",
    };
  } finally {
    canvas?.dispose();
    for (const owner of owners) owner.dispose();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.equal(
      process.argv.length,
      5,
      "Usage: node apps/canvas/tools/verify-agent-recovery.mjs REPAIRED CANDIDATE REPORT_JSON",
    );
    const repaired = resolve(process.argv[2]),
      candidate = resolve(process.argv[3]);
    assert.notEqual(repaired, candidate);
    for (const path of [repaired, candidate])
      assert.notEqual(path, fileURLToPath(recoveryBaseline));
    const report = JSON.parse(await readFile(process.argv[4], "utf8"));
    assert.equal(report.repaired, repaired);
    assert.equal(report.candidate, candidate);
    console.log(
      JSON.stringify(
        await verifyAgentRecovery(
          await readFile(repaired, "utf8"),
          await readFile(candidate, "utf8"),
          report,
        ),
      ),
    );
  } catch (error) {
    console.error(JSON.stringify({ passed: false, error: error.message }));
    process.exitCode = 1;
  }
}
