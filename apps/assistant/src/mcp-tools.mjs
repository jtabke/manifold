import { canvasTools } from "./pi.mjs";
import { MCP_MUTATIONS } from "../../canvas/src/regions/mcpProtocol.ts";

const string = { type: "string", minLength: 1, maxLength: 160 };
const empty = { type: "object", properties: {}, additionalProperties: false };
const schema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const guard = { expectedDocumentId: string };
const operationId = {
  type: "string",
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$",
};
const mutation = (properties, required) =>
  schema({ operationId, expectedSessionId: string, ...properties }, [
    "operationId",
    "expectedSessionId",
    ...required,
  ]);
const target = {
  type: "object",
  properties: {
    document: string,
    item: string,
    selection: { type: "object" },
    selector: {},
  },
  required: ["document", "item", "selection", "selector"],
  additionalProperties: false,
};
const tool = (name, description, inputSchema = empty) => ({
  name,
  description,
  inputSchema,
});
export const mcpTools = [
  tool(
    "connect_canvas",
    "Get a private local URL and connection/granted-scope status. Ask the human to open it and choose permissions. Never enable or escalate permissions yourself. One canvas per process.",
  ),
  ...canvasTools(() => {}).map(({ name, description, parameters }) =>
    tool(
      name,
      name === "prepare_edit"
        ? "Stage 1–50 edits without publication. Proposal-only connections require the human to Apply in the canvas; edit/full-control connections can use apply_proposal. Read capabilities first."
        : name === "inspect_workspace"
          ? "Read the live worksheet, models, exact computation references and evidence currency. Use compact:true for discovery; focused inspection tools return details."
          : description,
      name === "inspect_workspace"
        ? schema({ compact: { type: "boolean" } })
        : parameters,
    ),
  ),
  tool(
    "inspect_model",
    "Inspect one discovered model ID, input/output units, bindings, projections and exact computation requests.",
    schema({ id: string }, ["id"]),
  ),
  tool(
    "inspect_equation",
    "Inspect one worksheet region ID, its source, quantity, units, diagnostic and constraint.",
    schema({ id: string }, ["id"]),
  ),
  tool(
    "inspect_dependencies",
    "Read a bounded computational dependency graph for a worksheet region or semantic item ID. Does not traverse pinned history or visual connectors.",
    schema(
      {
        id: string,
        direction: { enum: ["upstream", "downstream"] },
        depth: { type: "integer", minimum: 1, maximum: 8 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["id"],
    ),
  ),
  tool(
    "inspect_selection",
    "Inspect up to 50 explicit object IDs, or the human's current canvas selection when ids is omitted. Includes focused semantic facts; long drawing strokes remain truncated.",
    schema({ ids: { type: "array", items: string, maxItems: 50 } }),
  ),
  tool(
    "edit_canvas",
    "Immediately apply 1–50 atomic edits using the schema from capabilities. Requires a unique client operationId; retry only the exact same ID/arguments, or query operation_status. Preserves shared Undo. Does not compute.",
    mutation({ batch: { type: "object" } }, ["batch"]),
  ),
  tool(
    "apply_proposal",
    "Apply an exact prepared proposal with a unique operationId and expectedDocumentId. Requires edit or full-control scope; proposal-only connections must wait for human approval.",
    mutation({ ...guard, id: string }, ["expectedDocumentId", "id"]),
  ),
  tool(
    "compute",
    "Execute and wait for one exact discovered computation reference. Prefer start_compute for long jobs so other tools stay available. Operation ID tracks submission, not engineering success.",
    mutation({ ...guard, target }, ["expectedDocumentId", "target"]),
  ),
  tool(
    "start_compute",
    "Start a registered computation and immediately return jobId. Full-control scope required. Poll job_status, fetch job_result, or cancel_compute. Never treat submission as success or physical validity.",
    mutation({ ...guard, target }, ["expectedDocumentId", "target"]),
  ),
  tool(
    "proposal_status",
    "Read whether a staged proposal is pending, applied, dismissed or stale. Does not apply it or escalate permissions.",
    schema({ id: string }, ["id"]),
  ),
  tool(
    "job_status",
    "Read job state, captured document, target and timestamps. Does not wait, compute or imply a current result.",
    schema({ jobId: string }, ["jobId"]),
  ),
  tool(
    "job_result",
    "Read actual completion/evidence or running state. Completed does not imply success or current currency; inspect the model/plot for currency.",
    schema({ jobId: string }, ["jobId"]),
  ),
  tool(
    "cancel_compute",
    "Request cancellation of a tab-owned MCP job. Completion may already have been retained. Inspect job_result; cancellation does not roll back accepted evidence.",
    mutation({ jobId: string }, ["jobId"]),
  ),
  tool(
    "operation_status",
    "Query a client mutation operationId in this tab-lifetime journal. Accepted means submitted, not computation success. Unknown is meaningful only in the same sessionId; never blindly replay across reloads.",
    schema({ operationId }, ["operationId"]),
  ),
  ...["undo", "redo"].map((name) =>
    tool(
      name,
      `${name} one shared history entry, including human edits. Requires expectedDocumentId and a unique operationId.`,
      mutation(guard, ["expectedDocumentId"]),
    ),
  ),
  tool(
    "validate",
    "Read diagnostics and computation currency without execution.",
  ),
  tool(
    "agent_activity",
    "Read bounded transient agent-attributed activity and computation jobs for this tab. Not a durable audit log.",
  ),
  tool(
    "export_workspace",
    "Capture an immutable native .manifold snapshot through the existing export owner. Returns metadata and snapshotId, not a server filesystem path. Use read_export for ordered text chunks and concatenate before saving as UTF-8. Only one snapshot retained per connection.",
    schema(guard, ["expectedDocumentId"]),
  ),
  tool(
    "read_export",
    "Read an ordered native snapshot text chunk by zero-based index. Concatenate all chunks before UTF-8 encoding; the assembled file includes retained computation evidence and can be reopened in Manifold.",
    schema({ snapshotId: string, index: { type: "integer", minimum: 0 } }, [
      "snapshotId",
      "index",
    ]),
  ),
].map((entry) => ({
  ...entry,
  annotations: {
    readOnlyHint:
      !MCP_MUTATIONS.includes(entry.name) && entry.name !== "prepare_edit",
    destructiveHint: ["edit_canvas", "apply_proposal", "undo", "redo"].includes(
      entry.name,
    ),
    idempotentHint: MCP_MUTATIONS.includes(entry.name),
    openWorldHint: false,
  },
}));
