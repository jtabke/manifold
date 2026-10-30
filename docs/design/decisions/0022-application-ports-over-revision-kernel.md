# 0022 Application ports over the revision kernel

**Status:** Accepted as architecture direction and bounded execution seam, 2026-10-27; production API adoption excluded.  
**Date:** 2026-10-26, America/Los_Angeles.  
**Related:** [Application contract](../application-interfaces.md),
[primitive audit](../primitive-basis.md), probe brief (internal design note).

## Context and options

The small tested basis already supplies stable lineage, typed revisions, selected
references, atomic operations, scalar evidence, resources and guarded persistence.
The current canvas still adapts legacy worksheet scope and distinct app result records.
Generic source projections can represent a vector; the execution contract cannot yet
accept one. More kernel record kinds would not solve that interface restriction.

Compare growing worksheet/component callbacks, adopting a universal graph/event-log
framework, and composing domain adapters above the existing revision kernel. A distributed
or collaboration-first architecture is a separate option with unresolved merge semantics.

## Decision

Use a modular application with explicit read, command, exploration, computation,
resource, workspace and maintenance ports. Session state remains host-local. One owner
accepts authored changes; checked evidence has a separate lifecycle. Pure schema/domain
rules own interpretation; adapters own I/O. Keep current supported records and formats
while proving compatibility adapters. The [design](../application-interfaces.md) specifies
authority, lifetime, stale guards, failure paths and cost obligations.

Do not declare View/Alternative collections irreducible or migrate them by implication.
Do not install the proposed type sketch as a second runtime. Start with the bounded
scalar/non-scalar execution probe, then wrap one existing canvas operation. Keep the
freeform canvas interaction contract and current UI.

## Consequences

Features, alternate representations and AI can share the same admission rules. Portable
work stays independent of a particular server, view or execution provider. Large data
can remain behind exact asset handles. Costs and failure modes are explicit at adapters.

The design adds transient capability/lifetime bookkeeping and typed adapter validation.
The isolated typed-execution proof now covers retained snapshots/plans, verified leases,
bounded scheduling and portable evidence. Full app subscriptions, asynchronous provider
transport and production integration still require implementation evidence. Local CAS supplies conflict detection, not
collaborative merging. Cross-tool writes require reconciliation rather than a fictitious
distributed atomic commit. Existing synchronous trusted model evaluation is not a safe
host for arbitrary plugins.

## Validation and review

Compile checks cover interface direction and nine invalid type substitutions/actions.
They cannot accept the runtime design. Use the probe's matrix (internal design note)
and existing compatibility/regression suites before promoting an interface. Reconsider
if richer input meaning requires undeclared reads, capture loses provenance, leases
prevent bounded retention, or adapter overhead materially harms the working loop.
No production schema, container or public SDK is accepted by this record.

2026-10-27 review: 21 execution scenarios and the bounded diagnostic (local-only experiment)
pass using the existing authored owner and a scalar compatibility adapter. Retain frozen
selection/sequence in typed receipts outside the execution key; transfer plan leases at
admission; validate with those leases; make cancellation idempotent; expire adapter I/O
at settlement. Derive keys on portable Open rather than duplicating canonical manifests
in the package. These revise the initial type sketch. Accept this design direction and
proof boundary; implement a single existing-canvas adapter next, with separate evidence.
