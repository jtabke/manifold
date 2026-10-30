# 0003: One owner for accepted workspace operations

Status: Proposed  
Date: 2026-10-19  
Related: D1, D3–D5; QS1–QS5; R2; [operation trace](../operation-lifecycle.md);
[context proposal](0002-context-snapshots-and-result-currency.md)

## Context

`RegionSession` owns Page/history, React owns artifacts and exploration, and scene
and attention have separate persistence. Keeping an alternative stages the Page,
then updates artifact comparisons and supplies an Undo callback. This coordinates
the common path but does not define one publish/save boundary for all accepted
state. React batching alone is not a durable transaction contract.

## Options

| Option | Benefit | Cost / failure mode |
| --- | --- | --- |
| Keep component coordination and Undo callbacks | Least code movement | Each feature must maintain cross-owner consistency and recovery. |
| Central workspace operation owner with immutable snapshots | One validation, history and publication boundary | Requires staged migration and clear division of durable and transient state. |
| Event log and independently reduced stores | Strong audit/replay potential | Replay, event evolution and distributed coordination exceed present needs. |

## Decision

Propose one application-level workspace operation owner. It is a local module,
not a service. Domain parsing, resolution and validation remain independent of
React; views dispatch operations; adapters return data through the owner.

| State | Owner / persistence / Undo |
| --- | --- |
| Definitions, bindings, contexts, source manifests, instances | Accepted workspace snapshot; persisted; semantic operations are undoable. |
| Authored plots, artifact definitions/code, saved views, comparison pairs and arrangement | Same snapshot; persisted; restored with the operation that changes them. |
| Evaluation receipts | Immutable evidence store referenced from the snapshot when retained; receipt arrival does not create an authored Undo step. |
| Pending requests and recomputable caches | Execution runtime; reconstructible; never authority for current meaning. |
| Preview, gesture, editor buffer, menus and hover | Interaction session; ephemeral; cancel independently of accepted history. |
| Active context, camera, focus, selection and navigation history | Attention session; optional persistence by document ID; no semantic revision or authored Undo step. |
| Save status and last durable sequence | Persistence adapter reports to the owner; cannot be inferred from rendering success. |

A saved comparison explicitly pins both context revisions. The active context is
attention, but Keep alternative can include an attention hint to focus the new
context. Undo restores the accepted comparison and uses a validated focus hint;
ordinary later navigation is not blindly rolled back. If its context was removed,
attention falls back to a valid context. Persisted view selectors cannot dangle.

### Operation protocol

1. Receive an operation ID, expected workspace sequence, semantic base where
   applicable, and typed intent/targets. Repeated operation IDs do not apply twice
   within the retained session history.
2. Prepare a candidate from the latest accepted snapshot. Domain functions validate
   IDs, bindings, units, contexts and view references. Produce one next snapshot,
   history entry and execution effects. No external effects run during preparation.
3. Reject with a specific conflict or validation error if the base changed or an
   invariant fails. Authored incomplete equations may be accepted as explicit
   unresolved definitions; Accept/Keep exploration still requires its affected
   calculation to resolve. Preview never authorizes bypassing commit validation.
4. Publish the complete immutable snapshot once and advance the workspace sequence.
   Subscribers observe all affected durable state together. Only then schedule
   evaluation and persistence from that exact sequence.
5. Persist the validated versioned envelope. Report memory acceptance separately
   from save success. A storage failure leaves accepted work available, marks it
   unsaved and preserves the last durable snapshot for reopen/export/retry.

Serialize saves so an older completion cannot replace a newer durable sequence.
For the current local-storage adapter, write one envelope under one authoritative
key. A failed write retains the prior valid envelope; optional attention is outside
that transaction. A future multi-record store needs its own atomic commit mechanism.
Imported sources needed for accepted reproduction belong in that commit or must be
reported unavailable. Do not publish an archive that claims uncommitted blobs exist.

The first implementation assumes one writer. Include a base-sequence check and
stop silent overwrite when another tab changes the saved workspace. Multi-writer
merging needs a separate decision; a local operation owner alone does not solve it.

### Undo, asynchronous completion and recovery

Undo publishes a new sequence selecting retained prior semantic/context revisions
and restoring the operation's durable view changes. It never decrements the save
sequence or deletes receipts. Invalidate output associations against the restored
execution keys and reschedule as needed. Late completions pass the same currency
check as any other result. Undo while previewing cancels the preview first.

There is no rollback of an already executed external tool. Initial adapters may
compute or import only; irreversible external writes require their own effect and
compensation policy. Cancellation cannot promise that an external job stopped.

Unsupported or invalid imports fail in staging without replacing accepted or
persisted work. On reopen, validate the complete envelope before publication.
Corrupt optional attention may be discarded independently. A failed semantic load
must preserve the original stored bytes and expose recovery/export options.

## Consequences

One snapshot boundary makes history, archives and cross-feature edits reviewable.
It increases the size of the application operation contract and may retain more
history; use shared immutable records rather than copying large datasets per edit.
Event sourcing, durable Undo across restart and multi-user synchronization are
outside this proposal. Session Undo and durable accepted work remain distinct.

Migrate one operation first: Keep alternative, including artifact comparisons and
Undo. Preserve existing UI behavior while replacing callbacks with explicit state
changes. Then move other cross-owner operations. Do not combine this with reusable
models, a general executor or a broad component rewrite.

## Validation and review

Inject failures before publish, during serialization and at storage write; interrupt
between publication and save, then reopen. Compare document/context and comparison
state together, not only numeric answers. Test duplicate operation submission,
changed bases, late results after Undo and optional attention corruption.
Use the [bounded implementation gate](../operation-lifecycle.md#first-implementation-gate).

Review outcome: not yet accepted. Reconsider if one owner requires presentation
changes to invalidate engineering computation or cannot stage Keep/Undo without
React callbacks. No implementation or passing failure-injection evidence is claimed.
