import assert from "node:assert/strict";
import {
  createHeadlessWorkspace,
  openHeadlessWorkspace,
  HeadlessError,
} from "manifold-canvas/headless";

const code = (expected) => (error) =>
  error instanceof HeadlessError && error.code === expected;
const workspace = createHeadlessWorkspace();
let reopened;
try {
  const initial = workspace.read();
  let leaked;
  const ids = workspace.transaction(initial.id, (edits) => {
    leaked = edits;
    const model = edits.createModel("spring");
    edits.setModelInput(model, "displacement", 3);
    const x = edits.createEquation("x := 2 mm", { x: 220, y: 310 });
    const k = edits.createEquation("k := 10 N/mm");
    const force = edits.createEquation("F = k*x");
    const note = edits.createNote("Assume a linear spring");
    return { model, x, k, force, note };
  });
  assert.equal(
    workspace.read().sequence,
    initial.sequence + 1,
    "mixed transaction publishes exactly one root",
  );
  const snapshot = workspace.worksheet();
  assert.equal(snapshot.regions.length, 4);
  assert.equal(
    snapshot.regions.find((region) => region.id === ids.force).quantity.value,
    20,
  );
  assert.equal(
    snapshot.regions.find((region) => region.id === ids.force).quantity.unit,
    "N",
  );
  assert.deepEqual(
    snapshot.regions.find((region) => region.id === ids.x).position,
    { x: 220, y: 310 },
  );
  assert.equal(
    snapshot.regions.find((region) => region.id === ids.x).quantity.value,
    0.002,
  );
  assert.equal(
    snapshot.regions.find((region) => region.id === ids.x).quantity.unit,
    "m",
  );
  assert.equal(
    snapshot.regions.find((region) => region.id === ids.note).kind,
    "note",
  );
  assert(Object.isFrozen(snapshot));
  assert.throws(() => {
    snapshot.regions[0].text = "mutate";
  }, TypeError);
  assert.throws(
    () => leaked.createNote("Too late"),
    code("OPERATION_REJECTED"),
  );

  const accepted = workspace.read();
  workspace.undo(accepted.id);
  assert.equal(
    workspace.worksheet().regions.length,
    0,
    "one Undo removes all worksheet edits",
  );
  assert.equal(
    workspace.models().length,
    0,
    "same Undo removes the model and its input edit",
  );
  workspace.redo(workspace.read().id);
  assert.equal(workspace.worksheet().regions.length, 4);
  assert.equal(
    workspace
      .describeModel(ids.model)
      .inputs.find((input) => input.id === "displacement").binding.value,
    3,
  );

  const preUpdate = workspace.read();
  workspace.updateEquation(ids.x, "x := 4 mm", preUpdate.id);
  assert.equal(workspace.read().sequence, preUpdate.sequence + 1);
  assert.equal(
    workspace.worksheet().regions.find((region) => region.id === ids.force)
      .quantity.value,
    40,
  );
  assert.equal(
    snapshot.regions.find((region) => region.id === ids.force).quantity.value,
    20,
  );
  workspace.updateNote(
    ids.note,
    "Check the assumed stiffness",
    workspace.read().id,
  );
  assert.equal(
    workspace.worksheet().regions.find((region) => region.id === ids.note).text,
    "Check the assumed stiffness",
  );

  const assertRollback = (run) => {
    const before = workspace.read(),
      bytes = workspace.export();
    run(before);
    assert.equal(workspace.read(), before);
    assert.equal(
      workspace.export(),
      bytes,
      "failure preserves native state and identity reservations",
    );
  };
  assertRollback((before) =>
    assert.throws(
      () =>
        workspace.transaction(before.id, (edits) => {
          edits.setModelInput(ids.model, "displacement", 9);
          edits.updateEquation(ids.x, "x := 9 mm");
          throw Error("Caller failure");
        }),
      code("OPERATION_REJECTED"),
    ),
  );
  assertRollback((before) =>
    assert.throws(
      () =>
        workspace.transaction(before.id, (edits) => {
          edits.createNote("Must not survive");
          try {
            edits.updateEquation("missing", "q := 3");
          } catch {
            /* cannot commit a partial transaction */
          }
        }),
      code("ITEM_NOT_FOUND"),
    ),
  );
  assertRollback((before) =>
    assert.throws(
      () =>
        workspace.transaction(before.id, (edits) => {
          edits.createNote("Must not survive");
          try {
            workspace.dispose();
          } catch {
            /* live owner is not accessible in the callback */
          }
        }),
      code("OPERATION_REJECTED"),
    ),
  );
  assertRollback((before) =>
    assert.throws(
      () =>
        workspace.transaction(before.id, (edits) => {
          edits.createNote("Must not survive");
          workspace.transaction(before.id, () => {});
        }),
      code("OPERATION_REJECTED"),
    ),
  );
  for (const run of [
    (before) => workspace.createNote("F = 10 N", before.id),
    (before) => workspace.createEquation("Some prose", before.id),
    (before) => workspace.createEquation(" ", before.id),
    (before) => workspace.createNote("Long".repeat(1300), before.id),
    (before) =>
      workspace.createEquation("q := 3", before.id, { x: Infinity, y: 0 }),
    (before) => workspace.updateNote("missing", "Not here", before.id),
  ])
    assertRollback((before) =>
      assert.throws(
        () => run(before),
        (error) => error instanceof HeadlessError,
      ),
    );
  assert.throws(
    () => workspace.createNote("Stale", initial.id),
    code("STALE_DOCUMENT"),
  );

  const beforeAsync = workspace.read();
  let pending;
  assert.throws(
    () =>
      workspace.transaction(beforeAsync.id, (edits) => {
        pending = (async () => {
          edits.createNote("Before await");
          await Promise.resolve();
          edits.createNote("After await must fail");
        })();
        return pending;
      }),
    code("INVALID_INPUT"),
  );
  await assert.rejects(pending, code("OPERATION_REJECTED"));
  assert.equal(workspace.read(), beforeAsync);
  workspace.transaction(workspace.read().id, () => "no edits");
  assert.equal(
    workspace.read(),
    beforeAsync,
    "empty transaction is not a history checkpoint",
  );

  const draft = workspace.createEquation("unfinished =", workspace.read().id);
  const draftRead = workspace
    .worksheet()
    .regions.find((region) => region.id === draft);
  assert.equal(draftRead.kind, "draft");
  assert(draftRead.diagnostic);
  assert.equal(draftRead.quantity, null);
  const unresolved = workspace.createEquation(
    "unknownResult = absent*2",
    workspace.read().id,
  );
  const unresolvedRead = workspace
    .worksheet()
    .regions.find((region) => region.id === unresolved);
  assert(unresolvedRead.diagnostic);
  assert.equal(unresolvedRead.quantity, null);
  const note = workspace.createNote("An independent note", workspace.read().id);
  workspace.undo(workspace.read().id);
  assert(
    !workspace.worksheet().regions.some((region) => region.id === note),
    "standalone create is one Undo, not a leftover empty cursor",
  );
  workspace.redo(workspace.read().id);
  assert(workspace.worksheet().regions.some((region) => region.id === note));

  const text = workspace.export();
  reopened = await openHeadlessWorkspace(text);
  assert.deepEqual(reopened.worksheet().regions, workspace.worksheet().regions);
  assert.equal(reopened.export(), text);
  const context = workspace.worksheet().context;
  assert.equal(reopened.worksheet().context, context);
  workspace.dispose();
  assert.throws(() => workspace.worksheet(), code("WORKSPACE_CLOSED"));
  assert.throws(
    () => workspace.transaction(beforeAsync.id, () => {}),
    code("WORKSPACE_CLOSED"),
  );
  console.log(
    "Headless authoring: worksheet values/diagnostics, equation/note commands, one-publication mixed transactions, atomic Undo/Redo, rollback, stale/reentrant/async/lifetime guards and native round trips pass.",
  );
} finally {
  workspace.dispose();
  reopened?.dispose();
}
