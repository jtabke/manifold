# Manifold canvas

The current implementation of the [Manifold vision](../../docs/vision.md): a freeform
canvas for equations, notes, CSV measurements, linked plots, alternatives and nested
models. It is an early prototype with bounded arithmetic and Python sampling.

The shared application foundation migration (internal design note)
records the verified six-gate adoption and continued-development criteria. Features send typed requests through `commands.ts`;
accepted domain checks run inside the foundation owner through `canvasDocument.ts`.
`canvasWorkspace` in `workspaceFiles.ts` coordinates Save/Open/New/Export using the existing
owner and incremental store. UI code supplies unaccepted edit buffers, then downloads or
navigates only after success. Add operations to that closed request contract and use these
ports instead of adding history, persistence or accepted state inside a component.
Local/Chrome contract checks cover refusal, stale work, failed storage, native handoff and
paused loaded code. Source-identified cost reports are checked with
`make check-application-foundation-evidence` after regenerating the documented workloads.

Computations belong to `session.computations`. A renderer uses `read(artifact, context)`,
`subscribe` and the returned `run()`; its mount does not create an executor or cache.
`createArtifactComputations` observes core receipts and owns demand/cancellation intent only.
Install a trusted `ArtifactExecutor` at session construction; `samplingExecutor` in
`samplingExecution.ts` adapts frozen compact inputs, stages verified code bytes and returns raw
output to the shared foundation's checked admission path.
Do not assert currency or write output directly from a renderer. `artifactRuntime.ts` contains
only React bindings. The [executable checks](tests/check-artifact-computations.mjs) show adapter
injection, source-backed invalidation, multiple readers, recovery and resource failures.
Run `make measure-artifact-computations` for the 1/8/16-request diagnostic. Capture/transport
and cache bounds are in [ADR 0025](../../docs/design/decisions/0025-shared-scheduling-and-session-computations.md).

See the [repository map](../../docs/repository.md) for application, renderer, interaction
and domain ownership and the root workspace toolchain.

## Run

Requires Python 3.11+, Node 22.18+ and npm. From the repository root:

```sh
npm ci
npm --prefix apps/canvas run build
python3 apps/canvas/server.py
```

Open [the canvas](http://127.0.0.1:58310/). `make setup` and `make canvas` perform the
same steps. The server uses the Python standard library and binds to localhost.
Use `--port` to select a different port.

For frontend development, leave the Python server running, then run:

```sh
npm --prefix apps/canvas run dev
```

Open [the development server](http://127.0.0.1:58311/). Its API proxy targets port 58310.

## Using the canvas

Start typing an equation or note, then click to choose its position. **Write** starts
in the visible canvas. The inline source field grows with your text instead of opening a
fixed-width panel. Enter continues below, Escape finishes, Shift+Enter adds a line and `@`
offers references. Arithmetic such as `1+1` evaluates without a variable name.
Click mathematical notation to edit it; Enter continues below and Escape finishes
editing. Unresolved expressions remain editable.

Use **Import CSV** or drop a CSV onto the canvas. Measurements retain their source;
connections to mathematical quantities require explicit review. Plot responses and
compare alternatives through the existing quantities. The command palette opens
with Ctrl/Cmd+K.

The compact toolbar, **Actions**, right-click and Shift+F10 expose contextual actions.
Use Ctrl/Cmd+K for command search. Equations offer editing, plotting, connections,
alternatives and tracing; selections offer organization, grouping and model creation.
Click **?** beside the bottom-left zoom controls for a searchable **Keyboard shortcuts**
reference, or search **help** / **Keyboard shortcuts** with the default Ctrl/⌘+K. Scope notes
explain where keys apply. Escape closes the reference and restores focus; opening from the
writer preserves its draft and caret.

**Personal keyboard configuration:** choose **Customize** to record a replacement, clear a
canvas binding or reset it. **Edit configuration** provides JSON with **Apply JSON**;
**Import JSON…** validates/applies a whole file, and **Export JSON** saves
`manifold-shortcuts.json`. For example:

```json
{
  "version": 1,
  "bindings": [
    { "action": "help.shortcuts", "context": "canvas", "keys": ["F1"] }
  ]
}
```

The configurable IDs are `search.open`, `canvas.fit`, `canvas.undo`, `canvas.redo` and
`help.shortcuts`. Missing records use defaults; `keys: []` unassigns an action. `Mod` means
⌘ or Ctrl; explicit `Ctrl`/`Meta` are also accepted. Use modified letters/digits, F1/F2/F8/F9,
or the default Shift+1 fit key; protected combinations are rejected with an explanation.
Text editing and gestures stay fixed. Changes are saved locally for this browser profile/site,
not embedded in engineering files or their Undo history. Reload already-open tabs to use
changed preferences; importing does not watch or stay linked to the source file. The **?**
button always remains available if keys are cleared.

Selection stays quiet. Hover or keyboard-focus the selected region and open **Region commands**
for three likely actions and More. Alt-click a mathematical term to select it without opening
its editor; dragging notation selects its source. Use the link handle for connections.
For covered work, open context actions and choose **Select underneath** to cycle, or
**Choose overlapping item…** for a named list. Shift+F10 and the header **Actions** button
provide keyboard/touch access. The chosen item is exposed temporarily so its normal controls
are usable; Escape restores normal paint order. Panning keeps that attention intact. Search offers supported plot inputs, existing response
views and recent commands for the current session, along with engineering objects.

Choose **Vary** on an assigned quantity to explore without changing saved values.
Drag the value, use arrow keys, or use the contextual slider and value field. Set
the exploration minimum, maximum and step in the displayed units; Shift makes
smaller steps. The range controls exploration, not a physical requirement. Equations,
following response plots and authored requirement margins show the proposed state.
Choose **Accept value**, **Keep as alternative**, or **Cancel**. An alternative keeps
the baseline intact and compares affected response artifacts; one Undo removes it.
Select a plotted operating point and choose **Explore value** to use the same controls.
Exploration currently varies one assigned quantity at a time. Unaccepted previews
are temporary and are discarded on reload or a scenario/model change. In the default
notation editor, dragging selects source instead of changing a value. Use **Vary** for
value changes; specialized plot/value controls retain their existing acceptance rules.

An optional experimental marking menu opens with Shift+Space. Its four equation
directions are Edit, Explore (plot), Connect and Inspect (trace). The directions stay
fixed across object types; Explore varies an assigned quantity. Hold the shortcut,
flick and release Space; the menu appears after 180 ms if you need guidance. Tap the
shortcut to show it immediately, then click or use arrow keys and Enter. Escape
cancels. Other objects offer their own primary actions. Secondary commands remain
in the contextual list and search. Text editors retain Shift+Space typing and native
context menus; Space-drag still pans. The marking menu can also be found in search.

Wheel zooms. Middle-drag or Space-drag pans; double middle-click fits the work.
Drag blank space or Shift-click to select several objects. Movement and arrangement
preserve mathematical meaning. Guides use nearby work; hold Alt to bypass alignment and
docking. Passing over another object does not replace it or immediately rearrange it.
Hold near its edge until **Release to place beside / stack below** appears; labelled outlines
show the complete proposed arrangement. Releasing during **Hold to…** remains free placement.
A group header moves the group; an individual grip previews leaving it and closing its gap.
Escape restores the starting layout and one Undo reverses the accepted drop. Keyboard/context
menu grouping remains available without a hover gesture.
Enter finds room for the next line without moving explicitly placed work.
Model boundaries organize existing work and expose
reviewed interfaces; evaluation currently uses globally unique symbols.

Accepted work, its title and navigation state save in this browser on this device.
**New canvas** creates an independent URL. Keep that URL to reopen it. Portable
workspace export is available through the command palette and produces a `.manifold` file.
Use **Open workspace** or drop a `.manifold`/legacy JSON file to load it under a fresh canvas
URL after preserving current work. Opening loaded Python never executes it; verified saved
results can display, and changed/unchecked results need **Run Python**. Export finishes the
current edit. Session Undo, recent calculation history and temporary previews do not travel; explicitly kept
calculations preserve their original mathematics and source records. Title, camera and optional
tool/group arrangements remain browser preferences. See the adoption boundary (internal design note).

Accepted Page/artifact definitions and independent artifact presentations now use the
foundation owner through `canvasDocument.ts`. Keep, reviewed connections, model membership
and arrangements publish together and Undo coherently. Checked Python results are separate
from authored Undo. Local save captures one root/result version; failures show unsaved status
and **Retry local save**. Native V1–V4 read compatibility remains; V5 files include pinned historical source closure and explicitly kept calculations; all current captures now use V7 as described below.
Local saves now use coherent incremental IndexedDB snapshots with atomic multi-tab conflict
detection, validated recovery and unchanged-source reuse. Existing native backups stay intact.
Existing math/model/context semantics remain bounded. **Review workspace cleanup** in the command palette now reviews unused history and obsolete
saved data separately. Cleanup preserves current work, alternatives, retained Undo and checked
results for restorable artifacts; Save failures prevent physical deletion. New sampler results
retain only actual computation definitions and pinned source revisions, sharing CSV bytes in native
V5 and local storage. **Calculation history** separates temporary Recent states (128/8 MiB of
accounted data) from explicitly Kept calculations. Keep/Remove use normal Undo, sources remain
inspectable, and Kept data travels in native files. General execution and independent model
instances are subsequent work. See the
ownership evidence (internal design note).

## Drawing and diagrams

Use the drawing toolbar below the header to sketch beside calculations. **Pen** and
**Highlighter** accept mouse or pen input; Pen retains stylus pressure where supported.
Choose **Line**, **Arrow**, **Rectangle**, **Ellipse**, or **Drawing label** for editable
diagrams. Shift snaps line angles or constrains shapes to squares/circles. Drag a
**Visual connector** between rectangles/ellipses: it stays attached as they move or
resize, without creating a computational relationship.

Use **Select drawings** (Shift-click for multiple) or **Lasso drawings**, then drag to
move, drag the corner handle to resize, or use Duplicate/Delete. Double-click a label
to edit it; Enter accepts, Shift+Enter adds a line, and Escape cancels. The eraser
removes whole marks. Finger-drag pans and two fingers pinch-zoom; Space-drag and
middle-drag also pan. **Write** or Escape returns to equation/note authoring.

Drawing gestures save on release as one Undo step. Ctrl/Cmd+Z undoes;
Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. New edits clear Redo. Drawings and attachments travel
in workspace files and local recovery; session Undo/Redo does not. The current bounds
are 2,000 marks, 8,192 points per stroke and 4,096 characters per label, subject to the
shared workspace capacity. See the drawing brief (internal design note)
for ownership, checks and remaining device/performance validation. The eraser checks
continuous paths between pointer samples, including the release position, so fast
sweeps do not skip whole marks between events.

To reproduce the diagnostic large-scene workload (100/1,000/1,999 baseline marks,
reaching 2,000 while drawing, including an 8,192-point stroke):

```sh
npm --prefix apps/canvas run build
npm --prefix apps/canvas run test:all-browser -- check-drawing-performance-browser
```

The source-identified report is written to
`evidence/current/canvas/drawing-browser-results.json`. It separates preview geometry,
owner publication, browser frame opportunities, durable saving and JavaScript heap.
Timings are device-specific diagnostics, not latency guarantees. The brief's
publication attribution protocol (internal design note)
adds eight-sample owner diagnostics, independent browser replicates and page-side Saved
timestamps that exclude automation polling delay. Its cooperative-planning section
adds full main-thread trace capture and release-to-Saved long-task/RAF-gap windows;
these are rendering-opportunity diagnostics, not physical input latency guarantees.

## Code

- `src/regions`: canvas, engineering documents, data, plots, models and interactions.
- `src/notebook/math.ts`: bounded parsing, units and evaluation.
- `server.py`: static files, health endpoint and bounded sampling endpoint.
- `artifact_sampler.py`: validated plot code executed in a separate Python process.
- `tests`: local checks, browser workflows and Python server tests.
- `tools/run-checks.mjs`: application check runner.

## Checks

From the repository root, run `make check` and `make check-browser`. Browser checks
require installed Chrome and start a temporary server on port 58312.
Use `MANIFOLD_BASE_URL` to target an existing test server, or `PYTHON` to choose its
Python executable. For a focused browser check:

```sh
npm --prefix apps/canvas run test:all-browser -- check-blank-canvas-browser
```

`node apps/canvas/tools/measure-canvas-document.mjs` measures the compatibility adapter at
10/100/256 regions, staged Keep/Undo, independent views and checked results, and writes its diagnostic report. Add `--digest` to verify the tested
application source. The report distinguishes direct operations from staged legacy math; all exclude rendering, CSVs and browser storage.

`node apps/canvas/tools/measure-canvas-storage.mjs` separately measures physical app Save planning,
hashing and memory-backend writes with a 960 KB inline CSV, including validated recovery. It is not
IndexedDB latency. See storage evidence and limits (internal design note).

`node apps/canvas/tools/measure-canvas-retention.mjs` measures protected history/result cleanup,
following Save and actual serialized storage reduction separately. See the
retention evidence and limits (internal design note).

`node apps/canvas/tools/measure-result-snapshots.mjs` measures 201-point result updates backed by
a 940 KB CSV, including native source deduplication. See snapshot evidence (internal design note).

`node apps/canvas/tools/measure-calculation-history.mjs` measures 1,000-edit recent-cache growth
and ordinary edits with kept content, including a shared 940 KB source. See the
history contract and evidence (internal design note).

Dependencies retain their own licenses; fonts and icons include notices in their
npm packages. No live AI service is connected.

## Independent foundation models

Search commands for **Insert spring model** or **Insert force scale model**. Each card is an
independent instance of a pinned shared definition. Use value, Preview, Compute model and Keep
comparison use the shared session owner; Undo first reverts an active preview. Connect an exposed
input to a reviewed public model port or an exact CSV observation (data row/column/declared unit).
Connections do not establish physical equivalence or validity. Existing visual groups remain unchanged.

The installed renderer admits at most 64 model views, including kept comparisons. Model-containing
files use application V7, carrying scalar and sampler evidence/resources through the same core receipts;
local Save and recovery use the same capture. Open validates before adoption and starts no jobs.
V1–V6 remain readable at import; the conditional V5 writer and sampler sidecar are retired. Unfinished numeric drafts participate in
file-transition finishing and guards; submitted previews stay transient.

Run `node tools/run-checks.mjs check-foundation-models` for contracts,
`node tools/run-checks.mjs --browser check-foundation-models-browser` against a built app, and
`make measure-foundation-models` from the repository root for source/storage diagnostics.
See [extension patterns](../../docs/design/canvas-extension-patterns.md) and
[ADR 0026](../../docs/design/decisions/0026-canvas-model-composition-and-portable-captures.md).

## Sampler request recipes

Current artifacts retain owner-validated recipes with declared input references, context-frozen
values and exact source pins. Parameter edits preserve the recipe and change selected input/key;
unrelated notes/layout keep the same job. Reads no longer cache whole source documents.
`make measure-sampling-plans` compares 10/100/256-region closure and Save costs.
[ADR 0027](../../docs/design/decisions/0027-normalized-sampling-plans.md) records why the full-job
materialization candidate failed and the reference recipe retained the existing 16 KiB Save guard.
The [shared sampler migration](../../docs/design/decisions/0029-canvas-sampler-on-shared-evidence.md) now uses one core clock/receipt store and one native/local capture. Older current/stale results migrate at import; a converted root requires a fresh Save. The shared foundation adoption is complete; broader authoring/source/solver capacity and human usability retain separate gates.

## Retained capacity and saved-work rescue

Routine authoring now shares unchanged records/sources. A synchronous owner policy checks the complete
document/evidence/resource candidate before publication: at most 64 MiB conservative retained weight
and 4,096 receipts. Local recovery is bounded to 64 MiB physical bytes; compact native V7 transport
permits 128 MiB, with admission checked before live Open. These are rejection limits, not heap or
interactive-capacity promises. `make measure-canvas-capacity` checks actual native/local sizes,
UTF-8/JSON expansion, a >8 MB fresh-process handoff, zero-write recovery and atomic refusal.

If validated old saved work exceeds policy, **Export saved work** can recover a verified copy without
adopting, acknowledging or overwriting its head. A backup is eligible only when no newer primary is
authoritative; corrupt data is preserved and refused. See
[ADR 0031](../../docs/design/decisions/0031-coherent-retained-capacity-and-rescue.md) and
current evidence (local-only report).

## Portable authored arrangements

Groups, world-anchored tools, closed/pinned representations and named model/camera viewpoints are
ordinary document records through the existing owner, Undo and native/local capture. Named layouts
pin exact component revisions so a closed tool remains restorable after cleanup. Active camera,
selection, focus and navigation remain personal attention. The previous scene Web Storage key is a
read-only legacy migration source; an authored scene, including an empty one, always wins.

Tool move/resize previews locally and accepts one atomic edit on completion; Escape/blur/cancellation
publishes nothing. `make measure-canvas-scene` measures 1/8/24 tools and 12 named layouts over actual
source-backed checked work. The standard browser runner includes fresh recipient sharing and the
input/render/page-JS/process-RSS workload. See
[ADR 0032](../../docs/design/decisions/0032-portable-authored-canvas-scene.md),
[the adapter](src/regions/sceneRecords.ts) and [extension patterns](../../docs/design/canvas-extension-patterns.md).

`make verify-application-foundation` runs the full sequential foundation/canvas checks and refreshed
workloads from the repository root. [ADR 0033](../../docs/design/decisions/0033-atomic-layout-and-renderer-input-boundaries.md)
adds shared transient geometry, atomic placement/docking completion and renderer buffer guards for
slow Open/Export. Python drafts require explicit Run or discard; file transitions do not execute them.


## Author reusable models

Use **Create reusable model** in command search. Supported equations from the selected worksheet
regions, or the current worksheet when nothing is selected, seed an editable source proposal.
You can also start from blank. Add named equality equations, expose literal assignments as inputs,
and choose outputs. Publish creates one versioned definition and its first independent instance.
The original worksheet remains editable. Unfinished equations stay in the editor until fixed or cancelled.

Model cards expose declared scalar outputs and canonical units, explicit computation and independent
inputs. **Duplicate instance** shares the pinned definition. **Edit model definition** publishes a new
revision; existing instances remain pinned. **Review definition update** shows revision/interface
changes; Accept updates one instance and its output request with one Undo. Incompatible bound inputs
need explicit reset review. Kept comparisons retain their old source and definitions.

The bounded subset supports 32 equations, inputs and outputs; arithmetic uses the worksheet unit
rules with canonical SI units. Absolute Celsius, cycles, requirements and ambient worksheet bindings
are excluded. CSV/public-port connections remain explicit reviewed instance bindings. Source editing
must be published or cancelled before file transitions. Native files preserve source, graph, instances
and checked results; Open starts no jobs. See the brief (internal design note) and
[ADR 0035](../../docs/design/decisions/0035-authorable-scalar-models-and-general-outputs.md).

## Analyze a reusable model

Choose **Analyze model** on an independent model card. Select a public input/output, an increasing
range in the input's displayed units, and 2–201 points. Create the analysis, then choose
**Compute analysis** explicitly. The selected input is overridden only for the sweep; accepted
instance values/connections stay intact. Other inputs retain their reviewed CSV/public-port sources.

The table and curve share one checked result. Use **Next points**/**Previous points**, a numbered
row button or the curve to inspect the same point. **Captured model and sources** shows the
fixed input values, pinned equations and revision provenance for that result. **Edit analysis settings** can Apply or Preview a
range; compute the preview and **Keep analysis** to freeze its model, sources and result. Revert
discards the preview. Publishing and accepting a model revision makes the live analysis require
computation again while kept analyses retain their earlier meaning.

**Remove analysis** and Undo use the shared history; removing a live analysis preserves its kept
comparisons. Pending settings must be applied, previewed or cancelled before file transitions.
Native files and local recovery preserve checked analyses without running jobs. This initial
adapter supports self-contained models and at most 16 analysis views; see the
brief (internal design note) and [ADR 0036](../../docs/design/decisions/0036-model-backed-analysis-requests.md).

## Worksheet derivation and performance checks

Worksheet projection, semantic identity and 81-point curves share prepared expressions and the
existing dimensional evaluator. Successful edits reuse unaffected values; ambiguity/errors/order
changes may evaluate fully to preserve diagnostics. Results and caches are read-only derivations.
They do not own document changes, history, checked execution or persistence.

`make measure-worksheet-evaluation` measures 64/256-row sparse, chain and fan-out work and explicit
cache limits. Standard browser checks measure mathematical subtree reuse and current handlers,
preview/Undo and cold recovery. The outer application can still rerender and changed semantic input
still needs indexing. The application limit remains 256 regions. See the
brief (internal design note), [ADR 0037](../../docs/design/decisions/0037-bounded-incremental-worksheet-derivation.md)
and current evidence (local-only report).
