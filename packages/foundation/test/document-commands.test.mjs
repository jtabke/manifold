import test from "node:test";
import assert from "node:assert/strict";
import * as h from "./helpers.mjs";

test("unknown runtime commands cannot remove alternatives or partially publish a batch", async () => {
  const w = await h.workspace();
  try {
    h.preview(w, 200);
    const kept = h.keep(w);
    h.apply(w, [{ kind: "removeView", id: kept.view }]);
    const document = w.reader.read(),
      stamp = w.reader.stamp(),
      undoSteps = w.diagnostics().undoSteps;
    for (const kind of ["NOT_A_COMMAND", "removeAlternativ", null, undefined]) {
      const result = w.owner.apply(stamp, h.id("invalid-command"), [
        { kind: "rename", item: "force", label: "Must not publish" },
        { kind, id: kept.alternative },
      ]);
      assert.equal(result.ok, false);
      assert.match(result.error, /Unknown command/);
      assert.equal(w.reader.read(), document);
      assert.deepEqual(w.reader.stamp(), stamp);
      assert.equal(w.diagnostics().undoSteps, undoSteps);
      assert.ok(w.reader.read().alternatives.get(kept.alternative));
    }
    h.apply(w, [{ kind: "removeAlternative", id: kept.alternative }]);
    assert.equal(w.reader.read().alternatives.get(kept.alternative), undefined);
    assert.equal(w.diagnostics().undoSteps, undoSteps + 1);
    h.undo(w);
    assert.ok(w.reader.read().alternatives.get(kept.alternative));
  } finally {
    w.owner.dispose();
  }
});
