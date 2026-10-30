# 0024: Canvas workspace lifecycle and typed commands

Status: Accepted for the existing canvas; shared execution/model adoption remains open.
Date: 2026-10-27
Related: Migration goal (internal design note),
[application interfaces](../application-interfaces.md), [ADR 0016](0016-coherent-canvas-incremental-storage.md).

## Context and options

The canvas already shares discovery across toolbar, context menu, marking and search.
Its requests still allowed arbitrary operations with unrelated optional payload fields.
Save/Open/New/Export coordination and repeated Undo transitions lived inside React.
Two older Web Storage write helpers survived only for tests after IndexedDB adoption.

Keeping callbacks would preserve ambiguous lifecycle ownership. A new generic runtime
or independent store would duplicate tested state. Instead, wrap the existing owner and
incremental store with the application-specific interface needed by the current canvas.

## Decision

`CommandRequest` is a closed discriminated union. Plot/computation requests require input
and output identities; opening a plot or data relationship requires its view identity.
Discovery may have incomplete parameters; it cannot emit an executable request until
those parameters exist. Dispatch is exhaustive. Compile-only negative witnesses run in
the normal app type/build checks. One Undo function has explicit workspace, artifact and
inline-recovery modes, preserving preview cancellation and deliberate buffer cleanup.

`canvasWorkspace` in [workspaceFiles.ts](../../../apps/canvas/src/regions/app/workspaceFiles.ts)
coordinates Save, file staging, New and Export over one `RegionSession` and store. React
owns unaccepted buffers, reports status, downloads export bytes and follows a successful
navigation result. It supplies read/finish/settle edit-buffer ports; it does not restore
accepted state independently. The facade coalesces saves, recaptures stale acknowledgements,
and caps a flush at eight stale passes. Failure leaves work exportable and allows Retry.

Open validates into an isolated workspace before storage effects, saves the current owner,
and writes a fresh destination using the existing atomic bundle/CAS protocol. It checks
authored selection, evidence version and buffer identity across asynchronous boundaries.
Changes cancel navigation. Failed unpublished destinations are closed and best-effort
discarded; occupied destinations are preserved. Concurrent Open/New/Export transitions
reject. Export is available when local storage fails. Loaded code remains paused.

Remove `persistWorkspace` and `storeOpenedWorkspace`; tests now exercise incremental
storage. Replace file reserialization/reparse with a single staged owner. No native schema,
durable ownership, storage engine or visual design change is introduced.

## Evidence and limits

[Lifecycle checks](../../../apps/canvas/tests/check-workspace-lifecycle.mjs) cover coalesced
saves, refused commits, serialization/save failures, Retry/export, slow reads, concurrent
transitions, late draft/evidence changes, occupied destinations and bounded stale retries.
The 24 local checks, six negative command compiler witnesses and 15 actual Chrome workflows
pass, including source-backed computation, native handoff and interrupted storage. Five
server tests and the existing foundation gates pass. Source-identified reports and net
production counts are in the parent brief (internal design note).

This is an app facade, not the entire proposed SDK. Calculation scheduling remains React
driven and checked results retain their existing adapter. Model scopes still use global
worksheet symbols. Other editing/preview transitions and affected-record commands remain
migration work. Code extraction is not claimed as a net production LOC reduction.
