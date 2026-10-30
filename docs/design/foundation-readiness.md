# Foundation design readiness audit

**Scope:** Architecture and interface design requested by the user; reviewed 2026-10-27.
This audit does not equate a design baseline with completion of every product feature,
a public SDK, collaboration or a production capacity commitment.

The intended end state is a clear, defensible set of primitives and application
interfaces that support the [vision](../vision.md), with concrete ownership, extension,
portability, failure, cost and adoption rules. The following evidence establishes that
design baseline and identifies which implementation boundaries remain separate work.

**Production follow-through, 2026-10-28:** The application acceptance audit (internal design note)
and current evidence (local-only report) now track the implemented canvas migration,
shared typed execution, ordinary scene records and complete input/workspace boundaries. The dated
design/counts below remain historical; use the extension guide for current shipped ports.

## Requirement and evidence

| Requirement | Authoritative design / evidence | Finding |
| --- | --- | --- |
| Meaning survives appearance and supports freeform work. | [Vision](../vision.md), [application contract](application-interfaces.md#what-we-build-on), R09/M01 in the [reduction audit](primitive-basis.md). | Identity/revisions are independent of presentation. Unfinished notes are valid. Multiple representations and optional structure do not dictate the canvas layout. |
| A small defensible primitive basis. | 20 removal witnesses and four positive controls (local-only experiment), [inventory](primitive-basis.md#inventory-and-disposition). | Retain identity, typed immutable state and qualified selection/resolution. Views/alternatives/models are compositions; current physical collections are not claimed irreducible. No minimality theorem is asserted. |
| Clear application interfaces and maintainable dependencies. | Typed contract sketch (local-only experiment), [architecture choice and ports](application-interfaces.md#application-ports), [ADR 0022](decisions/0022-application-ports-over-revision-kernel.md). | Read, command, exploration, computation, resource, workspace and maintenance directions are explicit; session state stays local. Closed typed intents and opaque issued handles prevent accidental authority mixing. Runtime enforcement is specified separately. |
| Atomic edits and reversible exploration. | [Owner contract](application-interfaces.md#reads-edits-and-invalidation), existing foundation evidence (local-only report), R10/R13 and current core preview/Keep/Undo tests. | One authored owner stages/validates/publishes; failures publish nothing. Preview and accepted snapshots have distinct types. Undo is separate from result arrival. New facade adoption is a future compatible adapter. |
| Flexible data and exact computation provenance. | [Execution contract](application-interfaces.md#execution-and-extensibility), scalar/vector probe (local-only experiment), transitive/equal-valued revision and method-version scenarios. | Generic typed descriptors and verified assets fit the current basis. Receipts need frozen selection/sequence beyond the key manifest; scalar compatibility remains an explicit adapter. Production generic evidence integration is not silently installed. |
| Portable work and graceful tool/source absence. | [Portability design](portability.md), current native fixtures, fresh-process probe reader (local-only experiment), linked-input and missing-executor tests. | Exact source/evidence closure travels independently of original caches or jobs. Included missing bytes reject; linked absence is explicit. Open is inert. Native and local physical formats remain separate. |
| Robust async and resource lifetimes. | [Lifecycle rules](application-interfaces.md#reads-edits-and-invalidation), probe scenarios (local-only experiment). | Bounded handles/admission, idempotent cancellation, no early slot release, binding guards, lease-backed validation, terminal-state finality and expired adapter I/O have executable witnesses. Real process isolation and lazy-reader transport remain distinct implementations. |
| Scalability and efficiency have a concrete cost model. | [Operation cost/budget table](application-interfaces.md#cost-model-and-operating-limits), selection diagnostic (local-only report), typed diagnostic (local-only experiment). | Shared roots, closure-local captures, derived indexes, source byte sharing and bounded jobs/history avoid mandatory whole-document hot-path work. Explicit full Open/export/cleanup remain broad operations. 1/10/100 source occurrences retain one input asset; metadata/copies and repeated validation are disclosed. No maximum size or p95 promise is invented. |
| Extension and deployment do not change source authority. | [Block diagram](application-interfaces.md#architecture-choice), trusted schema/method boundaries and external-writeback protocol. | Modules can share a process; servers deliver code, run jobs or persist records through separate ports. AI uses the same operations. External writes require remote revision guards and reconciliation, not a fictitious distributed transaction. |
| Methodical buildout and compatibility. | [Five ordered gates](application-interfaces.md#build-order-and-decision-gates), probe exit decision (internal design note), existing foundation/app source-identified evidence. | The first execution proof passes. Next wrap one existing canvas operation, then integrate independent scope and assess representation parity. Each future slice has explicit acceptance/failure/compatibility obligations; none requires an immediate UI or native-format rewrite. |

## Verification boundary

`make check-application-contracts` checks strict types and nine invalid-use boundaries.
`make check-typed-execution` runs the 21 runtime scenarios, real fresh-process handoff
and diagnostic, producing source-identified results (local-only experiment).
`make check-foundation-package` retains the existing F1–F3 correctness/comparison gates,
114 core tests, 24 reduction probes, strict types/formatting and workbench production build.
`make check-docs-worktree` validates local links/anchors and existing diagram summaries
without staging unrelated work. The current source digests distinguish reusable/core and
application evidence; experimental code is not imported into the product.

The current review also passes `make check-canvas` (formatting, build and 23 local checks).
Its source digest remains `sha256:5e17dc7345c242fee2cf5b6b8aa37952ca317f16e146b53917e6a96c0972a0e0`.
The build's roughly 699 kB JS chunk warning is recorded in the cost model; startup
capacity is not inferred from passing a production build.

The design is ready to guide implementation. It supplies no authority to skip the
future adapter/feature gates or to call all production interfaces implemented. Capacity,
unfamiliar-engineer usability, real-tool integration, topology identity, asynchronous
provider transport, partial-reader reclamation and collaboration remain product or
implementation evidence requirements. They are explicitly bounded by this design rather
than hidden in a claim that the foundation already does everything.
