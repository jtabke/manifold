# 0031: Check complete retained capacity before publication

Status: Implemented; current verification is recorded in EVIDENCE (local-only report).
Date: 2026-10-28
Related: Parent goal (internal design note),
[owner validation](0023-owner-controlled-domain-validation.md),
[shared evidence](0029-canvas-sampler-on-shared-evidence.md).

## Problem and decision

Nine 900 KB CSV sources were accepted and saved locally with an 8,169,241-byte estimated snapshot,
but native export failed at its independent 8,000,000-byte limit. Local Save also refused excessive
retained history only after edits were already accepted. Raising a file limit alone would leave
evidence, assets, identity ledgers and recovery admission disconnected.

The existing owner now offers trusted synchronous `validateState(WorkspaceState)`, receiving the
complete immutable candidate document, receipt map and resource port. It runs before initial/live
adoption, authored edits, Undo, preview, Keep, compaction and evidence/resource publication. The
candidate has no publication or Save authority; only an owner-produced capture is a Save capability.
The existing `validateDocument` continues to validate authored domain meaning. State policy adds
cross-cutting retained-work admission without rerunning that authored semantic gate on every result.
Both hooks must throw to reject and return no value; promises are refused and their rejections consumed.

Every retained transition checks the actual candidate receipts and resources before assigning any
accepted root, clock, index, resources or history. Evidence publication also holds the operation guard
while running trusted policy. Reentrant writes/teardown reject. A refused result admits no receipt or
output bytes and advances no checked clock. Overlapping executions can finish, but each must still
fit at its publication point. Transient scheduler/input/output reservations retain their separate bounds.

## Canvas capacity contract

The canvas installs its existing incremental conservative estimator as this policy. It counts all
retained revisions, views, alternatives, receipts, known/allocated IDs and included resource bounds,
including historical/receipt-only resources. Unchanged persistent map nodes and immutable value
weights are memoized. Counts deliberately overestimate shared data. Validated UTF-8 JSON byte sizes
(equal to canonical JSON sizes regardless of object-key order), physical record/context overhead and
worst-case asset string escaping are included; CSV character count is not substituted for encoded
bytes. Sizing does not require canonical key sorting; hashing still does. The
[differential sizing contract](../../../apps/canvas/tests/check-storage-budget.mjs) preserves exact
weights and admission boundaries. Actual native/local sizes are checked against the bound in
representative ASCII, Unicode/backslash and control-character workloads.

- **Admitted retained work:** at most 64 MiB conservative snapshot weight and 4,096 receipts.
  The owner also bounds pending-plus-retained receipt reservations. Exceeding capacity refuses
  the whole operation before publication. Durable history is not silently evicted.
- **Local recovery:** the existing full-reader limit is 64 MiB reachable physical bytes. Save retains
  a defensive owned-capture check, generation CAS and exact acknowledgement; backend quota/I/O
  failures remain possible and leave current work exportable. Unchanged validated recovery writes
  zero new chunks/assets.
- **Native transport:** at most 128 MiB UTF-8, with bounded records/identity ledgers. The shared V7
  writer uses compact JSON, avoiding indentation expansion. Ordinary admitted native output stays
  below the retained-work bound; extra transport headroom permits validated legacy rescue and does
  not increase admission. File selection checks size before reading/finishing unaccepted edits.
  Decode verifies the complete domain/resource contract and then checks admission before live Open.

These are explicit rejection limits, not a claim that every browser can interactively render 64 MiB
of arbitrary engineering content. They are not process-heap or total transient-allocation limits.
Existing per-source, renderer, method, job and input bounds continue to apply. Binary/range readers,
streaming containers and general external tools remain separate extensions.

## Existing work and rescue

A valid saved head can exceed the newer conservative policy (for example, a pre-policy head with
4,097 receipts). It must not crash live construction, be silently truncated or be overwritten by an
empty replacement. Local load checks capacity before establishing a ready write binding. Failure
preserves the head and presents **Export saved work**. That action reads one coherent saved snapshot,
validates hashes/domain/resources, and uses the same V7 codec without creating an owner, acknowledging
or writing. Corrupt/missing saved records reject rescue and remain untouched.
Reload clears the prior recovery acknowledgement before validation; a refused reload cannot ACK
an older capture or establish a write binding against the newly observed head.

If no authoritative IndexedDB primary/marker exists, a legacy backup that fails admission can also
be verified and downloaded with its original bytes. A newer unreadable/missing primary never falls
back to an older backup. `inspectWorkspace` verifies portable data without granting live admission;
legacy decoding now uses pure document preparation instead of temporarily constructing a live owner.
Over-policy rescue files remain inspectable data; they do not silently bypass policy on a later Open.

## Counterexamples and verification

- Separate Save/export limits strand the nine-source workspace. Its native/local and fresh-process
  recipient now preserve all source bytes with zero execution on Open.
- Counting raw characters misses JSON expansion. Twelve control-character sources produce about
  57.6 MB of native/local data while remaining under their computed bound. A fourteenth expanded
  source is refused atomically after thirteen are accepted.
- Checking only authored definitions misses old identity markers and result-only resources. The
  policy tests validate complete candidates and refuse replacement providers or new typed output
  without changing accepted data/resources/history.
- Checking only at Save lets accepted work outgrow recovery. Capacity now rejects at initialization
  and publication, including preview/Keep and late completion; backend failure still preserves work.
- Treating policy inspection as a Save capture or allowing reentrancy breaks authority. Owner
  contracts keep owner captures distinct and the operation guard active through evidence checks.
- Rejecting old work without rescue makes policy changes destructive in practice. Actual Chrome tests
  download every validated receipt from an over-policy IndexedDB head and preserve exact head/bytes;
  an unadopted backup downloads unchanged. Corrupt rescue and older-backup fallback remain refused.

Checks: [state policy](../../../packages/foundation/test/state-policy.test.mjs),
[application boundaries/rescue](../../../apps/canvas/tests/check-canvas-capacity.mjs),
[Chrome rescue](../../../apps/canvas/tests/check-canvas-capacity-browser.mjs),
[capacity workload](../../../apps/canvas/tools/measure-canvas-capacity.mjs), and existing lifecycle,
typed execution, storage/CAS, native compatibility and source-sharing suites. All-source report
identities and net production LOC/decisions are recorded in current evidence. Authored scene meaning,
broader input/render/process memory and the full parent completion audit remain open.
