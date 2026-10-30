# 0011: Incremental local snapshots independent of native files

**Status:** Accepted for foundation 0.3 library/workbench hot saves; cold-save optimization, reclamation and existing-canvas migration excluded.  
**Date:** 2026-10-26.  
**Related:** Storage brief (internal design note), evidence (local-only report),
[ADR 0010](0010-retention-and-durable-identities.md), [portable work](../portability.md).

[ADR 0012](0012-validated-local-recovery-continuity.md) subsequently closes the bounded
recovery-continuity gap. Cold-save consequences below record this original 0.3 decision.

## Context

Reviewable retention reduces unused payloads, but local Save still serializes and validates a
complete native package. An independent view movement should not re-encode unrelated content
or hash a large source again. The established shared maps already retain unchanged branches.

## Options

1. Continue full native envelopes for local saves. Simple and portable, with measured full
   metadata work on every Save and repeated source verification.
2. Persist a command/delta journal with periodic checkpoints. Small writes, but recovery must
   replay command/schema versions; checkpoint and replay bounds become a second lifecycle.
3. Persist content-addressed local map branches and payloads, with one atomic root publication.
   Reuse immutable branch identity for hot saves; retain native files as a separate transport.
   This adds a private local encoding and first-save overhead without command replay.

## Decision

Use option 3 in the library/workbench. `reader.capture()` produces a sealed immutable document,
receipt repository, resource port, stamp and opaque-original handle. Local Save accepts only
owner-produced captures with matching document/root/evidence/binding. Untrusted files still
pass full decode and owner Open validation; the fast path is not an import-validation bypass.

The encoder memoizes acknowledged shared-map nodes and immutable record/context/snapshot
objects through weak references. Only changed map paths and new values need encoding on a
warm Save. Physical chunk hashes are local addressing tokens, never domain IDs or native-file
requirements. Derived dependency/result indexes, jobs and Undo session history are excluded.

Assets are verified when first staged; acknowledged reuse preserves size consistency and does
not reread unchanged source bytes. New chunk payloads encode their typed outgoing links once.
A memory oracle and IndexedDB adapter atomically stage the batch, check new outgoing edges,
compare the durable generation and publish the root in the same transaction. Failure publishes
nothing and establishes no encoder reuse. Save acknowledgement still covers the captured root,
evidence and binding independently of newer accepted work.

Reopen verifies chunk hashes, shape, map ordering/depth, traversal/byte limits and asset bytes,
then uses native/domain validation before adoption. Existing legacy local envelopes remain
readable and upgrade on the next Save. Opaque optional content uses exact original-package
preservation; it never enters an interpreted graph encoding. Native v2 transport is unchanged.

## Consequences

Warm local edits follow shared paths, independent of unrelated definitions; view-only saves
leave revisions and sources untouched. An unchanged Save writes no chunks/assets while still
publishing a generation/acknowledgement. The first save remains full work and stores more bytes
than a flat native attachment. Chunk size, count and total retained bytes are measured explicitly.

Open currently rebuilds validated runtime maps/objects. The first Save after Open, or after
creating a new storage encoder, therefore replans full metadata and can rewrite differently
shaped map branches. This decision accepts measured hot-save behavior, not a claim that cold
saves are incremental. Preserve validated branch continuity or choose a canonical physical
encoding before closing that remaining cost.

Committed chunks/assets are immutable and no collector runs. New-edge existence checks rely
on that invariant; external corruption is detected on full Reopen. Old generations and failed
legacy staging can accumulate. A collector must coordinate readers, publication and encoder
cache epochs; clearing caches alone is not that protocol. Memory-oracle transactions clone
Maps for atomicity, so their commit timings are not IndexedDB latency evidence.

## Validation and review

Source-identified evidence (local-only report) covers thirteen added
core checks, Chrome changed-view/unchanged Save, two real connections racing, transaction faults,
late acknowledgement, exact opaque handling, legacy upgrade, corruption and no-execution handoff.
Workloads report preparation, new chunks/bytes, source reads and initial/reopen/cold costs at
100/1,000/10,000 definitions and receipt histories.

Accept this bounded package layer. Revisit the encoding if first-save amplification, cold
replanning, transaction length or retained-generation growth prevents the intended workloads.
No product capacity/latency budget, hardware power-loss guarantee or current-canvas migration
is inferred from these checks.
