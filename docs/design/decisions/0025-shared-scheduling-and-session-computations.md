# 0025: Shared scheduling and session-owned computations

Status: Accepted for scalar scheduling and the existing canvas sampler. Generic typed
receipts and independent canvas model scopes remain open.
Date: 2026-10-27
Related: Migration brief (internal design note),
[application interfaces](../application-interfaces.md), [ADR 0022](0022-application-ports-over-revision-kernel.md).

## Context and options

The canvas provider and individual artifact views each carried execution/caching paths.
React effects controlled fetches, cancellation and result status; the foundation scalar
owner implemented separate admission. Checked output was validated in React and again
at the owner. Prepared sampler jobs also carried whole-Page legacy compatibility data.

Keeping these paths leaves execution lifetime tied to representations. Promoting the entire
isolated vector runtime would introduce unproved production format/ownership changes. Share
the existing admission protocol and move the current sampler behind a session port first.

## Decision

`createTaskScheduler` in [tasks.ts](../../../packages/foundation/src/tasks.ts) owns transient
admission only. Defaults are four running, 32 waiting and a 30-second advisory deadline;
total admitted work is at most 36. Task completion waits for the actual adapter settlement.
Queued cancellation never invokes its adapter; cancelled running work retains its slot.
Deadlines request abort, not process termination. The scheduler retains no completed-task
history. Trusted adapters freeze input and validate output through their application owner.

Scalar workspaces use this scheduler with their existing `maxJobs` and zero waiting by
default. Hosts can supply one shared scheduler. Per-owner admission limits and binding guards
remain; Open cancels that owner's jobs without cancelling other owners or disposing a shared host.

The canvas session owns one [computation service](../../../apps/canvas/src/regions/artifactComputations.ts).
Renderers read/subscribe and request Run; they cannot fetch, validate output, admit evidence or
own result caches. Context demand is a presentation hint, not another accepted selection.
The service survives individual editor/representation mounts; Strict Mode reattachment reuses
it, and actual host disposal cancels its tasks. Loaded artifact IDs remain paused until Run.
Missing executors leave source/content inspectable and execution explicitly unavailable.

Executors receive an immutable compact actual-input capture, capped at 128 KiB. Whole-Page
legacy data stays at the receipt-validation boundary. The Python transport sends only code
and scalar inputs, bounds request/streamed response bytes at 64 KiB, and uses at most one
64 KiB response buffer per running request. Assets/source files do not become transport payload.

`RegionSession.completeArtifactResult` is the shared admission port for transport output,
cached reuse and existing receipts. It owns SHA-256, current input/source/context checks,
independent numerical validation and immutable checked publication. It rechecks cancellation
and current meaning after hashing. Current-context publication advances checked evidence
outside authored Undo; inactive contexts can retain transient verified comparisons. Imported
receipt verification does not append evidence or execute code. New owner observations take
precedence over older cached output, including equal-key observations with a new publication.

The temporary cache is bounded to 192 entries / 8 MiB and twelve per artifact. Cache eviction
does not delete retained results. These are logical payload limits, not measured process heap.
Native V1–V5, local bundles and durable owners remain unchanged. No experiment runtime is imported.

## Retired paths and consequences

Remove `useArtifactResult`, per-view result caches/executors, React fetch/hash/numeric checks,
provider-owned result maps and renderer admission callbacks. React now supplies small
subscription/context-demand bindings. Source preparation still adapts legacy Pages and scans
them; the semantic model and native container are not generalized by this change. More explicit
bounds and ownership can increase LOC; production deltas remain measured, not inferred from
the smaller React file.

## Validation

Eight [scheduler tests](../../../packages/foundation/test/tasks.test.mjs) cover shared admission,
FIFO, queue/cancel/deadline behavior, throwing adapters, disposal and independent scalar owners.
[Session contract checks](../../../apps/canvas/tests/check-artifact-computations.mjs) cover pure
multi-representation reads, frozen captures, pause/recovery, checked arrival without an executor,
newer observations, relevant/unrelated edits, same-valued source revisions, contexts, invalid
output, cache/capture/transport limits, Undo reuse and disposal. Five additional compiler
witnesses exclude mutable captures/payloads, legacy capabilities and renderer-asserted currency.

The execution diagnostic (local-only report) measures
1/8/16 distinct 201-point requests sharing one 940,010-byte CSV. Three presentation readers per
request submit no jobs; unrelated authoring submits none; a same-valued source revision resubmits
affected requests. Concurrency, admission and cache/source-sharing limits join the source-identified
cost audit. Rendering, network/IndexedDB latency, process heap and product capacity remain excluded.
The parent brief (internal design note) records current complete regression
results and remaining goal gates; do not infer broad SDK or model-scope completion from this slice.
