import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as d from "../workbench/composition-demo.ts";
let serial = 0;
const id = () => "model-test-" + ++serial;
async function setup() {
  const initial = await d.initial(),
    w = f.createWorkspace(initial, {
      schemas: d.schemas,
      methods: d.methods,
      executor: d.execute,
      namespace: id(),
      historyLimit: 32,
    });
  return { w, initial };
}
const apply = (w, commands) => {
  const r = w.owner.apply(w.reader.stamp(), id(), commands);
  assert.equal(r.ok, true, r.error);
  return r.value;
};
const revise = (w, item, body) => ({
  kind: "revise",
  item,
  revision: {
    id: id(),
    item,
    schema: f.current(w.reader.read(), item).schema,
    required: true,
    body,
  },
});
const projected = (w, item, selector = f.modelPort("force"), context) =>
  f.project(
    w.reader.read(),
    d.ref(item, selector),
    d.schemas,
    w.reader.resources(),
    context,
  );
const number = (w, item, selector) => {
  const r = projected(w, item, selector);
  assert.equal(r.status, "resolved", r.reason);
  return r.projection.value.value;
};
async function compute(w, item = "pressure-A") {
  const job = w.owner.compute(w.reader.stamp(), d.ref(item), "baseline");
  assert.equal(job.ok, true, job.error);
  const done = await job.value.completion;
  assert.equal(done.status, "retained", done.reason);
  return done.receipt;
}
test("same-named shared model internals have independent instance inputs and no expanded item copies", async () => {
  const { w } = await setup(),
    before = w.reader.read().items.size;
  assert.equal(number(w, "A"), 10);
  assert.equal(number(w, "B"), 20);
  const body = f.current(w.reader.read(), "A").body;
  const changed = apply(w, [
    revise(w, "A", {
      ...body,
      inputs: {
        ...body.inputs,
        displacement: { kind: "value", value: 3, unit: "mm" },
      },
    }),
  ]);
  assert.equal(number(w, "A"), 30);
  assert.equal(number(w, "B"), 20);
  assert.ok(!changed.changes.affected.includes("B"));
  assert.equal(w.reader.read().items.size, before);
  assert.equal(
    f.current(w.reader.read(), "A").body.model.selection.revision,
    "spring-v1",
  );
});
test("nested repeated child IDs resolve through complete qualified paths", async () => {
  const { w } = await setup();
  const outer = {
    nodes: {
      a: { kind: "input", label: "k", unit: "N/mm", default: 10 },
      b: { kind: "input", label: "k", unit: "N/mm", default: 30 },
      sum: {
        kind: "method",
        label: "F",
        method: d.sumMethod,
        inputs: {
          left: { child: "one", port: "force" },
          right: { child: "two", port: "force" },
        },
      },
    },
    children: {
      one: {
        label: "One",
        model: d.ref("pair", f.wholeSelector, "pair-v1"),
        inputs: { stiffnessA: { node: "a" } },
      },
      two: {
        label: "Two",
        model: d.ref("pair", f.wholeSelector, "pair-v1"),
        inputs: { stiffnessA: { node: "b" } },
      },
    },
    inputs: { a: { label: "a", node: "a" }, b: { label: "b", node: "b" } },
    outputs: { force: { label: "F", target: { node: "sum" } } },
  };
  apply(w, [
    d.create("outer", "scalar-model-definition@1", outer),
    d.create(
      "nested",
      "scalar-model-instance@1",
      d.instance(d.ref("outer", f.wholeSelector, "outer-v1")),
    ),
  ]);
  assert.equal(number(w, "nested", f.modelNode(["one", "left"], "k")), 10);
  assert.equal(number(w, "nested", f.modelNode(["two", "left"], "k")), 30);
  assert.equal(number(w, "nested"), 80);
});
test("port review is explicit, interpretation/unit checked and private paths cannot cross boundaries", async () => {
  const { w } = await setup();
  assert.equal(projected(w, "C").status, "missing");
  const review = f.reviewModelBinding(
    w.reader.read(),
    d.ref("C"),
    "load",
    d.ref("A", f.modelPort("force")),
    d.schemas,
    w.reader.resources(),
  );
  apply(w, [revise(w, "C", review.body)]);
  assert.equal(number(w, "C"), 20);
  assert.throws(
    () =>
      f.reviewModelBinding(
        w.reader.read(),
        d.ref("C"),
        "load",
        d.ref("A", f.modelNode([], "force")),
        d.schemas,
        w.reader.resources(),
      ),
    /public/,
  );
  assert.throws(
    () =>
      f.reviewModelBinding(
        w.reader.read(),
        d.ref("A"),
        "displacement",
        d.ref("stiffness"),
        d.schemas,
        w.reader.resources(),
      ),
    /unit/,
  );
  const stale = w.reader.stamp();
  apply(w, [revise(w, "stiffness", { ...d.scope, unit: "N/mm", value: 12 })]);
  assert.equal(
    w.owner.apply(stale, id(), [revise(w, "C", review.body)]).ok,
    false,
  );
});
test("template edits stay pinned; update and Undo preserve independent selections", async () => {
  const { w } = await setup();
  const next = structuredClone(d.spring);
  next.nodes.k.default = 50;
  apply(w, [revise(w, "spring", next)]);
  assert.equal(number(w, "A"), 10);
  const update = f.reviewModelUpdate(
    w.reader.read(),
    d.ref("A"),
    d.schemas,
    w.reader.resources(),
  );
  apply(w, [revise(w, "A", update.body)]);
  assert.equal(
    f.current(w.reader.read(), "A").body.model.selection.revision,
    f.current(w.reader.read(), "spring").id,
  );
  assert.equal(
    f.current(w.reader.read(), "B").body.model.selection.revision,
    "spring-v1",
  );
  assert.equal(w.owner.undo(w.reader.stamp(), id()).ok, true);
  assert.equal(
    f.current(w.reader.read(), "A").body.model.selection.revision,
    "spring-v1",
  );
  const incompatible = structuredClone(next);
  incompatible.nodes.k.unit = "N/m";
  apply(w, [revise(w, "spring", incompatible)]);
  assert.throws(
    () =>
      f.reviewModelUpdate(
        w.reader.read(),
        d.ref("A"),
        d.schemas,
        w.reader.resources(),
      ),
    /units/,
  );
});
test("same-valued transitive source revisions change execution identity while kept contexts remain pinned", async () => {
  const { w } = await setup();
  const receipt = await compute(w);
  assert.ok(
    receipt.snapshot.inputs.force.dependencies.some(
      (p) => p.item === "stiffness",
    ),
  );
  assert.equal(w.reader.result(d.ref("pressure-A")).status, "current");
  const body = f.current(w.reader.read(), "A").body;
  const preview = w.owner.preview(w.reader.stamp(), d.ref("pressure-A"), [
    {
      item: "A",
      revision: {
        id: id(),
        item: "A",
        schema: "scalar-model-instance@1",
        required: true,
        body: {
          ...body,
          inputs: {
            ...body.inputs,
            displacement: { kind: "value", value: 2, unit: "mm" },
          },
        },
      },
    },
  ]);
  assert.equal(preview.ok, true, preview.error);
  const altCompute = w.owner.compute(
    w.reader.stamp(),
    d.ref("pressure-A"),
    "preview",
  );
  assert.equal(altCompute.ok, true, altCompute.error);
  await altCompute.value.completion;
  const kept = w.owner.keep(w.reader.stamp(), id(), "twice", "2 mm", {
    id: "comparison",
    reference: d.ref("pressure-A"),
    renderer: "result@1",
    x: 0,
    y: 0,
    alternative: "twice",
  });
  assert.equal(kept.ok, true, kept.error);
  apply(w, [revise(w, "stiffness", { ...d.scope, value: 10, unit: "N/mm" })]);
  assert.equal(number(w, "A"), 10);
  assert.equal(w.reader.result(d.ref("pressure-A")).status, "ready");
  const alt = w.reader.result(d.ref("pressure-A"), { alternative: "twice" });
  assert.equal(alt.status, "current");
  assert.equal(alt.receipt.outcome.output.value, 0.008);
});
test("model receipts use native v3 and survive local recovery/retention without extra execution", async () => {
  const { w } = await setup();
  await compute(w);
  const text = f.encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    d.schemas,
  );
  assert.equal(JSON.parse(text).version, 3);
  const loaded = await f.decode(text, d.schemas, d.methods, f.webHash),
    fresh = f.createWorkspace(loaded, {
      schemas: d.schemas,
      methods: d.methods,
      executor: async () => {
        throw Error("Open executed");
      },
      namespace: id(),
    });
  assert.equal(fresh.reader.result(d.ref("pressure-A")).status, "current");
  const bad = JSON.parse(text);
  bad.version = 2;
  await assert.rejects(
    f.decode(JSON.stringify(bad), d.schemas, d.methods, f.webHash),
    /v3/,
  );
  const backend = f.memoryBackend(),
    local = f.incrementalStorage(backend, d.schemas, d.methods, f.webHash);
  const c = fresh.reader.capture();
  await local.save({
    request: id(),
    stamp: c.stamp,
    document: c.document.document,
    expectedGeneration: 0,
    capture: c,
  });
  const reopened = await local.reopen();
  assert.equal(
    reopened.loaded.receipts[0].snapshot.inputs.force.dependencies.length > 0,
    true,
  );
  const review = fresh.reader.reviewCompaction({ evidence: "reachable" });
  assert.equal(
    fresh.owner.compact(fresh.reader.stamp(), id(), review).ok,
    true,
  );
});
test("cyclic graphs, missing ports and unknown methods fail explicitly", async () => {
  const { w } = await setup(),
    cycle = structuredClone(d.spring);
  cycle.nodes.force.inputs.k = { node: "force" };
  apply(w, [
    d.create("cycle", "scalar-model-definition@1", cycle),
    d.create(
      "cyclic-instance",
      "scalar-model-instance@1",
      d.instance(d.ref("cycle", f.wholeSelector, "cycle-v1")),
    ),
  ]);
  assert.equal(projected(w, "cyclic-instance").status, "ambiguous");
  assert.equal(projected(w, "A", f.modelPort("missing")).status, "missing");
  const unknown = structuredClone(d.spring);
  unknown.nodes.force.method.version = "future";
  apply(w, [
    d.create("unknown", "scalar-model-definition@1", unknown),
    d.create(
      "unknown-instance",
      "scalar-model-instance@1",
      d.instance(d.ref("unknown", f.wholeSelector, "unknown-v1")),
    ),
  ]);
  assert.equal(projected(w, "unknown-instance").status, "unsupported");
});

test("interface review exposes removed/added ports; explicit removal never silently remaps consumers", async () => {
  const { w } = await setup();
  const next = structuredClone(d.spring);
  delete next.outputs.force;
  next.outputs.load = { label: "Load", target: { node: "force" } };
  apply(w, [revise(w, "spring", next)]);
  const review = f.reviewModelUpdate(
    w.reader.read(),
    d.ref("A"),
    d.schemas,
    w.reader.resources(),
  );
  assert.deepEqual(review.interfaceChanges.removedOutputs, ["force"]);
  assert.deepEqual(review.interfaceChanges.addedOutputs, ["load"]);
  apply(w, [revise(w, "A", review.body)]);
  assert.equal(projected(w, "A").status, "missing");
  assert.equal(number(w, "A", f.modelPort("load")), 10);
  assert.equal(number(w, "B"), 20);
});
test("source revisions require explicit selector rebind and old source bytes survive kept contexts and native Open", async () => {
  const { w } = await setup();
  await compute(w, "pressure-B");
  const preview = w.owner.preview(w.reader.stamp(), d.ref("pressure-B"), []);
  assert.equal(preview.ok, true, preview.error);
  const kept = w.owner.keep(
    w.reader.stamp(),
    id(),
    "source-before",
    "Before reimport",
    {
      id: "source-view",
      reference: d.ref("pressure-B"),
      renderer: "result@1",
      x: 0,
      y: 0,
      alternative: "source-before",
    },
  );
  assert.equal(kept.ok, true, kept.error);
  const bytes = JSON.stringify([[40], [25]]),
    asset = await f.asset(bytes, f.webHash);
  const resources = await w.reader.resources().add(asset, bytes, f.webHash);
  const source = { ...f.current(w.reader.read(), "source").body, asset };
  const changed = w.owner.apply(
    w.reader.stamp(),
    id(),
    [revise(w, "source", source)],
    resources,
  );
  assert.equal(changed.ok, true, changed.error);
  assert.equal(projected(w, "B").status, "ambiguous");
  assert.equal(
    w.reader.result(d.ref("pressure-B"), { alternative: "source-before" })
      .status,
    "current",
  );
  const sourceRef = d.ref("source", {
    kind: "cell",
    version: 1,
    revision: f.current(w.reader.read(), "source").id,
    row: 0,
    column: 0,
  });
  const review = f.reviewModelBinding(
    w.reader.read(),
    d.ref("B"),
    "stiffness",
    sourceRef,
    d.schemas,
    resources,
  );
  apply(w, [revise(w, "B", review.body)]);
  assert.equal(number(w, "B"), 40);
  const retention = w.reader.reviewCompaction({ evidence: "reachable" });
  assert.equal(w.owner.compact(w.reader.stamp(), id(), retention).ok, true);
  const native = f.encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    d.schemas,
  );
  const loaded = await f.decode(native, d.schemas, d.methods, f.webHash);
  const fresh = f.createWorkspace(loaded, {
    schemas: d.schemas,
    methods: d.methods,
    namespace: id(),
  });
  assert.equal(number(fresh, "B"), 40);
  assert.equal(
    fresh.reader.result(d.ref("pressure-B"), { alternative: "source-before" })
      .receipt.outcome.output.value,
    0.008,
  );
  const unavailable = {
    read: () => ({ status: "unavailable", reason: "source offline" }),
  };
  assert.equal(
    f.project(
      loaded.document,
      d.ref("B", f.modelPort("force")),
      d.schemas,
      unavailable,
    ).status,
    "unavailable",
  );
});
test("dependency provenance cannot be dropped, duplicated or pointed at a different retained source", async () => {
  const { w } = await setup();
  await compute(w);
  const text = f.encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    d.schemas,
  );
  for (const mutate of [
    (x) => delete x.dependencies,
    (x) => x.dependencies.push(x.dependencies[0]),
    (x) => {
      x.dependencies[0].revision = "area-v1";
    },
  ]) {
    const bad = JSON.parse(text);
    const snapshot = Object.values(bad.snapshots).find(
      (s) => s.inputs.force?.dependencies,
    );
    mutate(snapshot.inputs.force);
    await assert.rejects(
      f.decode(JSON.stringify(bad), d.schemas, d.methods, f.webHash),
      /provenance|missing|mismatch|unordered/,
    );
  }
});
test("native model budgets bound visited computation and mutable nested definitions never poison validation caches", async () => {
  const { w } = await setup();
  const limited = f.createScalarModels([], { steps: 1 });
  const schema = f.createSchemas(limited.schemas);
  assert.equal(
    f.project(
      w.reader.read(),
      d.ref("pair-instance", f.modelNode(["left"], "k")),
      schema,
      w.reader.resources(),
    ).status,
    "corrupt",
  );
  const body = Object.freeze({ ...structuredClone(d.spring) });
  f.modelDefinition(body);
  body.nodes.k.default = Infinity;
  assert.throws(() => f.modelDefinition(body), /numeric/);
  assert.throws(() => f.createScalarModels([], { steps: Infinity }), /limits/);
});

test("fixed native v3 composition fixture remains readable with complete dependency identity", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(
    new URL("portable-v3.fixture.json", import.meta.url),
    "utf8",
  );
  const loaded = await f.decode(text, d.schemas, d.methods, f.webHash);
  const w = f.createWorkspace(loaded, {
    schemas: d.schemas,
    methods: d.methods,
    namespace: id(),
  });
  const r = w.reader.result(d.ref("pressure-A"));
  assert.equal(r.status, "current");
  assert.equal(r.receipt.outcome.output.value, 0.004);
  assert.deepEqual(
    r.receipt.snapshot.inputs.force.dependencies.map((p) => p.item).sort(),
    ["spring", "stiffness"],
  );
});

test("model-local IDs never borrow inherited object properties, including valid toString/valueOf names", async () => {
  const { w } = await setup();
  assert.equal(projected(w, "A", f.modelPort("toString")).status, "missing");
  assert.equal(
    projected(w, "pair-instance", f.modelNode(["toString"], "k")).status,
    "missing",
  );
  const named = structuredClone(d.spring);
  named.nodes.toString = named.nodes.x;
  delete named.nodes.x;
  named.nodes.force.inputs.x = { node: "toString" };
  named.inputs.toString = { label: "Named input", node: "toString" };
  delete named.inputs.displacement;
  named.outputs.valueOf = named.outputs.force;
  delete named.outputs.force;
  apply(w, [
    d.create("named", "scalar-model-definition@1", named),
    d.create(
      "named-instance",
      "scalar-model-instance@1",
      d.instance(d.ref("named", f.wholeSelector, "named-v1")),
    ),
  ]);
  assert.equal(number(w, "named-instance", f.modelPort("valueOf")), 10);
  assert.equal(number(w, "named-instance", f.modelNode([], "toString")), 1);
  assert.throws(
    () =>
      f.reviewModelBinding(
        w.reader.read(),
        d.ref("A"),
        "toString",
        d.ref("stiffness"),
        d.schemas,
        w.reader.resources(),
      ),
    /Unknown input port/,
  );
});
