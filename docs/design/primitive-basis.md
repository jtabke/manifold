# Primitive basis and reduction review

**Review date:** 2026-10-26, America/Los_Angeles.  
**Scope:** Foundation 0.9 reduction review, regressed against the 0.10 selection consolidation.  
**Finding:** Preserve the information and lifecycle distinctions below. Reduce the conceptual
basis to three data roles and three protocol boundaries. Dedicated view/alternative collections
are viable consolidation candidates; their current representation is not established as irreducible.

The executable review (local-only experiment) passes 20 removal witnesses and
four bounded merge controls against the current implementation. Results and source identities (local-only experiment)
record each outcome. This is a review of the kernel we have, not a proof of the smallest possible
architecture for every future tool. The controls establish particular reductions; they do not
complete a compatible runtime or native-file migration. The original 0.9 run (local-only experiment)
is preserved; current results include the first shared-selection implementation (internal design note).

## The retained basis

The smallest supported explanation of the current design has three data roles. Their information
must survive; their exact classes, columns and collection layout are implementation choices.

1. **Stable identity.** Independently address an object across renaming, movement and revision.
   Namespace/authority and independent instance occurrence must remain distinguishable.
2. **Immutable typed state.** Retain what an object meant at a particular version, including its
   interpretation contract. An equal payload is not proof of equal object identity or provenance.
3. **Qualified references with explicit resolution.** Identify whole objects or parts and resolve
   them under a declared revision policy and environment. Frozen resolution must preserve selected
   dependencies and recorded absence. Context is part of this resolution contract; it need not
   have the current `Context` record shape or a separate collection.

Three protocol boundaries preserve behavior over that data:

1. **Accepted changes.** Stage and validate an intent, reject stale work and publish all accepted
   effects atomically. Undo selects authored state. This does not require the current owner class
   or command enum, but it does require one coherent publication decision.
2. **Derived reads and execution evidence.** Projections retain source authority. Explicit
   execution records the actual inputs/dependencies and method, with a lifecycle separate from
   authored edits. Async arrival cannot silently become a new baseline or an authored Undo step.
3. **Resources and durable publication.** Distinguish metadata, verified available bytes and the
   acknowledged durable generation. Availability, capture identity and publication failure remain
   explicit. A persistence adapter is not an additional engineering object type.

Independent presentation is required behavior, but **View is a composition candidate** over
identity, typed state and references. A named frozen alternative is also a composition candidate.
Models, public ports, requests, conclusions and engineering relationships are typed contracts above
this basis. They do not justify additional kernel kinds merely because the UI needs those concepts.

This grouping is explanatory, not a numerical minimality theorem: moving a selector, type tag or
revision policy into another record does not remove the information it carries.

## Method and interpretation

An information-loss witness constructs two valid observations that become identical after a
specific proposed erasure, then demonstrates different required behavior with the existing core.
For example, two references reduced to the same label cannot distinguish 100 N from 130 N. Any
replacement that resolves the ambiguity by introducing another stable key has restored identity
under another name. These witnesses reject the stated erasure, not every possible encoding.

Protocol witnesses exercise actual atomic publication, Undo, resource availability, save-CAS and
acknowledgement behavior. They demonstrate a required ordering or lifecycle distinction, not that
one exact object-oriented API is necessary. Positive merge controls deliberately try simpler
representations, preventing a passing negative test from becoming a defense of every current type.

The controls use the real owner, schema registry, reference resolver, retention and native codec.
They do not copy a second document kernel. Original F1/F1b/F2/F3 worksheet comparisons remain
separate bounded baselines: both representations pass those scenarios. They favor neither a
universal plug-in architecture nor a claim that a direct worksheet cannot evolve equivalent rules.

## Removal counterexamples

The R identifiers refer to individually asserted rows in the review results (local-only experiment).

| Retained distinction | Proposed removal or merge | Concrete counterexample | Evidence and disposition |
| --- | --- | --- | --- |
| Identity versus label | Address objects by display name. | Two items named `F` contain 100 N and 130 N. Label-only references become identical but must resolve differently. | R01. Keep identity; do not require unique display labels. |
| Identity versus payload hash | Treat equal content as the same independently editable object. | Two 100 N items have identical bodies. Editing the first to 200 N must leave the second at 100 N. A body-derived edit target cannot choose between them. | R02. Keep independent identity; deduplicate bytes separately. |
| Revision versus current head | Mutate one value in place or erase pin/follow policy. | After 100→200 N, an old pin must read 100 N while follow reads 200 N. | R03. Keep historical state and selection policy, not a mandated revision-table layout. |
| Namespace/authority | Drop document qualification. | The same local item reference resolves in its document but is unavailable when addressed to an unmounted document. | R04. Keep qualification; globally qualified IDs could encode it differently. |
| Whole object versus selected part | Drop the selector. | Two cells of the same retained table are 20 and 25. Whole-object identity alone cannot select one. | R05. Keep versioned part-selection semantics. |
| Typed interpretation versus raw payload | Drop type/schema meaning. | `{value:3}` projects as 3 mm under one contract and 3 s under another. Raw payload equality cannot recover that interpretation. | R06. Keep typed interpretation; this does not require a separate schema table or the current type-tag position. |
| Frozen environment versus root pin | Freeze only the request revision. | The unchanged pressure request refers to force. Frozen environments before/after a force edit must select 100/200 N independently. | R07. Keep environment selection; full-root snapshots are a viable alternate encoding, M03. |
| Recorded absence versus current lookup | Treat an absent frozen selection as permission to read baseline. | A target absent in the saved environment is later created with 7 N. The frozen read remains missing while baseline resolves. | R08. Keep negative selection information. |
| Presentation identity versus content identity | Store one placement on each definition. | Two views share one draft. Moving the second 400→800 must leave the first at 40 and leave draft content unchanged. | R09. Keep independent presentation; the dedicated view collection remains reducible, M01. |
| Atomic change versus accepted prefix | Accept each step of a compound intent separately. | A rename followed by an invalid numeric revision must publish nothing. Accepting the rename first exposes a partial operation. | R10. Keep atomic acceptance; API packaging can change. |
| Provenance versus numeric equality | Store only the result number. | Two same-valued source revisions both yield 0.04 MPa but have different captured origins and execution keys. | R11. Keep input provenance; numeric equality does not establish currency. |
| Method identity versus numeric equality | Drop method version. | Method versions 1 and 2 yield the same number. They remain different execution requirements and keys. | R12. Keep method requirements; an algorithm's output is not its version. |
| Authored Undo versus result arrival | Put every accepted result on the authored Undo stack. | Compute, edit 100→200 N, compute, Undo must restore 100 N while retaining both attempts. Only the edit adds an authored Undo step. | R13. Keep separate lifecycles; a shared physical record store with explicit channels remains possible. |
| Available source versus cached value | Treat a previous successful read as present access. | Identical document/reference metadata reads resolved with verified bytes and unavailable through an offline resource port. | R14. Keep availability as a runtime fact. |
| Transitive provenance versus projected number | Key a composed value only by its outer instance and scalar output. | An instance still returns 10 N after a same-valued stiffness revision, but its transitive origin changes. | R15. Keep actual dependency provenance; do not freeze a misleading cached number. |
| Complete occurrence versus local name | Resolve nested internals using only local node ID. | `pair/left/k` is 10 N/mm and `pair/right/k` is 20 N/mm. Removing the child path makes the addresses identical. | R16. Keep qualified occurrence identity; no separate instance table is required. |
| Accepted state versus durable head | Treat an unguarded file/storage overwrite as publication. | An edit to 200 N survives in memory while a conflicting Save rejects and the prior durable 100 N remains readable. | R17. Keep guarded durable publication and exportable accepted work. |
| Root versus complete capture identity | Acknowledge saves by authored root alone. | Evidence can arrive without changing the root; Open can change the binding without changing root/evidence. The old acknowledgement must reject in both cases. | R18. Keep capture/lifecycle guards; exact clock fields are not a data ontology. |
| Retired versus never-allocated identity | Discard identity-allocation knowledge with old payloads. | A pruned object's old ID cannot be reused for different content, although a never-used ID can. Otherwise old references could silently retarget. | R19. Keep the no-reuse guarantee; its ledger representation is not irreducible. |
| Authored assertion versus execution plan | Require all authored relationship edges to form an executable DAG. | Two cyclic authored relationships remain valid and traversable. Asking to execute them without a supported method rejects. | R20. Keep assertion/method distinction; no universal automatic solver or relation table follows. |

## Successful reduction controls

### Presentation as ordinary typed content

M01 creates two `audit-presentation@1` items that reference one draft, with zero entries in the
specialized view collection. Moving one leaves both the draft revision and the other presentation
unchanged; ordinary Undo restores its position. After several draft edits expire old Undo entries,
cleanup and native handoff preserve a pinned presentation's original `F =` and the live
presentation's updated `Draft 3`.

**Conclusion:** A separate view record kind/collection is not semantically necessary for those
behaviors. Preserve independent presentation identity, target and renderer contract. A migration
still needs to prove renderer/editing integration, compound Keep, lifecycle compatibility, view-only
invalidation and cost. The control uses text views; it does not establish that generic presentation
items can safely masquerade as scalar engineering inputs. Generic items also allocate content
revisions on movement, which needs comparison with the current lightweight view path.

### Named frozen selections as ordinary typed content

M02 stores a named plain context and explicit pinned closure in `audit-selection@1`, and creates
its presentation in the same owner operation. The specialized alternatives collection remains
empty. After the baseline force changes to 200 N, cleanup/native handoff still reconstruct the
original 0.04 MPa capture through the public context/capture functions, with no retained Undo roots.

**Conclusion:** Naming and retaining a frozen selection does not require a distinct alternative
collection. Keep's semantic guard, preview adoption, pending-job ownership and the scoped-compute
API still depend on today's representation. The control proves stored meaning and closure, not a
replacement for those runtime APIs. Closure can be conservative; equivalent pruning cost is unproved.

### Full immutable root as a frozen environment

M03 reads the same historical 100 N through a retained full document root and through a reachable
context after baseline becomes 200 N. The full root contains seven revisions; the reachable context
selects three in this fixture.

**Conclusion:** Freezing a complete immutable root can replace the current context representation
for this in-memory read. A pin on just the request cannot. Reachable contexts avoid retaining unrelated
work, but this probe does not establish a performance winner, durable full-root encoding or equivalent
cleanup behavior. Keep selection semantics; do not claim the current head-map/whitelist pair is the
only representation. Any shared selection machinery must preserve complete absence and ownership guards.

### Non scalar content and resource projection

M04 registers a fixed mesh mock with verified external asset bytes and a versioned vertex selector.
Authoring, native handoff, a vector-valued projection and unavailable-resource reporting work through
the existing interfaces without an executor or new document/storage branch. The current execution
path rejects the mesh as a calculation request and rejects a vector as a scalar method output.

**Conclusion:** Geometry does not justify another core content identity or persistence mechanism.
It does expose a genuine generality limit: `Method`, captured inputs, outcomes and receipt validation
are scalar-specific. The prototype does not cover topology changes, a real geometry engine, long
jobs or external writeback. Rich result execution remains an explicit design question.

The later typed execution proof (local-only experiment) now exercises
a scalar compatibility adapter and asset-backed vector output through one bounded coordinator,
with frozen evidence selection and source-identified costs. It changes no production kernel or
record format; general execution adoption remains a separate adapter decision.

## Inventory and disposition

| Current construct | Role after review | Implementation disposition |
| --- | --- | --- |
| Document/item IDs; revision IDs | Stable identity and historical state. | Keep information; ID encoding and physical records may change. |
| Schema, immutable body, required/optional policy | Typed state and compatibility boundary. | Keep contract; basic engineering kinds are adapters/default handlers, not a closed ontology. |
| Reference, selector, pin/follow | Qualified resolution. | Keep semantics; namespace and occurrence identity may use another equivalent encoding. |
| Context heads/whitelist; explicit absence | Resolution environment. | Keep meaning; representation can share machinery with root selection. |
| Projection, dependency origins | Derived read and provenance contracts. | Derived results are not a second writable master or an additional authored atom. |
| View and its collection | Presentation composition. | Merge candidate; retain implementation until migration obligations pass. |
| Alternative and its collection | Named selection composition. | Merge candidate; retain implementation until runtime/closure compatibility passes. |
| Command, owner, publication stamp | Atomic transition protocol. | Keep guard/publication behavior, not a required class/command-bus architecture. |
| Undo, preview, Keep | Products of selection and transition rules. | Share lower-level mechanisms where proven; lifecycle semantics differ and cannot be erased. |
| Request, method, snapshot, receipt | Explicit execution and checked evidence. | Keep requirements/provenance/lifecycle; scalar payload contract needs its own extension review. |
| Asset, resource port, native file, local store | Byte authority, transport and durable publication. | Adapter contracts; logical identity and byte deduplication remain separate. |
| SharedMap, dependency indexes, caches, branch encodings | Physical representation and derived acceleration. | Not domain primitives; replace subject to correctness, recovery and cost evidence. |
| Allocation ledgers, evidence/generation/binding clocks | Lifecycle guarantees and guards. | Preserve guarantees; no claim that today's fields/ledger layout are the only mechanism. |
| Notes, quantities, relations, models, model nodes/ports | Typed domain content and adapters. | No new kernel enum/collection solely for a feature; never erase physical meaning into untyped JSON. |

## Decisions before further kernel expansion

The [application interface design](application-interfaces.md) builds on this audit without
adding a persisted primitive. It specifies domain/adaptor ownership and proposes a
typed execution probe (internal design note) before generalizing the
current scalar contract. Representation reductions still require the parity gates below.

Retain the three data roles and three protocol boundaries as the working basis. Treat independent
presentation and named alternatives as compositions in the conceptual documentation. Do not describe
the current view/alternative maps or context encoding as proven irreducible.

The compatible shared-selection consolidation (internal design note) now unifies
resolution, closed traversal and preview guard coverage, with bulk immutable-map construction.
This improves the mechanism without adding a base content kind or changing the stored records.

Next evaluate a bounded consolidation proposal for presentation and named selections. It must compare
current and reduced encodings with the same create/move/Keep/Undo, preview-staleness, delayed-job,
citation, cleanup and native/local compatibility cases, and count allocation/write/retention costs.
A smaller type count is insufficient if it introduces a second accepted owner, false result
invalidation, lost identities or larger ordinary edit costs. Review a migration before removing any
existing public contract or native field; this audit itself supplies no incompatible schema change.

Before broadening execution, exercise a genuinely non-scalar request/result through capture,
late completion, Keep/Undo, failure, source unavailability and fresh-environment handoff. Decide
whether typed result schemas/capabilities can reuse the current execution lifecycle. Do not add a
second solver-specific lifecycle or weaken checked results to untyped arbitrary payloads.

These are the two remaining reduction/generalization experiments, not reasons to reopen every
architecture family. Real external writeback and unfamiliar-engineer workflows still need evidence.
The implementation evidence (local-only report) remains scoped; the audit does
not turn those earlier passing tests into proof of a universal minimal kernel.

## Reproduction

```sh
node experiments/reducibility/check.mjs
make check-foundation-reducibility
make check-foundation-package
```

The focused target checks audit formatting and reruns its 24 probes. The package target also runs
the original F1/F1b/F2/F3 correctness/worksheet gates, strict types, 114 core tests and production
workbench builds. The audit writes only its own `reduction-results.json`; it does not change foundation source
or overwrite earlier source-matched performance/browser reports. Its digest combines the current
foundation source digest with the exact audit harness bytes. Browser and capacity claims remain
those of the separately linked evidence, not additional claims from this read-only kernel review.
