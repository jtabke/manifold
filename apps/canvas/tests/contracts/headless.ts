import {
  createHeadlessWorkspace,
  HeadlessError,
  type HeadlessErrorCode,
  type ModelDescription,
  type HeadlessEdits,
  type WorksheetSnapshot,
} from "manifold-canvas/headless";

// Compile-only public consumer: discover/edit/compute needs no internal application imports.
export async function modelWorkflow() {
  const workspace = createHeadlessWorkspace();
  try {
    const ids = workspace.transaction(
      workspace.read().id,
      (edits: HeadlessEdits) => {
        const model = edits.createModel("spring");
        const equation = edits.createEquation("x := 2 mm");
        edits.createNote("Check the spring assumption");
        return { model, equation };
      },
    );
    workspace.updateEquation(ids.equation, "x := 3 mm", workspace.read().id);
    const worksheet: WorksheetSnapshot = workspace.worksheet();
    if (!worksheet.regions.length) throw Error("Expected a worksheet region");
    const model: ModelDescription = workspace.models()[0];
    const input = model.inputs[0];
    workspace.setModelInput(model.id, input.id, 3, model.documentId);
    const request = model.requests[0];
    const completion = await workspace.compute(request.reference).completion;
    if (completion.status === "retained") {
      return { outcome: completion.receipt.outcome, file: workspace.export() };
    }
    return { status: completion.status };
  } catch (error) {
    if (error instanceof HeadlessError) {
      const code: HeadlessErrorCode = error.code;
      return { code, details: error.details };
    }
    throw error;
  } finally {
    workspace.dispose();
  }
}
