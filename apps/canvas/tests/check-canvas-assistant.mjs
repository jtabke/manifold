import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import { bindLiveWorkspace } from "../src/headless.ts";
import { createCanvasAssistant } from "../src/regions/assistant.ts";
import { drawings } from "../src/regions/drawing.ts";

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
  const canvasAssistant = createCanvasAssistant(session);
  try {
    canvasAssistant.begin("canvas");
    const page = canvasAssistant.tool("canvas", "inspect_canvas", { limit: 1 });
    assert.equal(page.objects.length, 1);
    assert.equal(page.pagination.hasMore, true);
    assert.throws(() =>
      canvasAssistant.tool("canvas", "inspect_canvas", { limit: 101 }),
    );
    assert.throws(() =>
      canvasAssistant.tool("canvas", "inspect_canvas", {
        script: "not permitted",
      }),
    );
    const baseline = session.document;
    const output = workspace
      .worksheet()
      .regions.find((region) => region.text.startsWith("F =")).id;
    const mark = {
      kind: "rectangle",
      color: "#8b5cf6",
      width: 2,
      points: [
        { x: 0, y: 0, pressure: 1 },
        { x: 100, y: 60, pressure: 1 },
      ],
      text: "",
      start: null,
      end: null,
    };
    const proposal = canvasAssistant.tool("canvas", "prepare_edit", {
      explanation:
        "Draw a diagram, organize its members and add a response plot.",
      batch: {
        expectedDocumentId: baseline.id,
        edits: [
          {
            operation: "createDrawing",
            mark,
            at: { x: 600, y: 200 },
            as: "box",
          },
          {
            operation: "createDrawing",
            mark: { ...mark, kind: "text", text: "Spring diagram" },
            at: { x: 600, y: 300 },
            as: "label",
          },
          {
            operation: "createDrawing",
            mark: {
              ...mark,
              kind: "connector",
              start: { drawing: "$box", u: 0, v: 0.5 },
              end: { drawing: "$box", u: 1, v: 0.5 },
            },
            at: { x: 600, y: 200 },
            as: "wire",
          },
          {
            operation: "placeObjects",
            placements: [{ id: "$box", at: { x: 650, y: 200 } }],
          },
          {
            operation: "groupObjects",
            name: "Diagram",
            layout: "stack",
            members: ["$box", "$label", "$wire"],
          },
          {
            operation: "createAnalysis",
            model,
            input: "displacement",
            output: "force",
            low: 0,
            high: 5,
            points: 9,
            at: { x: 1100, y: 200 },
          },
          {
            operation: "createPlot",
            input: x,
            output,
            at: { x: 800, y: 200 },
            as: "response",
          },
        ],
      },
    });
    assert.equal(session.document, baseline);
    assert.equal(drawings(session.document).length, 0);
    assert.equal(proposal.diff.canvas.drawings.length, 3);
    assert.equal(proposal.diff.canvas.plots.length, 1);
    assert.equal(proposal.diff.canvas.analyses.length, 1);
    assert(proposal.diff.canvas.scene);
    const drawingId = proposal.diff.canvas.drawings.find(
      (change) => change.after.mark.kind === "rectangle",
    ).id;
    const plotId = proposal.diff.canvas.plots[0].id;
    mark.points[1].x = 999;
    canvasAssistant.apply(proposal.id);
    assert.equal(
      drawings(session.document).find((entry) => entry.id === drawingId).mark
        .points[1].x,
      100,
    );
    assert.equal(
      drawings(session.document).find((entry) => entry.id === drawingId).view.x,
      650,
    );
    const analysisId = canvasAssistant.tool("canvas", "inspect_canvas", {})
      .analyses[0].id;
    assert.equal(
      canvasAssistant.tool("canvas", "inspect_plot", { id: analysisId }).status,
      "ready",
    );
    assert.equal(session.scene.groups[0].members.length, 3);
    const connector = drawings(session.document).find(
      (entry) => entry.mark.kind === "connector",
    );
    assert.equal(connector.mark.start.target.item, drawingId);
    const plot = canvasAssistant.tool("canvas", "inspect_plot", { id: plotId });
    assert.equal(plot.status, "derived-not-checked");
    assert.equal(plot.points.length, 81);
    assert(Math.abs(plot.points[40].y - 50) < 1e-8);
    session.undo();
    assert.equal(drawings(session.document).length, 0);
    assert.equal(session.scene.groups.length, 0);
    assert.equal(session.state.plots.length, 0);
    session.redo();
    assert.equal(drawings(session.document).length, 3);
    const unchanged = session.document;
    for (const edits of [
      [
        {
          operation: "placeObjects",
          placements: [{ id: "unknown", at: { x: 0, y: 0 } }],
        },
      ],
      [
        {
          operation: "createDrawing",
          mark: { ...mark, color: "url(http://bad)" },
          at: { x: 0, y: 0 },
        },
      ],
      [
        { operation: "createNote", text: "Must not leak" },
        { operation: "ungroupObjects", group: "missing" },
      ],
    ])
      assert.throws(() =>
        canvasAssistant.tool("canvas", "prepare_edit", {
          explanation: "Reject invalid canvas edits",
          batch: { expectedDocumentId: unchanged.id, edits },
        }),
      );
    assert.equal(session.document, unchanged);
    const edit = canvasAssistant.tool("canvas", "prepare_edit", {
      explanation: "Revise and remove a drawing",
      batch: {
        expectedDocumentId: unchanged.id,
        edits: [
          { operation: "ungroupObjects", group: session.scene.groups[0].id },
          { operation: "updateDrawing", drawing: drawingId, mark },
          { operation: "deleteDrawing", drawing: drawingId },
        ],
      },
    });
    canvasAssistant.apply(edit.id);
    assert.equal(drawings(session.document).length, 2);
    assert.equal(
      drawings(session.document).find(
        (entry) => entry.mark.kind === "connector",
      ).mark.start,
      null,
    );
    // Explicit fixture computation is separate from assistant tools; reads must preserve its currency.
    await session.compute(session.document.views.get(analysisId).reference)
      .completion;
    const analysis = canvasAssistant.tool("canvas", "inspect_plot", {
      id: analysisId,
    });
    assert.equal(analysis.status, "current");
    assert.equal(analysis.receipt.outcome.output.body.points.length, 9);
    canvasAssistant.end("canvas");
    assert.equal(canvasAssistant.active("canvas"), false);
    assert.throws(
      () => canvasAssistant.tool("canvas", "inspect_canvas", {}),
      /no longer active/,
    );
  } finally {
    canvasAssistant.close();
  }
  console.log(
    "Canvas assistant: live inspection, staged drawing/connector/group/layout/plot/analysis edits, derived and checked plot reads, no implicit execution, exact commands, atomic Apply/Undo/Redo, stale/dismissed/duplicate rejection and cancellation authority pass.",
  );
} finally {
  assistant.close();
  workspace.dispose();
  session.dispose();
}
