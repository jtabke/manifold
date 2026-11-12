# Product plan

Use this page to connect Manifold's long-term direction to the next design and
implementation decisions. This is an initial planning baseline, not a commitment
to deliver every capability or a claim that the prototype is validated.

This is the product-prioritization view within the broader
[software design structure](design/README.md). Shared domain and architecture
decisions must be resolved across features, not independently in each brief.

## Where each kind of decision belongs

| Question | Source of truth |
| --- | --- |
| Why does Manifold exist, and what must remain true? | [Vision](vision.md) |
| How should the experience behave across features? | [Interaction design](interaction-design.md) |
| What do engineering concepts mean, and what must operations preserve? | [Domain model](design/domain-model.md) |
| What must a native document carry across computers? | [Portability](design/portability.md) |
| Who owns state, computation, storage and integration contracts? | [Architecture](design/architecture.md) |
| Which quality criteria and risks constrain the design? | [Quality and risks](design/quality-and-risks.md) |
| Why was a consequential technical choice made? | [Decision records](design/decisions/README.md) |
| What belongs now, next, or later? | This plan |
| What works today, and what evidence do we have? | [Roadmap and evidence](ecosystem-and-roadmap.md) |
| What exactly are we designing, and how will we judge it? | Feature briefs (internal design note) |

Change the relevant source and link to it elsewhere. Keep detailed interaction
rules out of the feature inventory and implementation progress out of the vision.

## Current focus

**Make one complete working loop excellent:** start from blank, express an idea,
connect measurements, explore a change, preserve an alternative, and trace the
result. See the working-loop brief (internal design note) for scope and readiness.

The shared application foundation and existing-canvas migration (internal design note)
is achieved and verified. Independent canvas model scopes, shared scalar/sampler evidence,
portable authored layouts, recovery and tested extension patterns are implemented within
explicit resource bounds. The [extension guide](design/canvas-extension-patterns.md) owns
current implementation patterns; earlier experiments and interface sketches retain their stated scope.

The authorable independent scalar model slice (internal design note) adds source-coherent
definitions, arbitrary declared scalar outputs, independent instances and reviewed revision updates
through the shared foundation. Its brief records the bounded implementation and acceptance evidence.
The bounded model-backed analysis slice (internal design note) now adds sweeps, shared
table/curve results and portable kept analyses through the same lifecycle.
Incremental worksheet evaluation/projection and rendering (internal design note) now
passes differential, sparse-work and browser reuse checks within the existing document limit.
Larger source processing and expensive worksheet analysis retain separate engineering gates.

The working loop's unfamiliar-engineer study remains a separate product-validation gate. First rehearse
blank authoring through source-backed exploration and fresh-environment handoff, resolve
observed blockers, then collect unaided evidence and familiar-tool comparisons. The
[repository map](repository.md) describes the supporting maintenance checks.

The initial audience is engineers working through a small calculation they already
understand, sometimes with measurements. This is a validation audience, not a
decision to constrain the eventual product to small calculations.

The existing roadmap establishes this priority. The ordering below proposes how
to organize the remaining work around it. There are no delivery dates yet.

## Capability map and scope

“Now” means necessary to complete or assess the working loop. “Next” means a
candidate after that gate, subject to evidence. “Later” preserves the ambition
without adding it to the current milestone. Prototype descriptions below summarize
the existing documentation; they are not a fresh implementation audit.

| Area | Desired outcome | Documented starting point | Proposed horizon / next decision |
| --- | --- | --- | --- |
| Expression | Capture and revise mathematics, notes and unfinished ideas without setup. | Bounded equation and note authoring; recovery checks. | Now: identify editing and discovery friction in the working loop. |
| Connections | Connect independently authored work with understandable meaning, units and sources. | Reviewed references and CSV relationships. | Now: test whether engineers understand what they connected. |
| Exploration | Change an input, inspect consequences and preserve an alternative. | One-input Vary previews, response plots and alternatives. | Now: assess discovery, acceptance, cancellation and recovery. |
| Inspection and trust | Follow a result to its definitions, measurements and assumptions. | Bounded source tracing and evaluated contexts. | Now: test understanding of provenance and unresolved results. |
| Navigation and continuity | Move around and reopen work without losing context. | Canvas navigation, local recovery and fresh-environment native handoff pass bounded browser checks. | Now: resolve navigation blockers affecting the loop and assess reopening. |
| Commands and visual interaction | Find actions and use them without disrupting thinking. | Context toolbar, search and experimental marking menu. | Now: establish discoverability; keep marking experimental pending comparison. |
| Hierarchy and model views | Organize complexity while preserving engineering identity. | Worksheet boundaries retain global symbols; independent scalar instances use qualified scope and explicit ports. | Next: define the smallest needed improvement from observed complex work. |
| Rich artifacts and external tools | Retain source meaning across computation and representations. | Restricted Python sampling; broader execution and native CAD remain future work. | Later: select a concrete source-to-result workflow before choosing an integration. |
| AI assistance | Make existing operations easier through inspectable assistance. | Experimental local Pi companion supports live inspection and approval-only worksheet/model edit proposals; deterministic integration checks, not model-quality validation. | Next: assess selected-object requests and reviewed edits in a useful manual workflow; autonomous editing and general multiplayer remain deferred. |
| Portability | Save a canvas and continue on another computer or hand it to someone. | Application `.manifold` handoff now preserves native Page/model/CSV/artifact data and durable identities through the foundation Page owner; loaded code stays paused. Artifact definitions/views now share the owner and K1–K5 passes; coherent incremental IndexedDB storage/recovery and tab-conflict detection now pass; protected app retention/cleanup now passes; compact snapshots and pinned source closure now pass through native V7, with sampler and model evidence in one core clock/store; bounded recency and explicitly kept calculations also pass. Bounded independent scalar composition is implemented; portable authored scene/group/tool/named layouts now use the shared owner and pinned layout components; active attention stays personal. General solvers/partial sources and broader renderer/source capacity remain open. | Now: native-document identity/content/source closure in F1 and every later slice; mature container and migration in F5. |
| Sharing and communication | Reuse and communicate connected engineering work. | File handoff is a portability requirement; collaboration is absent; presentation is deferred. | Later: shared services, simultaneous editing and dedicated presentation, based on observed needs. |

Cross-cutting requirements apply to every area: preserve meaning and source
identity; support recovery; make incomplete and unavailable information explicit;
keep controls readable and operable by keyboard; distinguish execution, validity
and requirement satisfaction. Use the interaction contract for detailed behavior.

## Design questions to resolve

These are open questions, not approved feature requests. Each should lead to a
specific observation, prototype or comparison before it expands scope.

| ID | Question | Next evidence or decision | Home |
| --- | --- | --- | --- |
| Q1 | Can a new engineer discover authoring and repair an unfinished expression? | Observe unaided creation, revision and recovery. | Working loop (internal design note) |
| Q2 | Does a reviewed connection communicate the selected record, units and dependency? | Ask the engineer to explain the connection and trace it from the result. | Working loop (internal design note) |
| Q3 | Are previewing, accepting and keeping an alternative understandable? | Observe exploration and restoration of the original calculation. | Working loop (internal design note) |
| Q4 | Does marking improve repeated work enough to justify its complexity? | Compare toolbar, search and marking under the existing study protocol. | [Command experiment](ecosystem-and-roadmap.md#command-interface-experiment) |
| Q5 | When does hierarchy help, and what should a collapsed model reveal? | Capture a real task where flat work becomes difficult; compare exterior options. | [Model interaction contract](interaction-design.md#nested-explorable-models) |
| Q6 | Which external artifact first requires richer source preservation? | Identify a real handoff and the information lost today. | [Preservation contract](interaction-design.md#transformations-preserve-meaning-and-access-to-sources) |

## How work moves forward

1. Capture an idea under its capability area. Give it a user problem and a horizon;
   an idea alone does not join the current milestone.
2. Before substantial design or implementation, create a brief from the
   template (internal design note). Define the smallest useful scope, exclusions,
   open choices and observable acceptance conditions.
3. Resolve local design choices in the brief. For cross-feature or architectural
   choices, link an [ADR](design/decisions/README.md) with alternatives and evidence.
   Update the affected shared contracts when a decision is accepted.
4. Record the readiness decision (internal design note), then implement
   a bounded slice and record checks and remaining limits in the brief.
   Link tasks or pull requests there when they exist.
5. Assess the result against its acceptance conditions. Keep “implemented” separate
   from “validated”; an experiment stays experimental until its decision gate is met.

Review this plan when a milestone closes, evidence changes priorities, or a proposal
would expand scope. Reconcile the horizon, brief status and evidence links together.
Do not turn every idea into a separate document or every design question into a feature.
