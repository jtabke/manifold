# 0013: Coordinated snapshots and reviewed storage reclamation

**Status:** Accepted for foundation 0.5 library/workbench and fully materialized local reads; existing-canvas migration excluded.  
**Date:** 2026-10-26.  
**Related:** Storage brief (internal design note), evidence (local-only report),
[ADR 0012](0012-validated-local-recovery-continuity.md), [portable work](../portability.md).

## Context and options

Semantic retention removes unused payloads from current work and native exports, but old local
roots and failed legacy staging retain physical records. Deleting those without coordination
could interrupt a reader, invalidate a saved-layout hint or make a cached Save reference missing
chunks. Root generation alone does not detect orphan staging or cleanup that leaves the root intact.

Options were retaining every generation, persistent reader/writer leases with crash recovery,
or atomic read snapshots plus epoch-guarded publication. Choose snapshots for the current full
reader: it already materializes the complete supported package. Persistent leases would add
heartbeat/expiry and abandoned-reader policy without enabling partial reads in this slice.

## Decision

Read the head and its explicit package/asset closure in one bounded readonly transaction over
all three stores. Copy only immutable required strings, then perform hashes, native/domain
validation and owner adoption outside that transaction. A subsequent writer or collector cannot
invalidate those captured bytes; slow crypto/domain work does not hold the database transaction.
No durable lease survives a tab closing. Legacy envelopes use the same coordinated snapshot path.

An explicit inspection captures the current closure and inventory in one readonly transaction.
The service validates the complete current package before issuing a sealed review. A successful
reclamation transaction checks the exact head, storage epoch and mutation revision against that
review, then removes only records outside the captured durable-root closure. Any intervening
publication or new legacy staging invalidates the review, even when head generation is unchanged.
Forged, cross-instance and consumed reviews reject. A transaction failure deletes nothing.

Reclamation leaves authored root, evidence, binding and durable head/generation unchanged. It
never performs semantic pruning or silently saves current work. Apply semantic retention and
Save first to make its older payloads eligible. With no durable head, unreferenced staged records
can be removed. Empty cleanup consumes its review without changing clocks.

Deletion advances the storage epoch and mutation revision. Encoder reuse is scoped to an epoch,
including verified layouts waiting for owner adoption. Save reads the epoch before planning and
checks it again in the publication transaction. An epoch-only conflict rebuilds the same captured
Save once; a second conflict fails explicitly. Durable-generation conflicts still reject and
never silently merge/overwrite another writer. Legacy staging has no cache and its publication
checks required records, so deletion of an unpublished manifest produces a safe failed Save.

Upgrade IndexedDB to protocol version 2 without changing native v2 or local chunk v1 encodings.
Existing stores/data remain intact; absent clocks initialize at zero. Older library connections
close on version change; older-version opens reject. A blocked upgrade reports an actionable
error and closes its eventual unclaimed connection. All writers in a reclaiming namespace must
participate in this protocol; arbitrary direct database mutations are not coordinated writers.

## Consequences and bounds

Obsolete generations and staged payloads can actually leave the database. Latest saved meaning,
explicit comparisons/citations, in-memory Undo and already captured reads remain usable. Open
work owns verified source strings; it can restage an older selection after cleanup subject to
normal generation/conflict rules. Future lazy/range providers need an explicit protected-root
or lease contract before claiming the same guarantee.

Cleanup is full maintenance work over inventory plus current-root validation. Default inspection
guards are 512 MiB of serialized stored payloads and one million records; full snapshots retain
the existing reader bounds. These are configurable rejection guards, not supported capacities.
Counts exclude database keys/index overhead and OS disk allocation. The first Save after an
epoch change replans once; unchanged current work writes zero new payloads, then hot reuse resumes.
Retired identity markers remain deliberately retained. No automatic/scheduled collector runs.

## Validation and review

Fourteen added core checks cover exact physical reductions, source/alternative/citation closure,
held reads, pending layout adoption, bounded Save retry/exhaustion, stale and forged reviews,
rollback, legacy publication, empty stores, inspection budgets, corrupt current roots, opaque
preservation, saved acknowledgement and actual Undo of historical source selections after cleanup.

Chrome exercises reviewed cleanup, two independent connections with a held reader and Save,
cleanup transaction abort, and v1 upgrade/blocked-old-client behavior. Source-identified reports (local-only report)
measure attempts and source histories before/after actual deletion. Accept this bounded protocol;
revisit if partial reading, a different backend, transaction duration or product budgets change
its materialization assumptions. Canvas adoption and F6 composition remain separate work.
