# 0028: Typed computations in the existing evidence owner

Status: Accepted for the foundation adapter; canvas sampler migration remains open.
Date: 2026-10-28
Related: Parent application goal (internal design note),
[normalized requests](0027-normalized-sampling-plans.md),
[application interfaces](../application-interfaces.md).

## Decision

An installed domain schema may project an ordinary record to `typed-request@1`: method requirements,
a typed compound JSON input and an expected output schema. The existing guarded projection reader
supplies the actual origin and transitive dependencies. The existing workspace `compute` captures
this invocation and dispatches either the retained scalar executor or a typed executor. Both use one
scheduler, receipt map/index, evidence sequence, owner binding, notification protocol and persistence
path. Results remain outside authored Undo. Preview and kept alternatives select the same contracts.
There is no new document collection or second typed coordinator.

A typed method declares exact input/output schema identities, synchronous validators, asset
enumeration and input/output byte limits. Domain code defines structured meaning (for example
vertex count, coordinate frame and unit) and independently checks output against captured input.
The kernel validates JSON, bounded metadata, declared resource descriptors and selection provenance;
it does not invent a universal geometry or engineering type system. Trusted installed methods are
application code, not a sandbox. Method/runtime/schema versions are explicit portable requirements.

The typed executor receives immutable metadata, an advisory abort signal and job-scoped resource I/O.
Reads are restricted to exact captured descriptors. Verified immutable full input strings are leased
before queuing, with a workspace-wide byte budget, and checked before executor invocation. Queued
cancellation releases its leases without execution. Running cancellation holds the slot and input
lease until actual settlement; expired I/O rejects further reads/writes. The host cannot forcibly
preempt an arbitrary synchronous JavaScript callback.

Output staging verifies complete size and SHA before admission. Installed validators check output
structure and content using only captured inputs and declared output bytes. Successful admission
merges verified output bytes against the provider at publication time. Failed, cancelled, closed or
old-binding work publishes no output resources. Managed outputs live in one persistent map, not one
provider chain per result; reviewed retention releases bytes after their last retained receipt.
A resource-replacement edit must carry the current evidence stamp and preserves managed outputs.

Active jobs retain only the closed context's revision payloads, rather than a complete source
Document. Compaction protects those selections. Reachable typed receipts compare frozen followed
heads against working selections without projecting content or invoking methods during maintenance.
Assets referenced only by retained receipts are traced through native files, local physical edges
and reclamation, including outputs that no authored record references.

Native v4 carries typed snapshots/receipts. Scalar writers retain v2/v3 shapes, including the existing
byte-stable fixture. V1–V3 remain readable. Typed receipt keys are derived from snapshots instead of
serialized a second time. Unknown methods preserve inspectable evidence; missing inputs/outputs
block currency or execution. Open never starts computation. Local storage links typed receipt assets
explicitly; validated recovery restores memoized layout so an unchanged Save writes zero new chunks.

## Removal and merge counterexamples

- Keeping scalar-only outputs cannot represent a checked set of vertices and its frame/unit/count.
  The geometry fixture executes alongside pressure calculations with one evidence order and Undo.
- Dropping schema/method versions or validators admits a wrong unit, shape or numerically wrong point
  array. Negative tests reject these even when bytes have a correct SHA.
- Unrestricted executor reads let undeclared descriptors influence a result. The resource port rejects
  even a changed media type for the same digest. Losing input leases breaks a held job when its linked
  provider disappears; the held-job witness still computes from its exact captured bytes.
- Admitting assets before output checks leaks bad/partial outputs. Invalid digests, missing staging,
  cancellation and stale bindings leave the original provider unchanged. Overlapping completions
  retain both outputs rather than replacing the provider captured by the earlier job.
- Tracing only authored assets loses receipt-only output bytes during handoff or cleanup. Native,
  fresh-process, incremental and Chrome/IndexedDB checks require those bytes after executor removal.
- Treating a live request revision as sufficient reachability keeps every obsolete parameter result.
  Reachable cleanup retains only the current frozen input selection when no Undo/alternative/citation
  protects older work, and releases its superseded output asset.
- A separate typed receipt store would require another save/recovery clock and ownership protocol.
  The retained union adapter extends the existing receipt path; it does not instantiate the isolated
  experiment's coordinator. A single compound domain value avoids adding kernel slot/array primitives.

## Bounds and remaining work

Typed value/capture metadata is at most 128 KiB each; provenance is bounded by the existing context
and 4,096 actual dependency origins. Each asset declaration/staging list has at most 64 entries.
Method resource limits are explicit and at most 64 MiB per direction. A workspace defaults to 64 MiB
of active input leases (configurable through 256 MiB), four jobs and 64 MiB of managed output bytes.
Full-reader string assets remain the supported implementation; binary/range streaming is not claimed.
Existing scalar limits and shared scheduler admission/deadlines remain in force.

The [typed fixture](../../../packages/foundation/test/typed-fixture.mjs),
[contract tests](../../../packages/foundation/test/typed-execution.test.mjs),
[Chrome probe](../../../packages/foundation/test/typed-browser-probe.mjs) and
[workload](../../../packages/foundation/test/typed-workload.mjs) are executable examples.
They are not evidence that the canvas sampler has migrated. That next step must remove its separate
result map/clock/storage root, migrate current and historical receipts at one compatibility boundary,
and preserve its existing numerical/source validation, UI, Keep/Undo and portable workflows.
Broader renderer/input/process-memory budgets, affected-record authoring, format retirement and the
other parent goal gates remain open. This prerequisite increases production LOC until overlapping
application paths are retired; it must not be reported as net simplification.
