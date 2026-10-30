# 0005: Content, reference and view boundary after F1

Status: Proposed; experiment disposition is revise before promotion  
Date: 2026-10-24  
Related: Foundation brief (internal design note),
F1 evidence (local-only experiment),
[architecture](../architecture.md), [portability](../portability.md)

F1b subsequently passes that bounded revision gate; [ADR 0006](0006-f1b-shared-maps-and-undo-retention.md)
accepts the tested candidate for continued isolated experiments. The original F1
proposal and production exclusions below retain their historical scope.

## Context

We need a small foundation that retains unfinished thoughts and richer sources,
keeps identity independent of presentation and supports an editable file handoff.
The arithmetic-oriented schema did not establish that foundation. The isolated F1
experiment now exercises text/drafts and tables with one operation/recovery protocol.

## Options

1. Keep direct worksheet-owned content, references and whole-worksheet recovery.
   The comparison passes eight matching behavior outcomes with fewer concepts.
2. Separate retained item/revision identity, qualified reference policies, view
   records, pure validation/resolution, one accepted-state publisher and asset access.
   F1 passes its correctness cases and clean-process transport with these boundaries.
3. Adopt a generic resource/plug-in model and production normalized store now.
   Neither two concrete content kinds nor this diagnostic workload justifies that step.

## Decision under review

Retain option 2 as the candidate logical contract, while retaining option 1 as a
simplification baseline. The experiment's disposition is **revise before promotion**;
this does not accept ADRs 0001–0004, a production schema or a database.

The next bounded task is F1b: remove unrelated compatibility scans from view edits,
measure and choose a physically shared selection/record-map approach, and rerun the
same correctness and history-growth cases. Do not add relations/evaluation in F2 or
move live state ownership until that revision is reviewed and the narrow contract
is accepted. The implementation remains isolated.

## Consequences

Stable IDs, revision pins, independent views, postpublication pinned effects and
staged transport work across both tested content kinds. Semantic selectors remain
kind-specific; a cell coordinate is anchored to one revision. The logical boundary
centralizes shared authority/provenance/transport rules rather than removing all
content-specific code. It has not proved native geometry or solver integration.

The first physical implementation has O(R) compatibility scans per write, O(N + R)
selection/revision-map copying per content revision, O(V) view-map copying and
unbounded session history. It retains source bytes once, but full JSON transport,
eager hashing and full table decoding remain O(B). Unknown optional content keeps
the entire original package read-only; partial editing/migration is not proven.

## Validation and review

`make check-foundation` typechecks and runs nine acceptance groups plus the eight-case
worksheet comparison. `make measure-foundation` records 100/1,000/10,000 text-item
workloads crossed with 1/10/100 views, 30 measured operations after five warmups,
a shared 100,000-row table, and fresh-process load trials.

The evidence (local-only experiment) records source/fixture digests,
workspace revision, environment, raw distributions and limits. Correctness passes
are evidence for continuing the candidate; they are not production scale approval.
F1b must preserve those outcomes, make view-only work independent of unrelated content
and explicitly account for history growth. If those changes require a broader or less
understandable semantic model, reconsider the worksheet-bound option before F2.
