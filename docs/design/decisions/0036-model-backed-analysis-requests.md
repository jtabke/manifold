# 0036 Model-backed analysis requests

Status: Accepted for bounded single-input scalar sweeps, 2026-10-28.  
Related: model analyses (internal design note), [authored models](0035-authorable-scalar-models-and-general-outputs.md), [shared typed evidence](0029-canvas-sampler-on-shared-evidence.md).

## Context

Reusable instances expose independent scalar ports and reviewed definition revisions. Existing
worksheet sampling binds worksheet region identities and may execute editable Python. Connecting
reusable models to analysis must preserve their instance scope, public interface, exact sources and
historical meaning without copying equations into the worksheet or adding an analysis state owner.

## Decision

Add `canvas-model-analysis@1` as an installed application schema. A request follows one instance,
declares each exposed input's exact model-node inspection selector and the chosen public output,
and specifies one public input, increasing finite range and 2–201 evenly spaced representable points.
The chosen input is overridden only inside the analysis; accepted bindings remain unchanged.
Projection validates the complete interface and captures its model graph, effective scalar inputs,
axis labels/units and interpretation. Ordinary declared reads retain the instance, pinned definition,
source observations and exact source revisions. Projection evaluates the current scalar output for
unit/interface admission; it does not run the sweep or create jobs on Open.

The installed typed executor branches each point from a fixed two-record detached document through
the existing scalar-model schema and projection engine. It creates no workspace/history owner and
never mutates the live document. Reusing the existing evaluator avoids a second graph or dimensional
engine. Each branch is discarded after reading its output, keeping per-point history bounded.
Execution yields between batches of eight points and checks cancellation before every point.
One invalid point or changing output unit fails the entire result; no partial curve is published.

The method checks the complete finite point grid, output size and exact captured axis/interpretation
metadata. Numerical semantics come from the installed scalar engine; validation is not an independent
numerical proof or a physical-validity assessment. Portable files carry data and method identities,
never executable handlers. Missing installed methods remain explicitly unavailable.

One typed receipt supplies a paged table and curve in `canvas-model-analysis-view@1`. Table/plot
selection is transient presentation state. Settings use the existing renderer-buffer registry and
exact-document guard. Apply, preview, Keep, removal and Undo use existing application operations.
Kept analyses freeze their request, model/input/source closure and checked receipt; baseline model
updates do not retarget them. Removing a live analysis preserves kept contexts; Undo restores it.

Support self-contained graphs of at most 256 nodes/32 inputs, at most 16 analysis views, 64 KiB
captured input, 32 KiB output, 25 visible table rows and at most 201 curve points. Existing scheduler,
retained-document, receipt and native/recovery limits continue to apply. Requests whose interfaces
become unavailable after a model update remain repairable and explicitly blocked.

## Fixed optimization-response capture

The optimization UX also installs required `canvas-model-response@1` requests. These
contain the exact scalar capture from a reviewed optimization receipt, its receipt identifier,
a pinned source-request revision, and current/candidate/target markers. The response schema
projects that fixed capture directly to the **existing sweep method**, not through live instance
references. Its ordinary receipt currency follows the fixed request; live model changes never
substitute a different graph or effective input. Original optimization currency and Apply guards
remain independent and authoritative.

Creating/sampling is explicit (41 response points or two endpoints); Open, rendering, selection
and point inspection never schedule it. Identical requests are reused. Failure at any point stops
the whole series. The representation uses sample dots with a paged keyboard table, not an invented
continuous curve or solver evaluation history. Requests, captures and receipts travel in the normal
native/local closure; no sidecar, result cache, extra storage or history owner is introduced.
A new capture request is one ordinary authored operation; computation does not mutate model inputs.

Optimization settings use required `canvas-model-optimization@2` to retain compatible input/output
display units alongside physical values in admitted model units. The installed legacy @1 schema
continues to validate old settings strictly; numerical input/output method versions and old receipt
semantics are unchanged. Literal entry reuses worksheet parsing, literal admission, dimension matching
and scientific quantities. Unit display changes preserve stored physical values, including binary64
values untouched by editing. The direct post-Apply Undo shortcut is session-local and requires the
exact after-Apply document and no preview; later changes disable it rather than invoking unrelated
global Undo. Ordinary Undo remains the sole history authority.

## Alternatives and costs

Copying source equations into the worksheet loses instance identity and creates competing revisions.
A second evaluator duplicates unit/domain/nesting behavior. Precomputing the full sweep in projection
would do hidden expensive work during reads and prevent cooperative cancellation. A private result
map or serialized result sidecar duplicates currency, retention, recovery and history ownership.

The selected adapter adds request/editor/representation code and stores a bounded graph in each
immutable typed capture. It evaluates one point per detached branch, so per-point preparation has a
measurable cost. Keep both structural budgets and timing diagnostics. General nested sweeps,
multiple axes and optimization require new readiness evidence.

Worksheet sampling remains because editable Python/worksheet bindings have different semantics;
no compatibility wrapper or duplicate worksheet sampler is introduced. Only the scalar evaluator
is shared. A core projection correction strips binding metadata from directly overridden input
inspection, preserving the existing scalar contract; foundation 0.17.1 includes its regression test.

## Validation

[Local contracts](../../../apps/canvas/tests/check-model-analyses.mjs) exercise known source-backed
values, exact closure, output/grid/selector refusal, stale settings, preview/Keep/Undo, pinned
revision updates, cancellation, failed domain points, late completion, removal and native/local
recovery. [Real browser controls](../../../apps/canvas/tests/check-model-analyses-browser.mjs)
exercise authoring, paged table/curve selection, preview/Keep, revision/Undo, refused pending/invalid
settings and fresh native/local continuation. They measure actual 1/8/16-view DOM bounds.
The [workload](../../../apps/canvas/tools/measure-model-analyses.mjs) uses 1/8/16 analyses, 201 points,
3/14/32 authored equations and one pinned source. Current evidence (local-only report)
records exact source identities, production growth and resource measurements.
