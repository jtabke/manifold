# CLI reference

This page defines Manifold's local CLI contract. For the discover → edit → check → compute
workflow and a complete edit example, start with the [agent guide](../guides/agents.md).
The interface is experimental and repository-local, not a published stable package.
Requires Node 22.18+ and `npm ci` at the repository root.

## Run

From the repository root:

```sh
node apps/canvas/tools/manifold.mjs --help
node apps/canvas/tools/manifold.mjs capabilities --json
```

After npm installation, the same executable is available as `node_modules/.bin/manifold`.
Examples use that shorter path. No global installation is required.

All command results are JSON on stdout, one response per invocation. `--json` is accepted
but unnecessary. Errors are JSON on stderr. Help is human-readable. No command prompts.
Every response has `protocolVersion: 1`; discovery and mutation responses expose the
reviewed/current `documentId`. Separate invocations do not share session history.

## Commands

All paths are relative to the calling process's working directory. `--output` destinations
must not exist. Options are command-specific; unknown or duplicate options reject.
`--help` (or `-h`) prints human-readable help.

| Command | Arguments and options | Result |
| --- | --- | --- |
| `capabilities` | None | Operations, edit JSON Schema, built-in model families and default execution profile. |
| `create` | `--output FILE` | Empty native workspace plus its inspection snapshot and output path. |
| `inspect` | `FILE [--compact]` | Document identity/root ID, worksheet and model snapshots. |
| `worksheet` | `FILE [--region ID] [--compact]` | Effective worksheet context, regions and document ID. |
| `models` | `FILE [--compact]` | Discovered models and document ID. |
| `model` | `FILE --model ID [--compact]` | One discovered model description. |
| `edit` | `FILE --changes JSON_FILE --output FILE` | Current document ID, accepted alias mapping and output path. |
| `validate` | `FILE [--strict]` | Admission/content report; strict mode exits 3 when issues exist. |
| `diff` | `BASELINE CANDIDATE` | Document IDs, shared-identity flag and semantic region/model changes. |
| `compute` | `FILE --request ID --output FILE [--timeout-ms N]` | Request ID, document ID, completion/receipt summary and output path. |

All commands accept `--json`. Responses carry `protocolVersion: 1`; it identifies the
initial contracts, not a guarantee of package stability. The capabilities JSON Schema
describes edit payload structure; domain checks and revision/alias rules still apply.

## Discovery and result statuses

`inspect` returns the stable document identity, current authored root ID, effective worksheet
snapshot, and discovered scalar models. `worksheet` focuses on text, quantities, diagnostics,
positions and constraint outcomes. `models` and `model` expose public input IDs, declared
units, defaults, bindings, numeric edit bounds, output projections and computation requests.
These cover existing built-in and authored scalar models, not every canvas schema or analysis.
Use `capabilities` to discover creatable model families and the JSON Schema for edit payloads.

Never guess region IDs, storage schema names, selector structures, or computation request IDs.
IDs are opaque. Labels are not unique identifiers. Model literal inputs use the port's declared
unit. Worksheet quantities use solver base units, not necessarily the source's written unit.
Missing/unresolved quantities are not zero; inspect diagnostics and projection status.
`numericEdit` bounds are software limits, not physical-validity constraints.

Request result status is separate from a derived projection: `ready` means no matching checked
receipt, `current` means a matching successful receipt, and other statuses are `pending`,
`failed`, and `blocked`. Available receipt summaries include the evidence ID, execution key,
outcome, and physical validity. Projection provenance remains available for inspection; raw
persistent document collections and receipt context maps are deliberately not exposed.

### Compact discovery and focused details

Discovery remains **full by default**, preserving existing protocol-1 responses. Opt into
`--compact` on `inspect`, `worksheet`, `models` or `model`. Compact responses are marked
`view: "compact"`; they are additive views, not a silent change to the full contract.
`capabilities.discovery` advertises supported views and the default.

Compact output retains document IDs for guarded editing, region IDs/source/classification,
editable flags, derived values/units, diagnostics, constraints, model input IDs/declared units,
defaults/bindings/edit bounds, output values and computation statuses. Available receipt
summaries retain IDs, outcomes and physical-validity markers. Unresolved projections retain
status/reason; quantities remain null when unavailable. Reads never compute or mutate.

Compact worksheet quantities omit dimension vectors and positions; constraints have `pass`,
`bound` and `unit` (null if unavailable), not the expression tree. Compact model projections
use `{ status: "resolved", type: "scalar", value, unit }` for scalars, rather than the full
projection/provenance object. Other resolved projection types retain their JSON value.
Request references, revision/definition IDs, dependencies and receipt keys are omitted;
input bindings remain explicit and may contain qualified references. Receipt outcomes retain
meaning and may still contain structured output. Compact is not pagination or a byte cap.

For full selectors, provenance, dimensions or receipt keys, omit `--compact`. Focus detail
with `model FILE --model ID` or `worksheet FILE --region ID`. The region filter returns the
usual worksheet envelope with a single region and rejects an unknown ID as `ITEM_NOT_FOUND`.
Compact requests retain their opaque ID, which the CLI accepts as `compute --request ID`;
TypeScript callers can use `workspace.reference(request.id)` before `compute`.

## Atomic edits

Payloads contain `expectedDocumentId` and an `edits` array. Obtain the schema with
`capabilities` and see the [agent guide](../guides/agents.md#2-submit-a-bounded-candidate)
for an example. Each edit has an `operation` and its fields:

| Operation | Required fields | Optional fields |
| --- | --- | --- |
| `createEquation`, `createNote` | `text` | `as`, `at` |
| `updateEquation`, `updateNote` | `region`, `text` | None |
| `createModel` | `family` | `as` |
| `setModelInput` | `model`, `input`, `value` | None |

`at` has finite canvas coordinates `{ x, y }`. Text must be nonempty and within 5,000
characters. Literal model inputs must be finite and within ±1e12, in the declared input
unit. The [worksheet authoring contract](headless-api.md#worksheet-authoring-and-transactions)
defines draft handling and note/equation classification. Unknown fields and operations reject
rather than being silently ignored.

Creation's optional `as` names match `[A-Za-z][A-Za-z0-9_-]*`, are unique within the batch,
and are returned as an `aliases` object mapping names to accepted IDs. `$name` in a subsequent
`region` or `model` field refers to that creation. Forward, unknown and cross-batch aliases
reject. Use returned IDs in later invocations. A batch has at most 1,000 operations.

All edits publish through one existing headless transaction: one accepted root and one
in-process Undo step. Any rejected operation aborts the entire batch. Stale document IDs
reject before edits. A successful edit may retain incomplete/unresolved source as a draft,
just as the canvas does; editing success does not mean the mathematics is valid.

## Comparison and validation

`diff` compares public semantic snapshots: changed source, positions, quantities, constraints,
input bindings/defaults, output values, and request outcome/currency. It ignores revision-only
projection provenance and object key order. It is not an exhaustive native-archive diff: ink,
datasets, analysis definitions, and other undiscovered schemas are outside this initial report.
`sameDocument` indicates whether the files share a stable document identity; unrelated files
can be compared, but their IDs should not be interpreted as corresponding entities.

`validate` means the file has passed native admission and reports content issues. `admitted`
is distinct from `clean`. Clean requires no worksheet diagnostics, failed constraints,
unresolved model inputs, or non-current discoverable computation requests. An uncomputed
model is therefore admitted but not clean. Without `--strict`, issues are a successful report;
with it, issues cause exit 3. An invalid file fails admission instead. Validation is not a
physical-safety assessment, exhaustive validation of every schema, or an instruction to compute.

## Computation

`--timeout-ms` is an integer from 1 to 2147483647; its default is 60000.

Only `compute` starts a job. It selects a discovered scalar model request and uses the installed
native methods. Sampling/network executors and arbitrary code execution are not available in
this CLI. The default timeout is 60 seconds; SIGINT/SIGTERM request cancellation. Timeout or
interruption during execution does not publish an output. Deadlines use timers and a
monotonic completion check; synchronous native work cannot be preempted mid-call, but an
over-deadline result is not published. Use an external process limit when a hard wall-clock
termination boundary is required. In-process cancellation is advisory, so hosts must not
equate requesting cancellation with successful numerical execution.

A retained receipt can contain a failed outcome. The CLI checks both completion status and
receipt outcome before reporting exit 0. A completed non-successful computation exits 4 and
still saves the candidate archive when export succeeds, preserving available failure evidence.
Receipts do not certify physical validity. Reopen the returned native file in the canvas for
review and visual explanation; no live browser tab is automatically updated.

## File safety and errors

- Output paths must not exist, including symlinks. There is no `--force` or in-place mode.
- Complete bytes are written to a private temporary file, synced, and published via an
  exclusive hard link in the destination directory. Failed publication never replaces a target.
  The destination filesystem must support hard links; directory creation belongs to the caller.
- Before publication, input archive/edit-file bytes are reread; a detected change rejects as
  `STALE_FILE`. This is not a cross-process file lock or a guarantee that inputs remain unchanged
  afterward. Keeping candidates separate avoids losing other writers' work.
- Read-only operations and edits never implicitly execute. Opening/importing never runs code
  from a file. No automatic network connection, local browser storage, or background service.
- Errors expose [stable headless codes](headless-api.md#discovery-and-errors) or CLI codes (`INVALID_ARGUMENT`, `INVALID_JSON`,
  `OUTPUT_EXISTS`, `STALE_FILE`, `FILE_TOO_LARGE`, `TIMEOUT`, `INTERRUPTED`); filesystem errors retain Node's code.
  Use codes/statuses, not English message matching. On stale work, reinspect and review rather
  than blindly replaying an edit against the new revision.
- Workspace and edit-batch input reads are capped at 128 MiB, including growth after the
  initial size check. `FILE_TOO_LARGE` exits 2; an oversized input during publication's
  stale-input recheck reports `STALE_FILE` instead. See the [file format reference](manifold-format.md).

| Exit | Meaning |
| --- | --- |
| 0 | Successful operation/report; inspect reported statuses. |
| 2 | Invalid arguments, JSON payload, workspace, or rejected domain operation. |
| 3 | `validate --strict` found issues. |
| 4 | Computation did not retain a successful outcome. |
| 5 | Filesystem/publication failure. |
| 6 | Stale document or detected input-file change. |
| 124 | Computation timeout; no output published. |
| 130 | Interrupted operation; no output published before the publication boundary. |

## TypeScript and verification

The transport-free helpers behind this CLI are documented in the
[headless and agent API reference](headless-api.md#agent-json-helpers).
For focused contract tests and broader repository checks, see the
[development guide](../development/README.md#checks).
