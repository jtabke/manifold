# 0032: Portable authored canvas arrangements through ordinary records

Status: Implemented; current checks and measurements are in EVIDENCE (local-only report).
Date: 2026-10-28
Related: Parent goal (internal design note),
[extension patterns](../canvas-extension-patterns.md), [capacity policy](0031-coherent-retained-capacity-and-rescue.md).

## Problem and alternatives

Groups, world-anchored tools, closed/pinned representations and named viewpoints were held in a React
scene state and written to a separate browser key. They did not travel with `.manifold` files and
used ad hoc Undo callbacks. A valid document could therefore open with a recipient's unrelated layout.

Keeping that sidecar would preserve the ownership and portability defect. Putting one serialized
scene in one record would share the lifecycle but make every tool move revise the complete authored
arrangement. Introducing another kernel primitive or generalized plug-in host supplies no missing
semantic distinction. The existing typed records and qualified selections can express this feature.

## Decision and ownership

[sceneRecords.ts](../../../apps/canvas/src/regions/sceneRecords.ts) registers four application schemas:
an index and independent group, tool and named-viewpoint records. They are domain compositions,
not additions to the irreducible primitive basis. `RegionSession.scene` is an immutable read projection;
`setScene` lowers changes into ordinary commands through the existing accepted owner. The worksheet
adapter only deletes records it owns. Native V7 and incremental local Save already carry these records,
their IDs and revisions. No second scene owner, history, Save capability, resource provider or writer exists.

The index identifies current scene components and is present even for an empty authored arrangement.
Scene-owned IDs also check the existing allocated-view ledger: retiring a core view never makes its
ID available to a later scene tool/group/viewpoint. Current artifact representation aliases remain
checked separately. This prevents a later scene component from redirecting old layout links.
Group membership, representation positions and closed IDs are document-qualified layout links; they
do not pretend to be engineering dependencies. Tool source/artifact/context and named model scope
are actual declared qualified references. Unavailable sources/scenarios remain explicit in the renderer.
The normal dependency/result-key mechanism does not treat moving/grouping a representation as math.

Named viewpoints capture the exact group/tool revisions using existing `Reference.selection.pin`.
Shared components occur once in storage even when twelve layouts capture them. Closing a tool
tombstones its current item; a named layout retains the selected revision through cleanup and can
restore it using ordinary commands. Legacy snapshot-only variants are lowered through a single
create/revise/delete/restore batch; intermediate revisions never publish an intermediate workspace.
Named layouts capture arrangement, camera and optional model scope, not frozen engineering values.
Engineering history continues to use the existing alternatives/kept calculations/evidence contracts.

Active camera, focus, selection, navigation history, gestures and menus remain personal attention.
Choosing a named viewpoint explicitly navigates to its model and camera and records personal Back
history. A fresh recipient starts with their own attention state. A missing named model refuses restore
instead of borrowing the active scope. Current scene records never absorb a recipient's legacy sidecar.

## Interaction and migration

[useCanvasScene.ts](../../../apps/canvas/src/regions/app/useCanvasScene.ts) derives accepted layout from
the session and keeps only transient gesture geometry locally. Tool move/resize accepts once on
pointer-up, with docking/group placement in the same atomic batch. Escape, blur and pointer cancellation
discard the candidate. A changed tool baseline refuses a stale gesture. Group placement, artifact and
worksheet arrangement, and named restore compose through `session.atomic`; bespoke scene Undo
patch callbacks and the scene Web Storage writer are retired. Existing appearance is preserved.

Cold recovery may attach the old scene key only to its matching old workspace without an authored
index. The complete legacy attempt validates before adoption. Invalid optional layout leaves source
work available, installs an explicit empty scene and reports that its raw browser copy is preserved.
Malformed portable scene records reject; they are not silently repaired. A migrated head requires a
new Save and cannot acknowledge the old durable head. Verified rescue can include the migrated scene
without adoption or writes. Old readers cannot interpret the new required domain schemas; they must
reject rather than silently erase arrangement. The native container version remains V7.

## Bounds and removal/merge checks

The existing limits remain 24 tools, 32 groups, 12 named layouts, 128 members per group, signed finite
coordinates, bounded dimensions and exact validated fields. Named positions now allow 1,024 entries,
supporting larger arrangements than the old 256-entry sidecar limit. This is a per-viewpoint bound,
not a promise that every admitted workspace can capture all of its frames in one named layout. The old
raw-sidecar reader remains limited to 500,000 characters. Portable selected scene metadata, including
qualified references and unique pinned revisions, has a new explicit **2 MiB** bound; the overall
64 MiB retained-work policy also counts all historical revisions. This is not a claim that the two
encodings have the same budget. Immutable revision/body/weight caches retain no independent accepted
state; cached reads still require selected current components and captured payloads to exist.

| Removed or merged boundary | Concrete failure or measured regression |
| --- | --- |
| Explicit empty index | An empty shared canvas can absorb a recipient's stale browser-only layout. |
| Independent component records | A single tool move revises the index/full scene and rewrites unrelated captures; the one-revision/unchanged-index witness fails. |
| Pinned layout selections | Closing a captured tool and cleaning up loses the layout, or restoring it uses a later tool revision. |
| Qualified tool/scenario/model references | Missing or cross-document identities can be rebound to local baseline meaning instead of declared unavailable/refused. |
| Personal versus authored attention | Sharing a named layout also silently replaces the recipient's active model, camera or Back history. |
| Transient versus accepted gesture geometry | Every pointer movement creates durable edits; cancellation cannot preserve exact saved bytes and Undo no longer represents one completed move. |

These are adapter boundary witnesses, not a minimality proof for four physical schema collections.

## Verification and consequences

[Local contracts](../../../apps/canvas/tests/check-portable-scene.mjs) cover one publication/Undo,
immutable nested projections, one-revision moves, pinned closed-tool cleanup/restore, scoped viewpoints,
legacy snapshot-only migration, recipient isolation, source-backed checked work and corrupt-reference refusal.
[Chrome workflows](../../../apps/canvas/tests/check-portable-scene-browser.mjs) exercise actual tool
preview/cancellation, Undo, named model navigation and export/import/reload in independent browser stores.
The [scene workload](../../../apps/canvas/tools/measure-canvas-scene.mjs) uses 1/8/24 tools and 12 named
layouts over a pinned CSV and checked receipt; move Saves keep the original 16 KiB hashing guard,
write no source bytes and preserve zero-write unchanged recovery.

[Input/render/memory observations](../../../apps/canvas/tests/check-canvas-scene-performance-browser.mjs)
use fresh Chrome processes, real gestures and page-side frame opportunities, DOM and forced-GC page-JS
guards. Summed browser-process RSS is diagnostic and may double-count shared pages. These bounded
workloads do not establish every renderer/source/tool's capacity or a cross-device latency promise.
New schemas/validation/migration add production code; the unchanged baseline and net LOC/decisions
remain recorded. Revisit component/index representations if measured workloads justify another physical
index, without adding accepted-state owners or treating layouts as engineering dependencies.
