import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import {
  captureSelection,
  guardSelection,
  assertSelectionUnchanged,
} from "../src/selection.ts";
import {
  workspace,
  initial,
  schemas,
  methods,
  hash,
  ref,
  revision,
  current,
  apply,
  force,
  compute,
  id,
  meta,
} from "./helpers.mjs";
const rootPin = (item) => ({
  ...ref(item),
  selection: { kind: "pin", revision: item + "-r1" },
});
function keep(w, target) {
  const alternative = id("alternative");
  return w.owner.keep(w.reader.stamp(), id("root"), alternative, "Selection", {
    id: id("view"),
    reference: target,
    renderer: "result@1",
    x: 0,
    y: 0,
    alternative,
  });
}
const create = (item, schema, body, rid = item + "-r1") => ({
  kind: "create",
  item,
  label: item,
  revision: revision(rid, item, schema, body),
});
const links = {
  id: "selection-links@1",
  validate(b) {
    assert(Array.isArray(b.refs));
    b.refs.forEach(f.validateReference);
  },
  references: (b) => b.refs,
  assets: () => [],
  project: (b) => ({ type: "links", value: b }),
};
test("shared selection traversal captures cycles, declared absence and root pins while excluding foreign heads", async () => {
  const loaded = await initial(),
    catalog = f.createSchemas([links]);
  const doc = f.prepare(
    loaded.document,
    id("root"),
    [
      create("a", links.id, {
        refs: [
          ref("b"),
          ref("missing"),
          { ...ref("force"), document: "foreign" },
        ],
      }),
      create("b", links.id, { refs: [ref("a"), rootPin("force")] }),
    ],
    catalog,
  ).document;
  const target = rootPin("a"),
    selected = captureSelection(doc, target, catalog);
  assert.deepEqual(f.contextToPlain(selected.context), {
    root: target,
    heads: { a: "a-r1", b: "b-r1", missing: null },
    revisions: ["a-r1", "b-r1", "force-r1"],
  });
  assert.deepEqual([...selected.pins].sort(), ["a-r1", "force-r1"]);
  f.validateContext(doc, selected.context, catalog);
  assert.equal(
    f.resolve(
      doc,
      { ...ref("force"), selection: { kind: "pin", revision: "force-r1" } },
      selected.context,
    ).status,
    "resolved",
  );
});
test("shared validation rejects incomplete, extraneous, wrong-lineage and unreachable selections", async () => {
  const loaded = await initial(),
    doc = loaded.document,
    context = f.captureContext(doc, ref("pressure"), schemas),
    plain = f.contextToPlain(context);
  const mutations = [
    (c) => {
      delete c.heads.force;
    },
    (c) => {
      c.heads.draft = "draft-r1";
    },
    (c) => {
      c.heads.force = "area-r1";
    },
    (c) => {
      c.revisions = c.revisions.filter((x) => x !== "force-r1");
    },
    (c) => {
      c.revisions.push("draft-r1");
    },
    (c) => {
      c.revisions.push("never-allocated");
    },
  ];
  for (const mutate of mutations) {
    const p = structuredClone(plain);
    mutate(p);
    assert.throws(() => f.validateContext(doc, f.contextFromPlain(p), schemas));
  }
  assert.deepEqual(f.contextToPlain(context), plain);
});
test("a missing frozen pin stays missing after its revision becomes available in baseline", async () => {
  const w = await workspace(),
    target = {
      ...ref("later"),
      selection: { kind: "pin", revision: "later-r1" },
    },
    context = f.captureContext(w.reader.read(), target, schemas);
  apply(w, [create("later", "scalar@1", { ...meta, value: 7, unit: "N" })]);
  f.validateContext(w.reader.read(), context, schemas);
  assert.equal(f.resolve(w.reader.read(), target).status, "resolved");
  assert.equal(f.resolve(w.reader.read(), target, context).status, "missing");
  assert.equal(context.heads.size, 0);
  assert.equal(context.revisions.size, 0);
});
test("one selection guard covers both old and candidate dependencies without unrelated layout or draft changes", async () => {
  const w = await workspace(),
    before = w.reader.read(),
    body = current(before, "pressure").body;
  const candidate = f.prepare(
    before,
    id("candidate"),
    [
      {
        kind: "revise",
        item: "pressure",
        revision: revision(id("request"), "pressure", "request@1", {
          ...body,
          inputs: { ...body.inputs, force: ref("observation") },
        }),
      },
    ],
    schemas,
  ).document;
  const guard = guardSelection(
    before,
    captureSelection(before, ref("pressure"), schemas),
    captureSelection(candidate, ref("pressure"), schemas),
  );
  assert(Object.isFrozen(guard.heads));
  assert(Object.hasOwn(guard.heads, "force"));
  assert(Object.hasOwn(guard.heads, "observation"));
  assert(!Object.hasOwn(guard.heads, "draft"));
  apply(w, [
    { kind: "view", view: { ...before.views.get("draft-view"), x: 50 } },
    {
      kind: "revise",
      item: "draft",
      revision: revision(id("draft"), "draft", "note@1", {
        text: "Unrelated",
        mode: "note",
      }),
    },
  ]);
  assert.doesNotThrow(() => assertSelectionUnchanged(w.reader.read(), guard));
  const changed = f.prepare(
    w.reader.read(),
    id("same-value"),
    [
      {
        kind: "revise",
        item: "observation",
        revision: revision(
          id("observation"),
          "observation",
          "scalar@1",
          current(w.reader.read(), "observation").body,
        ),
      },
    ],
    schemas,
  ).document;
  assert.throws(() => assertSelectionUnchanged(changed, guard), /stale/);
  force(w, 200);
  assert.throws(
    () => assertSelectionUnchanged(w.reader.read(), guard),
    /stale/,
  );
});
test("Keep rejects a pinned root that appeared after preview and publishes nothing on rejection", async () => {
  const w = await workspace(),
    target = {
      ...ref("later"),
      selection: { kind: "pin", revision: "later-r1" },
    };
  assert.equal(w.owner.preview(w.reader.stamp(), target, []).ok, true);
  apply(w, [create("later", "scalar@1", { ...meta, value: 7, unit: "N" })]);
  const before = w.reader.stamp(),
    history = w.diagnostics().undoSteps,
    preview = w.reader.preview(),
    events = [];
  w.reader.subscribe((event) => events.push(event));
  const kept = keep(w, target);
  assert.equal(kept.ok, false);
  assert.match(kept.error, /pinned dependency availability changed/);
  assert.deepEqual(w.reader.stamp(), before);
  assert.equal(w.diagnostics().undoSteps, history);
  assert.equal(w.reader.preview(), preview);
  assert.equal(events.length, 0);
});
test("a retained pinned root stays valid after its baseline head is deleted and through cleanup", async () => {
  const w = await workspace(),
    target = rootPin("pressure");
  assert.equal(w.owner.preview(w.reader.stamp(), target, []).ok, true);
  apply(w, [{ kind: "delete", item: "pressure" }]);
  const review = w.reader.reviewCompaction({ evidence: "reachable" });
  assert.equal(
    w.owner.compact(w.reader.stamp(), id("cleanup"), review).ok,
    true,
  );
  const kept = keep(w, target);
  assert.equal(kept.ok, true, kept.error);
  const alternative = [...w.reader.read().alternatives.entries()][0][0];
  const job = w.owner.compute(w.reader.stamp(), target, { alternative });
  assert.equal(job.ok, true, job.error);
  assert.equal((await job.value.completion).receipt.outcome.output.value, 0.04);
});
test("context reference budgets count traversal work and reject invalid limits", async () => {
  const loaded = await initial();
  assert.throws(
    () => f.captureContext(loaded.document, ref("pressure"), schemas, 1),
    /budget/,
  );
  for (const budget of [0, -1, NaN, Infinity, 1.5])
    assert.throws(
      () => f.captureContext(loaded.document, ref("pressure"), schemas, budget),
      /budget/,
    );
  assert.equal(
    f.captureContext(loaded.document, ref("pressure"), schemas, 4).revisions
      .size,
    3,
  );
});
test("shared capture retains no caller aliases and native handoff preserves closed selections", async () => {
  const w = await workspace(),
    target = { ...ref("pressure"), selector: { kind: "whole", version: 1 } },
    context = f.captureContext(w.reader.read(), target, schemas);
  target.item = "draft";
  target.selector.version = 99;
  assert.equal(context.root.item, "pressure");
  assert.equal(context.root.selector.version, 1);
  assert(Object.isFrozen(context.root.selector));
  const receipt = await compute(w),
    native = f.encode(
      w.reader.read(),
      [receipt.receipt],
      w.reader.resources(),
      schemas,
    );
  const loaded = await f.decode(native, schemas, methods, hash);
  assert.deepEqual(
    f.contextToPlain(loaded.receipts[0].context),
    f.contextToPlain(receipt.receipt.context),
  );
});

test("a staged pinned root can be computed before Keep without mistaking its own receipt for baseline drift", async () => {
  const w = await workspace(),
    rid = id("staged-request"),
    target = { ...ref("pressure"), selection: { kind: "pin", revision: rid } };
  const staged = revision(
    rid,
    "pressure",
    "request@1",
    current(w.reader.read(), "pressure").body,
  );
  const prepared = w.owner.preview(w.reader.stamp(), target, [
    { item: "pressure", revision: staged },
  ]);
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(w.reader.read().revisions.get(rid), undefined);
  const job = w.owner.compute(w.reader.stamp(), target, "preview");
  assert.equal(job.ok, true, job.error);
  assert.equal((await job.value.completion).receipt.outcome.output.value, 0.04);
  assert.equal(
    w.reader.read().revisions.get(rid),
    w.reader.preview().document.revisions.get(rid),
  );
  const kept = keep(w, target);
  assert.equal(kept.ok, true, kept.error);
  assert.equal(current(w.reader.read(), "pressure").id, "pressure-r1");
});
test("selection guards admit only the exact staged revision, not an equivalent replacement with its identity", async () => {
  const loaded = await initial(),
    doc = loaded.document,
    rid = id("staged-force"),
    staged = revision(rid, "force", "scalar@1", {
      ...meta,
      value: 200,
      unit: "N",
    }),
    target = { ...ref("force"), selection: { kind: "pin", revision: rid } };
  const candidate = f.prepare(
    doc,
    id("candidate"),
    [{ kind: "revise", item: "force", revision: staged }],
    schemas,
  ).document;
  const selected = captureSelection(candidate, target, schemas),
    guard = guardSelection(
      doc,
      captureSelection(doc, target, schemas),
      selected,
    ),
    record = candidate.revisions.get(rid);
  assert.doesNotThrow(() =>
    assertSelectionUnchanged(
      { ...doc, revisions: doc.revisions.set(rid, record) },
      guard,
    ),
  );
  assert.throws(
    () =>
      assertSelectionUnchanged(
        { ...doc, revisions: doc.revisions.set(rid, { ...record }) },
        guard,
      ),
    /stale/,
  );
  assert(Object.isFrozen(guard.admissions));
});

test("a preview-owned pinned model revision remains eligible for Keep after composed execution", async () => {
  const m = await import("../workbench/composition-demo.ts"),
    w = f.createWorkspace(await m.initial(hash), {
      schemas: m.schemas,
      methods: m.methods,
      executor: m.execute,
      namespace: id("models"),
    });
  const definitionId = id("model-definition"),
    instanceId = id("model-instance"),
    definition = structuredClone(m.spring);
  definition.nodes.x.default = 2;
  const instance = current(w.reader.read(), "A").body;
  const p = w.owner.preview(w.reader.stamp(), m.ref("pressure-A"), [
    {
      item: "spring",
      revision: revision(
        definitionId,
        "spring",
        "scalar-model-definition@1",
        definition,
      ),
    },
    {
      item: "A",
      revision: revision(instanceId, "A", "scalar-model-instance@1", {
        ...instance,
        model: {
          ...instance.model,
          selection: { kind: "pin", revision: definitionId },
        },
      }),
    },
  ]);
  assert.equal(p.ok, true, p.error);
  const job = w.owner.compute(w.reader.stamp(), m.ref("pressure-A"), "preview");
  assert.equal(job.ok, true, job.error);
  assert.equal(
    (await job.value.completion).receipt.outcome.output.value,
    0.008,
  );
  const kept = keep(w, m.ref("pressure-A"));
  assert.equal(kept.ok, true, kept.error);
  assert.equal(
    current(w.reader.read(), "A").body.model.selection.revision,
    "spring-v1",
  );
});
