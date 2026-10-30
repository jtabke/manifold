# Data-model scalability and flexibility

**Status:** Design assessment, 2026-10-20. This evaluates the
[concrete proposal](data-model.md), with synthetic serialization evidence and explicit
production gates. It does not establish application performance or capacity.

## New F1 evidence

The 2026-10-24 isolated experiment (local-only experiment) measures real
candidate operation costs across 100/1,000/10,000 text items and 1/10/100 views with
one shared table asset. Correctness and clean-process handoff pass. Dense maps copy
unrelated entries; an all-revision compatibility check makes even view movement
scale with content. F1b (local-only experiment) now demonstrates logarithmic edit paths,
view edits independent of unrelated content and a bounded Undo selection buffer.
The candidate is accepted only for further isolated experiments. Lookup is slower
than flat-object access; revision payloads and identity ledgers still grow, and no
production capacity is established. The older
synthetic sizing below remains a separate arithmetic-schema assessment, not evidence
that the F1 candidate or current application supports a production workload.

## F2 relation locality

F2 evidence (local-only experiment) adds 100/1,000/10,000 synthetic independent
relation triples. One property edit validates one incident relationship; view movement
does no semantic-map work. Full import/export remains linear and real source sizes,
fanout, execution invalidation and browser budgets remain open. The browser's 30 second-
animation-frame samples are mechanics observations, not edit-to-paint capacity evidence.

## Recommendation and tradeoff

Use normalized immutable engineering records, context-pinned revision selections,
separate view records, typed dependencies and shared byte storage. This supports
stable comparisons and lets representations and computation methods evolve separately.
Keep one application operation owner; use incremental indexes and storage adapters
inside that boundary before introducing distributed coordination.

The model's costs are revision retention, reference validation, migration complexity,
and additional joins when reading a calculation. Structural sharing is not automatic:
plain copied maps and whole-archive saves can remain O(N) per edit even when records
are normalized. Implementing immutable types alone does not solve scale.

## What the current code tells us

These are source observations, not measured latency or corruption reports:

- `RegionSession` uses `structuredClone` over Page for edits/history and several
  `JSON.stringify` comparisons. Repeated edits can copy unchanged regions and CSV text.
- `project` parses and resolves the effective region set. `semanticKey` visits the
  effective mathematical definitions, and artifact requests include that key plus
  active context. Unrelated changes can prevent otherwise valid numerical reuse.
- `archive` serializes Page and artifacts together. Sources, presentation and receipts
  share the archive rather than independent physical records. `restore` rejects text
  longer than 8,000,000 JavaScript characters; this is an existing implementation
  limit, not a supported capacity target or a byte quota.
- CSV import caps raw text at 1,000,000 JavaScript characters and 10,000 rows/12 columns.
  Those are bounded-prototype checks, not proof of large-dataset behavior.

See [document.ts](../../apps/canvas/src/regions/document.ts),
[artifacts.ts](../../apps/canvas/src/regions/artifacts.ts) and
[dataSources.ts](../../apps/canvas/src/regions/dataSources.ts).

## Growth dimensions and expected work

Let N be selected definition/source entries, E dependency edges, k changed records,
A saved alternatives, V visible views, H retained edits and B retained source/result
bytes. These dimensions grow independently; “object count” alone is insufficient.

| Work | Proposed boundary | Cost / limit to verify |
| --- | --- | --- |
| One edit | New changed revisions plus a new accepted root. | Full map copying still costs O(N); persistent-map updates can target O(k log N), excluding payload validation. That is a candidate implementation, not a measured guarantee. |
| Branch | Pin the previous semantic root and change selected revisions. | Sharing records avoids copying their content; dense selection maps still use O(A × N) entries. |
| Read a definition | Context revision → snapshot selection → revision record. | Bounded lookup; no context-parent-chain interpretation. Physical page fetch/cache misses still cost time. |
| Build dependency index | Traverse typed semantic references. | O(N + E) at initial load; incrementally update edges for changed records thereafter. |
| Reevaluate | Schedule the changed reverse-dependency closure. | Cost depends on affected computations, not only edited count. A global parameter or dense fanout may legitimately affect nearly all work. |
| Render/navigation | Resolve visible representations and their needed summaries. | Keep render work proportional to visible detail where feasible; hidden models can still have required computation. Semantic and spatial indexes have separate jobs. |
| Retain history | Preserve prior roots and shared immutable records. | Approximately initial content plus changed payloads; dense root maps can dominate. H and source version growth remain unbounded without policy. |
| Save | Persist new records/blobs, then atomically advance a durable root. | Proportional to changed records/bytes if the adapter supports it; a single JSON archive remains a full traversal. |
| Export/import | Traverse reachable records and required bytes; validate before adoption. | At least proportional to exported content; incremental editing cannot make full portable export constant time. |

Lazy loading must distinguish an unloaded record from an absent snapshot selection
or genuinely unavailable source. Fetch a selected record through a loading state;
do not reinterpret a cache miss as deletion, an unassigned quantity or a zero result.
The complete logical snapshot remains authoritative even when only part is resident.

A persistent map is a physical optimization. Do not expose its node IDs as engineering
identity or require the UI to know its encoding. Checkpointed deltas are an alternative
if measured read depth and compaction remain bounded; an unlimited chain makes reopening
and random context access unpredictable. The first production implementation should
choose one strategy from measured workloads rather than support both speculatively.

## Synthetic sizing: where sharing helps and where it does not

Run `node docs/design/model/size-workload.mjs`. The generator uses 10,000 synthetic
note definitions with 1,024-byte text payloads, 100 alternatives and 50 changed
definitions per alternative. It measures UTF-8 JSON sizes, not execution latency,
working-set memory, real engineering workloads or compression.

| Representation | Encoded bytes |
| --- | ---: |
| Independently expanded definition arrays for 101 snapshots | 1,162,510,101 |
| Shared immutable revision table: 15,000 revisions | 17,610,001 |
| Complete dense definition-selection maps for 101 snapshots | 42,429,697 |
| Revision table plus dense maps | 60,039,698 |

The expanded size is calculated from one serialized full array and 101 equal-size
versions; it is not obtained by allocating a gigabyte archive. The normalized sizes
are measured from generated tables. Source files, receipts, index overhead and history
roots are excluded. The output is reproducible, but it is not a product capacity claim.

This example supports normalization and shows why dense maps are not the end state:
selection metadata is larger than the shared content here. Streaming/segmented export
and physically shared map nodes need evaluation before claiming these workload sizes.
The generated output is also well beyond the current reader's character limit; it
cannot be treated as a supported current-app import.

Large bytes have a separate budget. As arithmetic illustrations, a 100 MB source
shared across 101 alternatives costs 100 MB of source content, rather than 10.1 GB
of repeated copies. Retaining 50 distinct 100 MB source revisions still costs 5 GB.
Sharing does not eliminate genuine source history. A URL or digest does not recreate
unretained bytes.

## Evaluation locality, hashes and background work

Build derived forward/reverse indexes from typed references. A changed input marks
its downstream outputs dirty; an offscreen view does not become a new producer.
Batch repeated preview changes, prioritize requested/visible results, and cancel or
supersede obsolete work. Maintain a hard correctness check when results arrive even
when cancellation fails. Bound concurrent jobs and cached receipts by explicit budgets.

Compute numerical request keys from the actual dependency closure. A document-wide
root hash changing cannot force unrelated plots to become stale. Conversely, excluding
source selectors, unit interpretations, evaluator versions or solver tolerances can
reuse a wrong answer. The first conservative implementation may rerun after a rename
inside the closure; optimize only after executable-content equivalence is specified.

Hashing a closure is not free. Cache fingerprints per immutable revision and reuse
unchanged dependency subgraphs, then measure fanout and invalidation cost. Keep source
revision provenance in receipts even when equal byte content permits physical deduplication.
A result cache can be evicted; an accepted historical receipt or pinned source cannot
silently disappear under the same policy.

## Storage, failure and retention

The operation owner publishes one logical root. The storage adapter must durably
stage referenced records and bytes and advance the root atomically, or report a save
failure while preserving the prior durable root. Chunk large data outside the UI
update path. In-memory acceptance and durability remain distinct statuses.

The current single-envelope adapter can support a bounded first slice. Larger
workspaces require a transactional keyed record/blob adapter, measured for the actual
browser environment. The logical schema should not depend on a particular database.
Multi-tab root conflicts need detection; multi-user merge, authorization and distributed
identity are separate contracts. Immutable records help transmission and conflict
inspection, but do not supply a collaboration algorithm.

A retention policy must name roots: accepted context heads, pinned comparisons,
retained receipts and their manifests, saved views, explicit bookmarks, active
session Undo/Redo roots and in-flight durable transactions. Trace typed references
through those roots before reclaiming data. A record used only by a historical
receipt can still be required. Unknown extension payloads must declare reachable
references/blobs; if those declarations cannot be trusted or decoded, preserve the
payload's package rather than guess at what is safe to delete.

Start without automatic garbage collection. Before sustained-edit/source workloads,
add explicit history retention limits, storage estimates, cache eviction and a
reviewable prune/export operation. Losing historical source bytes must change the
reproducibility claim; no silent deletion of accepted provenance. Memory-only Undo
can be bounded separately from accepted alternatives. An append-only revision store
without a retention policy is not a complete scalability design.

The foundation retention implementation (internal design note) now provides
that explicit review/apply operation for its current repository and verified provider.
Citations, Undo, kept alternatives and active captures are protected; retired identity
markers persist in native v2. Measurements (local-only report) separate
current payload/native-file reductions from old IndexedDB generations and held immutable
objects, which are not reclaimed by that operation. The separate
[physical reclamation protocol](decisions/0013-coordinated-storage-reclamation.md) now deletes
obsolete stored payloads using coherent full-read snapshots and Save epoch/revision guards.
Incremental hot local saves (internal design note) now reuse immutable map branches;
validated local recovery now restores that reuse after full owner validation. Initial graph
amplification, Reopen, owner adoption, source reads and the following Save are measured separately.

## Flexibility with specific contracts

| Future need | What the proposal preserves | Required additional design |
| --- | --- | --- |
| Multiple views of the same quantity | Stable target and separate view IDs/context selectors. | Renderer-specific options and accessible inspection, with computation parameters outside view settings. |
| Measurements beyond CSV | Versioned sources, explicit selectors/decoders, byte storage. | Typed column schemas, stable record keys where available, streaming/window queries and unavailable-source behavior. Row indices are valid only inside a pinned revision. |
| Arrays, simulation fields and geometry | Typed blob-backed numeric/artifact outputs and rich-source links. | Frames, coordinates, topology IDs, extraction/reduction methods, chunk access and transformation loss. A numeric array alone is not an FEA field model. |
| Multiple solvers/code languages | Identified computation methods and output slots. | Adapter capabilities, deterministic/nondeterministic settings, units, failures, effect permissions and reproduction policy. |
| Independent/nested models | Stable scopes/ports and proposed instance-path identity. | Actual template/instance records, port mappings, revision updates and collision tests; these are absent from the first schema. |
| Domain-specific objects | Versioned extension payloads with explicit references/blobs. | Codec validation, migrations, operation registration and safe unsupported placeholders. Unknown data cannot claim meaningful computation. |
| Collaboration | Immutable revisions and explicit accepted operations. | Conflict semantics for text, bindings, context heads and views; synchronization, permissions and identity allocation. |

Do not turn every relationship into one generic edge table. Computational dependency,
source derivation, evidence association, scope containment and view targeting have
different validation, retention and invalidation rules. Typed records express those
differences while derived indexes support efficient traversal.

Likewise, avoid adding every potential engineering property to a universal quantity
record. Add typed contracts when a real workflow requires them, preserving existing
IDs and versioning decoders. Unknown metadata should round-trip without being used
to fabricate supported semantics.

## Workload and evidence gate

These are proposed measurement workloads, not promised capacities. Test small baseline
cases first and increase independent dimensions until observed failure or latency growth
explains the limiting mechanism:

1. 100 → 1,000 → 10,000 definitions with chain, branching and high-fanout graphs;
   measure isolated edits and global-parameter changes separately.
2. 1 → 10 → 100 alternatives with 1, 10 and 50 changed definitions; vary retained
   edit count independently and measure selected-record/map/blob growth.
3. 10 → 100 → 1,000 visible views while keeping total definitions constant; separately
   grow hidden work. Measure navigation, focus and view culling rather than evaluation.
4. Multiple source sizes and versions using declared non-sensitive generated data;
   distinguish parse, decode, shared-byte retention, result arrays and export cost.
5. Repeated previews with delayed jobs, rapid Undo, save failures and reopen; include
   interrupted writes and unknown extensions to test correctness under pressure.

Record hardware, browser/runtime versions, fixture seed/schema, repository/workspace
revision, cache state, trial count and raw distributions. Measure edit-to-paint latency,
main-thread blocking, graph update/evaluation time, bytes written per edit, retained
bytes/heap, cache size and open/export time separately. Use at least 30 repeated edits
per warmed workload and separate cold-open trials; inspect median and tail values.
A single elapsed total cannot identify the limiting layer.

Before declaring QS7 satisfied, choose reference devices, supported workload envelope,
interactive/async budgets and acceptable memory/storage limits from actual engineer
work. The schema is a sound candidate, but scale acceptance remains blocked until
those budgets and measured outcomes exist. Revise the physical encoding if selection
maps or full saves dominate; revise dependency scheduling if unrelated work recomputes;
revise the semantic contract if required identities or provenance cannot survive edits.
