# 0020: Independent scalar model composition

**Status:** Accepted for the bounded foundation content adapter and browser workbench; canvas scope migration, general solvers and product capacity excluded.  
**Date:** 2026-10-26.  
**Related:** Composition brief (internal design note), [scope proposal](0001-semantic-identity-and-scope.md),
[foundation](0009-reusable-foundation-and-frozen-alternatives.md), [source evidence](0018-computation-snapshots-and-pinned-source-evidence.md).

## Context and options

The canvas groups worksheet regions but still resolves globally named definitions. Copying or
renaming those regions cannot establish independent occurrences. The existing foundation already
has stable identities, immutable revisions, explicit qualified references, one accepted owner,
frozen contexts, separate execution evidence and portable recovery. Composition should use those
contracts without a second document store or eager copies of every internal node.

Compare globally renamed copies, expanded internal items per instance, and shared immutable
model definitions with locally identified nodes/children and explicit public ports. Choose shared
definitions. Keep evaluation in an optional trusted adapter rather than add model-specific branches
to document operations, storage, retention or execution receipts.

## Decision

`scalar-model-definition@1` stores stable local node IDs, input/output port IDs and child occurrence
IDs. Labels are presentation. Children pin whole model revisions and bind their inputs to local
nodes or public child outputs. Supported nodes are scalar inputs, constants and pinned native
method requirements. Every input node has exactly one public input port. Outputs have explicit
stable IDs and targets. Definitions may preserve unavailable methods or unresolved bindings;
projection must report the actual failure rather than invent a number.

`scalar-model-instance@1` is an ordinary independently identified item. It pins a model revision,
stores literal/reference input bindings and declares subject/frame/condition. A qualified internal
address consists of document/root instance, complete child occurrence path and local node ID.
Public port selectors are versioned. Inspector selectors expose local values for inspection but
cannot become cross-instance input bindings. Instances share template metadata, not mutable inputs.
No internal items are eagerly allocated. A new template head does not silently upgrade instances.

`reviewModelBinding` returns the source projection, captured interpretation, destination and new
body. Exact unit strings, frame and condition must match; the stored expected source subject makes
any subject mapping explicit. It does not establish physical equivalence or convert units. Update
review preserves bindings by stable port ID, reports added/removed ports and changed input units,
and requires explicit removal/rebinding of incompatible bound inputs. Removed outputs remain
missing for consumers; no label-based remapping occurs. Callers capture the current owner stamp,
show the review/candidate outputs and apply against that stamp. A review is pure data, not an
independently sealed authorization token. The workbench rejects stale review application atomically.

Schemas receive a context-scoped `ProjectionReader`. Reads must match a schema-declared reference.
`readFrom` requires an actual parent projection token produced in the same read and only permits
that parent's declared references. Reads never escape the selected document/frozen context, and
cycles, dependency count and depth are bounded. This is a disciplined trusted-handler interface,
not a sandbox for arbitrary JavaScript. Projection values/selectors retain immutable JSON without
keeping mutable caller/handler aliases; only deeply frozen plain graphs establish validation reuse.

Actual successful reads produce sorted, unique transitive document/item/revision/selector origins.
Captured scalar inputs include these origins in their execution key. A same-valued source revision
therefore makes an earlier receipt historical; frozen alternatives continue to select their exact
original revisions. Imported traces are validated against recorded context and actual projections,
not trusted merely because their numeric output matches. Sorting uses fixed character order.

Native files containing dependency-bearing receipts write foundation v3. Simple receipts still
write v2; readers accept v1/v2/v3. V2 cannot contain v3 provenance. A fixed v3 fixture protects this
contract. Incremental local recovery selects the matching envelope contract without changing the
physical graph format. The canvas still writes its separate native V5 with inner foundation V2
because it has no composed scalar receipts. Existing file paths remain readable. Files install
no functions. Open validates bounded data but launches no external jobs.

## Costs and consequences

The synchronous native adapter is intentionally narrow: trusted finite scalar methods with exact
slot/unit/domain requirements, lazy per-projection node memoization and complete occurrence paths.
Defaults allow 10,000 visited evaluation steps and 16 nested levels; configurable ceilings are
1,000,000 steps and 32 levels. Definitions permit 256 nodes, 64 child occurrences and 64 ports per
direction. The generic reader separately limits 4,096 projections/origins and depth 64. These are
implementation guards, not promised capacities, process containment or a general solver runtime.

One instance adds one authored record, plus independently requested views/requests. Template size
and instance count are independent. A port evaluates only reachable math nodes, but whole template
JSON validation still costs O(selected template metadata); the benchmark exposes that cost. Context
capture/retention conservatively traverse declared references, including unused declared children.
Real declared fanout costs O(affected dependents). Initial/full native export and decode still visit
retained metadata. Shared maps keep ordinary independent edits and incremental saves local.

The optional adapter establishes reusable composition without broadening the kernel ontology.
Physical validity, arrays/geometry, solver cycles, asynchronous heavy execution, partial sources,
collaboration and the final archive container need their own adapters and evidence. Canvas global
worksheet grouping remains unchanged. Its next integration must use explicit occurrence/port
identity; renaming symbols would not satisfy this decision.

## Validation and review

The brief (internal design note) and 0.9 evidence (local-only report)
link core tests, nine real Chrome workflows, native/local/retention handoff, fixed compatibility
fixtures and source-identified instance/template/fanout costs. Checks cover independent and nested
instances, explicit bindings and updates, Undo, frozen alternatives, source reimports, unavailable
sources, corrupt provenance, undeclared reads, mutable aliases and bounded failures. Existing
foundation, app and server gates remain required. Passing this bounded F6 slice does not accept
the entire scope proposal or validate the unfamiliar-engineer working loop.
