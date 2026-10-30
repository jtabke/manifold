# 0012: Validated local recovery preserves storage continuity

**Status:** Accepted for foundation 0.4 library/workbench; reclamation and existing-canvas migration excluded.  
**Date:** 2026-10-26.  
**Related:** Storage brief (internal design note), evidence (local-only report),
[ADR 0011](0011-incremental-local-snapshots.md), [portable work](../portability.md).

[ADR 0013](0013-coordinated-storage-reclamation.md) subsequently adds coordinated full-read
reclamation and epoch-scoped reuse. The deletion limitation below records this original decision.

## Context and options

Incremental hot saves passed their bounded gate, but full Open rebuilt physical map/object
identity. A view change after reopening could plan every local chunk and rewrite differently
shaped trees. Native transport correctly excludes physical tree nodes; adding them to native
files would couple portable work to local storage. Skipping owner validation for a supplied
`Loaded` value would weaken an existing public boundary.

Options were retaining the cold cost, making all local trees canonical and replanning their
content, or restoring verified local layout around freshly validated values. Choose the last
option: the reader already traverses the complete stored graph, so it can retain the required
layout without a second writable domain model or a native-format change.

## Decision

Keep full document and receipt validation on both workspace creation and owner Open. An
internal weak registry associates the exact, immutable `Loaded` value from a successful local
read with its verified physical layout. After normal validation, reconstruct maps using only
the candidate's validated values. Reject changed/missing/duplicate/unordered keys and non-AVL
layouts; preserve immutable value identity while arranging private physical branches.

Restore selected maps, durable identity ledgers, alternative/receipt contexts and receipt
repositories. Populate weak storage memoization only after the reconstruction succeeds, scoped
to the storage instance that performed the read. A different destination must stage its own
complete closure. Copied `Loaded` objects do not carry the hint; they retain normal validation
and full first-save planning. Optional unknown content stays opaque and receives no layout
interpretation. No domain identity, selected revision or evidence key changes.

Owner Open takes an optional runtime resource port separately from `Loaded`. It validates the
loaded contract against its loaded resources, then installs the port atomically with adoption.
The workbench uses this for availability controls without copying away the verified layout
association. No execution starts on Open; an unavailable runtime port still blocks current
computation. Local save can reuse source bytes already verified in that destination.

Also propagate identity on no-op map sets: setting an existing key to its identical value
retains every ancestor. Updating an already allocated marker must not rebuild paths and force
storage planning to revisit unchanged branches.

## Consequences

The first unchanged Save after a fresh local read plans one existing root and writes no
chunks/assets. A subsequent view save follows the changed view path. Full graph verification,
native/domain validation and physical reconstruction remain Open work; evidence reports local
Reopen, owner adoption and the following Save separately. Initial storage amplification and
retained-generation growth remain visible costs.

Native v2 and local chunk v1 encodings remain unchanged. Older local envelopes still upgrade
through a full first save. The runtime imports only a small internal hint registry, not a
browser/database adapter. Immutable candidates remain distinct from accepted state; failed or
stale Open does not abort active jobs or replace the current root.

The reuse guarantee currently relies on immutable, undeleted committed chunks. Reclamation
still requires coordinated read snapshots or leases and encoder cache epochs. It must account
for verified layouts waiting for adoption and in-memory work based on an older durable root;
clearing one cache is insufficient.

## Validation and review

Ten new core checks cover alternate AVL shapes and exact values, no-op identity/allocation,
malformed layouts, fresh creation and owner Open, source/alternative/evidence closure, retired
IDs, copied/forged inputs, destination isolation, failed retry, optional schemas becoming unknown,
and availability-port adoption. Hash-valid malformed stored trees and receipt-map IDs reject.
Chrome verifies actual reload, unchanged first Save and a subsequent view Save.

The evidence (local-only report) reports these checks and 100/1,000/10,000-
definition recovery/write measurements. Accept the bounded continuity layer. Reconsider if
reconstruction changes meaning, bypasses validation, retains unbounded loader state, or a
new local encoding cannot preserve the same ownership/portability contracts.
