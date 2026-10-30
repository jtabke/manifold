/** Optional bounded native scalar-model adapter. No schema branch is added to the document owner. */
import {
  assert,
  object,
  fields,
  freeze,
  retained,
  canonical,
  deeplyFrozen,
  type Json,
} from "./value.ts";
import {
  validateReference,
  scalar,
  wholeSelector,
  methodKey,
} from "./content.ts";
import type {
  Reference,
  Schema,
  Projection,
  ProjectionResult,
  Method,
  Scalar,
} from "./contracts.ts";
import { project, resolve, type Document, type Context } from "./document.ts";
import type { Resources, Schemas } from "./contracts.ts";
export type ModelTarget = Readonly<
  { node: string } | { child: string; port: string }
>;
export type ModelNode = Readonly<
  | { kind: "input"; label: string; unit: string; default?: number }
  | { kind: "constant"; label: string; unit: string; value: number }
  | {
      kind: "method";
      label: string;
      method: Method["requirements"];
      inputs: Readonly<Record<string, ModelTarget>>;
    }
>;
export type ModelDefinition = Readonly<{
  nodes: Readonly<Record<string, ModelNode>>;
  children: Readonly<
    Record<
      string,
      Readonly<{
        label: string;
        model: Reference;
        inputs: Readonly<Record<string, ModelTarget>>;
      }>
    >
  >;
  inputs: Readonly<Record<string, Readonly<{ label: string; node: string }>>>;
  outputs: Readonly<
    Record<string, Readonly<{ label: string; target: ModelTarget }>>
  >;
}>;
export type Interpretation = Readonly<{
  subject: string;
  frame: string;
  condition: string;
}>;
export type ModelBinding = Readonly<
  | { kind: "value"; value: number; unit: string }
  | { kind: "reference"; reference: Reference; expected: Omit<Scalar, "value"> }
>;
export type ModelInstance = Readonly<{
  model: Reference;
  inputs: Readonly<Record<string, ModelBinding>>;
  interpretation: Interpretation;
}>;
/** Installed handlers may derive units; portable model records still contain data only. */
export type NativeModelMethod = Method &
  (
    | Readonly<{
        evaluate(inputs: Readonly<Record<string, number>>): number;
        evaluateScalar?: never;
      }>
    | Readonly<{
        evaluate?: never;
        evaluateScalar(
          inputs: Readonly<Record<string, Scalar>>,
        ): Readonly<Pick<Scalar, "value" | "unit">>;
      }>
  );
const symbol = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(v) &&
  !["constructor", "prototype"].includes(v);
const own = <T>(map: Readonly<Record<string, T>>, id: string): T | undefined =>
  Object.hasOwn(map, id) ? map[id] : undefined;
function label(v: unknown) {
  assert(
    typeof v === "string" && v.length > 0 && v.length <= 160,
    "Invalid model label",
  );
}
function unit(v: unknown) {
  assert(
    typeof v === "string" && v.length > 0 && v.length <= 100,
    "Invalid model unit",
  );
}
function mapping(v: unknown, max = 256): asserts v is Record<string, unknown> {
  assert(
    object(v) && Object.keys(v).length <= max && Object.keys(v).every(symbol),
    "Invalid model local-ID map",
  );
}
function modelPin(v: unknown): asserts v is Reference {
  validateReference(v);
  assert(
    v.selection.kind === "pin" &&
      canonical(v.selector) === canonical(wholeSelector),
    "Model revisions must be pinned whole definitions",
  );
}
function target(v: unknown, model: ModelDefinition) {
  assert(object(v), "Invalid model target");
  fields(v, "node" in v ? ["node"] : ["child", "port"]);
  assert(
    "node" in v
      ? symbol(v.node) && Object.hasOwn(model.nodes, v.node)
      : symbol(v.child) &&
          Object.hasOwn(model.children, v.child) &&
          symbol(v.port),
    "Missing model-local target",
  );
}
function interpretation(v: unknown): asserts v is Interpretation {
  assert(object(v), "Invalid model interpretation");
  fields(v, ["subject", "frame", "condition"]);
  for (const x of Object.values(v)) label(x);
  assert(Object.keys(v).length === 3, "Incomplete model interpretation");
}
const validatedDefinitions = new WeakSet<object>(),
  validatedInstances = new WeakSet<object>();
export function modelDefinition(v: unknown): asserts v is ModelDefinition {
  assert(object(v), "Invalid model definition");
  if (validatedDefinitions.has(v)) return;
  fields(v, ["nodes", "children", "inputs", "outputs"]);
  mapping(v.nodes);
  mapping(v.children, 64);
  mapping(v.inputs, 64);
  mapping(v.outputs, 64);
  assert(
    Object.keys(v.outputs).length > 0,
    "A model needs an explicit output interface",
  );
  const model = v as unknown as ModelDefinition,
    exposed = new Set<string>();
  for (const node of Object.values(v.nodes)) {
    assert(object(node), "Invalid model node");
    label(node.label);
    if (node.kind === "input" || node.kind === "constant") {
      fields(
        node,
        node.kind === "input"
          ? ["kind", "label", "unit", "default"]
          : ["kind", "label", "unit", "value"],
      );
      unit(node.unit);
      assert(
        node.kind === "input"
          ? node.default === undefined ||
              (typeof node.default === "number" &&
                Number.isFinite(node.default))
          : typeof node.value === "number" && Number.isFinite(node.value),
        "Invalid model numeric value",
      );
    } else {
      assert(
        node.kind === "method" && object(node.method),
        "Unsupported model node kind",
      );
      fields(node, ["kind", "label", "method", "inputs"]);
      fields(node.method, ["id", "version", "runtime"]);
      assert(Object.keys(node.method).length === 3, "Incomplete model method");
      Object.values(node.method).forEach(label);
      mapping(node.inputs, 64);
      Object.values(node.inputs).forEach((v) => target(v, model));
    }
  }
  for (const child of Object.values(v.children)) {
    assert(object(child), "Invalid nested occurrence");
    fields(child, ["label", "model", "inputs"]);
    label(child.label);
    modelPin(child.model);
    mapping(child.inputs, 64);
    Object.values(child.inputs).forEach((v) => target(v, model));
  }
  for (const port of Object.values(v.inputs)) {
    assert(object(port), "Invalid input port");
    fields(port, ["label", "node"]);
    label(port.label);
    assert(
      symbol(port.node) &&
        model.nodes[port.node]?.kind === "input" &&
        !exposed.has(port.node),
      "Input ports must name distinct local input nodes",
    );
    exposed.add(port.node);
  }
  for (const [id, node] of Object.entries(model.nodes))
    if (node.kind === "input")
      assert(exposed.has(id), "Every input node needs an explicit port");
  for (const port of Object.values(v.outputs)) {
    assert(object(port), "Invalid output port");
    fields(port, ["label", "target"]);
    label(port.label);
    target(port.target, model);
  }
  if (deeplyFrozen(v)) validatedDefinitions.add(v);
}
export function modelInstance(v: unknown): asserts v is ModelInstance {
  assert(object(v), "Invalid model instance");
  if (validatedInstances.has(v)) return;
  fields(v, ["model", "inputs", "interpretation"]);
  modelPin(v.model);
  interpretation(v.interpretation);
  mapping(v.inputs, 64);
  for (const binding of Object.values(v.inputs)) {
    assert(object(binding), "Invalid model binding");
    if (binding.kind === "value") {
      fields(binding, ["kind", "value", "unit"]);
      unit(binding.unit);
      assert(
        typeof binding.value === "number" && Number.isFinite(binding.value),
        "Invalid input override",
      );
    } else {
      assert(binding.kind === "reference", "Unsupported model binding");
      fields(binding, ["kind", "reference", "expected"]);
      validateReference(binding.reference);
      assert(
        !object(binding.reference.selector) ||
          binding.reference.selector.kind !== "model-node",
        "Cross-boundary bindings must use public ports",
      );
      scalar({ ...(binding.expected as object), value: 0 });
    }
  }
  if (deeplyFrozen(v)) validatedInstances.add(v);
}
export const modelPort = (port: string): Json => {
  assert(symbol(port), "Invalid port ID");
  return freeze({ kind: "model-port", version: 1, port });
};
export const modelNode = (path: readonly string[], node: string): Json => {
  assert(
    path.length <= 16 && path.every(symbol) && symbol(node),
    "Invalid model-local address",
  );
  return freeze({ kind: "model-node", version: 1, path: [...path], node });
};
type Local = Readonly<{ value: number; unit: string }>;
type Failure = Exclude<ProjectionResult, { status: "resolved" }>;
class ModelFailure extends Error {
  readonly result: Failure;
  constructor(result: Failure) {
    super(result.reason);
    this.result = result;
  }
}
function fail(status: Failure["status"], reason: string): never {
  throw new ModelFailure({ status, reason });
}
export function createScalarModels(
  methods: readonly NativeModelMethod[],
  limits: Readonly<{ steps?: number; depth?: number }> = {},
) {
  const catalog = new Map<string, NativeModelMethod>();
  for (const method of methods) {
    assert(
      (typeof method.evaluate === "function") !==
        (typeof method.evaluateScalar === "function"),
      "Install exactly one native model evaluator",
    );
    assert(
      method.evaluateScalar ||
        (method.output !== "*" && !Object.values(method.inputs).includes("*")),
      "Wildcard model units require a derived scalar evaluator",
    );
    const key = methodKey(method.requirements);
    assert(!catalog.has(key), "Duplicate native model method");
    mapping(method.inputs, 64);
    Object.values(method.inputs).forEach(unit);
    unit(method.output);
    catalog.set(
      key,
      Object.freeze({
        ...method,
        requirements: retained(
          method.requirements as unknown as Json,
        ) as unknown as Method["requirements"],
        inputs: retained(method.inputs as Json) as Readonly<
          Record<string, string>
        >,
      }),
    );
  }
  const maxSteps = limits.steps ?? 10000,
    maxDepth = limits.depth ?? 16;
  assert(
    Number.isSafeInteger(maxSteps) &&
      maxSteps > 0 &&
      maxSteps <= 1000000 &&
      Number.isSafeInteger(maxDepth) &&
      maxDepth > 0 &&
      maxDepth <= 32,
    "Invalid model evaluation limits",
  );
  let nodeEvaluations = 0,
    instancesVisited = 0;
  function definition(v: Json) {
    modelDefinition(v);
  }
  function loaded(result: ProjectionResult): Projection {
    if (result.status !== "resolved") throw new ModelFailure(result);
    return result.projection;
  }
  function template(p: Projection): ModelDefinition {
    assert(
      p.type === "model-definition",
      "Selected content is not a model definition",
    );
    definition(p.value);
    return p.value as unknown as ModelDefinition;
  }
  const schemas: Schema[] = [
    {
      id: "scalar-model-definition@1",
      validate: definition,
      references(b) {
        modelDefinition(b);
        return Object.values(b.children).map((c) => c.model);
      },
      assets: () => [],
      project(b, s) {
        if (canonical(s) !== canonical(wholeSelector))
          return {
            status: "unsupported",
            reason: "A model definition is metadata; inspect an instance port",
          };
        return { type: "model-definition", value: b };
      },
    },
    {
      id: "scalar-model-instance@1",
      validate: modelInstance,
      references(b) {
        modelInstance(b);
        return [
          b.model,
          ...Object.values(b.inputs).flatMap((v) =>
            v.kind === "reference" ? [v.reference] : [],
          ),
        ];
      },
      assets: () => [],
      project(body, selector, _resources, _revision, reader) {
        try {
          modelInstance(body);
          if (canonical(selector) === canonical(wholeSelector))
            return { type: "model-instance", value: body };
          assert(
            object(selector) && selector.version === 1,
            "Unsupported model selector",
          );
          const instance = body,
            root = loaded(reader.read(instance.model));
          const top = template(root),
            active = new Set<string>(),
            memo = new Map<string, Local>();
          let steps = 0;
          function tick() {
            assert(++steps <= maxSteps, "Model evaluation budget exceeded");
          }
          type Environment = {
            definition: ModelDefinition;
            projection: Projection;
            path: string[];
            input: (
              port: string,
              unit: string,
              fallback: number | undefined,
            ) => Local;
          };
          const environments = new Map<string, Environment>();
          const rootEnvironment: Environment = {
            definition: top,
            projection: root,
            path: [],
            input(port, wanted, fallback) {
              const binding = own(instance.inputs, port);
              if (!binding) {
                if (fallback === undefined)
                  fail("missing", "Unbound input port: " + port);
                return { value: fallback, unit: wanted };
              }
              if (binding.kind === "value") {
                if (binding.unit !== wanted)
                  fail("unsupported", "Input unit changed: " + port);
                return { value: binding.value, unit: binding.unit };
              }
              const got = loaded(reader.read(binding.reference));
              if (got.type !== "scalar")
                fail("unsupported", "Input is not a scalar public projection");
              scalar(got.value);
              const v = got.value;
              if (
                canonical({
                  unit: v.unit,
                  subject: v.subject,
                  frame: v.frame,
                  condition: v.condition,
                }) !== canonical(binding.expected as Json)
              )
                fail(
                  "ambiguous",
                  "Source interpretation changed; review binding: " + port,
                );
              if (
                v.unit !== wanted ||
                v.frame !== instance.interpretation.frame ||
                v.condition !== instance.interpretation.condition
              )
                fail(
                  "unsupported",
                  "Input unit/frame/condition differs: " + port,
                );
              return { value: v.value, unit: v.unit };
            },
          };
          for (const port of Object.keys(instance.inputs))
            assert(
              Object.hasOwn(top.inputs, port),
              "Instance binds a removed/unknown input port",
            );
          environments.set("", rootEnvironment);
          instancesVisited++;
          function child(parent: Environment, id: string): Environment {
            const path = [...parent.path, id],
              key = canonical(path);
            const old = environments.get(key);
            if (old) return old;
            assert(path.length <= maxDepth, "Model nesting budget exceeded");
            const c = own(parent.definition.children, id);
            if (!c) fail("missing", "Unknown nested instance: " + id);
            const projection = loaded(
                reader.readFrom(parent.projection, c.model),
              ),
              def = template(projection);
            tick();
            instancesVisited++;
            for (const port of Object.keys(c.inputs))
              assert(
                Object.hasOwn(def.inputs, port),
                "Nested occurrence binds a removed input port",
              );
            const env: Environment = {
              definition: def,
              projection,
              path,
              input(port, wanted, fallback) {
                const from = own(c.inputs, port);
                if (!from) {
                  if (fallback === undefined)
                    fail("missing", "Unbound nested input: " + port);
                  return { value: fallback, unit: wanted };
                }
                const v = targetValue(parent, from);
                if (v.unit !== wanted)
                  fail("unsupported", "Nested port unit mismatch: " + port);
                return v;
              },
            };
            environments.set(key, env);
            return env;
          }
          function targetValue(env: Environment, target: ModelTarget): Local {
            return "node" in target
              ? node(env, target.node)
              : output(child(env, target.child), target.port);
          }
          function output(env: Environment, port: string): Local {
            const p = own(env.definition.outputs, port);
            if (!p) fail("missing", "Unknown public output port: " + port);
            return targetValue(env, p.target);
          }
          function node(env: Environment, id: string): Local {
            const key = canonical([env.path, id]),
              hit = memo.get(key);
            if (hit) return hit;
            if (active.has(key))
              fail(
                "ambiguous",
                "Cyclic model computation requires an explicit solver boundary",
              );
            active.add(key);
            tick();
            nodeEvaluations++;
            try {
              const n = own(env.definition.nodes, id);
              if (!n) fail("missing", "Unknown local node: " + id);
              let value: Local;
              if (n.kind === "constant")
                value = { value: n.value, unit: n.unit };
              else if (n.kind === "input") {
                const port = Object.entries(env.definition.inputs).find(
                  ([, p]) => p.node === id,
                )?.[0];
                assert(port, "Input is not exposed");
                value = env.input(port, n.unit, n.default);
              } else {
                const method = catalog.get(methodKey(n.method));
                if (!method)
                  fail(
                    "unsupported",
                    "Native model method is unavailable: " + n.method.id,
                  );
                assert(
                  Object.keys(method.inputs).sort().join() ===
                    Object.keys(n.inputs).sort().join(),
                  "Model method slots differ",
                );
                const inputs: Record<string, Scalar> = Object.create(null);
                for (const [slot, unit] of Object.entries(method.inputs)) {
                  const v = targetValue(env, n.inputs[slot]!);
                  if (
                    v.unit !== unit &&
                    !(method.evaluateScalar && unit === "*")
                  )
                    fail("unsupported", "Method input unit mismatch: " + slot);
                  inputs[slot] = { ...v, ...instance.interpretation };
                }
                method.validateDomain?.(inputs);
                if (method.evaluateScalar) {
                  const derived = method.evaluateScalar(Object.freeze(inputs));
                  assert(object(derived), "Invalid derived scalar output");
                  if (
                    typeof (derived as unknown as { then?: unknown }).then ===
                    "function"
                  ) {
                    void Promise.resolve(derived).catch(() => {});
                    throw Error("Native model evaluators must be synchronous");
                  }
                  fields(derived, ["value", "unit"]);
                  scalar({ ...derived, ...instance.interpretation });
                  assert(
                    derived.unit !== "*",
                    "Derived output needs concrete units",
                  );
                  assert(
                    method.output === "*" || method.output === derived.unit,
                    "Derived model output unit mismatch",
                  );
                  value = { value: derived.value, unit: derived.unit };
                } else {
                  const number = method.evaluate(
                    Object.fromEntries(
                      Object.entries(inputs).map(([id, v]) => [id, v.value]),
                    ),
                  );
                  assert(
                    Number.isFinite(number),
                    "Native model method returned nonfinite output",
                  );
                  value = { value: number, unit: method.output };
                }
              }
              const frozen = freeze({ ...value });
              memo.set(key, frozen);
              return frozen;
            } finally {
              active.delete(key);
            }
          }
          let value: Local;
          if (selector.kind === "model-port") {
            fields(selector, ["kind", "version", "port"]);
            assert(symbol(selector.port), "Invalid model port");
            value = output(rootEnvironment, selector.port);
          } else {
            assert(
              selector.kind === "model-node" &&
                Array.isArray(selector.path) &&
                selector.path.every(symbol) &&
                symbol(selector.node),
              "Invalid model inspector address",
            );
            fields(selector, ["kind", "version", "path", "node"]);
            let env = rootEnvironment;
            for (const id of selector.path) env = child(env, id as string);
            value = node(env, selector.node);
          }
          return {
            type: "scalar",
            value: { ...value, ...instance.interpretation },
          };
        } catch (e) {
          return e instanceof ModelFailure
            ? e.result
            : { status: "corrupt", reason: String(e) };
        }
      },
    },
  ];
  return Object.freeze({
    schemas: Object.freeze(schemas),
    diagnostics: () => Object.freeze({ nodeEvaluations, instancesVisited }),
  });
}
export function reviewModelBinding(
  doc: Document,
  instance: Reference,
  port: string,
  source: Reference,
  schemas: Schemas,
  resources: Resources,
  context?: Context,
) {
  const selected = resolve(doc, instance, context);
  assert(
    selected.status === "resolved" &&
      selected.revision.schema === "scalar-model-instance@1",
    "Select an instance",
  );
  modelInstance(selected.revision.body);
  const body = selected.revision.body,
    definition = project(doc, body.model, schemas, resources, context);
  assert(definition.status === "resolved", "Model definition unavailable");
  modelDefinition(definition.projection.value);
  const p = own(definition.projection.value.inputs, port);
  assert(p, "Unknown input port");
  const node = definition.projection.value.nodes[p.node];
  assert(node?.kind === "input", "Invalid input port");
  assert(
    !object(source.selector) || source.selector.kind !== "model-node",
    "Connect public ports, not private inspection addresses",
  );
  const got = project(doc, source, schemas, resources, context);
  assert(
    got.status === "resolved" && got.projection.type === "scalar",
    "Choose an available scalar source",
  );
  scalar(got.projection.value);
  const scalarValue = got.projection.value;
  assert(
    scalarValue.unit === node.unit &&
      scalarValue.frame === body.interpretation.frame &&
      scalarValue.condition === body.interpretation.condition,
    "Binding unit/frame/condition mismatch",
  );
  const { value: _, ...expected } = scalarValue;
  return freeze({
    source: got.projection,
    destination: {
      instance: instance.item,
      port,
      interpretation: body.interpretation,
    },
    body: retained({
      ...body,
      inputs: {
        ...body.inputs,
        [port]: { kind: "reference", reference: source, expected },
      },
    } as unknown as Json) as unknown as ModelInstance,
  });
}
export function reviewModelUpdate(
  doc: Document,
  instance: Reference,
  schemas: Schemas,
  resources: Resources,
  changes: Readonly<Record<string, ModelBinding | null>> = {},
) {
  const got = resolve(doc, instance);
  assert(
    got.status === "resolved" &&
      got.revision.schema === "scalar-model-instance@1",
    "Select an instance",
  );
  modelInstance(got.revision.body);
  const body = got.revision.body;
  const previous = project(doc, body.model, schemas, resources);
  assert(
    previous.status === "resolved" &&
      previous.projection.type === "model-definition",
    "Previous model revision unavailable; cannot review interface changes",
  );
  modelDefinition(previous.projection.value);
  const prior = previous.projection.value;
  const selected = project(
    doc,
    { ...body.model, selection: { kind: "follow" } },
    schemas,
    resources,
  );
  assert(
    selected.status === "resolved" &&
      selected.projection.type === "model-definition",
    "New model revision unavailable",
  );
  modelDefinition(selected.projection.value);
  const model = selected.projection.value;
  const inputs: Record<string, ModelBinding> = { ...body.inputs };
  for (const [id, binding] of Object.entries(changes)) {
    if (binding === null) delete inputs[id];
    else inputs[id] = binding;
  }
  for (const [id, binding] of Object.entries(inputs)) {
    const port = own(model.inputs, id);
    assert(port, "Removed input needs explicit removal/rebinding: " + id);
    const node = model.nodes[port.node];
    assert(node?.kind === "input", "Invalid input");
    assert(
      (binding.kind === "value" ? binding.unit : binding.expected.unit) ===
        node.unit,
      "Changed input units require explicit new bindings: " + id,
    );
  }
  const next = {
    ...body,
    model: {
      ...body.model,
      selection: {
        kind: "pin" as const,
        revision: selected.projection.revision,
      },
    },
    inputs,
  };
  modelInstance(next);
  return freeze({
    before: body.model,
    after: next.model,
    interfaceChanges: {
      removedInputs: Object.keys(prior.inputs)
        .filter((id) => !Object.hasOwn(model.inputs, id))
        .sort(),
      addedInputs: Object.keys(model.inputs)
        .filter((id) => !Object.hasOwn(prior.inputs, id))
        .sort(),
      removedOutputs: Object.keys(prior.outputs)
        .filter((id) => !Object.hasOwn(model.outputs, id))
        .sort(),
      addedOutputs: Object.keys(model.outputs)
        .filter((id) => !Object.hasOwn(prior.outputs, id))
        .sort(),
      changedInputUnits: Object.keys(prior.inputs)
        .filter((id) => {
          const before = prior.nodes[prior.inputs[id]!.node];
          const port = own(model.inputs, id);
          const after = port && model.nodes[port.node];
          return (
            before?.kind === "input" &&
            after?.kind === "input" &&
            before.unit !== after.unit
          );
        })
        .sort(),
    },
    body: retained(next as unknown as Json) as unknown as ModelInstance,
  });
}
