import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import { createMcpCanvas } from "../src/regions/mcp.ts";

const session = new RegionSession(
  undefined,
  () => [],
  undefined,
  [],
  false,
  undefined,
  { artifactExecutor: null },
);
let editing = false;
const mcp = createMcpCanvas(
  session,
  {
    read: () => ({ editing: editing ? "draft" : undefined, draft: "" }),
    finish: () => true,
    settle: async () => {},
  },
  {
    inspect: () => ({ test: true }),
    capture: async () => ({
      mimeType: "image/jpeg",
      data: "YWJj",
      width: 1,
      height: 1,
      documentId: session.document.id,
    }),
  },
);
const call = (name, args = {}) => mcp.call(crypto.randomUUID(), name, args);
try {
  const initial = await call("inspect_workspace");
  const edit = await call("edit_canvas", {
    batch: {
      expectedDocumentId: initial.documentId,
      edits: [
        { operation: "createEquation", text: "x := 2 mm" },
        { operation: "createModel", family: "spring", as: "spring" },
        {
          operation: "setModelInput",
          model: "$spring",
          input: "displacement",
          value: 3,
        },
      ],
    },
  });
  assert.notEqual(edit.documentId, initial.documentId);
  const changed = await call("inspect_workspace");
  assert.equal(changed.models.length, 1);
  assert.equal(edit.result.aliases.spring, changed.models[0].id);
  const request = changed.models[0].requests[0];
  assert(request.reference, "exact computation references are discoverable");
  await assert.rejects(
    call("compute", {
      expectedDocumentId: initial.documentId,
      target: request.reference,
    }),
    /changed/,
  );
  const computed = await call("compute", {
    expectedDocumentId: changed.documentId,
    target: request.reference,
  });
  assert.equal(computed.completion.status, "retained");
  assert.equal(computed.completion.receipt.outcome.status, "success");
  const cancelled = mcp.call("cancel-compute", "compute", {
    expectedDocumentId: session.document.id,
    target: request.reference,
  });
  mcp.cancel("cancel-compute");
  await assert.rejects(cancelled, /revoked/);
  assert((await call("validate")).admitted);
  await call("undo", { expectedDocumentId: session.document.id });
  assert.equal(
    (await call("inspect_workspace")).models.length,
    0,
    "one shared Undo reverses the whole atomic batch",
  );
  await call("redo", { expectedDocumentId: session.document.id });
  assert.equal((await call("inspect_workspace")).models.length, 1);
  const before = session.document;
  await assert.rejects(
    call("edit_canvas", {
      batch: {
        expectedDocumentId: before.id,
        edits: [
          { operation: "createNote", text: "must not publish" },
          { operation: "not_an_operation" },
        ],
      },
    }),
  );
  assert.equal(session.document, before);
  const proposal = await call("prepare_edit", {
    explanation: "Add a note",
    batch: {
      expectedDocumentId: before.id,
      edits: [{ operation: "createNote", text: "reviewed" }],
    },
  });
  assert.equal(session.document, before);
  await call("apply_proposal", {
    expectedDocumentId: before.id,
    id: proposal.id,
  });
  await assert.rejects(
    call("apply_proposal", {
      expectedDocumentId: session.document.id,
      id: proposal.id,
    }),
    /resolved/,
  );
  editing = true;
  await assert.rejects(
    call("undo", { expectedDocumentId: session.document.id }),
    /Finish or cancel/,
  );
  editing = false;
  assert.equal((await call("inspect_canvas")).attention.test, true);
  assert.equal((await call("look_at_canvas")).mimeType, "image/jpeg");
  await assert.rejects(call("bash"), /Unsupported/);
  mcp.close();
  await assert.rejects(call("inspect_workspace"), /closed/);
} finally {
  mcp.close();
  session.dispose();
}
// Revoking a connection also invalidates asynchronous capture and forbids overlapping calls.
const captureSession = new RegionSession(
  undefined,
  () => [],
  undefined,
  [],
  false,
  undefined,
  { artifactExecutor: null },
);
let release;
const capturing = createMcpCanvas(
  captureSession,
  {
    read: () => ({ draft: "" }),
    finish: () => true,
    settle: async () => {},
  },
  {
    inspect: () => ({}),
    capture: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  },
);
try {
  const pending = capturing.call("image", "look_at_canvas", {});
  await assert.rejects(
    capturing.call("other", "inspect_workspace", {}),
    /running/,
  );
  capturing.close();
  release({
    mimeType: "image/jpeg",
    data: "YWJj",
    width: 1,
    height: 1,
    documentId: captureSession.document.id,
  });
  await assert.rejects(pending, /revoked/);
} finally {
  capturing.close();
  captureSession.dispose();
}
console.log(
  "canvas MCP: atomic direct edits, exact proposals, computation evidence/cancellation, capture revocation, guards and shared history passed",
);
