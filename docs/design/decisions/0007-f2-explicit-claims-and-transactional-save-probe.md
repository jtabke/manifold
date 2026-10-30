# 0007: Explicit claims, source authority and save publication after F2

Status: Accepted for isolated foundation experiments; production adoption excluded  
Date: 2026-10-24  
Related: F2 brief (internal design note),
F2 evidence (local-only experiment),
foundation (internal design note), [ADR 0006](0006-f1b-shared-maps-and-undo-retention.md)

## Context and alternatives

F1/F1b establish bounded content/reference/view and physical locality behavior. They
do not establish common engineering meaning across conflicting claims or real browser
storage behavior. We compared a smaller fixture-specific worksheet trace with a typed
candidate using source-backed claims, properties and explicit relation roles.

An implicit name/unit binding is rejected because it cannot distinguish two subjects
with the same label or retain disagreement honestly. A universal object graph, solver
or adapter registry would add untested commitments. The direct worksheet remains a
viable simplification baseline and passes the same eight bounded outcomes.

## Decision

Accept the tested F2 boundary for continued isolated foundation experiments:

- Retain property identity separately from prediction/observation claims and their
  source projections. Connections explicitly assert `predicts` or `observes`; they
  do not declare an execution direction or establish physical truth.
- Check quantity, subject, frame and role; do not silently convert reference identity
  from equal labels/units. Keep unit interpretation and conditions inspectable.
  Duplicate claim/property/role connections cannot manufacture extra evidence.
- Native projections preserve source authority and bytes. Revision/selector policy
  is explicit, and an owner-declared split yields ambiguity. One historical pin does
  not automatically follow the new source. The native provider is a bounded mock.
- Publish content/view/semantic changes through one aggregate owner and restore
  selections coherently through Undo. Derived relation indexes are reconstructible.
- Capture an exact root and local binding for Save; stage immutable bytes and metadata,
  then atomically compare/swap the durable generation. ACKs identify their saved root.
  Verified reopen must finish staging/semantic checks before replacing current work.
  Opening also checks that newly typed draft text has not arrived during the wait.

The four concrete record kinds and closed selector/unit sets remain fixture schemas.
This does not accept an exhaustive quantity/entity ontology, public file schema,
production database, real native adapter or a migration of application state owners.

## Consequences and limits

Two genuinely different source kinds use the same Connect/Trace/Undo contract while
retaining their own selectors. The implementation adds closed schema/source branches;
it does not demonstrate arbitrary plug-in extensibility. Physical subject/frame IDs
are authored declarations, and uncertainty, transformations and inference remain open.

The incident index avoids unrelated relation scans. Its endpoint sets copy O(degree)
entries, and duplicate validation can revisit incident edges; high fanout and cycles
need their own workloads. Source dependency invalidation is not an execution index.
The small browser harness refreshes its complete fixture projection on publication.
F3 must prove result currency and targeted scheduling rather than treating relationship
roles as a universal computation DAG.

IndexedDB proves a viable atomic-head protocol with two connections in one browser.
It does not select the production storage engine or prove OS/power-loss durability.
Assets/manifests staged before a failed head publication can remain orphaned. Full
JSON saves, retained source history/ID ledgers and opaque original-package copies
still grow. Source reads are eager; large-byte paging/async cancellation are unproved.

## Validation and review

`make check-foundation-2-browser` runs F1/F1b regression gates, F2's ten headless groups,
eight worksheet outcomes and twelve real Chrome/browser groups. It exercises three
save interruption boundaries, generation conflicts, missing/corrupt assets, reload,
file download/fresh-context import, Tab/Enter authoring and late Open versus typing.
`make measure-foundation-2` records independent relation workloads through 10,000
triples, with affected-index work and full transport/import costs separately.

Review used local source inspection, deterministic failure cases, actual browser
transactions and visual desktop/mobile inspection. Collaborative browser snapshots
timed out twice; the existing Playwright/Chrome workflow completed the checks.
No external review, participant study, production capacity or QS7 approval is claimed.

Reconsider this decision if F3 requires claims to become mutable result caches, if a
new source forces different transaction/recovery rules, or if connection semantics
require implicit physical equivalence. Carry the portable handoff and failure gates
into the next slice. Keep the production storage/format and richer adapter decisions open.
