import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import {
  conductionBaseline,
  verifyAgentConduction,
} from "../tools/verify-agent-conduction.mjs";

const cli = fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url));
const verifier = fileURLToPath(
  new URL("../tools/verify-agent-conduction.mjs", import.meta.url),
);
const baseline = fileURLToPath(conductionBaseline),
  baselineBytes = await readFile(baseline, "utf8");
const directory = await mkdtemp(join(tmpdir(), "manifold-conduction-"));
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
  const source = run(cli, ["inspect", baseline, "--compact"]);
  await writeFile(
    file("author.json"),
    JSON.stringify({
      expectedDocumentId: source.documentId,
      edits: [
        ...[
          "k := 0.04 W/(m*K)",
          "A := 2 m^2",
          "deltaT := 20 K",
          "L := 50 mm",
          "Q = k*A*deltaT/L",
          "Q < 50 W",
        ].map((text, i) => ({
          operation: "createEquation",
          text,
          as: `row${i}`,
        })),
        {
          operation: "createNote",
          text: "Assume steady one-dimensional conduction; ignore radiation, convection and contact resistance.",
        },
      ],
    }),
  );
  run(cli, [
    "edit",
    baseline,
    "--changes",
    file("author.json"),
    "--output",
    file("initial.manifold"),
  ]);
  const initial = run(cli, ["inspect", file("initial.manifold"), "--compact"]);
  const thickness = initial.worksheet.regions.find((row) => row.name === "L");
  assert.equal(initial.models.length, 0);
  assert.equal(
    initial.worksheet.regions.find(
      (row) => row.name === "Q" && row.kind === "equation",
    ).quantity.value,
    32,
  );
  assert.equal(
    run(cli, ["validate", file("initial.manifold"), "--strict"]).clean,
    true,
  );
  await writeFile(
    file("revision.json"),
    JSON.stringify({
      expectedDocumentId: initial.documentId,
      edits: [
        {
          operation: "updateEquation",
          region: thickness.id,
          text: "L := 25 mm",
        },
      ],
    }),
  );
  run(cli, [
    "edit",
    file("initial.manifold"),
    "--changes",
    file("revision.json"),
    "--output",
    file("final.manifold"),
  ]);
  run(
    cli,
    [
      "edit",
      file("final.manifold"),
      "--changes",
      file("revision.json"),
      "--output",
      file("stale.manifold"),
    ],
    6,
  );
  const final = run(cli, ["inspect", file("final.manifold"), "--compact"]);
  assert.equal(
    final.worksheet.regions.find(
      (row) => row.name === "Q" && row.kind === "equation",
    ).quantity.value,
    64,
  );
  assert.equal(
    run(cli, ["validate", file("final.manifold"), "--strict"], 3).issues.length,
    1,
  );
  assert.equal(
    run(cli, ["worksheet", file("final.manifold"), "--region", thickness.id])
      .regions[0].quantity.unit,
    "m",
  );
  const diff = run(cli, [
    "diff",
    file("initial.manifold"),
    file("final.manifold"),
  ]);
  assert.deepEqual(
    diff.regions
      .filter((row) => row.before.text !== row.after.text)
      .map((row) => row.id),
    [thickness.id],
  );
  const report = {
    initial: file("initial.manifold"),
    candidate: file("final.manifold"),
    initialThicknessMm: 50,
    finalThicknessMm: 25,
    initialHeatLossW: 32,
    finalHeatLossW: 64,
    initialConstraintPass: true,
    finalConstraintPass: false,
    initialValidationExitCode: 0,
    finalValidationExitCode: 3,
    execution: "worksheet-derived-no-job",
    physicalValidity: "not-assessed",
    summary:
      "Steady one-dimensional conduction ignores radiation, convection and contact resistance. Reducing thickness from 50 to 25 mm doubles heat loss from 32 to 64 W, so the unchanged Q < 50 W requirement fails. These worksheet values are derived, not checked job receipts; physical validity is unassessed.",
  };
  await writeFile(file("report.json"), JSON.stringify(report));
  assert.equal(
    run(verifier, [
      file("initial.manifold"),
      file("final.manifold"),
      file("report.json"),
    ]).passed,
    true,
  );
  const a = await readFile(file("initial.manifold"), "utf8"),
    b = await readFile(file("final.manifold"), "utf8");
  for (const bad of [
    { ...report, finalHeatLossW: 32 },
    { ...report, finalConstraintPass: true },
    { ...report, execution: "checked-receipt" },
    { ...report, summary: "" },
  ])
    await assert.rejects(verifyAgentConduction(a, b, bad));
  await assert.rejects(verifyAgentConduction(baselineBytes, b, report));
  await assert.rejects(verifyAgentConduction(a, a, report));
  for (const mutate of [
    (owner) => owner.updateEquation(thickness.id, "L := 25 m", owner.read().id),
    (owner) => owner.updateEquation(thickness.id, "L := 25 s", owner.read().id),
    (owner) =>
      owner.updateEquation(thickness.id, "L := missing", owner.read().id),
    (owner) =>
      owner.updateEquation(
        final.worksheet.regions.find((row) => row.kind === "constraint").id,
        "Q < 100 W",
        owner.read().id,
      ),
    (owner) =>
      owner.updateEquation(
        final.worksheet.regions.find(
          (row) => row.kind === "equation" && row.name === "Q",
        ).id,
        "Q = 64 W",
        owner.read().id,
      ),
    (owner) =>
      owner.updateEquation(
        final.worksheet.regions.find((row) => row.name === "k").id,
        "k := 0.08 W/(m*K)",
        owner.read().id,
      ),
    (owner) =>
      owner.updateNote(
        source.worksheet.regions.find((row) => row.kind === "note").id,
        "Modified protected note",
        owner.read().id,
      ),
    (owner) => owner.createModel("spring", owner.read().id),
  ]) {
    const owner = await openHeadlessWorkspace(b);
    try {
      mutate(owner);
      await assert.rejects(verifyAgentConduction(a, owner.export(), report));
    } finally {
      owner.dispose();
    }
  }
  // Mentioning an input is not evidence that the relation actually depends on it.
  for (const text of [
    "Q = 0.04 W/(m*K)*A*deltaT/L + 0*k*A*deltaT/L",
    "Q = k*A*20 K/L + 0*k*A*deltaT/L",
    "Q = 0.04 W/(m*K)*A*20 K/L + 0*k*A*deltaT/L",
  ]) {
    const owner = await openHeadlessWorkspace(a);
    try {
      const heat = initial.worksheet.regions.find(
        (row) => row.name === "Q" && row.kind === "equation",
      );
      owner.updateEquation(heat.id, text, owner.read().id);
      const badInitial = owner.export();
      owner.updateEquation(thickness.id, "L := 25 mm", owner.read().id);
      await assert.rejects(
        verifyAgentConduction(badInitial, owner.export(), report),
        /Incorrect value: Q/,
      );
    } finally {
      owner.dispose();
    }
  }
  // Exercise valid native archives whose visible worksheet values are unchanged.
  for (const stage of ["initial", "final"]) {
    for (const field of ["required", "revision", "view"]) {
      const archive = JSON.parse(stage === "initial" ? a : b);
      const document = archive.foundation.document;
      const protectedItem = Object.values(document.items).find(
        (item) =>
          document.revisions[item.revision].body?.value?.text ===
          "referenceMass := 2 kg",
      );
      if (field === "required")
        document.revisions[protectedItem.revision].required = false;
      if (field === "revision") {
        const revision = {
          ...document.revisions[protectedItem.revision],
          id: "revision:tampered-protected",
        };
        document.revisions[revision.id] = revision;
        document.identities.revisions.push(revision.id);
        protectedItem.revision = revision.id;
      }
      if (field === "view") {
        const view = Object.values(document.views).find(
          (view) =>
            view.reference.item ===
            `region:${source.worksheet.regions.find((row) => row.kind === "note").id}`,
        );
        view.reference.selector.explicit = !view.reference.selector.explicit;
      }
      const text = JSON.stringify(archive);
      const admitted = await openHeadlessWorkspace(text);
      admitted.dispose();
      await assert.rejects(
        verifyAgentConduction(
          stage === "initial" ? text : a,
          stage === "final" ? text : b,
          report,
        ),
        field === "view"
          ? /[Pp]reserve.*view/
          : /Preserve protected records|Only the existing thickness/,
      );
    }
  }
  assert.equal(await readFile(baseline, "utf8"), baselineBytes);
  assert.equal(await readFile(file("initial.manifold"), "utf8"), a);
  assert.equal(await readFile(file("final.manifold"), "utf8"), b);
  console.log(
    "Conduction authoring: compact CLI discovery, atomic creation/revision, native reopen, derived units, independent arithmetic/counterfactuals, protected content and negative handoffs passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
