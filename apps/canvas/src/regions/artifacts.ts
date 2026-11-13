export { archive } from "./app/workspaceCodec.ts";
import { checkWorkspaceFileSize } from "./app/workspaceCodec.ts";
import {
  CanvasStorageBudget,
  CANVAS_NATIVE_LIMITS,
} from "./app/canvasStorageBudget.ts";
import { SharedMap } from "@manifold/foundation";
import { validArtifactReceipt } from "./artifactRecords.ts";
import {
  legacyCanvasLoaded,
  canvasSerial,
  canvasPage,
  canvasArtifacts,
  canvasObservedArtifacts,
  readCanvasDocument,
  canvasSchemas,
  canvasMethods,
  type CanvasRecovery,
  validateCanvasDocument,
} from "./app/canvasDocument.ts";
import {
  canonical,
  object,
  fields,
  decodeEnvelope,
  webHash,
  byteLength,
  type Reference,
  type Json,
} from "@manifold/foundation";
import type { Document as FoundationDocument } from "@manifold/foundation";
import { migrateSamplingResults } from "./samplingMigration.ts";
import { prepareSceneLoaded } from "./sceneRecords.ts";
import type { ArtifactResult } from "./artifactRecords.ts";
import { validateKeptCalculation } from "./worksheetHistory.ts";
import { workspaceStorage } from "./workspaceStorage.ts";
/** One experiment protocol. Native Python lowering, never an AI-service impersonation. */
import {
  calculate,
  evaluate,
  mathSource,
  quantityLiteral,
  references,
  type MathSource,
  type Expression,
  type Quantity,
  unitLabel,
  same,
} from "../notebook/math.ts";
import {
  ancestors,
  effective,
  project,
  semanticKey,
  type Page,
  type Point,
  type Plot,
} from "./document.ts";

import {
  validateSourceEvidence,
  sourceSelection,
  type SourceSelection,
  type SourceEvidence,
} from "./resultSnapshot.ts";
import { readCsv } from "./dataSources.ts";
import { validateModels } from "./models.ts";
import { validateExternalReference } from "./externalReference.ts";
export type Job = {
  key: string;
  code: string;
  inputs: Record<string, number>;
  context: string;
  definitions: MathSource[];
  bindings: Record<string, string>;
  snapshot: 2;
  dependencies: Record<string, Record<string, string>>;
  sources: SourceEvidence[];
  legacy: { key: string; definitions: ReturnType<typeof effective> };
};
export type Data = {
  points: [number, number][];
  code_sha256: string;
  runtime: { adapter: string; python: string };
};
export type ArtifactPresentation = {
  id: string;
  renderer: "plot" | "table";
  at: Point;
  width: number;
  height: number;
};
export type ArtifactFocus = {
  id: string;
  target:
    | "input"
    | "expression"
    | "requirement"
    | "point"
    | "context"
    | "range";
  range?: [number, number];
  quantity?: string;
  view?: string;
};
export type Artifact = {
  id: string;
  output: string;
  input: string;
  low: number;
  high: number;
  renderer: "plot" | "table";
  source: "model-derived-python";
  code?: string;
  request: string;
  at: Point;
  width: number;
  height: number;
  views?: ArtifactPresentation[];
  compareContext?: string;
  comparing?: boolean;
  requirement?: string;
  receipt?: Data & {
    key: string;
    context: string;
    code: string;
    inputs: Record<string, number>;
    definitions: MathSource[];
    time: string;
    bindings: Record<string, string>;
    snapshot?: 2;
    dependencies?: Record<string, Record<string, string>>;
    sources?: SourceEvidence[];
  };
};
export const STORAGE = workspaceStorage("manifold.artifact-experiment.v1");
const scalar = (q: Quantity) => (q.absolute ? q.value - 273.15 : q.value);
export function names(page: Page, a: Artifact) {
  const p = project(page),
    x = p.statements.get(a.input),
    y = p.statements.get(a.output);
  if (!x || !y) throw Error("The artifact's source definition is missing.");
  const xq = p.solved.values.get(x.name),
    yq = p.solved.values.get(y.name);
  if (!xq || !yq || p.errors.has(a.input) || p.errors.has(a.output))
    throw Error("Resolve the source calculation to refresh this artifact.");
  return { p, x, y, xq, yq, xUnit: unitLabel(xq), yUnit: unitLabel(yq) };
}
export function makeArtifact(
  page: Page,
  output: string,
  request: string,
): Artifact {
  const p = project(page),
    result = p.statements.get(output);
  if (!result || p.kinds[output] !== "equation")
    throw Error("Select a resolved equation first.");
  const match = request
    .trim()
    .match(
      /^plot\s+(.+?)\s+(?:versus|vs\.?)\s+(.+?)\s+from\s+([\d.eE+-]+)\s+to\s+([\d.eE+-]+)\s*(.*?)\.?$/i,
    );
  if (!match)
    throw Error(
      "Try: Plot T versus A from 0.05 to 0.5 m². This native command supports a named input and range.",
    );
  const outputName = match[1].toLowerCase(),
    inputName = match[2].toLowerCase();
  if (
    outputName !== result.name.toLowerCase() &&
    !(outputName === "temperature" && result.name === "T")
  )
    throw Error("The requested output must match the selected equation.");
  const input = ancestors(p, output).find(
    (id) =>
      p.kinds[id] === "quantity" &&
      (p.statements.get(id)!.name.toLowerCase() === inputName ||
        (inputName === "cooling area" && p.statements.get(id)!.name === "A")),
  );
  if (!input)
    throw Error("Choose an assigned input of this equation, such as A.");
  const q = p.solved.values.get(p.statements.get(input)!.name)!;
  const range = [match[3], match[4]].map((value) => {
    if (!match[5]) return Number(value) + (q.absolute ? 273.15 : 0);
    const sample = calculate([
      {
        id: "range",
        text: `range_value := ${value} ${match[5]}`,
        x: 0,
        y: 0,
        mathVersion: 2,
      },
    ]).values.get("range_value");
    if (
      !sample ||
      !same(sample.dimension, q.dimension) ||
      !!sample.absolute !== !!q.absolute
    )
      throw Error("Use the input's units for the range.");
    return sample.value;
  });
  if (!range.every(Number.isFinite) || range[0] >= range[1])
    throw Error("Use an increasing finite range.");
  return {
    id: `artifact-${crypto.randomUUID()}`,
    output,
    input,
    low: range[0],
    high: range[1],
    renderer: "plot",
    source: "model-derived-python",
    request,
    at: { x: 665, y: 110 },
    width: 600,
    height: 410,
  };
}
export function prepare(
  page: Page,
  a: Artifact,
  document?: FoundationDocument | SourceSelection,
): Job {
  const { p, xq, yq } = names(page, a),
    inputs: Record<string, number> = {},
    bindings: Record<string, string> = {},
    leaves = new Map<string, string>();
  if (
    !ancestors(p, a.output).includes(a.input) ||
    p.kinds[a.input] !== "quantity"
  )
    throw Error("This artifact no longer has a supported input binding.");
  const lower = (node: Expression, owner: string, depth = 0): string => {
    if (depth > 40)
      throw Error("This expression exceeds the sampling adapter's scope.");
    if (node.kind === "number") return String(node.value);
    // Lower complete v2 literals in canonical units, including affine Celsius offsets.
    // Keep historical emitted code and checked captures byte-for-byte unchanged.
    if (
      (p.statements.get(owner)?.mathVersion ?? 1) >= 2 &&
      (quantityLiteral(node) ||
        (node.kind === "name" && references(node).length === 0))
    )
      return String(
        evaluate(
          node,
          () => {
            throw Error("Unresolved literal");
          },
          2,
        ).value,
      );
    if (node.kind === "unit" || node.kind === "constant")
      return String(
        evaluate(
          node,
          () => {
            throw Error("Unresolved constant");
          },
          2,
        ).value,
      );
    if (node.kind === "call")
      return `${node.name === "ln" ? "log" : node.name}(${node.args.map((arg) => lower(arg, owner, depth + 1)).join(", ")})`;
    if (node.kind === "unary")
      return `(-${lower(node.expression, owner, depth + 1)})`;
    if (node.kind === "binary")
      return `(${lower(node.left, owner, depth + 1)} ${node.op === "^" ? "**" : node.op} ${lower(node.right, owner, depth + 1)})`;
    const id = p.bindings[owner]?.[node.name];
    if (!id)
      throw Error(
        "The Python experiment currently samples relationships with named inputs; move literal unit definitions to their own quantity.",
      );
    if (id === a.input) return "a";
    if (p.kinds[id] === "equation")
      return lower(p.statements.get(id)!.expression, id, depth + 1);
    const q = p.solved.values.get(node.name);
    if (!q || p.errors.has(id)) throw Error("Resolve every bound input first.");
    if (!leaves.has(id)) {
      const alias = `v${leaves.size}`;
      leaves.set(id, alias);
      inputs[alias] = q.value;
      bindings[alias] = id;
    }
    return leaves.get(id)!;
  };
  const formula = lower(p.statements.get(a.output)!.expression, a.output);
  const code =
    a.code ??
    `# Model-derived Python. Scalars use canonical SI units.\n# x: ${p.statements.get(a.input)!.name} (${unitLabel(xq)}); y: ${p.statements.get(a.output)!.name} (${unitLabel(yq)})\nx = linspace(${a.low}, ${a.high}, 201)\ny = [${formula}${yq.absolute ? " - 273.15" : ""} for a in x]\n`;
  const legacyKey = JSON.stringify([
    page.active,
    semanticKey(page),
    a.input,
    a.output,
    a.low,
    a.high,
    code,
    inputs,
  ]);
  const required = new Set([a.input, a.output, ...ancestors(p, a.output)]),
    effectiveDefinitions = effective(page),
    definitions = effectiveDefinitions
      .filter((r) => required.has(r.id))
      .map(mathSource),
    dependencies = Object.fromEntries(
      definitions.map((r) => [r.id, p.bindings[r.id] || {}]),
    ),
    sources: SourceEvidence[] = [];
  for (const region of effectiveDefinitions.filter(
    (r) => required.has(r.id) && r.source,
  )) {
    const source = region.source!,
      item = "region:" + source.dataset;
    if (!document)
      throw Error(
        "The source document is required to pin measurement evidence.",
      );
    const revision = sourceSelection(document).current(item);
    if (!revision)
      throw Error("The measurement source revision is unavailable.");
    const data = page.regions.find((r) => r.id === source.dataset)?.data;
    if (
      !data ||
      !object(revision.body) ||
      !object(revision.body.value) ||
      !object(revision.body.value.data) ||
      revision.body.value.data.csv !== data.csv ||
      revision.body.value.data.name !== data.name
    )
      throw Error(
        "The measurement source does not match the captured document.",
      );
    const reference: Reference = {
      document: document.document,
      item,
      selection: { kind: "pin", revision: revision.id },
      selector: null,
    };
    sources.push({
      region: region.id,
      reference,
      row: source.row,
      column: source.column,
      raw: source.raw,
      unit: source.unit,
    });
  }
  if (document) validateSourceEvidence(document, sources);
  const key = samplingKey(
    { input: a.input, output: a.output, low: a.low, high: a.high },
    {
      context: page.active,
      definitions,
      dependencies,
      sources,
      code,
      inputs,
    },
  );
  return {
    key,
    code,
    inputs,
    context: page.active,
    definitions,
    bindings,
    snapshot: 2,
    dependencies,
    sources,
    legacy: { key: legacyKey, definitions: effectiveDefinitions },
  };
}
export function samplingKey(
  request: Pick<Artifact, "input" | "output" | "low" | "high">,
  captured: Pick<
    Job,
    "context" | "definitions" | "dependencies" | "sources" | "code" | "inputs"
  >,
) {
  return canonical([
    2,
    captured.context,
    captured.definitions,
    captured.dependencies,
    captured.sources as unknown as Json,
    request.input,
    request.output,
    request.low,
    request.high,
    captured.code,
    captured.inputs,
  ]);
}
/** Object key order is not portable identity; array/definition order remains meaningful. */
export function receiptMatchesJob(
  r: NonNullable<Artifact["receipt"]>,
  job: Omit<Job, "legacy"> & Partial<Pick<Job, "legacy">>,
): boolean {
  try {
    return (
      (r.snapshot === 2
        ? r.key === job.key &&
          canonical(r.dependencies as Json) === canonical(job.dependencies) &&
          canonical(r.sources as unknown as Json) ===
            canonical(job.sources as unknown as Json) &&
          canonical(r.definitions as Json) ===
            canonical(job.definitions as Json)
        : !!job.legacy &&
          r.snapshot === undefined &&
          r.key === job.legacy.key &&
          canonical(r.definitions as Json) ===
            canonical(job.legacy.definitions as unknown as Json)) &&
      r.context === job.context &&
      r.code === job.code &&
      canonical(r.inputs) === canonical(job.inputs) &&
      canonical(r.bindings) === canonical(job.bindings)
    );
  } catch {
    return false;
  }
}
export function acceptData(
  page: Page,
  a: Artifact,
  job: Job,
  raw: unknown,
  document?: FoundationDocument,
): Artifact {
  if (prepare(page, a, document).key !== job.key)
    throw Error("The model changed while Python was running.");
  return acceptCapturedData(a, job, raw);
}
/** Pure independent validation of a selected request; callers own currency/admission. */
export function acceptCapturedData(
  a: Artifact,
  job: Omit<Job, "legacy">,
  raw: unknown,
): Artifact {
  const page: Page = {
    regions: job.definitions,
    contexts: [{ id: job.context, label: "Captured", base: {}, overrides: {} }],
    active: job.context,
    links: job.dependencies,
    plots: [],
    layout: {},
    origin: { x: 0, y: 0 },
  };
  const data = raw as Data;
  if (
    !data ||
    !Array.isArray(data.points) ||
    data.points.length < 2 ||
    data.points.length > 501 ||
    !/^[a-f0-9]{64}$/.test(data.code_sha256) ||
    data.runtime?.adapter !==
      `bounded-python-sampler/${Math.max(1, ...job.definitions.map((r) => r.mathVersion ?? 1))}` ||
    typeof data.runtime.python !== "string"
  )
    throw Error("Unsupported Python result.");
  const { p, x, y } = names(page, a);
  // Validate only the already-resolved dependency closure. Unrelated notes and
  // quantities must not be reparsed for every sampled point.
  const required = new Set([a.input, a.output, ...ancestors(p, a.output)]);
  const definitions = job.definitions
    .filter((r) => required.has(r.id))
    .map((r) => ({ ...r, x: 0, y: 0 }));
  let previous = -Infinity;
  for (const point of data.points) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every(Number.isFinite) ||
      point[0] <= previous ||
      point[0] < a.low - 1e-12 ||
      point[0] > a.high + 1e-12
    )
      throw Error("Invalid sampled range.");
    previous = point[0];
    const q = p.solved.values.get(x.name)!;
    const evaluated = calculate(definitions, {
      [x.name]: { ...q, value: point[0] },
    }).values.get(y.name);
    if (
      !evaluated ||
      Math.abs(scalar(evaluated) - point[1]) >
        1e-7 * Math.max(1, Math.abs(point[1]))
    )
      throw Error(
        "Python results differ from the authored model. Edit its equation to change engineering meaning.",
      );
  }
  if (
    Math.abs(data.points[0][0] - a.low) > 1e-10 ||
    Math.abs(data.points.at(-1)![0] - a.high) > 1e-10
  )
    throw Error(
      "Keep the declared sampling range; edit the request to change it.",
    );
  return {
    ...a,
    receipt: structuredClone({
      points: data.points,
      code_sha256: data.code_sha256,
      runtime: data.runtime,
      key: job.key,
      code: job.code,
      inputs: job.inputs,
      context: job.context,
      definitions: job.definitions,
      bindings: job.bindings,
      snapshot: job.snapshot,
      dependencies: job.dependencies,
      sources: job.sources,
      time: new Date().toISOString(),
    }),
  };
}
function artifactResults(
  document: FoundationDocument,
  value: unknown,
): Artifact[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some(
      (r: unknown) =>
        !object(r) ||
        Object.keys(r).some((k) => !["artifact", "receipt"].includes(k)),
    )
  )
    throw Error("Unsupported artifact results");
  const records = canvasArtifacts(document),
    known = new Set(records.map((a) => a.id)),
    results = new Map<string, NonNullable<Artifact["receipt"]>>();
  for (const r of value) {
    if (!known.has(r.artifact) || results.has(r.artifact) || !r.receipt)
      throw Error("Invalid artifact result target");
    if (validArtifactReceipt(r.receipt) && r.receipt.snapshot === 2)
      validateSourceEvidence(document, r.receipt.sources!);
    results.set(r.artifact, r.receipt);
  }
  return records.map((a) => ({
    ...a,
    ...(results.has(a.id) ? { receipt: results.get(a.id) } : {}),
  }));
}
/** The file trust boundary verifies resources and migrates old results before creating a live owner. */
async function readWorkspace(
  text: string,
  admit: boolean,
  legacyScene?: string,
): Promise<{
  page: Page;
  artifacts: Artifact[];
  document: FoundationDocument;
  recovery: CanvasRecovery;
  sceneError?: string;
}> {
  checkWorkspaceFileSize(byteLength(text));
  const value: unknown = JSON.parse(text);
  let foundation: import("@manifold/foundation").Loaded,
    results: ArtifactResult[] = [];
  if (
    object(value) &&
    (value.version === 6 ||
      value.version === 7 ||
      value.version === 8 ||
      value.version === 9)
  ) {
    fields(
      value,
      value.version !== 6
        ? ["format", "version", "foundation"]
        : ["format", "version", "foundation", "results"],
    );
    if (value.format !== "manifold-region-artifacts")
      throw Error("Unsupported workspace archive.");
    foundation = await decodeEnvelope(
      value.foundation,
      canvasSchemas,
      canvasMethods,
      webHash,
      CANVAS_NATIVE_LIMITS,
    );
    validateCanvasDocument(foundation.document, value.version === 6);
    if (value.version === 6) {
      const validated = validateWorkspaceData(
        canvasPage(foundation.document),
        artifactResults(foundation.document, value.results),
      );
      results = validated.artifacts.flatMap((artifact) =>
        artifact.receipt
          ? [{ artifact: artifact.id, receipt: artifact.receipt }]
          : [],
      );
    }
  } else {
    const legacy = restore(text);
    results = legacy.artifacts.flatMap((artifact) =>
      artifact.receipt
        ? [{ artifact: artifact.id, receipt: artifact.receipt }]
        : [],
    );
    foundation = legacyCanvasLoaded(
      legacy.page,
      legacy.document,
      legacy.artifacts.map(({ receipt: _, ...artifact }) => artifact),
    );
  }
  foundation = await migrateSamplingResults(foundation, results);
  const preparedScene = prepareSceneLoaded(
    foundation,
    canvasSchemas,
    legacyScene,
  );
  foundation = preparedScene.loaded;
  validateCanvasDocument(foundation.document);
  canvasSerial(foundation.document);
  if (admit)
    new CanvasStorageBudget().check(
      {
        ...foundation,
        receipts: SharedMap.from(
          foundation.receipts.map((receipt) => [receipt.id, receipt]),
        ),
      },
      canvasSchemas,
    );
  return {
    page: canvasPage(foundation.document),
    artifacts: canvasObservedArtifacts(foundation),
    document: foundation.document,
    recovery: { foundation },
    ...(preparedScene.sceneError
      ? { sceneError: preparedScene.sceneError }
      : {}),
  };
}
export const decodeWorkspace = (text: string, legacyScene?: string) =>
  readWorkspace(text, true, legacyScene);
/** Full data verification without creating a live application or bypassing its admission policy. */
export const inspectWorkspace = (text: string, legacyScene?: string) =>
  readWorkspace(text, false, legacyScene);
// Local recovery is data-only. Unknown schema versions are never executed.
export function restore(text: string): {
  page: Page;
  artifacts: Artifact[];
  document?: FoundationDocument;
} {
  checkWorkspaceFileSize(byteLength(text));
  let value = JSON.parse(text);
  let document: FoundationDocument | undefined;
  if (
    value?.format === "manifold-region-artifacts" &&
    (value.version === 2 ||
      value.version === 3 ||
      value.version === 4 ||
      value.version === 5)
  ) {
    if (
      !value.foundation ||
      Object.keys(value).some(
        (key) =>
          !(
            value.version === 2
              ? ["format", "version", "foundation", "artifacts"]
              : ["format", "version", "foundation", "results"]
          ).includes(key),
      )
    )
      throw Error("Unsupported workspace archive.");
    document = readCanvasDocument(value.foundation);
    if (value.version === 3 || value.version === 4 || value.version === 5) {
      value.artifacts = artifactResults(document, value.results);
    }
    value = {
      format: value.format,
      version: 1,
      page: canvasPage(document),
      artifacts: value.artifacts,
    };
  }
  if (value?.format !== "manifold-region-artifacts" || value.version !== 1)
    throw Error("Unsupported workspace archive.");
  return {
    ...validateWorkspaceData(value.page, value.artifacts),
    ...(document ? { document } : {}),
  };
}
const validatedSources = new WeakMap<
  object,
  { headers: { length: number }; rows: { length: number } }
>();
const validatedCells = new WeakMap<object, object>();
function validateStoredCsv(data: Parameters<typeof readCsv>[0]) {
  const cached = Object.isFrozen(data) ? validatedSources.get(data) : undefined;
  if (cached) return cached;
  const parsed = readCsv(data),
    shape = {
      headers: { length: parsed.headers.length },
      rows: { length: parsed.rows.length },
    };
  if (Object.isFrozen(data)) validatedSources.set(data, shape);
  return shape;
}
/** Full application validation during import/recovery, independent of file byte limits. */
export function validateWorkspaceData(
  page: unknown,
  artifacts: unknown,
  copy = true,
): { page: Page; artifacts: Artifact[] } {
  const incoming = {
    format: "manifold-region-artifacts",
    version: 1,
    page,
    artifacts,
  };
  const value = (copy ? structuredClone(incoming) : incoming) as {
    format: string;
    version: number;
    page: Page;
    artifacts: Artifact[];
  };
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const point = (v: unknown): v is Point =>
    object(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    Number.isFinite(v.x + v.y) &&
    Math.abs(v.x) + Math.abs(v.y) < 1e12;
  const id = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[a-z][a-z0-9-]{0,99}$/.test(v) &&
    v !== "constructor" &&
    (!v.match(/^(?:region|plot|alternative|data-relation)-(\d+)$/) ||
      Number(v.match(/^(?:region|plot|alternative|data-relation)-(\d+)$/)![1]) <
        100_000_000);
  const strings = (v: unknown): v is Record<string, string> =>
    object(v) &&
    Object.entries(v).every(
      ([k, t]) => id(k) && typeof t === "string" && t.length <= 5000,
    );
  const fail = (): never => {
    throw Error("Unsupported workspace archive.");
  };
  if (
    value?.format !== "manifold-region-artifacts" ||
    value.version !== 1 ||
    !object(value.page) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 16
  )
    fail();
  const p = value.page;
  if (
    p.title !== undefined &&
    (typeof p.title !== "string" ||
      !p.title.trim() ||
      p.title.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(p.title))
  )
    fail();
  if (p.calculations !== undefined) {
    if (!Array.isArray(p.calculations)) fail();
    p.calculations.forEach(validateKeptCalculation);
    if (new Set(p.calculations.map((c) => c.id)).size !== p.calculations.length)
      fail();
  }
  if (
    !Array.isArray(p.regions) ||
    p.regions.length > 256 ||
    !p.regions.every(
      (r: unknown) =>
        object(r) &&
        id(r.id) &&
        typeof r.text === "string" &&
        r.text.length <= 5000 &&
        (r.mathVersion === undefined ||
          [2, 3].includes(r.mathVersion as number)) &&
        (r.label === undefined ||
          (typeof r.label === "string" && r.label.length <= 160)) &&
        (r.provisional === undefined || typeof r.provisional === "boolean") &&
        (r.requirement === undefined || typeof r.requirement === "boolean") &&
        (r.interfaceHidden === undefined ||
          typeof r.interfaceHidden === "boolean") &&
        (r.displayUnit === undefined ||
          (typeof r.displayUnit === "string" && r.displayUnit.length <= 60)),
    ) ||
    new Set(p.regions.map((r: { id: string }) => r.id)).size !==
      p.regions.length ||
    !point(p.origin) ||
    !object(p.layout) ||
    !Object.entries(p.layout).every(([k, v]) => id(k) && point(v))
  )
    fail();
  if (
    !Array.isArray(p.contexts) ||
    !p.contexts.length ||
    p.contexts.length > 16 ||
    !p.contexts.every(
      (c: unknown) =>
        object(c) &&
        id(c.id) &&
        typeof c.label === "string" &&
        c.label.length < 100 &&
        strings(c.base) &&
        strings(c.overrides),
    ) ||
    new Set(p.contexts.map((c: { id: string }) => c.id)).size !==
      p.contexts.length ||
    !p.contexts.some((c: { id: string }) => c.id === p.active) ||
    p.contexts[0].id !== "original"
  )
    fail();
  const ids = new Set(p.regions.map((r: { id: string }) => r.id));
  for (const r of p.regions) {
    if (r.external !== undefined) validateExternalReference(r.external);
    if (r.data !== undefined) {
      try {
        validateStoredCsv(r.data);
      } catch {
        fail();
      }
    }
    if (r.source !== undefined) {
      const v = r.source;
      if (
        !object(v) ||
        !id(v.dataset) ||
        !Number.isInteger(v.row) ||
        Number(v.row) < 0 ||
        Number(v.row) >= 10000 ||
        !Number.isInteger(v.column) ||
        Number(v.column) < 0 ||
        Number(v.column) >= 12 ||
        typeof v.raw !== "string" ||
        v.raw.length > 200 ||
        typeof v.unit !== "string" ||
        v.unit.length > 80
      )
        fail();
    }
  }
  for (const r of p.regions) {
    if (r.source) {
      const source = r.source,
        data = p.regions.find((v) => v.id === source.dataset)?.data;
      if (data && (!Object.isFrozen(r) || validatedCells.get(r) !== data)) {
        if (readCsv(data).rows[source.row]?.[source.column] !== source.raw)
          fail();
        if (Object.isFrozen(r) && Object.isFrozen(data))
          validatedCells.set(r, data);
      }
    }
  }
  if (p.dataRelations !== undefined) {
    if (!Array.isArray(p.dataRelations) || p.dataRelations.length > 16) fail();
    const relationIds = new Set<string>();
    for (const r of p.dataRelations) {
      if (
        !object(r) ||
        !id(r.id) ||
        ids.has(r.id) ||
        relationIds.has(r.id) ||
        !ids.has(r.dataset) ||
        !ids.has(r.output) ||
        r.paired !== true ||
        !Array.isArray(r.bindings) ||
        !r.bindings.length ||
        r.bindings.length > 12 ||
        !object(r.scope)
      )
        fail();
      relationIds.add(r.id);
      const source = p.regions.find(
        (v: { id: string }) => v.id === r.dataset,
      )?.data;
      if (!source) fail();
      const table = validateStoredCsv(source!);
      if (
        !r.bindings.every(
          (b: unknown) =>
            object(b) &&
            typeof b.symbol === "string" &&
            /^[A-Za-z_][A-Za-z_0-9]*$/.test(b.symbol) &&
            !["constructor", "prototype", "__proto__"].includes(b.symbol) &&
            Number.isInteger(b.column) &&
            Number(b.column) >= 0 &&
            Number(b.column) < table.headers.length &&
            typeof b.unit === "string" &&
            b.unit.length <= 80 &&
            !/[\n:=<>]/.test(b.unit) &&
            (b.quantity === undefined ||
              (typeof b.quantity === "string" && ids.has(b.quantity))),
        )
      )
        fail();
      if (
        r.scope.kind !== "all" &&
        (r.scope.kind !== "records" ||
          !Array.isArray(r.scope.rows) ||
          !r.scope.rows.length ||
          r.scope.rows.length > 10000 ||
          !r.scope.rows.every(
            (i: unknown) =>
              Number.isInteger(i) &&
              Number(i) >= 0 &&
              Number(i) < table.rows.length,
          ) ||
          new Set(r.scope.rows).size !== r.scope.rows.length)
      )
        fail();
    }
  }
  if (
    p.links !== undefined &&
    (!object(p.links) ||
      Object.entries(p.links).length > 256 ||
      !Object.entries(p.links).every(
        ([consumer, bindings]) =>
          ids.has(consumer) &&
          object(bindings) &&
          Object.entries(bindings).length <= 256 &&
          Object.entries(bindings).every(
            ([symbol, source]) =>
              /^[A-Za-z_][A-Za-z_0-9]*$/.test(symbol) &&
              !["__proto__", "constructor", "prototype"].includes(symbol) &&
              id(source) &&
              ids.has(source),
          ),
      ))
  )
    fail();
  if (
    !Array.isArray(p.plots) ||
    p.plots.length > 16 ||
    !p.plots.every(
      (q: Plot) =>
        id(q.id) &&
        ids.has(q.input) &&
        ids.has(q.output) &&
        Number.isFinite(q.low + q.high) &&
        q.low < q.high &&
        q.width >= 320 &&
        q.width <= 1100 &&
        q.height >= 240 &&
        q.height <= 750 &&
        (!q.at || point(q.at)),
    )
  )
    fail();
  for (const a of value.artifacts) {
    if (
      !object(a) ||
      !id(a.id) ||
      !ids.has(a.input) ||
      !ids.has(a.output) ||
      a.source !== "model-derived-python" ||
      !["plot", "table"].includes(a.renderer as string) ||
      typeof a.request !== "string" ||
      a.request.length > 4000 ||
      typeof a.low !== "number" ||
      typeof a.high !== "number" ||
      !Number.isFinite(a.low + a.high) ||
      a.low >= a.high ||
      !point(a.at) ||
      typeof a.width !== "number" ||
      a.width < 320 ||
      a.width > 1100 ||
      typeof a.height !== "number" ||
      a.height < 240 ||
      a.height > 750 ||
      (a.code !== undefined &&
        (typeof a.code !== "string" || a.code.length > 4000))
    )
      fail();
    if (
      a.compareContext !== undefined &&
      (!id(a.compareContext) ||
        !p.contexts.some((c: { id: string }) => c.id === a.compareContext))
    )
      fail();
    if (a.comparing !== undefined && typeof a.comparing !== "boolean") fail();
    if (
      a.requirement !== undefined &&
      (!id(a.requirement) || !ids.has(a.requirement))
    )
      fail();
    if (
      a.views !== undefined &&
      (!Array.isArray(a.views) ||
        a.views.length > 4 ||
        !a.views.every(
          (v: unknown) =>
            object(v) &&
            Object.keys(v).every((k) =>
              ["id", "renderer", "at", "width", "height"].includes(k),
            ) &&
            id(v.id) &&
            ["plot", "table"].includes(v.renderer as string) &&
            point(v.at) &&
            typeof v.width === "number" &&
            v.width >= 320 &&
            v.width <= 1100 &&
            typeof v.height === "number" &&
            v.height >= 240 &&
            v.height <= 750,
        ) ||
        new Set(a.views.map((v: ArtifactPresentation) => v.id)).size !==
          a.views.length)
    )
      fail();
    // Output is optional data. Malformed old receipts do not discard authored work;
    // the runtime checks source identity, job inputs and every numeric point before use.
    if (a.receipt !== undefined && !validArtifactReceipt(a.receipt)) {
      if (!copy) fail();
      delete a.receipt;
    }
  }
  if (
    new Set(value.artifacts.map((a: Artifact) => a.id)).size !==
    value.artifacts.length
  )
    fail();
  const viewIds = value.artifacts.flatMap((a: Artifact) => [
    a.id,
    ...(a.views || []).map((v) => v.id),
  ]);
  if (new Set(viewIds).size !== viewIds.length) fail();
  validateModels(p as Page, viewIds);
  return { page: p as Page, artifacts: value.artifacts as Artifact[] };
}
