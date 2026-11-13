# Extending the canvas through the shared owner

These are implemented patterns for the current canvas. The broader
[application interface design](application-interfaces.md) remains a target where explicitly marked.
Follow the parent migration (internal design note) and
[composition decision](decisions/0026-canvas-model-composition-and-portable-captures.md) for scoped adoption decisions.

## Authoring content

Install a trusted schema in [foundationModels.ts](../../apps/canvas/src/regions/foundationModels.ts)
or the relevant domain adapter; register it with `canvasSchemas`. Validate exact fields and declare
every reference, asset and evidence link. Portable data never installs executable handlers.
Use qualified references and pin revisions when the feature promises stable historical meaning.
Keep engineering interpretation explicit; compatible units alone do not establish physical equivalence.

[modelCommands.ts](../../apps/canvas/src/regions/modelCommands.ts) demonstrates create/revise/view
batches through `session.applyCommands(commands, expectedDocument)`. The expected immutable document
guards a reviewed operation. `session.atomic(staged => …)` composes synchronous adapters into one
publication and one Undo. A thrown operation publishes nothing. Do not start async work, retain a
staging owner or introduce feature history. Intermediate staged revisions remain immutable and may
be pinned; unnecessary intermediate payloads are a measured optimization obligation, not a reason to
erase referenced revisions.

The legacy Page adapter owns only its registered worksheet records/views. Do not add new Page
collections or broad deletion rules to get a new feature through it. The model example keeps
definitions, instances, observations and requests as ordinary typed records in the same document.

Existing worksheet authoring uses [targeted candidates](decisions/0030-targeted-canvas-authoring.md)
through `PageEdit` inside session/domain operations. Copy the record/container being edited; preserve
unchanged immutable source and kept-calculation branches. Assign a new source descriptor when its
meaning changes. Never mutate accepted Page records or deep-clone the workspace to edit one field.
The candidate builder has no publication authority: the existing owner validates the lowered batch,
publishes it once and owns Undo. Bulk import remains a cold full-validation boundary. Bounded record
scans, solving and recent mathematical snapshot capture are still measured costs.

## Representations and input buffers

[IndependentModels.tsx](../../apps/canvas/src/regions/renderers/IndependentModels.tsx) reads the same owner,
projects data through installed schemas and dispatches commands. A renderer does not accept
execution output, mutate a document or decide result currency. The owner checks installed renderer
targets before publication. Represent missing/unsupported meaning explicitly; do not fall back from
a frozen selection to current baseline heads. Views use the existing durable placement protocol.

Transient form buffers register through [useEditBuffer.ts](../../apps/canvas/src/regions/app/useEditBuffer.ts)
over `createEditBuffers` in
[workspaceFiles.ts](../../apps/canvas/src/regions/app/workspaceFiles.ts). Their `read` participates in
async Open guards; `finish` validates/accepts a draft before Export/Open/New proceeds. Unregister on
unmount. A deliberately submitted preview is a transient proposal, never an implicitly accepted
input. The common workspace facade owns file transitions and saving; representations do not create
their own persistence mechanism. Authored groups/tools/closed/pins and named layouts use ordinary records through
[the scene adapter](decisions/0032-portable-authored-canvas-scene.md). Active camera, selection,
focus, menus and navigation remain personal attention; an explicit named viewpoint can capture a
model scope and camera. Tool move/resize previews locally and submits one atomic edit on completion.
Do not create a local-storage layout owner or a bespoke Undo patch callback.

[Shared layout input](decisions/0033-atomic-layout-and-renderer-input-boundaries.md) uses
`useLayoutGesture` for renderer-local geometry and an application completion callback. The callback
submits `useCanvasScene.finishPositions(placements, stagedEdit, expectedDocument)`; sizing and docking
compose in one existing `session.atomic`. Capture the authored baseline at pointer-down, but read
current docking intent at completion. Cancellation clears transient geometry without a restoration
write. Do not persist per-pointer movement. Both renderer and scene gestures retain the originating
pointer ID: other pointers cannot move, complete or cancel that work. Root pointer-up uses
`useCanvasScene.finishPointer(event)`; its deferred completion is bound to the exact gesture,
not merely a pointer ID that may be reused. Pointer-up freezes the displayed docking intent
and stops its timer before deferred completion. Owned capture loss before pointer-up cancels;
normal release after pointer-up must not cancel that deferred completion. Preserve
native capture release through pointer-up: releasing it early can retarget the ensuing click
onto the canvas. Shared cleanup handles cancellation and completion without restoration writes.
Tool/artifact/plot examples and the real mixed-drag
[Chrome contract](../../apps/canvas/tests/check-layout-gestures-browser.mjs) exercise this pattern.

`planDetach` / `planDock` in `canvasScene.ts` derive complete proposed group layouts from
measured frames. Free departure previews remaining peers live; deliberate docking adds labelled
destination outlines after a stable 450ms hover. Keep those outlines translucent so existing work
remains readable. Anchor docking at the target group, not at the combined dragged bounds.
A release before the preview is committed to the DOM must stay free, and no timer may arm after
release/cancellation/unmount. Alt discards pending and armed docking; releasing Alt starts a fresh
dwell. Completion validates document identity and current geometry, then accepts the shown
coordinates rather than recomputing a different arrangement. A half-screen-pixel allowance for
DOM rounding does not relax authored-data validation or canonical bytes. Changed geometry cancels
safely. Never apply source-group compaction as a second accepted operation after the drop.

`KeyboardShortcuts` offers a reference and personal customization through the existing **?**
control and shared `help.shortcuts` command. `interaction/shortcutBindings.ts` is the one resolver
and strict JSON validator for the five configurable canvas actions. `useShortcutPreferences`
loads/saves its personal browser key, never workspace records, exports or history. Persist before
publishing new live preferences through one publication point; rendering must not overwrite its
current-value ref. Storage failure leaves both unchanged. Imports check size, request identity
and preference revision, then share normal mutation/feedback cleanup rather than a second apply
path. Keep capture identity/key/focus and success/error feedback coherent; omitted defaults may
share already-frozen arrays, never mutable inputs.
`interaction/keyboardShortcuts.ts` resolves configurable rows by stable action ID while retaining
fixed editor/gesture scopes. Update those scopes when changing an actual handler; do not leave a
legacy hard-coded global handler active after remapping it. Composition, AltGraph and dead keys
must not dispatch. A physical-letter fallback is restricted to modified non-ASCII glyphs; ASCII
punctuation is never an alias for an unrelated letter. Binding capture must retain Tab navigation
and modal focus containment. Help's fixed button remains a recovery path even if keys are cleared.
Window-level keyboard owners must skip `isDialogEvent` before preventing default, stopping propagation or acting behind a native
dialog. Native focus containment alone cannot block window capture listeners. Preserve writer
drafts on opening and return focus to a connected meaningful invoker on dismissal, not body.
Help search and configuration changes must not publish workspace edits, perform Undo, mutate
drawing selection or change the camera. JSON/UI configuration share one validator; editor keys
and gestures remain outside the customizable canvas context.

`useCanvasOverlaps` owns temporary overlap attention, not saved layer order. Discover worksheet
representations from their measured content footprints and actual paint order; retain a stable
cycle across temporary reveals. Reuse `CanvasActionMenu` for a keyboard/touch-accessible chooser
only when more than one representation is under the invocation point. Validate that the selected
representation still exists at that point, and keep secondary view IDs distinct from their
computational owner. A temporary DOM attention marker may expose its controls, but must be cleaned
up on selection/document/workspace change or unmount. Panning is navigation, not a new selection.
Never turn this marker into persisted geometry, an Undo record or a second accepted layer owner.
Sketch strokes continue to use their separate drawing selection machinery. Pen hold-to-regularize
uses bounded local fitting in `drawingRegularization.ts`, not an AI executor or a new schema.
Keep original ink separate from the immutable fitted preview; neither a timer nor selection
attention may publish. Require owned capture, an unchanged document and a stable screen-space
hold; cancel timers on movement, completion, capture loss, blur and unmount. Zoom clears a
fitted preview. Only a visible, DOM-committed preview can be accepted; freeze that acknowledgment
before clearing the gesture. A queued timer result alone is not acceptance authority. Release
accepts exactly the displayed fit, or retains ordinary ink after movement.
Keep original ink through an ordinary creation followed by a separate ordinary shape revision,
so Undo first restores ink; if revision fails, keep the valid ink. Do not replace this with feature
history or hidden persisted originals. The keyboard-accessible Regularize button uses the same
fitter and normal guarded edit path. Recognition never infers engineering meaning/dependencies.

Equation-link and dataset-column drags in `Regions.tsx` share one exclusive input boundary:
retain the initiating pointer ID, ignore other pointers' move/up/cancel events and refuse
competing starts until completion/cancellation. Owner cancellation, Escape and window blur
clear transient geometry without publishing work. Completion opens the domain review, not
an accepted connection. The [connection gesture contract](../../apps/canvas/tests/check-connection-gestures-browser.mjs)
checks both kinds; other input paths have separate coverage and must not be assumed safe by analogy.

Notation uses its source spans for pointer selection, not an implicit value scrub or link.
Keep those intents separate: Vary is deliberate, and connections use the link handle/review.
Cancel a source gesture when its text or editing mode changes. Native details disclosures
keep actions/errors available to keyboard users without making selection open an inspector.

`pageLayout.ts` owns default line advance and free-position selection. Rendered heights are
transient observations: use own dictionary keys for region IDs, skip the active draft,
prune removed IDs and disconnect observers.
A continuation may place its new cursor in the existing atomic operation, but must not move
independently placed regions/artifacts to make room. The obsolete temporary artifact-clearance
layer is intentionally gone. Automatic flow may reflow; authored placements and the document's
meaning must not. Error details and feedback are overlays rather than extra flow rows; never
auto-dismiss storage failures or hide their existing retry/export recovery paths.

Equation/note panes finish valid ordinary text through the shared transition port. An unrun Python
draft is an explicit proposal: its buffer refuses file transitions with Run/cancel/model-code guidance.
Open/Export must not execute or implicitly accept it. Buffer reads participate in slow-file guards even
when no authored root changed. The [renderer-buffer Chrome contract](../../apps/canvas/tests/check-renderer-buffers-browser.mjs)
checks this boundary. Closing an editor explicitly can discard its unaccepted proposal. Personal pane
arrangement/navigation remains separate from portable authored canvas records. The
[dockable chrome decision](decisions/0043-personal-workspace-chrome.md) defines the
bounded personal toolbar/panel preference owner. It is not a canvas-scene layout store:
keep chrome changes out of session records and history, preserve stable canvas/tool hosts,
and publish live preferences only after successful validation and storage.

## Worksheet exploration

[useCanvasExploration](../../apps/canvas/src/regions/app/useCanvasExploration.ts) owns transient
worksheet proposals, finite range controls, scrubbing and the last accepted edit's recovery
affordance. It derives the working projection and dispatches explicit Accept/Keep through the
existing session. It does not own accepted history, receipts or storage. The shell supplies explicit
selection, message and comparison callbacks; it retains navigation and Undo command routing.

`isCurrentExploration` in [exploration.ts](../../apps/canvas/src/regions/exploration.ts) supplies
one scenario/semantic-currency predicate to projection, cancellation, Accept and Keep. Layout-only
movement preserves a proposal; a changed semantic selection or scenario makes it stale. Revert
clears transient state without writing a restoration. Range edits and recovery clearing are named
actions, not exposed React setters. The local and real-browser exploration checks cover unchanged
saved work during preview, accepted/kept changes, Undo, invalid downstream results and stale recovery.

The artifact operating-point slider delegates its transient idle/pointer/keyboard lifecycle to
`interaction/useValueGesture.ts`. Only the owning pointer or paired key release may finish.
Capture loss, Escape/Undo/Redo, element/window blur, hidden page, accepted-document change and
unmount cancel active input without accepting a value. Clear ownership before releasing capture,
and let normal pointer-up release capture natively. Idle blur must not discard an already-finished
explicit proposal. The [numeric-input Chrome contract](../../apps/canvas/tests/check-exploration-input-browser.mjs)
checks these boundaries for artifact input and number scrubs.

`useNumberScrub` adapts that lifecycle to number controls. `MathLineContent` owns it on the stable
`<math>` row, with local identity-to-port lookup for disposable `<mn>` leaves. Capture and keyboard
focus belong to the row: canonical unit formatting or a sign change may replace the entire inner
number subtree without cancelling or restarting the interaction. Read current port callbacks, retain
the initial drag value, and use the accepted document as `inputVersion`; preview text is not a
cancellation version. Version changes call the content's cancellation port from `MathLine`; never
add the accepted document to the notation memo dependencies. Layout/unrelated edits must still
reuse unchanged mathematical subtrees, as checked by the incremental worksheet Chrome contract.
Keep logical focused-control identity after key release so separate arrow
presses and Enter still reach the number while the row is focused. Tab keeps its native default
navigation but cancels held input; only the deliberate leaf-to-host focus handoff preserves ownership.
Standalone `ScrubNumber` is a button using the same adapter, not a stateful
MathML leaf. Native source selection remains a separate guarded intent on the row.

Cancellation clears ownership before capture release. Finished explicit proposals survive idle blur;
active gestures cancel on external blur, capture loss, hidden page, Escape, owner unmount or accepted
worksheet changes. The numeric-input contract checks actual leaf replacement, repeated keys,
positive/negative unit-syntax transitions, cancellation and one accepted change/Undo. No source
rewrite, retained AST snapshot, restoration write or second accepted owner is required. Remaining
independent pointer paths are listed in the [workflow inventory](state-workflows.md#remaining-risks-and-next-decisions).

## Computation and optional tools

For the current scalar contract, install method requirements and an executor, then dispatch
`session.compute(reference, scope)`. Read `session.foundation.result` for baseline, preview or kept
scope. The core captures inputs/provenance and admits checked output outside authored Undo. A
renderer reading the same result submits no job. Preview/Keep use the same root owner, and Undo first
reverts an active preview, including on a freshly opened document with no authored Undo history.

The sampler now uses [the same core receipt path](decisions/0029-canvas-sampler-on-shared-evidence.md).
Its root-installed method and optional executor live in
[samplingExecution.ts](../../apps/canvas/src/regions/samplingExecution.ts). The executor receives a
frozen compact job and job-scoped I/O; transport receives only code/scalar inputs. Claimed source
identity uses verified staged code bytes, and the installed validator independently checks points.
The demand service observes core results and owns cancellation intent, never checked output.
Install executors when constructing the host; renderer demand options cannot install another one.
Missing tools must permit inspecting retained work and receipts. Shared count/metadata admission
refuses new work rather than silently deleting durable evidence.

Native writing takes `archive(session.native(capture))`. Both native V7 and local writes contain the
full foundation capture, without a sampler result sidecar. The only older formats are read adapters
through [samplingMigration.ts](../../apps/canvas/src/regions/samplingMigration.ts). Stale imported
results preserve the original request and exact sources, not current artifact settings. A converted
root must be committed before it can be acknowledged saved. Source/code/receipt corruption rejects
before live adoption; Open starts no jobs. Do not introduce a result setter, cache-to-owner admission
path or renderer persistence as another convenience API.

## Retained capacity and recovery

The existing owner can install synchronous `validateState(candidate)` for rules over document,
receipts and resources together. This read-only candidate is not a Save capability. Throw to refuse;
return no value. The canvas uses the same incremental retained-weight policy for authored edits,
preview/Keep/Undo, Open, cleanup and result/resource admission. Do not enforce a feature's durable
capacity only after acceptance or create a separate persistence quota/clock.

[ADR 0031](decisions/0031-coherent-retained-capacity-and-rescue.md) defines the current 64 MiB
admitted/local-recovery bound, 4,096 receipts and bounded 128 MiB native transport. Count UTF-8,
escaping, historical payloads and durable identities, with resource/method/transient limits explicit.
Keep an old over-policy head intact and offer verified saved-work export; inspection is not live
admission. A newer primary never silently falls back to an older backup. Extend
[capacity checks](../../apps/canvas/tests/check-canvas-capacity.mjs) and
[workloads](../../apps/canvas/tools/measure-canvas-capacity.mjs) when adding an asset/content adapter.

## Feature readiness and checks

Before broadening an adapter, record a brief with its meaning, ownership, limits, portable behavior
and removal/merge counterexamples. Require evidence for:

- One accepted batch/Undo, rejection atomicity and stale review rejection, including mixed adapters.
- Independent model scope and explicit binding/interpretation, with no hidden symbol rewriting.
- Preview/cancel/Keep/Undo and relevant/unrelated change behavior in a real canvas workflow.
- Save/Open/local recovery preserving source bytes, checked clocks, frozen meaning and retired IDs;
  corrupt input rejects before adoption and Open starts no jobs.
- Shared admission, immutable captures, checked output, optional-tool behavior and terminal teardown.
- Resource limits and representative sparse/fanout cases; count actual writes/closure/DOM and report
  time/heap methodology. Keep the original LOC/complexity baseline and retire replaced code.

Run `make check` for repository/docs/Python/type/local-test/build gates and `make verify` to
also run both browser suites sequentially. `make verify-application-foundation` is an alias for
`make verify`, not a workload or historical-evidence regeneration target. Local/browser model
scripts are included in the standard canvas runner. Optional measurements, such as
`make measure-foundation-models`, are separate diagnostics; timing alone does not close product
performance gates. The [development guide](../development/README.md) owns current check commands,
focused workflows and diagnostic tooling.

[Sampling plans](decisions/0027-normalized-sampling-plans.md) are the sampler's normalized request
adapter. Compiler projections publish/validate with the worksheet in one batch and retain explicit
source pins. The versioned execution selector lowers them into the shared typed contract; the
original whole selector remains compatible. New schema/compiler meaning requires explicit version
and migration witnesses. Result reads may cache immutable projections but cannot establish currency.


## Authorable independent models

[Authored model commands](../../apps/canvas/src/regions/modelCommands.ts) publish a
`canvas-authored-model@1` source/graph record, instantiate pinned definitions and review/apply
updates through the same session. The [compiler](../../apps/canvas/src/regions/authoredModels.ts)
validates self-contained bounded equations and stable row/port IDs; rename labels without changing
those IDs. Do not serialize callbacks or infer identity from notation. New authored units use
canonical SI spelling; bindings remain explicit exact-unit/interpretation reviews.

The [general output request](../../apps/canvas/src/regions/modelResults.ts) declares public output
references and lowers to the existing typed execution/receipt contract. The composition root dispatches
that installed executor alongside the sampler. Legacy force requests remain read/execution compatible.
Publishing does not update pinned instances; a reviewed update changes the instance and complete
output request in one guarded batch. Explicit reset reviews disclose dropped bindings.

The [definition editor](../../apps/canvas/src/regions/renderers/ModelDefinitionEditor.tsx) holds a
transient source proposal in the shared edit-buffer registry; Publish or Cancel is explicit. Model
cards duplicate pinned definitions, project declared outputs and expose update reviews. Contracts
are in `check-authored-models.mjs`, browser controls in `check-authored-models-browser.mjs`, and costs
in `make measure-authored-models`. [ADR 0035](decisions/0035-authorable-scalar-models-and-general-outputs.md)
records the scope and tradeoffs.

## Model-backed analyses

[Model analysis requests](../../apps/canvas/src/regions/modelAnalysis.ts) capture one followed instance,
its full scalar input interface and exact source/definition closure through ordinary declared reads.
The installed typed method sweeps one public input through the existing scalar evaluator; branches
are detached per-point documents, never live edits or a new state owner. Yield in bounded batches,
check cancellation and fail the whole result on a bad point.

[Analysis commands](../../apps/canvas/src/regions/modelAnalysisCommands.ts) create/revise/remove
ordinary records/views and use the shared preview/Keep/Undo lifecycle. Settings register with the
existing file-transition buffer port. The [renderer](../../apps/canvas/src/regions/renderers/ModelAnalyses.tsx)
reads one receipt for table and curve, pages table rows and keeps point selection transient. Never
show an older result as current after a relevant change. Kept contexts retain old request/source
meaning; removing a live analysis does not remove its kept comparisons.

Run the standard local/browser model-analysis checks and `make measure-model-analyses`.
[ADR 0036](decisions/0036-model-backed-analysis-requests.md) owns current bounds and design costs.

## Worksheet derivation and rendering

Use `project`, `semanticKey` and `curve` through the existing worksheet/document ports. Their one
[adapter](../../apps/canvas/src/regions/worksheetProjection.ts) shares prepared expressions and
immutable evaluation snapshots. Fresh `calculate()` uses the same solver; do not introduce another
resolver or persist a derived cache. Ambiguity/error/order changes may require a conservative full
pass. Always preserve the reserved names of unfinished definitions.

Cache equality proves mathematical reuse only. It cannot establish source provenance, computation
currency or Save acknowledgement; those remain owned by their existing document/receipt interfaces.
Callbacks in reused render trees must dispatch current committed handlers. Add differential cases
and work counters when broadening dependencies, units, projection or formatting.

Run the standard incremental worksheet local/Chrome scripts and `make measure-worksheet-evaluation`.
[ADR 0037](decisions/0037-bounded-incremental-worksheet-derivation.md) records cache limits, read-only
interfaces and remaining scan/render costs.
