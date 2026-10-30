# 0030: Canvas authoring shares unchanged records

Status: Implemented; current verification is recorded in EVIDENCE (local-only report).
Date: 2026-10-28
Related: Parent goal (internal design note),
[owner validation](0023-owner-controlled-domain-validation.md),
[shared evidence](0029-canvas-sampler-on-shared-evidence.md).

## Context and decision

Routine worksheet edits previously deep-cloned the Page, including unrelated CSV, and compared
the candidate as JSON. The record adapter then rebuilt JSON bodies for all records. Compact job
snapshots and incremental storage did not remove these authoring costs.

The canvas now uses a synchronous `PageEdit` candidate builder. A command requests the region,
context, plot or model it will mutate. The builder copies that record and its mutable containers;
unrequested records remain shared. Region source/external/data fields remain immutable shared
leaves: replace the field when changing its meaning. Context maps and model metadata are copied
when edited. Layout and per-region binding maps copy on first write. Collection insertion, order
and removal use new arrays. This is local preparation, with no accepted root, history, execution,
subscriptions or persistence of its own. It is not a new kernel primitive.

The same adapter lowers candidates to the existing create/revise/delete/view commands. It reuses
an existing record body when its immutable value is unchanged; only changed bodies need JSON
conversion/comparison. Synchronous owner validation still checks the exact prepared document before
publishing once. The redundant session-level model/artifact validation is removed; constructor,
staging and authored publication continue through the same domain gate. Model creation can also
check caller-supplied representation IDs before lowering.

Creation, source import, cell quantities, dataset relationships, writing/continuation, connection
review/application, renames, context branching/switching, alternatives, placement, model metadata,
arrangement and plot sizing use this pattern. Whole-Page JSON comparisons are removed from write,
arrangement and branch review; branch review uses structural JSON equality with identity shortcuts.
`semanticKey` still serializes selected mathematical meaning, excluding source payloads and layout.

## Scope and costs

The bulk Page import/replacement adapter remains available and validated. Lowering still scans
bounded collections and derives layout; it does not claim a general affected-ID subscription graph.
Math solving, recipe compilation and recent worksheet capture may inspect the selected worksheet.
In particular, a new recent calculation copies its mathematical definition metadata, so sparse edit
allocation still scales with worksheet size. Unchanged sources and explicitly kept calculations
remain shared. Current product limits and workload descriptions continue to apply.

The [document workload](../../../apps/canvas/tools/measure-canvas-document.mjs) adds 10/100/256-region
worksheets with a 900 KB pinned CSV, kept calculation and high fanout. It observes actual
`structuredClone` and `JSON.stringify` arguments separately from uninstrumented edit timings.
Counters prove source payload exclusion from those calls, not total allocation, process memory or
absence of all reads. A literal edit changes one head; a rename changes its producer, dependent
equations and binding metadata. Honest fanout cost is retained instead of skipping dependent meaning.

## Removal and merge witnesses

- Mutating a shared record in place would corrupt previous roots or throw on frozen accepted data.
  Edit/Undo, model/context and rejected-alternative tests retain the earlier values and identities.
- Deep-cloning the whole candidate would copy unrelated source bytes and kept snapshots. The actual
  edit/review/Keep/Undo workflows require zero source-containing clone/serialization calls.
- Rebuilding all record bodies would defeat identity-based source validation reuse. Unrelated
  source/kept record identities survive edits and native provenance remains intact.
- Treating a rename as a one-record edit would leave dependent equations/bindings stale. The fanout
  workload requires the expected dependent heads to change and retains correct numerical meaning.
- Removing owner validation in favor of a builder would admit invalid candidates. Unit-incompatible
  alternatives and existing malformed/stale command tests must reject without changing state/history.

Executable witnesses: [authoring workflows](../../../apps/canvas/tests/check-targeted-authoring.mjs),
[existing region and branch checks](../../../apps/canvas/tests/check-regions.mjs),
[linking checks](../../../apps/canvas/tests/check-linking.mjs),
and real canvas authoring/exploration/model/connection browser workflows.
The [extension guide](../canvas-extension-patterns.md) distinguishes this worksheet adapter from
ordinary typed model/content command batches. End-to-end storage/export/recovery limits, authored
scene portability and broader input/render/process-memory acceptance remain parent obligations.
