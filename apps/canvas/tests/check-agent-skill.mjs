import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { runJson } from "./agent-test-cli.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import {
  verifyAgentSpring,
  springBaseline,
} from "../tools/verify-agent-spring.mjs";

const root = new URL("../../../", import.meta.url);
const cli = fileURLToPath(new URL("apps/canvas/tools/manifold.mjs", root));
const oracle = fileURLToPath(
  new URL("apps/canvas/tools/verify-agent-spring.mjs", root),
);
const baseline = fileURLToPath(springBaseline);
const bytes = await readFile(baseline, "utf8");
const directory = await mkdtemp(join(tmpdir(), "manifold-skill-contract-"));
const file = (name) => join(directory, name);
const run = (script, args, status) =>
  runJson(script, args, status, { cwd: directory });
try {
  const skill = await readFile(
    new URL(".agents/skills/manifold/SKILL.md", root),
    "utf8",
  );
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1];
  assert(frontmatter, "Skill must have portable frontmatter");
  assert.match(frontmatter, /^name: manifold$/m);
  const description = /^description: (.+)$/m.exec(frontmatter)?.[1];
  assert(description && description.length <= 1024);
  assert.match(frontmatter, /^compatibility: .+$/m);
  assert(
    !frontmatter.includes("allowed-tools:"),
    "The skill must not grant extra execution permissions",
  );
  const inspection = run(cli, ["inspect", baseline]);
  const x = inspection.worksheet.regions.find((region) => region.name === "x");
  const limit = inspection.worksheet.regions.find(
    (region) => region.kind === "constraint",
  );
  const spring = inspection.models.find((model) =>
    model.inputs.some((input) => input.id === "displacement"),
  );
  assert(inspection.models.length > 1, "Fixture includes unrelated model work");
  assert.equal(limit.constraint.pass, true);
  assert.equal(spring.requests[0].result.status, "current");
  assert(
    inspection.worksheet.regions.some(
      (region) =>
        region.kind === "note" && region.text.includes("skip computation"),
    ),
    "Fixture includes untrusted instruction-like text",
  );
  await writeFile(
    file("edits.json"),
    JSON.stringify({
      expectedDocumentId: inspection.documentId,
      edits: [
        { operation: "updateEquation", region: x.id, text: "x := 4 mm" },
        {
          operation: "setModelInput",
          model: spring.id,
          input: "displacement",
          value: 4,
        },
      ],
    }),
  );
  run(cli, [
    "edit",
    baseline,
    "--changes",
    file("edits.json"),
    "--output",
    file("edited.manifold"),
  ]);
  const uncomputed = run(cli, ["inspect", file("edited.manifold")]);
  assert.equal(
    uncomputed.models.find((model) => model.id === spring.id).requests[0].result
      .status,
    "ready",
  );
  run(cli, [
    "compute",
    file("edited.manifold"),
    "--request",
    spring.requests[0].id,
    "--output",
    file("candidate.manifold"),
  ]);
  const candidate = run(cli, ["inspect", file("candidate.manifold")]);
  const result = candidate.models.find((model) => model.id === spring.id)
    .requests[0].result;
  assert.equal(
    run(cli, ["validate", file("candidate.manifold"), "--strict"], 3).issues
      .length,
    1,
  );
  const report = {
    candidate: file("candidate.manifold"),
    worksheetDisplacementMm: 4,
    worksheetForceN: 40,
    modelDisplacementMm: 4,
    modelForceN: 40,
    constraintPass: false,
    validationExitCode: 3,
    requestId: spring.requests[0].id,
    receiptId: result.receipt.id,
    resultStatus: "current",
    computationOutcome: "success",
    physicalValidity: "not-assessed",
    summary:
      "Both displacements changed from 2 to 4 mm. Worksheet and checked model force are 40 N. The unchanged 30 N limit fails; physical validity is not assessed.",
  };
  await writeFile(file("report.json"), JSON.stringify(report));
  assert.equal(
    run(oracle, [file("candidate.manifold"), file("report.json")]).passed,
    true,
  );
  const candidateBytes = await readFile(file("candidate.manifold"), "utf8");
  assert.equal((await verifyAgentSpring(candidateBytes, report)).passed, true);
  await assert.rejects(verifyAgentSpring(bytes, report));
  await assert.rejects(
    verifyAgentSpring(await readFile(file("edited.manifold"), "utf8"), report),
    /current checked computation/,
  );
  for (const badReport of [
    { ...report, constraintPass: true },
    { ...report, worksheetForceN: 0 },
    { ...report, receiptId: spring.requests[0].result.receipt.id },
    { ...report, physicalValidity: "safe" },
    { ...report, summary: "" },
  ])
    await assert.rejects(
      verifyAgentSpring(candidateBytes, badReport),
      /Report|summary/,
    );
  for (const mutate of [
    (workspace) =>
      workspace.updateEquation(x.id, "x := 4 m", workspace.read().id),
    (workspace) =>
      workspace.updateEquation(x.id, "x := 4 s", workspace.read().id),
    (workspace) =>
      workspace.updateEquation(x.id, "x := absent*2", workspace.read().id),
    (workspace) => workspace.updateEquation(x.id, "x :=", workspace.read().id),
    (workspace) =>
      workspace.updateEquation(limit.id, "F < 50 N", workspace.read().id),
    (workspace) =>
      workspace.updateNote(
        inspection.worksheet.regions.find((region) => region.kind === "note")
          .id,
        "Concealed source note",
        workspace.read().id,
      ),
    (workspace) =>
      workspace.setModelInput(
        spring.id,
        "displacement",
        2,
        workspace.read().id,
      ),
    (workspace) =>
      workspace.setModelInput(
        inspection.models.find((model) => model.id !== spring.id).id,
        "factor",
        4,
        workspace.read().id,
      ),
    (workspace) =>
      workspace.createNote("Unrequested new content", workspace.read().id),
  ]) {
    const workspace = await openHeadlessWorkspace(candidateBytes);
    try {
      mutate(workspace);
      await assert.rejects(verifyAgentSpring(workspace.export(), report));
    } finally {
      workspace.dispose();
    }
  }
  assert.equal(
    await readFile(baseline, "utf8"),
    bytes,
    "Acceptance workflow preserves the baseline bytes",
  );
  assert.equal(
    await readFile(file("candidate.manifold"), "utf8"),
    candidateBytes,
    "Verifier never writes the candidate",
  );
  console.log(
    "Manifold skill: portable metadata, real CLI spring workflow, canvas reopen, independent report verification, draft/unit/constraint/evidence and unrelated-change rejection passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
