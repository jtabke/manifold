import assert from "node:assert/strict";
import { json } from "@manifold/foundation";
import {
  createHeadlessWorkspace,
  openHeadlessWorkspace,
  HeadlessError,
} from "manifold-canvas/headless";
import {
  agentCapabilities,
  inspectWorkspace,
  editWorkspace,
  validateWorkspace,
  compareWorkspaces,
} from "manifold-canvas/agent";

const workspace = createHeadlessWorkspace();
const owners = [workspace];
const roundtrip = (value) => {
  json(value);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
};
const code = (expected) => (error) =>
  error instanceof HeadlessError && error.code === expected;
try {
  const capabilities = agentCapabilities();
  roundtrip(capabilities);
  assert.equal(capabilities.execution.sampling, false);
  assert.equal(capabilities.editSchema.properties.edits.items.oneOf.length, 7);
  assert.ok(
    capabilities.editSchema.properties.edits.items.oneOf.some(
      (s) => s.properties.operation.const === "enableScientificMath",
    ),
  );
  assert.deepEqual(
    capabilities.modelFamilies.map((family) => family.id),
    ["spring", "scale"],
  );
  assert.equal(
    capabilities.modelFamilies[0].inputs.find(
      (input) => input.id === "displacement",
    ).unit,
    "mm",
  );
  const initial = workspace.read();
  const result = editWorkspace(workspace, {
    expectedDocumentId: initial.id,
    edits: [
      { operation: "createModel", family: "spring", as: "spring" },
      {
        operation: "setModelInput",
        model: "$spring",
        input: "displacement",
        value: 3,
      },
      { operation: "createEquation", text: "x := 2 mm", as: "x" },
      { operation: "createEquation", text: "k := 10 N/mm" },
      { operation: "createEquation", text: "F = k*x", as: "force" },
      { operation: "createEquation", text: "F < 30 N", as: "limit" },
      { operation: "createNote", text: "Assume a linear spring", as: "note" },
      {
        operation: "updateNote",
        region: "$note",
        text: "Check the spring assumption",
      },
    ],
  });
  roundtrip(result);
  assert.equal(workspace.read().sequence, initial.sequence + 1);
  workspace.undo(workspace.read().id);
  assert.equal(workspace.models().length, 0);
  workspace.redo(workspace.read().id);
  assert.equal(workspace.models().length, 1);
  assert.equal(
    inspectWorkspace(workspace).worksheet.regions.find(
      (region) => region.id === result.aliases.force,
    ).quantity.value,
    20,
  );
  roundtrip(inspectWorkspace(workspace));
  const before = await openHeadlessWorkspace(workspace.export());
  owners.push(before);
  // Uncomputed is not malformed, and validation never starts jobs.
  const validation = validateWorkspace(workspace);
  roundtrip(validation);
  assert.equal(validation.admitted, true);
  assert.equal(validation.physicalValidity, "not-assessed");
  assert.deepEqual(
    validation.issues.map((issue) => issue.kind),
    ["computation-not-current"],
  );
  assert.equal(workspace.models()[0].requests[0].result.status, "ready");
  const inputRevision = workspace.read().id;
  editWorkspace(workspace, {
    expectedDocumentId: inputRevision,
    edits: [
      {
        operation: "setModelInput",
        model: result.aliases.spring,
        input: "displacement",
        value: 3,
      },
    ],
  });
  assert.equal(
    compareWorkspaces(before, workspace).models.length,
    0,
    "identical explicit value changes no semantic output",
  );
  assert.throws(
    () =>
      editWorkspace(workspace, { expectedDocumentId: initial.id, edits: [] }),
    code("STALE_DOCUMENT"),
  );

  for (const edits of [
    [
      { operation: "createNote", text: "Valid first" },
      { operation: "updateEquation", region: "$absent", text: "z := 3" },
    ],
    [
      { operation: "createNote", text: "First", as: "same" },
      { operation: "createNote", text: "Second", as: "same" },
    ],
    [
      { operation: "updateNote", region: "$later", text: "Forward" },
      { operation: "createNote", text: "Later", as: "later" },
    ],
    [
      { operation: "createNote", text: "Wrong kind", as: "note" },
      { operation: "setModelInput", model: "$note", input: "x", value: 1 },
    ],
    [{ operation: "createModel", family: "unknown" }],
    [{ operation: "createNote", text: "Unknown field", typo: true }],
    [
      {
        operation: "createNote",
        text: "Unknown position field",
        at: { x: 1, y: 2, z: 3 },
      },
    ],
    [{ operation: "createNote", text: "Invalid alias", as: "$bad" }],
    [
      {
        operation: "updateNote",
        region: "$note",
        text: "No cross-batch aliases",
      },
    ],
    [
      {
        operation: "setModelInput",
        model: result.aliases.spring,
        input: "displacement",
        value: Infinity,
      },
    ],
    [{ operation: "createNote", text: "Bad position", at: { x: NaN, y: 1 } }],
    [{ operation: "constructor" }],
  ]) {
    const bytes = workspace.export(),
      root = workspace.read();
    assert.throws(
      () => editWorkspace(workspace, { expectedDocumentId: root.id, edits }),
      (error) => error instanceof HeadlessError,
    );
    assert.equal(workspace.read(), root);
    assert.equal(
      workspace.export(),
      bytes,
      "failed batch preserves exact native bytes",
    );
  }
  assert.throws(
    () =>
      editWorkspace(workspace, {
        expectedDocumentId: workspace.read().id,
        edits: [],
        typo: true,
      }),
    code("INVALID_INPUT"),
  );
  // Prototype-like names are plain own properties, not prototype access.
  const prototype = editWorkspace(workspace, {
    expectedDocumentId: workspace.read().id,
    edits: [
      { operation: "createNote", text: "Safe alias", as: "constructor" },
      { operation: "updateNote", region: "$constructor", text: "Still safe" },
    ],
  });
  assert.equal(typeof prototype.aliases.constructor, "string");

  editWorkspace(workspace, {
    expectedDocumentId: workspace.read().id,
    edits: [
      {
        operation: "updateEquation",
        region: result.aliases.x,
        text: "x := 4 mm",
      },
      { operation: "createEquation", text: "unfinished =" },
      { operation: "createEquation", text: "unknown = absent*2" },
    ],
  });
  const changed = compareWorkspaces(before, workspace);
  roundtrip(changed);
  assert(
    changed.regions.some(
      (change) =>
        change.id === result.aliases.force &&
        change.before.quantity.value === 20 &&
        change.after.quantity.value === 40,
    ),
  );
  assert(
    changed.regions.some(
      (change) =>
        change.id === result.aliases.limit &&
        change.before.constraint.pass &&
        !change.after.constraint.pass,
    ),
  );
  assert(
    validateWorkspace(workspace).issues.some(
      (issue) => issue.kind === "constraint-failed",
    ),
  );
  assert(
    validateWorkspace(workspace).issues.filter(
      (issue) => issue.kind === "worksheet-diagnostic",
    ).length >= 2,
  );
  const admittedDraft = await openHeadlessWorkspace(workspace.export());
  owners.push(admittedDraft);
  assert.equal(validateWorkspace(admittedDraft).admitted, true);
  await assert.rejects(openHeadlessWorkspace("{}"), code("INVALID_WORKSPACE"));

  const request = workspace.models()[0].requests[0];
  const completion = await workspace.compute(request.reference).completion;
  assert.equal(completion.status, "retained");
  assert.equal(completion.receipt.outcome.status, "success");
  roundtrip(inspectWorkspace(workspace));
  const retained = inspectWorkspace(workspace).models[0].requests[0].result;
  assert.equal(retained.status, "current");
  assert.equal(retained.receipt.id, completion.receipt.id);
  assert.equal(retained.receipt.physicalValidity, "not-assessed");
  workspace.setModelInput(
    result.aliases.spring,
    "displacement",
    5,
    workspace.read().id,
  );
  assert.equal(
    inspectWorkspace(workspace).models[0].requests[0].result.status,
    "ready",
  );
  const canceled = workspace.compute(request.reference);
  canceled.cancel();
  const canceledCompletion = await canceled.completion;
  assert(
    canceledCompletion.status !== "retained" ||
      canceledCompletion.receipt.outcome.status !== "success",
  );
  roundtrip(inspectWorkspace(workspace));
  workspace.dispose();
  assert.throws(() => inspectWorkspace(workspace), code("WORKSPACE_CLOSED"));
  console.log(
    "Agent contracts: capabilities, atomic JSON edits, aliases, diagnostics, semantic differences, evidence and cancellation passed.",
  );
} finally {
  for (const owner of owners) owner.dispose();
}
