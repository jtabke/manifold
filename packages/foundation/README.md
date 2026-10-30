# Manifold foundation

A dependency-free TypeScript foundation for portable, connected work. This is a reusable
0.17.1 package with a functional browser workbench, promoted from the F1–F3 evidence and
extended with coherent alternatives and bounded independent scalar model composition. Runtime code imports nothing from `experiments/`,
React, the canvas application, Node or a UI framework.

```sh
make setup                         # shared development tools, once
make foundation                    # http://localhost:58317
make check-foundation-package      # types, core tests, build and earlier foundation gates
make check-foundation-package-browser
make check-foundation-reducibility # focused remove-or-merge review
make measure-foundation-package
make measure-foundation-retention
make measure-foundation-storage
make measure-foundation-reclamation
make measure-foundation-composition
make measure-foundation-selection
```

Use Node 22.18+; browser checks require installed Chrome. The package uses the repository's
installed TypeScript/Vite/Prettier/Playwright tools rather than another dependency tree.
The workbench is separate from the current canvas and uses `manifold-foundation-*`
IndexedDB databases. It can create notes, edit typed inputs, retain explicit comparisons,
compute, preview/cancel, Keep/Undo, reimport a source, save locally and exchange native files.
The linked `/composition.html` workbench exercises shared model revisions, independent/nested
instances, reviewed public-port connections and updates, source rebinds and portable alternatives.
It can also cite a result and review/apply cleanup of unused revisions, attempts and sources.
Reload restores the last verified local save without executing jobs; a slow restore cannot
replace intervening accepted work or newly typed draft text.

## Primitives and responsibilities

The [primitive basis and reduction review](../../docs/design/primitive-basis.md) distinguishes
necessary semantics from the current record layout. The working data basis is stable identity,
immutable typed state, and qualified references resolved under explicit selection. Atomic changes,
derived reads/checked execution, and resources/durable publication supply the protocol boundaries.
Views and named alternatives are compositions; their dedicated collections are not proven irreducible.
The first selection consolidation (internal design note) now shares one
resolution/traversal engine across capture, validation and preview guards. Existing public records
and native/local formats remain compatible; a pinned root now joins availability guard coverage.

The table below inventories implemented contracts, including those compositions. It is not a count
of independent kernel atoms. The 24 reduction probes (local-only experiment)
include successful ordinary-content representations of presentation and named frozen selections.

| Implemented contract | Responsibility | Deliberately separate |
| --- | --- | --- |
| Document/item identity | Stable targets and selected immutable revisions. | Labels, display position and runtime object identity. |
| Versioned content | Plain JSON plus a trusted schema's validation, references, assets and projection. | Execution and UI frameworks. |
| Qualified reference | Document/item, pin/follow policy and an explicit selector. | Guessed name matching or inferred source continuity. |
| View | Independent renderer, target, position and optional alternative. | A second writable definition. |
| Context | Complete reachable heads/revision whitelist, including recorded absence. | Copying the whole workspace or falling back to a later baseline. |
| Alternative | A named context retained with a comparison view in one operation. | A live branch that silently follows later baseline edits. |
| Operation owner | Validate, publish once and retain bounded Undo selections. | UI callbacks restoring pieces of accepted state. |
| Request and receipt | Explicit method/input requirements and immutable checked execution evidence. | Physical validity, authored relationships and authored Undo. |
| Resource/storage ports | Verified bytes, immutable staging and atomic durable-head CAS. | Domain meaning or executing code merely from Open. |

[ADR 0009](../../docs/design/decisions/0009-reusable-foundation-and-frozen-alternatives.md)
records the initial decision; [ADR 0010](../../docs/design/decisions/0010-retention-and-durable-identities.md)
records retention and lifecycle compatibility;
[ADR 0011](../../docs/design/decisions/0011-incremental-local-snapshots.md) records incremental local snapshots;
[ADR 0012](../../docs/design/decisions/0012-validated-local-recovery-continuity.md) adds validated recovery continuity;
[ADR 0013](../../docs/design/decisions/0013-coordinated-storage-reclamation.md) records coordinated physical reclamation;
[ADR 0021](../../docs/design/decisions/0021-shared-selection-traversal-and-guards.md) records shared
selection traversal, bulk capture construction and complete preview pin coverage. Evidence (local-only report) records source identity,
checks and measured limits.

## Basic authoring API

Import `@manifold/foundation` or `@manifold/foundation/indexed-db` from a workspace
that declares the dependency. These are the public package entry points; production
consumers must not reach into `src`. The runtime imports no application code.

```ts
import {
  createSchemas, createWorkspace, empty, MemoryResources, webHash,
} from "@manifold/foundation";

const workspace = createWorkspace({
  document: empty("my-document"),
  receipts: [],
  resources: await MemoryResources.verify([], webHash),
}, {
  schemas: createSchemas(),
  namespace: crypto.randomUUID(),
});

const result = workspace.owner.apply(workspace.reader.stamp(), "root-1", [{
  kind: "create",
  item: "thought-1",
  label: "An unfinished thought",
  revision: {
    id: "thought-1-r1", item: "thought-1", schema: "note@1", required: true,
    body: { text: "F =", mode: "draft" },
  },
}]);
if (!result.ok) throw Error(result.error);
```

Notes require neither a method catalog nor an executor. Callers allocate fresh IDs
(UUIDs with short prefixes work); labels never bind references. All owner methods return
an explicit success/error result. `reader.read()` exposes immutable data; subscriptions
report affected items, views, alternatives and new receipt IDs. Do not retain UI state as
a second accepted owner. Use `owner.undo()` to restore accepted selections.

`retained()` validates JSON, clones it, and freezes every owned node. That freeze pass
also records proofs in the existing weak `deeplyFrozen()` cache, avoiding a second
descriptor walk over the clone. Generic `freeze()` cannot mint these proofs; arbitrary
caller-frozen graphs still need inspection. Proofs establish only deep JSON immutability,
not schema approval, and every new retention boundary still runs full JSON/depth validation.
JSON validation snapshots all sibling descriptors before descending, without invoking
getters. Compact arrays hold ordinary snapshots; unordered Proxy array-index keys use a
null-prototype ordering fallback, preserving unusual keys and prior reflection order.
This is not an atomic deep snapshot against arbitrary stateful Proxy mutation.
[Ownership and validation contracts](test/retained-json.test.mjs) cover alias isolation,
shared nodes, caller-frozen graphs, malformed data, depth limits and canonical bytes.

Applications may supply a trusted, pure, synchronous `validateDocument(candidate)`
when creating a workspace. Throw to reject application-specific invariants. The owner
runs it on the exact immutable candidate it will publish, after kernel validation and
before changing selections, resources, identity reservations, jobs or Undo. It covers
initial creation, apply, preview, Keep, Undo, Open and cleanup; checked evidence arrival
uses its separate execution validation. Return `undefined`; async validators are rejected.
Do not perform I/O, start work or mutate application state from this callback. Use one
owner call rather than independently preparing and then repeating the operation. The
canvas's [adapter](../../apps/canvas/src/regions/app/canvasDocument.ts) is the production example;
[contract tests](test/domain-validation.test.mjs) exercise failure atomicity and exact
candidate identity. [ADR 0023](../../docs/design/decisions/0023-owner-controlled-domain-validation.md)
records this boundary. Native formats do not store or install validators.

The public `prepare()` and `keep()` functions build pure candidates; they do not publish
into a workspace. Schema `validate`, `references` and `assets` functions must be pure.
`project` is a read boundary that may access the resource port and maintain bounded derived
caches. Register trusted handlers in application code; files cannot install handlers or
execute functions. See [content.ts](src/content.ts) and the additional-handler core test.
A handler's fifth `ProjectionReader` argument reads only schema-declared references in the same
selected document/context. `readFrom(parent, ref)` requires a parent token produced during that
read. Actual transitive origins enter captured scalar inputs and execution keys, so same-valued
upstream revisions cannot silently reuse old evidence. Handler output cannot supply its own
provenance. Values/selectors are immutable and mutable handler/caller aliases are not retained.
Handlers that cite local execution receipts must also implement pure `evidence(body)`.
The built-in `conclusion@1` stores text and receipt IDs; citations must resolve before acceptance.

## Shared models and independent instances

[ADR 0020](../../docs/design/decisions/0020-independent-scalar-model-composition.md) accepts the
bounded adapter. [composition-demo.ts](workbench/composition-demo.ts) shows definitions, native
methods and instances; [models.ts](src/models.ts) exports the typed contracts. Register
`createScalarModels(trustedMethods).schemas` through `createSchemas(extraSchemas)`. The model
adapter imports no application or UI code and adds no model branch to the operation owner.

A definition has stable local node, child occurrence and public port IDs. Each instance pins a
whole definition revision and owns its input bindings and interpretation. `modelPort(id)` addresses
an output; `modelNode(childPath, nodeId)` inspects a full local occurrence path. Inspector addresses
cannot become cross-instance input bindings. Use `reviewModelBinding` and `reviewModelUpdate`,
show the returned source/interface/candidate changes, then revise through the owner against the
stamp captured for that review. Reviews are pure data and do not publish. Templates never upgrade
instances automatically. Stable IDs preserve bindings; removed ports never remap by label.

Native model methods are trusted, bounded synchronous scalar functions, separate from portable
JSON. The adapter lazily memoizes visited nodes within one projection and reports missing bindings,
unsupported methods, incompatible interpretation, cycles and exhausted budgets explicitly. It is
not a general solver or heavy executor. A normal authored `request@1` can consume a model public
port through the existing explicit execution lifecycle. Full template JSON validation still costs
O(selected metadata), even when only a few math nodes evaluate.

## Compute, preview and Keep

[demo.ts](workbench/demo.ts) supplies two external scalar methods and a small engineering
workspace. `createMethods()` pins exact method ID/version/runtime requirements; an executor
receives a frozen snapshot and `AbortSignal`. Output shape, finite values, unit and
subject/frame/condition must match. Basic scalar execution supports exact unit strings,
not a general unit engine, solver or arbitrary code runner.

`owner.compute(stamp, target, scope)` is explicit. Scope is `"baseline"`, `"preview"`, or
`{ alternative: id }`. Results are associated with actual input/method keys and can be
reused after Undo. Availability is rechecked before a receipt can be current. Jobs are
bounded (four by default), including old bindings whose adapters ignore abort. Cancellation
is advisory; general CPU/time/process containment belongs to an executor adapter.

`createTaskScheduler({ concurrency, maxQueued, deadlineMs })` supplies the shared transient
admission protocol. Defaults are four running, 32 waiting and a 30-second advisory deadline.
`submit(signal => adapter(input, signal))` returns a task with `completion`, idempotent
`cancel()` and `state()`. The scheduler owns no document/history/receipt cache. Caller adapters
freeze input and validate output. A cancelled running adapter retains its slot until it
actually settles; a queued cancellation never enters the adapter. `dispose()` refuses new
admission and aborts only that host's tasks. Deadline abort is not executor termination.

Scalar workspaces use this implementation with `maxJobs` running and zero waiting by
default, preserving their admission limit. Supply `scheduler` to `createWorkspace` when
several adapters share a host budget; each workspace still enforces its own `maxJobs` limit
and cancels only its own old binding on Open. The canvas's session sampler uses the same
scheduler, an immutable compact capture, one checked-result admission port and its existing
storage. [Task tests](test/tasks.test.mjs) exercise both standalone and shared-owner behavior.

`owner.preview(stamp, target, overrides)` stages revisions of existing items. It publishes
no authored root and adds no Undo. The preview guard covers the relevant baseline heads
and pinned-dependency availability; layout or unrelated draft changes do not invalidate
Keep. A relevant baseline change requires a new preview. `owner.keep()` atomically retains
the closed context and comparison view; `owner.cancelPreview()` creates no alternative.

Explicitly computing a preview can retain historical evidence even after Cancel. Its
reachable revisions are retained with that receipt, outside authored heads/Undo. Cancelled
or delayed jobs never create alternatives. Kept alternatives stay pinned through later
baseline edits, source reimports and deletion of baseline items. Recorded missing inputs
remain missing; they cannot borrow a later baseline selection.

## Portable work and recovery

`encode()` returns versioned plain native data. `decode()` verifies assets, stages schema/
closure/evidence validation and returns a `Loaded` value; only `owner.open()` adopts it.
Open checks root, evidence version and document binding and starts no jobs. The workbench
also protects newly typed, unaccepted draft text during asynchronous Open.

Native files deduplicate included assets, repeated frozen contexts and repeated input
snapshots. Each receipt keeps its own identity, order and outcome. Package-local table
references are not engineering identities. Runtime jobs, physical AVL nodes, derived
indexes and callbacks are excluded. The writer emits native v4 for typed receipts, v3 for scalar dependency-bearing receipts and v2 otherwise, with durable item/revision/
view/alternative/receipt identity ledgers and an evidence high-water clock. Pruning payloads
cannot permit retired ID reuse or move Save acknowledgement backward. The reader also accepts
[v1](test/portable.fixture.json), deriving lifecycle metadata from available records; it cannot
recover identities absent from that older format. The [v2 fixture](test/portable-v2.fixture.json)
and [v3 composition fixture](test/portable-v3.fixture.json) protect these contracts. This remains a private developer format, without commitment to a final binary/archive container. The application wraps it in its versioned compatibility format.

Unknown required content rejects. Unknown optional content preserves the original package
exactly and makes it read-only; unknown reachability/evidence are not interpreted. Missing
included bytes reject, while unavailable linked bytes can preserve historical evidence
and block current computation. Output validity is never treated as physical validity.

`incrementalStorage()` persists private content-addressed map branches and record payloads.
Use an owner-produced capture; untrusted data belongs in `decode()` / `owner.open()` first:

```ts
const capture = workspace.reader.capture();
const result = await local.save({
  request: crypto.randomUUID(), stamp: capture.stamp,
  document: capture.document.document, expectedGeneration, capture,
});
```

`local` is created with `incrementalStorage(backend, schemas, methods, hash)`. The memory
backend and [IndexedDB adapter](src/indexed-db.ts) support atomic batch staging and durable-head
CAS. `result.writes` reports new chunk/source counts and bytes. Encoder caches use acknowledged
immutable branch/object identities; failed saves never establish reuse. Hot local saves do not
flatten native metadata. Unchanged Save writes no chunks/assets. Full native export is separate.

Within a commit, independent chunk and reference lookups run in batches of at most 64
before durable-head publication. Failed batches settle all their reads before aborting;
later batches do not start. Asset staging stays ordered so duplicate keys cannot hide
conflicting bytes or inflate write counts. Encoding, immutable-byte comparisons, reference
existence checks, epoch/CAS guards and rollback remain unchanged. The
[batch contracts](test/record-backend.test.mjs) cover bounds, failure draining, late conflicts,
missing references, duplicate assets and unchanged clocks after rejection.

`acknowledgementApplies()` checks root, evidence and destination binding. Failures preserve
accepted work and the prior durable head. Reopen verifies graph/asset integrity and runs full
native/domain validation before adoption. Legacy local envelopes remain readable and upgrade
on the next Save; opaque optional content preserves its exact original file. The legacy
`storage()` envelope API remains available for compatibility. No hardware power-loss guarantee
is established.

Initial saves store a full graph with greater metadata overhead than flat native JSON. Local
Reopen retains a verified layout hint on its exact immutable `Loaded` value. Workspace creation
and owner Open still validate the complete document/receipts, then restore saved map shape using
only the validated values. The same storage instance can reuse those branches immediately:
first unchanged Save writes no chunks/assets; a view edit follows changed paths. Passing a
copied `Loaded`, importing a native file, or saving to another destination requires full first
planning. Layout hints never enter native files.

Use `owner.open(stamp, loaded, optionalRuntimeResources)` to install an availability port
without copying `loaded`. Validation uses its loaded resources; subsequent current computation
uses the runtime port. Measurements (local-only report) separate Reopen, full owner adoption and the
following Save. Reopen captures its complete closure in one readonly transaction before
hash/domain work, so concurrent publication/reclamation cannot invalidate that read. IndexedDB
protocol v2 preserves existing data and excludes older uncoordinated clients. The legacy
`storage()` API uses snapshots when supplied by its backend; custom adapters without that
capability must not share a reclaiming namespace.

Incremental save planning cooperatively yields between record work on a soft 8 ms
budget. It uses owned MessageChannel tasks and closes both ports per pause; individual
records are not preemptible. Planning remains bound to its immutable owner capture.
No yield is introduced inside the backend commit transaction, and durable ACK still
requires that exact capture. Generic `recordWriter` optionally schedules dependency-
ready map work through a trusted host callback; its default and direct `pack()` keep
immediate validation. See the [save interleaving contract](../../apps/canvas/tests/check-save-yielding.mjs).

## Reviewable retention

`reader.reviewCompaction(policy)` traces current heads/views, every kept alternative, all
retained Undo selections, active preview/job captures, and typed receipt citations. Evidence
policy is explicit: `all`, `latest-per-input`, or `reachable`; `keepReceipts` adds bookmarks.
The latest evidence for protected working inputs remains available. `keepReferences` adds exact local
pinned content roots for application-owned evidence; missing/foreign/follow roots reject. Their
schema-declared transitive references/assets are protected by the same sealed review. Cited attempts retain
their exact inputs and source bytes, even when a newer attempt exists.

```ts
const review = workspace.reader.reviewCompaction({ evidence: "latest-per-input" });
// Present review.before / review.after and removal counts to the caller.
const nextResources = verifiedResources.retain(review.assets);
const applied = workspace.owner.compact(
  workspace.reader.stamp(), crypto.randomUUID(), review, nextResources,
);
if (!applied.ok) throw Error(applied.error);
```

A review is sealed to the workspace, root, evidence, binding, preview and job lifecycle.
Edits, job start/completion and preview changes require a fresh review. Apply publishes once,
advances both clocks and preserves authored Undo; cleanup itself has no Undo step. Save is
still explicit. Unknown optional/read-only content refuses cleanup. Asset byte deduplication
preserves each source record's identity and declared media interpretation.

This reclaims the current revision/receipt repository and, with `MemoryResources.retain`, the
current verified provider. It reduces subsequent native exports. Existing readers and active
jobs may still hold older immutable objects. Older durable packages, staged orphans and their
assets can leave storage through the separate reviewed reclamation operation below.

## Reclaiming obsolete saved data

Working-history compaction and physical storage reclamation are separate. Save the compacted
workspace first, then review obsolete saved records:

```ts
const review = await local.reviewReclamation();
// Present before / after package, source and payload-byte counts.
const reclaimed = await local.reclaim(review);
```

Review captures a consistent inventory/current-root snapshot and validates the current saved
package. Apply checks its exact head/epoch/mutation revision and deletes only records outside
that root's complete closure. Forged, consumed, cross-instance or stale reviews reject. A failed
transaction deletes nothing. Root, evidence, saved generation and in-memory Undo do not change.
No collector runs automatically; current unsaved work is not implicitly saved.

Deletion advances the storage epoch. Local Saves and pending recovery hints cannot reuse an
older epoch's cache. An incremental Save interrupted by an epoch change replans the same capture once; a
second epoch conflict or durable-generation conflict fails without replacing saved work. The
first later Save pays one full planning pass, then hot reuse resumes. Open work owns its verified
strings and can restage an older selection under normal generation rules. Future lazy/range
providers need an explicit protected-root/lease protocol before claiming this guarantee.

Inspection defaults to 512 MiB of serialized stored payloads and one million records, with
configurable guards. Reported reclaimed bytes exclude keys/index overhead and OS disk allocation.
Retired engineering ID markers stay retained. See evidence (local-only report) for actual deletion,
concurrent readers/Saves, legacy upgrade and first post-epoch planning costs.

## Cost model and current bounds

- Shared AVL maps change logarithmic paths. Active dependency sets support affected-only,
  transitive notifications and tolerate authored reference cycles; they are not a universal
  execution DAG. Direct fanout costs proportional to actual dependents.
- A context captures the reachable selection, not every definition. Alternative contexts
  share immutable source/revision bytes. Undo retains 32 selections by default, configurable
  from 0 to 1024; it never stores full prior revision repositories.
- Source projections check verified availability first, then use an LRU with at most 16
  entries and 8 MiB estimated weight by default. The eager table adapter supports up to
  1,000,000 cells. Weight is a logical estimate, not a measured heap guarantee. Larger or
  asynchronous/windowed sources need a specialized handler/resource provider.
- The portable reader defaults to 64 MiB and bounded record counts. These are configurable
  rejection limits, not supported-capacity claims. Native exports and full Open still flatten
  retained metadata; local Open also restores validated physical shape. Subsequent local saves
  follow changed branches, including the first save after recovery.
- Explicit cleanup is full maintenance work over retained roots and evidence, outside the
  ordinary edit path. Durable retired-ID markers still grow; obsolete stored generations and
  orphans require separate explicit reclamation. Cancelling a preview does not delete computed evidence.
  Alternative removal checks comparison-view closure; this rare path currently scans views.

These limits constrain the implemented package and canvas adapters. The shared application
integration is verified; larger/windowed sources, general solvers/geometry, collaboration,
streaming archives and unfamiliar-engineer understanding retain separate feature gates.
The storage/content/context boundaries let those be added deliberately.

## Adopting this in the existing canvas

The first adoption slice (internal design note) routes accepted
Page/history through the foundation owner. Current canvas composition adds independent scalar
models, reviewed public/CSV bindings and renderer buffers. The sampler now uses the same typed
receipt owner/clock and storage, as recorded in
[ADR 0029](../../docs/design/decisions/0029-canvas-sampler-on-shared-evidence.md).
Native application V7 writes the complete foundation envelope only; V1–V6 are read adapters.
Local writes are ordinary foundation snapshots. The old sampler result map/cache/clock, direct
result-admission API, native sidecar and application bundle writer are retired. Native/local Open
starts no execution and preserved results remain inspectable without the Python transport.

Legacy current and historical results convert at import. Stale observations use their original
request/closed definitions/source pins, with inactive ordinary history records where needed.
Imported order follows both old clock floors; original timestamps remain metadata. A converted
root requires a new Save acknowledgement. The host leases/disposes the entire session and leaves
another owner's injected scheduler usable. The `restore` operation for inactive retained item
revisions remains a kernel command; the application's similarly named old file reader is now only
inside the legacy import boundary. Current files use asynchronous `decodeWorkspace`.

[ADR 0026](../../docs/design/decisions/0026-canvas-model-composition-and-portable-captures.md),
[executable extension patterns](../../docs/design/canvas-extension-patterns.md) and
current evidence (local-only report) record the implemented ports and limits. The six-gate application acceptance audit (internal design note)
now verifies the shared-foundation/existing-canvas goal. [ADR 0033](../../docs/design/decisions/0033-atomic-layout-and-renderer-input-boundaries.md)
closes mixed layout completion and renderer-buffer file guards; `make verify-application-foundation`
is the complete sequential verification path.
Authored scene portability now uses ordinary domain records and pinned named layouts through
[ADR 0032](../../docs/design/decisions/0032-portable-authored-canvas-scene.md); active attention
stays personal. Representative tool input/render/page-JS and process-RSS observations extend current
evidence without establishing all-renderer/source capacity. Routine authoring shares unchanged records, and
[complete retained-capacity policy/rescue](../../docs/design/decisions/0031-coherent-retained-capacity-and-rescue.md)
aligns admission with local recovery and bounded native handoff.

## Complete-state application policy (0.16)

An optional trusted synchronous `validateState(candidate)` sees the immutable document, receipt map
and resource port before initial/Open adoption and every authored, preview/Keep/Undo, compaction or
evidence/resource publication. Throw to reject; return no value. Async hooks reject. The candidate
has no Save/publication authority. Existing `validateDocument` remains the authored semantic gate.
Use state policy for capacity or other rules that must cover authored work and evidence together.
Reentrant writes/teardown reject, including during evidence publication. A refused attempt advances
no checked clock and publishes no assets. See [state-policy tests](test/state-policy.test.mjs).

Canvas admission uses a conservative 64 MiB retained-state bound and 4,096 receipts; local recovery
is bounded to 64 MiB physical bytes. Compact native V7 transport allows 128 MiB with headroom for
validated legacy rescue, followed by admission checks before live Open. Above-policy existing heads
can export verified saved data without adoption/ACK/writes. These are rejection limits, not heap or
interactive capacity claims; per-method/job/source/renderer bounds remain separate.

## Typed execution in the shared owner (0.14)

An ordinary installed schema can project `typed-request@1` with
`{method, input: {schema, body}, output}`. Register its `TypedMethod` through
`createMethods(scalarMethods, typedMethods)` and supply `typedExecutor(snapshot, signal, io)` to
`createWorkspace`. Use the existing `owner.compute`, `reader.result` and receipt collection for both
scalar and richer results. Narrow `receipt.kind === "typed@1"` (or `isScalarReceipt`) before rendering
output. A renderer does not admit output or establish currency. Domain adapters independently check
input/output schemas, interpretation, structure and numerical content.

The executor can read only exact captured asset descriptors and must `await io.stage(asset, data)`
for new output bytes. Staging verifies SHA/size; method content validation precedes atomic receipt and
resource admission. Queued/running work is bounded and input bytes remain leased until actual
settlement. Cancellation expires the resource scope; running uncooperative work still holds its slot.
Verified outputs merge against publication-time resources. A provider-replacement edit must use the
current evidence stamp; managed output bytes survive that replacement. Active jobs retain only their
closed selection's revisions. Reviewed retention traces both input and receipt-only output assets.

Typed receipts use native v4; scalar-only writers preserve v2/v3 and old files remain readable.
Native/local Open starts no execution, including when executors are absent. An unknown method can
remain inspectable; unavailable bytes prevent a current result claim. See
[ADR 0028](../../docs/design/decisions/0028-shared-typed-execution-evidence.md) for limits, removal
witnesses and the full-reader/advisory-cancellation boundaries. The
[geometry fixture](test/typed-fixture.mjs), [tests](test/typed-execution.test.mjs),
[Chrome probe](test/typed-browser-probe.mjs) and `npm --prefix packages/foundation run measure:typed`
exercise the public extension pattern. The canvas now uses this same contract for its sampler; broader parent-goal gates remain open.

## Shared evidence admission and small contexts (0.15)

`maxReceipts` bounds pending plus retained attempts (default 4,096); `maxEvidenceBytes` bounds logical
receipt metadata plus pending reservations (default 64 MiB). Canvas configures 8 MiB. Reservation
includes escaped capture/key/context and bounded output/header space before executor invocation.
Previously imported above-quota evidence stays inspectable; new execution refuses until reviewed
retirement permits it. There is no automatic durable history eviction. These are metadata bounds,
not process-heap or end-to-end export capacity claims. The 10,000-receipt diagnostics configure that
count explicitly. Resource descriptor lists also have a 128 KiB metadata limit.

Immutable selections with at most 16 total heads/whitelist entries use a plain-context value in local
storage; larger contexts keep shared maps. Both reconstruct the same public context and restore
validated warm reuse. Old map-encoded local contexts remain readable. Native formats stay unchanged
by this private storage optimization. See the typed contract tests and current evidence for removal
witnesses, limits, cost comparisons and remaining application obligations.


## Installed scalar model methods with derived units

`NativeModelMethod` installs exactly one synchronous `evaluate(numbers)` fixed-unit handler or
`evaluateScalar(scalars)` handler returning `{ value, unit }`. The latter may declare `*` slot/output
units within this optional model adapter; returned units must be concrete. Output validation preserves
the instance interpretation, rejects extra metadata, nonfinite values, async handlers and wrong fixed
output units. These are trusted host functions; files contain only method identity and model data.
The existing fixed-unit scalar request/receipt protocol is unchanged. Canvas authored equations use
this adapter and the shared typed receipt protocol for general outputs; see [ADR 0035](../../docs/design/decisions/0035-authorable-scalar-models-and-general-outputs.md).
