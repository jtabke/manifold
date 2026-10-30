# 0035 Authorable scalar models and general outputs

Status: Accepted for the bounded authored-model adapter, 2026-10-28.  
Related: authored-model brief (internal design note), [composition](0020-independent-scalar-model-composition.md), [canvas adoption](0026-canvas-model-composition-and-portable-captures.md).

## Context

The composition foundation supports qualified independent/nested instances and pinned definitions,
but canvas insertion and computation were tied to spring/force examples. Authored equations need
stable local identity, versioned source, dimensional arithmetic and multiple scalar outputs without
another execution/history/storage owner.

## Decision

Compile a bounded self-contained equation subset into the existing scalar model graph. Store exact
source rows, explicit input/output row IDs and the deterministic graph in `canvas-authored-model@1`.
Validation recompiles source and rejects disagreement. Definition projection exposes the existing
`model-definition` contract, so model instances, qualified selectors and reviewed updates retain
their existing protocols. Row identities survive notation changes; source text and compiled meaning
are retained together through pins, cleanup, Keep and native/local persistence.

Extend trusted `NativeModelMethod` installation with a synchronous scalar handler that receives
validated values/units and derives a concrete output value/unit. Its declared `*` units apply only
inside this installed model adapter, never to the ordinary fixed-unit scalar request protocol.
Exactly one evaluator must be installed. Nonfinite, malformed, asynchronous, wrong declared units
and forged interpretation fields refuse projection. Portable records name method versions; they
cannot install handlers. Fixed-unit legacy evaluators keep their previous behavior.

The authored compiler installs arithmetic +, -, *, /, bounded powers, negation and identity using
the existing worksheet dimensional evaluator. It normalizes authored input/default/output units to
canonical SI spelling. Exact-unit bindings still require review. Absolute Celsius, solvers, circular
or unresolved source, constraints and ambient worksheet relationships are outside this subset.
Support at most 32 equations/inputs/outputs, 256 graph nodes and the existing 64 canvas model views.

A `canvas-model-outputs-request@1` declares whole-instance and public-output references and lowers
all selected scalar values into the existing typed request protocol. The installed checked method
requires output equality with captured values/interpretation. Scalar and typed models and the Python
sampler use the same scheduler, receipt clock, resource and durable capture paths. The composition
root dispatches installed typed methods; no renderer or feature result store is added.

New instances pin definitions. Publishing revisions does not update instances. Reviews use the
existing interface-diff contract and exact accepted document; applying one atomically revises the
instance and its output request. Incompatible/removed bound inputs refuse unless the engineer
explicitly reviews resetting bindings. Kept comparisons retain old source, request and input meaning.
A focused source editor uses the existing renderer-buffer/file-transition port and refuses implicit
publication during file transitions. Existing spring/force commands and V7/legacy readers remain.

## Alternatives and consequences

Generating a method for every unit combination produces a growing implicit catalog. A second model
engine or feature-owned executor/history would duplicate the contracts already proved. Embedding
source as an unreferenced sidecar would lose historical authoring during cleanup. The selected
adapter keeps source/graph coherence and reuses the existing composition/typed evidence protocols.

The compiler and output adapter add production code and bounded synchronous projection work.
Multi-output requests capture all exposed outputs; they can cost more than a single-output scalar
request. Measure graph size, instance count, closure, receipt metadata, Save writes and recovery
separately. This is a scalar authoring feature, not a general solver or interactive capacity promise.

## Validation

Core derived-method tests exercise concrete units and invalid/async/forged output refusal. Canvas
local contracts cover distinct-unit/multi-output definitions, alias and rename identity, independent
instances, CSV and public bindings, pinned publication, review/update/Undo, stale/invalid refusal,
frozen alternatives and native/local continuation. Real browser controls author from blank,
duplicate, compute, revise/review/Undo, preserve invalid/pending source drafts and hand work to a
fresh recipient. A 1/16/64-instance source-backed workload uses 4/12/24 equations and shared receipts
with the unchanged 16 KiB edit-Save hash guard. Current evidence (local-only report)
records verified results and limits; the brief (internal design note) owns acceptance.
