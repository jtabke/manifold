/** One-variable optimization is ordinary captured typed computation, not live workspace execution. */
import * as f from "@manifold/foundation";
import {
  analysisInput,
  analysisRequest,
  type AnalysisInput,
  type AnalysisRequest,
  type Sweep,
} from "./modelAnalysis.ts";
import {
  lowerOptimization,
  programDigest,
  OPTIMIZER_VERSION,
  type NumericProgram,
} from "./optimizationLowering.ts";
import { optimizationConvert } from "./optimizationQuantities.ts";
export const MODEL_OPTIMIZATION = "canvas-model-optimization@2";
export const LEGACY_OPTIMIZATION = "canvas-model-optimization@1";
export const isOptimizationSchema = (schema: string | undefined) =>
  schema === MODEL_OPTIMIZATION || schema === LEGACY_OPTIMIZATION;
export const OPTIMIZATION_RENDERER = "canvas-model-optimization-view@1";
export const optimizationMethodRef = {
  id: "manifold.model-optimization",
  version: "1",
  runtime: "manifold-scipy-bounded@1",
};
export type Backend = {
  adapter: string;
  source_sha256: string;
  python: string;
  numpy: string;
  scipy: string;
};
export type OptimizationSpec = Omit<Sweep, "points"> & {
  mode: "minimize" | "maximize" | "target";
  target: number | null;
  xTolerance: number;
  residualTolerance: number | null;
  displayUnits?: { input: string; output: string };
};
export type OptimizationRequest = OptimizationSpec &
  Pick<AnalysisRequest, "instance" | "inputs"> & { backend: Backend | null };
export type NumericRequest = {
  version: string;
  program: NumericProgram;
  program_sha256: string;
  backend: Backend;
  mode: OptimizationSpec["mode"];
  bounds: number[];
  target: number | null;
  x_tolerance: number;
  residual_tolerance: number | null;
  limits: { evaluations: number; iterations: number; wall_ms: number };
};
export type OptimizationInput = {
  scalar: AnalysisInput;
  request: NumericRequest;
};
export type OptimizationOutput = {
  version: string;
  program_sha256: string;
  expected_backend: Backend;
  backend: Backend | null;
  algorithm: string;
  scope: string;
  bounds: number[];
  target: number | null;
  x_tolerance: number;
  residual_tolerance: number | null;
  relative_x_tolerance: number | null;
  limits: NumericRequest["limits"];
  success: boolean;
  code: string;
  candidate: { x: number; output: number; residual: number | null } | null;
  evaluations: number | null;
  iterations: number | null;
};
const json = (v: unknown) => v as f.Json;
const same = (a: unknown, b: unknown) =>
  f.canonical(json(a)) === f.canonical(json(b));
const finite = (v: unknown, max = 1e12): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
export function backendIdentity(v: unknown): asserts v is Backend {
  f.assert(f.object(v), "Numerical backend identity unavailable");
  f.fields(v, ["adapter", "source_sha256", "python", "numpy", "scipy"]);
  f.assert(
    v.adapter === OPTIMIZER_VERSION &&
      typeof v.source_sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(v.source_sha256) &&
      typeof v.python === "string" &&
      /^3\.12\.\d+$/.test(v.python) &&
      v.numpy === "2.2.6" &&
      v.scipy === "1.15.3",
    "Incompatible numerical environment; use the supported optional runtime",
  );
}
export function optimizationSpec(v: unknown): asserts v is OptimizationSpec {
  f.assert(f.object(v), "Invalid optimization settings");
  // Reuse axis/range limits without admitting a sweep as the optimization owner.
  const spec = v as unknown as OptimizationSpec;
  f.modelPort(spec.input);
  f.modelPort(spec.output);
  f.assert(
    finite(spec.low) && finite(spec.high) && spec.low < spec.high,
    "Use finite increasing bounds within ±1e12 in input units",
  );
  f.assert(
    ["minimize", "maximize", "target"].includes(spec.mode),
    "Choose Minimize, Maximize or Solve target",
  );
  f.assert(
    finite(spec.xTolerance) &&
      spec.xTolerance >= 1e-12 &&
      spec.xTolerance <= spec.high - spec.low,
    "Input tolerance must be ≥1e-12 and no larger than the interval",
  );
  f.assert(
    spec.mode === "target"
      ? finite(spec.target) &&
          finite(spec.residualTolerance) &&
          spec.residualTolerance >= 0
      : spec.target === null && spec.residualTolerance === null,
    "Use a finite target and nonnegative residual tolerance in output units only for Solve target",
  );
}
export function optimizationRequest(
  v: unknown,
): asserts v is OptimizationRequest {
  optimizationSpec(v);
  f.fields(v, [
    "input",
    "output",
    "low",
    "high",
    "mode",
    "target",
    "xTolerance",
    "residualTolerance",
    "instance",
    "inputs",
    "backend",
    ...(Object.hasOwn(v, "displayUnits") ? ["displayUnits"] : []),
  ]);
  if (v.displayUnits !== undefined) {
    f.assert(f.object(v.displayUnits), "Invalid display units");
    f.fields(v.displayUnits, ["input", "output"]);
    f.assert(
      typeof v.displayUnits.input === "string" &&
        typeof v.displayUnits.output === "string",
      "Invalid display units",
    );
    optimizationConvert(1, v.displayUnits.input, v.displayUnits.input);
    optimizationConvert(1, v.displayUnits.output, v.displayUnits.output);
  }
  const body = v as OptimizationRequest;
  analysisRequest({
    input: body.input,
    output: body.output,
    low: body.low,
    high: body.high,
    points: 2,
    instance: body.instance,
    inputs: body.inputs,
  });
  if (body.backend !== null) backendIdentity(body.backend);
}
export async function optimizationCapability(): Promise<Backend> {
  const unavailable = () => {
    throw Error(
      "Runtime unavailable. Start the optional supported numerical server, then Run again; settings remain editable.",
    );
  };
  const response = await fetch("/api/optimizer/capability", {
    cache: "no-store",
  }).catch(unavailable);
  const body = await response.json().catch(unavailable);
  f.assert(
    response.ok,
    response.status === 429
      ? "Numerical workers are busy; try Run again later."
      : "Runtime unavailable. The optional supported SciPy environment is required; settings remain editable.",
  );
  backendIdentity(body.backend);
  return body.backend;
}
export function createModelOptimizations(
  analyses: ReturnType<typeof import("./modelAnalysis.ts").createModelAnalyses>,
) {
  function validateInput(v: unknown): asserts v is OptimizationInput {
    f.assert(f.object(v), "Invalid optimization capture");
    f.fields(v, ["scalar", "request"]);
    analysisInput(v.scalar);
    const input = v as unknown as OptimizationInput,
      r = input.request;
    f.assert(f.object(r), "Invalid numeric request");
    f.fields(r, [
      "version",
      "program",
      "program_sha256",
      "backend",
      "mode",
      "bounds",
      "target",
      "x_tolerance",
      "residual_tolerance",
      "limits",
    ]);
    backendIdentity(r.backend);
    f.assert(
      Array.isArray(r.bounds) && r.bounds.length === 2,
      "Invalid captured bounds",
    );
    optimizationSpec({
      input: input.scalar.x.port,
      output: input.scalar.y.port,
      low: r.bounds[0],
      high: r.bounds[1],
      mode: r.mode,
      target: r.target,
      xTolerance: r.x_tolerance,
      residualTolerance: r.residual_tolerance,
    });
    f.assert(
      r.version === OPTIMIZER_VERSION &&
        same(r.program, lowerOptimization(input.scalar)) &&
        r.program_sha256 === programDigest(r.program) &&
        same(r.limits, { evaluations: 500, iterations: 200, wall_ms: 5000 }) &&
        r.bounds[0] === input.scalar.low &&
        r.bounds[1] === input.scalar.high,
      "Numeric program or limits differ from captured scalar model",
    );
    f.assert(
      new TextEncoder().encode(JSON.stringify(r)).length <= 65536,
      "Numerical request exceeds 64 KiB",
    );
  }
  function validateOutput(input: unknown, output: unknown): f.Json {
    validateInput(input);
    f.assert(f.object(output), "Invalid optimization result");
    f.fields(output, [
      "version",
      "program_sha256",
      "expected_backend",
      "backend",
      "algorithm",
      "scope",
      "bounds",
      "target",
      "x_tolerance",
      "residual_tolerance",
      "relative_x_tolerance",
      "limits",
      "success",
      "code",
      "candidate",
      "evaluations",
      "iterations",
    ]);
    const r = input.request,
      out = output as unknown as OptimizationOutput,
      target = r.mode === "target";
    for (const [key, value] of Object.entries({
      version: r.version,
      program_sha256: r.program_sha256,
      expected_backend: r.backend,
      algorithm: target
        ? "scipy.optimize.brentq"
        : "scipy.optimize.minimize_scalar:bounded",
      scope: target ? "bracketed-root" : "local-search-not-global-proof",
      bounds: r.bounds,
      target: r.target,
      x_tolerance: r.x_tolerance,
      residual_tolerance: r.residual_tolerance,
      relative_x_tolerance: target ? 4 * Number.EPSILON : null,
      limits: r.limits,
    }))
      f.assert(
        same(output[key], value),
        "Optimization result differs from captured " + key,
      );
    f.assert(
      typeof out.success === "boolean" &&
        [
          "converged",
          "no_bracket",
          "residual_not_met",
          "iteration_limit",
          "evaluation_limit",
          "deadline",
          "cancelled",
          "domain_error",
          "program_mismatch",
          "backend_mismatch",
          "unavailable",
          "transport_error",
        ].includes(out.code) &&
        out.success === (out.code === "converged"),
      "Invalid optimization termination",
    );
    if (out.backend !== null) backendIdentity(out.backend);
    for (const [count, max] of [
      [out.evaluations, r.limits.evaluations],
      [out.iterations, r.limits.iterations],
    ])
      f.assert(
        count === null ||
          (Number.isInteger(count) && count! >= 0 && count! <= max!),
        "Invalid numerical work count",
      );
    if (out.success)
      f.assert(
        same(out.backend, r.backend) &&
          out.evaluations !== null &&
          out.evaluations >= 2 &&
          out.iterations !== null &&
          out.candidate !== null,
        "Convergence lacks checked runtime/counts/candidate",
      );
    if (out.success && !target)
      f.assert(
        out.iterations! >= 1 && out.evaluations === out.iterations! + 3,
        "Bounded solver work counts disagree",
      );
    if (out.success && target) {
      if (out.iterations === 0)
        f.assert(
          out.evaluations === 2 &&
            (out.candidate!.x === r.bounds[0] ||
              out.candidate!.x === r.bounds[1]),
          "Invalid endpoint convergence counts",
        );
      else
        // The pinned Brent adapter evaluates both bounds before SciPy, whose
        // converged report has iterations + 1 calls, then checks the root once.
        f.assert(
          out.iterations! >= 1 && out.evaluations === out.iterations! + 4,
          "Bracketed solver work counts disagree",
        );
    }
    if (out.candidate !== null) {
      const c = out.candidate;
      f.assert(f.object(c), "Invalid candidate");
      f.fields(c, ["x", "output", "residual"]);
      f.assert(
        finite(c.x) &&
          c.x >= r.bounds[0]! &&
          c.x <= r.bounds[1]! &&
          finite(c.output, Number.MAX_VALUE),
        "Invalid candidate bounds/output",
      );
      f.assert(
        target
          ? finite(c.residual, Number.MAX_VALUE) &&
              c.residual === c.output - r.target! &&
              (!out.success || Math.abs(c.residual) <= r.residual_tolerance!)
          : c.residual === null,
        "Invalid candidate residual",
      );
      // Independent re-evaluation through the SAME captured scalar engine used by model sweeps.
      const checked = analyses.evaluator(input.scalar)(c.x, 0);
      f.assert(
        Math.abs(checked - c.output) <=
          Math.max(
            1e-15,
            1e-12 * Math.max(Math.abs(checked), Math.abs(c.output)),
          ),
        "Numerical candidate disagrees with captured scalar engine",
      );
      if (out.success && target)
        f.assert(
          Math.abs(checked - r.target!) <= r.residual_tolerance!,
          "Captured scalar target residual exceeds tolerance",
        );
    }
    return json(output);
  }
  const schema: f.Schema = {
    id: MODEL_OPTIMIZATION,
    validate: optimizationRequest,
    references(body) {
      optimizationRequest(body);
      return [
        body.instance,
        ...Object.values(body.inputs),
        { ...body.instance, selector: f.modelPort(body.output) },
      ];
    },
    assets: () => [],
    project(body, selector, resources, revision, reader) {
      optimizationRequest(body);
      if (!same(selector, f.wholeSelector))
        return {
          status: "unsupported",
          reason: "Inspect the whole optimization",
        };
      if (!body.backend)
        return {
          status: "unavailable",
          reason: "Run explicitly to review the optional numerical runtime",
        };
      const instance = reader.read(body.instance);
      if (instance.status !== "resolved") return instance;
      f.modelInstance(instance.projection.value);
      const definition = reader.readFrom(
        instance.projection,
        instance.projection.value.model,
      );
      if (definition.status !== "resolved") return definition;
      // The selected revision schema is checked at authoring; lowering also rejects every unreviewed method.
      const sweepBody = {
        instance: body.instance,
        inputs: body.inputs,
        input: body.input,
        output: body.output,
        low: body.low,
        high: body.high,
        points: 2,
      };
      const projected = analyses.schema.project!(
        json(sweepBody),
        selector,
        resources,
        revision,
        reader,
      );
      if ("status" in projected) return projected;
      const scalar = (
        projected.value as unknown as { input: { body: AnalysisInput } }
      ).input.body;
      if (body.displayUnits) {
        optimizationConvert(1, scalar.x.unit, body.displayUnits.input);
        optimizationConvert(1, scalar.y.unit, body.displayUnits.output);
      }
      const program = lowerOptimization(scalar);
      const input: OptimizationInput = {
        scalar,
        request: {
          version: OPTIMIZER_VERSION,
          program,
          program_sha256: programDigest(program),
          backend: body.backend,
          mode: body.mode,
          bounds: [body.low, body.high],
          target: body.target,
          x_tolerance: body.xTolerance,
          residual_tolerance: body.residualTolerance,
          limits: { evaluations: 500, iterations: 200, wall_ms: 5000 },
        },
      };
      validateInput(input);
      return {
        type: "typed-request@1",
        value: {
          method: optimizationMethodRef,
          input: { schema: "canvas-optimization-input@1", body: json(input) },
          output: "canvas-optimization-output@1",
        },
      };
    },
  };
  const method: f.TypedMethod = {
    requirements: optimizationMethodRef,
    input: "canvas-optimization-input@1",
    output: "canvas-optimization-output@1",
    limits: { inputBytes: 128 * 1024, outputBytes: 16384 },
    validateInput,
    validateOutput,
  };
  const execute: f.TypedExecutor = async (snapshot, signal) => {
    f.assert(
      f.methodKey(snapshot.method) === f.methodKey(optimizationMethodRef),
      "Optimization method unavailable",
    );
    validateInput(snapshot.input.body);
    const token = crypto.randomUUID();
    const cancel = () => {
      void fetch("/api/optimizer/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        keepalive: true,
      }).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      f.assert(!signal.aborted, "Optimization cancelled");
      const response = await fetch("/api/optimizer/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, request: snapshot.input.body.request }),
        signal,
      });
      const text = await response.text();
      f.assert(text.length <= 16384, "Oversized numerical response");
      const output: unknown = JSON.parse(text);
      f.assert(
        response.ok,
        f.object(output) && typeof output.error === "string"
          ? output.error
          : "Numerical transport unavailable",
      );
      return validateOutput(snapshot.input.body, output);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  };
  const legacySchema: f.Schema = {
    ...schema,
    id: LEGACY_OPTIMIZATION,
    validate(v) {
      f.assert(
        f.object(v) && !Object.hasOwn(v, "displayUnits"),
        "Legacy settings cannot contain display units",
      );
      optimizationRequest(v);
    },
  };
  return {
    schema,
    legacySchema,
    method,
    execute,
    validateInput,
    validateOutput,
  };
}
