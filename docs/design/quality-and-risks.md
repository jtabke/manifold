# Quality requirements and architectural risks

Quality requirements constrain features and architecture together. The scenarios
below translate established product principles into proposed verification criteria.
They are not reports of passing tests. Existing checks are starting evidence and
must be examined for coverage when a change relies on them.

## Quality scenarios

| ID | Stimulus and context | Required observable response | Verification approach |
| --- | --- | --- | --- |
| QS1 Meaning preservation | Move, collapse or change a view of connected work. | Definition identities, bindings, numerical results and semantic execution keys remain unchanged. | Compare semantic state before/after; exercise actual view operations. Covers D1–D2. |
| QS2 Result currency | Change a bound input while sampling is in flight; deliver the old response afterward. | The old response never appears as current for the changed inputs. | Controlled delayed-response check against job keys and displayed state. Covers D3. |
| QS3 Recovery | Preview a value; cancel it. Separately, keep an alternative and Undo. | Cancel restores accepted semantics; Undo restores baseline and prior comparison presentation together. | State and browser workflow checks, including units and invalid downstream expressions. Covers D5. |
| QS4 Honest failure | Break a reference, leave an expression incomplete or lose a source. | Affected information is explicitly unresolved; no hidden old value becomes a current answer. | Dependency and UI checks with missing/ambiguous inputs. Covers D2–D4. |
| QS5 Durability and compatibility | Save/reopen accepted work or import an unsupported archive version. | Supported work preserves identity, bindings and context; unsupported input fails explicitly without replacing accepted work. | Round-trip and failure-path fixtures; define migration policy before changing the format. Covers D1–D3. |
| QS6 Usability and access | An unfamiliar engineer performs the working loop with ordinary input and then keyboard operation where supported. | Record completion, hints, source understanding, focus loss and blocked operations against the brief's acceptance conditions. | Participant study plus keyboard/focus checks; automated mechanics cannot establish usability. |
| QS7 Responsiveness | Edit and vary inputs while dependent views update. | Maintain responsive input and understandable computation feedback under a defined workload. | Benchmark authoring, evaluation and rendering separately. Workload, reference device and latency budgets are still open. |
| QS8 Execution containment | Submit unsupported code, oversized input or a job exceeding execution limits. | Reject unsupported requests, bound work and report failure without claiming a valid result. | Server/sampler boundary tests. General code execution requires a separate threat model. |
| QS9 Portable work | Save a canvas on one machine; load with a fresh compatible reader and no original browser/runtime state. | Supported drafts, source bytes, IDs, reference pins and saved views survive. Missing external tools/sources are explicit; corrupt input does not replace current work; no code runs merely from opening. | Separate-process/core fixtures from F1; clean-browser/device handoff when integrated, plus codec/version and dependency failure cases. See [portability](portability.md). |

QS1–QS5 and QS9 have deterministic acceptance conditions. QS6 needs observed evidence and
an explicit milestone decision. QS7 is intentionally incomplete: choose workloads
and budgets before accepting a scalability or performance design. No arbitrary
object count or latency target is asserted as a product requirement here. The
[proposed workload gate](scalability-and-flexibility.md#workload-and-evidence-gate)
now specifies dimensions and measurements; device, latency and supported-capacity
budgets remain open.

## Latest bounded evidence

The foundation evidence (local-only report) adds reachable frozen
alternatives, atomic Keep/comparison/Undo, baseline/source independence, strict unknown-data
preservation and a dependency-free package/workbench. The current 129 core tests and 34 browser
groups pass, including reviewed retention, typed citations, retired-ID nonreuse and native
v1-to-v2 lifecycle compatibility, incremental saves, validated recovery and coordinated physical
reclamation. Definition/fanout/alternative/source/history, retention and local-write costs are
measured. The first canvas adoption (internal design note) adds Page/history
ownership and native handoff with no execution on Open. K1–K5 (internal design note) now adds unified artifact ownership, coherent
save acknowledgements and delayed-result checks. Canvas incremental storage (internal design note)
adds atomic authored/result publication, tab conflicts, validated recovery and source reuse. Protected app retention (internal design note) adds sealed history reviews, protected
Undo/results and saved-storage rollback/concurrency checks. Computation snapshots/source pins (internal design note)
add dependency-scoped currency and historical CSV closure through cleanup and native V5. Richer
execution/source access and independent composition remain. Recent/kept calculations (internal design note)
add cache bounds, immutable mathematical validation, Keep/Remove/Undo, source-pinned handoff and
Save-failure checks. QS6
usability, QS7 budgets, partial-read source lifecycles and full executor containment remain
open. Native decode still performs full retained-evidence validation.

The active application foundation migration (internal design note) adds
owner-controlled domain validation, typed commands and one canvas workspace I/O facade.
Its 25 local and 15 browser checks include failed/late Open, source-backed native handoff
and save/retry behavior. Source-identified cost gates (internal design note)
cover thirty-nine structural limits for sparse edits, allocation, incremental/source bytes,
bounded scheduling and shared source-backed computation readers.
They mitigate accidental whole-document/source work, but do not close QS7 rendering,
heap, latency or supported capacity. Broader execution and independent canvas model scopes
remain open. [ADR 0025](decisions/0025-shared-scheduling-and-session-computations.md) now removes
sampler execution ownership from renderers and shares its bounded scheduler with scalar owners;
generic typed evidence remains a later integration gate.

F3 evidence (local-only experiment) adds typed request/input/method keys,
delayed-job and Undo reuse, honest output/failure checks, portable receipts with no
execution on Open, and root/evidence/binding Save acknowledgement. Direct fanout and
retained evidence growth are measured. Four active jobs bound concurrency, including
aborted bindings; general executor time/CPU containment is not established. These are
isolated candidate results, not production QS2/QS5/QS8/QS9 closure.

F2 evidence (local-only experiment) now covers explicit competing claims,
native split ambiguity, compound Undo, real browser native handoff and IndexedDB
interruption/stale-save tests. This mitigates candidate-contract uncertainty; it does
not resolve the current application's multiple owners, real adapter semantics, the
participant study or QS7 budgets. Transaction abort/reload is not OS/power-loss evidence.

## Initial risks and uncertainties

| ID | Risk / evidence | Impact | Next mitigation or decision |
| --- | --- | --- | --- |
| R1 | Global symbol uniqueness in the canvas evaluator; bounded independent foundation scopes already pass. | Independent canvas model instances could collide or bind incorrectly. | Integrate the tested model adapter (internal design note) through explicit ports; the canvas limitation remains. |
| R2 | Features could introduce new state owners while shared application adoption is incomplete. | A cross-feature edit could restore semantic state but leave views or saved state inconsistent. | The accepted owner, checked evidence and workspace facade now pass QS3/QS5 regressions. Complete application adoption (internal design note) and require new features to use those ports. This remains a migration risk, not a demonstrated corruption report. |
| R3 | Rich sources and source revisions lack a complete lifecycle contract. | Reproducibility could be implied by metadata that cannot recover the source. | Review [source revisions](decisions/0001-semantic-identity-and-scope.md) and [receipt contract](decisions/0002-context-snapshots-and-result-currency.md); select retention and reproduction policy for the first richer integration. |
| R4 | Current sampling is a bounded local adapter. | Treating it as general execution would exceed its supported capabilities and protections. | Require an executor contract and threat model before broadening code execution. |
| R5 | No established workload/latency budgets. | Architecture could scale to the wrong problem or make editing sluggish. | Measure representative authoring and exploration workloads before optimizing. |
| R6 | Unfamiliar-engineer study remains outstanding. | Existing mechanics may not form a comprehensible experience. | Run the existing working-loop study; connect findings to design choices. |
| R7 | Roadmap records a model viewport failure after reload/re-entry. | Navigation can conceal work and undermine hierarchy. | Reproduce and resolve with a focused browser regression; see the roadmap for the existing report. |
| R8 | Immutable histories and dense snapshot maps can grow independently of changed content. | Normalization may still incur O(A × N) selection entries and unbounded retained source bytes. | Measure the [scale workloads](scalability-and-flexibility.md), choose a physical selection encoding and define retention roots before claiming capacity. |
| R9 | The arithmetic fixture does not establish primitives for native resources, conflicting observations or declarative relations. | A scalable implementation could still encode the wrong semantic foundation. | Compare the [architecture options and P1–P4 probes](architecture-options.md#experiments-before-choosing-a-foundation) before accepting an archive ontology. |

## Traceability

A consequential change should have a short, navigable chain:

**User scenario → brief acceptance condition → domain invariant / quality scenario
→ affected architecture contract → decision (if needed) → implementation and evidence.**

For example, keeping an exploration alternative connects the
working-loop brief (internal design note) to D3/D5, QS2/QS3 and the application
operation/evaluation boundaries. Relevant starting checks include
[exploration](../../apps/canvas/tests/check-exploration.mjs),
[browser exploration](../../apps/canvas/tests/check-exploration-browser.mjs) and
[artifacts](../../apps/canvas/tests/check-artifacts.mjs). These links identify
where to inspect coverage, not a claim that every scenario is already verified.

Keep evidence in the brief or linked check report. This page owns the criteria
and risk register; the roadmap owns current milestone progress.

The [canvas model adoption](decisions/0026-canvas-model-composition-and-portable-captures.md) adds
source-identified 1/16/64-instance capture/storage and DOM/page-JS guards. These cover a bounded scalar
workflow, not process memory, latency distributions, unfamiliar-engineer usability or product capacity.
Current evidence (local-only report) and the
parent goal (internal design note) retain those acceptance obligations.
