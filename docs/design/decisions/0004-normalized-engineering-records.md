# 0004: Normalized engineering records and pinned selections

Status: Proposed  
Date: 2026-10-20  
Related: D1–D7; QS1–QS5, QS7; R1–R5;
[concrete model](../data-model.md), [scale assessment](../scalability-and-flexibility.md)

## Architecture-fit review

2026-10-23: Foundational selection is reopened in the
[options assessment](../architecture-options.md). This record remains a candidate;
its single-provider quantity, directional computation, exhaustive core kind and
context-freezing assumptions require comparison against competing observations,
implicit relations and native-resource projections. Typechecking and sizing do not
establish that ontology. No production migration follows from this proposal.

## Context

The domain model separates meaning, context, results and views, while the prototype
still combines much of that state in Page/Region/Artifact. ADRs 0001–0003 propose
stable identity, frozen contexts and one operation owner but leave quantity versus
computation identity and snapshot/patch authority insufficiently concrete.

We need a model that preserves incomplete authoring, real source history and stable
alternatives without copying source bytes or coupling every edit to every renderer.
The [TypeScript proposal](../model/contracts.ts) and [lifecycle fixture](../model/lifecycle.ts)
make the alternatives reviewable without changing the live archive.

## Options

| Option | Benefit | Cost / failure mode |
| --- | --- | --- |
| Keep region-text objects and context overrides as the core | Least immediate migration; current editor maps directly to records. | Quantity/method identity remain conflated; equations and source revisions can drift; independent instances and multiple views are difficult. |
| Generic property graph or arbitrary JSON for all concepts | Easy to add node/edge names and metadata. | Producer rules, provenance, scope and evaluation semantics move into unbounded implicit conventions; indexes alone cannot validate meaning. |
| Full copied workspace per alternative | Straightforward isolation and local reading. | Repeated source/view data and expensive history; lineage and cross-context comparison become difficult. |
| Normalized typed immutable records with pinned selections | Shared unchanged content, explicit producers, stable provenance and independent representations. | More records/joins; migration and validation effort; snapshot maps and retention still need physical scale decisions. |

## Decision

Propose the final option with the following refinements to the earlier proposals:

1. Quantity identity is distinct from a numeric value and a computation identity.
   Each quantity revision selects one provider; computations expose stable output
   slots. Anonymous outputs need no invented physical quantity.
2. Context revisions point to complete logical revision selections. Patches are
   edit input/audit metadata, never a second authoritative read representation.
   Parent context revisions express lineage only.
3. Stored relationships remain typed: numerical references/providers, source
   derivation, evidence association, scope boundaries and view targeting. Build
   indexes from them instead of an independently editable universal edge graph.
4. Source and result bytes are shared immutable blobs; numerical arrays and artifact
   values do not require a canvas object per element. Unknown extension payloads
   round-trip with explicit declared references but cannot silently execute.
5. Views follow a context head or pin a context revision; comparisons pin both sides.
   Presentation changes do not create engineering revisions or execution inputs.
6. Evaluation keys describe actual output dependencies, source/method/runtime and
   configuration. Workspace sequence and unrelated notes are excluded. Conservative
   invalidation inside the closure is acceptable before equivalence is proven.
7. Semantic model scopes are explicit and independent of visual groups. Reusable
   nested instances require full instance-path targets and a separate instance
   contract; the initial schema does not pretend to implement them.

A complete logical selection does not mandate a full physical map copy. Keep the
storage/index adapter replaceable. Do not add distributed services, event sourcing,
a general executor or collaboration as consequences of normalization.

## Consequences

Frozen alternatives and source updates become explicit and explainable. The editor
must manage a quantity/computation pair without exposing extra setup. Range-based
reference occurrences require a careful draft/rename mapping operation. Immutable
records improve sharing but do not eliminate retained history, source bytes or
large-map overhead. See the quantitative sizing and workload gates in the scale
assessment; no application performance gain is established.

Keep/Undo can first gain one owner under existing IDs and format. A full semantic
migration follows separate authoring, compatibility and transactional-storage slices.
Legacy alternatives materialize at migration time; lost original equations cannot
be reconstructed. Unsupported formats preserve original bytes and do not replace
accepted work. Automatic garbage collection and multi-user merge remain separate
decisions requiring explicit evidence.

## Validation and review

The design fixture passes typechecking and selected lifecycle assertions; the
[evidence record](../model/evidence.md) identifies the scope of those results.
Before accepting the model as a production archive contract, require:

- A draft/rename occurrence-mapping spike that preserves identities through partial
  edits, repeated references, deletion and ambiguous same-name tokens.
- Runtime validation fixtures for IDs/revisions, single providers, missing targets,
  unit/shape mismatch, cycles, source/blob integrity and unknown codec preservation.
- Model-boundary/port fixtures that reject implicit cross-scope lookup and show a
  quantity remaining identified through promotion into a model.
- A versioned legacy converter with round-trip, independent-copy remapping, unavailable
  sources, unsupported versions, pinned comparisons and migration-time baseline tests.
- Transactional failure/reopen evidence and measured workloads with explicit QS7
  device, latency and capacity budgets; synthetic JSON sizing is insufficient.

Review outcome, 2026-10-20: coherent candidate with executable design evidence;
production-format acceptance remains pending the above gates. No ADR is accepted
by implication. Reconsider the split if authoring requires users to manage two
objects, or revise storage/selection encoding if normalized maps dominate real work.
