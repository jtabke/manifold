# 0033: Complete layout gestures and renderer inputs through shared application ports

Status: Implemented; final application verification is recorded in EVIDENCE (local-only report).
Date: 2026-10-28
Related: [Portable scene](0032-portable-authored-canvas-scene.md),
[workspace lifecycle](0024-canvas-workspace-lifecycle-and-typed-commands.md),
[extension guide](../canvas-extension-patterns.md), parent goal (internal design note).

## Audit finding

The scene migration put authored arrangements in the accepted document, but existing region and
artifact moves could publish placement before a separate pointer-up docking/group edit. Artifact
movement also accepted on every pointer move. Cancelling therefore needed a compensating write and
could leave durable intermediate geometry. Three renderers duplicated move/resize input handling.
Equation-pane buffers and unrun Python drafts were absent from the workspace's slow-Open guard.

## Decision and implemented boundaries

[useLayoutGesture.ts](../../../apps/canvas/src/regions/interaction/useLayoutGesture.ts) owns only renderer-local
input geometry. Tools, artifact presentations and response plots use the same primary-button,
zoom-aware move/resize, completion and Escape/blur/pointer-cancellation pattern. No-op completion
submits nothing. Rendered resize bounds match accepted domain bounds. Geometry permits signed world
coordinates. The hook captures a completion/baseline at pointer-down; it has no accepted owner,
history, resource provider, file serializer or storage writer.

`useCanvasScene.finishPositions` accepts final positions plus an optional synchronous staged domain
edit and expected document. It composes sizing, worksheet/kernel-view/artifact/tool placement and
docking/group updates through the existing `session.atomic`. Source/region movement uses this same
completion. `finishTool` retains its exact tool-baseline check. Authored-root guards reject a stale
gesture before publication; evidence-only changes are not treated as authored edits. Current docking
intent is read at completion rather than captured in the pointer-down closure. Promise-returning
layout edits refuse; their rejection is consumed and no staged work publishes.

Cancelling clears transient input; it does not write a restoration edit. The former artifact
per-pointer writer, compensating position writes, separate post-placement scene publication and
renderer-specific geometry handlers are retired. One completed mixed drag is one accepted operation
and one Undo step, although the operation can legitimately change several component records.

[useEditBuffer.ts](../../../apps/canvas/src/regions/app/useEditBuffer.ts) is a React registration helper
over the existing `createEditBuffers` interface. It keeps current callbacks and unregisters on
unmount; it owns no accepted input. Independent literal inputs, equation/note panes and Python
proposals now participate in file-transition inspection. Valid ordinary text finishes through the
existing command/Save path. Python drafts remain deliberate unrun proposals: a file transition
refuses with instructions to Run or cancel/use model code. It never executes or accepts code
implicitly. Rejected explicit code submission preserves the draft and reports the domain error.
Hiding the artifact code inspector preserves its pending draft; a refused transition reveals it.

Finishing multiple independent text buffers can accept valid edits before a later buffer refuses;
the current workspace stays open and exportable. Buffer finishing is not a new compound-edit
transaction. Async Open compares all pending buffers and the accepted capture before adopting a
file. A later pane edit rejects the old read even when it has not changed an accepted document yet.
An explicit review/dialog proposal remains unaccepted until its named action. Active pane arrangement,
camera/selection/navigation and the existing browser title remain personal preferences under the
current product boundary; portable authored canvas arrangements use ADR 0032.

## Counterexamples and verification

| Removed boundary | Observable failure |
| --- | --- |
| Transient input versus accepted geometry | A pointer move changes saved bytes; Escape requires another accepted write. |
| One completion for placement and docking | Region/artifact docking advances the accepted sequence twice and one Undo leaves part of the operation. |
| Current docking intent versus the gesture baseline | Capturing all callbacks at pointer-down completes with an old empty docking target. |
| Authored baseline versus late completion | Undo or another accepted edit during a drag can be overwritten by a stale candidate. |
| Retired representation ID versus an available name | A scene component can take a retired core view's ID and redirect a saved layout link. The existing allocation ledger now refuses it before publication. |
| Renderer buffer versus accepted root | Typing during a slow file read changes no root, so root-only guards discard the newer draft. |
| Explicit Python submission versus ordinary text finishing | Export either silently executes/accepts a code proposal or loses it without observing a pending edit. |

[Layout Chrome scenarios](../../../apps/canvas/tests/check-layout-gestures-browser.mjs) use actual
region/artifact docking, exact sequence increments, primary/secondary presentations, plot sizing,
preview/cancellation, saved-byte preservation and one-step Undo. The
[renderer-buffer scenarios](../../../apps/canvas/tests/check-renderer-buffers-browser.mjs) exercise
refused code submission, explicit model-code recovery, no implicit execution, pane edits during a
slow Open and valid text export. Existing model, command, navigation, exploration, source, retention
and native/local suites remain required. The source-identified tool input/render/memory workload is
rerun against this implementation. Net production LOC and syntax decisions stay measured against
the unchanged baseline; retiring duplicate handlers does not imply net code reduction.
