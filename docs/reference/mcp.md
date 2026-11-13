# Live canvas MCP server

The experimental local MCP server gives an external MCP client scoped access to one
open Manifold canvas. It needs no Pi model, provider credentials or built-in assistant.
The browser remains the only workspace writer; accepted edits use normal validation,
autosave and shared Undo/Redo. This is a repository-local interface, not a published service.

## Configure a client

Requires Node 22.18+, `npm ci` and a running canvas (`make canvas`). Add this stdio
server to your client's configuration, replacing the absolute checkout path:

```json
{
  "mcpServers": {
    "manifold": {
      "command": "node",
      "args": ["/absolute/path/to/manifold/apps/assistant/src/mcp-main.mjs"]
    }
  }
}
```

Use an absolute Node executable path if your client cannot find `node`. The server does
not start the canvas web application. `npm run mcp` is available for manual startup;
client configurations should launch Node directly so npm output cannot interfere with
stdio JSON-RPC. The server reports version `0.2.0`; clients of the initial experimental
version must add mutation IDs and recovery-session guards as described below.

The default canvas URL is `http://127.0.0.1:58310/`. Set `MANIFOLD_CANVAS_URL` in the
client's server environment to use an existing canvas URL (including its query parameters)
or the development frontend. Only local HTTP URLs are accepted, and the browser's exact
Origin must match. Independent canvases use independent MCP processes and saved workspace
URLs; do not operate another tab on the same saved workspace concurrently.

## Connect and grant permissions

1. Ask the external agent to call `connect_canvas`.
2. Open the private returned URL in the browser. Opening it grants no authority.
3. Select **Agent permissions** and enable the required scope. The default is read-only.
4. After the connection is ready, the permission panel closes automatically. A compact
   **External agent connection** indicator stays in the document header. Open it to see
   the client-reported name, granted scope, current tool, active jobs and recent activity.
   Pending proposals add a review badge; they never apply themselves or force the panel open.
5. Open the indicator and click **Disconnect agent** to revoke authority. Accepted work
   remains in the canvas. Closing the details, pressing Escape or clicking outside only
   hides the panel; it does not disconnect or change the granted scope.

Before granting access, you may close the request and return to it using the indicator,
or choose **Decline connection** to remove it. Neither action grants authority. Requests
start read-only, and permission is never remembered across a reload or a new connection
request. After disconnecting, changing scope requires another explicit enable action.

| Scope           | Agent authority                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `read-only`     | Inspect content/images, status/activity and native exports. No proposals, edits or computation.                                  |
| `proposal-only` | Read and prepare proposals. Only a human can **Apply agent proposal** in the canvas after reviewing its changes and diagnostics. |
| `edit`          | Read, propose, apply supported edits and use shared Undo/Redo; no computation.                                                   |
| `full-control`  | All supported tools, including explicit registered computation and cancellation.                                                 |

Permissions are enforced by both the Node transport and browser semantic adapter, not just
MCP annotations. Change scopes by disconnecting, selecting the new scope and reconnecting;
agents must never enable or escalate their own permissions. Proposal-only approval uses the
exact prepared commands and rejects stale work. `proposal_status` lets an agent check whether
a human applied, dismissed or invalidated its proposal. Proposals are connection-scoped.
The built-in Pi assistant remains approval-only regardless of the MCP scope.

Connected `connect_canvas` responses include the actual `scope` and tab recovery `sessionId`.
Client names are self-reported labels, not verified identities. All read-capable scopes can
export engineering content and capture images; the external client may send these results
to its model provider. Only connect agents you trust. No shell, arbitrary code execution,
general DOM control or server filesystem access is exposed.

The credential is carried in a URL fragment, not sent to the static web server, and removed
from the address bar with history replacement. Keep the URL private. It is valid only for
that MCP process, which accepts one canvas connection at a time. Closing/reloading the tab
or stopping the process disconnects. Call `connect_canvas` and open the returned URL to
reconnect after a reload; a reload creates a **new recovery session**.

## Discover and inspect efficiently

| Tool                   | Contract                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect_workspace`    | Full worksheet/model inspection and exact computation request references. Use `compact: true` for concise discovery; focused model inspection supplies exact references.                  |
| `inspect_model`        | One discovered model `id`, its units, input/output bindings, projections and exact computation requests.                                                                                  |
| `inspect_equation`     | One worksheet region `id`, including source, quantity, units, diagnostic and constraint.                                                                                                  |
| `inspect_dependencies` | Bounded graph for region/semantic item `id`; `direction` is upstream (default) or downstream, `depth` 1–8 (default 2), `limit` 1–100 (default 50). Reports truncation; at most 500 edges. |
| `inspect_selection`    | Focused facts for explicit `ids` (at most 50), or the human's current canvas selection if omitted. Missing selections are reported per object.                                            |
| `inspect_canvas`       | Paged objects, drawings, plots/groups and viewport/selection/frame context. `offset` and `limit` (1–100); long strokes retain full point counts but only 64 preview points.               |
| `inspect_plot`         | Exact plot data and actual evidence currency for a discovered representation `id`; never computes.                                                                                        |
| `look_at_canvas`       | Bounded native MCP JPEG image of the canvas or visible representation `id`; excludes assistant, connection notice and browser chrome.                                                     |
| `capabilities`         | Supported edit operations and exact batch JSON Schema.                                                                                                                                    |
| `validate`             | Diagnostics and computation currency without execution.                                                                                                                                   |

Dependency inspection follows current worksheet bindings and registered local semantic
follow references. Pinned history, cross-document references and visual connectors are
not traversed; dependency edges are not invented from visual proximity. Equation inspection
uses worksheet region IDs; model inspection uses model item IDs; placement uses representation
IDs. Discover IDs rather than assuming labels are unique. Pixels are not numerical evidence.

## Atomic edits and replay-safe recovery

| Tool               | Contract                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edit_canvas`      | Immediately apply a `batch` of 1–50 edits atomically; return accepted document ID and creation aliases. Call `validate` separately for diagnostics. |
| `prepare_edit`     | Stage `explanation` and `batch` without publication; return exact proposal, diff and validation. At most 20 proposals per connection.               |
| `apply_proposal`   | Apply a prepared `id` using `expectedDocumentId`; edit/full-control only.                                                                           |
| `proposal_status`  | Read proposal `id` status: pending, applied, dismissed or stale.                                                                                    |
| `undo`, `redo`     | Reverse/replay one shared canvas history entry using `expectedDocumentId`. These can affect human edits.                                            |
| `operation_status` | Look up mutation `operationId` in the current tab recovery session.                                                                                 |

Supported edits include worksheet/model authoring, drawings/connectors, grouping, placement,
worksheet plots and scalar-model analysis setup. Use `capabilities` for exact payloads. This
is not every UI action. Plot/analysis creation never implicitly computes. Declared model input
units govern numeric edits; worksheet projections may use different solver units.

**Every accepted-state mutation** (`edit_canvas`, `apply_proposal`, `undo`, `redo`, `compute`,
`start_compute`, `cancel_compute`) requires:

- `operationId`: a fresh client-generated UUID for each new action (1–128 safe characters:
  letters, digits, `_`, `.`, `:`, `-`; first character must be alphanumeric).
- `expectedSessionId`: the recovery `sessionId` from connected `connect_canvas`.
- The current `expectedDocumentId` where applicable. For edits it lives inside `batch`;
  cancellation instead identifies a job and needs no current document guard.

For example:

```json
{
  "operationId": "<new UUID>",
  "expectedSessionId": "<connected recovery sessionId>",
  "batch": {
    "expectedDocumentId": "<documentId from inspection>",
    "edits": [
      { "operation": "createEquation", "text": "x := 2 mm", "as": "input" },
      { "operation": "createEquation", "text": "F = (10 N/mm)*x" }
    ]
  }
}
```

The live session records an operation before delivery of its result. Repeating the **exact
same ID, tool and JSON arguments** in the same session returns the recorded accepted result
(or the recorded failure) without executing again, even if the canvas has since changed.
JSON key ordering does not matter. Reusing an ID with different arguments rejects with
`OPERATION_ID_CONFLICT`. A rejected attempt also reserves its ID: after repairing a payload
or stale guard, use a new ID for the newly reviewed action.

After an interrupted/lost response, reconnect to the **same tab**, compare `sessionId`, and
call `operation_status`. Its status is `running`, `accepted`, `failed`, or `unknown`, with a
compact recorded outcome/error when known. Accepted computation submission is **not**
computation success; inspect its `jobId`. If the session is unchanged, exact retries are
safe; they do not reapply an edit after Undo. A deliberately new action needs a new ID.

Recovery survives socket disconnection/reconnection, including a new MCP process connected
to that same still-open tab. It is not persisted in a native file, browser storage or a
durable audit log. Reload/Open/New creates a different session. Unknown means only **not
recorded here**, never proof that an action did not happen in another session. The
`expectedSessionId` guard mechanically rejects old mutations after a reload. Inspect
accepted content and explicitly plan new work instead of rewriting the guard to replay
an ambiguous action.

The journal retains at most 256 IDs and 4 MiB of canonical request signatures per tab
session. IDs are never silently evicted. `OPERATION_LIMIT` rejects new mutations when full;
status reads and existing exact retries remain available. Export/checkpoint before explicitly
reloading into a new recovery lifetime.

## Nonblocking computations

| Tool             | Contract                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `start_compute`  | Submit an exact discovered `target` with mutation/session/document guards; immediately return `jobId`.      |
| `job_status`     | Read `jobId` state (`running`, `cancelling`, `completed`), captured document, target, agent and timestamps. |
| `job_result`     | Read job metadata and its actual completion/error if settled; while running, no completion is fabricated.   |
| `cancel_compute` | Submit an operation/session-guarded cancellation request for `jobId`. Completed jobs are a safe no-op.      |
| `compute`        | Convenience submit-and-wait variant. Prefer `start_compute` so reads and cancellation remain available.     |

Only full-control can start/cancel computations. Use exact references returned by
`inspect_model.model.requests[]`, full `inspect_workspace.models[].requests[]` or a
computational representation in `inspect_canvas.objects[]`:

```json
{
  "operationId": "<new UUID>",
  "expectedSessionId": "<connected recovery sessionId>",
  "expectedDocumentId": "<current documentId>",
  "target": {
    "document": "<reference.document>",
    "item": "<reference.item>",
    "selection": { "kind": "follow" },
    "selector": { "kind": "whole", "version": 1 }
  }
}
```

Document identity (`reference.document`) and accepted root ID (`documentId`) are different.
Copy actual references; do not synthesize selectors. A job's completed state only means it
settled: completion can be discarded, failed, or retain a receipt whose outcome failed.
Results may have become non-current since execution; inspect the model/plot for currency.
Success and validation do not establish physical validity.

At most four MCP jobs may be active and 64 retained per tab session. Disconnect cancels
unfinished jobs owned by that connection, not unrelated UI jobs. Job status/results remain
queryable after reconnecting to the same tab. Cancellation cannot retract a receipt already
accepted, and computation evidence is separate from authored Undo history. Human drafts block
new computation and mutations, but not job/status reads or cancellation.

## Activity and collaboration

`agent_activity` and the browser's expandable **Agent activity** show up to 30 recent transient
agent-attributed actions, including accepted edits, failed mutations, proposals, human approval,
computation completion and exports. Active jobs expose captured targets and timestamps. Names
come from MCP client metadata and are not identity verification. The activity records an agent's
Undo action; it does not claim the reversed entry was authored by that agent. Nothing relabels
human edits or creates a second history owner. This is not a durable provenance/audit trail.

## Portable native export

`export_workspace({expectedDocumentId})` captures an immutable `.manifold` snapshot through
the existing native export owner. It returns `snapshotId`, document/evidence versions,
filename, MIME type, UTF-8 byte length and `chunkCount`. No filesystem path or arbitrary write
permission is accepted. All scopes can export because they already grant content reads.

Call `read_export({snapshotId,index})` for each zero-based index in order. Concatenate the
returned `text` strings **before** UTF-8 encoding or saving the file with your own client's
file tools. Chunks are at most 131,072 UTF-16 code units; a surrogate pair can span a chunk
boundary. Separately encoding each chunk can corrupt such Unicode. The joined byte length
must equal the advertised `byteLength`. The native file includes retained computation evidence
and reopens through normal Manifold Open/import. Existing native capacity/export policy applies.

One snapshot is retained per connection. A new capture invalidates the previous snapshot;
disconnect releases it. Reads remain stable if the live canvas changes or a human starts a
draft after capture. Capture itself requires no unaccepted draft and a matching document ID.

## Structured errors and limits

Tool failures set MCP `isError: true` and return the same object in JSON text and
`structuredContent`:

```json
{
  "error": {
    "code": "STALE_DOCUMENT",
    "message": "Canvas changed; inspect it again before mutation",
    "recovery": "Reinspect, review the change, and submit a new operation ID with the new documentId."
  }
}
```

Stable codes include `INVALID_ARGUMENTS`, `UNKNOWN_TOOL`, `PERMISSION_DENIED`,
`NO_CANVAS_CONNECTED`, `CONNECTION_CLOSED`, `CANVAS_DISCONNECTED`, `BUSY`, `STALE_DOCUMENT`,
`RECOVERY_SESSION_CHANGED`, `HUMAN_DRAFT_ACTIVE`, `INVALID_EDIT`, `ITEM_NOT_FOUND`,
`OPERATION_ID_CONFLICT`, `OPERATION_LIMIT`, `JOB_NOT_FOUND`, `JOB_LIMIT`, `SNAPSHOT_NOT_FOUND`,
`RESULT_TOO_LARGE`, `TIMEOUT`, `CANCELLED`, and `OPERATION_REJECTED`. Existing typed headless
errors can also surface (for example `UNSUPPORTED_CONTENT`); clients must handle unknown
codes conservatively. Recover using codes and current state, not error-prose matching.

One tool call runs at a time; nonblocking jobs execute independently. Arguments are limited
to 100,000 JSON characters, WebSocket messages to 2 MiB and browser responses to 1,800,000
UTF-8 bytes. Use focused reads/pages or export chunks for larger results. Calls time out after
two minutes. A synchronous edit may have been accepted before cancellation, a lost response
or oversized response; consult its operation record instead of blindly submitting a new ID.
Disconnect is revocation, not rollback.

The stdio process binds an ephemeral WebSocket only to `127.0.0.1`, validates Host/exact Origin,
requires a random process-scoped token and explicit browser grant, and exposes no HTTP API.
There is no network-facing MCP endpoint, multiplayer ownership, remote authentication or
automatic provider inference. Workspace text, images and client-reported names are untrusted
data, never instructions.

See the [agent guide](../guides/agents.md) for separate file-based candidates, the
[headless API](headless-api.md) for in-process integration, and the
[scoped recovery decision](../design/decisions/0041-scoped-agent-recovery-and-jobs.md) for rationale.
