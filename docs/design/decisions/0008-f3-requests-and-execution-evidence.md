# 0008: F3 requests and execution evidence

**Status:** Accepted for continued isolated foundation experiments; production adoption excluded.  
**Date:** 2026-10-25.  
**Related:** F3 brief (internal design note),
F3 evidence (local-only experiment), [ADR 0007](0007-f2-explicit-claims-and-transactional-save-probe.md),
foundation sequence (internal design note), QS1/QS2/QS4/QS5/QS8/QS9.

## Context

F2 retains properties, source-backed claims and authored physical relationships. Those
relationships do not specify how or when to calculate. Delayed jobs require exact inputs
and method requirements; current root sequence alone cannot identify their meaning.
Receipt arrival also changes portable work without being an authored edit.

## Options

1. Store calculated values directly on properties and send every completion through
   authored edits. This couples evidence arrival to Undo and loses distinct requests/methods.
2. Use root sequence as the execution key. This invalidates work after view movement and
   cannot reuse matching evidence after Undo; ignoring it risks accepting unrelated inputs.
3. Separate authored requests, captured execution snapshots, immutable receipts and derived
   associations. Keep one authored aggregate owner and one explicit evidence lifecycle.
4. Introduce a general solver/DAG/plugin framework first. No current fixture establishes
   its semantics or justifies its additional lifecycle and compatibility commitments.

## Decision

Continue isolated F4 experiments using option 3 as tested by F3. Requests are immutable
records with qualified pin/follow inputs and exact method ID/version/runtime requirements.
A job captures verified normalized values, claim/source revision pins and interpretation.
The deterministic key includes this information, excluding layout and unrelated revisions.

Completion checks output shape, units and finite values, then appends a success/failure
receipt without authored Undo. Associations are derived for the actual requested key;
current inputs must resolve before any receipt can be current. Receipt order is explicit,
not inferred from an ID or dictionary ordering. Opening another binding cannot adopt old
completions. Four outstanding executor slots remain occupied until settlement even if an
adapter ignores an abort request.

Save acknowledgements cover authored root, retained evidence version and destination
binding. Open validates request/evidence/source closure before publication and starts no
jobs. Native transport excludes active jobs and derived indexes. Linked-source absence
can preserve historical evidence but cannot provide current verified inputs.

The F3 method catalog and JSON envelope are closed fixtures. F2/F1b contracts are reused
without modifying their tested source identities. F3's storage wrapper adapts its own codec
to the same immutable-staging/atomic-head-CAS backend protocol; this temporary duplication
is not a production storage abstraction decision.

## Consequences

The same request/evidence boundary supports two explicit calculation directions, late
results, retries and Undo reuse. Dependency indexes notify affected requests; source value
changes preserve unchanged edges. Direct fanout still costs proportional to affected users.

All revisions and receipts are retained. The key is a readable deterministic tuple, not
a compact digest or a signature. Repeated snapshots/keys enlarge files; full parsing,
closure validation and asset access are eager. General unit/frame conversion, unknown
future method receipt interpretation, replay guarantees, cross-document mounting,
request graphs, time/CPU limits and real executor artifacts remain unresolved. Unknown
F3 contracts reject before adoption rather than negotiate optional edit capabilities.

## Validation and review

The linked evidence records 21 core groups, six direct worksheet outcomes, 13 real-browser
check groups, fresh-process/fresh-context handoff and measured 100/1000/10000 request,
direct-fanout and receipt workloads. Earlier foundation regressions also pass. This supports
the next isolated slice only; it does not establish production scalability, browser capacity,
power-loss durability, unfamiliar-engineer understanding or live-canvas integration.

Reconsider if F4 cannot pin coherent source/input selections, if a different method family
needs to put executor state into authored records, or if measured retention/fanout costs
cannot meet subsequently chosen product budgets. ADRs 0001–0005 remain proposed.
