import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as d from "../workbench/composition-demo.ts";
const source = d.ref("stiffness"),
  a = d.ref("a"),
  b = d.ref("b");
async function fixture(project, references = (body) => body.refs) {
  const loaded = await d.initial(),
    handler = {
      id: "reader-probe@1",
      validate() {},
      references,
      assets: () => [],
      project,
    },
    schemas = f.createSchemas([...d.models.schemas, handler]);
  const doc = f.prepare(
    loaded.document,
    "reader-root",
    [
      d.create("a", handler.id, { refs: [b], value: 1 }),
      d.create("b", handler.id, { refs: [source], value: 2 }),
    ],
    schemas,
  ).document;
  return { ...loaded, document: doc, schemas };
}
const read = (x, ref = a, context) =>
  f.project(x.document, ref, x.schemas, x.resources, context);
test("projection reader follows declared references and records sorted transitive origins", async () => {
  const x = await fixture((body, _s, _r, _v, reader) => {
    const got = reader.read(body.refs[0]);
    return got.status === "resolved"
      ? { type: got.projection.type, value: got.projection.value }
      : got;
  });
  const got = read(x);
  assert.equal(got.status, "resolved");
  assert.equal(got.projection.value.value, 10);
  assert.deepEqual(got.projection.dependencies.map((p) => p.item).sort(), [
    "b",
    "stiffness",
  ]);
  assert.equal(Object.isFrozen(got.projection.dependencies[0].selector), true);
});
test("projection reads reject undeclared references and forged/foreign parent tokens", async () => {
  const x = await fixture((_body, _s, _r, _v, reader) => reader.read(source));
  assert.match(read(x).reason, /not a declared dependency/);
  const forged = await fixture((_body, _s, _r, _v, reader) =>
    reader.readFrom({ revision: "b-v1" }, source),
  );
  assert.match(read(forged).reason, /another read/);
  let token;
  const foreign = await fixture((body, _s, _r, revision, reader) => {
    if (revision.item === "b")
      return { type: "scalar", value: { ...d.scope, value: 1, unit: "N" } };
    if (token) return reader.readFrom(token, source);
    const got = reader.read(body.refs[0]);
    token = got.projection;
    return { type: "scalar", value: got.projection.value };
  });
  assert.equal(read(foreign).status, "resolved");
  assert.match(read(foreign).reason, /another read/);
});
test("parent reads use the same frozen selection and never borrow later baseline heads", async () => {
  const x = await fixture((body, _s, _r, revision, reader) => {
    if (revision.item === "b") return { type: "template", value: body };
    const parent = reader.read(b);
    if (parent.status !== "resolved") return parent;
    const got = reader.readFrom(parent.projection, source);
    return got.status === "resolved"
      ? { type: got.projection.type, value: got.projection.value }
      : got;
  });
  const context = f.captureContext(x.document, a, x.schemas);
  const revision = {
    id: "k-new",
    item: "stiffness",
    schema: "scalar@1",
    required: true,
    body: { ...d.scope, value: 99, unit: "N/mm" },
  };
  x.document = f.prepare(
    x.document,
    "later",
    [{ kind: "revise", item: "stiffness", revision }],
    x.schemas,
  ).document;
  assert.equal(read(x).projection.value.value, 99);
  assert.equal(read(x, a, context).projection.value.value, 10);
  const absent = Object.freeze({
    ...context,
    heads: context.heads.set("stiffness", null),
  });
  assert.equal(read(x, a, absent).status, "missing");
});
test("projection cycle/depth limits and forged provenance/statuses fail explicitly", async () => {
  const cyc = await fixture(
    (body, _s, _r, _v, reader) => reader.read(body.refs[0]),
    (body) => (body.value === 2 ? [a] : body.refs),
  );
  // The reference actually used must be declared; construct a true a/b cycle.
  cyc.document = f.prepare(
    cyc.document,
    "cyclic-root",
    [
      {
        kind: "revise",
        item: "b",
        revision: {
          id: "b-cycle",
          item: "b",
          schema: "reader-probe@1",
          required: true,
          body: { refs: [a], value: 2 },
        },
      },
    ],
    cyc.schemas,
  ).document;
  assert.equal(read(cyc).status, "ambiguous");
  const fake = await fixture(() => ({
    type: "scalar",
    value: 1,
    dependencies: [],
  }));
  assert.equal(read(fake).status, "corrupt");
  const status = await fixture(() => ({ status: "current", reason: "forged" }));
  assert.equal(read(status).status, "corrupt");
  const chain = await fixture((body, _s, _r, _v, reader) =>
    reader.read(body.refs[0]),
  );
  const commands = Array.from({ length: 70 }, (_, i) =>
    d.create("chain" + i, "reader-probe@1", {
      refs: [d.ref(i === 69 ? "stiffness" : "chain" + (i + 1))],
      value: 0,
    }),
  );
  chain.document = f.prepare(
    chain.document,
    "deep-root",
    commands,
    chain.schemas,
  ).document;
  assert.match(read(chain, d.ref("chain0")).reason, /budget/);
});

test("immutable projection values/selectors never retain a mutable caller or shallow-frozen handler alias", async () => {
  const value = Object.freeze({ nested: { value: 1 } }),
    selector = Object.freeze({ kind: "probe", nested: { value: 1 } });
  const x = await fixture(() => ({ type: "probe", value }));
  const got = read(x, d.ref("a", selector));
  assert.equal(got.status, "resolved");
  value.nested.value = 2;
  selector.nested.value = 2;
  assert.equal(got.projection.value.nested.value, 1);
  assert.equal(got.projection.selector.nested.value, 1);
  assert.equal(Object.isFrozen(got.projection.value.nested), true);
  const sparse = [];
  sparse.length = 1;
  sparse.extra = 1;
  Object.freeze(sparse);
  assert.equal(f.deeplyFrozen(sparse), false);
});
