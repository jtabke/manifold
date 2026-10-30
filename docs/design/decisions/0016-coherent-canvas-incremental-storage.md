# 0016: Coherent canvas incremental storage

**Status:** Accepted for the private canvas full-reader storage integration; semantic retention, partial readers, general execution and production capacity excluded.  
**Retention successor:** [ADR 0017](0017-canvas-retention-and-storage-cleanup.md) now integrates protected app retention and cleanup UI; original storage acceptance and exclusions below remain historical.  
**Date:** 2026-10-26.  
**Related:** Storage brief (internal design note), [ADR 0015](0015-unified-canvas-operations.md),
[recovery](0012-validated-local-recovery-continuity.md), [reclamation](0013-coordinated-storage-reclamation.md),
[QS5/QS9](../quality-and-risks.md#quality-scenarios).

## Context and options

The accepted owner captures an authored foundation root and a separate immutable checked-result
map. The previous synchronous localStorage path serialized the entire native document and lacked
an atomic multi-tab generation check. Saving only the library root would lose the application's
sequence results; forcing those results into scalar receipts would misrepresent their meaning.

Options were full native JSON in IndexedDB, separate authored/result databases, a broader typed
execution redesign, or a composite physical graph over the existing storage protocol. Full JSON
retains unrelated source work; separate transactions cannot publish both states atomically. A
broader execution redesign is useful later but is not needed to make this boundary coherent.

## Decision

Use one content-addressed graph and one atomic generation-CAS head per canvas URL namespace.
A versioned application bundle points to the foundation snapshot and the checked-result map.
The kernel understands only generic bundle roots and physical edges; it imports no app schemas.
Shared record readers/writers enforce hashes, explicit physical edges, map shape and budgets.
Native V3 transport stays independent, with V1/V2 reads unchanged.

Only owner-sealed immutable captures may Save. The serialized writer queue keeps its validated
expected generation. The existing core transaction stages both graphs and publishes the bundle
head atomically. Caches become reusable only after commit. An acknowledgement must match the
captured authored root, result version and destination. Failure or a losing tab keeps in-memory
work unsaved and exportable; Retry never silently adopts a foreign generation.

Opening captures a coherent bounded graph snapshot, verifies both roots and validates all
retained foundation records and app data before mounting editors. Validated recovery retains the
original core `Loaded` value and verified result-map shape. Owner adoption still validates meaning;
layout hints only wrap those validated values. Read-only recovery acknowledges the existing save
without writing a head. A following unchanged Save plans two headers and writes zero payloads.

Bootstrap prefers the primary IndexedDB head. A first migration validates an older native
localStorage value and leaves its raw bytes intact. Corrupt primary data never falls back. A tiny
best-effort localStorage marker also prevents missing/unavailable primary storage from silently
adopting that older backup. This marker is not an authoritative second store and is not atomic
with IndexedDB: complete database loss cannot always be detected if marker storage also failed.
Unavailable I/O permits in-memory work and export, with an explicit unsaved error.

UI saves coalesce to the latest immutable capture. New/Open flush current accepted work first.
File Open validates and saves into a fresh unpublished namespace, then checks for intervening
work/drafts before navigating. Failed/cancelled staging removes only its own fresh destination.
Loaded code remains paused. Reconnect may bind an empty store but cannot overwrite an existing
saved head with the current in-memory document.

New content IDs use UUIDs so separately edited portable copies do not allocate the same serial
IDs. Existing IDs remain unchanged. This enables identity-safe future composition; it is not a
merge algorithm. Optional browser attention v2 binds to document UUID instead of property order;
guarded v1 reads remain. Camera/title/tool arrangements remain outside native work.

## Costs and bounds

Application domain validation runs before publication, so accepted state can reopen. Immutable
CSV shape/cell caches avoid reparsing unchanged data during that validation. The local save
budget caches folds over immutable map paths and byte sizes of immutable values. It conservatively
bounds reachable payloads at 64 MiB before I/O, using actual key/value bytes plus per-node/header
allowances; shared values may be counted more than once. This can reject before actual storage
reaches 64 MiB. The independent native-file size guard remains. Neither is a product capacity claim.

Normal edits/views hash changed branches instead of the full native file, including after reload.
Initial materialization, complete recovery and native import/export remain full work. The legacy
checked receipt still embeds full Page definitions, including inline CSVs: a new result can copy
large source data even though ordinary math/layout saves reuse it. The scalar execution API is
unchanged; storing checked sampler output coherently does not turn it into a typed execution audit.

The adapter exposes validated physical inspection/reclamation using the existing epoch/revision
protocol. Semantic app retention and cleanup UI are not integrated. Retired IDs, revision payloads
and observations for removed artifacts still grow. Partial/lazy readers need protected roots or
leases before sharing this full-reader guarantee. No live merge or hardware power-loss guarantee
is established.

## Validation and review

The brief (internal design note) links the local fault/concurrency checks,
real IndexedDB browser workflow, native handoff and measured costs. All 20 canvas local checks,
12 browser workflows, 5 server tests, 84 core tests and 25 foundation browser groups pass, including
the existing original F1–F3 gates. The current storage workflow additionally checks marked missing
and unavailable primary stores. Source-identified reports distinguish memory-backend Save costs
from actual IndexedDB correctness checks.

Accept this bounded integration. Revisit when typed execution replaces legacy receipt snapshots,
app retention is integrated, partial readers appear, or a measured product budget contradicts the
full-reader choice. This supersedes only ADR 0015's synchronous localStorage implementation and
its pending incremental-save boundary; authored/result ownership and native semantics remain.
