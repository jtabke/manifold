/** Read-only two-stage authoring oracle; counterfactuals mutate only an isolated in-memory owner. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import { validateWorkspace } from "manifold-canvas/agent";
import { parse, references } from "../src/notebook/math.ts";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { RegionSession } from "../src/regions/document.ts";

export const conductionBaseline = new URL(
  "../tests/fixtures/agent-conduction/baseline.manifold",
  import.meta.url,
);
function only(rows, predicate, description) {
  const matches = rows.filter(predicate);
  assert.equal(matches.length, 1, `Expected one ${description}`);
  return matches[0];
}
function quantity(region, value, dimension) {
  assert(region.quantity, `Missing quantity: ${region.text}`);
  assert(
    Number.isFinite(region.quantity.value) &&
      Math.abs(region.quantity.value - value) <=
        1e-12 * Math.max(1, Math.abs(value)),
    `Incorrect value: ${region.text}`,
  );
  assert.deepEqual(
    region.quantity.dimension,
    dimension,
    `Incorrect dimension: ${region.text}`,
  );
  assert.notEqual(
    region.quantity.absolute,
    true,
    "Use temperature differences, not absolute temperatures",
  );
}
function authoredRows(workspace) {
  const rows = workspace.worksheet().regions;
  const named = (name) =>
    only(rows, (row) => row.name === name && !row.constraint, name);
  const limit = only(
    rows,
    (row) => row.constraint !== null,
    "heat-loss requirement",
  );
  assert.equal(limit.text, "Q < 50 W", "Do not change the requirement");
  for (const row of rows)
    assert.equal(
      row.diagnostic,
      null,
      "No unresolved source or drafts in a finished worksheet",
    );
  quantity(named("k"), 0.04, [1, 1, -3, -1]);
  quantity(named("A"), 2, [0, 2, 0, 0]);
  quantity(named("deltaT"), 20, [0, 0, 0, 1]);
  assert.deepEqual(
    references(parse(named("Q").text).expression).sort(),
    ["A", "L", "deltaT", "k"],
    "Derive Q from all four inputs, not a hard-coded answer",
  );
  return { rows, thickness: named("L"), heat: named("Q"), limit };
}

export async function verifyAgentConduction(initialText, finalText, report) {
  const owners = [];
  let canvas;
  async function open(text) {
    const owner = await openHeadlessWorkspace(text);
    owners.push(owner);
    return owner;
  }
  try {
    const baseline = await open(await readFile(conductionBaseline, "utf8"));
    const initial = await open(initialText),
      final = await open(finalText);
    for (const owner of [initial, final]) {
      assert.equal(
        owner.read().document,
        baseline.read().document,
        "Preserve baseline document identity",
      );
      assert.equal(owner.worksheet().context, baseline.worksheet().context);
      assert.equal(
        owner.models().length,
        0,
        "Do not invent models or jobs for worksheet derivation",
      );
      assert.equal(
        owner.read().evidenceSequence,
        baseline.read().evidenceSequence,
        "No fabricated execution evidence",
      );
    }
    assert.notEqual(initial.read().id, baseline.read().id);
    assert.notEqual(final.read().id, initial.read().id);
    const a = authoredRows(initial),
      b = authoredRows(final);
    quantity(a.thickness, 50 / 1000, [0, 1, 0, 0]);
    quantity(b.thickness, 25 / 1000, [0, 1, 0, 0]);
    quantity(a.heat, (0.04 * 2 * 20) / 0.05, [1, 2, -3, 0]);
    quantity(b.heat, (0.04 * 2 * 20) / 0.025, [1, 2, -3, 0]);
    assert.equal(a.limit.constraint.pass, true);
    assert.equal(b.limit.constraint.pass, false);
    assert.equal(
      a.thickness.id,
      b.thickness.id,
      "Revise the accepted region; do not recreate it",
    );
    assert.deepEqual(
      b.rows.map((row) => row.id),
      a.rows.map((row) => row.id),
    );
    assert.equal(
      a.rows.length,
      baseline.worksheet().regions.length + 7,
      "Six equations and one assumption note",
    );
    const oldIds = new Set(baseline.worksheet().regions.map((row) => row.id));
    const note = only(
      a.rows,
      (row) => !oldIds.has(row.id) && row.kind === "note",
      "new assumption note",
    );
    assert(note.text.trim());
    for (const row of b.rows) {
      const old = a.rows.find((before) => before.id === row.id);
      assert.deepEqual(
        row.position,
        old.position,
        "Revision must preserve positions",
      );
      if (row.id !== a.thickness.id)
        assert.equal(
          row.text,
          old.text,
          "Only thickness source may change in revision",
        );
    }
    for (const old of baseline.worksheet().regions) {
      assert.deepEqual(
        a.rows.find((row) => row.id === old.id),
        old,
        "Preserve baseline worksheet content and layout",
      );
    }
    const initialItems = initial.items(),
      finalItems = final.items();
    for (const old of baseline.items()) {
      const item = only(
        initialItems,
        (item) => item.id === old.id,
        "protected baseline item",
      );
      let expected = old.revision.body;
      if (old.revision.schema === "canvas-workspace@1")
        expected = { ...expected, regions: a.rows.map((row) => row.id) };
      const changed = old.revision.schema === "canvas-workspace@1";
      if (changed) assert.notEqual(item.revision.id, old.revision.id);
      assert.deepEqual(
        item,
        changed
          ? {
              ...old,
              revision: {
                ...old.revision,
                id: item.revision.id,
                body: expected,
              },
            }
          : old,
        "Preserve protected records, including revision identity and required flags",
      );
    }
    assert.equal(
      initialItems.length,
      baseline.items().length + 7,
      "Only add the requested region records",
    );
    assert.deepEqual(
      finalItems.map((item) => item.id),
      initialItems.map((item) => item.id),
    );
    for (const old of initialItems) {
      const item = finalItems.find((item) => item.id === old.id);
      let expected = old.revision.body;
      if (expected.kind === "region" && expected.value.id === a.thickness.id)
        expected = {
          ...expected,
          value: { ...expected.value, text: b.thickness.text },
        };
      const changed = expected !== old.revision.body;
      if (changed) assert.notEqual(item.revision.id, old.revision.id);
      assert.deepEqual(
        item,
        changed
          ? {
              ...old,
              revision: {
                ...old.revision,
                id: item.revision.id,
                body: expected,
              },
            }
          : old,
        "Only the existing thickness revision identity and source may change",
      );
    }
    for (const [id, view] of baseline.read().views.entries())
      assert.deepEqual(
        initial.read().views.get(id),
        view,
        "Preserve baseline views",
      );
    assert.deepEqual(
      [...final.read().views.entries()],
      [...initial.read().views.entries()],
      "Revision must preserve every view",
    );
    assert.equal(validateWorkspace(initial).clean, true);
    assert.deepEqual(
      validateWorkspace(final).issues.map((issue) => ({
        kind: issue.kind,
        target: issue.target,
      })),
      [{ kind: "constraint-failed", target: b.limit.id }],
    );

    // Vary every input independently so nominal references multiplied by zero cannot pass.
    for (const [name, text, expected] of [
      ["L", "L := 100 mm", 16],
      ["A", "A := 3 m^2", 48],
      ["k", "k := 0.08 W/(m*K)", 64],
      ["deltaT", "deltaT := 30 K", 48],
    ]) {
      const probe = await open(initialText);
      const input = only(
        probe.worksheet().regions,
        (row) => row.name === name,
        `probe ${name}`,
      );
      probe.updateEquation(input.id, text, probe.read().id);
      quantity(
        probe.worksheet().regions.find((row) => row.id === a.heat.id),
        expected,
        [1, 2, -3, 0],
      );
    }

    const decoded = await decodeWorkspace(finalText);
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
      canvas.state.regions.find((row) => row.id === b.thickness.id).text,
      b.thickness.text,
    );
    assert(
      report && typeof report === "object" && !Array.isArray(report),
      "Provide the structured report",
    );
    for (const [key, expected] of Object.entries({
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
    }))
      assert.equal(
        report[key],
        expected,
        `Report must match independently checked ${key}`,
      );
    assert.equal(typeof report.summary, "string");
    assert(
      report.summary.trim(),
      "Provide an explanation of assumptions and limitations",
    );
    return {
      passed: true,
      initialHeatLossW: 32,
      finalHeatLossW: 64,
      initialConstraintPass: true,
      finalConstraintPass: false,
      execution: "worksheet-derived-no-job",
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
      "Usage: node apps/canvas/tools/verify-agent-conduction.mjs INITIAL FINAL REPORT_JSON",
    );
    const initial = resolve(process.argv[2]),
      candidate = resolve(process.argv[3]);
    assert.notEqual(
      initial,
      candidate,
      "Initial and final must be separate files",
    );
    for (const path of [initial, candidate])
      assert.notEqual(
        path,
        fileURLToPath(conductionBaseline),
        "Preserve the baseline",
      );
    const report = JSON.parse(await readFile(process.argv[4], "utf8"));
    assert.equal(report.initial, initial);
    assert.equal(report.candidate, candidate);
    console.log(
      JSON.stringify(
        await verifyAgentConduction(
          await readFile(initial, "utf8"),
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
