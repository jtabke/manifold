# 0014: Canvas document owner and native handoff

**Status:** Accepted for the private canvas Page/history/native adoption; artifact/result ownership extended by [ADR 0015](0015-unified-canvas-operations.md); storage implementation superseded by [ADR 0016](0016-coherent-canvas-incremental-storage.md); its original gate is retained below.  
**Date:** 2026-10-26.  
**Related:** Adoption brief (internal design note),
[ADR 0009](0009-reusable-foundation-and-frozen-alternatives.md),
[operation ownership](0003-workspace-operation-ownership.md),
[portability](../portability.md), Keep/Undo (internal design note).

## Context

The current authoring UI uses native Page records with broad global-name/context semantics.
Keeping a mutable Page beside a foundation document would produce competing authority and Undo.
Replacing all content, execution and storage semantics together would prevent a narrow migration
from establishing which behavior changed. Work must also be transferable without executing
Python from someone else's file.

## Options

1. Retain the prototype owner and use foundation only as an export wrapper. Lowest migration
   effort; it does not exercise ownership or remove duplicate immutable-history costs.
2. Normalize existing native records into foundation schemas, derive Page for current consumers
   and migrate one accepted owner/history path. Preserve legacy semantics explicitly.
3. Rewrite the full app ontology, artifact execution and storage together. Potentially cleaner
   final model, but it couples unproved semantic choices to a large compatibility migration.

## Decision

Implement option 2 for accepted Page/history, with versioned metadata/native-record schemas.
References conservatively declare the entire current legacy Page scope. Keep actual region
placement and placement mode in views. Unused cursors remain ephemeral. Domain commands validate
candidate Pages, then submit one accepted operation; consumers receive frozen derived Pages.

Add an explicit core `restore` command that selects a retained revision for an inactive known
item. It allocates no identity or revision, requires the correct retained lineage and leaves
creation with retired IDs forbidden. Restore after Undo uses this operation instead of pretending
to create a new identity. Rejected compound operations publish nothing.

Write application native V2 files containing a standard foundation envelope and legacy artifacts;
read V1 through the same legacy validation and canonicalize into one owner. Export current heads
and ID ledgers, not session history. Open under a fresh URL only after validated staging and
preserving current work. Keep localStorage for this slice. Do not imply IndexedDB/CAS adoption.

Loaded code starts paused. Verify retained results purely as data; otherwise require explicit
Run. The same rule applies to reload of saved work. Newly created artifacts retain the existing
interactive execution behavior; explicit Run enables that artifact during the current session.

## Consequences

Stable identity, revision sharing, Undo and file handoff now support the real canvas without
changing its math model. Frozen compatibility projections remove the second accepted Page.
The core stays independent of React, application modules and experiments.

The bridge still has global scans, candidate copies, inline CSVs and full synchronous archive
validation/writes. It preserves prototype bounds. Layout stored inside other legacy records
is not fully normalized. Undo is bounded but in-memory revision compaction remains separate.
React artifacts, callback-based comparison restoration and navigation preferences remain outside
this Page owner. File export does not yet include the full browser arrangement. These are
explicit follow-up boundaries, not completed architecture gates.

## Validation and review

Use the linked brief's local/core/Chrome checks, old-format migration, native download into a
fresh browser, no-execution request counts and held-read/quota failures. Run all existing canvas
browser workflows and foundation F1–F5 regression gates. Reconsider this bridge if compatibility
requires a second accepted owner, silent meaning changes or unbounded per-view source copying.
2026-10-26 review: accept within the linked brief’s scope. All 18 local and 10 Chrome canvas
checks pass, along with 83 core tests, 25 foundation browser groups and prior foundation gates.
The brief records source identity, measurements, exclusions and the remaining K1–K5/F5/F6 work.

## Subsequent extension

[ADR 0015](0015-unified-canvas-operations.md) now replaces the separate React artifact authority
with artifact records/views, checked result state and one accepted operation/save capture. Its
native V3 writer preserves reads of this slice's V1/V2 files. The limitations above describe
the original bounded adoption; current evidence and remaining gates live in its successor brief.
