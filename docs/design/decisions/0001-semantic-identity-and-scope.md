# 0001: Semantic identity, revisions and scope

Status: Proposed  
Date: 2026-10-19  
Related: D1–D4, D7; QS1, QS4–QS5; R1, R3; [domain model](../domain-model.md)

## Context

`Region.id` already gives definitions an identity independent of position, but
symbols still feed a globally named evaluator. `Page` has no durable document ID
or semantic revision. Views, definitions and source coordinates are only partly
separated. Two imported documents can both contain `region-1`; two independent
model instances can both contain `k`. Neither match establishes equivalence.

This decision must support equation editing now without making reusable instances
or external source references depend on canvas structure later.

## Options

| Option | Benefit | Cost / failure mode |
| --- | --- | --- |
| Keep region IDs and globally unique symbols | Smallest immediate change | Import collisions; renames and independent instances remain coupled to names. |
| Use qualified symbol paths as identity | Readable references and lexical resolution | Rename or reparent changes identity; moving a model can break saved references. |
| Opaque identities with explicit bindings and immutable revisions | References survive rename, movement and presentation changes | Requires binding records, revision retention and import remapping. |

## Decision

Propose opaque identities with these separate meanings. Names below describe
contracts, not a final TypeScript or storage schema.

| Identifier | Meaning |
| --- | --- |
| Document ID | Durable authored document lineage; independent of URL, filename and content hash. |
| Definition ID | A particular authored quantity, equation, condition or note in that document. |
| Definition revision | Immutable authored content, declared units/meaning, bindings and source references for that definition. |
| Semantic snapshot ID | Immutable manifest selecting definition revisions, model membership/interfaces, instances and source revisions. |
| View ID | A representation that targets semantic identities and selects a context; arrangement belongs here. |
| Model revision / instance ID | Immutable reusable model contract and one independent occurrence of it. |
| Source ID / source revision | External or imported source lineage and a particular immutable version. |

A cross-document reference includes document ID and definition ID. Revision pins
are added wherever historical meaning is required. A hash can check content or
support caching; it does not replace lineage or guarantee source availability.
All accepted records and references are checked for unique IDs in their declared
namespace; never silently overwrite a collision.

### Edits and references

- Revising an equation or renaming its symbol preserves definition ID and creates
  a definition revision. Bound dependents retain the target; their displayed
  tokens update in the same operation when necessary to keep text and bindings consistent.
- Bind each parsed reference occurrence to an explicit target identity. Multiple
  occurrences may share a target. Text and bindings must round-trip together;
  reparsing must not silently retarget a previously bound occurrence by name.
- A new quantity representing a different physical property receives a new ID,
  even if it reuses a familiar symbol. Replacing meaning is an explicit operation.
  Software cannot infer physical equivalence from matching units or text.
- Changing units or physical meaning on an existing definition revises its content
  and revalidates downstream bindings; an incompatible dependency stays unresolved.
- Duplicate view: new view ID, same target. Copy independent engineering work:
  new definition IDs and an explicit old-to-new map for internal references;
  references crossing the selection remain explicit and are reviewed.
- Delete: new snapshots omit the definition; pinned history retains it. Live
  dependents become unresolved. IDs are never recycled and no name-based substitute
  is selected. Restore reuses retained identity; Undo does not erase history.
- Layout, collapse, camera and display-unit formatting do not change engineering
  revisions. An authored unit interpretation or source transformation does.

### Scope and reusable instances

A visual group does not introduce a namespace. A semantic model explicitly declares
a scope and interface; promotion from a group is an explicit operation. The
[concrete model proposal](../data-model.md#scope-model-boundaries-and-future-instances)
clarifies this distinction and keeps independent reusable instances as separate work.
New unbound names resolve within that scope; ambiguous names fail. Cross-boundary dependencies require explicit
ports and reviewed bindings rather than implicit lookup through ancestors.
Moving a view or presentation group cannot alter these rules.

An instance pins a model revision. Internal targets use `(instance path, local
definition ID)`; the complete path distinguishes nested occurrences whose local
instance IDs repeat. Ports use stable port IDs, with names as labels. Two instances
can both show `k` while resolving to distinct targets. Updating a model revision
requires an explicit operation that maps retained ports and validates changed
units and removed targets. Existing instances remain pinned until updated.
No reusable-instance implementation is authorized by this proposal.

### Imports and source lifecycle

Reopen a known document to continue its identity. Import as an independent copy
allocates a new document ID and remaps internal references, including contexts,
views and instances; retain original lineage as provenance. Import must state
which operation it performs. A conflicting revision under an existing ID is an
error, not an automatic merge.

Pin datasets and external artifacts by source revision. Retain original bytes or
an explicit retrievable locator plus availability state and transformation metadata.
Dataset references identify the revision and record/field (indices are sufficient
only inside that immutable revision). Reimport creates a new source revision;
rebinding is explicit. Missing bytes leave provenance inspectable and reproduction
unavailable. Source deletion/retention policy needs review before a richer adapter.

## Consequences

This separates semantic identity from spelling and representation, at the cost of
more records and validation. Revision storage needs a future retention policy;
for the first slice, retain revisions reachable from accepted contexts, Undo and
saved receipts, without automatic garbage collection.

Legacy archives need an identity-preserving migration within the imported document,
not global trust in existing `region-N` strings. Introduce document IDs and a versioned
manifest before adding scopes or instances. Preserve legacy text and bindings;
do not infer new physical equivalence during migration.

## Validation and review

Exercise rename with repeated references, deleted targets, independent copies,
same-named instance internals and source reimport. QS1 must preserve targets and
execution inputs through view changes; QS4 must reject ambiguity; QS5 must preserve
IDs through export/reopen and reject collisions without replacing accepted work.

Review outcome: not yet accepted. Reconsider if binding occurrences cannot survive
normal incomplete editing without surprising retargeting; validate that interaction
with an equation-editing slice before committing a general storage schema.
