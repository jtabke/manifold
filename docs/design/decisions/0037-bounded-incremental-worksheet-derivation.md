# 0037 Bounded incremental worksheet derivation

Status: Accepted for application worksheet evaluation/rendering, 2026-10-28.  
Related: brief (internal design note), [targeted authoring](0030-targeted-canvas-authoring.md), [model analyses](0036-model-backed-analysis-requests.md).

## Context

Accepted state and execution already have one owner, but worksheet projection repeatedly parsed
and evaluated complete Pages. Plotting repeated that work per point. Adding mutable result setters
or another worksheet history would conflict with the existing ownership and portability contracts.

## Decision

Share `prepareCalculation()` and `solvePrepared()` in the existing arithmetic module. `calculate()`
is a fresh preparation wrapper over that single evaluator. Prepared rows record stable identity,
source, AST/dependencies or parse error. An incremental pass indexes definitions/users, invalidates
old/new names transitively and reuses unaffected values/constraints. New or previous ambiguity/error
states and reordered rows use a full pass to retain deterministic diagnostics. The numerical and
dimensional evaluator remains unchanged in meaning. Duplicate full evaluation exists only in an
independent test oracle, not another production engine.

The `worksheetProjection` adapter owns disposable bounded derivation: effective context text,
classification, legacy incomplete/link-error compilation, projection, semantic identity and curves.
The existing document module keeps its public worksheet ports and delegates to that one implementation.
Immutable result maps expose no mutators and never leak their native backing Map through `forEach`.
ASTs, quantities/dimensions, binding/source lists and sampled points are frozen and typed read-only.

Retain at most eight semantic snapshots/eight MiB estimated weight, 1,024 prepared rows/two MiB
estimated weight and four 81-point curves per snapshot. Strong cache entries retain text/AST/numerical
derivation, not whole Pages or CSV payloads. At most four weak Page aliases per snapshot allow
identity proofs only for deeply frozen input. Shared immutable region/context/link branches prove
layout-only equivalence; changed or mutable inputs require content comparison. Existing Page
materialization reuses content arrays across view changes. Cache loss/eviction must never change
accepted content, execution currency, history, Save or recovery.

MathLine memoizes its mathematical subtree using its own notation, highlights, relevant sources,
substituted quantities and exploration metadata. Event delegates use latest committed handler refs;
scalar fallback data avoids retaining previous Page callbacks. It does not ignore handler changes
behind a shallow React comparator. Other canvas coordination/rendering remains outside this boundary.

## Alternatives and consequences

An unbounded cache keyed by Page can retain history/source payloads and fail mutable-caller tests.
A mutable incremental worksheet authority would duplicate accepted ownership. Memoizing only the
outer React component misses non-render consumers; memoizing with stale callbacks breaks commands.
Blindly reusing erroneous results risks nondeterministic cycle/duplicate diagnostics.

The selected design adds cache/invalidation/read-only-view code and retains bounded derived data.
It still scans/indexes changed semantic input and sometimes evaluates fully. Semantic identity on a
cold cache also prepares/evaluates its shared projection. Estimated weights are conservative policy
accounting, not a promise about JS heap. The current 256-region limit and native V7 stay unchanged.

## Validation

[Local contracts](../../../apps/canvas/tests/check-incremental-worksheet.mjs) compare 400 mixed
revisions plus focused valid chains/fan-out, semantic identity and curves against the
[preceding reference algorithm](../../../apps/canvas/tests/worksheet-reference.mjs). They cover
immutable views, mutable callers, explicit links, errors, source-backed edits, hot preview/Undo,
bounded retention, native and zero-write local recovery. Seven negative compiler witnesses protect
read-only derivation interfaces. [Chrome workflows](../../../apps/canvas/tests/check-incremental-worksheet-browser.mjs)
count mathematical subtree renders across real pointer layout, sparse edits, current-handler
commands, preview/cancel/Undo and cold reload at 64/256 rows.

[Workload measurements](../../../apps/canvas/tools/measure-worksheet-evaluation.mjs) use independent,
chain and fan-out graphs, five warmups plus 30 edits, parser/evaluator counters, curves and cache
bounds. Current evidence (local-only report) owns source identities, costs
and limits. The reference baseline report records only observed parser/expression counters; its
earlier archived instrumentation probe did not instrument assignment/constraint counters and is not
used for those comparisons. Archive bytes and the original production baseline remain unchanged.
