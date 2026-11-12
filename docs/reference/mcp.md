# Live canvas MCP server

The experimental local MCP server gives an external MCP client direct control of one
open Manifold canvas. It does not need a Pi model, provider credentials or the built-in
assistant. The browser remains the only workspace writer; accepted edits use normal
validation, autosave and shared Undo/Redo.

## Configure a client

Requires Node 22.18+, `npm ci` and a running canvas (`make canvas`). Add this stdio
server to your MCP client's configuration, replacing the absolute checkout path:

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

Use the absolute executable path if your client cannot find `node`. The server does
not start the canvas web application. `npm run mcp` is also available for manual
startup; client configurations should launch Node directly so npm output cannot
interfere with stdio JSON-RPC.

The default canvas URL is `http://127.0.0.1:58310/`. To select an existing canvas URL
(including its query parameters) or the development frontend, set the server's
`MANIFOLD_CANVAS_URL` environment variable in the client configuration. Only local
HTTP URLs are accepted; the browser's exact origin must match that URL.

## Connect and grant authority

1. Ask the external agent to call `connect_canvas`.
2. Open the private URL it returns in your browser. Use that tab as the authoritative
   canvas; do not operate another tab on the same saved workspace concurrently.
3. Read the **External agent** notice and click **Enable full control**.
4. The agent can now inspect, edit and explicitly compute without per-edit approval.
5. Click **Disconnect agent** to revoke authority. Closing/reloading the tab or
   stopping the MCP process also disconnects. Accepted edits remain in the canvas.

Opening the URL alone grants no authority. Its credential is carried in a fragment,
not sent to the static web server, and removed from the address bar with history
replacement. Do not share or log the URL. The credential is valid only for the lifetime
of that MCP process. One process accepts one canvas connection at a time. To work
with independent canvases, configure independent MCP processes and canvas URLs.
After a reload, call `connect_canvas` again and open the returned URL to reconnect.

**This is a trust grant, not an approval-only assistant.** An enabled agent can read
engineering content and canvas images, change supported content, undo human edits and
run registered computations. The MCP client may send tool results to its own model
provider. Only connect agents you trust. This does not change the built-in assistant's
approval-only permissions and does not expose shell, filesystem or arbitrary code execution.

## Tools

| Tool | Contract |
| --- | --- |
| `connect_canvas` | Returns the private connection URL and current connection status; does not grant browser authority. |
| `inspect_workspace` | Full worksheet/model inspection, including exact computation request references, units, diagnostics and result currency. |
| `inspect_canvas` | Paged canvas objects, drawing marks, plots/groups and live viewport/frame context. Use `offset` and `limit` (1–100). |
| `inspect_plot` | Exact plot data and actual evidence currency for a discovered representation `id`; does not compute. |
| `look_at_canvas` | Bounded native MCP JPEG image of the canvas or one visible representation `id`. Excludes assistant, connection notice and browser chrome. |
| `capabilities` | Supported edit operations and their batch JSON Schema. The shared schema describes operation setup; MCP's `compute` explicitly supplies execution authority. |
| `edit_canvas` | Immediately applies a `batch` of 1–50 edits atomically, returning the accepted document ID, edit result and validation. |
| `prepare_edit` | Stages `explanation` and `batch` without publication; returns an exact proposal, diff and validation. At most 20 proposals per connection. |
| `apply_proposal` | Applies a staged proposal `id` using `expectedDocumentId`; rejects stale/resolved proposals. Does not ask for another human approval. |
| `compute` | Executes a discovered `target` reference using `expectedDocumentId`; returns actual completion and validation. |
| `validate` | Reports diagnostics and computation currency without execution. |
| `undo`, `redo` | Reverses/replays one entry in the shared canvas history using `expectedDocumentId`. |

Use `capabilities` rather than guessing edit payloads. Edits include the existing
worksheet/model authoring operations plus drawings/connectors, grouping, placement,
worksheet plots and scalar-model analysis setup. This is not a generic DOM or every-UI-action
API; unsupported operations remain unsupported. Creating a plot/analysis never implicitly
runs a computation. Full workspace inspection supplies exact model request references;
canvas object inspection supplies representation references for analyses.

An immediate edit looks like:

```json
{
  "batch": {
    "expectedDocumentId": "<documentId from inspection>",
    "edits": [
      { "operation": "createEquation", "text": "x := 2 mm" },
      { "operation": "createEquation", "text": "F = (10 N/mm)*x" }
    ]
  }
}
```

For computation, pass the exact `reference` of a request discovered by
`inspect_workspace.models[].requests[]`, or a computational representation reference
from `inspect_canvas.objects[]`:

```json
{
  "expectedDocumentId": "<current inspected documentId>",
  "target": {
    "document": "<reference.document>",
    "item": "<reference.item>",
    "selection": { "kind": "follow" },
    "selector": { "kind": "whole", "version": 1 }
  }
}
```

Copy actual references; do not synthesize IDs or selectors. Document identity and current
accepted document ID are different fields. Declared model input units govern numeric
edits. Success, validation and checked receipts do not establish physical validity.

## Concurrency, limits and recovery

One tool call runs at a time. Requests and responses are bounded; edit arguments are
limited to 100,000 JSON characters, WebSocket messages to 2 MiB, and browser responses
to 1,800,000 UTF-8 bytes. Page inspection or request a single image/object when a result
is too large. Unaccepted human/renderer drafts block calls instead of being overwritten.
Edits and history/computation calls reject a mismatched accepted document ID. Staged
proposals additionally retain the exact reviewed root and commands.

Calls time out after two minutes. Cancellation, timeout and disconnect cancel an active
MCP computation/capture's authority. A synchronous edit may already have been accepted
before cancellation, a transport failure or an oversized response. **Never blindly retry
a mutation after an ambiguous failure:** reconnect, inspect accepted state and decide
what remains to be done. Disconnect is not rollback. Computation receipts are separate
from authored Undo history and retain their actual result currency.

The stdio server binds an ephemeral WebSocket listener only to `127.0.0.1`, requires a
random process-scoped token, validates Host and exact canvas Origin, rejects a second
canvas and exposes no HTTP API. No network-facing MCP endpoint, remote authentication,
multiplayer ownership, durable audit log or automatic provider inference is introduced.
Workspace text/images remain untrusted data, never tool instructions.

The [agent guide](../guides/agents.md) describes the separate file-based candidate workflow;
the [headless API](headless-api.md) is for in-process integration. The
[architecture decision](../design/decisions/0040-full-control-canvas-mcp.md) records this
explicit full-control boundary.
