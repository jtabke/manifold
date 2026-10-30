/** Independent model examples are data plus trusted native methods, outside the owner/storage kernel. */
import * as f from "../src/index.ts";
export const scope = f.freeze({
  subject: "support-system",
  frame: "world",
  condition: "nominal",
});
export const springMethod = f.freeze({
  id: "spring-force",
  version: "1",
  runtime: "native-scalar@1",
});
export const sumMethod = f.freeze({
  id: "sum-force",
  version: "1",
  runtime: "native-scalar@1",
});
export const scaleMethod = f.freeze({
  id: "scale-force",
  version: "1",
  runtime: "native-scalar@1",
});
export const pressureMethod = f.freeze({
  id: "port-pressure",
  version: "1",
  runtime: "scalar-js@1",
});
export const models = f.createScalarModels([
  {
    requirements: springMethod,
    inputs: { k: "N/mm", x: "mm" },
    output: "N",
    validateDomain(v) {
      if (v.k!.value < 0) throw Error("Stiffness must not be negative");
    },
    evaluate: (v) => v.k! * v.x!,
  },
  {
    requirements: sumMethod,
    inputs: { left: "N", right: "N" },
    output: "N",
    evaluate: (v) => v.left! + v.right!,
  },
  {
    requirements: scaleMethod,
    inputs: { load: "N", factor: "1" },
    output: "N",
    evaluate: (v) => v.load! * v.factor!,
  },
]);
export const schemas = f.createSchemas(models.schemas),
  methods = f.createMethods([
    {
      requirements: pressureMethod,
      inputs: { force: "N", area: "mm2" },
      output: "MPa",
      validateDomain(v) {
        if (v.area!.value <= 0) throw Error("Area must be positive");
      },
    },
  ]);
export const execute: f.Executor = async (snapshot, signal) => {
  if (signal.aborted) throw Error("Cancelled");
  if (snapshot.method.id !== pressureMethod.id)
    throw Error("Unsupported method");
  return {
    ...scope,
    value:
      snapshot.inputs.force!.scalar.value / snapshot.inputs.area!.scalar.value,
    unit: "MPa",
  };
};
export const docId = "composition-demo";
export const ref = (
  item: string,
  selector: f.Json = f.wholeSelector,
  revision?: string,
): f.Reference => ({
  document: docId,
  item,
  selector,
  selection: revision ? { kind: "pin", revision } : { kind: "follow" },
});
export const spring: f.ModelDefinition = {
  nodes: {
    k: { kind: "input", label: "k", unit: "N/mm", default: 10 },
    x: { kind: "input", label: "x", unit: "mm", default: 1 },
    force: {
      kind: "method",
      label: "F",
      method: springMethod,
      inputs: { k: { node: "k" }, x: { node: "x" } },
    },
  },
  children: {},
  inputs: {
    stiffness: { label: "Stiffness", node: "k" },
    displacement: { label: "Displacement", node: "x" },
  },
  outputs: { force: { label: "Force", target: { node: "force" } } },
};
export const amplifier: f.ModelDefinition = {
  nodes: {
    load: { kind: "input", label: "F", unit: "N" },
    factor: { kind: "input", label: "gain", unit: "1", default: 2 },
    scaled: {
      kind: "method",
      label: "F",
      method: scaleMethod,
      inputs: { load: { node: "load" }, factor: { node: "factor" } },
    },
  },
  children: {},
  inputs: {
    load: { label: "Load", node: "load" },
    factor: { label: "Gain", node: "factor" },
  },
  outputs: { force: { label: "Force", target: { node: "scaled" } } },
};
export function pair(
  model = ref("spring", f.wholeSelector, "spring-v1"),
): f.ModelDefinition {
  return {
    nodes: {
      ka: { kind: "input", label: "k", unit: "N/mm", default: 10 },
      kb: { kind: "input", label: "k", unit: "N/mm", default: 20 },
      x: { kind: "input", label: "x", unit: "mm", default: 1 },
      sum: {
        kind: "method",
        label: "F",
        method: sumMethod,
        inputs: {
          left: { child: "left", port: "force" },
          right: { child: "right", port: "force" },
        },
      },
    },
    children: {
      left: {
        label: "Left spring",
        model,
        inputs: { stiffness: { node: "ka" }, displacement: { node: "x" } },
      },
      right: {
        label: "Right spring",
        model,
        inputs: { stiffness: { node: "kb" }, displacement: { node: "x" } },
      },
    },
    inputs: {
      stiffnessA: { label: "Left stiffness", node: "ka" },
      stiffnessB: { label: "Right stiffness", node: "kb" },
      displacement: { label: "Displacement", node: "x" },
    },
    outputs: { force: { label: "Force", target: { node: "sum" } } },
  };
}
export const instance = (
  model: f.Reference,
  inputs: f.ModelInstance["inputs"] = {},
): f.ModelInstance => ({ model, inputs, interpretation: scope });
export const expected = (unit: string) => ({ ...scope, unit });
export const body = (v: unknown) => v as f.Json;
export function create(
  item: string,
  schema: string,
  value: unknown,
  id = item + "-v1",
): f.Command {
  return {
    kind: "create",
    item,
    label: item,
    revision: { id, item, schema, required: true, body: body(value) },
  };
}
export function pressure(item: string): f.Request {
  return {
    method: pressureMethod,
    inputs: { force: ref(item, f.modelPort("force")), area: ref("area") },
    output: "MPa",
    ...scope,
  };
}
export async function initial(hash: f.Hash = f.webHash): Promise<f.Loaded> {
  const bytes = JSON.stringify([[20], [25]]),
    source = await f.asset(bytes, hash),
    resources = await f.MemoryResources.verify([[source.digest, bytes]], hash);
  const commands: f.Command[] = [
    create("spring", "scalar-model-definition@1", spring),
    create("amplifier", "scalar-model-definition@1", amplifier),
    create("pair", "scalar-model-definition@1", pair()),
    create("stiffness", "scalar@1", { ...scope, value: 10, unit: "N/mm" }),
    create("area", "scalar@1", { ...scope, value: 2500, unit: "mm2" }),
    create("source", "source@1", {
      asset: source,
      rows: 2,
      columns: 1,
      interpretation: [expected("N/mm")],
    }),
    create(
      "A",
      "scalar-model-instance@1",
      instance(ref("spring", f.wholeSelector, "spring-v1"), {
        stiffness: {
          kind: "reference",
          reference: ref("stiffness"),
          expected: expected("N/mm"),
        },
      }),
    ),
    create(
      "B",
      "scalar-model-instance@1",
      instance(ref("spring", f.wholeSelector, "spring-v1"), {
        stiffness: {
          kind: "reference",
          reference: ref("source", {
            kind: "cell",
            version: 1,
            revision: "source-v1",
            row: 0,
            column: 0,
          }),
          expected: expected("N/mm"),
        },
      }),
    ),
    create(
      "C",
      "scalar-model-instance@1",
      instance(ref("amplifier", f.wholeSelector, "amplifier-v1")),
    ),
    create(
      "pair-instance",
      "scalar-model-instance@1",
      instance(ref("pair", f.wholeSelector, "pair-v1")),
    ),
    ...["A", "B", "C"].map((id) =>
      create("pressure-" + id, "request@1", pressure(id)),
    ),
    ...["A", "B", "C", "pair-instance"].map((id, i) => ({
      kind: "view" as const,
      view: {
        id: "view-" + id,
        reference: ref(id, f.modelPort("force")),
        renderer: "model-port@1",
        x: i * 240,
        y: 80,
        alternative: null,
      },
    })),
  ];
  return {
    document: f.prepare(f.empty(docId), "composition-root", commands, schemas)
      .document,
    receipts: [],
    resources,
  };
}
