# 0018: Computation snapshots and pinned source evidence

**Status:** Accepted for bounded scalar sampler snapshots, app/native source closure and generic pinned retention roots; general execution and session-history policy excluded.  
**Calculation-history successor:** [ADR 0019](0019-bounded-recency-and-kept-calculations.md) adds bounded recency and explicitly kept worksheet snapshots through native V5; the original V4 sampler scope below is preserved.  
**Date:** 2026-10-26.  
**Related:** Snapshot brief (internal design note), [ADR 0016](0016-coherent-canvas-incremental-storage.md),
[ADR 0017](0017-canvas-retention-and-storage-cleanup.md), [portability](../portability.md).

## Context and options

The sampler typed its definitions as `{id,text}` but retained full effective Regions, including
unrelated CSV bytes. A small result could rewrite nearly a megabyte. Its execution key used all
worksheet mathematics, so unrelated edits invalidated results. Simply removing CSV data would
lose measurement provenance after source changes or cleanup.

Options were to preserve full snapshots and deduplicate only their transport, to strip all source
metadata, or to capture actual computation meaning and pin the source records independently.
Transport-only deduplication retains the wrong logical footprint; stripping source meaning breaks
historical recovery. Use a bounded versioned computation snapshot and existing qualified pins.

## Decision

New sampler receipts declare snapshot version 2. They contain only the actual dependency closure
of input/output definitions, resolved dependency bindings, method code and hash, scalar inputs,
range/output identity in the execution key, context and independently checked sampled points.
Plain definitions are exactly `{id,text}`. Unrelated notes, data and mathematics are excluded.
Relevant input/binding/source changes invalidate a result; canvas placement does not. The existing
global evaluator still checks each point; this is not independent model scope or a general solver.

For a used measurement, retain its quantity region, row/column/raw/unit and a qualified local pin
to the complete immutable source revision. The source document is an explicit preparation input,
supplied through the runtime boundary and rechecked by RegionSession after async hashing.
Validate source lineage, record kind, captured CSV equality and selected raw cell. A missing source
blocks new computation rather than guessing a revision. Pins preserve original CSV bytes, shared
among result snapshots; a changed source version invalidates currency even if the selected numeric
value is unchanged. The selected raw observation and the effective assumption text remain separate.

The core retention policy adds `keepReferences`: validated available local pins are additional
roots, with their schema-declared transitive references/assets. Follow/foreign/missing root requests
reject. The resulting review remains sealed to owner/root/evidence/lifecycle. Core code knows no CSV
or sampler schema. The app first identifies protected/restorable artifact results, then supplies
their source pins to the same retention closure. Removing the last protected observer permits its
otherwise-unused source payload to leave, while retired identity ledgers remain.

Application native V4 includes current authored heads plus pinned source closure and checked results.
The foundation envelope remains native v2 and local graph bundles remain compatible. Files contain
no storage-node IDs. V1–V3 reads remain; a fixed V3 receipt fixture covers the previous complete
snapshot. Legacy receipts match only against their complete legacy key/definitions and still pass
code-hash and numerical verification. Read-only Open can display verified compact runtime data
without advancing the durable head; legacy stored receipts remain intact until an explicit result
update replaces them. Opening a file never grants execution permission.

The native writer/reader and local recovery validate source closure. A source-backed result cannot
be exported through the legacy Page-only envelope, which cannot carry its pinned revisions. Native
8 MB and conservative local 64 MiB limits remain explicit; neither establishes product capacity.

## Consequences and remaining work

New results no longer copy unrelated Pages or CSVs. Multiple results pin the same retained source
record, and native V4 includes those source bytes once. Initial save, full validation and native
transport still process complete retained metadata/source bytes. Projection and legacy candidate
commands still scan global Page structures. Legacy receipts remain larger until replaced.

The separate session-only scalar calculation-history list still retains complete effective Regions
and has no review/bookmark policy; this decision does not silently discard it. General arrays/tools,
frozen canvas contexts, independent model composition, final archive container and product budgets
remain separate gates. Source-reference preservation is not a claim of physical validity.

## Validation and review

The brief (internal design note) links source-identified cost reports, corruption/
currency tests and real source-backed native handoff. All 22 app local checks, 13 Chrome workflows,
5 server tests, 85 core tests, 25 foundation Chrome groups and original experiment gates pass.
Measurements distinguish unchanged-source reuse, new result writes and full recovery. They use a
memory backend for timing; actual IndexedDB workflows establish correctness rather than latency.

Accept this bounded slice. Revisit the receipt protocol when richer execution or scoped models
require additional meaning. Preserve explicit versioning and source closure through that migration.
