# Using the Manifold canvas

Manifold is a freeform canvas for equations, notes, CSV measurements, plots, alternatives,
models and diagrams. It is an early prototype with bounded arithmetic and Python sampling;
no live AI service is connected.

## Start the canvas

Requires Python 3.11+, Node 22.18+ and npm. From the repository root:

```sh
make setup
make canvas
```

Open [the canvas](http://127.0.0.1:58310/). The server binds to localhost.
For the equivalent commands without Make and frontend development, see the
[development guide](../development/README.md#setup-and-local-development).

## Equations and data

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

## Commands and keyboard shortcuts

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

## Scientific scalar math

New equations support `sqrt`, `abs`, `sin`, `cos`, `tan`, `exp`, `ln`, `log10`,
`min`, `max`, `atan2`, and constants `pi` and `e`. For example:

```text
theta := 30 deg
F := 500 N
Fx := F*cos(theta)
Fx >= 400 N
```

The projected force is about 433.013 N. Angles are explicit quantities (`deg` or `rad`);
trigonometric functions also accept dimensionless radians. `atan2(y, x)` accepts
compatible quantities and returns radians. `sqrt(9 m^2)` returns 3 m. Functions reject
incompatible units, non-real/non-finite results and absolute Celsius temperatures.
The unit catalog includes the original engineering units plus `rad`, `deg`, `in`,
`ft`, `lbf`, `Hz`, `ms`, `min`, `h`, `g`, `A`, `V`, `ohm`, `mol` and `cd`.
Results, model ports and Vary controls use canonical SI units, including radians.

Function/constant names are reserved in scientific source. New unit names are recognized
in numeric unit suffixes, so `2 A` means amperes while `A := 2 m^2` and `1/A` can still
use an area variable. Use parentheses for a product in a denominator: `1/(x*y)`.
Calls work through dependency highlighting, requirements, Vary, response plots,
reusable models, model analyses and headless/CLI authoring—not just rendered notation.
Arrays, complex numbers, user functions, solvers and symbolic operations are not supported.

Saved equations retain their original mathematics rules. To opt an existing equation in,
select it and choose **Use scientific math (v2)** in its context/search commands.
For reusable models, use the explicit scientific-math action on the equation row.
Undo restores the old rules; already kept calculations retain their original interpretation.
Automation exposes `mathVersion` in worksheet inspection and an `enableScientificMath`
edit operation. New native files require a V8-capable reader; older files remain readable.

## Selection and overlapping work

Selection stays quiet. Hover or keyboard-focus the selected region and open **Region commands**
for three likely actions and More. Alt-click a mathematical term to select it without opening
its editor; dragging notation selects its source. Use the link handle for connections.
For covered work, open context actions and choose **Select underneath** to cycle, or
**Choose overlapping item…** for a named list. Shift+F10 and the header **Actions** button
provide keyboard/touch access. The chosen item is exposed temporarily so its normal controls
are usable; Escape restores normal paint order. Panning keeps that attention intact. Search offers supported plot inputs, existing response
views and recent commands for the current session, along with engineering objects.

## Explore alternatives

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

### Experimental marking menu

An optional experimental marking menu opens with Shift+Space. Its four equation
directions are Edit, Explore (plot), Connect and Inspect (trace). The directions stay
fixed across object types; Explore varies an assigned quantity. Hold the shortcut,
flick and release Space; the menu appears after 180 ms if you need guidance. Tap the
shortcut to show it immediately, then click or use arrow keys and Enter. Escape
cancels. Other objects offer their own primary actions. Secondary commands remain
in the contextual list and search. Text editors retain Shift+Space typing and native
context menus; Space-drag still pans. The marking menu can also be found in search.

## Navigate and arrange work

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

## Save, open and share

Accepted work, its title and navigation state save in this browser on this device.
**New canvas** creates an independent URL. Keep that URL to reopen it. Portable
workspace export is available through the command palette and produces a `.manifold` file.
Use **Open workspace** or drop a `.manifold`/legacy JSON file to load it under a fresh canvas
URL after preserving current work. Opening loaded Python never executes it; verified saved
results can display, and changed/unchecked results need **Run Python**. Export finishes the
current edit. Session Undo, recent calculation history and temporary previews do not travel; explicitly kept
calculations preserve their original mathematics and source records. Title, active camera and
tool attention remain personal. Authored groups, tool arrangements and named layouts travel
with the workspace, as described under [portable arrangements](#portable-arrangements).

Local save failures show unsaved status and **Retry local save**. Saves detect conflicting
changes from other tabs rather than silently overwriting them. **Review workspace cleanup**
reviews unused history and obsolete saved data separately; it preserves current work,
alternatives, retained Undo and results for restorable artifacts.

**Calculation history** separates temporary Recent states (128 entries / 8 MiB of accounted
data) from explicitly Kept calculations. Keep/Remove use normal Undo, sources remain
inspectable, and Kept data travels in native files. Opening or importing a workspace never
starts computation. Current native captures use V8; older V1–V7 files are supported at import.

## Drawing and diagrams

Use the drawing toolbar below the header to sketch beside calculations. **Pen** and
**Highlighter** accept mouse or pen input; Pen retains stylus pressure where supported.
Choose **Line**, **Arrow**, **Rectangle**, **Ellipse**, or **Drawing label** for editable
diagrams. Shift snaps line angles or constrains shapes to squares/circles. Drag a
**Visual connector** between rectangles/ellipses: it stays attached as they move or
resize, without creating a computational relationship.

With **Pen**, draw a rough line, circle or approximately axis-aligned rectangle, then
keep the pointer down and hold still for about **650 ms**. A confident fit becomes a
clean preview. Lift to accept it, or move more than three screen pixels to return to
freehand; another hold can preview again. Short/ambiguous strokes and Highlighter stay
unchanged. Escape, window blur or lost pointer capture cancel the whole gesture.
Changing zoom clears the fitted preview without accepting it.

For the non-dwell alternative, select one pen stroke and activate **Regularize** in
the drawing toolbar using a click or keyboard focus plus Enter/Space. An uncertain fit
leaves the stroke untouched. This is local geometry fitting, not AI or mechanical-symbol
interpretation; it creates no dimensions, constraints or computational dependencies.

Use **Select drawings** (Shift-click for multiple) or **Lasso drawings**, then drag to
move, drag the corner handle to resize, or use Duplicate/Delete. Double-click a label
to edit it; Enter accepts, Shift+Enter adds a line, and Escape cancels. The eraser
removes whole marks. Finger-drag pans and two fingers pinch-zoom; Space-drag and
middle-drag also pan. **Write** or Escape returns to equation/note authoring.

Ordinary drawing gestures save on release as one Undo step. A held regularization saves
the original ink first, then replaces it through a second normal history operation:
**Undo restores the exact ink/pressure; another Undo removes the stroke**. Redo restores
the fitted shape. If replacement cannot be accepted, the original ink remains. Selecting
and regularizing existing ink is one ordinary edit. Nothing is saved by the hold preview.
Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. New edits clear Redo. Drawings and attachments travel
in workspace files and local recovery; session Undo/Redo does not. The current bounds
are 2,000 marks, 8,192 points per stroke and 4,096 characters per label, subject to the
shared workspace capacity. The eraser checks
continuous paths between pointer samples, including the release position, so fast
sweeps do not skip whole marks between events.

## Independent model instances

Search commands for **Insert spring model** or **Insert force scale model**. Each card is an
independent instance of a pinned shared definition. Edit a value, Preview, Compute model or Keep
a comparison through the card; Undo first reverts an active preview. Connect an exposed
input to a reviewed public model port or an exact CSV observation (data row/column/declared unit).
Connections do not establish physical equivalence or validity. Existing visual groups remain unchanged.

Model-containing files use application V8, carrying scalar and sampler evidence/resources through the same core receipts;
local Save and recovery use the same capture. Open validates before adoption and starts no jobs.
V1–V7 remain readable at import. Unfinished numeric drafts participate in
file-transition finishing and guards; submitted previews stay transient.

## Capacity and saved-work rescue

The application admits at most 256 worksheet regions and 64 model views, including kept
comparisons. Retained document/evidence/resources are limited to 64 MiB conservative weight
and 4,096 receipts. Local recovery is bounded to 64 MiB physical bytes; native V8 transport
permits 128 MiB, with admission checked before Open. These are rejection limits, not heap,
latency or engineering-validity promises.

If validated old saved work exceeds policy, **Export saved work** can recover a verified
copy without adopting, acknowledging or overwriting its head. A backup is eligible only when
no newer primary is authoritative; corrupt data is preserved and refused.

## Portable arrangements

Groups, world-anchored tools, closed/pinned representations and named model/camera viewpoints
are authored document content. They participate in Undo, local save and native export.
Named layouts pin exact component revisions so a closed tool remains restorable after cleanup.
Active camera, selection, focus and navigation remain personal attention.

Tool move/resize previews locally and accepts one edit on completion; Escape, blur or
cancellation publishes nothing. Python drafts require explicit Run or discard; file
transitions do not execute them.

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
and checked results; Open starts no jobs. See [ADR 0035](../design/decisions/0035-authorable-scalar-models-and-general-outputs.md)
for the design rationale.

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
[analysis decision](../design/decisions/0036-model-backed-analysis-requests.md).

## Further reading

- [Agent workflow](agents.md): inspect, edit, validate and compute without the browser.
- [Development guide](../development/README.md): checks, implementation boundaries and diagnostics.
- [Interaction design](../interaction-design.md): broader intended behavior, not a list of shipped features.
