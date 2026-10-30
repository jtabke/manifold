# 0002: Frozen contexts and result currency

Status: Proposed  
Date: 2026-10-19  
Related: D3–D5, D7; QS2–QS5; R3; [identity proposal](0001-semantic-identity-and-scope.md)

## Context

Today `effective` selects `overrides[id] ?? base[id] ?? region.text`. `branch`
freezes resolved assigned quantities, while equations and many other relationships
remain shared. Editing an Original equation can therefore change an existing
alternative's results. A context label or scalar override map cannot establish
which model, bindings or source versions produced a saved answer.

A preview also needs a base against which acceptance can detect intervening edits.
Result currency, historical comparison and ability to reproduce are separate claims.

## Options

| Option | Benefit | Cost / failure mode |
| --- | --- | --- |
| Keep live equations with frozen input overrides | Cheap, easy to propagate fixes | Baseline and alternatives drift after structural or source changes. |
| Copy the whole workspace for every alternative | Simple isolation | Duplicates identity and presentation; lineage and comparison become difficult. |
| Pin semantic snapshots with explicit context revisions | Stable comparisons with shared immutable content | Requires revision storage and an explicit update operation. |

## Decision

Propose contexts with stable context ID and immutable context revisions. Each
revision pins one complete logical semantic snapshot. The
[concrete proposal](../data-model.md#context-resolution-one-selection-no-patch-inheritance)
and [ADR 0004](0004-normalized-engineering-records.md) refine this contract: typed
patches are operation input and optional audit metadata, not authoritative stored
override layers. Apply and validate a patch to produce a new complete selection.
Use shared immutable records rather than deep-copying every source. A patch can
change an assigned assumption or explicitly select another definition, model or
source revision; it cannot silently mutate its base.

A complete resolved context manifest identifies all effective definitions,
bindings, instance/model revisions, source revisions and evaluation-affecting
assumptions. Units and evaluator configuration are included where they affect
interpretation. Context labels, selection, layout and cameras are excluded.
An unresolved reference is retained as an error, never filled with a prior result.

### Composition and lifecycle

`previous` records same-context history; `basedOn` pins an alternative's baseline.
Updating an alternative records both its prior revision and its new baseline; neither
reference is followed to inherit latest definitions.

1. Start preview from a pinned context revision and workspace sequence. Preview
   patches are ephemeral and do not enter archives, history or accepted receipts.
2. Accept applies the patch to the selected context as a new immutable context
   revision. Keep alternative creates a new context ID and revision from that same
   pinned base; the original context is unchanged.
3. A baseline edit advances only the selected context. Other saved alternatives
   continue to resolve against their pinned snapshots, including equations,
   interfaces, bindings and sources. Show that a newer baseline exists.
4. Updating an alternative to a newer baseline is explicit: compute changes from
   its old base, apply compatible overrides, and report conflicts for modified or
   deleted targets, changed dimensions, bindings, ports or source revisions.
   Publish nothing until conflicts are resolved or the update is cancelled.
5. For this design, each revision has one base. No implicit multiple inheritance,
   precedence between arbitrary contexts, or automatic merge of design changes.
   Nested instances inherit the enclosing context's explicit port bindings and
   retain pinned internal model revisions; unbound required ports are errors.

A pending preview whose semantic base changed must be rejected or regenerated
for review. A presentation-only change can be preserved when applying its patch
if the semantic base is still identical; the operation owner rechecks the latest
workspace sequence before publishing. Switching context cancels the preview.

### Evaluation and receipt contract

An execution request pins the resolved manifest, requested outputs, resolved input
values with units, method/code revision, evaluator/runtime version and relevant
configuration (including seed and tolerances when used). A canonical execution
key covers these semantic inputs and excludes presentation. Separate request IDs
identify attempts; a context revision links the result to authored history.

A receipt records the request manifest and key, output values/errors, method and
runtime metadata, and source availability. Store manifests or durable references
to retained revisions, not just an opaque digest. If an adapter cannot identify
its method or runtime, report that limitation and do not claim reproducibility.

| State | Meaning / display rule |
| --- | --- |
| Current | Receipt matches the complete current execution key for this output and has validated outputs. |
| Historical / stale | Receipt matches earlier inputs; may be inspected or compared with a visible historical context, never substituted for current work. |
| Pending / failed / unresolved | Current request has no valid answer; any older answer is separately labeled. |
| Reproducible | Required inputs, sources and method/runtime are available under a declared reproduction policy; currency alone does not establish this. |

A result from another context may be reused when the full execution key matches;
record the new association with the requesting context without rewriting the
original receipt. Context ID alone neither proves nor prevents semantic equality.
Execution success does not establish physical validity or requirement satisfaction.

On completion, the operation owner checks request identity, adapter output contract
and the current key. A late response can be retained as historical evidence but
cannot overwrite a newer output. Cancellation is best effort; it is not the
currency mechanism. A view change leaves an in-flight semantic request valid.

## Consequences

Alternatives become stable engineering comparisons. Shared-equation fixes require
explicit updates and conflict review, which adds interaction cost. Context revision
and semantic execution keys are distinct: editing an unrelated note may advance a
snapshot without requiring the same numerical computation again.

Migration must materialize each legacy context's effective definitions, bindings
and sources at import time. It cannot recover the equations that existed when an
old alternative was first made. Mark this as a migration-time baseline; do not
manufacture historical evidence. Preserve legacy receipts as historical unless
their complete execution contract can be verified.

## Validation and review

For `F := k * x`, keep `x := 2 mm` as an alternative, then edit the baseline to
`F := 2 * k * x` and reimport a changed `k` source. The alternative must retain
its old equation and source until explicitly updated. Test conflict/cancel and
save/reopen. Deliver an old execution after acceptance and after Undo (QS2–QS5).
Test equal execution inputs in different contexts and layout-only edits as well.

Review outcome: not yet accepted. Confirm users can distinguish a frozen
alternative from an updated baseline. If live-linked scenarios are needed later,
introduce them as an explicit separate policy; do not weaken saved alternatives.
