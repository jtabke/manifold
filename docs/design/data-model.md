# Concrete data-model proposal

**Status:** Proposed, 2026-10-20. Concrete contracts and an executable design fixture;
not an application storage migration or a production validator.

**Architecture review, 2026-10-23:** This is one arithmetic-oriented candidate.
The [options assessment](architecture-options.md) reopens its foundational assumptions:
single-provider quantities, directional computations, fixed core kinds and full
context freezing. Read that comparison before treating these contracts as a target.
The fixture remains evidence only for the lifecycle it actually exercises.

Native-document requirements apply from the first foundation slice; see
[portability](portability.md). The active
foundation sequence (internal design note) controls implementation order.

Read with
[ADR 0004](decisions/0004-normalized-engineering-records.md) and the
[scalability and flexibility assessment](scalability-and-flexibility.md).

The [TypeScript contracts](model/contracts.ts) make the domain vocabulary concrete.
The [lifecycle fixture](model/lifecycle.ts) checks selected consequences using one
calculation. These artifacts refine ADRs 0001–0003; their passing checks do not
accept those decisions or establish production correctness or scalability.

## The central distinctions

An engineering quantity is an identified property, such as spring stiffness. A
numeric value is a magnitude, unit interpretation and shape. A computation is an
identified method with identified output slots. A quantity selects one provider:
an assigned value, a source measurement, a computation output, or a model input.
An unassigned quantity remains valid authored work with no current answer.

For `F := k * x`, retain quantity IDs for `F`, `k` and `x`, and a separate
computation ID for the expression. `F` points to that computation's `value` slot.
Changing the expression preserves the quantity and computation identities and
creates a computation revision. Assigning a literal to `F` changes its provider;
it cannot leave two active producers. A genuinely different physical property
gets a different quantity ID. Editing text alone cannot decide physical identity.

Anonymous `1 + 1` needs a computation and output slot, but no invented engineering
quantity. A plot can target a computation definition and select its output. A
note has its own revision but contributes no numerical dependency. A requirement
is an explicit boolean condition over bound values; successful evaluation alone
cannot create one. An equality intended as a general mathematical relation must
not silently become a directional assignment or an inverse solve. The initial
expression method remains directional; an implicit solver needs its own method
contract and output selection.

This adds records compared with one text region. The cost buys independent
identity for a physical property, its implementation, and its presentations.
The editor can still author them together in a single operation.

## Records and authoritative references

| Record | Owns | References / boundary |
| --- | --- | --- |
| DefinitionRevision | One immutable version of a quantity, computation, condition, note, entity, association, model or extension. | Stable definition ID, scope ID and typed payload. Quantity providers are authoritative; no second producer table. |
| SourceRevision | One immutable version of imported or external evidence and its transformations. | Source lineage ID, byte identity, content locator/blob and prior source revision references. Availability is checked separately. |
| SemanticSnapshot | Complete selections of definition/source revisions and declared scopes. | Document-qualified IDs. A missing selection is a deleted/unavailable target, never a request for latest-by-name. |
| ContextRevision | One pinned interpretation of the work. | Exactly one snapshot; separate prior-context history and pinned baseline references. |
| AcceptedWorkspace | Current context heads, labels, views, comparisons and monotonically increasing operation sequence. | Mutable only by publishing a new accepted root. Numeric meaning comes from context revisions. |
| View | A renderer, context selector, target and placement. | Follow a context head for live work or pin a revision for historical work. Layout cannot supply model inputs. |
| EvaluationReceipt | Request, resolved manifest, method/runtime, outputs or failure. | Immutable evidence, outside authored Undo. A runtime association decides whether it is current for a requested output. |
| Blob | Large immutable bytes. | Referenced by content identity; shared by snapshots, sources and receipts. Archive entries describe included, external or missing bytes. |

Within one document, references use definition IDs. The snapshot pins their
revisions. A bare ID from another document cannot enter this namespace: import
must remap it, or a future cross-document contract must include its document and
pinned snapshot. The first contract does not implement live cross-document links.

`AcceptedWorkspace` is the operation boundary; it is not one giant mutable object
that every component can edit. The logical record store can have many physical
records and indexes. Session Undo retains earlier accepted roots; persistence
retains the root and reachable records needed for accepted work. Attention state
(active context, selection, camera) remains separate and is validated against the
accepted root.

## Expressions, editing and unresolved work

`AuthoredExpression` stores versioned language, exact authored text, syntax state,
and explicit reference occurrences. Each occurrence has an ID, UTF-16 range,
spelling and bound target or unresolved reason. The range belongs to that exact
immutable text revision; it is not a stable cursor location across arbitrary edits.

An editor operation maps retained occurrences through an edit and creates a new
revision. It must validate ranges against the new text, occurrence uniqueness,
target kinds and parsing. A range mismatch or ambiguous remapping stays unresolved;
never silently bind an existing occurrence to another same-named quantity. New
unbound tokens may offer scope-local suggestions, followed by explicit binding.
Renaming updates affected displayed occurrences and their text in the same operation
while preserving targets. A derived syntax tree may be cached by revision and
parser version; it is not a second editable source of truth.

An incomplete expression can retain valid bindings to unaffected tokens and can
be accepted as draft work. Evaluation requires complete syntax, resolved targets,
a supported method and valid types. Missing output types are unknown until resolved;
they cannot be interpreted as dimensionless zero. The types permit drafts but do
not prove these runtime invariants. A production validator must enforce them.

## Context resolution: one selection, no patch inheritance

A context revision points to one complete logical snapshot. Editing creates new
records only for changed definitions/sources and publishes a new snapshot selection.
Old contexts retain their selections. A preview is an ephemeral replacement set
against a pinned revision, not another saved layer of overrides.

Patches are operation input and optional audit metadata. They are applied and
validated once; they are never recursively applied during reads. Likewise,
`previous` links the prior revision of the same context, while `basedOn` pins an
alternative's original or explicitly updated baseline for three-way comparison.
An update retains both the alternative's history and its new baseline. Neither
reference supplies live inherited definitions. This removes the ambiguity
between an authoritative snapshot and an authoritative patch proposed in ADR 0002.

“Complete logical selection” does not require copying every map entry physically.
The first fixture uses plain object copies for readability and is O(N) per snapshot.
A production store may share immutable map nodes or materialize checkpointed deltas
behind the same read contract. Unbounded parent-chain reads are excluded. Physical
encoding is selected with measurements before claiming large-workspace support.

A saved comparison pins both context revisions. A live view may follow Original's
head, but that cannot silently advance the baseline of an existing comparison.
Updating an alternative is an explicit three-way comparison: old base, new base,
and alternative changes. Detect conflicting edits, deleted targets, changed units,
bindings, source selectors and ports before publication. The fixture demonstrates
only the compatible case, not a general merge implementation.

## Quantities, units and computational dependencies

`NumericType` separates array extents, immutable unit-registry reference and linear
versus absolute interpretation. A unit registry must resolve physical dimensions,
scale and offset. A display-unit change belongs to the view; changing how raw data
is interpreted belongs to a new source-read/definition revision. Neither compatible
units nor identical numerical values establishes physical equivalence.

Scalar data may be inline. Arrays use typed blob encodings with explicit shape.
No canvas object is required per row, mesh node or field sample. Conditions consume
numeric targets and return a condition result, kept distinct from model validity.
General uncertainty, complex values, frames, coordinates and tensor conventions
need additional typed contracts before use; the numeric array type alone does not
establish their engineering meaning.

Dependencies come from providers, bound occurrences, adapter value/source inputs, model ports
and selected source reads. Associations such as evidence-for do not become numerical
edges. A dependency index is derived from these records and can be rebuilt. Do not
store a second independently editable dependency graph.

Reject cycles for the initial directional evaluator. Algebraic loops, implicit
relations and transient feedback require methods that explicitly declare their solve
boundary and outputs. Do not infer a solver from graph cycles.

## Scope, model boundaries and future instances

Scopes are declared in snapshots independently of view containment. A model declares
an interior scope and stable input/output ports. The initial binding rules are:

- Same-scope computations may reference local quantities and output slots.
- External consumers reach a model's interior only through an output-port target.
- An interior input quantity has a model-input provider referring to one input port;
  the port binding selects its external target. Required unbound inputs are unresolved.
- A port must identify an appropriately typed quantity in that model's interior.
  Scopes must be acyclic; a model cannot enclose itself. Crossings through multiple
  boundaries must pass through each interface, rather than reach through ancestors.

Port IDs survive labels changing. Promoting flat work into a semantic model is an
explicit operation that stages scope and binding changes while retaining definition
IDs. A visual group has no such effect. This clarifies the ambiguous phrase “model
boundary used only for grouping” in ADR 0001: that is a visual group, not a model.

Independent reusable instances are deliberately absent from the first concrete
records. Before implementation, add a typed instance target containing the full
instance path and local definition/port ID, plus pinned model revision and explicit
argument bindings. A single instance ID/local-ID pair is insufficient for nested
instances if local occurrence IDs repeat. Never implement reuse by copying symbol
strings or resolving lexical ancestor names. Materialize instances only when needed;
a shared template must not eagerly duplicate its entire interior per occurrence.

## Rich artifacts and extension boundaries

Computation outputs can be numeric or artifact values. An artifact references bytes,
media/schema identity and, when available, a richer source revision. A renderer can
show an existing output; it cannot create a new computation solely through arbitrary
view settings. Response sampling is a computation definition with input bindings,
range and method parameters; axis styling and camera remain view settings. A native
CAD or solver adapter can preserve authoritative files while presenting derived
meshes or scalar summaries as separate outputs with recorded information loss.

Adapter source inputs declare source IDs separately from method parameters so dependency
and retention indexes do not have to inspect opaque configuration. Adapter-versioned
selectors must validate against the selected source revision.

Adapters declare supported input/output types, source/method revisions, allowed
effects, failure and cancellation behavior, and execution configuration. Remote
execution can consume the same resolved manifest; it does not justify decomposing
the application into services now. Arbitrary code and irreversible external writes
still require their own execution/effect contracts.

Unknown extension codecs retain opaque payloads, declared references and blobs for
round-trip preservation. The core can show an unsupported placeholder. It cannot
claim evaluation, migration or safe semantic edits for unknown payloads. Unknown
root schema versions are rejected with original bytes preserved; known roots with
unknown extension payloads may open only if all required references are understood
or explicitly unavailable. Do not turn the entire domain into untyped JSON to make
extensions appear easy.

## Evaluation identity and evidence

A request resolves the transitive dependency closure for its requested outputs.
The manifest records those definitions and sources, selected inputs, method/runtime
and execution-affecting configuration. It does not include every note or every
context in the document. Views, context labels and workspace sequence are excluded
from the numerical key. Receipts retain the context revision as provenance.

Initially a changed revision inside the closure may conservatively force execution,
even for a symbol rename. Reuse across cosmetic edits can later use normalized
executable-content fingerprints, with explicit proof that the omitted fields cannot
change meaning. Do not equate a semantic-root hash with a per-output execution key.

Production canonicalization must specify ordering, encoding, numeric representation,
unit normalization, domain/version prefixes and nonfinite-value rejection. Blobs use
verified byte digests; semantic IDs retain lineage independently of hashes. A matching
key permits validated result reuse across contexts; it does not prove physical
validity or that external sources are still accessible. Current, historical,
failed/unresolved and reproducible remain separate claims.

A source's digest is immutable metadata, while its current availability is checked
by an adapter. A failed fetch cannot replace a previously pinned source with latest
bytes. Missing bytes prevent recomputation even when an old receipt is inspectable.
A late response is validated and associated only when its manifest still matches
the requested output; cancellation alone is not the mechanism for correctness.

## Worked lifecycle and verification

The fixture uses a 10 N/mm stiffness measurement, 1 mm displacement and `F = k*x`.
It implements a deliberately tiny interpreter for these linear scalar formulae,
not the application parser, unit engine, operation owner or archive validator.

1. Author quantities, the force computation and an assumption note. Original's first
   revision selects them; force is 10 N.
2. Import CSV bytes once and create a source revision. Change only stiffness's
   provider to an explicitly selected cell and unit interpretation; force stays 10 N.
3. Preview 2 mm against Original's pinned revision. Preview force is 20 N; discarding
   the temporary candidate leaves accepted heads and bytes unchanged.
4. Keep publishes an alternative revision and pinned comparison together. The new
   selection changes only displacement; equation and measurement records are shared.
5. Revise Original's equation to `F = 2*k*x`, then reimport 12 N/mm as a new source
   revision and explicitly select it. Original becomes 24 N; the alternative remains
   20 N; the pinned original comparison still shows its original 10 N.
6. Explicitly update the alternative onto the new baseline and retain its 2 mm change.
   The compatible updated alternative is 48 N. Its old revision still evaluates to 20 N.
7. In a separate Undo path immediately after Keep, publish the previous authored root
   with a newer sequence. Remove the alternative head and comparison together; keep
   immutable records while session history or evidence still needs them.
8. Serialize/reopen the edited workspace with included bytes. Both context identities,
   old comparison targets and their results survive.

The checks also exercise missing source bytes, deleted targets, incomplete and
unresolved expressions, revision collisions, unrelated notes, view movement and
late-result key comparisons. They do not demonstrate atomic persistence, general
merge, editing occurrence mapping, scope validation, artifact execution or workload
performance. Those are explicit implementation gates.

Run from the repository root after application dependencies are installed:

```sh
node_modules/.bin/tsc -p docs/design/model/tsconfig.json
node docs/design/model/check-lifecycle.mjs
```

## Incremental adoption

1. Finish the bounded Keep/Undo owner under existing IDs and archive format. This
   proposal does not expand that slice or claim it implements frozen contexts.
2. Spike draft/rename occurrence mapping and one quantity/computation pair. Verify
   authoring simplicity, identity and missing-target behavior before migrating data.
3. Implement a versioned converter beside the current reader, with legacy fixtures,
   document IDs, identity remapping, pinned selections and comparison preservation.
   Import without overwriting the original archive. Materialize legacy alternatives
   at migration time and disclose that their original historical equations are unknown.
4. Introduce transactional record/blob persistence and indexes behind the same owner
   when workload measurements justify it. A root may become durable only with all
   required records/bytes or explicit unavailable-source declarations. Keep exports
   portable and independent of the physical database.
5. Add a richer artifact adapter or independent instances only after its real workflow
   supplies the additional contracts and benchmarks. Migration must not silently
   equate names or collapse physical identities.

Before accepting a production format, collect the outstanding evidence in
[ADR 0004](decisions/0004-normalized-engineering-records.md#validation-and-review).
