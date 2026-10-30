import test from "node:test";
import assert from "node:assert/strict";
import * as f from "../src/index.ts";
const ref = (item, selector = f.wholeSelector) => ({
  document: "derived-units",
  item,
  selection: { kind: "follow" },
  selector,
});
function projected(handler, output = "*", boundInput = false) {
  const method = { id: "test.derived", version: "1", runtime: "trusted-test" };
  const adapter = f.createScalarModels([
    {
      requirements: method,
      inputs: { a: "*", b: "*" },
      output,
      evaluateScalar: handler,
    },
  ]);
  const schemas = f.createSchemas(adapter.schemas);
  const definition = {
    nodes: {
      a: boundInput
        ? { kind: "input", label: "a", unit: "N", default: 10 }
        : { kind: "constant", label: "a", unit: "N", value: 20 },
      b: { kind: "constant", label: "b", unit: "m/s", value: 3 },
      out: {
        kind: "method",
        label: "out",
        method,
        inputs: { a: { node: "a" }, b: { node: "b" } },
      },
    },
    children: {},
    inputs: boundInput ? { a: { label: "a", node: "a" } } : {},
    outputs: { out: { label: "out", target: { node: "out" } } },
  };
  const commands = [
    {
      kind: "create",
      item: "definition",
      label: "Definition",
      revision: {
        id: "definition-r1",
        item: "definition",
        schema: "scalar-model-definition@1",
        required: true,
        body: definition,
      },
    },
    {
      kind: "create",
      item: "instance",
      label: "Instance",
      revision: {
        id: "instance-r1",
        item: "instance",
        schema: "scalar-model-instance@1",
        required: true,
        body: {
          model: {
            ...ref("definition"),
            selection: { kind: "pin", revision: "definition-r1" },
          },
          inputs: boundInput
            ? { a: { kind: "value", value: 20, unit: "N" } }
            : {},
          interpretation: {
            subject: "test",
            frame: "world",
            condition: "nominal",
          },
        },
      },
    },
  ];
  const doc = f.prepare(
    f.empty("derived-units"),
    "root",
    commands,
    schemas,
  ).document;
  return f.project(
    doc,
    ref("instance", boundInput ? f.modelNode([], "a") : f.modelPort("out")),
    schemas,
    {
      read: () => ({ status: "missing", reason: "none" }),
    },
  );
}
test("installed scalar model handlers derive concrete units while retaining interpretation", () => {
  const got = projected((inputs) => {
    assert.equal(inputs.a.unit, "N");
    assert.equal(inputs.b.unit, "m/s");
    return { value: inputs.a.value * inputs.b.value, unit: "W" };
  });
  assert.equal(got.status, "resolved");
  assert.deepEqual(got.projection.value, {
    value: 60,
    unit: "W",
    subject: "test",
    frame: "world",
    condition: "nominal",
  });
});
test("derived handlers cannot publish nonfinite, asynchronous, forged or wrong-unit outputs", () => {
  for (const output of [
    { value: Infinity, unit: "W" },
    { value: 60, unit: "" },
    { value: 60, unit: "*" },
    { value: 60, unit: "W", subject: "forged" },
    Promise.resolve({ value: 60, unit: "W" }),
    Promise.reject(new Error("async evaluator")),
  ])
    assert.notEqual(projected(() => output).status, "resolved");
  assert.notEqual(
    projected(() => ({ value: 60, unit: "W" }), "N").status,
    "resolved",
  );
});

test("bound input inspection exposes only the scalar contract, without binding metadata", () => {
  const got = projected(() => ({ value: 60, unit: "W" }), "*", true);
  assert.equal(got.status, "resolved");
  f.scalar(got.projection.value);
  assert.equal(got.projection.value.value, 20);
  assert.equal(Object.hasOwn(got.projection.value, "kind"), false);
});
