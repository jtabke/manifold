# 0026: Canvas model composition and portable captures

Status: Accepted for the bounded scalar canvas workflows below; the parent migration remains open.
Date: 2026-10-28
Related: Parent goal (internal design note),
[application interfaces](../application-interfaces.md), [extension patterns](../canvas-extension-patterns.md).

## Problem and alternatives

The foundation already supported pinned model definitions, independent instances and public
ports. The canvas compatibility projection rejected additional content and its Page diff deleted
unfamiliar records/views. Native Open rejected core receipts/resources; Save status ignored their
evidence clock. Every worksheet record also referenced the entire Page, retaining unrelated work
when a CSV cell was pinned. Adding another model collection or asset/result database would evade
these failures and duplicate ownership. Rewriting worksheet symbols or reinterpreting visual groups
would change their existing meaning without providing actual independent model scope.

## Decision

Retain the compatibility projection, but restrict its writes/deletes to its owned schemas/renderers.
Registered content and views travel through the same document owner. Expose direct guarded command
application, reads, scalar execution and preview/Keep through `RegionSession`. Staged transactions
accumulate commands, including nested/mixed-adapter commands, and publish once with one Undo entry.
Remove the record-to-Page back-reference: Page metadata already owns its selected records, and an
observation's pinned dataset revision is a sufficient portable source authority.

Install the existing scalar-model adapter with bounded spring and force-scale methods. Instances
share immutable pinned definitions and qualify local nodes by occurrence; connections use reviewed
public ports. CSV observations pin an exact existing dataset revision plus row, column, declared
unit and interpretation. They do not copy the CSV. Model and sampler computations share the session
scheduler, while the existing core scalar owner admits scalar receipts. Generic non-scalar receipt
unification remains open; there is no third result store.

The additive canvas cards support literal inputs, reviewed model/CSV bindings, Compute, Preview,
Keep and shared Undo/movement. Existing worksheet/group semantics and appearance stay intact.
The installed renderer validates targets before publication and admits at most 64 model views,
including comparisons. Connection choices mount only when opened. This is a bounded authoring
example, not a general model editor, numerical solver or physical-validity assessment.

Native application V6 carries the complete foundation envelope and sampler results. Asynchronous
`decodeWorkspace` verifies resources/receipts before staged Open; local recovery uses the same
installed schemas/methods and coherent capture. Both checked clocks participate in saved/stale
guards. V1–V5 remain one legacy read boundary. The current writer still emits V5 for plain legacy
worksheets; retiring that conditional writer remains an explicit migration obligation.

The host leases the entire session. Strict-mode detach/reattach remains reusable; terminal disposal
closes the core owner and scheduler, aborts jobs and prevents late scalar/sampler evidence. Disposing
a core owner with an injected scheduler cancels only its jobs. Immutable reads remain inspectable.
Renderer buffers register with the workspace edit port: file transitions finish valid unfinished
inputs, while explicitly submitted previews remain transient. Escape discards an unfinished field.

## Removal and failure witnesses

- Unrestricted Page deletes remove a model after an ordinary note edit; ownership filtering prevents it.
- Omitting the staging command log loses model changes in mixed/nested transactions; one publication
  and one Undo restore both model and worksheet meaning.
- Sharing global symbols makes two same-named springs overwrite each other; instances retain 20 N
  and 30 N independently. Only a reviewed compatible public-port binding propagates changes.
- Following CSV heads loses the cited observation; pinning its exact revision closes five records
  without capturing Page metadata. Included resources survive edit, local save and native handoff;
  corrupt bytes or receipt references reject before adoption.
- Ignoring the core evidence clock acknowledges a result that was never saved. A new receipt marks
  work unsaved even if the authored root is unchanged; Open guards also observe that clock.
- Renderer-owned lifetime admits late output after teardown. Shared host disposal discards it and
  leaves other owners on an injected scheduler usable.

Executable witnesses: [application contracts](../../../apps/canvas/tests/check-foundation-models.mjs),
[real browser workflows](../../../apps/canvas/tests/check-foundation-models-browser.mjs),
[scheduler disposal](../../../packages/foundation/test/tasks.test.mjs),
[workspace lifecycle](../../../apps/canvas/tests/check-workspace-lifecycle.mjs).

## Cost and remaining gates

The [model workload](../../../apps/canvas/tools/measure-foundation-models.mjs) covers 1/16/64
instances sharing one 930,007-byte source. Source-backed capture stays five revisions; snapshots
contain no CSV bytes; native files contain it once; unchanged recovered Save writes zero chunks.
The browser records model DOM/page-JS guards and single Open-to-paint diagnostics. These are not
production capacity, process-memory or latency acceptance. Current source-identified results and
net production counts live in EVIDENCE (local-only report).

No kernel data primitive is added. LOC increases for this adoption slice and remains tracked against
the unchanged baseline. Whole-Page writes, legacy result formats/conditional native writes, broader
interaction transitions, complete adapter examples and end-to-end resource acceptance remain open.
