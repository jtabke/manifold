# 0009: Reusable foundation and frozen alternatives

**Status:** Accepted for the v0 foundation package and workbench; existing-canvas migration excluded.  
**Date:** 2026-10-25.  
**Related:** [Package/API](../../../packages/foundation/README.md),
evidence (local-only report), F4 brief (internal design note),
foundation sequence (internal design note),
Keep/Undo integration (internal design note), QS1–QS5/QS8/QS9.

The later [ADR 0010](0010-retention-and-durable-identities.md) adds reviewed retention and
native v2 lifecycle metadata. The unbounded-retention consequences below describe this
original v0 decision; its ownership/context boundaries remain in force.

## Context and options

F1–F3 supplied isolated evidence but no independent library that application code could
adopt. F4 requires preview/cancel and retained alternatives whose source/input meaning
survives later baseline edits. Repeatedly adding fixture layers would keep the foundation
coupled to experiments; a broad live-canvas rewrite would put unrelated prototype work
and recovery at risk.

Options were another isolated F4 wrapper, promoting the exact closed F2/F3 fixture ontology,
or extracting a small independent core with explicit schema/resource/method ports. Choose
the third. Preserve earlier experiment code/evidence as baselines; runtime package code
must not import experiments or depend on React/Node/UI frameworks.

## Decision

Provide `packages/foundation` as a reusable TypeScript v0 library and functional browser
workbench. Promote the tested persistent map and staged IndexedDB CAS implementation.
Use immutable versioned JSON content, qualified pin/follow references, independent views,
a single authored-operation owner, explicit execution evidence and portable data.
Trusted handlers supply validation, references, assets and projections. The initial note,
scalar, table-source, request and explicit relationship handlers are useful basic content,
not an accepted universal engineering ontology. Scalar execution is a bounded adapter;
method ID/version/runtime requirements remain distinct from physical relationships.

A context captures the reachable selected heads plus a revision whitelist. Missing selections
are retained explicitly and cannot later resolve through baseline fallback. Traversal is
bounded/iterative and supports authored reference cycles without asserting a solver DAG.
Preview changes no authored head/history. Keep validates its semantic guard and publishes
context plus comparison together. Layout/unrelated edits preserve the guard; relevant
baseline edits invalidate it. Undo restores selections and views while retaining evidence.

Explicit preview computation may retain its inputs and receipt after cancellation. This is
execution evidence, not an authored alternative or baseline change. Later completion cannot
create an alternative. Jobs stay bounded across document bindings, even when abort is ignored.

Portable data shares included bytes, repeated contexts and repeated snapshots while keeping
every receipt's identity, order and outcome. Unknown optional content makes the whole package
read-only and preserves original bytes without guessing unknown closure or evidence meaning.
Unknown required content rejects before adoption. No executor starts merely from opening.

## Consequences

Application code can consume one tested package rather than copy experiment logic. Handlers
extend retained content without changing document identity/operation/storage branches. Ordinary
edits change shared-map paths; alternatives capture reachable data rather than full workspaces.
Source projection caching is bounded and cannot substitute for an unavailable/unverified source.
Save acknowledgement includes authored root, evidence version and destination binding.

All retained records/receipts remain in memory/files; there is no reclamation policy. Full
metadata serialization/validation and high-fanout notification remain growing costs. The
reader/source limits are configurable guards, not product capacity budgets. General execution,
unit/frame conversion, rich native semantics, model composition, collaboration and power-loss
claims require separate evidence. Native v0 files do not migrate existing canvas archives.

## Validation and adoption boundary

The linked evidence records 30 core tests, 18 real-browser groups, fresh-process/fresh-context
handoff, an additional content handler, native fixture stability, previous foundation
regressions, production workbench build and measured definition/fanout/alternative/source/
evidence workloads. This accepts the package/workbench scope only. It does not close the
existing canvas K1–K5 integration gate, QS6 usability or QS7 product budgets.

Next, use F5 measurements to define retention, physical storage and an incremental application
adapter. Begin with one draft/view/Undo/save path; do not create another accepted owner beside
Page/history or replace every archive at once. Reconsider if a different handler requires core
schema branches, pinned absence can become silently available, or complete reachable selections
cannot preserve a richer workflow. ADRs 0001–0005 remain proposed beyond this bounded decision.
