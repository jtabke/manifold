# 0019: Bounded recency and explicitly kept calculations

**Status:** Accepted for bounded recent worksheet history and explicitly kept typed calculation content; general audit/citations, F6 composition and product budgets excluded.  
**Date:** 2026-10-26.  
**Related:** Calculation history brief (internal design note), [ADR 0018](0018-computation-snapshots-and-pinned-source-evidence.md),
[ADR 0017](0017-canvas-retention-and-storage-cleanup.md), [continuous exploration](../../vision.md#continuous-exploration).

## Context and options

The canvas accumulated a full effective Region list on every worksheet evaluation. It was
unbounded and the UI called those entries retained, although they disappeared on reload. A simple
cache cap would stop growth but would not preserve earlier conclusions that matter to the engineer.
Moving every automatic evaluation into permanent evidence would create a different unbounded store.

Compare automatic permanent history, bounded temporary recency alone, and bounded recency with an
explicit Keep boundary. Choose the third: recency is attention; deliberately kept calculations are
portable typed content. Reuse the existing operation/content/reference/retention primitives without
forcing a multi-output worksheet through the scalar execution receipt API.

## Decision

A worksheet/1 snapshot captures effective mathematical definitions, explicit bindings, context ID/
label, document/root origin, available pinned source evidence, declared unavailable source origins,
finite quantities, errors and condition outcomes, time, method/version and unassessed physical validity.
It excludes unrelated notes, CSV payloads and presentation. Its key identifies mathematical meaning;
layout and later label changes do not rewrite an earlier snapshot. Anonymous expressions have stable
private identities and normalized JSON quantities, including omitted optional fields.

The recent-calculation cache defaults to 128 states and 8 MiB of accounted payload. Count receipt
JSON bytes plus unique retained immutable source revisions; reference counts release source weight
on eviction/clear. Repeated mathematical states reuse their original immutable snapshot. A single
oversized entry is omitted with explicit feedback, preserving existing recency and authoring. Keep
current calculation remains available independently of cache admission. These are implementation
bounds, not heap measurements or product capacity. Limits are copied/frozen, and mutable caller
receipts are retained before storage; exposed entries cannot mutate the cache.

Keep authors a `canvas-calculation@1` content record under `canvas-workspace@2`. It preserves the
chosen snapshot rather than recomputing from current work. The trusted content schema independently
checks recorded output against its captured definitions using worksheet/1; pinned source closure
is checked before publication/import. Unknown methods, corrupt output and missing/foreign source
pins reject. Deeply frozen validation caches cannot be established by shallow freezing, accessors
or cycles. Ordinary commands share immutable kept content and do not revalidate its mathematics
on each edit. Mutable or reimported values receive full validation.

Keep/Remove use the existing accepted owner and ordinary Undo. Automatic evaluation only updates
recency and creates no authored operation/evidence clock. A repeated Keep of the same snapshot is
idempotent; current snapshots with the same meaning/name reuse an existing kept record. Renaming
or editing a context cannot relabel the original recorded context. Kept calculations do not become
new live worksheet definitions or launch jobs.

Bounded recent source pins join the core's extra protected roots during app cleanup. A recency
version seals the outer review, so capture/reordering/clear/eviction invalidates an earlier review.
Kept calculations declare their pins through their content schema, protecting current and Undo
selections automatically. A recent observation can therefore be kept after all live/Undo source
roots disappear. After it is cleared and no kept/Undo work needs the source, explicit cleanup can
remove that payload. Physical reclamation remains a separate reviewed step after successful Save.

Native V5 writes kept calculation content and its source closure, with V1–V4 reads. A fixed V4
source-backed receipt fixture complements existing V2/V3 compatibility. Local graph encoding and
the dependency-free foundation package are unchanged; no kernel schema branch is added. Session
recency and authored Undo are intentionally absent from native files. Opening a file performs
trusted bounded data validation, never embedded Python or external jobs.

## User experience and consequences

The history panel separates Recent and Kept, states the temporary limits, and offers Capture, Keep,
Remove and Clear. It shows quantities/condition outcomes and original mathematical context. Source
inspection resolves the pinned revision, shows the selected original record and downloads original
CSV bytes. Long cells are explicitly abbreviated in the preview. Save failures preserve kept
in-memory work as unsaved/exportable and do not falsely acknowledge it.

This bounds accidental session growth while giving important calculations durable identity and
recoverable context. Kept records still consume space because the engineer explicitly retains them.
Lifetime identity markers, core Undo selections and caller-held immutable captures also remain.
Full Page compatibility scans/clones, initial source verification and complete import/export are
still real costs. A kept calculation is bounded mathematical evidence, not a general audit or
citation ontology; condition satisfaction does not establish physical validity.

## Validation and review

The brief (internal design note) links local/cache/source/Undo tests, the real browser
Keep/Remove/failure/handoff workflow and source-identified costs. Acceptance requires exact earlier
values, bounded recency, shared sources, independently checked typed content, stale-review rejection,
original-source recovery and preservation of existing editing/native behavior. Remaining F6 model
composition, richer execution, partial sources, final container and usability/capacity gates stay open.

2026-10-26 review: all scoped gates pass with 23 app local checks, 14 Chrome workflows, 85 core
tests and 5 server tests. The core runtime/format is unchanged and retains its source-matched
25-group browser evidence. Source-identified measurements and original-source download checks
support this boundary; no general execution, independent scope or physical validity is implied.
