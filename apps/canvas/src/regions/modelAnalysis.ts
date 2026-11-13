/** Bounded model sweeps use ordinary requests and the installed scalar evaluator. */
import * as f from "@manifold/foundation";
export const MODEL_ANALYSIS = "canvas-model-analysis@1";
export const ANALYSIS_RENDERER = "canvas-model-analysis-view@1";
export const analysisMethodRef = {
  id: "manifold.model-sweep",
  version: "1",
  runtime: "manifold-native-models@1",
};
export type Sweep = Readonly<{
  input: string;
  output: string;
  low: number;
  high: number;
  points: number;
}>;
export type AnalysisRequest = Sweep &
  Readonly<{
    instance: f.Reference;
    inputs: Readonly<Record<string, f.Reference>>;
  }>;
type Axis = Readonly<{ port: string; label: string; unit: string }>;
export type AnalysisInput = Readonly<{
  model: f.ModelDefinition;
  inputs: Readonly<Record<string, f.Scalar>>;
  interpretation: f.ModelInstance["interpretation"];
  x: Axis;
  y: Axis;
  low: number;
  high: number;
  points: number;
}>;
export type AnalysisOutput = Readonly<{
  x: Axis;
  y: Axis;
  interpretation: f.ModelInstance["interpretation"];
  points: readonly (readonly [number, number])[];
}>;
const json = (value: unknown) => value as f.Json;
const same = (a: unknown, b: unknown) =>
  f.canonical(json(a)) === f.canonical(json(b));
export function sweep(value: unknown): asserts value is Sweep {
  f.assert(f.object(value), "Invalid model sweep");
  f.assert(
    typeof value.input === "string" && typeof value.output === "string",
    "Choose public input and output ports",
  );
  f.modelPort(value.input);
  f.modelPort(value.output);
  f.assert(
    typeof value.low === "number" &&
      typeof value.high === "number" &&
      Number.isFinite(value.low + value.high) &&
      Math.abs(value.low) <= 1e12 &&
      Math.abs(value.high) <= 1e12 &&
      value.low < value.high,
    "Use an increasing finite range within ±1e12 in the input's units",
  );
  f.assert(
    Number.isInteger(value.points) &&
      Number(value.points) >= 2 &&
      Number(value.points) <= 201,
    "Use 2–201 sweep points",
  );
  const bounds = value as unknown as Sweep;
  for (let i = 1; i < bounds.points; i++)
    f.assert(
      pointX(bounds, i) > pointX(bounds, i - 1),
      "Range is too narrow for distinct sweep points",
    );
}
export function analysisRequest(
  value: unknown,
): asserts value is AnalysisRequest {
  sweep(value);
  f.fields(value, [
    "instance",
    "inputs",
    "input",
    "output",
    "low",
    "high",
    "points",
  ]);
  const body = value as unknown as AnalysisRequest;
  f.validateReference(body.instance);
  f.assert(
    body.instance.selection.kind === "follow" &&
      same(body.instance.selector, f.wholeSelector),
    "Analysis needs a whole followed instance",
  );
  f.assert(
    f.object(body.inputs) &&
      Object.keys(body.inputs).length > 0 &&
      Object.keys(body.inputs).length <= 32 &&
      Object.hasOwn(body.inputs, body.input),
    "Invalid analysis input interface",
  );
  for (const [port, ref] of Object.entries(body.inputs)) {
    f.modelPort(port);
    f.validateReference(ref);
    f.assert(
      f.object(ref.selector) &&
        typeof ref.selector.node === "string" &&
        same(ref.selector, f.modelNode([], ref.selector.node)),
      "Analysis inputs require local input inspection selectors",
    );
    f.assert(
      ref.document === body.instance.document &&
        ref.item === body.instance.item &&
        ref.selection.kind === "follow",
      "Analysis inputs must inspect the selected instance",
    );
  }
}
const pointX = (
  input: Pick<AnalysisInput, "low" | "high" | "points">,
  i: number,
) =>
  i === input.points - 1
    ? input.high
    : input.low + ((input.high - input.low) * i) / (input.points - 1);
const validated = new WeakSet<object>();
export function analysisInput(value: unknown): asserts value is AnalysisInput {
  f.assert(f.object(value), "Invalid model analysis capture");
  if (validated.has(value)) return;
  f.fields(value, [
    "model",
    "inputs",
    "interpretation",
    "x",
    "y",
    "low",
    "high",
    "points",
  ]);
  f.modelDefinition(value.model);
  const body = value as unknown as AnalysisInput;
  f.assert(
    Object.keys(body.model.children).length === 0 &&
      Object.keys(body.model.nodes).length <= 256,
    "Analysis supports self-contained models of at most 256 nodes",
  );
  f.assert(
    f.object(body.inputs) &&
      same(
        Object.keys(body.inputs).sort(),
        Object.keys(body.model.inputs).sort(),
      ),
    "Captured input interface differs from model",
  );
  f.assert(f.object(body.x) && f.object(body.y), "Invalid analysis axes");
  for (const axis of [body.x, body.y]) {
    f.fields(axis, ["port", "label", "unit"]);
    f.scalar({ value: 0, unit: axis.unit, ...body.interpretation });
  }
  sweep({ input: body.x.port, output: body.y.port, ...body });
  const output = body.model.outputs[body.y.port];
  f.assert(
    output && output.label === body.y.label,
    "Captured output interface differs from model",
  );
  for (const [port, input] of Object.entries(body.model.inputs)) {
    const node = body.model.nodes[input.node],
      scalar = body.inputs[port];
    f.scalar(scalar);
    f.assert(
      node?.kind === "input" &&
        scalar.unit === node.unit &&
        same(
          {
            subject: scalar.subject,
            frame: scalar.frame,
            condition: scalar.condition,
          },
          body.interpretation,
        ),
      "Captured input units or interpretation differ",
    );
  }
  const x = body.model.inputs[body.x.port],
    node = x && body.model.nodes[x.node];
  f.assert(
    node?.kind === "input" &&
      node.unit === body.x.unit &&
      x.label === body.x.label,
    "Captured input axis differs from model",
  );
  if (f.deeplyFrozen(value)) validated.add(value);
}
export function createModelAnalyses(
  adapter: ReturnType<typeof f.createScalarModels>,
) {
  const schemas = f.createSchemas(adapter.schemas),
    resources: f.Resources = {
      read: () => ({
        status: "unavailable",
        reason: "Captured scalar analysis has no external I/O",
      }),
    };
  const ref = (
    item: string,
    selector: f.Json = f.wholeSelector,
  ): f.Reference => ({
    document: "analysis-evaluation",
    item,
    selection: { kind: "follow" },
    selector,
  });
  function evaluator(input: AnalysisInput) {
    const inputs = Object.fromEntries(
      Object.entries(input.inputs).map(([port, s]) => [
        port,
        { kind: "value", value: s.value, unit: s.unit },
      ]),
    );
    const instance = {
      model: {
        ...ref("definition"),
        selection: { kind: "pin", revision: "definition-v1" },
      },
      inputs,
      interpretation: input.interpretation,
    };
    const revision = (
      item: string,
      id: string,
      schema: string,
      body: unknown,
    ): f.Revision => ({ item, id, schema, required: true, body: json(body) });
    const base = f.prepare(
      f.empty("analysis-evaluation"),
      "captured",
      [
        {
          kind: "create",
          item: "definition",
          label: "Captured definition",
          revision: revision(
            "definition",
            "definition-v1",
            "scalar-model-definition@1",
            input.model,
          ),
        },
        {
          kind: "create",
          item: "instance",
          label: "Captured instance",
          revision: revision(
            "instance",
            "instance-v1",
            "scalar-model-instance@1",
            instance,
          ),
        },
      ],
      schemas,
    ).document;
    return (x: number, index: number) => {
      // Every point branches from the same two-record capture. No accumulating history or live edits.
      const doc = f.prepare(
        base,
        "point-" + index,
        [
          {
            kind: "revise",
            item: "instance",
            revision: revision(
              "instance",
              "sample-" + index,
              "scalar-model-instance@1",
              {
                ...instance,
                inputs: {
                  ...inputs,
                  [input.x.port]: {
                    kind: "value",
                    value: x,
                    unit: input.x.unit,
                  },
                },
              },
            ),
          },
        ],
        schemas,
      ).document;
      const got = f.project(
        doc,
        ref("instance", f.modelPort(input.y.port)),
        schemas,
        resources,
      );
      f.assert(
        got.status === "resolved",
        got.status === "resolved"
          ? ""
          : `Sweep point ${index + 1}: ${got.reason}`,
      );
      f.scalar(got.projection.value);
      f.assert(
        got.projection.value.unit === input.y.unit,
        "Output units change within this range",
      );
      return got.projection.value.value;
    };
  }
  const schema: f.Schema = {
    id: MODEL_ANALYSIS,
    validate: analysisRequest,
    references(body) {
      analysisRequest(body);
      return [
        body.instance,
        ...Object.values(body.inputs),
        { ...body.instance, selector: f.modelPort(body.output) },
      ];
    },
    assets: () => [],
    project(body, selector, _resources, _revision, reader) {
      analysisRequest(body);
      if (!same(selector, f.wholeSelector))
        return { status: "unsupported", reason: "Inspect the whole analysis" };
      const instance = reader.read(body.instance);
      if (instance.status !== "resolved") return instance;
      f.assert(
        instance.projection.type === "model-instance",
        "Select a model instance",
      );
      f.modelInstance(instance.projection.value);
      const modelInstance = instance.projection.value;
      const definition = reader.readFrom(
        instance.projection,
        modelInstance.model,
      );
      if (definition.status !== "resolved") return definition;
      f.assert(
        definition.projection.type === "model-definition",
        "Model definition unavailable",
      );
      f.modelDefinition(definition.projection.value);
      const model = definition.projection.value,
        inputs: Record<string, f.Scalar> = Object.create(null);
      f.assert(
        same(Object.keys(body.inputs).sort(), Object.keys(model.inputs).sort()),
        "Analysis interface changed; review its settings",
      );
      for (const [port, input] of Object.entries(model.inputs)) {
        f.assert(
          same(body.inputs[port]!.selector, f.modelNode([], input.node)),
          "Invalid analysis input selector",
        );
        const got = reader.read(body.inputs[port]!);
        if (got.status !== "resolved") return got;
        f.assert(
          got.projection.type === "scalar",
          "Model input must be scalar",
        );
        f.scalar(got.projection.value);
        inputs[port] = got.projection.value;
      }
      const got = reader.read({
        ...body.instance,
        selector: f.modelPort(body.output),
      });
      if (got.status !== "resolved") return got;
      f.assert(got.projection.type === "scalar", "Model output must be scalar");
      f.scalar(got.projection.value);
      const x = model.inputs[body.input],
        y = model.outputs[body.output];
      f.assert(x && y, "Choose available public ports");
      const input: AnalysisInput = {
        model,
        inputs,
        interpretation: modelInstance.interpretation,
        x: { port: body.input, label: x.label, unit: inputs[body.input]!.unit },
        y: {
          port: body.output,
          label: y.label,
          unit: got.projection.value.unit,
        },
        low: body.low,
        high: body.high,
        points: body.points,
      };
      analysisInput(input);
      return {
        type: "typed-request@1",
        value: {
          method: analysisMethodRef,
          input: { schema: "canvas-model-sweep-input@1", body: json(input) },
          output: "canvas-model-series@1",
        },
      };
    },
  };
  const method: f.TypedMethod = {
    requirements: analysisMethodRef,
    input: "canvas-model-sweep-input@1",
    output: "canvas-model-series@1",
    limits: { inputBytes: 64 * 1024, outputBytes: 32 * 1024 },
    validateInput: analysisInput,
    validateOutput(input, output) {
      analysisInput(input);
      f.assert(f.object(output), "Invalid sweep result");
      f.fields(output, ["x", "y", "interpretation", "points"]);
      f.assert(
        same(output.x, input.x) &&
          same(output.y, input.y) &&
          same(output.interpretation, input.interpretation),
        "Sweep result meaning differs from captured axes",
      );
      f.assert(
        Array.isArray(output.points) && output.points.length === input.points,
        "Sweep result point count differs",
      );
      output.points.forEach((p, i) =>
        f.assert(
          Array.isArray(p) &&
            p.length === 2 &&
            p[0] === pointX(input, i) &&
            typeof p[1] === "number" &&
            Number.isFinite(p[1]),
          "Invalid sweep result point",
        ),
      );
      return output as f.Json;
    },
  };
  const execute: f.TypedExecutor = async (snapshot, signal) => {
    f.assert(
      f.methodKey(snapshot.method) === f.methodKey(analysisMethodRef),
      "Model analysis method unavailable",
    );
    analysisInput(snapshot.input.body);
    const input = snapshot.input.body,
      evaluate = evaluator(input),
      points: [number, number][] = [];
    for (let i = 0; i < input.points; i++) {
      if (i % 8 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      f.assert(!signal.aborted, "Model analysis cancelled");
      const x = pointX(input, i);
      points.push([x, evaluate(x, i)]);
    }
    return {
      x: input.x,
      y: input.y,
      interpretation: input.interpretation,
      points,
    };
  };
  return { schema, method, execute, evaluator };
}
