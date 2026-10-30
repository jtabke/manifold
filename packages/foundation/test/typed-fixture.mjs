/** A source-backed geometry adapter; no separate evidence, task, or persistence owner. */
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
import * as scalar from "../workbench/demo.ts";
export const methodRef = Object.freeze({
  id: "scale-vertices",
  version: "1",
  runtime: "geometry-js@1",
});
const shape = (value) => {
  assert.ok(f.object(value));
  f.fields(value, ["asset", "count", "unit", "frame"]);
  f.validateAsset(value.asset);
  assert.ok(
    Number.isSafeInteger(value.count) &&
      value.count > 0 &&
      value.count <= 10000,
  );
  assert.equal(value.unit, "mm");
  assert.equal(value.frame, "part-A");
};
const vertices = (mesh, resources) => {
  const read = resources.read(mesh.asset);
  assert.equal(read.status, "ready", read.reason);
  const value = JSON.parse(read.data);
  assert.ok(
    Array.isArray(value) &&
      value.length === mesh.count &&
      value.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 3 &&
          point.every((n) => typeof n === "number" && Number.isFinite(n)),
      ),
  );
  return value;
};
export const method = Object.freeze({
  requirements: methodRef,
  input: "scale-vertices-input@1",
  output: "vertices@1",
  limits: { inputBytes: 1024 * 1024, outputBytes: 1024 * 1024 },
  validateInput(input) {
    assert.ok(f.object(input));
    f.fields(input, ["mesh", "factor"]);
    shape(input.mesh);
    assert.ok(
      typeof input.factor === "number" &&
        Number.isFinite(input.factor) &&
        Math.abs(input.factor) <= 100,
    );
  },
  validateOutput(input, output) {
    shape(output);
    assert.equal(output.count, input.mesh.count);
    return output;
  },
  assets(value, role) {
    return [role === "input" ? value.mesh.asset : value.asset];
  },
  validateInputResources(input, resources) {
    vertices(input.mesh, resources);
  },
  validateOutputResources(input, output, resources) {
    assert.deepEqual(
      vertices(output, resources),
      vertices(input.mesh, resources).map((point) =>
        point.map((n) => n * input.factor),
      ),
    );
  },
});
const meshSchema = {
  id: "vertices-source@1",
  validate: shape,
  references: () => [],
  assets: (mesh) => [mesh.asset],
  project(body) {
    return { type: "vertices@1", value: body };
  },
};
const requestSchema = {
  id: "scale-vertices-request@1",
  validate(body) {
    f.fields(body, ["source", "factor"]);
    f.validateReference(body.source);
    f.validateReference(body.factor);
  },
  references: (body) => [body.source, body.factor],
  assets: () => [],
  project(body, _selector, _resources, _revision, reader) {
    const source = reader.read(body.source),
      factor = reader.read(body.factor);
    if (source.status !== "resolved") return source;
    if (factor.status !== "resolved") return factor;
    assert.equal(source.projection.type, "vertices@1");
    f.scalar(factor.projection.value);
    assert.equal(factor.projection.value.unit, "ratio");
    return {
      type: "typed-request@1",
      value: {
        method: methodRef,
        input: {
          schema: method.input,
          body: {
            mesh: source.projection.value,
            factor: factor.projection.value.value,
          },
        },
        output: method.output,
      },
    };
  },
};
export const schemas = f.createSchemas([meshSchema, requestSchema]);
export const methods = f.createMethods(
  [
    scalar.methods.get(scalar.pressureMethod),
    scalar.methods.get(scalar.forceMethod),
  ],
  [method],
);
let serial = 0;
export const id = () => "typed-test-" + ++serial;
export const ref = scalar.ref;
export const command = (item, schema, body, kind = "create") => ({
  kind,
  item,
  ...(kind === "create" ? { label: item } : {}),
  revision: scalar.revision(id(), item, schema, body),
});
export const apply = (w, commands, resources) => {
  const applied = w.owner.apply(w.reader.stamp(), id(), commands, resources);
  assert.equal(applied.ok, true, applied.error);
  return applied.value;
};
export const factor = (w, value) =>
  apply(w, [
    command(
      "factor",
      "scalar@1",
      { value, unit: "ratio", ...scalar.meta },
      "revise",
    ),
  ]);
export async function execute(snapshot, _signal, io) {
  const input = snapshot.input.body;
  const data = JSON.stringify(
    vertices(input.mesh, io).map((point) => point.map((n) => n * input.factor)),
  );
  const asset = await f.asset(data, f.webHash);
  await io.stage(asset, data);
  return { ...input.mesh, asset };
}
export async function initial(disposition = "included") {
  const base = await scalar.demo(f.webHash),
    data = JSON.stringify([
      [1, 2, 3],
      [4, 5, 6],
    ]),
    asset = { ...(await f.asset(data, f.webHash)), disposition },
    resources = await base.resources.add(asset, data, f.webHash),
    mesh = { asset, count: 2, unit: "mm", frame: "part-A" };
  const document = f.prepare(
    base.document,
    id(),
    [
      command("mesh", meshSchema.id, mesh),
      command("factor", "scalar@1", {
        value: 2,
        unit: "ratio",
        ...scalar.meta,
      }),
      command("scaled", requestSchema.id, {
        source: ref("mesh"),
        factor: ref("factor"),
      }),
    ],
    schemas,
  ).document;
  return { document, resources, receipts: [] };
}
export function workspace(loaded, options = {}) {
  return f.createWorkspace(loaded, {
    schemas,
    methods,
    namespace: id(),
    executor: async (snapshot) => scalar.calculate(snapshot),
    typedExecutor: execute,
    ...options,
  });
}
export async function compute(w, target = "scaled", scope = "baseline") {
  const started = w.owner.compute(w.reader.stamp(), ref(target), scope);
  assert.equal(started.ok, true, started.error);
  const settled = await started.value.completion;
  assert.equal(settled.status, "retained", settled.reason);
  return settled.receipt;
}
export const native = (w) =>
  f.encode(
    w.reader.read(),
    [...w.reader.evidence().entries()].map(([, r]) => r),
    w.reader.resources(),
    schemas,
  );
export const ticket = (w, generation = 0) => ({
  request: id(),
  stamp: w.reader.stamp(),
  document: w.reader.read().document,
  expectedGeneration: generation,
  capture: w.reader.capture(),
});
