/** Bounded equation compiler: source and stable row/port identity travel with each definition. */
import * as f from "@manifold/foundation";
import {
  parse,
  evaluate,
  calculate,
  quantityLiteral,
  references,
  unitLabel,
  type Expression,
  type Quantity,
} from "../notebook/math.ts";
export const AUTHORED_MODEL = "canvas-authored-model@1";
export type ModelSource = Readonly<{
  rows: readonly Readonly<{ id: string; text: string }>[];
  inputs: readonly string[];
  outputs: readonly string[];
}>;
export type AuthoredModel = Readonly<{
  source: ModelSource;
  model: f.ModelDefinition;
}>;
const json = (value: unknown) => value as f.Json;
const local = (id: string) => "n-" + id;
function unit(q: Quantity) {
  f.assert(
    !q.absolute,
    "Use temperature differences in K; absolute Celsius is outside this model adapter",
  );
  return (
    unitLabel(q)
      .replaceAll("²", "^2")
      .replaceAll("³", "^3")
      .replaceAll("·", "*") || "1"
  );
}
function quantity(value: { value: number; unit: string }): Quantity {
  return value.unit === "1"
    ? { value: value.value, dimension: [0, 0, 0, 0] }
    : evaluate(parse(`q = ${value.value} * (${value.unit})`).expression, () => {
        throw Error("Unknown model unit");
      });
}
const operators = ["+", "-", "*", "/", "^", "negate", "identity"] as const;
const method = (op: string) => ({
  id:
    "manifold.equation." +
    ({
      "+": "add",
      "-": "subtract",
      "*": "multiply",
      "/": "divide",
      "^": "power",
      negate: "negate",
      identity: "identity",
    }[op] || "unknown"),
  version: "1",
  runtime: "manifold-equations@1",
});
export const equationMethods: readonly f.NativeModelMethod[] = operators.map(
  (op): f.NativeModelMethod => ({
    requirements: method(op),
    inputs: ["negate", "identity"].includes(op)
      ? { value: "*" }
      : { left: "*", right: "*" },
    output: "*",
    evaluateScalar(inputs) {
      if (op === "identity")
        return { value: inputs.value!.value, unit: inputs.value!.unit };
      const expression: Expression =
        op === "negate"
          ? { kind: "unary", expression: { kind: "name", name: "value" } }
          : {
              kind: "binary",
              op,
              left: { kind: "name", name: "left" },
              right: { kind: "name", name: "right" },
            };
      const result = evaluate(expression, (name) => quantity(inputs[name]!));
      return { value: result.value, unit: unit(result) };
    },
  }),
);
export function compileModel(source: ModelSource): f.ModelDefinition {
  f.assert(f.object(source), "Invalid model source");
  f.fields(source, ["rows", "inputs", "outputs"]);
  f.assert(
    Array.isArray(source.rows) &&
      source.rows.length > 0 &&
      source.rows.length <= 32,
    "Use 1–32 model equations",
  );
  const rows = new Map<string, ReturnType<typeof parse>>(),
    names = new Map<string, string>();
  for (const row of source.rows) {
    f.assert(f.object(row), "Invalid model equation");
    f.fields(row, ["id", "text"]);
    f.assert(
      typeof row.id === "string" &&
        /^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test(row.id) &&
        !rows.has(row.id),
      "Invalid or repeated stable equation ID",
    );
    f.assert(
      typeof row.text === "string" && row.text.length <= 1200,
      "Use a bounded equation",
    );
    const statement = parse(row.text);
    f.assert(
      statement.relation === "=" && !names.has(statement.name),
      "Publish distinct named equality equations",
    );
    rows.set(row.id, statement);
    names.set(statement.name, row.id);
  }
  for (const ids of [source.inputs, source.outputs])
    f.assert(
      Array.isArray(ids) &&
        ids.length <= 32 &&
        new Set(ids).size === ids.length &&
        ids.every((id) => rows.has(id)),
      "Select distinct existing equation ports",
    );
  f.assert(source.outputs.length > 0, "Expose at least one model output");
  const solved = calculate(source.rows.map((r) => ({ ...r, x: 0, y: 0 })));
  f.assert(!solved.errors.size, [...solved.errors.values()].join("; "));
  const nodes: Record<string, f.ModelNode> = Object.create(null),
    inputs: Record<string, { label: string; node: string }> =
      Object.create(null),
    outputs: Record<string, { label: string; target: f.ModelTarget }> =
      Object.create(null);
  const active = new Set<string>(),
    built = new Set<string>();
  let serial = 0;
  const put = (id: string, node: f.ModelNode): f.ModelTarget => {
    f.assert(
      !Object.hasOwn(nodes, id) && Object.keys(nodes).length < 256,
      "Model graph exceeds 256 nodes or repeats identity",
    );
    nodes[id] = node;
    return { node: id };
  };
  function expression(
    e: Expression,
    id = `expression-${++serial}`,
  ): f.ModelTarget {
    if (quantityLiteral(e)) {
      const q = evaluate(e, () => {
        throw Error("Unresolved literal");
      });
      return put(id, {
        kind: "constant",
        label: "Constant",
        value: q.value,
        unit: unit(q),
      });
    }
    if (e.kind === "name") {
      const row = names.get(e.name);
      f.assert(row, "Define every model dependency: " + e.name);
      build(row);
      return { node: local(row) };
    }
    if (e.kind === "unary")
      return put(id, {
        kind: "method",
        label: "Negation",
        method: method("negate"),
        inputs: { value: expression(e.expression) },
      });
    f.assert(e.kind === "binary", "Unsupported equation expression");
    return put(id, {
      kind: "method",
      label: "Arithmetic",
      method: method(e.op),
      inputs: { left: expression(e.left), right: expression(e.right) },
    });
  }
  function build(id: string) {
    if (built.has(id)) return;
    f.assert(!active.has(id), "Cyclic models need an explicit solver boundary");
    active.add(id);
    const s = rows.get(id)!;
    for (const name of references(s.expression))
      f.assert(names.has(name), "Define every model dependency: " + name);
    if (source.inputs.includes(id)) {
      f.assert(
        quantityLiteral(s.expression),
        "An exposed input needs a literal value and units",
      );
      const q = evaluate(s.expression, () => {
        throw Error("Unresolved input");
      });
      f.assert(
        Math.abs(q.value) <= 1e12,
        "Use model inputs within ±1e12 in canonical units",
      );
      put(local(id), {
        kind: "input",
        label: s.name,
        unit: unit(q),
        default: q.value,
      });
      inputs[id] = { label: s.name, node: local(id) };
    } else {
      const target = expression(s.expression, local(id));
      // A direct alias needs an identity operation to retain its stable node identity.
      if ("node" in target && target.node !== local(id))
        put(local(id), {
          kind: "method",
          label: s.name,
          method: method("identity"),
          inputs: { value: target },
        });
    }
    active.delete(id);
    built.add(id);
  }
  for (const id of rows.keys()) build(id);
  for (const id of source.outputs)
    outputs[id] = { label: rows.get(id)!.name, target: { node: local(id) } };
  const model: f.ModelDefinition = { nodes, children: {}, inputs, outputs };
  f.modelDefinition(model);
  return model;
}
const validated = new WeakSet<object>();
export const authoredModelSchema: f.Schema = {
  id: AUTHORED_MODEL,
  validate(value) {
    f.assert(f.object(value), "Invalid authored model");
    if (validated.has(value)) return;
    f.fields(value, ["source", "model"]);
    const compiled = compileModel(value.source as unknown as ModelSource);
    f.assert(
      f.canonical(json(compiled)) === f.canonical(value.model!),
      "Authored source and model graph differ",
    );
    if (f.deeplyFrozen(value)) validated.add(value);
  },
  references: () => [],
  assets: () => [],
  project(body, selector) {
    if (f.canonical(selector) !== f.canonical(f.wholeSelector))
      return {
        status: "unsupported",
        reason: "Inspect the whole authored definition",
      };
    return {
      type: "model-definition",
      value: (body as unknown as AuthoredModel).model as unknown as f.Json,
    };
  },
};
