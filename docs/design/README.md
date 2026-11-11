# Software design

Start here when a proposal changes how Manifold works. This section owns engineering
semantics, architecture and invariants; it does not replace the [user guides](../README.md),
[CLI reference](../reference/cli.md), or [API reference](../reference/headless-api.md).
For source locations and package boundaries, use the [repository map](../repository.md).

## Current implementation

The [architecture baseline](architecture.md) summarizes the shared immutable operation owner,
canvas adapters, checked computation evidence, portable records and persistence boundaries.
The [canvas extension patterns](canvas-extension-patterns.md) define the implemented ports
and how to extend authoring, renderers, models, computation and storage without a second owner.
The [foundation package](../../packages/foundation/README.md) documents its public contracts.

Installed application capabilities include worksheet authoring, independent and authored
scalar models, bounded model analyses, restricted sampling, portable arrangements and local
recovery. Headless/API and local CLI adapters use these existing owners. This is not a
universal engineering SDK, general solver platform or arbitrary-code execution service.
Current workflows and checks are linked from the [development guide](../development/README.md).
For implemented state transitions, ownership, recovery and known gaps, use the
[state workflow inventory](state-workflows.md).

## Design views and authority

| View | Purpose | Maintained artifact |
| --- | --- | --- |
| Product intent | Outcomes, enduring principles and exclusions | [Vision](../vision.md), [product plan](../product-plan.md). |
| Domain | Vocabulary, identity, relationships and invariants | [Domain model](domain-model.md), [concrete records proposal](data-model.md). |
| Experience | Journeys, operations, navigation and interaction | [Interaction design](../interaction-design.md); shipped controls in the [canvas guide](../guides/canvas.md). |
| Architecture | Runtime ownership, read/write permissions and I/O | [Architecture](architecture.md), [implemented extension patterns](canvas-extension-patterns.md). |
| Interface proposals | Broader logical boundaries and alternative designs | [Application interfaces](application-interfaces.md), [block diagrams](system-block-diagram.html). |
| Portability | Document closure, assets and clean-environment handoff | [Portable work](portability.md). |
| Quality | Correctness, reliability, responsiveness and usability requirements | [Quality and risks](quality-and-risks.md), [scale assessment](scalability-and-flexibility.md). |
| Decisions | Rationale, consequences, status and supersession | [Decision records](decisions/README.md). |

A proposal is not a shipped contract. Check each page's scope and the relevant ADR status.
The broader domain/data-model and interface sketches are design baselines, not a requirement
to replace the production foundation. The [primitive basis and reduction review](primitive-basis.md)
distinguishes semantic obligations from representation choices. The
[readiness audit](foundation-readiness.md), [architecture options](architecture-options.md),
and [executable model evidence](model/evidence.md) preserve bounded design analysis, not
current product acceptance or workload guarantees.

## Decisions and historical evidence

Use the [decision register](decisions/README.md) for accepted choices, proposed decisions,
and superseded alternatives. ADR numbering and filenames remain stable. Implementation
history belongs there rather than in user guides or repeated migration-status summaries.
Historical experiments and local research can explain a choice, but they do not override
current contracts or become prerequisites for public builds.

In particular, ADRs 0001–0004 remain proposals; later adopted foundation/application
contracts are recorded in their own ADRs. The
[operation lifecycle](operation-lifecycle.md) is a bounded design trace/proposal, not a
replacement for the current [extension patterns](canvas-extension-patterns.md).

## Design process

For a substantial change:

1. Frame a concrete scenario, intended outcome and affected domain/quality contracts.
2. Sketch both interaction and runtime sequence: identity, state ownership, persistence,
   invalidation, failure and recovery.
3. Compare alternatives where tradeoffs matter. Use bounded experiments with an explicit
   question and stopping condition, not a new framework by default.
4. Record consequential cross-feature decisions in an ADR. Update the owning contract and
   implement a vertical slice with observable acceptance checks.
5. Link verification to the affected contract and record remaining limitations separately
   from demonstrated behavior.

Small fixes preserving existing contracts need no new ADR. Changes to identity, scope,
storage format, execution, shared commands or external APIs need explicit design consideration.
Update the relevant view when a decision changes; retain rationale and supersession in ADRs.
Use the [product plan](../product-plan.md) and [roadmap](../ecosystem-and-roadmap.md) for priorities
rather than maintaining a second delivery backlog here.

## Method references

This structure adapts [arc42](https://arc42.org/overview/),
[C4](https://c4model.com/diagrams), and
[architecture decision records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Use the views needed to resolve actual questions; do not create documents or diagrams merely
to fill out a framework.
