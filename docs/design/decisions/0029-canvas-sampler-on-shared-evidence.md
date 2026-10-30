# 0029: Canvas sampling uses the shared evidence owner

Status: Implemented; current verification is recorded in EVIDENCE (local-only report).
Date: 2026-10-28
Related: Parent application goal (internal design note),
[normalized recipes](0027-normalized-sampling-plans.md),
[typed core contract](0028-shared-typed-execution-evidence.md).

## Decision

The actual canvas sampler uses the existing typed core execution path. Scalar model results and
sample series have one receipt map/index, evidence sequence, scheduler, binding, capture, retention
protocol and native/local persistence path. A view observes those receipts; it cannot admit output,
assert currency, choose another executor or maintain an accepted result root. Authored Undo stays
with the same owner and does not erase checked attempts.

`canvas-sampling-plan@1` retains its original whole-selector projection. The additional versioned
`sampling-execution@1` selector lowers the recipe to `typed-request@1`; it does not silently change
the existing selector. A captured compound value retains artifact identity, exact range/input/output,
closed definitions/bindings, code/scalar inputs, context and pinned source observations. Its key is
derived. The kernel supplies actual projection origins and closed selection. No Page metadata or
unrelated CSV enters that selection. Independent canvas model instances still use the scalar adapter.

The installed sampler method independently checks every point against captured engineering meaning.
The optional transport receives only code/scalar inputs, bounded to 64 KiB in each direction. Its
claimed code digest becomes a declared Python-text resource: the executor stages captured code under
that digest, so the existing kernel verifies SHA/size. The method's resource validator also compares
the verified string to captured code. This reuses asset integrity instead of introducing a second hash
implementation or trusting transport metadata. Equal code bytes are stored once per digest. Samples
remain bounded inline metadata (2–501 points); no binary/range or arbitrary Python execution is implied.

`createArtifactComputations` now owns only presentation demand, paused-on-Open intent, cancellation
handles, transient admission errors and settlement observation. It calls `session.compute`, reads
`session.foundation.result`, and projects successful receipts into the existing immutable UI DTO.
There is no sampler scheduler, independent result-retention cache, checked admission function, clock or persistence mechanism. Weak UI projections cannot establish currency or admit evidence.
Its pending observation set includes ignored cancellations until actual settlement. Missing executors
permit existing checked results to display; opening a file starts no computation. Strict remounting
reuses the host; terminal disposal prevents late publication.

## Persistence and migration

Application native V7 contains the complete foundation envelope only. `archive` takes that envelope,
not separately supplied Page/artifact/result state. The conditional V5 writer and V6 sidecar writer
are removed. V1–V6 remain read boundaries. Local writes use the existing foundation snapshot directly;
the old `manifold-canvas-local` bundle is read only. Save/Open guards and acknowledgements use the
single evidence clock. Physical CAS, fault rollback and reviewed reclamation remain unchanged.

One cold sampler migration converts legacy results before establishing a live owner/write binding.
A result matching its current recipe uses that closed request. A stale result uses its original
key/range/code/definitions, never today's artifact settings. Its ordinary inactive history record
and exact pinned observations make a closed core context; complete legacy source payloads can be
restored as inactive revisions when needed. The source hash and numeric series are validated before
adoption. Imported receipt order follows existing core order and the old local evidence-clock floor;
it represents import admission, not reconstructed chronology across the two old clocks. Original
execution timestamps remain metadata. Migration changes the root, requires a new Save, and cannot
be acknowledged against the old durable head. An unchanged validated subsequent recovery writes zero
new chunks. Existing current-format loads retain their physical layout token.

Default artifact summaries prefer the core's current active-selection receipt; a newer alternative or
undone request cannot replace it merely through receipt order. Historical fallbacks prefer the active
context. Live and imported projections use the same capture/key contract.

Reviewed cleanup protects retained Undo/alternatives, current selections, explicit kept evidence,
transient worksheet references and the latest successful observation for restorable artifacts. It
then uses core reachability and asset tracing; there is no second sampler result deletion transaction.
After deleted work leaves retained Undo, its otherwise unreferenced attempts/sources can be retired.

## Bounds and measured costs

The shared owner now bounds pending-plus-retained receipt count and reserves worst-case metadata
before executing. Defaults are 4,096 receipts and 64 MiB of logical receipt metadata; canvas configures
8 MiB. The reservation includes escaped snapshot/key/context plus bounded output/header space.
Completed attempts never silently evict durable history. Existing above-quota imports remain
inspectable, with new execution refused until reviewed retirement permits it. Growth diagnostics
explicitly configure 10,000 receipts; this is not the default product limit. Typed asset descriptor
metadata is bounded to 128 KiB as well as the existing byte/count limits. These are not process-heap
or end-to-end admitted-work/export capacity claims.

Small immutable selections (at most 16 total heads/whitelist entries) use the existing plain-context
value encoding in local storage. Larger selections retain shared map encoding. Both decode to the
same public context; validated warm reuse remains intact. Old map-encoded selections still read.
This removes tiny-map scaffolding without changing a kernel primitive or native format.

The representative two-point receipt initially wrote 7,281 bytes with map-encoded context, and
5,079 after the small-selection change, versus 1,985 for the old sidecar. The shared record carries
closed provenance and the common lifecycle/identity ledger, so it remains larger. Its cost guard is
explicitly revised from 4 to 6 KiB, with the old report preserved as a comparison. The unrelated-source
edit-Save guard stays 16 KiB; no CSV is copied by result arrival. Other costs and net production
LOC/syntax decisions are recorded in current evidence, without claiming net simplification.

## Removal witnesses and acceptance

- Restoring renderer-owned scheduling duplicates execution across representations. Three readers of
  one request submit one core job; unrelated edits/layout submit none.
- Removing closed selection or source pins retains the same result after a same-valued source
  revision. Checked request keys change while old receipts remain historical; Undo reuses exact work.
- Trusting tool digest/points admits changed code or a wrong curve. Staging and independent numeric
  validation reject both without publishing output resources or editing authored inputs.
- Reconstructing an old result from today's artifact corrupts range/code meaning. Legacy complete
  and compact stale snapshots import with their original request, into inactive retained history.
- Keeping another local result root requires another clock/ACK/cleanup lane. The old writer and
  direct admission APIs are absent; migration/Save/CAS and fault witnesses run on one core capture.
- Ignoring the old durable root after migration can mark uncommitted converted work saved. The old
  local bundle test rejects that acknowledgement, then proves a fresh zero-write recovery.
- Picking only the newest artifact observation can export an alternative after Undo while the live
  plot correctly uses an older receipt. Context/Undo/native/local witnesses require the same current
  active-selection summary.
- Unbounded durable retention replaces cache eviction with growth. Shared count/metadata admission
  includes pending reservations; explicit reviewed retirement reopens capacity without silent loss.

Executable checks: [shared application scenarios](../../../apps/canvas/tests/check-shared-sampling.mjs),
[demand/transport lifecycle](../../../apps/canvas/tests/check-artifact-computations.mjs),
[compiler boundaries](../../../apps/canvas/tests/contracts/computations.ts),
[core budgets/context encoding](../../../packages/foundation/test/typed-execution.test.mjs), and the
existing real canvas browser/storage/history suites. The [extension guide](../canvas-extension-patterns.md)
identifies the actual ports. Whole-Page authoring, end-to-end admitted-state/export budgets, authored
scene portability and broader input/render/process-memory acceptance remain parent goal obligations.
