# 0006: Shared maps and bounded Undo after F1b

Status: Accepted for isolated foundation experiments; production adoption excluded  
Date: 2026-10-24  
Related: Foundation brief (internal design note),
F1b evidence (local-only experiment),
[F1 disposition](0005-f1-content-reference-view-experiment.md),
[scalability](../scalability-and-flexibility.md)

## Context

F1 preserved authoring freedom, references, view independence and editable transport,
but dense map copies and an all-revision compatibility scan made local operations
scale with unrelated content. Unbounded Undo retained complete prior repositories.
We needed measured physical locality without growing the semantic ontology.

## Options

1. Keep copied records and complete roots: simplest reads and familiar data, but F1's
   whole-map costs and history growth remain. This was rerun as the comparison baseline.
2. Use one immutable AVL string map, derive compatibility only from validated imported/
   changed records and retain a bounded set of Undo selections. This was implemented
   and measured without exposing tree-node identities in the document.
3. Adopt a HAMT/library, database, checkpointed deltas or another persistent map.
   These remain viable production alternatives; they were not compared here. This
   experiment cannot select a universally best storage technology.

## Decision

Accept the tested F1 item/revision, qualified-reference, independent-view and single-
publication contracts, with option 2 as their physical candidate, **for continued
isolated foundation experiments**. F1b's locality, correctness and bounded Undo gates
pass; F2 can now test typed relationships and competing evidence on that candidate.
This is a dated experiment review, not production adoption of ADRs 0001–0005, a public
schema, a dependency/framework selection or an application migration.

Compatibility is derived on validated import and each new content revision. It is
private, immutable runtime metadata, omitted from the native file and recomputed
from authoritative records on import. Unrelated view edits do not scan content.
Unknown optional schemas/extensions retain the conservative whole-package read-only
policy, including opaque asset closure. They cannot supply an authoritative cache hint.

Use 32 Undo selections as the experiment default, configurable through an explicit
limit. Each entry retains authored item/reference/view selections and its affected IDs,
not an old revision repository. Eviction removes that Undo step only. All immutable
revisions, source bytes and identity ledgers remain retained; a pin still resolves
after its original edit falls outside Undo. This is a bound on transient Undo, not
on authored archive history or total process memory.

## Consequences

Single writes update logarithmic tree paths. View edits depend on V, not unrelated
N/R. Lookup now traverses a tree and the F1 resolver bridge allocates a small bounded
projection; metadata reads are slower than direct object properties in this run.
Sorted ID iteration is physical order, not authored order: future schemas must carry
meaningful sequence or view stacking explicitly rather than depend on object insertion.
Import/export and capability inspection may still traverse the whole document.

Old snapshots and effect tickets retained by callers keep their data alive independently
of the managed Undo bound. Production work must define leases, revision/asset pruning,
storage quotas, root-ID allocation/ledger policy and durability before claiming bounded
memory or sustained-work support. Bulk edits, browser rendering, fanout and real native
sources need separate measurement. No QS7 budget or supported capacity is established.

## Validation and review

`make check-foundation-b` passes the original F1 suite, F1b's nine acceptance groups,
6,000 deterministic mixed map operations with historical snapshot checks, and all eight
original worksheet outcomes. A guard rejects whole-map traversal during edit/Undo
paths. Fresh-process transport preserves editable drafts, pins, views and shared bytes.

`make measure-foundation-b` compares nine item/view combinations and eight longer-
history cases. Structural counts show locality independently of timing noise. At
10,000 notes / 100 views, the last revision allocates 31 tree nodes versus 20,036 copied
baseline entries; moving one view reads one logical view and allocates seven nodes.
Managed Undo remains 32 steps after 2,048 edits, including a rotating 1,000-item case.
Retained revisions and used-ID counts still grow linearly and are reported explicitly.

Review used local source inspection, deterministic checks and contemporaneous baseline
measurements. No external review, user validation or production performance acceptance
is claimed. Reopen this decision if F2 needs divergent recovery semantics, if physical
map nodes enter semantic IDs, or if an optimization weakens staging/compatibility/pin
behavior. Keep production storage alternatives open until application workloads justify
one, and remove obsolete parallel runtime scaffolding when promoting a bounded path.
