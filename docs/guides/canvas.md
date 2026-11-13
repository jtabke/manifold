# Using the Manifold canvas

Manifold is a freeform canvas for equations, notes, CSV measurements, plots, alternatives,
models and diagrams. It is an early prototype with bounded arithmetic and Python sampling.
An optional local Pi assistant can inspect work and propose reviewed edits.

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

With the default **Select / Edit** pointer, click blank canvas to place the writer, or
start typing on the focused canvas. There is no separate Write tool or toolbar button.
The inline source field grows with your text instead of opening a
fixed-width panel. Enter continues below, Escape finishes, Shift+Enter adds a line and `@`
offers references. Arithmetic such as `1+1` evaluates without a variable name.
Single-click an equation or note to select it; double-click or press Enter to edit.
Enter in the source field continues below and Escape finishes editing. Unresolved
expressions remain editable. Mathematical source-range selection, Alt-click term
inspection and dedicated number-exploration controls retain their own gestures.

Equations display as typeset mathematics after editing: `sqrt(...)` becomes a radical,
`abs(...)` uses absolute-value bars, `exp(...)` displays as an exponential, and `log10(...)`
uses a subscripted base. Fractions, powers and grouped expressions preserve their mathematical
meaning. Keep typing the same plain-text source; double-click the formatted equation to edit
it. A bundled math font keeps symbols consistent without a font service or local font install.
Tall expressions grow their rows, and results wrap below long equations instead of crowding them.
Notes remain plain text; this is equation formatting, not a LaTeX editor for prose.

Use **Import CSV** or drop a CSV onto the canvas. Measurements retain their source;
connections to mathematical quantities require explicit review. Plot responses and
compare alternatives through the existing quantities. The command palette opens
with Ctrl/Cmd+K.

## Ask the canvas assistant (experimental)

The assistant is optional: the canvas works without it. Start Manifold normally with
`make canvas`; no second terminal, separate companion startup or copied connection URL is needed.

1. Right-click a canvas point and choose **Ask agent**. A compact, single-line input opens at
   that point, like a comment composer—not a sidebar. You can also use **Ask agent** on a scalar
   model card, or the toolbar button to open at the last canvas point.
2. Type a question or request, such as “Set displacement to 3 mm and explain the effect.”
   **Enter** sends; **Shift+Enter** inserts a newline. The first request connects automatically
   using the detected Pi provider, default model and credentials. Opening the panel alone does
   not send a model request.
3. Review the proposed source/input changes and diagnostics. **Apply edit** accepts the exact
   reviewed transaction as one Undo step; **Dismiss** changes nothing.

Only the input and small settings/send/close controls are shown initially. Multiline drafts grow
as needed; replies, edit reviews and settings expand the same popup without leaving the viewport.
**Escape** closes it and ends the connection. Selection context is attached when you send.

Provider/model configuration is behind the **Assistant settings** gear button. Existing Pi
configuration is read from `~/.pi/agent` (or `PI_CODING_AGENT_DIR` set when starting Manifold).
Use settings to choose another provider/model, refresh Pi configuration or disconnect. If setup
is missing or connection fails, submitting opens settings and preserves your text instead of
sending or discarding it. Toggling settings never clears the request draft.

The assistant can use these canvas tools after you submit a request:

- **Inspect canvas:** drawing marks, representation IDs/positions, groups, plot definitions,
  the invocation point in world coordinates, the current viewport and measured object frames.
- **Look at canvas:** a bounded image of the viewport or one visible object. This is offered
  only to models declaring image support. Captures exclude assistant/settings UI and page
  chrome; requested images go to your configured provider. Images are ephemeral, not saved in
  the workspace. A canvas/document or camera change during capture requires a fresh look.
- **Inspect plot:** exact derived worksheet curve points, or retained scalar-analysis/sampling
  outcomes with their actual result status. Reading never executes a computation.
- **Propose edits:** create/revise/delete drawings, add drawing labels and connectors attached
  to rectangle/ellipse drawings, move representations, group/ungroup, create worksheet plots,
  or create scalar-model sweep setups, alongside the existing equation/note/model-input edits.

Drawing, plot and layout changes appear in the proposal review and share one atomic Apply/Undo
with any engineering edits. Grouping alone preserves positions; arranging uses explicit world
coordinates. A scalar sweep setup needs an explicit **Compute** after approval. This remains a
bounded declarative tool set, not arbitrary mouse/keyboard control, shell access or permission
to execute code. It does not yet expose every manual canvas action, renderer resize or view-navigation
operation. Screenshots help interpret layout but are not numerical or checked computation evidence.

For a provider without existing credentials, open **Configure an API key** in settings, enter
it, then connect. A supplied key is held only in this connection's memory; it is never written
to Pi, browser storage or the workspace archive. You must reenter it after disconnecting.
Existing Pi sign-in can be reused without entering a key.

The local canvas server starts and manages its Node companion automatically when the assistant opens,
and shuts it down with the server. Setup, model discovery and Connect make no model inference
request. **Refresh Pi configuration** rereads credentials/models after an external Pi login.
Catalog presence is not a guarantee of account access; use your known working Pi model if a
provider rejects a selection. OAuth-only/cloud providers may still require their normal Pi login
or environment configuration; there is no embedded OAuth login flow yet.

Requests and inspected canvas content are sent to your configured model provider and may
consume its quota or incur charges. This version can inspect the whole bounded worksheet and
scalar models, not just the selected objects. Selection is attached when you send a request.
No shell/file tools, automatic computation or autonomous edit application are enabled.
Derived values are not current checked computation evidence; compute explicitly through
normal canvas controls when needed. Validation does not certify engineering safety.

You can keep editing while the agent works. Finish/cancel unaccepted editor drafts before
sending a request or applying a proposal. Authored changes invalidate older proposals: ask for
a refreshed proposal rather than overwriting newer work. **Stop request** revokes further
tool access for that request; it does not undo applied changes. Closing the panel or disconnecting
discards pending proposals and the in-memory conversation connection, but preserves accepted
changes and normal saving. Chat/proposals are not saved in native workspace files.

The managed bridge accepts the local canvas server and Vite origins (`127.0.0.1` or
`localhost`). This is a local HTTP integration, not a hosted/HTTPS assistant or general
multiplayer service. Node.js and the repository's npm dependencies are required; setup errors
leave normal canvas authoring intact.

**Advanced:** a separately started companion is still supported with
`npm run assistant -- --provider PROVIDER --model MODEL`. Open **Advanced: connect a separate
companion** to paste its private URL. For that standalone mode, repeated `--origin` flags
replace its default allowed origins and `--port` selects the port; stop it with Ctrl+C.

## Commands and keyboard shortcuts

The selection toolbar, the **Canvas actions** ellipsis beside Undo/Redo, right-click and Shift+F10 expose contextual actions.
Use Ctrl/Cmd+K for command search. Equations offer editing, plotting, connections,
alternatives and tracing; selections offer organization, grouping and model creation.
Click **?** beside the zoom controls in the tools row for searchable **Keyboard shortcuts**
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

## Copying images

Select an equation, note, plot or other canvas object, then right-click → **Copy as PNG**.
Shift-click multiple objects to copy their arrangement together. The same command is
available in Ctrl/Cmd+K command search. Ordinary text Copy is unchanged.

Images have a transparent background, tight cropping with a small margin and 2× resolution
independent of canvas zoom. Canvas grids, menus and manipulation controls are excluded;
content styling and card backgrounds are retained. **Save as PNG…** downloads
`manifold-selection.png`; if image clipboard access is unavailable or denied, **Copy as PNG**
downloads the image instead and reports the fallback. Very large selections are refused;
select fewer or closer objects and try again.

PNG is a visual snapshot, not an editable or recomputable workspace. Use workspace export
when the recipient needs the engineering document.

## Scientific scalar math

New equations support `sqrt`, `abs`, `sin`, `cos`, `tan`, `exp`, `ln`, `log10`,
`min`, `max`, `atan2`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`,
`floor`, `ceil`, `round`, `cbrt`, and constants `pi` and `e`. For example:

```text
theta := 30 deg
F := 500 N
Fx := F*cos(theta)
Fx >= 400 N
```

The projected force is about 433.013 N. Angles are explicit quantities (`deg` or `rad`);
trigonometric functions also accept dimensionless radians. `atan2(y, x)` accepts
compatible quantities and returns radians. Inverse trig functions require dimensionless
inputs and return radians (`asin`/`acos` require [-1, 1]). Hyperbolic and rounding
functions require dimensionless inputs; `round` ties go away from zero. Floor, ceil
and round retain Math.js's numerical tolerance near integer/half boundaries
(`relTol=1e-12`, `absTol=1e-15`), including in Python sampling.
`cbrt(-8 m^3)` returns -2 m and divides dimension exponents by three. `sqrt(9 m^2)` returns 3 m. Functions reject
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
select it and choose **Use scientific math (v3)** in its context/search commands.
For reusable models, use the explicit scientific-math action on the equation row.
Undo restores the old rules; already kept calculations retain their original interpretation.
Automation exposes `mathVersion` in worksheet inspection and an `enableScientificMathV3`
edit operation. The older `enableScientificMath` operation remains a v2 opt-in,
never a downgrade. Ordinary edits preserve the source version. V3 reserves its
expanded function names; explicit upgrades can expose name collisions as diagnostics.
New native files require a V9-capable reader; older files remain readable.

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

The document header groups **File**, the editable document name, local-save status,
Search, Ask agent and **Download**. The row beneath groups Undo/Redo and canvas actions,
selection/ink/shape tools, and View/Pan/Zoom/Help. **View** contains Reveal,
named viewpoints and System overview. Scenario controls appear in a separate labelled
strip when alternatives exist. The compact authoring toolbar keeps **Select**, **Pen**,
**Shapes** and **Text** prominent. Shape variants live in the Shapes picker; highlighter,
eraser and lasso are in **More drawing tools**. **Drawing style** appears for drawing
creation and affects new drawings, not the selected worksheet content. Drawing selection
actions appear only with selected drawings. Controls wrap on narrow screens without
hiding the document name. File, View and tool disclosures support Tab, Escape and
outside-click dismissal; closing a picker preserves the active tool and selection.

Accepted work and navigation state save in this browser on this device.
**File → New document** creates an independent URL. Keep that URL to reopen it.
The document name is authored metadata and travels inside `.manifold` files. Opening
an older unnamed file uses its filename without the extension. An embedded name takes
precedence over the transport filename. Enter or blur keeps a rename; Escape cancels it;
Undo/Redo restores accepted renames. Legacy browser-only names migrate into the document.
Files currently contain one page, not a tabbed multi-page document.

- **Download** in the header (Ctrl/Cmd+S) downloads a portable `.manifold` copy after
  finishing pending edits. Keep a copy outside browser storage for backup or sharing.
  Your browser controls the download location and whether to ask for a filename.
  Later edits autosave only in this browser; use **Download** again for an updated copy.
  This does not overwrite an opened file or keep a connection to it.
- **File → Open file…** (Ctrl/Cmd+O), or dropping a `.manifold`/legacy JSON file,
  validates the file and loads it under a fresh canvas URL after preserving current work.
  Cancelling the picker or choosing an invalid file leaves current work intact.
- The command palette also offers **Save workspace file** (searchable as “export”) and
  **Open workspace**. **Saved locally** means browser storage, not a file backup or cloud sync.

Opening loaded Python never executes it; verified saved results can display, and
changed/unchecked results need **Run Python**. Session Undo, recent calculation history and temporary previews do not travel; explicitly kept
calculations preserve their original mathematics and source records. The active camera and
tool attention remain personal; the document name is portable. Authored groups, tool arrangements and named layouts travel
with the workspace, as described under [portable arrangements](#portable-arrangements).

Local save failures show **Local save needs attention** and **Retry local save**. Saves detect conflicting
changes from other tabs rather than silently overwriting them. **Review workspace cleanup**
reviews unused history and obsolete saved data separately; it preserves current work,
alternatives, retained Undo and results for restorable artifacts.

**Calculation history** separates temporary Recent states (128 entries / 8 MiB of accounted
data) from explicitly Kept calculations. Keep/Remove use normal Undo, sources remain
inspectable, and Kept data travels in native files. Opening or importing a workspace never
starts computation. Current native captures use V9; older V1–V8 files are supported at import.

## Drawing and diagrams

Use the drawing toolbar below the header to sketch beside calculations. **Pen** and
**More drawing tools → Highlighter** accept mouse or pen input; Pen retains stylus
pressure where supported. Open **Shapes** for Line, Arrow, Rectangle, Ellipse and Visual
connector. **Text** creates a drawing label, not an equation or worksheet note. Shift snaps line angles or constrains shapes to squares/circles. Drag a
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

**Select / Edit** is the default pointer for both worksheet authoring and drawing
selection; there is no separate Write mode. Click a drawing to select it, Shift-click
for multiple, or use **Lasso drawings**, then drag to move, drag the corner handle to
resize, or use Duplicate/Delete. One click on blank canvas clears object selection and
places the writer there; it does not require a second click. Typing or Enter on an
unselected, focused canvas also starts a worksheet region. Shift-click adds worksheet objects and drawings to the same
selection; blank-space box selection can include both. Drag a selected object or the
selection's move handle to move them together. Mathematical text/control gestures are
reserved for their editing and inspection actions; use the move handle there.
Double-click a label to edit it without switching to label creation; Enter
accepts, Shift+Enter adds a line, and Escape cancels.

The contextual selection toolbar keeps Duplicate, Delete and Group near the selected
content. Organize, Connect and Make model are behind **More**. Mixed worksheet-region
and drawing duplication uses fresh identities and unique symbol names; internal
bindings follow the copied definitions. Deletion refuses to break dependencies on
unselected regions or live data/plot/artifact references. Other representation types
retain their own actions; Duplicate/Delete explains when a selection is unsupported.
Each accepted mixed edit is one Undo step, and native files retain mixed groups.

Drawings use one Tab stop rather than one per mark. Alt+Arrow browses the collection;
Home/End focuses its first/last drawing. Enter/Space selects. Arrow keys move selected
objects by 5 units, or 20 with Shift. Escape cancels the current action or clears selection;
from a drawing tool it returns to **Select / Edit**. Escape first dismisses an open
picker or cancels an active gesture without discarding the selection beneath it.
The eraser removes whole marks. **Pan** finishes valid editor drafts and suspends
authoring: drawing tools are not highlighted, and typing/Delete/arrows do not alter
objects. Escape leaves Pan and restores the previous tool; choosing an authoring tool
also exits Pan. Finger-drag pans and two fingers pinch-zoom; Space-drag and middle-drag
also pan.

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

## Scaled drawings

Choose **Shapes → Scaled drawing area** (or **Scaled drawings → Draw new area**), then
drag a boundary. Open **Scaled drawings** to name the area and set its display unit,
physical scale, grid spacing and dimension visibility. Each area is independent: a
building in feet can coexist with a component in millimetres. Existing drawings remain
unscaled until explicitly assigned or calibrated; equations and worksheet notes are not
rescaled.

The display-unit field suggests metric and imperial units, including nm, um, mm, cm, m,
km, in, ft, yd and mi. Other length-unit names supported by the unit engine, such as
`inch`, may be typed. Mass, angle and other non-length units are rejected. Length fields
accept explicit units and fractions, for example `120 mm`, `6 ft` and `1/2 in`.

- **Display unit** converts measurements without resizing geometry or changing calibration.
- **100 canvas units represent** defines physical scale. Changing it deliberately
  recalibrates all drawings in that area; zoom only changes the view.
- **Grid spacing** defines physical increments. Shape endpoints and pointer moves snap
  when enabled. Minor grid lines thin out at distant zoom levels; the snap increment
  does not change. Freehand ink remains freehand; Shift angle constraints take precedence.
- **Create exact geometry** creates a line with a length/angle or a rectangle with a
  width/height. Select a line or rectangle to **Apply dimensions** instead. Angles are
  counterclockwise degrees. Drafting dimensions use extension lines, arrowheads and
  readable measurements. Width appears below shapes, height to the right, and length
  parallel to a line. Short spans use outside arrows and labels. Nonzero line angles
  appear only on selected lines. These are measurements and explicit edits, not
  persistent CAD constraints.
- To calibrate an existing sketch, select exactly one nonzero reference line, optionally
  with other unscaled drawings, enter its **Known line length**, and choose **Calibrate
  selected drawings**. A new area uses the entered length unit. Existing-area calibration
  affects all its members but leaves their geometry and camera unchanged. Calibration
  and membership assignment are one Undo step.

Dimensions appear on selected shapes by default. **Show all dimensions** is an explicit
per-area option, applied with **Apply area properties**; **Show dimensions** is the master
visibility toggle. Drag a dimension line toward/away from its shape, or drag its label
along the line. These gestures only change annotation placement, never geometry or the
measured value. Manually placed dimensions stay visible when deselected and remain
attached as the shape moves or changes size. Placement survives unit conversion,
Download/Open and local recovery. A release accepts one Undo step; Escape, pointer
cancellation or window blur discards the preview without clearing the shape selection.

Dimension handles support Tab focus and arrow-key placement (Shift moves farther).
**Home** resets that dimension; **Escape** returns focus to the shape. **Scaled drawings →
Reset dimension placement** resets all placed dimensions on the selected drawings,
restoring automatic placement and removing their persistent visibility. Reset and
placement edits support Undo/Redo.

New drawings started inside an area inherit its scale. **Assign selected drawings**
explicitly adds unscaled drawings to the chosen area. Drawings already using another
area cannot be silently reassigned. Moving or duplicating an area carries its drawings;
copies retain independent area references. Delete an area's drawings first, or select
its area and all members together: deleting just the area is refused rather than losing
physical interpretation. Area properties, dimensions and calibration survive local
recovery and native-file Download/Open. Up to 32 areas share the existing 2,000-mark
limit. Unscaled records retain the original `canvas-drawing@1` contract; areas and
unit-bearing drawings use `canvas-drawing@2`. Calibration explicitly upgrades selected
revisions, and Undo restores their original version and meaning. This is not a CAD
solver or a fixed-scale printing/export feature.

## Independent model instances

Search commands for **Insert spring model** or **Insert force scale model**. Each card is an
independent instance of a pinned shared definition. Edit a value, Preview, Compute model or Keep
a comparison through the card; Undo first reverts an active preview. Connect an exposed
input to a reviewed public model port or an exact CSV observation (data row/column/declared unit).
Connections do not establish physical equivalence or validity. Existing visual groups remain unchanged.

Model-containing files use application V9, carrying scalar and sampler evidence/resources through the same core receipts;
local Save and recovery use the same capture. Open validates before adoption and starts no jobs.
V1–V7 remain readable at import. Unfinished numeric drafts participate in
file-transition finishing and guards; submitted previews stay transient.

## Capacity and saved-work rescue

The application admits at most 256 worksheet regions and 64 model views, including kept
comparisons. Retained document/evidence/resources are limited to 64 MiB conservative weight
and 4,096 receipts. Local recovery is bounded to 64 MiB physical bytes; native V9 transport
permits 128 MiB, with admission checked before Open. These are rejection limits, not heap,
latency or engineering-validity promises.

If validated old saved work exceeds policy, **Save recovered file** can recover a verified
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

## Optimize a reusable model

Choose **Optimize model** on a self-contained authored-model instance. Explicitly upgrade its
arithmetic/function equations to scientific math v3 first; legacy v1/v2 semantics are not changed.
Choose **Reach a target value**, **Make an output smaller**, or **Make an output larger**,
then the output (and target), one public input to change, and its permitted closed range.
The input's current effective value appears beside setup. Suggested bounds are not safe engineering
bounds: edit or explicitly review them before saving. All other effective inputs stay fixed;
additional constraints and multiple variables are not supported.

Bounds, target and the numerical tolerances under **Advanced** accept quantity literals such as
`10 mm` or `5 cm`. Bare numbers use the selected display unit. References, functions and arbitrary
expressions are refused by the worksheet's literal-only grammar. Each field shows the value and
admitted model unit that will be used; incompatible dimensions and invalid ranges are identified
inline. Changing a compatible display unit preserves the physical settings; original checked receipts
are not rewritten. Display choices travel in new version-2 settings; version-1 requests and receipts
remain readable. Older readers must refuse required unknown version-2 settings, not reinterpret them.
Input tolerance controls numerical search termination; target error tolerance is numerical, **not
engineering acceptance or physical-validity proof**. Work limits are fixed at 500 evaluations,
200 iterations and 5 seconds, not configurable controls.

**Create optimization** only authors settings. Expand **Settings and actions** to Run or edit.
**Run optimization** explicitly reviews the optional
[SciPy runtime](../development/README.md#optional-numerical-runtime), freezes its identity in the
request, and computes a fixed captured model and all other effective inputs/observations. Open,
reload and rendering never probe the runtime or launch work. Missing/incompatible runtimes leave
the card editable with copyable optional setup guidance; no installation or alternate solver occurs.
Busy workers are an explicit refusal. **Cancel optimization** cancels through the shared scheduler
and explicitly signals the owned numerical worker.

The result leads with current-at-Run and proposed input values, resulting output and target error.
A best candidate at a selected limit is identified, without automatic range expansion.
Numerical work, tolerances, source revisions, program digest and runtime identity remain inspectable
in disclosures. Min/max is a bounded **local search, not a global-optimum proof**.
Target solving requires opposite endpoint residual signs or a satisfactory endpoint; a no-bracket
result does not establish that no solution exists. **Check endpoint outputs** explicitly evaluates
both selected limits using the same captured scalar model. Discontinuous sign changes that fail the
actual residual tolerance are not successes. Domain/work-limit failures may retain an **unconfirmed**
candidate, never an applicable success. Domain failure messages do not invent a failed expression
when the runtime has not identified one. No continuity/domain or physical-validity proof is provided.

**Apply change** is a separate undoable edit after independent captured scalar evaluation.
The adjacent note gives the exact literal replacement and warns if it disconnects a source.
It requires the same current baseline receipt and exact reviewed work, no preview and finished valid
edit buffers. The confirmation offers **Undo this change**, restoring the exact former literal or
connection through ordinary history, in one authored step. Later authored work, preview or a changed
document disables that local shortcut and directs you to global Undo; it never undoes unrelated work.
The result remains inspectable as evidence from before the change. After reload, noncurrent evidence
is described as captured before current settings; no new session-local direct Undo is invented.
Edited/deleted inputs, sources, requests, changed references and kept results cannot authorize stale
Apply. **Keep result** preserves capture/evidence without applying.

**Compute response plot** is an additional explicit action, not a by-product of Run, selection,
zoom or Open. It samples 41 points over the reviewed range with the installed scalar evaluator,
from the **exact model, effective inputs and interpretation in the reviewed optimization receipt**,
even if the live model has since changed. Current-at-Run, candidate, selected bounds and target are
indicated; out-of-range current values remain in text rather than being drawn inside the bounds.
Dots are checked samples, not a continuous curve, solver evaluation history or a global-optimality
claim. If any sample fails, sampling stops and no partial curve is presented. A keyboard-accessible
point table and selected-point output accompany the SVG. Sampling requests and checked evidence use
the existing document/computation/native closure, not a renderer cache or sidecar. Local reload and
native export preserve them without starting jobs. Creating a new response capture is an ordinary
authored operation; repeating the same capture reuses its request. Viewing retained evidence does
not make a stale optimization candidate applicable.

At most 16 optimization views, one variable, no constraints or new statistics scope, and only
reviewed v3 scalar method families that lower to the bounded numeric DAG are supported. Unrecognized
or native method families are refused rather than approximated. Cards wrap long labels and use
ordinary scrollable measured view frames; keyboard-accessible disclosures reveal controls without
hover. Automated checks cover interaction mechanics, not human ease of use; human usability
evaluation remains unperformed.

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
