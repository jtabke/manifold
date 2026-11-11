# Headless and agent API reference

For task-oriented automation, start with the [agent guide](../guides/agents.md).
For the file-based executable, see the [CLI reference](cli.md).

The `manifold-canvas/headless` workspace entry point hosts real canvas documents without
React, the DOM, IndexedDB, a server, or browser automation. It reuses the canvas's schemas,
methods, admission limits, native file verification/migration, and operation owner.
This is an initial repository-local TypeScript API, not a published stable SDK.
Requires Node 22.18+ (native TypeScript stripping), or a compatible TypeScript toolchain.

## Open, inspect, edit and export

```ts
import { readFile, writeFile } from "node:fs/promises";
import { openHeadlessWorkspace } from "manifold-canvas/headless";

const workspace = await openHeadlessWorkspace(await readFile("input.json", "utf8"));
try {
  // Find a model with a length input; use discovered IDs rather than storage schemas.
  const model = workspace.models().find(
    (model) => model.inputs.some((input) => input.unit === "mm"),
  );
  const input = model?.inputs.find((input) => input.unit === "mm");
  if (!model || !input) throw Error("No model with an input in mm");

  workspace.setModelInput(model.id, input.id, 3, model.documentId);
  await writeFile("edited.json", workspace.export(), { flag: "wx" });
} finally {
  workspace.dispose();
}
```

Import the package subpath rather than application internals. In this npm workspace the
package is already linked; another workspace consumer should declare `manifold-canvas`
as a dependency. File paths, overwrite policy, and durable storage belong to the caller.
Open returns a new independent workspace; it never replaces another workspace or connects
to an open browser tab. Export returns the same native archive format used by the canvas.

## API surface

| Operation | Behavior |
| --- | --- |
| `createHeadlessWorkspace(options?)` | Create an empty canvas workspace. |
| `openHeadlessWorkspace(text, options?)` | Verify/migrate/admit a native archive and return a new owner. Never execute on Open. |
| `read()` | Read the immutable accepted foundation document. `id` identifies its current authored root; `document` is its stable document identity. |
| `items()` | List current items with their current revision (not all historical revisions). |
| `worksheet()` | Inspect effective worksheet text, classification, quantities, diagnostics, constraints and positions in the active worksheet context. |
| `createEquation(text, expectedDocumentId, at?)` / `updateEquation(region, text, expectedDocumentId)` | Create/update mathematical worksheet source, including retained drafts. |
| `createNote(text, expectedDocumentId, at?)` / `updateNote(region, text, expectedDocumentId)` | Create/update plain worksheet prose without silently interpreting it as mathematics. |
| `transaction(expectedDocumentId, edits => value)` | Compose synchronous high-level worksheet/model edits into one publication and one Undo. Return the callback's value after successful publication. |
| `models()` | Discover all current scalar model instances with public input/output metadata and computation requests. |
| `describeModel(item)` | Describe one model, including units, defaults, bindings, projections, edit bounds, output references, and result status. |
| `inspectModel(item)` | Read the lower-level scalar model instance, its definition, bindings, and selected revisions. |
| `reference(item, selector?)` | Build a follow reference in this document; defaults to the whole item. |
| `project(reference, context?)` | Derive a projection through installed schemas, without scheduling an execution or publishing state. |
| `result(reference, scope?)` | Inspect retained checked evidence and currency; never execute. |
| `apply(commands, expectedDocumentId)` | Apply one validated atomic foundation command batch. |
| `createModel(family, expectedDocumentId)` | Insert an installed model family (`spring` or `scale`) with a default canvas view; return its instance ID. |
| `setModelInput(item, port, value, expectedDocumentId)` | Set a scalar input through the existing domain command; use the port's declared unit. |
| `compute(reference, scope?)` | Explicitly schedule execution; return `{ id, completion, cancel }`. Await `completion` and inspect its status and receipt. |
| `undo(expectedDocumentId)` / `redo(expectedDocumentId)` | Use the shared owner's session history. No-op if that direction has no history. |
| `export()` | Return a coherent native archive string including retained evidence/resources. Session Undo history is not file history. |
| `dispose()` | Cancel owned work and release the host. Idempotent; other operations reject afterward. |

`Command`, `Document`, `Json`, `Reference`, `Scope`, `ModelFamily`, `ModelDescription`,
`HeadlessErrorCode`, `HeadlessOptions`, `HeadlessWorkspace`, `HeadlessEdits`, `WorksheetPosition`,
and `WorksheetSnapshot` types are exported by the entry point. Advanced callers can use
`@manifold/foundation` for selectors, reference contracts, and immutable collection helpers.
For example, `workspace.reference(instanceId, modelPort("force"))` projects a public model
port, where `modelPort` is imported from `@manifold/foundation`.

Mutations require the `read().id` that the caller inspected. A stale or missing ID rejects
before publication; invalid commands and model inputs also preserve accepted state.
This is a guard for one in-process owner, not cross-process file locking. Calls throw on
validation/lifecycle errors. Projection/result availability and execution completion use
the foundation's structured status results, so completion does not by itself mean success.
Read snapshots remain immutable and usable after later edits.

## Worksheet authoring and transactions

```ts
const ids = workspace.transaction(workspace.read().id, edits => {
  const model = edits.createModel("spring");
  edits.setModelInput(model, "displacement", 3);
  const displacement = edits.createEquation("x := 2 mm", { x: 100, y: 200 });
  edits.createEquation("k := 10 N/mm");
  const force = edits.createEquation("F = k*x");
  const note = edits.createNote("Assume a linear spring");
  return { model, displacement, force, note };
});

console.log(workspace.worksheet().regions.find(region => region.id === ids.force));
// The derived quantity is 20 N; no asynchronous execution job was started.
workspace.undo(workspace.read().id); // All four worksheet regions and the model disappear together.
workspace.redo(workspace.read().id);
```

Standalone worksheet create/update calls also publish once and have one Undo step.
Returned region IDs are the IDs accepted by `updateEquation`/`updateNote`; obtain them
from `worksheet()`, not by guessing how foundation item IDs encode worksheet regions.
Optional creation positions use finite canvas coordinates; otherwise normal canvas flow applies.
The existing domain write path preserves dependencies and handles equation renames as in the UI.

`worksheet()` is a read-only derived snapshot, not a second accepted state or an execution
receipt. Each region has effective text, `kind` (`note`, `quantity`, `equation`, `constraint`,
or `draft`), position, name, quantity, diagnostic, constraint result, and an `editable` flag.
Quantities are the worksheet solver's base-unit values with a dimension vector, a derived unit
label, and optional absolute-temperature marker; they are not necessarily the literal authored
unit. For example, `x := 2 mm` projects as `0.002 m`. A diagnostic or unresolved value yields
`quantity: null`, never a fabricated zero. Snapshots include the active context and document ID.

Equation commands require mathematical source but allow incomplete syntax and unresolved or
incompatible expressions to remain visible with diagnostics, matching canvas draft behavior.
They accept assigned quantities, expressions and constraints, not just equality relations.
Note commands reject text the canvas would interpret as mathematics; use an equation for that
source. Both reject empty text and text over 5,000 characters. Updates target plain textual
regions, not dataset/source-backed or external-reference records. An explicit update can
convert a plain region between prose and mathematics; it does not create a new record type.

The transaction callback receives only `createEquation`, `updateEquation`, `createNote`,
`updateNote`, `createModel`, and `setModelInput`. They use the staged document and need no
individual document IDs. Do not call the live workspace, perform I/O, or start execution
inside the callback. Calls to the live workspace (including nested transactions/disposal)
are rejected. Returned promises/thenables are rejected as `INVALID_INPUT`; scoped editor
methods reject after the callback exits, so an async continuation cannot publish through it.
This cannot undo arbitrary external effects performed by user callback code.

A thrown callback or any rejected scoped edit aborts the whole transaction, **even if the
callback catches the edit error**. There is no partial commit, savepoint, or intermediate
accepted root. An empty transaction is not an Undo checkpoint. Results/IDs are usable only
after successful return. The initial document ID guard rejects stale work before the callback.

## Discovery and errors

`models()` and `describeModel(item)` return immutable snapshots for the current baseline.
Each description includes `documentId` for guarded editing, model/definition revision IDs,
public inputs and outputs, and direct follow-bound scalar/general model-output requests.
They cover both built-in and authored models, including multiple outputs with different units;
analysis/sweep requests are not part of this initial discovery interface.

Inputs expose the declared unit, default value (`null` if absent), explicit binding (`null`
when the default is used), and the effective projection. `numericEdit` describes the API's
finite ±1e12 literal-edit limit, **not engineering safety or physical validity constraints**.
Outputs expose their ready-to-use reference and projection; their unit is `null` when no
resolved scalar projection is available. Inspect projection statuses rather than treating
missing data as zero. Discovery derives projections but never schedules computation.

Requests include their reference, exposed output IDs, and the foundation's result status:
`ready` means there is no matching checked receipt and execution may be requested; `current`
means a matching successful receipt exists. Other statuses are `pending`, `failed`, and
`blocked`. After an input changes, a previous receipt is retained but does not qualify as
current for the new input selection; the new selection usually reports `ready`.

Thrown API failures are instances of the exported `HeadlessError`, with a stable `code`,
human-readable `message`, immutable `details`, and an underlying `cause` when wrapping a
domain failure. `JSON.stringify(error)` includes code/message/details, not the cause or stack.
Classification uses explicit boundary conditions, not English message matching.

| Code | Meaning |
| --- | --- |
| `WORKSPACE_CLOSED` | An operation was attempted after disposal. |
| `STALE_DOCUMENT` | An edit omitted the reviewed document ID or supplied a stale one; details include expected/current IDs. |
| `ITEM_NOT_FOUND` | Model inspection/editing or worksheet updating targeted an unavailable current item/region. |
| `UNSUPPORTED_CONTENT` | A model operation targeted a non-model item, or a worksheet edit targeted a source/dataset/external-reference region. |
| `INVALID_INPUT` | Invalid model/input values, worksheet text/coordinates, or an asynchronous transaction callback was supplied. |
| `INVALID_WORKSPACE` | Open failed file verification, migration, admission or owner construction. |
| `OPERATION_REJECTED` | An installed-domain operation, callback, reentrant live call or expired transaction editor rejected the request. Wrapped failures retain their original `cause`. |

```ts
import { HeadlessError } from "manifold-canvas/headless";

try {
  workspace.setModelInput(model.id, input.id, 3, model.documentId);
} catch (error) {
  if (error instanceof HeadlessError && error.code === "STALE_DOCUMENT") {
    // Reinspect, review the changed state, and decide whether to retry.
    console.log(error.details.currentDocumentId);
  } else {
    throw error;
  }
}
```

Projection/result availability and asynchronous job completion continue to use structured
foundation statuses, not exceptions or invented error codes for failed numerical outcomes.

## Execution and effects

Native scalar/model-analysis methods use the canvas's installed executors. Computation is
always explicit. Merely reading retained results or opening/exporting a file does not run jobs.
Use a discovered request reference without constructing an internal request ID:

```ts
const model = workspace.models()[0];
const request = model?.requests[0];
if (!request) throw Error("No discoverable model computation request");
const job = workspace.compute(request.reference);
const completion = await job.completion;
if (completion.status === "retained") {
  console.log(completion.receipt.outcome);
}
```

Python sampling is **disabled by default**: the browser's relative-URL HTTP transport is not
installed. A trusted host may pass `{ artifactExecutor }` to either factory to enable it;
the injected executor receives the existing sampling job and cancellation signal. The host
owns that executor's network/process/security policy. Files cannot install executable handlers.

The [agent JSON helpers](#agent-json-helpers) and [file-based CLI](cli.md) provide JSON discovery, atomic declarative
edits, validation, semantic comparison and explicit native computation over this entry point.
There is no automatic local persistence, HTTP endpoint, MCP server, live-browser bridge,
or general arbitrary-code execution service.
The high-level authoring helpers cover scalar models and plain worksheet text; other installed canvas schemas
can be manipulated through validated command batches rather than duplicated domain logic.

## Agent JSON helpers

The `manifold-canvas/agent` entry point provides versioned, immutable JSON-facing contracts
without filesystem or transport effects:

```ts
import {
  AGENT_PROTOCOL_VERSION,
  agentCapabilities,
  inspectWorkspace,
  summarizeWorkspace,
  summarizeWorksheet,
  type CompactAgentSnapshot,
  editWorkspace,
  validateWorkspace,
  compareWorkspaces,
  type AgentSnapshot,
} from "manifold-canvas/agent";
```

| Export | Contract |
| --- | --- |
| `AGENT_PROTOCOL_VERSION` | Current JSON protocol version, initially `1`. |
| `agentCapabilities()` | Operations, edit JSON Schema, creatable model families and the default local automation profile. Does not introspect executors a trusted host injects. |
| `inspectWorkspace(workspace)` | Immutable `AgentSnapshot` of document identity/root, worksheet and discovered models. Includes public projections and receipt summaries, not raw persistent collections or receipt context maps. |
| `summarizeWorkspace(workspace)` | Immutable `CompactAgentSnapshot`, marked `view: "compact"`, retaining values/units/statuses but omitting provenance trees, request references and receipt keys. Existing `inspectWorkspace` output is unchanged. |
| `summarizeWorksheet(workspace)` | Compact worksheet source, quantities/units, diagnostics and constraint summaries. Does not inspect models. |
| `editWorkspace(workspace, unknownPayload)` | Validate a plain JSON batch and publish through the existing atomic transaction. Return the accepted document ID and creation alias mapping. |
| `validateWorkspace(workspace)` | Report content issues after native admission. Does not execute or certify physical validity. |
| `compareWorkspaces(before, after)` | Compare two owners' public semantic snapshots without mutation or execution. Not an exhaustive archive comparison. |

The [CLI reference](cli.md) owns the shared JSON edit, validation, comparison and result-status
contracts, including [compact versus full discovery](cli.md#compact-discovery-and-focused-details).
These helpers share the headless owner's admission and mutation paths; they do
not create a second operation engine. Always dispose owners you create. A future MCP or
service adapter should use these owners rather than reimplement domain logic.

## Verification

See the [development guide](../development/README.md#checks) for the public headless/agent
contract checks and broader repository gates.
