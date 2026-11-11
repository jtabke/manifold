import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import {
  recoveryBaseline,
  verifyAgentRecovery,
} from "../tools/verify-agent-recovery.mjs";
const cli = fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url));
const verifier = fileURLToPath(
  new URL("../tools/verify-agent-recovery.mjs", import.meta.url),
);
const baseline = fileURLToPath(recoveryBaseline),
  baselineBytes = await readFile(baseline, "utf8");
const directory = await mkdtemp(join(tmpdir(), "manifold-recovery-"));
const file = (name) => join(directory, name);
function run(script, args, status = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    status,
    `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  assert.equal(
    status === 0 || status === 3 ? result.stderr : result.stdout,
    "",
  );
  return JSON.parse(
    status === 0 || status === 3 ? result.stdout : result.stderr,
  );
}
try {
  const initial = run(cli, ["inspect", baseline, "--compact"]);
  const x = initial.worksheet.regions.find((row) => row.name === "x");
  const reserve = initial.worksheet.regions.find(
    (row) => row.name === "reserve",
  );
  const limit = initial.worksheet.regions.find(
    (row) => row.kind === "constraint",
  );
  const spring = initial.models.find((model) =>
    model.inputs.some((input) => input.id === "displacement"),
  );
  const request = spring.requests[0];
  const initialIssues = run(cli, ["validate", baseline, "--strict"], 3).issues;
  assert.deepEqual(
    initialIssues.map((issue) => issue.kind),
    ["worksheet-diagnostic", "worksheet-diagnostic", "computation-not-current"],
  );
  assert.equal(x.quantity.unit, "s");
  assert.equal(limit.constraint, null);
  assert.equal(
    limit.diagnostic,
    "The result F has units kg·s^-1, but its limit has units N. Check the units of F and its inputs.",
  );
  assert.equal(reserve.quantity, null);
  assert(reserve.diagnostic);
  assert.equal(request.result.status, "ready");
  assert.equal(request.result.receipt, undefined);
  assert.equal(
    spring.outputs[0].projection.value,
    40,
    "Projected answer is available without current evidence",
  );
  const edits = [
    { operation: "updateEquation", region: x.id, text: "x := 4 mm" },
    { operation: "updateEquation", region: reserve.id, text: "reserve := 5 N" },
  ];
  await writeFile(
    file("bad.json"),
    JSON.stringify({
      expectedDocumentId: initial.documentId,
      edits: [
        edits[0],
        {
          operation: "updateEquation",
          region: "missing-region",
          text: "reserve := 5 N",
        },
      ],
    }),
  );
  run(
    cli,
    [
      "edit",
      baseline,
      "--changes",
      file("bad.json"),
      "--output",
      file("bad.manifold"),
    ],
    2,
  );
  await assert.rejects(access(file("bad.manifold")));
  await writeFile(
    file("repair.json"),
    JSON.stringify({ expectedDocumentId: initial.documentId, edits }),
  );
  run(cli, [
    "edit",
    baseline,
    "--changes",
    file("repair.json"),
    "--output",
    file("repaired.manifold"),
  ]);
  run(
    cli,
    [
      "edit",
      file("repaired.manifold"),
      "--changes",
      file("repair.json"),
      "--output",
      file("stale.manifold"),
    ],
    6,
  );
  await assert.rejects(access(file("stale.manifold")));
  const repaired = run(cli, [
    "inspect",
    file("repaired.manifold"),
    "--compact",
  ]);
  const repairedIssues = run(
    cli,
    ["validate", file("repaired.manifold"), "--strict"],
    3,
  ).issues;
  assert.deepEqual(
    repairedIssues.map((issue) => issue.kind),
    ["constraint-failed", "computation-not-current"],
  );
  assert.equal(
    repaired.worksheet.regions.find((row) => row.id === limit.id).constraint
      .pass,
    false,
  );
  assert.equal(
    repaired.models.find((model) => model.id === spring.id).requests[0].result
      .status,
    "ready",
  );
  const diff = run(cli, ["diff", baseline, file("repaired.manifold")]);
  assert.deepEqual(
    diff.regions
      .filter((row) => row.before.text !== row.after.text)
      .map((row) => row.id)
      .sort(),
    [x.id, reserve.id].sort(),
  );
  run(cli, [
    "compute",
    file("repaired.manifold"),
    "--request",
    request.id,
    "--timeout-ms",
    "5000",
    "--output",
    file("candidate.manifold"),
  ]);
  const final = run(cli, ["inspect", file("candidate.manifold"), "--compact"]);
  const result = final.models.find((model) => model.id === spring.id)
    .requests[0].result;
  assert.equal(result.status, "current");
  assert.deepEqual(
    run(
      cli,
      ["validate", file("candidate.manifold"), "--strict"],
      3,
    ).issues.map((issue) => issue.kind),
    ["constraint-failed"],
  );
  run(cli, ["diff", file("repaired.manifold"), file("candidate.manifold")]);
  const report = {
    repaired: file("repaired.manifold"),
    candidate: file("candidate.manifold"),
    diagnoses: [
      { kind: "incompatible-units", target: x.id },
      { kind: "unresolved-reference", target: reserve.id },
      { kind: "computation-not-current", target: request.id },
    ],
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
    requestId: request.id,
    receiptId: result.receipt.id,
    computationOutcome: "success",
    physicalValidity: "not-assessed",
    summary:
      "Corrected time to length and replaced the unresolved reserve reference with 5 N. The spring input already was 4 mm, but its projected 40 N lacked a current receipt; explicitly computed only that request. The unchanged F < 30 N requirement now genuinely fails. Strict validation remains 3, not clean; linear-spring assumptions and physical validity are unassessed.",
  };
  await writeFile(file("report.json"), JSON.stringify(report));
  assert.equal(
    run(verifier, [
      file("repaired.manifold"),
      file("candidate.manifold"),
      file("report.json"),
    ]).passed,
    true,
  );
  const a = await readFile(file("repaired.manifold"), "utf8"),
    b = await readFile(file("candidate.manifold"), "utf8");
  assert.equal(
    (
      await verifyAgentRecovery(a, b, {
        ...report,
        diagnoses: report.diagnoses.toReversed(),
      })
    ).passed,
    true,
  );
  await assert.rejects(verifyAgentRecovery(baselineBytes, b, report));
  await assert.rejects(
    verifyAgentRecovery(a, a, report),
    /Compute only|current receipt/,
  );
  await assert.rejects(verifyAgentRecovery(b, b, report), /before execution/);
  for (const bad of [
    { ...report, diagnoses: report.diagnoses.slice(1) },
    { ...report, initialResultStatus: "stale" },
    { ...report, repairedResultStatus: "current" },
    { ...report, constraintPass: true },
    { ...report, validationExitCode: 0 },
    { ...report, receiptId: "invented" },
    { ...report, physicalValidity: "safe" },
    { ...report, summary: "" },
  ])
    await assert.rejects(verifyAgentRecovery(a, b, bad));
  for (const mutate of [
    (owner) => owner.updateEquation(x.id, "x := 4 s", owner.read().id),
    (owner) =>
      owner.updateEquation(
        reserve.id,
        "reserve = missingReserve",
        owner.read().id,
      ),
    (owner) => owner.updateEquation(limit.id, "F < 50 N", owner.read().id),
    (owner) => owner.updateEquation(x.id, "x := 2 mm", owner.read().id),
    (owner) => owner.createEquation("missingReserve := 5 N", owner.read().id),
    (owner) =>
      owner.setModelInput(spring.id, "displacement", 2, owner.read().id),
    (owner) =>
      owner.updateNote(
        initial.worksheet.regions.find((row) => row.kind === "note").id,
        "Rewritten",
        owner.read().id,
      ),
  ]) {
    const owner = await openHeadlessWorkspace(b);
    try {
      await mutate(owner);
      await assert.rejects(verifyAgentRecovery(a, owner.export(), report));
    } finally {
      owner.dispose();
    }
  }
  for (const kind of ["required", "view"]) {
    const archive = JSON.parse(b),
      document = archive.foundation.document;
    if (kind === "required") {
      const item = Object.values(document.items).find(
        (item) =>
          document.revisions[item.revision].body?.value?.text ===
          "k := 10 N/mm",
      );
      document.revisions[item.revision].required = false;
    } else {
      const view = Object.values(document.views).find(
        (view) =>
          view.reference.item ===
          `region:${initial.worksheet.regions.find((row) => row.kind === "note").id}`,
      );
      view.reference.selector.explicit = !view.reference.selector.explicit;
    }
    const text = JSON.stringify(archive),
      admitted = await openHeadlessWorkspace(text);
    admitted.dispose();
    await assert.rejects(verifyAgentRecovery(a, text, report));
  }
  for (const stage of ["repaired", "candidate"]) {
    for (const removed of ["old-receipt", "old-spring-and-receipt"]) {
      const archive = JSON.parse(stage === "repaired" ? a : b);
      const foundation = archive.foundation;
      const oldReceipt = foundation.receipts.find(
        (receipt) => receipt.outcome.output?.value === 20,
      );
      assert(oldReceipt, "Fixture retains the historical 20 N spring receipt");
      foundation.receipts = foundation.receipts.filter(
        (receipt) => receipt.id !== oldReceipt.id,
      );
      if (
        !foundation.receipts.some(
          (receipt) => receipt.context === oldReceipt.context,
        )
      )
        delete foundation.contexts[oldReceipt.context];
      if (
        !foundation.receipts.some(
          (receipt) => receipt.snapshot === oldReceipt.snapshot,
        )
      )
        delete foundation.snapshots[oldReceipt.snapshot];
      if (removed === "old-spring-and-receipt") {
        const historical = Object.entries(foundation.document.revisions).find(
          ([, revision]) =>
            revision.item === spring.id &&
            revision.id !== foundation.document.items[spring.id].revision,
        );
        assert(historical);
        delete foundation.document.revisions[historical[0]];
      }
      const text = JSON.stringify(archive);
      const admitted = await openHeadlessWorkspace(text);
      admitted.dispose();
      await assert.rejects(
        verifyAgentRecovery(
          stage === "repaired" ? text : a,
          stage === "candidate" ? text : b,
          report,
        ),
        /historical|history|retained receipt|permitted new receipt/,
      );
    }
  }
  assert.equal(await readFile(baseline, "utf8"), baselineBytes);
  assert.equal(await readFile(file("repaired.manifold"), "utf8"), a);
  assert.equal(await readFile(file("candidate.manifold"), "utf8"), b);
  console.log(
    "Agent recovery: unit/reference diagnostics, non-current projections, guarded scoped repair, explicit evidence, honest residual failure and negative handoffs passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
