# 0017: Canvas retention and storage cleanup

**Status:** Accepted for canvas semantic retention and reviewed full-reader storage cleanup; general evidence/citation policy and partial readers excluded.  
**Source-evidence successor:** [ADR 0018](0018-computation-snapshots-and-pinned-source-evidence.md) adds pinned historical source roots and compact result snapshots.  
**Date:** 2026-10-26.  
**Related:** Canvas retention brief (internal design note), [ADR 0010](0010-retention-and-durable-identities.md),
[ADR 0013](0013-coordinated-storage-reclamation.md), [ADR 0016](0016-coherent-canvas-incremental-storage.md).

## Context and options

Incremental saves preserve old revision payloads and observations for removed artifacts. The
canvas's checked sequence results are separate from scalar receipts, so applying core retention
alone leaves those app payloads unbounded. Deleting every inactive artifact result would break
Undo. Deleting database records based only on in-memory reachability could damage the saved head.

Options were automatic age/count eviction, a new app-specific retention traversal, or extending
the existing reviewable core closure at the app boundary. Age/count eviction does not establish
which meaning is protected. A second traversal risks drifting from core history policy. Reuse the
core's closure and add the result-map rule, then reclaim physical bytes in a separate review.

## Decision

The canvas owner asks its core workspace for a sealed compaction review preserving all core
evidence. Current items/views, alternatives, retained Undo selections and core active captures
protect their revisions. For this compatibility adapter, preserve a checked result if any protected
`canvas-artifact@1` revision belongs to its artifact. This includes deleted artifacts that Undo can
restore. A result carries its own historical definitions and is never reconstructed using current
inputs. Legacy Page contexts remain in protected authored metadata; no new frozen-context claim
follows from cleanup.

An app history review exposes before/after revision/result counts and protected Undo count. Its
private state holds the core review, exact document/result version and candidate result map.
Apply rejects stale/foreign/forged/reused reviews, preflights app clock exhaustion, calls guarded
core compaction and installs the result map synchronously. RegionSession publishes once after both
states are installed. Cleanup advances root/evidence, preserves durable identity ledgers and does
not push or pop authored Undo. Core validation failures leave the app state unchanged.

A separate saved-storage review requires acknowledged current work, a validated durable graph,
the same root/generation and an unchanged owner capture after asynchronous inspection. The app
seals that review to the session/store/capture; apply rechecks the capture. The backend's atomic
head/epoch/revision check rejects concurrent durable changes. Held complete readers own their
snapshot bytes and pending Saves replan after an epoch change under the existing protocol.

Expose both steps through **Review workspace cleanup**. The modal shows protected work, removal
counts and explicit apply actions. Cancel writes nothing. Cleaning history is followed by Save;
failure leaves cleaned memory usable/unsaved and provides no physical deletion review. The user
can retry Save and obtain a fresh storage review. Physical deletion is a separate explicit action
showing exact serialized byte/record counts, with honest disk-overhead exclusions. Modal focus,
Escape, scrolling and stale-review feedback keep this maintenance flow separate from editing.

## Consequences and limits

Sustained editing can prune revisions outside retained Undo, and old artifact observations stop
living forever after their artifact leaves that closure. The graph can then drop older saved
copies without changing current saved meaning. Native identity ledgers survive both operations,
so deleted payloads cannot acquire new meanings after file handoff. Native files still omit
session Undo; local cleanup preserves the current session's retained Undo.

Maintenance performs full closure/inventory work outside ordinary edits. Lifetime identity
markers, retained Undo and caller-held immutable captures continue consuming space. Session-only
scalar calculation history is preserved; this slice does not add bookmarks/citation policy for
that separate legacy list. Legacy receipts still duplicate Page/CSV data. No automatic eviction,
partial-reader leases, power-loss guarantee or production capacity budget is introduced. The
library/core storage format and scalar execution contract are unchanged.

## Validation and review

The brief (internal design note) records current local/browser checks and measurements.
Acceptance requires historical result/Undo preservation, stale/foreign review rejection, retired
identity continuity, Save failure before deletion, transactional reclamation rollback, validated
reopen, competing-tab guards and explicit UI review. Raw reports distinguish semantic reduction,
physical reduction and memory-oracle timings; they do not measure browser disk space or heap.

2026-10-26 review: the brief's full gate passes, including 21 local app checks, 13 Chrome workflows,
5 server tests and 84 core tests. Library/runtime source is unchanged and retains the current
25-group workbench browser evidence. Accept this boundary; richer evidence/source representation,
session-history policy and F6 composition remain separate.
