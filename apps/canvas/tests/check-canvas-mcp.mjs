import assert from "node:assert/strict";
import { RegionSession } from "../src/regions/document.ts";
import { createMcpCanvas } from "../src/regions/mcp.ts";
import { MCP_MUTATIONS } from "../src/regions/mcpProtocol.ts";
import { openHeadlessWorkspace } from "../src/headless.ts";

const makeSession = () =>
  new RegionSession(undefined, () => [], undefined, [], false, undefined, {
    artifactExecutor: null,
  });
const session = makeSession();
let editing = false;
const edits = {
  read: () => ({ editing: editing ? "draft" : undefined, draft: "" }),
  finish: () => true,
  settle: async () => {},
};
const canvas = {
  inspect: () => ({
    selection: [session.state.regions[0]?.id].filter(Boolean),
    test: true,
  }),
  capture: async () => ({
    mimeType: "image/jpeg",
    data: "YWJj",
    width: 1,
    height: 1,
    documentId: session.document.id,
  }),
};
const owner = (scope = "full-control", agent = "Test agent") =>
  createMcpCanvas(session, edits, canvas, { scope, agent });
let mcp = owner();
const call = (name, args = {}) =>
  mcp.call(crypto.randomUUID(), name, {
    ...(MCP_MUTATIONS.includes(name)
      ? {
          operationId: crypto.randomUUID(),
          expectedSessionId: mcp.state().sessionId,
        }
      : {}),
    ...args,
  });
const code = (expected) => (error) => {
  assert.equal(error.code, expected, error.message);
  assert(error.recovery);
  return true;
};
try {
  const initial = await call("inspect_workspace");
  const args = {
    operationId: "create-spring",
    batch: {
      expectedDocumentId: initial.documentId,
      edits: [
        { operation: "createEquation", text: "x := 2 mm", as: "input" },
        { operation: "createEquation", text: "F = (10 N/mm)*x", as: "force" },
        { operation: "createModel", family: "spring", as: "spring" },
        {
          operation: "setModelInput",
          model: "$spring",
          input: "displacement",
          value: 3,
        },
      ],
    },
  };
  const accepted = await call("edit_canvas", args);
  const changedRoot = session.document;
  assert.notEqual(accepted.documentId, initial.documentId);
  assert.deepEqual(
    await call("edit_canvas", args),
    accepted,
    "exact retry returns the accepted result without applying twice",
  );
  assert.equal(session.document, changedRoot);
  await assert.rejects(
    call("edit_canvas", {
      ...args,
      batch: {
        ...args.batch,
        edits: [{ operation: "createNote", text: "different" }],
      },
    }),
    code("OPERATION_ID_CONFLICT"),
  );
  assert.equal(
    (await call("operation_status", { operationId: args.operationId })).status,
    "accepted",
  );
  assert.equal(
    (await call("operation_status", { operationId: "unknown" })).status,
    "unknown",
  );
  const journalId = mcp.state().sessionId;
  mcp.close();
  mcp = owner();
  assert.equal(mcp.state().sessionId, journalId);
  assert.deepEqual(
    await call("edit_canvas", args),
    accepted,
    "socket reconnection preserves recovery and identities",
  );
  assert.equal(session.document, changedRoot);
  const changed = await call("inspect_workspace");
  assert.equal(changed.models.length, 1);
  assert.equal(accepted.result.aliases.spring, changed.models[0].id);
  const request = changed.models[0].requests[0];
  assert(request.reference);
  assert.equal(
    (await call("inspect_workspace", { compact: true })).view,
    "compact",
  );
  const model = await call("inspect_model", {
    id: accepted.result.aliases.spring,
  });
  assert.deepEqual(model.model.requests[0].reference, request.reference);
  const equation = await call("inspect_equation", {
    id: accepted.result.aliases.input,
  });
  assert.equal(equation.region.quantity.unit, "m");
  const dependencies = await call("inspect_dependencies", {
    id: accepted.result.aliases.force,
    direction: "upstream",
  });
  assert(
    dependencies.nodes.some(
      (node) => node.id === accepted.result.aliases.input,
    ),
  );
  assert(
    (
      await call("inspect_dependencies", {
        id: accepted.result.aliases.input,
        direction: "downstream",
      })
    ).nodes.some((node) => node.id === accepted.result.aliases.force),
  );
  assert.equal(
    (await call("inspect_selection")).objects[0].region.text,
    "x := 2 mm",
  );
  await assert.rejects(
    call("inspect_equation", { id: "missing" }),
    code("ITEM_NOT_FOUND"),
  );
  await assert.rejects(
    call("inspect_model", { id: "missing" }),
    code("ITEM_NOT_FOUND"),
  );
  await assert.rejects(
    call("compute", {
      expectedDocumentId: initial.documentId,
      target: request.reference,
    }),
    code("STALE_DOCUMENT"),
  );
  const computed = await call("compute", {
    expectedDocumentId: changed.documentId,
    target: request.reference,
  });
  assert.equal(computed.completion.status, "retained");
  assert.equal(computed.completion.receipt.outcome.status, "success");
  assert((await call("validate")).admitted);
  // The export is a frozen native snapshot, not a path or a writer bypass.
  const exported = await call("export_workspace", {
    expectedDocumentId: session.document.id,
  });
  const chunk = await call("read_export", {
    snapshotId: exported.snapshotId,
    index: 0,
  });
  const restored = await openHeadlessWorkspace(chunk.text);
  try {
    assert.equal(restored.models()[0].requests[0].result.status, "current");
  } finally {
    restored.dispose();
  }
  await call("undo", { expectedDocumentId: session.document.id });
  assert.equal(
    (await call("inspect_workspace")).models.length,
    0,
    "one shared Undo reverses the whole batch",
  );
  assert.equal(
    (await call("read_export", { snapshotId: exported.snapshotId, index: 0 }))
      .text,
    chunk.text,
    "export remains immutable after edits",
  );
  await call("redo", { expectedDocumentId: session.document.id });
  assert.equal((await call("inspect_workspace")).models.length, 1);
  const before = session.document;
  await assert.rejects(
    call("edit_canvas", {
      operationId: "rejected-batch",
      batch: {
        expectedDocumentId: before.id,
        edits: [
          { operation: "createNote", text: "must not publish" },
          { operation: "not_an_operation" },
        ],
      },
    }),
    code("INVALID_EDIT"),
  );
  assert.equal(session.document, before);
  assert.equal(
    (await call("operation_status", { operationId: "rejected-batch" })).status,
    "failed",
  );
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
  assert.equal(
    (await call("proposal_status", { id: proposal.id })).status,
    "applied",
  );
  editing = true;
  await assert.rejects(
    call("undo", { expectedDocumentId: session.document.id }),
    code("HUMAN_DRAFT_ACTIVE"),
  );
  assert.equal(
    (await call("operation_status", { operationId: args.operationId })).status,
    "accepted",
    "recovery reads work during human drafts",
  );
  editing = false;
  assert.equal((await call("inspect_canvas")).attention.test, true);
  assert.equal((await call("look_at_canvas")).mimeType, "image/jpeg");
  // Enforce scopes in the owner, not only the Node adapter or tool annotations.
  const readonly = owner("read-only");
  await assert.rejects(
    readonly.call("r", "prepare_edit", {}),
    code("PERMISSION_DENIED"),
  );
  await assert.rejects(
    readonly.call("r", "edit_canvas", args),
    code("PERMISSION_DENIED"),
  );
  assert.equal(
    (
      await readonly.call("r", "operation_status", {
        operationId: args.operationId,
      })
    ).status,
    "accepted",
  );
  readonly.close();
  const proposing = owner("proposal-only", "Proposal agent");
  const proposed = await proposing.call("p", "prepare_edit", {
    explanation: "Human reviews",
    batch: {
      expectedDocumentId: session.document.id,
      edits: [{ operation: "createNote", text: "Human-approved proposal" }],
    },
  });
  await assert.rejects(
    proposing.call("p", "apply_proposal", {
      operationId: "no-escalation",
      expectedDocumentId: session.document.id,
      id: proposed.id,
    }),
    code("PERMISSION_DENIED"),
  );
  assert.equal(session.document.id, proposed.documentId);
  proposing.approveProposal(proposed.id);
  assert.equal(
    (await proposing.call("p", "proposal_status", { id: proposed.id })).status,
    "applied",
  );
  assert(
    proposing
      .state()
      .activity.some(
        (entry) =>
          entry.status === "human-approved" && entry.agent === "Proposal agent",
      ),
  );
  proposing.close();
  const editingOwner = owner("edit");
  await assert.rejects(
    editingOwner.call("e", "start_compute", {
      operationId: "no-compute",
      expectedDocumentId: session.document.id,
      target: request.reference,
    }),
    code("PERMISSION_DENIED"),
  );
  editingOwner.close();
  // Multi-chunk Unicode archives reconstruct exactly, including astral characters.
  for (let batch = 0; batch < 3; batch++)
    await call("edit_canvas", {
      batch: {
        expectedDocumentId: session.document.id,
        edits: Array.from({ length: 10 }, (_, index) => ({
          operation: "createNote",
          text: `Note ${batch}:${index} ` + "🛠 assumption ".repeat(300),
        })),
      },
    });
  const native = await call("export_workspace", {
    expectedDocumentId: session.document.id,
  });
  assert(native.chunkCount > 1);
  const texts = [];
  for (let index = 0; index < native.chunkCount; index++)
    texts.push(
      (await call("read_export", { snapshotId: native.snapshotId, index }))
        .text,
    );
  assert.equal(new Blob([texts.join("")]).size, native.byteLength);
  const large = await openHeadlessWorkspace(texts.join(""));
  try {
    assert.equal(
      large.worksheet().regions.length,
      (await call("inspect_workspace")).worksheet.regions.length,
    );
  } finally {
    large.dispose();
  }
  await assert.rejects(
    call("read_export", { snapshotId: exported.snapshotId, index: 0 }),
    code("SNAPSHOT_NOT_FOUND"),
  );
  // A controllable executor proves nonblocking jobs, result polling, cancellation and disconnect cleanup.
  const originalCompute = session.compute;
  let cancelled = 0;
  session.compute = () => {
    let complete;
    const completion = new Promise((resolve) => {
      complete = resolve;
    });
    return {
      id: crypto.randomUUID(),
      completion,
      cancel: () => {
        cancelled++;
        complete({ status: "discarded" });
      },
    };
  };
  const jobs = [];
  for (let index = 0; index < 4; index++)
    jobs.push(
      await call("start_compute", {
        expectedDocumentId: session.document.id,
        target: request.reference,
      }),
    );
  assert.equal(
    (await call("job_status", { jobId: jobs[0].jobId })).state,
    "running",
  );
  assert.equal(
    (await call("job_result", { jobId: jobs[0].jobId })).completion,
    undefined,
  );
  assert(
    (await call("inspect_model", { id: accepted.result.aliases.spring })).model,
  );
  await assert.rejects(
    call("start_compute", {
      expectedDocumentId: session.document.id,
      target: request.reference,
    }),
    code("JOB_LIMIT"),
  );
  editing = true;
  await call("cancel_compute", { jobId: jobs[0].jobId });
  editing = false;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await call("job_result", { jobId: jobs[0].jobId })).completion.status,
    "discarded",
  );
  const currentSessionId = mcp.state().sessionId;
  mcp.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    cancelled,
    4,
    "disconnect cancels only jobs owned by this bridge",
  );
  session.compute = originalCompute;
  mcp = owner();
  assert.equal(mcp.state().sessionId, currentSessionId);
  assert.equal(
    (await call("job_status", { jobId: jobs[1].jobId })).state,
    "completed",
  );
  assert((await call("agent_activity")).activity.length <= 30);
  mcp.close();
  await assert.rejects(call("inspect_workspace"), code("CONNECTION_CLOSED"));
} finally {
  mcp.close();
  session.dispose();
}

const boundedSession = makeSession();
const bounded = createMcpCanvas(boundedSession, edits, canvas, {
  scope: "full-control",
});
try {
  for (let index = 0; index < 256; index++)
    await assert.rejects(
      bounded.call("x", "undo", {
        operationId: `invalid-${index}`,
        expectedSessionId: bounded.state().sessionId,
        expectedDocumentId: "stale",
      }),
      code("STALE_DOCUMENT"),
    );
  await assert.rejects(
    bounded.call("x", "undo", {
      operationId: "over-limit",
      expectedSessionId: bounded.state().sessionId,
      expectedDocumentId: boundedSession.document.id,
    }),
    code("OPERATION_LIMIT"),
  );
  assert.equal(
    (await bounded.call("x", "operation_status", { operationId: "invalid-0" }))
      .status,
    "failed",
    "old IDs are never silently evicted",
  );
} finally {
  bounded.close();
  boundedSession.dispose();
}

const captureSession = makeSession();
let release;
const capturing = createMcpCanvas(captureSession, edits, {
  inspect: () => ({}),
  capture: () =>
    new Promise((resolve) => {
      release = resolve;
    }),
});
try {
  const pending = capturing.call("image", "look_at_canvas", {});
  await assert.rejects(
    capturing.call("other", "inspect_workspace", {}),
    code("BUSY"),
  );
  capturing.close();
  release({
    mimeType: "image/jpeg",
    data: "YWJj",
    width: 1,
    height: 1,
    documentId: captureSession.document.id,
  });
  await assert.rejects(pending, code("CANCELLED"));
} finally {
  capturing.close();
  captureSession.dispose();
}
console.log(
  "canvas MCP: focused inspection, scopes/human approval, bounded replay-safe recovery, jobs/cancellation, attribution and chunked native export passed",
);
