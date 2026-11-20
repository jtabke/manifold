import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import {
  archive,
  decodeWorkspace,
  makeArtifact,
} from "../src/regions/artifacts.ts";
import { planConnection } from "../src/regions/linking.ts";
import { observeAuthoring } from "./authoring-probe.mjs";
import { drawingFixture } from "./drawing-fixture.mjs";
import {
  canvasSchemas,
  canvasPage,
  validateCanvasDocument,
} from "../src/regions/app/canvasDocument.ts";
import { validateOptimizationResponses } from "../src/regions/modelOptimizationCommands.ts";
import { CanvasStorageBudget } from "../src/regions/app/canvasStorageBudget.ts";

const s = new RegionSession();
const add = (text) => {
  const id = s.create();
  assert.equal(s.write(id, text).ok, true);
  return id;
};
const k = add("k := 10 N/mm"),
  x = add("x := 1 mm"),
  force = add("F := k*x");
const source = "gain,noise\n10," + "u".repeat(900_000);
const dataset = s.importData("measurements.csv", source, { x: 20, y: 700 });
const csv = s.state.regions.find((r) => r.id === dataset);
const gain = s.quantityFromCell(dataset, 0, 0, "gain", "N/mm", {
  x: 20,
  y: 400,
});
const receipt = s.keepCurrentCalculation("Source-backed worksheet");
const savedCalculation = s.state.calculations.find((c) => c.id === receipt);
const artifact = makeArtifact(s.state, force, "Plot F versus x from 0 to 3");
s.setArtifacts([artifact]);
function observe(operation) {
  const result = observeAuthoring(source, operation);
  assert.equal(result.counters.sourceCloneCalls, 0);
  assert.equal(result.counters.sourceSerializationCalls, 0);
  assert.equal(
    s.state.regions.find((r) => r.id === dataset),
    csv,
  );
  assert.equal(
    s.state.calculations.find((c) => c.id === receipt),
    savedCalculation,
  );
  return result.value;
}

// One literal edit preserves every unrelated immutable record and the selected recipe.
const before = s.document,
  page = canvasPage(before); // The renderer may still reuse an equal Page from before setArtifacts().
observe(() => assert.equal(s.write(x, "x := 2 mm").ok, true));
assert.equal(s.document.revisions.size, before.revisions.size + 1);
assert.equal(
  s.state.regions.find((r) => r.id === k),
  page.regions.find((r) => r.id === k),
);
assert.equal(s.state.contexts, page.contexts);
assert.equal(s.state.calculations, page.calculations);
assert.equal(s.state.layout, page.layout);
assert.equal(page.regions.find((r) => r.id === x).text, "x := 1 mm");
assert.equal(project(s.state).solved.values.get("F").value, 20);
const changed = s.document;
observe(() => s.write(x, "x := 2 mm"));
assert.equal(s.document, changed, "equal edits allocate no revision or Undo");

// Placement, flow arrangement, model scope and its interface do not clone source payloads.
const revisions = s.document.revisions;
observe(() => s.move(x, { x: 30, y: 220 }));
assert.equal(s.document.revisions, revisions);
observe(() => s.arrange({ [k]: { x: 30, y: 100 }, [x]: { x: 30, y: 220 } }));
observe(() =>
  s.makeModel(
    {
      id: "model-spring",
      name: "Spring",
      members: [k, x, force],
      inputs: [k, x],
      outputs: [force],
    },
    { x: 80, y: 80 },
  ),
);
observe(() => s.exposeModel("model-spring", [k, x], [force], "Spring model"));
observe(() => s.styleModel("model-spring", { shape: "frame" }));

// Context and connection changes stay atomic; invalid alternatives preserve the prior owner.
const context = observe(() => s.branch());
const alternative = s.document;
observe(() => assert.equal(s.write(x, "x := 2 s").ok, false));
assert.equal(s.document, alternative);
observe(() => s.write(x, "x := 3 mm"));
observe(() => s.switchContext("original"));
const edit = observe(() => planConnection(s.state, gain, k));
observe(() => assert.equal(s.connect(edit).ok, true));
assert.equal(project(s.state).solved.values.get("F").value, 20);
observe(() => s.undo());

// Identity-bound rename updates consumers and all context snapshots without changing CSV.
observe(() => s.write(k, "stiffness := 10 N/mm"));
assert.match(s.state.regions.find((r) => r.id === force).text, /stiffness/);
assert.equal(project(s.state).solved.values.get("F").value, 20);
observe(() => s.switchContext(context));
assert.equal(project(s.state).solved.values.get("F").value, 30);
observe(() => s.switchContext("original"));
const original = s.state;
observe(() => s.write(x, "x := 4 mm"));
observe(() => s.branchEdit(x, original));
assert.equal(project(s.state).solved.values.get("F").value, 40);
observe(() => s.undo());

// Kept/native provenance still closes over original source revisions after these edits.
const decoded = await decodeWorkspace(archive(s.native()));
assert.equal(
  decoded.page.regions.find((r) => r.id === dataset).data.csv,
  source,
);
assert.equal(
  decoded.page.calculations[0].snapshot.id,
  savedCalculation.snapshot.id,
);
assert.equal(semanticKey(decoded.page), semanticKey(s.state));
assert.equal(f.current(s.document, "region:" + dataset).body.value, csv);
// Compare the public live command port with full admission over fresh immutable
// roots (no retained answers from the live materialization/validation caches).
function compareAdmission(session, commands, rejects) {
  const before = session.document,
    receipts = session.foundation.evidence(),
    prepared = f.prepare(before, "oracle", commands, canvasSchemas).document,
    cold = f.fromPlain(f.toPlain(prepared), canvasSchemas),
    admit = () => {
      validateCanvasDocument(cold);
      validateOptimizationResponses(cold, receipts);
      new CanvasStorageBudget().check(
        { document: cold, receipts, resources: session.foundation.resources() },
        canvasSchemas,
      );
    };
  let notices = 0;
  const off = session.subscribe(() => notices++);
  const step = (draft) => {
    assert.equal(draft.document, before);
    draft.applyCommands(commands);
    return draft.state;
  };
  try {
    if (rejects) {
      assert.throws(admit, rejects);
      assert.throws(() => session.prepare(step), rejects);
      assert.throws(() => session.atomic(step), rejects);
      assert.throws(() => session.applyCommands(commands, before), rejects);
      assert.equal(session.document, before);
      assert.equal(notices, 0);
    } else {
      admit();
      const plan = session.prepare(step);
      assert.deepEqual(plan.value, canvasPage(cold));
      assert.deepEqual(plan.commands, commands);
      assert.equal(plan.expected, before);
      assert.equal(session.document, before);
      assert.equal(notices, 0);
      assert(session.applyCommands(commands, before));
      assert.deepEqual(session.state, canvasPage(cold));
      assert.equal(notices, 1);
    }
    assert.equal(session.foundation.evidence(), receipts);
  } finally {
    off();
  }
}
function revise(session, id, update) {
  const item = "region:" + id,
    revision = structuredClone(f.current(session.document, item));
  revision.id = "test:" + crypto.randomUUID();
  update(revision.body);
  return { kind: "revise", item, revision };
}
compareAdmission(s, [revise(s, x, (b) => (b.value.text = "x := 8 mm"))]);
compareAdmission(
  s,
  [revise(s, x, (b) => (b.document = "other"))],
  /binding mismatch/,
);
compareAdmission(
  s,
  [revise(s, x, (b) => (b.value.text = "a".repeat(5001)))],
  /workspace archive/,
);
// The changed record alone is valid. Its source-backed cell / compiled recipe is not.
compareAdmission(
  s,
  [revise(s, dataset, (b) => (b.value.data.csv = "gain,noise\n11,new"))],
  /workspace archive/,
);
compareAdmission(
  s,
  [revise(s, force, (b) => (b.value.text = "F := 0 N"))],
  /worksheet meaning/,
);
// A valid final head cannot hide a rejected intermediate step. A caught rejection
// must not even advance the private draft or reserve its proposed revision ID.
const start = s.document,
  bad = revise(s, x, (b) => (b.document = "other")),
  good = revise(s, x, (b) => (b.value.text = "x := 12 mm"));
validateCanvasDocument(
  f.fromPlain(
    f.toPlain(
      f.prepare(start, "final-only", [bad, good], canvasSchemas).document,
    ),
    canvasSchemas,
  ),
);
for (const method of ["prepare", "atomic"]) {
  let repaired = false;
  assert.throws(
    () =>
      s[method]((draft) => {
        draft.applyCommands([bad]);
        repaired = true;
        draft.applyCommands([good]);
      }),
    /binding mismatch/,
  );
  assert.equal(repaired, false);
  assert.equal(s.document, start);
}
const plan = observe(() =>
  s.prepare((draft) => {
    assert.throws(
      () => draft.applyCommands([{ ...good, extra: undefined }]),
      /Non-JSON/,
    );
    assert.equal(draft.document, start);
    assert.throws(() => draft.applyCommands([bad]), /binding mismatch/);
    assert.equal(draft.document, start);
    draft.applyCommands([
      { ...good, revision: { ...good.revision, id: bad.revision.id } },
    ]);
    assert.equal(draft.write(x, "x := 13 mm").ok, true);
    return draft.state;
  }),
);
let escaped;
assert.throws(
  () =>
    s.atomic(async (draft) => {
      escaped = draft;
      throw Error("late rejection");
    }),
  /synchronous/,
);
assert.throws(() => escaped.applyCommands([good]), /closed/);
assert.equal(plan.commands.length, 2);
assert.equal(s.document, start);
observe(() => s.atomic((draft) => draft.applyCommands(plan.commands)));
assert.deepEqual(s.state, plan.value);
s.undo();
assert.equal(s.document.items, start.items);
s.dispose();

// Count actual traversal during the first scalar write on each admitted root;
// no wall-clock threshold, validation-only proxy operation or manual prewarming.
function writeWork(drawings, retainedRevisions, mode) {
  const page = {
    regions: Array.from({ length: 64 }, (_, i) => ({
      id: "row-" + i,
      text: `q${i} := ${i + 1}`,
      mathVersion: 3,
    })),
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    plots: [],
    origin: { x: 0, y: 0 },
    layout: {},
  };
  const session = drawings
    ? drawingFixture(drawings, page).session
    : new RegionSession(page);
  if (retainedRevisions)
    session.applyCommands(
      Array.from({ length: retainedRevisions }, (_, i) =>
        revise(session, "row-0", (b) => (b.value.text = `q0 := ${i}`)),
      ),
    );
  const before = session.document,
    work = { entries: 0, gets: 0, folds: 0, drawingGets: 0 };
  const proto = f.SharedMap.prototype,
    { entries, get, fold } = proto;
  proto.entries = function* () {
    for (const pair of entries.call(this)) {
      work.entries++;
      yield pair;
    }
  };
  proto.get = function (key, counters) {
    work.gets++;
    if (key.startsWith("drawing-load-")) work.drawingGets++;
    return get.call(this, key, counters);
  };
  proto.fold = function (visit, memo) {
    return fold.call(
      this,
      (...args) => {
        work.folds++;
        return visit(...args);
      },
      memo,
    );
  };
  let write;
  try {
    const change = (target) => target.write("row-32", "q32 := 100");
    if (mode === "direct") write = change(session);
    else if (mode === "atomic") write = session.atomic(change);
    else {
      const plan = session.prepare(change);
      assert.equal(session.document, plan.expected);
      write = plan.value;
      session.applyCommands(plan.commands, plan.expected);
    }
  } finally {
    Object.assign(proto, { entries, get, fold });
  }
  assert(write.ok, write.error);
  assert.equal(session.document.revisions.size, before.revisions.size + 1);
  assert.equal(project(session.state).solved.values.get("q32").value, 100);
  if (drawings && mode === "direct") {
    // A second changed domain must force complete checks: a live drawing view cannot lose its target.
    compareAdmission(
      session,
      [
        revise(session, "row-32", (b) => (b.value.text = "q32 := 101")),
        { kind: "delete", item: "drawing-load-0" },
      ],
      /Missing drawing/,
    );
  }
  session.dispose();
  return work;
}
for (const mode of ["direct", "atomic", "prepare+apply"]) {
  const small = writeWork(0, 0, mode),
    dense = writeWork(1999, 0, mode),
    history = writeWork(0, 2048, mode);
  console.log(`RegionSession.write traversal (${mode}, 64 equations):`, {
    small,
    dense,
    history,
  });
  assert(
    small.entries < 8 && small.gets < (mode === "direct" ? 64 : 128),
    JSON.stringify(small),
  );
  for (const work of [dense, history]) {
    assert(work.entries <= small.entries + 2, JSON.stringify(work));
    assert(work.gets <= small.gets + 2, JSON.stringify(work));
    assert.equal(work.drawingGets, 0);
    // AVL storage-budget folds visit changed paths, not all drawings or old revisions.
    assert(work.folds <= small.folds + 64, JSON.stringify(work));
  }
}
// A public staging flag is not provenance, even with the same root ID or a
// caller-owned document which changes *after* the constructor checked it.
{
  const { session } = drawingFixture(10),
    id = session.create();
  assert(session.write(id, "x := 1").ok);
  const before = session.document,
    bad = f.prepare(
      before,
      before.id,
      [{ kind: "delete", item: "drawing-load-0" }],
      canvasSchemas,
    ).document,
    edit = revise(session, id, (b) => (b.value.text = "x := 2"));
  for (const staging of [false, true])
    assert.throws(
      () => new RegionSession(session.state, () => [], bad, [], staging),
      /Missing drawing/,
    );
  const supplied = { ...before },
    external = new RegionSession(session.state, () => [], supplied, [], true);
  Object.assign(supplied, bad);
  const change = (draft) => draft.applyCommands([edit]);
  assert.throws(() => change(external), /Missing drawing/);
  assert.throws(() => external.prepare(change), /Missing drawing/);
  assert.throws(() => external.atomic(change), /Missing drawing/);
  external.dispose();

  // Preview revision IDs are reserved by the real owner, even after cancellation.
  const preview = session.preview(f.reference(before.document, edit.item), [
    edit,
  ]);
  for (const active of [true, false]) {
    if (!active) session.cancelPreview();
    assert.throws(() => session.atomic(change), /already allocated/);
    assert.equal(session.document, before);
    assert.equal(session.foundation.preview(), active ? preview : undefined);
  }
  // An unrelated raw create can extend the legacy identity ledger. Forking must
  // still refuse an out-of-range retired ID rather than bypassing canvasSerial.
  const item = "other:region-100000000";
  session.applyCommands([
    {
      kind: "create",
      item,
      label: item,
      revision: {
        ...f.current(before, "drawing-load-0"),
        id: "oversize-id",
        item,
      },
    },
    { kind: "delete", item },
  ]);
  assert.throws(() => session.prepare(() => {}), /identity allocation limit/);
  assert.throws(() => session.atomic(() => {}), /identity allocation limit/);
  session.dispose();
}
console.log(
  "Targeted authoring: source/kept-record sharing, literal/no-op edits, placement, model interfaces, contexts, failure, connection/rename, branch review, Undo, native provenance and differential admission pass.",
);
