# 0027: Normalized sampling plans before shared typed evidence

Status: Accepted for the normalized-request prerequisite; shared typed evidence remains open.
Date: 2026-10-28
Related: Ready brief (internal design note),
parent migration (internal design note),
[typed-execution direction](0022-application-ports-over-revision-kernel.md).

## Problem and options

Scalar runtime capture follows declared references. `canvas-artifact@1` referenced Page metadata,
which selected every worksheet record. At 256 regions, a request closure included 259 revisions
and an unrelated large CSV. The existing sampler's compact output snapshots already avoided that
retention. Moving results into core receipts without changing request representation would regress
source closure. Keeping a second evidence owner permanently would miss the migration objective.

Rebuilding jobs separately in each reader retains feature-specific preparation and full-root caches.
Normalizing all worksheet expressions/scopes at once would combine a semantic migration with the
evidence migration. Choose an owner-validated compiler projection of the existing request as the
next production adapter, then use it in the common receipt path.

## Decision

`canvas-artifact@2` indexes ordinary `canvas-sampling-plan@1` records by existing worksheet context.
Each ready recipe references selected authored definitions, retains explicit context-frozen texts
and identity bindings, code/range configuration and exact pinned observations. Scalar values stay
in their existing records. Blocked plans retain an explicit bounded reason. The
canonical execution key is derived from those fields, not serialized as a second manifest copy.
Recipes declare the small set of input references plus exact source revisions, never Page metadata
or raw CSV copies. Derived jobs read those declarations through the guarded projection reader.

These are compiler projections of accepted worksheet meaning, not another editable authority.
The same pure compiler creates and verifies plans; the owner rejects a stale/forged projection
before publication. Source lookup uses the pending revision IDs, so worksheet and plan changes
publish in one existing kernel preparation, one notification and one Undo. Source payloads are not
read through a fabricated candidate Document or a second owner preparation. V1 artifact records
remain readable only at migration boundaries; live owners reject downgrading to that representation.

The sampler reads immutable accepted recipes and memoized closed job projections. Modern result admission rechecks the selected request key
after hashing and validates numerical output from its closed effective definitions, without
rebuilding a whole-Page job. Legacy receipt matching remains at its compatibility path. Prepared
read caches retain plan/job values rather than a complete source Document. Weak immutable caches
share keys/jobs and validation; they cannot establish accepted meaning or outlive their keys.

The full domain gate also runs during native/local read before an incoming owner/write binding
is established. Correct storage hashes do not establish compiler consistency. Normal recovery
preserves its original core layout token, so a validated unchanged Save still writes zero chunks.
Migrating an old capture deliberately changes its root and requires a new Save acknowledgement.

## Removal and rejection witnesses

- The old Page back-reference captures unrelated content: the diagnostic compares actual V1
  declaration closure with the normalized plan root at 10/100/256 regions.
- Removing source pins would retain the same key after a same-valued source revision; the recipe
  changes its pin/key while unrelated notes/layout preserve it. A scalar edit preserves the recipe
  and changes the selected input/key.
- Letting a renderer author the plan can change a captured scalar independently of its worksheet.
  Direct command and correctly hashed local-record forgeries reject before publication/write binding.
- Separate plan commits create extra history/notifications; mixed compilation publishes once and
  Undo restores the worksheet and plan together, including context changes.
- Replacing a recovered Loaded token needlessly destroys incremental reuse; unchanged recovery
  remains zero-write, while an actual old-record migration stays unsaved until committed.

Checks: [plan contracts](../../../apps/canvas/tests/check-sampling-plans.mjs),
[sampler contracts](../../../apps/canvas/tests/check-artifact-computations.mjs),
[storage contracts](../../../apps/canvas/tests/check-canvas-storage.mjs) and the existing canvas
Chrome workflows. [Workload](../../../apps/canvas/tools/measure-sampling-plans.mjs) records closure,
plan size, cached reads and edit/view Save costs with explicit exclusions.

## Costs and remaining work

The first candidate persisted a full compiled job for every parameter value. It violated the
existing 16 KiB edit-Save hashing guard (about 21 KiB at 256 regions). Replacing mutable-value copies
with input references returned that workload to about 11.5 KiB without raising the guard. The request
now closes five actual records in the representative case, instead of the initial two-record
materialization or the old 259-record Page closure. This is the retained design.

Compilation/validation still derives worksheet meaning, and the compatibility adapter still
builds whole-Page desired state for ordinary edits. Plans add bounded persistent records and bytes;
retired whole-root read caches do not by themselves establish net LOC reduction. Preserve the
pre-plan reports and report current source/production deltas in
EVIDENCE (local-only report).

This is the exact-request prerequisite, not completion of typed execution adoption. Integrate
these plans and existing scalar requests into the same core capture/receipt/codec/storage protocol;
migrate current/historical sampler output and retire the sidecar/result clock, duplicated storage
root and conditional legacy writer. Finish affected-record editing, broader interaction/resource
checks and the full parent acceptance audit. No new kernel data primitive is introduced.

Changing compiler semantics requires an explicit schema/version migration and compatibility
witness before changing publication/import equality. These recipes preserve current worksheet
semantics; they do not silently broaden namespace, source interpretation or numerical methods.
