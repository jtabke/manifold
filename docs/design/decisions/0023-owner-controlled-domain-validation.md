# 0023: Owner-controlled application validation

Status: Accepted for the shared transaction boundary; broader migration remains open.
Date: 2026-10-27
Related: Application foundation migration (internal design note),
[application interfaces](../application-interfaces.md), [operation lifecycle](../operation-lifecycle.md).

## Context

The canvas prepared commands, validated the resulting Page and calculation sources,
then asked the foundation owner to prepare the same commands again. Besides repeated
work, this obscured which candidate actually passed application validation. The owner
must remain responsible for selections, identity allocation, evidence, Undo and publication.

## Options

- Keep duplicate preparation and trust deterministic repetition. This leaves extra work
  and two acceptance paths in the application adapter.
- Expose prepared candidates for later adoption. This requires owner-issued handles and
  lifetime rules, including evidence that can advance while the authored root stays fixed.
  A root check alone could overwrite newer receipts or lifecycle metadata.
- Run a trusted synchronous application validator inside the existing owner transaction.
  This uses the existing busy/stamp guards and publishes exactly the validated candidate.

## Decision

Accept optional `validateDocument(candidate)` configuration on `createWorkspace`.
The host registers a pure synchronous function, which returns `undefined` or throws.
It runs after structural validation and before any accepted selection or associated
lifecycle mutation. Apply prepares once. Initial creation, Undo, preview, Keep, Open and
cleanup use the same validator; evidence-only arrival retains its own validation lane.
Non-synchronous return values reject. Native data cannot register executable validation.

The canvas moves its Page/artifact/source checks to this boundary. Its private draft
adapter still prepares and validates its own unpublished candidate. No public prepared
candidate registry, additional history system or native version is introduced.

## Consequences

The accepted candidate and validated candidate have identical object identity. Failed
validation preserves resources, Undo, reservations, bindings, active jobs and publication
counts. Stale and reentrant operations retain existing guard behavior. Applications
remain responsible for callback purity and cost; full Page validation is still a scan.
This change does not solve affected-record editing or generalized execution.

## Validation and review

Seven [contract scenarios](../../../packages/foundation/test/domain-validation.test.mjs)
cover exact identity, rejection/retry, stale/reentrant edits, async-validator rejection,
Undo/preview/Keep/cleanup failures, failed Open with active execution, and evidence-only
arrival. The 121 core tests, 23 canvas local checks and foundation browser regressions pass.
Canvas browser evidence and current-source diagnostics are recorded in the parent brief
as each gate closes. Reconsider a staged public interface only when an actual asynchronous
acceptance scenario cannot use the existing owner transaction.
