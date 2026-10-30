# 0015: Unified canvas operations and checked artifact results

**Status:** Accepted for the bounded canvas operation/result integration; production storage, frozen canvas contexts and general execution excluded.  
**Storage successor:** [ADR 0016](0016-coherent-canvas-incremental-storage.md) supersedes the synchronous localStorage implementation below. Ownership, checked-result and native semantics remain accepted.  
**Date:** 2026-10-26.  
**Related:** Keep/Undo gate (internal design note),
[Page adoption](0014-canvas-document-owner-and-native-handoff.md),
[operation proposal](0003-workspace-operation-ownership.md),
storage (internal design note), [portability](../portability.md).

## Context and options

Page/history already use the foundation owner, but React-owned artifacts require callbacks to
restore comparison fields. A coherent file serialization does not make those separate publications
one operation. Sampler completion must also never replace a stale artifact definition or add an
Undo step. The existing Python sampler produces a sequence, while the reusable method/executor
contract currently supports typed scalars. Pretending that sequence is a scalar would weaken the
contract without establishing a general execution model.

Options were to retain component coordination, rewrite the full execution/storage system together,
or move authored artifacts/views into the existing owner while keeping checked legacy output as a
separate, explicitly scoped part of that owner. Choose the third option. It closes the observed
publication gap and preserves the next execution/storage decisions.

## Ownership and publication

`CanvasDocument` owns the accepted foundation root, immutable checked-result map, a per-owner
result version and saved-state acknowledgement. `RegionSession` exposes domain operations;
React reads frozen Page/artifact projections and retains interaction state only. Metadata uses
`canvas-workspace@1`, artifact definitions use `canvas-artifact@1`, and artifact presentations use
independent foundation views. Movement, resizing and adding a presentation do not revise the
artifact computation. Existing native plot/model records keep their legacy representation fields.

Compound domain commands prepare an isolated candidate sharing the original immutable repository.
They validate Page/model/artifact references, then submit one final accepted operation and one
subscriber event. They neither serialize/rebuild a second live workspace nor run external tools.
Keep includes the new context and affected comparison fields; Undo restores both through the root.
Creation with model membership, reviewed bindings and multi-object arrangements use that boundary.

Checked sampler data enters through a separate result port. It freezes caller data, verifies its
code hash, then rechecks the current artifact/context/job and every numeric point after the async
hash completes. It cannot overwrite authored code, bindings or views. Receipt arrival changes the
result version and unsaved state, but never authored history. Undo preserves checked evidence.
The existing runtime job key remains the scope of currency; a full richer execution manifest is
not claimed. Numerical verification parses the resolved dependency closure once per result rather
than reparsing unrelated definitions for every point. Full recorded definitions remain in the
receipt for native recovery.

The result map keeps the latest checked legacy receipt per allocated artifact. It is not the
foundation's typed append-only execution history. Deleted artifact observations remain available
for Undo until later retention integration or owner disposal. File export includes active artifact
results only. In-memory retention still needs its separate policy and integration.

Empty writing cursors and their automatic clearance of nearby artifact views are temporary.
Cancel creates no authored layout/Undo step; committing the line accepts induced placement with
that line. Unrelated view/code edits do not accidentally accept the temporary displacement.
Browser groups/tools/attention remain outside this native owner. Their optional arrangement Undo
callbacks cannot restore any authored artifact definition or comparison.

## Native files and saving

Application V3 files contain one foundation document plus checked result data. They duplicate
neither Page nor artifact definitions. V1 and V2 remain readable; a checked-in V2 fixture protects
that boundary. V2 metadata upgrades to the new schema before authoring. Current heads and retired
identity markers travel; session history does not. Unknown required schemas reject. Opening a file
still grants no permission to run code; retained output is verified as data before display.

`persistWorkspace` captures one owner-issued snapshot, serializes that snapshot, writes one
localStorage value, then acknowledges only the matching root and result version. An edit, Undo
or checked-result arrival prevents an older acknowledgement from marking current work saved.
Serialization/quota failures preserve prior durable bytes and accepted in-memory work. Unsaved
status and Retry use this same operation; export can capture complete current work during a
storage failure. Unreadable previous raw data still pauses saving instead of being overwritten.

This remains a single-writer, synchronous localStorage path. It provides no atomic multi-tab CAS,
incremental chunks or coordinated physical cleanup. Future storage must include both the authored
root and this checked-result state in a coherent durable head. The library's scalar receipt
persistence does not automatically cover the legacy sequence store. Resolve the typed sequence/
execution port or an explicit coherent storage extension before switching this application to
incremental storage. Full arrangement portability and independent model instances remain separate.

## Validation and review

The brief (internal design note) records K1–K5 subscriber, stale proposal, native
compatibility, fault, versioned ACK and delayed-response evidence. Its local/browser tests use
10 N baseline and 20 N alternative. The browser faults real storage writes after Keep, checks
old bytes, exports/reopens the whole operation, retries, undoes once and releases a delayed real
sampler response after Undo. The remaining application workflows and foundation gates also run.

Current costs (local-only report) distinguish direct
adapter work, full staged Keep and 201-point verification. Initial measurements (local-only report)
identified full staging rebuilds and unrelated definition parsing; the implementation removes
those costs. Global legacy candidate scans/math, full files, inline CSVs and lifetime identity
markers remain. This does not close QS7 or select production capacity/container budgets.

2026-10-26 review: K1–K5 pass with source-identified evidence in the brief. All 19 local canvas
checks, 11 Chrome workflows, 5 server tests and foundation package regressions pass. Accept
this owner/transport boundary without accepting the entire ADR 0003 or its proposed future
context/instance/execution semantics. Native V3 compatibility is private and explicit.
