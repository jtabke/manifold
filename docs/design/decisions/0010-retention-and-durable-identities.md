# 0010: Reviewable retention and durable identities

**Status:** Accepted for foundation 0.2 library/workbench; durable storage reclamation and existing-canvas migration excluded.  
**Date:** 2026-10-26.  
**Related:** Lifecycle brief (internal design note), evidence (local-only report),
[ADR 0009](0009-reusable-foundation-and-frozen-alternatives.md), [quality scenarios](../quality-and-risks.md).

## Context

Immutable revisions and evidence make comparison and recovery reliable, but accumulated
payloads dominate native files and full-read validation. Deleting merely unselected records
would break Undo, pinned views, kept alternatives, active captures and historical citations.
Deleting identity markers would allow the same ID to acquire a different meaning after Open.

## Options

1. Retain everything indefinitely. Simple semantics, with measured linear file/read growth.
2. Expire by age/count or retain only current heads. Cheap policies can remove accepted
   provenance or a still-usable Undo selection and cannot understand typed citations.
3. Trace explicit roots during reviewable maintenance; retain retired identity markers
   independently of payloads. More lifecycle metadata and full maintenance traversal, with
   protected meaning and measurable reductions in current payloads.

## Decision

Use option 3 for the package/workbench. Protect current selections, pinned views, complete
alternative contexts, every retained Undo selection, active preview/job captures, and exact
receipts cited through a schema's pure `evidence(body)` declaration. Follow typed references,
source-selector revision anchors and receipt contexts transitively without reading source
values or executing methods. Frozen contexts never borrow baseline selections.

Expose `all`, `latest-per-input` and `reachable` evidence policies, plus explicit receipt
bookmarks. Protect latest evidence for working inputs. Refuse maintenance of opaque content
whose reachability is unknown. Publish a reviewed candidate once, preserving authored Undo
and advancing the root and evidence clocks. Invalidate reviews on accepted changes, evidence
arrival, job start/settlement, preview changes or document rebinding.

Persist independent item/revision/view/alternative/receipt identity ledgers and an evidence
high-water sequence. Native v2 writes those fields; v1 reads migrate the identities actually
available in the old package. V1 cannot recover previously discarded IDs it never stored.
Compaction removes payloads, never these markers. Byte deduplication preserves source identity
and per-record media interpretation; equal bytes do not merge engineering definitions.

## Consequences

Unused revisions, attempts and source bytes can leave the current repository/provider and
subsequent exports. Kept comparisons, citations and retained Undo remain valid. Cleanup has
no maintenance Undo step and requires explicit review/apply; saving remains separate.

Maintenance scans retained metadata and reconstructs filtered maps. It is not ordinary edit
work and does not establish a product capacity budget. Identity ledgers continue to grow.
External readers, previews and jobs can hold old immutable objects until released; reported
logical byte reductions are not measured process heap or OS disk reclamation.

Older IndexedDB generations and staged orphans remain untouched. Reclamation must coordinate
with other readers and in-progress saves, including the interval before their durable-head
CAS. Incremental local persistence must avoid serializing a complete native attachment for
each save. Those are separate F5 work; native transport stays independent of local encoding.

## Validation and review

The evidence (local-only report) links core and browser checks for
retired-ID nonreuse after handoff, high-water Save acknowledgement, typed citations, source
anchors, Undo, kept alternatives, preview/late jobs, stale reviews and opaque preservation.
Workloads measure duplicate attempts, bounded Undo and reimported sources before/after cleanup.

Accept this bounded implementation as the next package layer. Revisit if a new content kind
cannot declare its retention dependencies, a protected workflow loses source interpretation,
or measured traversal/identity-marker costs require a different physical representation.
This decision does not approve a production container or migrate the existing application.
