import assert from "node:assert/strict";
import {
  createHeadlessWorkspace,
  openHeadlessWorkspace,
  HeadlessError,
} from "manifold-canvas/headless";

const errorCode =
  (code, details = {}) =>
  (error) => {
    assert(error instanceof HeadlessError);
    assert.equal(error.name, "HeadlessError");
    assert.equal(error.code, code);
    for (const [key, value] of Object.entries(details))
      assert.equal(error.details[key], value);
    assert(Object.isFrozen(error.details));
    assert.deepEqual(JSON.parse(JSON.stringify(error)), {
      name: "HeadlessError",
      code,
      message: error.message,
      details: error.details,
    });
    return true;
  };

const workspace = createHeadlessWorkspace();
let reopened;
try {
  assert.deepEqual(workspace.models(), []);
  workspace.createModel("spring", workspace.read().id);
  workspace.createModel("scale", workspace.read().id);
  const baseline = workspace.read();
  const descriptions = workspace.models();
  assert.equal(workspace.read(), baseline, "discovery publishes nothing");
  assert.equal(descriptions.length, 2);
  const model = descriptions.find((model) =>
    model.inputs.some((input) => input.unit === "mm"),
  );
  assert(model);
  const input = model.inputs.find((input) => input.unit === "mm");
  const output = model.outputs.find((output) => output.unit === "N");
  const request = model.requests.find((request) =>
    request.outputs.includes(output.id),
  );
  assert(
    request,
    "computation reference is discovered, not constructed from an ID convention",
  );
  assert.equal(input.binding, null);
  assert.equal(input.defaultValue, 2);
  assert.equal(input.projection.projection.value.value, 2);
  assert.deepEqual(input.numericEdit, {
    minimum: -1e12,
    maximum: 1e12,
    finite: true,
  });
  assert.equal(output.projection.projection.value.value, 20);
  assert.equal(request.result.status, "ready");
  assert(Object.isFrozen(model));
  assert.throws(() => {
    model.inputs[0].unit = "corrupted";
  }, TypeError);

  workspace.setModelInput(model.id, input.id, 3, model.documentId);
  const edited = workspace.describeModel(model.id);
  assert.notEqual(edited.documentId, model.documentId);
  assert.equal(
    edited.inputs.find((port) => port.id === input.id).binding.value,
    3,
  );
  assert.equal(workspace.project(output.reference).projection.value.value, 30);
  assert.equal(
    output.projection.projection.value.value,
    20,
    "discovery snapshots stay immutable",
  );
  assert.throws(
    () => workspace.setModelInput(model.id, input.id, 4, model.documentId),
    errorCode("STALE_DOCUMENT", {
      expectedDocumentId: model.documentId,
      currentDocumentId: edited.documentId,
    }),
  );
  assert.throws(
    () => workspace.setModelInput(model.id, input.id, 4),
    errorCode("STALE_DOCUMENT", { expectedDocumentId: null }),
  );
  for (const value of [NaN, Infinity, 1e13]) {
    assert.throws(
      () =>
        workspace.setModelInput(model.id, input.id, value, edited.documentId),
      errorCode("INVALID_INPUT", { item: model.id, port: input.id }),
    );
  }
  for (const port of ["missing", "toString", "__proto__"]) {
    assert.throws(
      () => workspace.setModelInput(model.id, port, 1, edited.documentId),
      errorCode("INVALID_INPUT", { port }),
    );
  }
  assert.throws(
    () => workspace.describeModel("missing"),
    errorCode("ITEM_NOT_FOUND", { item: "missing" }),
  );
  assert.throws(
    () => workspace.inspectModel(request.id),
    errorCode("UNSUPPORTED_CONTENT", { item: request.id }),
  );
  assert.throws(
    () => workspace.setModelInput("missing", input.id, 1, edited.documentId),
    errorCode("ITEM_NOT_FOUND"),
  );
  assert.throws(
    () => workspace.createModel("unknown", edited.documentId),
    errorCode("INVALID_INPUT", { family: "unknown" }),
  );
  assert.throws(
    () =>
      workspace.apply(
        [{ kind: "rename", item: "missing", label: "No" }],
        edited.documentId,
      ),
    (error) => {
      errorCode("OPERATION_REJECTED", { operation: "apply" })(error);
      assert(error.cause instanceof Error);
      return true;
    },
  );
  assert.equal(
    workspace.read().id,
    edited.documentId,
    "rejected edits preserve accepted state",
  );

  const completion = await workspace.compute(request.reference).completion;
  assert.equal(completion.status, "retained");
  assert.equal(completion.receipt.outcome.status, "success");
  assert.equal(
    workspace.describeModel(model.id).requests[0].result.status,
    "current",
  );
  const text = workspace.export();
  reopened = await openHeadlessWorkspace(text);
  const restored = reopened
    .models()
    .find((candidate) => candidate.id === model.id);
  assert.equal(restored.requests[0].result.status, "current");
  assert.equal(
    restored.outputs.find((port) => port.id === output.id).projection.projection
      .value.value,
    30,
  );
  assert.equal(reopened.export(), text);
  workspace.setModelInput(model.id, input.id, 4, workspace.read().id);
  assert.equal(
    workspace.describeModel(model.id).requests[0].result.status,
    "ready",
  );
  await assert.rejects(
    () => openHeadlessWorkspace("{}"),
    errorCode("INVALID_WORKSPACE", { operation: "open" }),
  );
  await assert.rejects(
    () => openHeadlessWorkspace("bad json"),
    (error) => {
      errorCode("INVALID_WORKSPACE")(error);
      assert(error.cause instanceof SyntaxError);
      return true;
    },
  );
  workspace.dispose();
  workspace.dispose();
  assert.throws(() => workspace.models(), errorCode("WORKSPACE_CLOSED"));
  assert.throws(
    () => workspace.describeModel(model.id),
    errorCode("WORKSPACE_CLOSED"),
  );
  assert.throws(
    () => workspace.setModelInput(model.id, input.id, 1, edited.documentId),
    errorCode("WORKSPACE_CLOSED"),
  );
  console.log(
    "Headless discovery: public-only discover/edit/compute/export/reopen workflow, immutable port metadata, result currency and stable error codes pass.",
  );
} finally {
  workspace.dispose();
  reopened?.dispose();
}
