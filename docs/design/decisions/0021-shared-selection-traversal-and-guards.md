# 0021 Shared selection traversal and guards

**Status:** Accepted for the compatible internal selection consolidation; presentation/alternative record migration excluded.  
**Date:** 2026-10-26, America/Los_Angeles.  
**Related:** [Reduction review](../primitive-basis.md), selection brief (internal design note),
[foundation](0009-reusable-foundation-and-frozen-alternatives.md), [composition](0020-independent-scalar-model-composition.md).

## Context and options

The reduction review identifies selected revision meaning as necessary information, while the exact
context representation remains replaceable. Capture, validation and preview guard construction had
separate loops over the same declared reference graph. Preview captured both original and candidate
closures, then traversed every selected revision again to discover pinned dependencies. That added
work and allowed the root reference's pin to escape the availability guard.

Compare retaining independent loops, immediately migrating views/alternatives to ordinary content,
and sharing the lower-level selection mechanism while retaining public records. Choose the shared
mechanism first. It reduces duplicated semantic rules and measures a concrete cost improvement;
a representation migration still needs the lifecycle/compatibility evidence identified by the review.

## Decision

An internal `selection.ts` supplies revision resolution, one bounded iterative closure walk, closed
capture/validation and preview guard construction/checking. It imports document types only; it adds
no runtime import cycle, kernel content kind or new serialized record. Existing `resolve`,
`captureContext` and `validateContext` entry points delegate to it. Public Context, Preview,
View/Alternative shapes and native/local formats remain compatible.

A capture first collects reachable heads and revisions in ephemeral Maps, then builds the immutable
SharedMaps once. This replaces persistent path allocation on every visited entry. Validation uses
the same traversal with the frozen environment and still rejects incomplete/extraneous heads,
wrong-lineage or unreachable revisions. Opaque documents keep their conservative compatibility
path; unknown handlers cannot establish a new closure. Reference limits require positive safe
integers and remain configurable.

The same walk records every encountered local pin, including a pinned root and a pin encountered
through an already visited revision. Guards combine the original and candidate dependencies against
the accepted baseline. Relevant same-valued revisions, newly present/absent heads and changes in
pinned-revision availability invalidate Keep. Unrelated notes, placement and retained historical
pins remain valid. Guard coverage is transient metadata; it is neither an authored primitive nor
execution evidence.

A private guard also records the exact immutable revisions introduced by the preview itself.
An execution may retain those records as historical evidence before Keep; that expected admission
is allowed only for the same revision object. Equivalent or conflicting replacements do not qualify.
The guard is held in a WeakMap keyed by the preview, preserving the public Preview fields without
an extra serialized record or a cache retaining whole documents.

A missing pinned root that appears independently after Preview now requires a new preview before Keep. Rejection
publishes nothing and preserves the preview and Undo selections. Deleting a pinned root's live head
does not invalidate it when the selected revision remains retained; the revision policy still governs
meaning. Resource-byte availability is checked through the resource/projection/execution contracts,
not guessed from a revision guard.

## Costs and consequences

Capture remains proportional to reachable reference work, with bounded traversal and bulk map
construction. Preview guard construction no longer redeclares references for every selected record:
it consumes the pin coverage from the original/candidate captures. No global map scan enters ordinary
local edits. A capture has ephemeral Map/Set costs, and immutable final maps still contain one node
per entry. There is no derived cache retaining entire source documents beyond intended captures.

The source-identified selection diagnostic (local-only report)
compares the preserved 0.9 capture/guard algorithm on the same immutable graphs, with exact logical
context/guard parity. It separates reference calls and legacy persistent-map allocation from shared
bulk entry counts; none is process heap. Timings are device diagnostics and not product budgets.

This consolidates implementation machinery without erasing live/frozen selection, authored Undo,
preview or named-alternative lifecycles. It does not establish that dedicated view/alternative
collections are required, nor implement their migration. General result execution remains scalar-
specific. Broader schema/format choices stay in their own bounded proposals.

## Validation

Eleven focused tests cover cycles, foreign references, absence, strict closure validation, budgets,
original/candidate guard union, pinned-root appearance, retained-root deletion through cleanup,
preview-owned pinned roots/model revisions admitted through execution, rejection of substituted records,
mutation aliases and native handoff. Existing foundation, reduction, browser, application and server
gates are rerun. Fixed native v1/v2/v3 and app V1–V5 remain compatibility gates. The brief (internal design note)
and current evidence (local-only report) record results, source identity and
costs. The 0.9 evidence and reports are preserved separately.
