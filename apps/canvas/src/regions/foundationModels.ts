/** Installed model/source adapters. Portable documents supply data, never executable methods. */
import * as f from "@manifold/foundation";
import { createModelAnalyses } from "./modelAnalysis.ts";
import {
  authoredModelSchema,
  equationMethods,
  AUTHORED_MODEL,
} from "./authoredModels.ts";
import {
  modelOutputsSchema,
  modelOutputsMethod,
  MODEL_OUTPUT_REQUEST,
  modelOutputsRequest,
} from "./modelResults.ts";
import {
  samplingMethod,
  scientificSamplingMethod,
} from "./samplingExecution.ts";
import { readCsv, numericCell, type CsvData } from "./dataSources.ts";
const spring = {
  id: "manifold.spring-force",
  version: "1",
  runtime: "manifold-native-models@1",
};
const scale = {
  id: "manifold.force-scale",
  version: "1",
  runtime: "manifold-native-models@1",
};
export const modelAdapter = f.createScalarModels([
  ...equationMethods,
  {
    requirements: spring,
    inputs: { k: "N/mm", x: "mm" },
    output: "N",
    evaluate: ({ k, x }) => k! * x!,
  },
  {
    requirements: scale,
    inputs: { load: "N", factor: "1" },
    output: "N",
    evaluate: ({ load, factor }) => load! * factor!,
  },
]);
export const modelFamilies = Object.freeze({
  spring: {
    label: "Spring",
    definition: {
      nodes: {
        k: { kind: "input", label: "k", unit: "N/mm", default: 10 },
        x: { kind: "input", label: "x", unit: "mm", default: 2 },
        force: {
          kind: "method",
          label: "F",
          method: spring,
          inputs: { k: { node: "k" }, x: { node: "x" } },
        },
      },
      children: {},
      inputs: {
        stiffness: { label: "Stiffness", node: "k" },
        displacement: { label: "Displacement", node: "x" },
      },
      outputs: { force: { label: "Force", target: { node: "force" } } },
    },
  },
  scale: {
    label: "Force scale",
    definition: {
      nodes: {
        load: { kind: "input", label: "F", unit: "N", default: 10 },
        factor: { kind: "input", label: "gain", unit: "1", default: 2 },
        force: {
          kind: "method",
          label: "F",
          method: scale,
          inputs: { load: { node: "load" }, factor: { node: "factor" } },
        },
      },
      children: {},
      inputs: {
        load: { label: "Load", node: "load" },
        factor: { label: "Gain", node: "factor" },
      },
      outputs: { force: { label: "Force", target: { node: "force" } } },
    },
  },
} satisfies Record<string, { label: string; definition: f.ModelDefinition }>);
export type ModelFamily = keyof typeof modelFamilies;
export const modelResultMethod = Object.freeze({
  id: "manifold.model-result",
  version: "1",
  runtime: "manifold-native-models@1",
});
export const modelAnalyses = createModelAnalyses(modelAdapter);
export const canvasMethods = f.createMethods(
  [{ requirements: modelResultMethod, inputs: { value: "N" }, output: "N" }],
  [
    samplingMethod,
    scientificSamplingMethod,
    modelOutputsMethod,
    modelAnalyses.method,
  ],
);
export const canvasExecutor: f.Executor = async (snapshot, signal) => {
  f.assert(
    !signal.aborted &&
      f.methodKey(snapshot.method) === f.methodKey(modelResultMethod),
    "Model executor unavailable or cancelled",
  );
  return snapshot.inputs.value!.scalar;
};
export type CsvObservation = Readonly<{
  source: f.Reference;
  row: number;
  column: number;
  unit: string;
  subject: string;
  frame: string;
  condition: string;
}>;
function observation(value: unknown): asserts value is CsvObservation {
  f.assert(f.object(value), "Invalid CSV observation");
  f.fields(value, [
    "source",
    "row",
    "column",
    "unit",
    "subject",
    "frame",
    "condition",
  ]);
  f.validateReference(value.source);
  f.assert(
    value.source.selection.kind === "pin",
    "A CSV observation must pin its exact source revision",
  );
  f.assert(
    Number.isInteger(value.row) &&
      Number(value.row) >= 0 &&
      Number(value.row) < 10000 &&
      Number.isInteger(value.column) &&
      Number(value.column) >= 0 &&
      Number(value.column) < 12,
    "Invalid CSV observation coordinates",
  );
  f.scalar({
    value: 0,
    unit: value.unit,
    subject: value.subject,
    frame: value.frame,
    condition: value.condition,
  });
}
export const csvObservationSchema: f.Schema = {
  id: "csv-observation@1",
  validate: observation,
  references(body) {
    observation(body);
    return [body.source];
  },
  assets: () => [],
  project(body, selector, _resources, _revision, reader) {
    observation(body);
    if (f.canonical(selector) !== f.canonical(f.wholeSelector))
      return {
        status: "unsupported",
        reason: "Inspect the whole CSV observation",
      };
    const got = reader.read(body.source);
    if (got.status !== "resolved") return got;
    f.assert(
      got.projection.type === "canvas-record" &&
        f.object(got.projection.value) &&
        f.object(got.projection.value.data),
      "Observation source is not a dataset",
    );
    const data = got.projection.value.data as unknown as CsvData,
      raw = readCsv(data).rows[body.row]?.[body.column];
    f.assert(
      raw !== undefined && numericCell(raw),
      "The selected source cell is not numeric",
    );
    return {
      type: "scalar",
      value: {
        value: Number(raw),
        unit: body.unit,
        subject: body.subject,
        frame: body.frame,
        condition: body.condition,
      },
    };
  },
};
export const canvasContentSchemas = [
  ...modelAdapter.schemas,
  authoredModelSchema,
  modelOutputsSchema,
  modelAnalyses.schema,
  csvObservationSchema,
];
export const MODEL_RENDERER = "canvas-independent-model@1";
/** Installed renderers reject malformed targets before any candidate becomes visible. */
export function validateModelViews(document: f.Document) {
  let count = 0;
  for (const [, view] of document.views.entries()) {
    if (view.renderer !== MODEL_RENDERER) continue;
    f.assert(
      ++count <= 64,
      "The canvas supports up to 64 independent-model views",
    );
    const context = view.alternative
      ? document.alternatives.get(view.alternative)?.context
      : undefined;
    const selected = f.resolve(document, view.reference, context);
    f.assert(selected.status === "resolved", "Model view target unavailable");
    const request = context
      ? selected.revision
      : f.current(document, selected.revision.item + ":result");
    f.assert(request, "Model result request unavailable");
    let target: f.Reference;
    if (request.schema === MODEL_OUTPUT_REQUEST) {
      modelOutputsRequest(request.body);
      target = request.body.instance;
    } else {
      f.assert(
        request.schema === "request@1" &&
          f.object(request.body) &&
          f.object(request.body.inputs),
        "Invalid model comparison target",
      );
      const body = request.body as unknown as f.Request;
      f.assert(
        f.methodKey(body.method) === f.methodKey(modelResultMethod) &&
          body.inputs.value &&
          f.canonical(body.inputs.value.selector) ===
            f.canonical(f.modelPort("force")) &&
          body.output === "N",
        "Unsupported model result request",
      );
      target = body.inputs.value;
    }
    const instance = f.resolve(document, target, context);
    f.assert(
      instance.status === "resolved" &&
        instance.revision.schema === "scalar-model-instance@1" &&
        request.item === instance.revision.item + ":result",
      "Model comparison instance unavailable",
    );
    if (!context)
      f.assert(
        view.reference.selection.kind === "follow" &&
          selected.revision === instance.revision &&
          f.canonical(view.reference.selector) === f.canonical(f.wholeSelector),
        "Invalid model instance view",
      );
    f.modelInstance(instance.revision.body);
    const definition = f.resolve(
      document,
      instance.revision.body.model,
      context,
    );
    f.assert(definition.status === "resolved", "Model definition unavailable");
    const graph =
      definition.revision.schema === AUTHORED_MODEL &&
      f.object(definition.revision.body)
        ? definition.revision.body.model
        : definition.revision.body;
    f.assert(
      definition.revision.schema === AUTHORED_MODEL ||
        definition.revision.schema === "scalar-model-definition@1",
      "Model definition unavailable",
    );
    f.modelDefinition(graph);
    if (request.schema === MODEL_OUTPUT_REQUEST) {
      modelOutputsRequest(request.body);
      f.assert(
        f.canonical([...request.body.outputs].sort()) ===
          f.canonical(Object.keys(graph.outputs).sort()),
        "Model output request differs from its pinned interface",
      );
    }
  }
}
