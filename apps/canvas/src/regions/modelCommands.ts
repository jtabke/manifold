/** Model features issue the same authored commands and use the same owner as worksheet edits. */
import * as f from "@manifold/foundation";
import {
  AUTHORED_MODEL,
  compileModel,
  type ModelSource,
  type AuthoredModel,
} from "./authoredModels.ts";
import { MODEL_OUTPUT_REQUEST, modelOutputsRequest } from "./modelResults.ts";
import { canvasSchemas } from "./app/canvasDocument.ts";
import {
  modelFamilies,
  modelResultMethod,
  MODEL_RENDERER,
  type ModelFamily,
  type CsvObservation,
} from "./foundationModels.ts";
import type { RegionSession, Point } from "./document.ts";
export { MODEL_RENDERER } from "./foundationModels.ts";
const uid = () => "model-" + crypto.randomUUID();
const json = (value: unknown) => value as f.Json;
export const modelReference = (
  document: f.Document,
  item: string,
  selector: f.Json = f.wholeSelector,
): f.Reference => ({
  document: document.document,
  item,
  selection: { kind: "follow" },
  selector,
});
const revision = (item: string, schema: string, body: unknown): f.Revision => ({
  item,
  id: uid(),
  schema,
  required: true,
  body: json(body),
});
export const modelRequest = (instance: string) => instance + ":result";
export function insertModel(
  session: RegionSession,
  family: ModelFamily,
  at: Point,
): string {
  const document = session.document,
    spec = modelFamilies[family],
    commands: f.Command[] = [];
  let template = [...document.items.entries()]
    .map(([, i]) => f.current(document, i.id))
    .find(
      (r) =>
        r?.schema === "scalar-model-definition@1" &&
        f.canonical(r.body) === f.canonical(json(spec.definition)),
    );
  if (!template) {
    const item = uid();
    template = revision(item, "scalar-model-definition@1", spec.definition);
    commands.push({
      kind: "create",
      item,
      label: spec.label + " definition",
      revision: template,
    });
  }
  const instance = uid(),
    interpretation = {
      subject: document.document,
      frame: "world",
      condition: "nominal",
    },
    body: f.ModelInstance = {
      model: {
        ...modelReference(document, template.item),
        selection: { kind: "pin", revision: template.id },
      },
      inputs: {},
      interpretation,
    },
    request = modelRequest(instance);
  commands.push(
    {
      kind: "create",
      item: instance,
      label: spec.label,
      revision: revision(instance, "scalar-model-instance@1", body),
    },
    {
      kind: "create",
      item: request,
      label: spec.label + " result",
      revision: revision(request, "request@1", {
        method: modelResultMethod,
        inputs: {
          value: modelReference(document, instance, f.modelPort("force")),
        },
        output: "N",
        ...interpretation,
      }),
    },
    {
      kind: "view",
      view: {
        id: instance + ":view",
        reference: modelReference(document, instance),
        renderer: MODEL_RENDERER,
        ...at,
        alternative: null,
      },
    },
  );
  session.applyCommands(commands, document);
  return instance;
}
export function inspectModel(
  session: RegionSession,
  item: string,
  document = session.document,
  context?: f.Context,
) {
  const selected = f.resolve(document, modelReference(document, item), context);
  f.assert(
    selected.status === "resolved" &&
      selected.revision.schema === "scalar-model-instance@1",
    "Model instance unavailable",
  );
  f.modelInstance(selected.revision.body);
  const body = selected.revision.body,
    definition = f.resolve(document, body.model, context);
  f.assert(definition.status === "resolved", "Model definition unavailable");
  const graph =
    definition.revision.schema === AUTHORED_MODEL
      ? (definition.revision.body as unknown as AuthoredModel).model
      : definition.revision.body;
  f.assert(
    [AUTHORED_MODEL, "scalar-model-definition@1"].includes(
      definition.revision.schema,
    ),
    "Model definition unavailable",
  );
  f.modelDefinition(graph);
  return {
    body,
    definition: graph,
    revision: selected.revision,
    definitionRevision: definition.revision,
  };
}
function inputBody(
  session: RegionSession,
  instance: string,
  port: string,
  value: number,
) {
  const { body, definition } = inspectModel(session, instance),
    input = definition.inputs[port],
    node = input && definition.nodes[input.node];
  f.assert(
    node?.kind === "input" && Number.isFinite(value) && Math.abs(value) <= 1e12,
    "Use a finite model input within ±1e12",
  );
  return {
    ...body,
    inputs: {
      ...body.inputs,
      [port]: { kind: "value" as const, value, unit: node.unit },
    },
  };
}
export function setModelInput(
  session: RegionSession,
  instance: string,
  port: string,
  value: number,
) {
  session.applyCommands([
    {
      kind: "revise",
      item: instance,
      revision: revision(
        instance,
        "scalar-model-instance@1",
        inputBody(session, instance, port, value),
      ),
    },
  ]);
}
export function previewModelInput(
  session: RegionSession,
  instance: string,
  port: string,
  value: number,
) {
  return session.preview(
    modelReference(session.document, modelRequest(instance)),
    [
      {
        item: instance,
        revision: revision(
          instance,
          "scalar-model-instance@1",
          inputBody(session, instance, port, value),
        ),
      },
    ],
  );
}
export function keepModelPreview(
  session: RegionSession,
  instance: string,
  label: string,
  at: Point,
) {
  return session.keepPreview(label, {
    id: uid(),
    reference: modelReference(session.document, modelRequest(instance)),
    renderer: MODEL_RENDERER,
    ...at,
  });
}
export function reviewModelConnection(
  session: RegionSession,
  instance: string,
  port: string,
  source: f.Reference,
) {
  const document = session.document,
    review = f.reviewModelBinding(
      document,
      modelReference(document, instance),
      port,
      source,
      canvasSchemas,
      session.foundation.resources(),
    );
  return {
    document,
    review,
    commands: [
      {
        kind: "revise",
        item: instance,
        revision: revision(instance, "scalar-model-instance@1", review.body),
      },
    ] as readonly f.Command[],
  };
}
export function reviewModelCsv(
  session: RegionSession,
  instance: string,
  port: string,
  dataset: string,
  row: number,
  column: number,
  unit: string,
) {
  const document = session.document,
    source = f.current(document, "region:" + dataset);
  f.assert(source?.schema === "canvas-record@1", "Dataset unavailable");
  const observation = uid(),
    body: CsvObservation = {
      source: {
        ...modelReference(document, source.item),
        selection: { kind: "pin", revision: source.id },
      },
      row,
      column,
      unit,
      ...inspectModel(session, instance).body.interpretation,
    },
    create: f.Command = {
      kind: "create",
      item: observation,
      label: "CSV observation",
      revision: revision(observation, "csv-observation@1", body),
    },
    candidate = f.prepare(document, uid(), [create], canvasSchemas).document,
    review = f.reviewModelBinding(
      candidate,
      modelReference(candidate, instance),
      port,
      modelReference(candidate, observation),
      canvasSchemas,
      session.foundation.resources(),
    );
  return {
    document,
    review,
    commands: [
      create,
      {
        kind: "revise",
        item: instance,
        revision: revision(instance, "scalar-model-instance@1", review.body),
      },
    ] as readonly f.Command[],
  };
}
export function applyModelConnection(
  session: RegionSession,
  reviewed: ReturnType<typeof reviewModelConnection>,
) {
  return session.applyCommands(reviewed.commands, reviewed.document);
}
export function modelViews(document: f.Document) {
  return [...document.views.entries()]
    .map(([, view]) => view)
    .filter((view) => view.renderer === MODEL_RENDERER);
}

/** Publish source and graph as one versioned record. Existing instances remain pinned. */
export function publishModel(
  session: RegionSession,
  label: string,
  source: ModelSource,
  item?: string,
  expected = session.document,
) {
  f.assert(
    label.trim().length > 0 && label.length <= 160,
    "Name the model within 160 characters",
  );
  const model = compileModel(source),
    id = item || uid();
  if (item)
    f.assert(
      f.current(expected, item)?.schema === AUTHORED_MODEL,
      "Select an authored definition to revise",
    );
  const value = revision(id, AUTHORED_MODEL, { source, model });
  session.applyCommands(
    item
      ? [
          { kind: "revise", item: id, revision: value },
          { kind: "rename", item: id, label: label.trim() },
        ]
      : [{ kind: "create", item: id, label: label.trim(), revision: value }],
    expected,
  );
  return id;
}
function outputRequest(
  document: f.Document,
  instance: string,
  graph: f.ModelDefinition,
) {
  return revision(modelRequest(instance), MODEL_OUTPUT_REQUEST, {
    instance: modelReference(document, instance),
    outputs: Object.keys(graph.outputs),
  });
}
export function instantiateModel(
  session: RegionSession,
  definition: f.Reference,
  at: Point,
  label?: string,
) {
  const document = session.document,
    selected = f.resolve(document, definition);
  f.assert(
    selected.status === "resolved" &&
      [AUTHORED_MODEL, "scalar-model-definition@1"].includes(
        selected.revision.schema,
      ),
    "Select a model definition",
  );
  const graph =
    selected.revision.schema === AUTHORED_MODEL
      ? (selected.revision.body as unknown as AuthoredModel).model
      : selected.revision.body;
  f.modelDefinition(graph);
  const instance = uid(),
    name = label || document.items.get(definition.item)?.label || "Model";
  session.applyCommands(
    [
      {
        kind: "create",
        item: instance,
        label: name,
        revision: revision(instance, "scalar-model-instance@1", {
          model: {
            ...definition,
            selection: { kind: "pin", revision: selected.revision.id },
            selector: f.wholeSelector,
          },
          inputs: {},
          interpretation: {
            subject: document.document,
            frame: "world",
            condition: "nominal",
          },
        }),
      },
      {
        kind: "create",
        item: modelRequest(instance),
        label: name + " results",
        revision: outputRequest(document, instance, graph),
      },
      {
        kind: "view",
        view: {
          id: instance + ":view",
          reference: modelReference(document, instance),
          renderer: MODEL_RENDERER,
          ...at,
          alternative: null,
        },
      },
    ],
    document,
  );
  return instance;
}
export function authoredDefinition(session: RegionSession, instance: string) {
  const info = inspectModel(session, instance);
  f.assert(
    info.definitionRevision.schema === AUTHORED_MODEL,
    "This built-in definition is not authored source",
  );
  return info.definitionRevision.body as unknown as AuthoredModel;
}
export function reviewInstanceUpdate(
  session: RegionSession,
  instance: string,
  resetBindings = false,
) {
  const document = session.document,
    review = f.reviewModelUpdate(
      document,
      modelReference(document, instance),
      canvasSchemas,
      session.foundation.resources(),
      resetBindings
        ? Object.fromEntries(
            Object.keys(inspectModel(session, instance).body.inputs).map(
              (id) => [id, null],
            ),
          )
        : {},
    );
  const selected = f.project(
    document,
    review.after,
    canvasSchemas,
    session.foundation.resources(),
  );
  f.assert(
    selected.status === "resolved" &&
      selected.projection.type === "model-definition",
    "Updated definition unavailable",
  );
  f.modelDefinition(selected.projection.value);
  f.assert(
    f.current(document, modelRequest(instance))?.schema ===
      MODEL_OUTPUT_REQUEST,
    "Legacy built-in instances retain their original request contract",
  );
  const commands: f.Command[] = [
    {
      kind: "revise",
      item: instance,
      revision: revision(instance, "scalar-model-instance@1", review.body),
    },
    {
      kind: "revise",
      item: modelRequest(instance),
      revision: outputRequest(document, instance, selected.projection.value),
    },
  ];
  const previous = inspectModel(session, instance);
  const following = f.resolve(document, review.after);
  f.assert(following.status === "resolved", "Updated definition unavailable");
  const oldRows = new Map(
    previous.definitionRevision.schema === AUTHORED_MODEL
      ? (
          previous.definitionRevision.body as unknown as AuthoredModel
        ).source.rows.map((r) => [r.id, r.text])
      : [],
  );
  const newRows = new Map(
    following.revision.schema === AUTHORED_MODEL
      ? (following.revision.body as unknown as AuthoredModel).source.rows.map(
          (r) => [r.id, r.text],
        )
      : [],
  );
  const sourceChanges = [...new Set([...oldRows.keys(), ...newRows.keys()])]
    .filter((id) => oldRows.get(id) !== newRows.get(id))
    .map(
      (id) =>
        `${oldRows.get(id) || "(new equation)"} → ${newRows.get(id) || "(removed)"}`,
    );
  const next = selected.projection.value;
  const labelFor = (id: string) =>
    next.inputs[id]?.label ||
    next.outputs[id]?.label ||
    previous.definition.inputs[id]?.label ||
    previous.definition.outputs[id]?.label ||
    id;
  const inputUnit = (graph: f.ModelDefinition, id: string) => {
    const node = graph.nodes[graph.inputs[id]?.node || ""];
    return node?.kind === "input" ? node.unit : "unavailable";
  };
  const titles: Record<string, string> = {
    removedInputs: "Removed inputs",
    addedInputs: "Added inputs",
    removedOutputs: "Removed outputs",
    addedOutputs: "Added outputs",
    changedInputUnits: "Changed input units",
  };
  const interfaceSummary = Object.entries(review.interfaceChanges)
    .filter(([, ids]) => ids.length)
    .map(
      ([kind, ids]) =>
        `${titles[kind]}: ${ids.map((id) => (kind === "changedInputUnits" ? `${labelFor(id)} (${inputUnit(previous.definition, id)} → ${inputUnit(next, id)})` : labelFor(id))).join(", ")}`,
    );
  return { document, review, commands, sourceChanges, interfaceSummary };
}
export function applyInstanceUpdate(
  session: RegionSession,
  reviewed: ReturnType<typeof reviewInstanceUpdate>,
) {
  session.applyCommands(reviewed.commands, reviewed.document);
}
export function comparisonInstance(body: f.Json, schema: string): string {
  if (schema === MODEL_OUTPUT_REQUEST) {
    modelOutputsRequest(body);
    return body.instance.item;
  }
  f.assert(
    schema === "request@1" && f.object(body) && f.object(body.inputs),
    "Model comparison request unavailable",
  );
  f.validateReference(body.inputs.value);
  return body.inputs.value.item;
}
