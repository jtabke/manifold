import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import { bindLiveWorkspace } from "../src/headless.ts";
import { createCanvasAssistant } from "../src/regions/assistant.ts";

const session = new RegionSession(
  undefined,
  () => [],
  undefined,
  [],
  false,
  undefined,
  { artifactExecutor: null },
);
const workspace = bindLiveWorkspace(session);
const assistant = createCanvasAssistant(session);
try {
  const model = workspace.createModel("spring", workspace.read().id);
  const x = workspace.createEquation("x := 2 mm", workspace.read().id);
  workspace.createEquation("F = (10 N/mm)*x", workspace.read().id);
  const initial = workspace.read();
  const original = workspace.export();
  assistant.begin("one");
  assert.throws(() => assistant.begin("two"), /already running/);
  const inspected = assistant.tool("one", "inspect_workspace", {});
  assert.equal(inspected.documentId, initial.id);
  assert.equal(
    inspected.models[0].inputs.find((i) => i.id === "displacement").unit,
    "mm",
  );
  assert.throws(
    () => assistant.tool("other", "inspect_workspace", {}),
    /no longer active/,
  );
  for (const tool of ["apply", "compute", "bash", "export"])
    assert.throws(() => assistant.tool("one", tool, {}), /Unsupported/);
  const proposal = assistant.tool("one", "prepare_edit", {
    explanation: "Use 3 mm and revise the independent worksheet input.",
    batch: {
      expectedDocumentId: initial.id,
      edits: [
        { operation: "setModelInput", model, input: "displacement", value: 3 },
        { operation: "updateEquation", region: x, text: "x := 4 mm" },
        { operation: "createNote", text: "Assume a linear spring" },
      ],
    },
  });
  assert.equal(workspace.read(), initial);
  assert.equal(
    workspace.export(),
    original,
    "preparing neither accepts nor saves changes",
  );
  assert.equal(proposal.status, "pending");
  assert.equal(
    proposal.diff.models[0].after.inputs.find((i) => i.id === "displacement")
      .binding.value,
    3,
  );
  const created = proposal.diff.regions.find((r) => !r.before).id;
  assert(proposal.validation.admitted);
  assistant.end("one");
  assert.throws(
    () => assistant.tool("one", "prepare_edit", {}),
    /no longer active/,
  );
  assistant.apply(proposal.id);
  assert.equal(workspace.read().sequence, initial.sequence + 1);
  assert.equal(
    workspace.describeModel(model).inputs.find((i) => i.id === "displacement")
      .binding.value,
    3,
  );
  assert(
    workspace.worksheet().regions.some((r) => r.id === created),
    "apply retains the reviewed creation identity",
  );
  assert.equal(
    workspace.worksheet().regions.find((r) => r.kind === "equation").quantity
      .value,
    40,
  );
  assert.equal(assistant.proposals()[0].status, "applied");
  assert.throws(() => assistant.apply(proposal.id), /already resolved/);
  workspace.undo(workspace.read().id);
  assert.equal(
    workspace.worksheet().regions.length,
    2,
    "one Undo removes the entire accepted proposal",
  );
  assert.equal(
    workspace.describeModel(model).inputs.find((i) => i.id === "displacement")
      .binding,
    null,
  );
  workspace.redo(workspace.read().id);
  assert(workspace.worksheet().regions.some((r) => r.id === created));

  assistant.begin("two");
  const payload = {
    explanation: "Update x",
    batch: {
      expectedDocumentId: workspace.read().id,
      edits: [{ operation: "updateEquation", region: x, text: "x := 9 mm" }],
    },
  };
  const stale = assistant.tool("two", "prepare_edit", payload);
  // Changing caller-owned arguments after review cannot change accepted commands.
  payload.batch.edits[0].text = "x := 100 mm";
  workspace.updateEquation(x, "x := 5 mm", workspace.read().id);
  const newer = workspace.read();
  assert.equal(
    assistant.proposals().find((p) => p.id === stale.id).status,
    "stale",
  );
  assert.throws(() => assistant.apply(stale.id), /stale/);
  assert.equal(workspace.read(), newer);
  assistant.dismiss(stale.id);
  assert.throws(() => assistant.apply(stale.id), /resolved/);

  const invalid = {
    explanation: "Invalid atomic batch",
    batch: {
      expectedDocumentId: workspace.read().id,
      edits: [
        { operation: "createNote", text: "Must not leak" },
        { operation: "setModelInput", model, input: "missing", value: 3 },
      ],
    },
  };
  assert.throws(() => assistant.tool("two", "prepare_edit", invalid));
  assert.equal(workspace.read(), newer, "invalid staging publishes nothing");
  assert.throws(() =>
    assistant.tool("two", "prepare_edit", {
      explanation: "stale",
      batch: {
        expectedDocumentId: initial.id,
        edits: [{ operation: "createNote", text: "no" }],
      },
    }),
  );
  const immutable = assistant.tool("two", "prepare_edit", {
    explanation: "New note",
    batch: {
      expectedDocumentId: workspace.read().id,
      edits: [{ operation: "createNote", text: "Exact reviewed note" }],
    },
  });
  assert(Object.isFrozen(immutable.diff));
  assistant.close();
  assert.throws(() => assistant.apply(immutable.id), /closed/);
  assert.throws(() => assistant.tool("two", "inspect_workspace", {}), /closed/);
  assert.equal(
    workspace.read(),
    newer,
    "closing the assistant preserves the live owner",
  );
  workspace.createNote("Human continues", workspace.read().id);
  const beforePrepare = workspace.read();
  assert.throws(() => session.prepare(async () => {}), /synchronous/);
  assert.equal(workspace.read(), beforePrepare);
  console.log(
    "Canvas assistant: live inspection, no execution, exact reviewed commands, atomic Apply/Undo/Redo, stale/dismissed/duplicate rejection, cancellation authority and owner isolation pass.",
  );
} finally {
  assistant.close();
  workspace.dispose();
  session.dispose();
}
