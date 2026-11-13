/** Owner-validated request recipes; changed scalar values stay in their authored records. */
import * as f from "@manifold/foundation";
import { prepare, type Artifact, type Job } from "./artifacts.ts";
import { samplingInvocation } from "./samplingExecution.ts";
import { canvasSchemas } from "./app/canvasDocument.ts";
import type { Page, Region } from "./document.ts";
import { mathSource, type MathSource } from "../notebook/math.ts";
import type { SourceEvidence, SourceSelection } from "./resultSnapshot.ts";
export type SamplingJob = Omit<Job, "legacy">;
type Definition =
  | Readonly<{ reference: f.Reference }>
  | Readonly<{ value: MathSource }>;
export type SamplingPlan = Readonly<{
  document: string;
  artifact: string;
  context: string;
}> &
  (
    | Readonly<{ status: "blocked"; reason: string }>
    | Readonly<{
        status: "ready";
        request: Pick<Artifact, "input" | "output" | "low" | "high" | "code">;
        definitions: readonly Definition[];
        bindings: Job["dependencies"];
        sources: readonly SourceEvidence[];
      }>
  );
const json = (value: unknown) => value as f.Json,
  validatedPlans = new WeakSet<object>(),
  validatedRoots = new WeakMap<object, WeakSet<object>>(),
  jobs = new WeakMap<object, { selection: string; job: SamplingJob }>(),
  resources: f.Resources = {
    read: () => ({
      status: "unavailable",
      reason: "Worksheet sources are inline",
    }),
  };
export function compileSamplingPlan(
  page: Page,
  artifact: Artifact,
  context: string,
  sources: f.Document | SourceSelection,
): SamplingPlan {
  const binding = {
    document: sources.document,
    artifact: artifact.id,
    context,
  };
  try {
    const captured = prepare({ ...page, active: context }, artifact, sources),
      c = page.contexts.find((c) => c.id === context)!;
    const { legacy: _, ...bounded } = captured;
    f.assert(
      f.byteLength(f.canonical(json(bounded))) <= 128 * 1024,
      "Calculation capture budget exceeded",
    );
    const plan: SamplingPlan = {
      ...binding,
      status: "ready",
      request: {
        input: artifact.input,
        output: artifact.output,
        low: artifact.low,
        high: artifact.high,
        ...(artifact.code === undefined ? {} : { code: artifact.code }),
      },
      definitions: captured.definitions.map((value) =>
        Object.hasOwn(c.base, value.id) || Object.hasOwn(c.overrides, value.id)
          ? { value }
          : { reference: f.reference(sources.document, "region:" + value.id) },
      ),
      bindings: captured.dependencies,
      sources: captured.sources,
    };
    samplingPlanSchema.validate(json(plan));
    return plan;
  } catch (error) {
    return {
      ...binding,
      status: "blocked",
      reason: String(error).slice(0, 2000),
    };
  }
}
function idOf(definition: Definition) {
  return "value" in definition
    ? definition.value.id
    : definition.reference.item.slice(7);
}
export const samplingPlanSchema: f.Schema = {
  id: "canvas-sampling-plan@1",
  validate(body) {
    f.assert(f.object(body), "Invalid sampling plan");
    if (validatedPlans.has(body)) return;
    f.fields(
      body,
      body.status === "ready"
        ? [
            "document",
            "artifact",
            "context",
            "status",
            "request",
            "definitions",
            "bindings",
            "sources",
          ]
        : ["document", "artifact", "context", "status", "reason"],
    );
    f.identity(body.document);
    f.identity(body.artifact);
    f.identity(body.context);
    f.assert(
      f.byteLength(f.canonical(body as f.Json)) <= 128 * 1024,
      "Calculation capture budget exceeded",
    );
    if (body.status === "ready") {
      f.assert(
        f.object(body.request) &&
          Array.isArray(body.definitions) &&
          body.definitions.length > 0 &&
          body.definitions.length <= 256 &&
          f.object(body.bindings) &&
          Array.isArray(body.sources) &&
          body.sources.length <= 256,
        "Invalid sampling recipe",
      );
      f.fields(body.request, ["input", "output", "low", "high", "code"]);
      f.identity(body.request.input);
      f.identity(body.request.output);
      f.assert(
        typeof body.request.low === "number" &&
          typeof body.request.high === "number" &&
          Number.isFinite(body.request.low + body.request.high) &&
          body.request.low < body.request.high &&
          (body.request.code === undefined ||
            (typeof body.request.code === "string" &&
              body.request.code.length <= 4000)),
        "Invalid sampling range/code",
      );
      const ids = new Set<string>();
      for (const definition of body.definitions) {
        f.assert(f.object(definition), "Invalid sampling definition");
        if ("value" in definition) {
          f.fields(definition, ["value"]);
          f.assert(
            f.object(definition.value),
            "Invalid frozen sampling definition",
          );
          f.fields(definition.value, ["id", "text", "mathVersion"]);
          f.identity(definition.value.id);
          f.assert(
            typeof definition.value.text === "string" &&
              definition.value.text.length <= 5000 &&
              (definition.value.mathVersion === undefined ||
                [2, 3].includes(definition.value.mathVersion as number)),
            "Invalid sampling text",
          );
        } else {
          f.fields(definition, ["reference"]);
          f.validateReference(definition.reference);
          f.assert(
            definition.reference.document === body.document &&
              definition.reference.item.startsWith("region:") &&
              definition.reference.selection.kind === "follow" &&
              f.canonical(definition.reference.selector) ===
                f.canonical(f.wholeSelector),
            "Invalid sampling input reference",
          );
        }
        const id = idOf(definition as unknown as Definition);
        f.assert(!ids.has(id), "Duplicate sampling definition");
        ids.add(id);
      }
      f.assert(
        ids.has(body.request.input) &&
          ids.has(body.request.output) &&
          Object.keys(body.bindings).sort().join() === [...ids].sort().join(),
        "Sampling interface mismatch",
      );
      for (const bindings of Object.values(body.bindings)) {
        f.assert(f.object(bindings), "Invalid sampling bindings");
        for (const id of Object.values(bindings)) {
          f.identity(id);
          f.assert(ids.has(id), "Captured dependency unavailable");
        }
      }
      const targets = new Set<string>();
      for (const source of body.sources) {
        f.assert(f.object(source), "Invalid sampling source");
        f.fields(source, [
          "region",
          "reference",
          "row",
          "column",
          "raw",
          "unit",
        ]);
        f.identity(source.region);
        f.assert(
          ids.has(source.region) &&
            !targets.has(source.region) &&
            Number.isInteger(source.row) &&
            Number(source.row) >= 0 &&
            Number(source.row) < 10000 &&
            Number.isInteger(source.column) &&
            Number(source.column) >= 0 &&
            Number(source.column) < 12 &&
            typeof source.raw === "string" &&
            source.raw.length <= 200 &&
            typeof source.unit === "string" &&
            source.unit.length <= 80,
          "Invalid sampling source observation",
        );
        targets.add(source.region);
        f.validateReference(source.reference);
        f.assert(
          source.reference.document === body.document &&
            source.reference.selection.kind === "pin" &&
            source.reference.selector === null,
          "Sampling sources must pin exact revisions",
        );
      }
    } else
      f.assert(
        body.status === "blocked" &&
          typeof body.reason === "string" &&
          body.reason.length <= 2000,
        "Invalid blocked sampling plan",
      );
    if (f.deeplyFrozen(body)) validatedPlans.add(body);
  },
  references(body) {
    this.validate(body);
    const plan = body as unknown as SamplingPlan;
    return plan.status === "ready"
      ? [
          ...plan.definitions.flatMap((d) =>
            "reference" in d ? [d.reference] : [],
          ),
          ...plan.sources.map((s) => s.reference),
        ]
      : [];
  },
  assets: () => [],
  project(body, selector, _resources, _revision, reader) {
    const execution = f.canonical(selector) === f.canonical(samplingSelector);
    if (!execution && f.canonical(selector) !== f.canonical(f.wholeSelector))
      return { status: "unsupported", reason: "Inspect a whole sampling plan" };
    const plan = body as unknown as SamplingPlan;
    if (plan.status === "blocked")
      return { status: "unavailable", reason: plan.reason };
    const selected = new Map<string, f.Revision>(),
      regions: Region[] = [];
    function read(reference: f.Reference) {
      const got = reader.read(reference);
      f.assert(
        got.status === "resolved",
        got.status === "resolved" ? "" : got.reason,
      );
      f.assert(
        got.projection.type === "canvas-record" &&
          f.object(got.projection.value),
        "Sampling input is not a worksheet record",
      );
      return got.projection;
    }
    for (const definition of plan.definitions) {
      const value =
        "value" in definition
          ? definition.value
          : (read(definition.reference).value as unknown as Region);
      regions.push(mathSource(value as unknown as MathSource));
    }
    for (const source of plan.sources) {
      const projection = read(source.reference),
        value = projection.value as unknown as Region;
      if (!selected.has(projection.revision)) {
        selected.set(projection.revision, {
          id: projection.revision,
          item: projection.item,
          schema: "canvas-record@1",
          required: true,
          body: {
            document: plan.document,
            kind: "region",
            value: projection.value,
          },
        });
        regions.push(value);
      }
      const region = regions.find((r) => r.id === source.region)!;
      region.source = {
        dataset: source.reference.item.slice(7),
        row: source.row,
        column: source.column,
        raw: source.raw,
        unit: source.unit,
      };
    }
    const page: Page = {
        regions,
        contexts: [
          { id: plan.context, label: "Selected", base: {}, overrides: {} },
        ],
        active: plan.context,
        links: plan.bindings,
        plots: [],
        layout: {},
        origin: { x: 0, y: 0 },
      },
      artifact: Artifact = {
        ...plan.request,
        id: plan.artifact,
        renderer: "plot",
        source: "model-derived-python",
        request: "Selected sampling request",
        at: { x: 0, y: 0 },
        width: 600,
        height: 410,
      },
      sources: SourceSelection = {
        document: plan.document,
        revision: (id) => selected.get(id),
        current: (item) => [...selected.values()].find((r) => r.item === item),
      },
      { legacy: _, ...job } = prepare(page, artifact, sources);
    f.assert(
      f.byteLength(f.canonical(json(job))) <= 128 * 1024,
      "Calculation capture budget exceeded",
    );
    if (execution) {
      const { key: _, ...capture } = job;
      const { input, output, low, high } = plan.request;
      return {
        type: "typed-request@1",
        value: json(
          samplingInvocation({
            artifact: plan.artifact,
            request: { input, output, low, high },
            capture,
          }),
        ),
      };
    }
    return { type: "sampling-capture@1", value: json(job) };
  },
};
export const samplingSelector = f.freeze({
  kind: "sampling-execution",
  version: 1,
});
export function planReference(
  document: f.Document,
  artifact: string,
  context: string,
) {
  const record = f.current(document, "artifact:" + artifact);
  f.assert(
    record?.schema === "canvas-artifact@2" &&
      f.object(record.body) &&
      f.object(record.body.plans),
    "Sampling plans unavailable",
  );
  const reference = record.body.plans[context];
  f.validateReference(reference);
  return reference;
}
export function samplingReference(
  document: f.Document,
  artifact: string,
  context: string,
) {
  return {
    ...planReference(document, artifact, context),
    selector: samplingSelector,
  };
}
export function readSamplingPlan(
  document: f.Document,
  artifact: string,
  context: string,
): SamplingPlan {
  const selected = f.resolve(
    document,
    planReference(document, artifact, context),
  );
  f.assert(
    selected.status === "resolved" &&
      selected.revision.schema === samplingPlanSchema.id,
    "Sampling plan unavailable",
  );
  return selected.revision.body as unknown as SamplingPlan;
}
export function samplingJob(
  document: f.Document,
  artifact: string,
  context: string,
): SamplingJob {
  const reference = planReference(document, artifact, context),
    plan = readSamplingPlan(document, artifact, context),
    selection = f.canonical(
      samplingPlanSchema.references(json(plan)).map((r) => {
        const got = f.resolve(document, r);
        return [
          r.item,
          got.status === "resolved" ? got.revision.id : got.status,
        ];
      }),
    ),
    prior = jobs.get(plan);
  if (prior?.selection === selection) return prior.job;
  const got = f.project(document, reference, canvasSchemas, resources);
  f.assert(
    got.status === "resolved" && got.projection.type === "sampling-capture@1",
    got.status === "resolved" ? "Invalid sampling projection" : got.reason,
  );
  const job = got.projection.value as unknown as SamplingJob;
  if (f.deeplyFrozen(plan)) jobs.set(plan, { selection, job });
  return job;
}
export function validateSamplingPlans(
  document: f.Document,
  page: Page,
  artifacts: readonly Artifact[],
  allowLegacy = false,
) {
  const prior = validatedRoots.get(document.items);
  if (prior?.has(document.revisions)) return;
  for (const artifact of artifacts) {
    const record = f.current(document, "artifact:" + artifact.id)!;
    if (record.schema === "canvas-artifact@1") {
      f.assert(
        allowLegacy,
        "Legacy artifact requires migration before publication",
      );
      continue;
    }
    f.assert(
      f.object(record.body) &&
        f.object(record.body.plans) &&
        Object.keys(record.body.plans).sort().join() ===
          page.contexts
            .map((c) => c.id)
            .sort()
            .join(),
      "Sampling plan contexts mismatch",
    );
    for (const context of page.contexts) {
      const plan = readSamplingPlan(document, artifact.id, context.id),
        expected = compileSamplingPlan(page, artifact, context.id, document);
      f.assert(
        f.canonical(json(plan)) === f.canonical(json(expected)),
        "Sampling plan differs from accepted worksheet meaning",
      );
    }
  }
  if (!allowLegacy) {
    const roots = prior ?? new WeakSet<object>();
    roots.add(document.revisions);
    validatedRoots.set(document.items, roots);
  }
}
