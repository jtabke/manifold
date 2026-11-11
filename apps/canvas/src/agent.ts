/** Versioned, JSON-facing automation contracts over the single headless owner. */
import {
  freeze,
  json,
  scalar,
  type ModelDefinition,
  type ProjectionResult,
} from "@manifold/foundation";
import type { HeadlessWorkspace } from "./headless.ts";
import { HeadlessError } from "./headlessErrors.ts";
import { modelFamilies } from "./regions/foundationModels.ts";

export const AGENT_PROTOCOL_VERSION = 1;
const string = { type: "string", minLength: 1 };
const alias = { ...string, pattern: "^[A-Za-z][A-Za-z0-9_-]*$" };
const text = { ...string, maxLength: 5000 };
const position = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  additionalProperties: false,
};
const operations = {
  createEquation: { text, as: alias, at: position },
  updateEquation: { region: string, text },
  createNote: { text, as: alias, at: position },
  updateNote: { region: string, text },
  createModel: { family: { enum: Object.keys(modelFamilies) }, as: alias },
  setModelInput: {
    model: string,
    input: string,
    value: { type: "number", minimum: -1e12, maximum: 1e12 },
  },
} as const;
const required = {
  createEquation: ["text"],
  updateEquation: ["region", "text"],
  createNote: ["text"],
  updateNote: ["region", "text"],
  createModel: ["family"],
  setModelInput: ["model", "input", "value"],
} as const;

export function agentCapabilities() {
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    stability: "experimental-repository-local",
    commands: [
      "capabilities",
      "create",
      "inspect",
      "worksheet",
      "models",
      "model",
      "edit",
      "validate",
      "diff",
      "compute",
    ],
    discovery: {
      views: ["full", "compact"],
      default: "full",
      compactCommands: ["inspect", "worksheet", "models", "model"],
      regionFilter: "worksheet --region ID",
      details:
        "Omit --compact for full provenance, selectors and receipt keys; use model --model ID or worksheet --region ID to focus.",
    },
    execution: { explicit: true, sampling: false, arbitraryCode: false },
    modelFamilies: Object.entries(modelFamilies).map(([id, family]) => ({
      id,
      label: family.label,
      inputs: Object.entries(family.definition.inputs).map(([id, input]) => {
        const node = (family.definition as ModelDefinition).nodes[input.node];
        return {
          id,
          label: input.label,
          ...(node.kind === "input"
            ? { unit: node.unit, defaultValue: node.default ?? null }
            : {}),
        };
      }),
      outputs: Object.entries(family.definition.outputs).map(
        ([id, output]) => ({ id, label: output.label }),
      ),
    })),
    validation: {
      clean:
        "No worksheet diagnostics, failed constraints, unresolved model inputs, or non-current discoverable computation requests. Not an engineering safety assessment.",
    },
    editSchema: {
      type: "object",
      properties: {
        expectedDocumentId: string,
        edits: {
          type: "array",
          maxItems: 1000,
          items: {
            oneOf: Object.entries(operations).map(
              ([operation, properties]) => ({
                type: "object",
                properties: { operation: { const: operation }, ...properties },
                required: [
                  "operation",
                  ...required[operation as keyof typeof required],
                ],
                additionalProperties: false,
              }),
            ),
          },
        },
      },
      required: ["expectedDocumentId", "edits"],
      additionalProperties: false,
    },
    aliases:
      "Optional 'as' names on creation; refer to earlier creations with '$name' in region/model fields. Names match [A-Za-z][A-Za-z0-9_-]* and must be unique per batch.",
  });
}

function invalid(message: string): never {
  throw new HeadlessError("INVALID_INPUT", message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("Expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    invalid("Unknown field in edit payload");
}

/** Untrusted JSON enters here. Every operation publishes through the existing transaction. */
export function editWorkspace(workspace: HeadlessWorkspace, payload: unknown) {
  try {
    json(payload);
  } catch {
    invalid("Expected a plain JSON edit payload with finite numbers");
  }
  const batch = record(payload);
  keys(batch, ["expectedDocumentId", "edits"]);
  if (
    typeof batch.expectedDocumentId !== "string" ||
    !batch.expectedDocumentId ||
    !Array.isArray(batch.edits) ||
    batch.edits.length > 1000
  )
    invalid(
      "Expected expectedDocumentId and an edits array of at most 1,000 operations",
    );
  const aliases = workspace.transaction(batch.expectedDocumentId, (editor) => {
    const aliases: Record<string, string> = Object.create(null);
    const target = (value: string) => {
      if (!value.startsWith("$")) return value;
      return (
        aliases[value.slice(1)] ?? invalid(`Unknown or forward alias: ${value}`)
      );
    };
    for (const raw of batch.edits as unknown[]) {
      const edit = record(raw);
      if (
        typeof edit.operation !== "string" ||
        !Object.hasOwn(operations, edit.operation)
      )
        invalid("Unknown edit operation");
      const operation = edit.operation as keyof typeof operations;
      const properties = operations[operation] as Record<string, unknown>;
      keys(edit, ["operation", ...Object.keys(properties)]);
      for (const field of required[operation])
        if (!Object.hasOwn(edit, field)) invalid(`Missing ${field}`);
      for (const [field, value] of Object.entries(edit)) {
        if (field === "operation") continue;
        if (field === "value") {
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            Math.abs(value) > 1e12
          )
            invalid("Expected a finite input within ±1e12");
        } else if (field === "at") {
          const at = record(value);
          keys(at, ["x", "y"]);
          if (
            typeof at.x !== "number" ||
            typeof at.y !== "number" ||
            !Number.isFinite(at.x) ||
            !Number.isFinite(at.y)
          )
            invalid("Expected finite x/y coordinates");
        } else if (typeof value !== "string" || !value.length)
          invalid(`Expected nonempty ${field}`);
      }
      if (
        edit.as !== undefined &&
        (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(edit.as as string) ||
          Object.hasOwn(aliases, edit.as as string))
      )
        invalid("Invalid or duplicate creation alias");
      let created: string | undefined;
      const at = edit.at as { x: number; y: number } | undefined;
      switch (operation) {
        case "createEquation":
          created = editor.createEquation(edit.text as string, at);
          break;
        case "createNote":
          created = editor.createNote(edit.text as string, at);
          break;
        case "updateEquation":
          editor.updateEquation(
            target(edit.region as string),
            edit.text as string,
          );
          break;
        case "updateNote":
          editor.updateNote(target(edit.region as string), edit.text as string);
          break;
        case "createModel":
          created = editor.createModel(
            edit.family as keyof typeof modelFamilies,
          );
          break;
        case "setModelInput":
          editor.setModelInput(
            target(edit.model as string),
            edit.input as string,
            edit.value as number,
          );
          break;
      }
      if (created && edit.as) aliases[edit.as as string] = created;
    }
    return aliases;
  });
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    documentId: workspace.read().id,
    aliases: { ...aliases },
  });
}

/** Only public discovery snapshots are exposed, never persistent collection internals. */
export function inspectWorkspace(workspace: HeadlessWorkspace) {
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    documentId: workspace.read().id,
    document: workspace.read().document,
    worksheet: workspace.worksheet(),
    models: workspace.models().map((model) => ({
      ...model,
      requests: model.requests.map((request) => ({
        id: request.id,
        label: request.label,
        reference: request.reference,
        outputs: request.outputs,
        result: {
          status: request.result.status,
          ...("reason" in request.result
            ? { reason: request.result.reason }
            : {}),
          ...("job" in request.result ? { job: request.result.job } : {}),
          ...(request.result.receipt
            ? {
                receipt: {
                  id: request.result.receipt.id,
                  key: request.result.receipt.key,
                  outcome: request.result.receipt.outcome,
                  physicalValidity: request.result.receipt.physicalValidity,
                },
              }
            : {}),
        },
      })),
    })),
  });
}
export type AgentSnapshot = ReturnType<typeof inspectWorkspace>;

function compactProjection(result: ProjectionResult) {
  if (result.status !== "resolved") return result;
  if (result.projection.type === "scalar") {
    const value = result.projection.value;
    scalar(value);
    return {
      status: result.status,
      type: "scalar",
      value: value.value,
      unit: value.unit,
    };
  }
  return {
    status: result.status,
    type: result.projection.type,
    value: result.projection.value,
  };
}

/** Same worksheet facts, without dimension vectors or constraint expression trees. */
export function summarizeWorksheet(workspace: HeadlessWorkspace) {
  const worksheet = workspace.worksheet();
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    view: "compact" as const,
    documentId: worksheet.documentId,
    context: worksheet.context,
    regions: worksheet.regions.map((region) => ({
      id: region.id,
      text: region.text,
      kind: region.kind,
      name: region.name,
      editable: region.editable,
      quantity: region.quantity
        ? {
            value: region.quantity.value,
            unit: region.quantity.unit,
            ...(region.quantity.absolute !== undefined
              ? { absolute: region.quantity.absolute }
              : {}),
          }
        : null,
      diagnostic: region.diagnostic,
      constraint: region.constraint
        ? {
            pass: region.constraint.pass,
            bound: region.constraint.bound.value,
            unit: region.quantity?.unit ?? null,
          }
        : null,
    })),
  });
}

/** Opt-in compact discovery. Full inspectWorkspace contracts remain unchanged. No execution. */
export function summarizeWorkspace(workspace: HeadlessWorkspace) {
  const models = workspace.models();
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    view: "compact" as const,
    documentId: workspace.read().id,
    document: workspace.read().document,
    worksheet: summarizeWorksheet(workspace),
    models: models.map((model) => ({
      id: model.id,
      label: model.label,
      documentId: model.documentId,
      inputs: model.inputs.map((input) => ({
        id: input.id,
        label: input.label,
        unit: input.unit,
        defaultValue: input.defaultValue,
        binding: input.binding,
        numericEdit: input.numericEdit,
        projection: compactProjection(input.projection),
      })),
      outputs: model.outputs.map((output) => ({
        id: output.id,
        label: output.label,
        unit: output.unit,
        projection: compactProjection(output.projection),
      })),
      requests: model.requests.map((request) => ({
        id: request.id,
        label: request.label,
        outputs: request.outputs,
        result: {
          status: request.result.status,
          ...("reason" in request.result
            ? { reason: request.result.reason }
            : {}),
          ...("job" in request.result ? { job: request.result.job } : {}),
          ...(request.result.receipt
            ? {
                receipt: {
                  id: request.result.receipt.id,
                  outcome: request.result.receipt.outcome,
                  physicalValidity: request.result.receipt.physicalValidity,
                },
              }
            : {}),
        },
      })),
    })),
  });
}
export type CompactAgentSnapshot = ReturnType<typeof summarizeWorkspace>;

/** File admission has already succeeded; this reports content issues, not physical safety. */
export function validateWorkspace(workspace: HeadlessWorkspace) {
  const snapshot = inspectWorkspace(workspace);
  const issues: { kind: string; target: string; message: string }[] = [];
  for (const region of snapshot.worksheet.regions) {
    if (region.diagnostic)
      issues.push({
        kind: "worksheet-diagnostic",
        target: region.id,
        message: region.diagnostic,
      });
    else if (region.kind === "draft")
      issues.push({
        kind: "draft",
        target: region.id,
        message: "Incomplete mathematical source",
      });
    if (region.constraint?.pass === false)
      issues.push({
        kind: "constraint-failed",
        target: region.id,
        message: "Worksheet constraint does not hold",
      });
  }
  for (const model of snapshot.models) {
    for (const input of model.inputs)
      if (input.projection.status !== "resolved")
        issues.push({
          kind: "unresolved-input",
          target: `${model.id}/${input.id}`,
          message: `Input projection: ${input.projection.status}`,
        });
    for (const request of model.requests)
      if (request.result.status !== "current")
        issues.push({
          kind: "computation-not-current",
          target: request.id,
          message: `Computation: ${request.result.status}`,
        });
  }
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    documentId: snapshot.documentId,
    admitted: true,
    physicalValidity: "not-assessed",
    clean: issues.length === 0,
    issues,
  });
}

/** Compare public semantic snapshots; no execution or authored-state mutation. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function compareWorkspaces(
  before: HeadlessWorkspace,
  after: HeadlessWorkspace,
) {
  const a = inspectWorkspace(before),
    b = inspectWorkspace(after);
  function changes<T extends { id: string }>(
    left: readonly T[],
    right: readonly T[],
  ) {
    const ids = new Set([
      ...left.map((item) => item.id),
      ...right.map((item) => item.id),
    ]);
    return [...ids].flatMap((id) => {
      const before = left.find((item) => item.id === id) ?? null;
      const after = right.find((item) => item.id === id) ?? null;
      return canonical(before) === canonical(after)
        ? []
        : [{ id, before, after }];
    });
  }
  // Projection provenance is useful for inspection, but revision-only changes are not consequences.
  const projection = (
    value: AgentSnapshot["models"][number]["outputs"][number]["projection"],
  ) =>
    value.status === "resolved"
      ? {
          status: value.status,
          type: value.projection.type,
          value: value.projection.value,
        }
      : value;
  const semanticModels = (snapshot: AgentSnapshot) =>
    snapshot.models.map((model) => ({
      id: model.id,
      label: model.label,
      inputs: model.inputs.map((input) => ({
        ...input,
        projection: projection(input.projection),
      })),
      outputs: model.outputs.map((output) => ({
        id: output.id,
        label: output.label,
        unit: output.unit,
        projection: projection(output.projection),
      })),
      requests: model.requests.map((request) => ({
        id: request.id,
        label: request.label,
        outputs: request.outputs,
        result: {
          status: request.result.status,
          ...("reason" in request.result
            ? { reason: request.result.reason }
            : {}),
          ...(request.result.receipt
            ? {
                outcome: request.result.receipt.outcome,
                physicalValidity: request.result.receipt.physicalValidity,
              }
            : {}),
        },
      })),
    }));
  return freeze({
    protocolVersion: AGENT_PROTOCOL_VERSION,
    beforeDocumentId: a.documentId,
    afterDocumentId: b.documentId,
    sameDocument: a.document === b.document,
    regions: changes(a.worksheet.regions, b.worksheet.regions),
    models: changes(semanticModels(a), semanticModels(b)),
  });
}
