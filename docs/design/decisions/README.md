# Architecture decision records

An ADR records a consequential choice, its context and its tradeoffs. Use one when
a decision affects multiple features, a public or stored contract, quality goals,
or a costly-to-reverse dependency. Routine local implementation choices stay in
the change description.

The shared application foundation and canvas migration (internal design note)
is achieved and verified. Use the [extension patterns](../canvas-extension-patterns.md) for
current contracts. Each record below retains the scope and exclusions at its decision date;
later accepted decisions may complete an earlier exclusion without changing that history.
ADRs 0001–0005 remain proposals; ADRs 0006–0008 concern isolated experiments;
ADRs 0009 onward record package and production adoption. A broader universal engineering
ontology or public SDK is not implied.

## Proposed decisions

Before adopting this register's proposals as a foundation, read the
[2026-10-23 architecture-options assessment](../architecture-options.md). ADRs 0001–0004
remain proposed; semantic primitives and alternative/context policy are under review.

Read in order: identity establishes the targets, context pins their meaning, and
operations own publication and recovery. ADR 0004 makes these proposals concrete
and refines snapshot authority, quantity/computation separation and model scopes.
These proposals make concrete choices for review; they do not describe guarantees already implemented by the prototype.

| Record | Proposed choice | Status |
| --- | --- | --- |
| [0001: Semantic identity, revisions and scope](0001-semantic-identity-and-scope.md) | Opaque semantic IDs, explicit bindings, immutable revisions and independent instance targets. | Proposed |
| [0002: Frozen contexts and result currency](0002-context-snapshots-and-result-currency.md) | Pin alternatives to complete semantic snapshots; distinguish currency from reproducibility. | Proposed |
| [0003: One owner for accepted workspace operations](0003-workspace-operation-ownership.md) | Stage and publish accepted semantics and authored views together; save exact sequences. | Proposed |
| [0004: Normalized engineering records](0004-normalized-engineering-records.md) | Separate quantities/computations/values, use complete pinned selections and typed dependencies, share bytes and bound extension semantics. | Proposed |
| [0005: F1 content/reference/view boundary](0005-f1-content-reference-view-experiment.md) | Keep the tested logical candidate; revise compatibility scans, map copies and history before promotion. | Proposed; F1 disposition: revise |

## Accepted experiment decisions

| Record | Scoped choice | Status |
| --- | --- | --- |
| [0006: F1b shared maps and Undo retention](0006-f1b-shared-maps-and-undo-retention.md) | Continue isolated F2 experiments with tested F1 contracts, shared map paths, derived compatibility and bounded Undo; no production adoption. | Accepted for isolated experiments, 2026-10-24 |
| [0007: F2 claims and save publication](0007-f2-explicit-claims-and-transactional-save-probe.md) | Explicit source-backed claims/relations, atomic aggregate operations and tested browser save/recovery protocol; no production adoption. | Accepted for isolated experiments, 2026-10-24 |
| [0008: F3 requests and execution evidence](0008-f3-requests-and-execution-evidence.md) | Typed requests, captured input/method keys, append-only receipts and root/evidence/binding Save acknowledgement; no production adoption. | Accepted for isolated experiments, 2026-10-25 |

The [operation lifecycle](../operation-lifecycle.md) traces current behavior and
sets a bounded implementation gate. Review these decisions together: frozen
contexts require retained identity, and a reliable Keep/Undo requires one owner.

## Accepted foundation and adoption decisions

| Record | Scoped choice | Status |
| --- | --- | --- |
| [0009: Reusable foundation and frozen alternatives](0009-reusable-foundation-and-frozen-alternatives.md) | Independent JSON content/reference/view core, one owner, reachable frozen contexts, explicit evidence and compact portable metadata. | Accepted for v0 package/workbench, 2026-10-25; existing-canvas migration excluded. |
| [0010: Reviewable retention and durable identities](0010-retention-and-durable-identities.md) | Trace protected meaning, review cleanup and retain identity ledgers/evidence high-water metadata in native v2. | Accepted for 0.2 library/workbench, 2026-10-26; old-database reclamation and canvas migration excluded. |
| [0011: Incremental local snapshots](0011-incremental-local-snapshots.md) | Reuse acknowledged immutable branches/records and atomically publish changed batches, independently of native files. | Accepted for 0.3 hot local saves, 2026-10-26; recovery extended by ADR 0012. |
| [0012: Validated local recovery continuity](0012-validated-local-recovery-continuity.md) | Restore saved local map shape from freshly validated values and preserve destination-local reuse; native files remain independent. | Accepted for 0.4 library/workbench, 2026-10-26; reclamation extended by ADR 0013. |
| [0013: Coordinated storage reclamation](0013-coordinated-storage-reclamation.md) | Capture bounded coherent reads, review obsolete physical records and guard deletion/publication with storage epochs/revisions. | Accepted for 0.5 full-reader library/workbench, 2026-10-26; canvas migration excluded. |
| [0014: Canvas document owner and native handoff](0014-canvas-document-owner-and-native-handoff.md) | One accepted Page/history owner, independent region placement, V1 compatibility and paused-code native handoff. | Accepted for the private canvas Page/history/native adapter, 2026-10-26; artifact/storage migration excluded. |
| [0015: Unified canvas operations and checked artifact results](0015-unified-canvas-operations.md) | Artifact definitions/views share the accepted owner; checked output is separate from Undo; V3 captures save one root/result version. | Accepted for bounded K1–K5 canvas integration, 2026-10-26; storage path superseded by ADR 0016; general execution remains open. |

| [0016: Coherent canvas incremental storage](0016-coherent-canvas-incremental-storage.md) | One generic physical bundle/CAS transaction for authored and checked-result roots, validated recovery/reuse, preserved legacy backups and explicit tab conflicts. | Accepted for the private canvas full-reader path, 2026-10-26; semantic app retention and partial readers excluded. |

| [0017: Canvas retention and storage cleanup](0017-canvas-retention-and-storage-cleanup.md) | Extend the protected revision closure to app checked results; seal reviews, preserve Undo/IDs and separately reclaim acknowledged saved data. | Accepted for bounded app/full-reader cleanup, 2026-10-26; general evidence policy and partial readers excluded. |

| [0018: Computation snapshots and pinned source evidence](0018-computation-snapshots-and-pinned-source-evidence.md) | Exact scalar dependency snapshots, qualified source revision pins and generic retention roots; native V4 includes historical source closure. | Accepted for the bounded sampler/app/native path, 2026-10-26; general execution and session-history policy excluded. |

| [0019: Bounded recency and kept calculations](0019-bounded-recency-and-kept-calculations.md) | Bound temporary math history, share retained source payloads and explicitly Keep typed immutable calculations through the accepted owner; native V5 preserves them. | Accepted for bounded worksheet history/content, 2026-10-26; general audit/citations and F6 excluded. |

| [0020: Independent scalar model composition](0020-independent-scalar-model-composition.md) | Shared pinned templates, qualified occurrence paths, explicit public ports and context-scoped dependency provenance; native v3 for composed receipts. | Accepted for bounded foundation/browser composition, 2026-10-26; canvas scope migration and general solvers excluded. |

| [0021 Shared selection traversal and guards](0021-shared-selection-traversal-and-guards.md) | One bounded selection walk and bulk map construction share capture/validation/preview coverage, including pinned roots; existing public records and formats remain compatible. | Accepted for internal selection consolidation, 2026-10-26; view/alternative migration excluded. |
| [0022: Application ports over the revision kernel](0022-application-ports-over-revision-kernel.md) | Typed application interfaces above the audited basis; frozen evidence selection and bounded scalar/vector execution proof. | Accepted as design direction and isolated seam, 2026-10-27; production API/schema adoption excluded. |
| [0023: Owner-controlled application validation](0023-owner-controlled-domain-validation.md) | Trusted synchronous domain validation of the exact candidate, before selection/lifecycle publication; removes duplicate canvas preparation. | Accepted for the shared transaction slice, 2026-10-27; broader application adoption remains open. |
| [0024: Canvas workspace lifecycle and typed commands](0024-canvas-workspace-lifecycle-and-typed-commands.md) | Closed command payloads, named Undo modes and one Save/Open/New/Export facade over the existing owner/store; retires legacy writers. | Accepted for the current canvas, 2026-10-27; execution/model adoption remains open. |
| [0025: Shared scheduling and session computations](0025-shared-scheduling-and-session-computations.md) | One bounded scheduling implementation and a session-owned sampler port; compact frozen inputs and one checked admission path, with renderer execution retired. | Accepted for scalar scheduling and current sampler, 2026-10-27; generic typed receipts and canvas model scopes remain open. |
| [0026: Canvas model composition and portable captures](0026-canvas-model-composition-and-portable-captures.md) | Registered content survives worksheet writes; independent models, reviewed bindings, shared lifecycle and full capture/native recovery use the existing owner. | Accepted for bounded scalar canvas workflows, 2026-10-28; full application migration remains open. |
| [0027: Normalized sampling plans](0027-normalized-sampling-plans.md) | Owner-validated compact compiler requests remove whole-Page sampler capture before shared typed receipt migration. | Implemented prerequisite, 2026-10-28; generic evidence unification remains open. |
| [0028: Shared typed execution evidence](0028-shared-typed-execution-evidence.md) | Typed/scalar computations share the existing owner, resource leases, checked staging and native/local receipt persistence. | Accepted for the foundation adapter, 2026-10-28; canvas sampler migration remains open. |
| [0029: Canvas sampler on shared evidence](0029-canvas-sampler-on-shared-evidence.md) | Sampler/model jobs share receipts, clock, native/local persistence and retirement; V7 writes one envelope and legacy imports preserve frozen requests. | Implemented bounded canvas migration, 2026-10-28; full goal remains open. |
| [0030: Targeted canvas authoring](0030-targeted-canvas-authoring.md) | Synchronous record candidates share unchanged sources/kept work, then lower through existing owner validation and Undo. | Implemented worksheet authoring refactor, 2026-10-28; bounded scans and full-math costs remain explicit. |
| [0031: Coherent retained capacity and rescue](0031-coherent-retained-capacity-and-rescue.md) | Complete-state policy checks authored/evidence/resource publication; common admitted/recovery bounds, bounded native transport and verified saved-work rescue preserve work. | Implemented bounded capacity contract, 2026-10-28; full goal remains open. |

| [0032: Portable authored canvas scene](0032-portable-authored-canvas-scene.md) | Ordinary index/component records, pinned named model/camera layouts, one owner/Undo/storage, transient tool gestures and read-only sidecar migration. | Implemented for the bounded canvas adapter, 2026-10-28; no new kernel primitive. |

| [0033: Atomic layout and renderer input boundaries](0033-atomic-layout-and-renderer-input-boundaries.md) | Shared transient geometry, one atomic placement/docking completion, stale gestures and complete renderer-buffer file guards. | Implemented in the existing application ports, 2026-10-28; final evidence below. |

| [0034: Workspace boundaries and repository evidence](0034-workspace-boundaries-and-repository-evidence.md) | Root workspace tooling/public imports, canvas responsibility directories, local-only evaluation artifacts and public-checkout CI. | Accepted for repository consolidation, 2026-10-28; public artifact policy updated, runtime/UI contracts preserved. |

| [0035: Authorable scalar models and general outputs](0035-authorable-scalar-models-and-general-outputs.md) | Source/graph-coherent authored definitions, trusted derived-unit arithmetic, general typed output requests and reviewed instance updates. | Accepted for the bounded scalar authoring adapter, 2026-10-28. |
| [0036: Model-backed analysis requests](0036-model-backed-analysis-requests.md) | Bounded scalar sweeps over exact instance/source captures, shared typed execution, table/curve representations and portable kept analyses. | Accepted for single-input self-contained model analysis, 2026-10-28. |
| [0037: Bounded incremental worksheet derivation](0037-bounded-incremental-worksheet-derivation.md) | Shared prepared expression evaluation, bounded disposable projections/curves, immutable results and current-handler mathematical subtree reuse. | Accepted for the existing 256-region application, 2026-10-28. |

| [0038: Versioned scientific scalar math](0038-versioned-scientific-scalar-math.md) | Restricted Math.js numerical/unit operations, explicit source versions and plain quantities across worksheets, models, sampling and native V9 and approved v3 authoring/explicit upgrades. | Accepted for the bounded scientific scalar slice. |

| [0039: Live canvas assistant](0039-live-canvas-assistant.md) | Optional restricted Pi companion, browser-owned proposals and approval-only atomic live edits. | Accepted for the experimental local assistant slice. |

| [0040: Full-control canvas MCP](0040-full-control-canvas-mcp.md) | Local stdio MCP, explicit browser grant, direct atomic edits and registered computation through the live owner. | Accepted for the experimental local external-agent slice. |

| [0041: Scoped agent recovery and jobs](0041-scoped-agent-recovery-and-jobs.md) | Focused MCP reads, typed errors, tab-session guarded mutation recovery, nonblocking jobs, human-selected scopes/activity and chunked native snapshots. | Accepted for the experimental local MCP adapter. |

| [0042: Installable agent tools](0042-installable-agent-tools.md) | Built CLI/MCP distribution, no-provider runtime, local diagnostics and read-only MCP Apps presentation over existing image responses. | Accepted for the experimental local tooling slice. |

## Record lifecycle and template

Create `NNNN-short-title.md` using the structure below. Begin as proposed. Record
review outcome and date when accepted or rejected. If an accepted decision changes,
retain it, mark it superseded and link the replacement. Update the relevant design
view to show the current contract, while the ADR preserves why it was chosen.

```markdown
# NNNN: Decision title

Status: Proposed | Accepted | Rejected | Superseded by NNNN
Date: YYYY-MM-DD
Related: brief, domain invariants, quality scenarios, risks and affected contracts

## Context
What problem, constraints and evidence require a decision?

## Options
What viable approaches were compared? Include retaining the current approach.

## Decision
What is proposed or accepted? State the boundary and consequences precisely.

## Consequences
Benefits, costs, failure modes, migration/compatibility effects and remaining risks.

## Validation and review
How will this be checked? What evidence would cause reconsideration?
Record the review outcome without presenting a proposal as an accepted decision.
```
