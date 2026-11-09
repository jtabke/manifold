# Application state workflows

This inventory describes implemented ownership, not a proposal for a universal state-machine
framework. Follow [extension patterns](canvas-extension-patterns.md) when changing a workflow.
State labels below summarize behavior; they are not additional persisted fields.

## Owners, transitions and invariants

| Workflow and source | States / events / guards | Effects, failure and recovery |
| --- | --- | --- |
| Workspace boot: `app/canvasBootstrap.ts`, `app/CanvasApp.tsx` | Opening → editable, storage-unavailable or recovery-blocked. Validate the durable head before mounting editors. | IndexedDB is authoritative once adopted; an unreadable head must not silently fall back to an older backup. Preserve raw work for rescue/export. Late boot after unmount closes its store. |
| Authored operations: foundation `runtime.ts`, `document.ts`; canvas `document.ts` | Current document → staged candidate → accepted document, or rejection. Apply/Undo/Redo/preview/Keep require a current stamp; disposal is terminal. | The foundation owns immutable accepted state and history. Synchronous batches validate before one publication; unknown command kinds reject, never imply deletion. Rejected batches preserve document, stamp and Undo depth. |
| Worksheet exploration: `app/useCanvasExploration.ts`, `exploration.ts` | Idle → proposal → Accept/Keep/Cancel. Scenario and semantic key guard currency; layout-only changes preserve meaning. | Preview never writes accepted work. Invalid downstream results block acceptance. Accept uses the existing session; Keep and Undo use its atomic history. Recovery attention is local, not another history owner. |
| Computation demand: `artifactComputations.ts`, `samplingExecution.ts` | Demand → capture → scheduled job → retained/discarded receipt. Demand changes cancel obsolete work; detached owners dispose after the remount grace microtask. | Core binding and captured inputs govern admission/currency, not renderer booleans. Failed work supports explicit Run. Imported artifacts start paused. No renderer-owned result cache. |
| Task admission: foundation `tasks.ts`, `runtime.ts` | Queued → running → settled; cancellation of queued work settles immediately, cancellation of running work waits for actual settlement. | A cancelled but uncooperative adapter retains its concurrency slot. Old bindings and disposed owners cannot publish late evidence. Do not release a slot merely because an abort signal was sent. |
| Local save: `app/workspaceFiles.ts`, `app/canvasLocalStore.ts`; foundation `local-store.ts`, `record-backend.ts`, `indexed-db.ts` | Unopened → validated store; dirty → saving → saved/dirty/failed. Concurrent Save calls coalesce; a changed capture triggers another bounded pass. | Commit uses atomic generation compare-and-swap. Acknowledgement identifies the saved capture, not newer work. Conflict/quota failure preserves the previous head and current exportable memory. Retry is explicit. |
| Open/New/Export: `app/workspaceFiles.ts`, `app/useEditBuffer.ts` | Idle → one exclusive transition → idle, including rejection. Finish ordinary drafts, settle React, check buffer/document/evidence identity across asynchronous work. | Open validates an isolated owner before saving/staging/navigation. A changed source aborts; a failed staged destination is discarded best-effort. Unrun Python proposals refuse implicit acceptance/execution. Export remains available after save failure. |
| Retention/cleanup: `app/canvasCleanup.ts`; foundation `retention.ts`, `record-backend.ts` | Saved current capture → reviewed capability → reclaim or reject. Guard session, store, capture, saved head, generation and backend epoch. | A stale review cannot delete storage. Inspection is not cleanup authority for another owner. Review again after edits or cross-tab changes. |
| Connection input: `app/Regions.tsx` | Idle → pressed(pointer, kind) → dragging → review or idle. One initiating pointer owns equation-link and dataset drags; other moves/up/cancel/start events cannot take over. Escape, owner cancellation and blur terminate input. | Drag geometry is transient. Only an explicit reviewed connection writes through the session. Cancellation never writes a restoration. Dataset and equation links retain domain-specific review paths rather than a shared workflow engine. |
| Numeric exploration input: `interaction/useValueGesture.ts`, `interaction/useNumberScrub.ts`, `renderers/MathLine.tsx`, `renderers/ArtifactView.tsx` | Input is idle, pointer-owned or key-owned; only matching pointer-up/key-up can finish. Escape, capture loss, blur, hidden page and owner unmount cancel active input. Accepted-document changes invalidate worksheet-row and artifact input. | The stable math row owns capture/focus while replaceable number leaves only declare ports. Standalone number buttons use the same numeric adapter. Value projection and acceptance stay with the existing exploration owner; no AST or persisted-state changes are required. |
| Layout/drawing: `interaction/useLayoutGesture.ts`, `app/useCanvasScene.ts`, `renderers/DrawingCanvas.tsx` | Owned pointer preview → completion/cancel. Document identity guards authored completion. Docking/regularization require the preview to have actually been displayed. | Timers and capture loss cannot publish after cancellation. One completion submits authored geometry; drawing regularization preserves ordinary ink through normal creation/revision and Undo. |
| Navigation/attention: `interaction/useCanvasNavigation.ts`, `app/useModels.ts`, `app/useWorkspaceMemory.ts` | Pan/pinch, scope changes and deferred camera restoration have local ownership/cancellation. Validate remembered attention against the document. | Cameras, selection, menus and measured heights are not computation or accepted document state. Optional personal-storage failure must not block authoring. Named authored viewpoints are distinct from active attention. |
| Shortcut preferences: `app/useShortcutPreferences.ts`, `renderers/ShortcutCustomization.tsx` | Current preferences → capture/import/edit → validated replacement or unchanged failure. Import request identity and preference revision reject late reads. | Persist before publishing live preferences. Failure preserves both; defaults/help provide recovery. These preferences never enter workspace history or exports. |
| Python sampler: `server.py`, `artifact_sampler.py` | Validate request → isolated bounded child → JSON success/validation error/timeout/unavailable. | Three-second child timeout. Launch `OSError` becomes a sanitized JSON 503; a later request can retry. Existing validation failures remain 400. There is no durable server job/receipt store. |

Canvas paths in the table are relative to `apps/canvas/src/regions`, except the Python files
under `apps/canvas`. Foundation paths are relative to `packages/foundation/src`.

Model-definition and reference forms are ordinary transient buffers submitting guarded commands,
not separate accepted-state machines. Mathematical projections, dependency indexes, result
`current/pending/failed/blocked` views, storage reuse caches and measured layout are derived data;
do not turn them into competing authorities. External HTTP(S) references are metadata, not live
computational imports. The application has local HTTP sampling and subprocess work, but no durable
worker queue, cron, remote provider integration or service-worker recovery mechanism.

## Decisions and bounded improvements

Keep existing owners and discriminated types. No state-machine library, persisted status or storage
migration is required for the demonstrated defects.

1. **Reject unknown runtime commands.** JavaScript callers are not protected by the TypeScript
   command union. An exhaustive dispatch previously treated unknown kinds as `removeAlternative`.
   Explicitly recognize removal and reject everything else, including within a staged batch.
2. **Enforce connection pointer ownership.** Add initiating pointer identity and guard movement,
   completion, cancellation and competing starts. Preserve existing review/acceptance and click behavior.
3. **Classify sampler launch failure.** Translate only worker-launch infrastructure failures into
   `SamplingUnavailable`, then JSON 503 at the HTTP boundary. Do not swallow programming errors or
   expose operating-system details; do not add automatic retries.
4. **Own numeric input explicitly.** The artifact slider uses the small `useValueGesture` hook to
   prevent overlapping pointer/keyboard ownership, reject unrelated completions and cancel interrupted
   work without acceptance. Existing domain callbacks still own value projection and publication.
5. **Retain MathML input at the stable row.** Unit canonicalization and sign changes can replace
   number leaves. `MathLineContent` owns `useNumberScrub`, delegates events by local control identity,
   and captures/focuses the stable `<math>` element. Disposable leaves own neither lifecycle nor
   completion authority. The adapter reuses `useValueGesture`; standalone number buttons share it.
   Current port callbacks and an accepted-document version guard preserve existing semantics.
   `MathLine` invalidates through the content's cancellation port, not its rendering memo dependencies,
   so layout/unrelated edits still reuse every unchanged mathematical subtree.
   Logical focused-control identity outlives each key cycle; active gesture ownership does not.
   Tab and other focus navigation cancel held input, including navigation within the same row.

UX gains are preserved alternatives, predictable mixed-pointer input and actionable retry feedback.
DX/AX gains are explicit rejection/cancellation boundaries and executable transition contracts,
without a second state store or migration obligations.

## Acceptance and evidence

New regression tests reproduce each defect against the old implementation and pass after repair:

- `packages/foundation/test/document-commands.test.mjs`: unknown/missing kinds reject; a preceding
  valid command cannot partially publish; document/stamp/history stay unchanged; valid removal and
  Undo still work.
- `apps/canvas/tests/check-connection-gestures-browser.mjs`: unrelated move/up/cancel events and
  competing starts cannot replace a connection; owner completion opens the correct review; owner
  cancellation/blur leave authored work unchanged. Synthetic pointer events in real Chrome isolate
  identity handling; they are not a physical multi-device usability study.
- `apps/canvas/tests/test_server.py`: mocked process-launch failure returns sanitized 503, followed
  by successful execution on the same server.
- `apps/canvas/tests/check-exploration-input-browser.mjs`: number and artifact input cover foreign
  pointer events, competing modalities, unpaired key-up, completion/Undo, cancellation, real capture
  loss, element/window blur, hidden page and Escape. Artifact unmount is also covered. MathML tests
  observe replacement of the original number leaf while capture/focus survive positive/negative
  unit-syntax transitions, repeated/direction-changing keys, independent key cycles followed by Enter,
  Tab while a key is held, and accepted-document invalidation. The original implementations failed
  foreign-pointer, stable-capture and held-key Tab regressions before repair.

Verification for the delivered slices passed:

- `make check`: repository/docs checks, 6 Python server tests, TypeScript/format/build checks,
  40 canvas local checks and 185 foundation tests.
- `node packages/foundation/test/browser.mjs` and
  `node packages/foundation/test/composition-browser.mjs`.
- `npm --prefix apps/canvas run test:all-browser`: all 32 canvas browser checks pass after the
  numeric-input continuation, including the new input/connection contracts and existing linking,
  dataset, exploration, shortcut, layout and persistence workflows.
- Final diff whitespace check.

These are the phases of `make verify`. The numeric-input and MathML continuations reran
`make check` and all canvas browser checks; foundation browser evidence was reused because its
covered code and builds are unchanged. These contracts do not prove all event interleavings or operational readiness
under hostile/multi-client load.

MathML continuation: final `make check` and all 32 canvas browser checks pass, including expanded
numeric-input, existing exploration/equation editing and incremental subtree-reuse contracts.
Independent review identified lost logical focus after completion and held-key Tab leakage; both
were repaired and covered by focused tests. The full browser gate also caught an overbroad
render-version dependency; the cancellation port repaired it before final qualification. No source
syntax, computation, persistence or external API change is included.

## Remaining risks and next decisions

- **Server capacity:** `ThreadingHTTPServer` has no global sampler admission bound or request-body
  read deadline. Choose server capacity/read-timeout policy and test concurrent/slow clients before
  changing deployment behavior. Browser scheduler limits do not cover other tabs/direct clients.
- **End-to-end cancellation:** aborting browser fetch does not terminate the server's child.
  The child timeout bounds it, but true cancellation needs an explicit server execution owner.
- **Nonterminating adapters:** deliberate scheduler backpressure can occupy slots indefinitely.
  Genuine hard recovery requires terminable execution isolation, not optimistic slot release.
- **Other pointer paths:** live curves in `renderers/CurveRegion.tsx`, sampled-range brushing in
  `renderers/ArtifactView.tsx` and comparison movement in `renderers/Interactions.tsx` remain separate
  handlers. They are not covered by the repaired artifact-value lifecycle; audit their ownership
  before claiming universal mixed-pointer safety.
- **Health semantics:** `/api/health` is liveness despite its `ready` label; it does not verify built
  frontend availability or worker launch readiness. Define required dependencies before changing its
  public response or using it as a deployment readiness gate.
- **Cleanup failure:** abandoned imported destinations are discarded best-effort; browser deletion
  failures may leave unreachable storage. A discoverable orphan-recovery policy would need its own
  storage inventory and safety review, not silent broad deletion.

No irreversible migration or server scheduling redesign is included. Automated checks establish
bounded correctness, not engineering validity, physical-device usability or exhaustive race freedom.
