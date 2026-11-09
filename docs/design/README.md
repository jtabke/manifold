# Software design

Manifold's design must connect product intent, engineering semantics, interaction,
architecture and delivery. A roadmap alone cannot resolve contracts shared by
many features. Start here when a proposal changes how the system works.

Start with the [primitive basis and reduction review](primitive-basis.md) for the current semantic
basis, executable removal witnesses and remaining consolidation questions. It distinguishes accepted
behavior from representation choices and proposed broader engineering ontologies.

The [foundation and application interfaces](application-interfaces.md) turn that basis
into a module/ownership design, with a type-checked interface sketch, explicit
resource/job/snapshot lifetimes and a staged adoption plan. The
typed execution proof (internal design note) now passes the scalar/vector
boundary in isolation; [ADR 0028](decisions/0028-shared-typed-execution-evidence.md)
implements the typed adapter in the shared production foundation; [ADR 0029](decisions/0029-canvas-sampler-on-shared-evidence.md)
now adopts it for canvas sampling and retires the separate result/clock/storage lane. The [readiness audit](foundation-readiness.md) maps requirements
to historical design evidence. Current production ports and adoption verification are in the
[canvas extension guide](canvas-extension-patterns.md) and application acceptance audit (internal design note).
ADRs [0032](decisions/0032-portable-authored-canvas-scene.md) and
[0033](decisions/0033-atomic-layout-and-renderer-input-boundaries.md) finish authored scene and input boundaries.
The broader interface sketch remains a design baseline, not a shipped universal SDK.

The architecture-foundation brief (internal design note), F1–F3
experiments and earlier design proposals preserve the development sequence and tradeoffs.
They do not override current production contracts. The shared application foundation and
existing-canvas adoption are complete within the acceptance audit (internal design note).
Broader engineering ontologies, general solvers, partial-source access and a universal SDK
remain proposals or future feature gates.

For implemented state transitions, ownership, recovery and known gaps, use the
[state workflow inventory](state-workflows.md).
For code ownership, package imports, checks and evidence locations, use the
[repository map](../repository.md). Keep current contracts here and decision history in ADRs;
update the owning document when a decision changes rather than appending another status narrative.

## Design views and authority

| View | Purpose | Maintained artifact |
| --- | --- | --- |
| Product intent | Users, outcomes, enduring principles and exclusions | [Vision](../vision.md), [product plan](../product-plan.md) |
| Domain | Shared vocabulary, identity, relationships and invariants | [Domain model](domain-model.md), [concrete records](data-model.md) |
| Experience | User journeys, operations, navigation and interaction behavior | [Interaction design](../interaction-design.md), experience briefs (internal design note) |
| Architecture | Deployment, ownership, read/write permissions and I/O contracts | [Architecture](architecture.md), [application interfaces](application-interfaces.md), [two block-diagram views](system-block-diagram.html) |
| Portability | Native document, assets, identity and clean-environment handoff | [Portable work](portability.md) |
| Quality | Observable correctness, reliability, responsiveness and usability requirements | [Quality and risks](quality-and-risks.md), [scale assessment](scalability-and-flexibility.md) |
| Decisions | Why a consequential choice was made and what it costs | [Decision records](decisions/README.md) |
| Delivery and evidence | Bounded slices, dependencies, checks and observed outcomes | Briefs (internal design note), [roadmap](../ecosystem-and-roadmap.md) |

The domain model owns engineering meaning; interaction design owns how people act
on it; architecture owns implementation responsibilities. A brief links these
contracts rather than redefining them. Accepted decisions update the relevant
design view; decision records retain the rationale and superseded alternatives.

## Design process

For a substantial change:

1. Frame a concrete user scenario and outcome in a brief. Identify affected domain
   concepts, quality scenarios and dependencies before selecting a solution.
2. Sketch the user interaction and the runtime sequence together. Account for
   identity, state ownership, persistence, invalidation, failure and recovery.
3. Compare viable approaches where tradeoffs matter. Use a time-bounded experiment
   when behavior or feasibility is uncertain; specify its question and stopping condition.
4. Record cross-feature decisions in an ADR. Update affected contracts, then
   apply the brief readiness gate (internal design note) before
   implementing a vertical slice with observable acceptance conditions.
5. Link verification and user evidence back to the brief and quality scenarios.
   Record remaining risks and revise the design when evidence changes it.

Small fixes that preserve existing contracts need no new brief or ADR. A change
to identity, scope, storage format, execution, shared commands or external APIs
does need explicit design consideration. Open decisions remain open until their
status and reasoning are recorded; template text is not approval.

## Design backlog

The focused [remove-or-merge review](primitive-basis.md) now supplies concrete witnesses for
retained semantic distinctions and positive controls for ordinary-content views/alternatives.
The first selection consolidation (internal design note) now shares traversal and
guard machinery without a public-record migration. Before further kernel expansion, compare the
remaining representation reductions against current lifecycle,
compatibility and cost obligations. The isolated non-scalar execution proof now passes;
its production adapter remains separate. Canvas instance integration, richer sources, capacity budgets and working-loop
validation remain product work; none requires inventing another base object kind by default.

Use the measurements (local-only report) and
[discriminating scenarios](architecture-options.md#scenarios-that-discriminate-between-architectures)
to judge each change against the vision. Reopen the broader architecture families only when evidence
contradicts a boundary; do not assume the normalized-record ontology is settled.

The first three priorities have linked proposals in the
[decision register](decisions/README.md#proposed-decisions), supported by a
[current operation trace and implementation gate](operation-lifecycle.md).
The [concrete model](data-model.md) and [ADR 0004](decisions/0004-normalized-engineering-records.md)
add executable design evidence and explicit scale/extension tradeoffs. They await
production review gates; they are not accepted or implemented contracts.
Continue this work alongside working-loop validation without expanding that milestone.

| Order | Design question | Dependency / intended output |
| --- | --- | --- |
| 1 | How do definitions, views, contexts and evaluations retain stable identity? | [Identity proposal](decisions/0001-semantic-identity-and-scope.md); review before reusable instances or richer artifacts. |
| 2 | Who owns an edit from command through preview, commit, Undo and persistence? | [Ownership proposal](decisions/0003-workspace-operation-ownership.md) and [operation trace](operation-lifecycle.md); validate one Keep/Undo slice. |
| 3 | What makes a computed result current, reproducible or stale? | [Context and currency proposal](decisions/0002-context-snapshots-and-result-currency.md); validate pinned alternatives and late results. |
| 4 | How do scope and model instances compose without symbol collisions? | Depends on identity and evaluation contracts; requires its own design proposal. |
| 5 | What is the first external-tool contract worth implementing? | Choose a real workflow; specify revisions, source access and execution capabilities. |

## Method references

This structure adapts [arc42](https://arc42.org/overview/) for architecture concerns,
[C4](https://c4model.com/diagrams) for context and runtime structure, and
[architecture decision records](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
for consequential choices. These approaches complement product and interaction
design. Use the views needed to resolve actual questions; do not fill out sections
or draw component diagrams merely to complete a framework.

The implemented [canvas extension patterns](canvas-extension-patterns.md) link the shared owner,
registered scalar models, renderer buffers and portable captures to executable local/browser checks.
The broader application foundation goal (internal design note) remains open.
