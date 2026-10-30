import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  authored,
  connected,
  definition,
  dependencyKey,
  displacement2,
  doubledLaw,
  evaluate,
  fixtureIds as ids,
  head,
  revise,
  selected,
} from "./lifecycle.ts";

for (const blob of connected.blobs) {
  assert.equal(blob.content.kind, "inline");
  assert.equal(
    blob.digest,
    `sha256:${createHash("sha256").update(blob.content.data).digest("hex")}`,
  );
  assert.equal(blob.byteLength, Buffer.byteLength(blob.content.data));
}
const baseline = head(connected, ids.original);
assert.equal(evaluate(authored, head(authored, ids.original)), 10);
assert.equal(evaluate(connected, baseline), 10);
// Preview is a temporary candidate; neither the accepted archive nor its heads change.
const preview = revise(connected, ids.original, "preview", [displacement2]);
assert.equal(evaluate(preview, head(preview, ids.original)), 20);
assert.equal(evaluate(connected, baseline), 10);
assert.equal(connected.workspace.sequence, 1);

// Keep uses the pinned base and one complete accepted root for context and comparison.
const branched = revise(
  connected,
  ids.alternative,
  "kept",
  [displacement2],
  undefined,
  baseline,
);
const alternative = head(branched, ids.alternative);
const kept = {
  ...branched,
  workspace: {
    ...branched.workspace,
    comparisons: [
      {
        id: "baseline-v-alternative",
        left: baseline,
        right: alternative,
        targets: [{ kind: "quantity", quantity: ids.force }],
      },
    ],
  },
};
assert.equal(head(kept, ids.original), baseline);
assert.equal(evaluate(kept, alternative), 20);
assert.equal(kept.workspace.comparisons.length, 1);
assert.equal(
  Object.keys(kept.records.definitions).length,
  Object.keys(connected.records.definitions).length + 1,
);
assert.strictEqual(kept.blobs, connected.blobs);
assert.strictEqual(
  kept.records.definitions["law-1"],
  connected.records.definitions["law-1"],
);

// Baseline equation and source changes cannot alter an existing alternative.
const lawChanged = revise(kept, ids.original, "doubled-law", [doubledLaw]);
assert.equal(evaluate(lawChanged, head(lawChanged, ids.original)), 20);
assert.equal(evaluate(lawChanged, alternative), 20);
assert.notEqual(
  dependencyKey(lawChanged, baseline),
  dependencyKey(lawChanged, head(lawChanged, ids.original)),
);
assert.equal(kept.workspace.comparisons[0].left, baseline);
assert.equal(evaluate(lawChanged, kept.workspace.comparisons[0].left), 10);
const oldSource = connected.records.sources["source-v1"];
const newSource = {
  ...oldSource,
  id: "source-v2",
  digest: `sha256:${createHash("sha256").update("k\n12\n").digest("hex")}`,
  content: { kind: "embedded", blob: "csv-v2" },
};
const reimported = revise(
  lawChanged,
  ids.original,
  "reimported",
  [],
  newSource,
);
const refreshed = {
  ...reimported,
  blobs: [
    ...reimported.blobs,
    {
      id: "csv-v2",
      digest: newSource.digest,
      byteLength: 5,
      content: { kind: "inline", encoding: "utf8", data: "k\n12\n" },
    },
  ],
};
assert.equal(evaluate(refreshed, head(refreshed, ids.original)), 24);
assert.equal(evaluate(refreshed, alternative), 20);
assert.equal(refreshed.blobs.length, 2);

// Updating an alternative is explicit: select the new baseline and reapply its input.
const updated = revise(
  refreshed,
  ids.alternative,
  "updated-alternative",
  [displacement2],
  undefined,
  head(refreshed, ids.original),
);
assert.equal(evaluate(updated, head(updated, ids.alternative)), 48);
assert.equal(evaluate(updated, alternative), 20);
assert.equal(
  updated.records.contexts[head(updated, ids.alternative)].previous,
  alternative,
);
assert.equal(
  updated.records.contexts[head(updated, ids.alternative)].basedOn,
  head(refreshed, ids.original),
);
assert.equal(kept.records.contexts[alternative].basedOn, baseline);

// Presentation and unrelated notes do not change this output's dependency key.
const moved = structuredClone(kept);
moved.workspace.views[ids.view].placement.x = 900;
assert.equal(
  dependencyKey(moved, alternative),
  dependencyKey(kept, alternative),
);
const changedNote = {
  ...definition(kept, alternative, ids.note),
  id: "note-2",
  body: { kind: "note", text: "Another note", format: "plain" },
};
const annotated = revise(kept, ids.alternative, "note-changed", [changedNote]);
assert.equal(
  dependencyKey(annotated, head(annotated, ids.alternative)),
  dependencyKey(kept, alternative),
);

// A late result may be reused only when the restored inputs match its key.
const oldResult = { key: dependencyKey(kept, alternative), value: 20 };
assert.notEqual(
  oldResult.key,
  dependencyKey(refreshed, head(refreshed, ids.original)),
);
assert.equal(oldResult.key, dependencyKey(refreshed, alternative));

// Undo restores a prior accepted root while advancing sequence and retaining records.
const undone = {
  ...kept,
  workspace: { ...connected.workspace, sequence: kept.workspace.sequence + 1 },
};
assert.equal(evaluate(undone, head(undone, ids.original)), 10);
assert.equal(undone.workspace.comparisons.length, 0);
assert.equal(undone.workspace.contexts[ids.alternative], undefined);
assert.ok(undone.records.contexts[alternative]);
assert.ok(undone.workspace.sequence > kept.workspace.sequence);

// Archive serialization preserves identities and included source bytes.
const reopened = JSON.parse(JSON.stringify(refreshed));
assert.equal(evaluate(reopened, head(reopened, ids.original)), 24);
assert.equal(evaluate(reopened, head(reopened, ids.alternative)), 20);
assert.deepEqual(reopened.workspace.comparisons, kept.workspace.comparisons);

// Missing information must fail rather than fall back to an earlier scalar.
const missingBytes = { ...kept, blobs: [] };
assert.throws(() => evaluate(missingBytes, alternative), /Unavailable bytes/);
const missingTarget = structuredClone(kept);
delete missingTarget.records.snapshots[selected(kept, alternative).id]
  .definitions[ids.k];
assert.throws(
  () => evaluate(missingTarget, alternative),
  /Missing or mismatched definition/,
);
const draftLaw = structuredClone(doubledLaw);
draftLaw.id = "law-draft";
draftLaw.body.method.expression.syntax = "draft";
const draft = revise(kept, ids.alternative, "draft", [draftLaw]);
assert.throws(
  () => evaluate(draft, head(draft, ids.alternative)),
  /Incomplete expression/,
);
const dangling = structuredClone(doubledLaw);
dangling.id = "law-unresolved";
dangling.body.method.expression.references[0].resolution = {
  kind: "unresolved",
  reason: "Deleted target",
};
const unresolved = revise(kept, ids.alternative, "unresolved", [dangling]);
assert.throws(
  () => evaluate(unresolved, head(unresolved, ids.alternative)),
  /Unresolved reference/,
);
assert.throws(
  () =>
    revise(kept, ids.original, "collision", [
      {
        ...displacement2,
        body: { kind: "note", text: "Wrong identity", format: "plain" },
      },
    ]),
  /Immutable revision collision/,
);

console.log(
  "Design lifecycle passes: author, connect, preview/cancel, Keep, baseline edit, source reimport, explicit update, Undo, reopen, dependency isolation and honest failure.",
);
