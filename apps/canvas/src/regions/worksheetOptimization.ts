/** Transient design review. Only the closed numeric DAG goes to the solver; the
 * worksheet remains authoritative for names, units, constraints and adoption. */
import {
  assert,
  fields,
  object,
  canonical,
  type Json,
} from "@manifold/foundation";
import {
  evaluate,
  references,
  quantityLiteral,
  passes,
  same,
  display,
  type Expression,
  type Quantity,
  type Statement,
} from "../notebook/math.ts";
import { immutable } from "../notebook/immutable.ts";
import { ancestors, project, type Page } from "./document.ts";
import { scalarProblem } from "./worksheetProjection.ts";
import {
  resolvedScalar as resolved,
  sampleScalarAxis,
} from "./worksheetScalarProblem.ts";
import { worksheetInputUnit } from "./worksheetInputUnit.ts";
import { measurementUnit, parseLiteralQuantity } from "./dataSources.ts";
import { optimizationQuantity } from "./optimizationQuantities.ts";
import {
  numericDag,
  programDigest,
  type NumericProgram,
} from "./optimizationLowering.ts";
import {
  optimizationCapability,
  requestOptimization,
  type Backend,
} from "./modelOptimization.ts";

export const DESIGN_VERSION = "manifold-worksheet-design/1";
type Relation = Exclude<Statement["relation"], "=">;
type DesignProgram = NumericProgram & {
  requirements: { left: number; right: number; relation: Relation }[];
};
export type DesignSpec = {
  goal: string;
  mode: "minimize" | "maximize";
  axes: { id: string; low: string; high: string }[];
  requirements: string[];
  reports: string[];
};
export function designChoices(page: Page, goal: string) {
  const p = project(page),
    related = new Set(ancestors(p, goal));
  const inputs: {
      id: string;
      name: string;
      unit: string;
      current: number;
      related: boolean;
    }[] = [],
    reports: { id: string; name: string }[] = [],
    requirements: {
      id: string;
      source?: string;
      label: string;
      error?: string;
    }[] = [];
  for (const [id, s] of p.statements) {
    if (s.relation !== "=") {
      requirements.push({
        id,
        source: p.bindings[id]?.[s.name],
        label: p.texts[id],
        error: p.errors.get(id),
      });
      continue;
    }
    if (s.anonymous || p.errors.has(id) || p.sources[s.name]?.length !== 1)
      continue;
    const q = p.solved.values.get(s.name);
    if (!q) continue;
    if (id !== goal) reports.push({ id, name: s.name });
    if (
      !q.absolute &&
      quantityLiteral(s.expression) &&
      p.kinds[id] === "quantity"
    ) {
      const unit = worksheetInputUnit(s, q);
      inputs.push({
        id,
        name: s.name,
        unit: unit.label,
        current: unit.fromBase(q.value),
        related: related.has(id),
      });
    }
  }
  return {
    inputs: inputs.sort((a, b) => Number(b.related) - Number(a.related)),
    requirements,
    reports,
  };
}
export function defaultAxis(
  input: ReturnType<typeof designChoices>["inputs"][number],
) {
  const delta = Math.abs(input.current) / 2 || 1;
  return {
    id: input.id,
    low: String(Number((input.current - delta).toPrecision(10))),
    high: String(Number((input.current + delta).toPrecision(10))),
  };
}

export function studySources(page: Page, spec: DesignSpec) {
  const p = project(page);
  const roots = [
    spec.goal,
    ...spec.axes.map((a) => a.id),
    ...spec.requirements,
    ...spec.reports,
  ];
  const included = new Set(roots.flatMap((id) => [id, ...ancestors(p, id)]));
  return page.regions
    .filter((r) => included.has(r.id) && p.statements.has(r.id))
    .map((r) => r.id);
}

/** Resolved, authored inputs in the study's dependency closure, other than its axes. */
export function studyFixedInputs(page: Page, spec: DesignSpec) {
  const p = project(page),
    varied = new Set(spec.axes.map((a) => a.id));
  return studySources(page, spec).flatMap((id) => {
    const s = p.statements.get(id)!;
    if (
      varied.has(id) ||
      p.errors.has(id) ||
      p.kinds[id] !== "quantity" ||
      s.relation !== "=" ||
      s.anonymous ||
      !quantityLiteral(s.expression) ||
      p.sources[s.name]?.length !== 1
    )
      return [];
    const q = p.solved.values.get(s.name);
    return q
      ? [{ id, name: s.name, value: worksheetInputUnit(s, q).format(q.value) }]
      : [];
  });
}

export function defaultStudySpec(page: Page, goal: string): DesignSpec {
  const { inputs, requirements } = designChoices(page, goal);
  return {
    goal,
    mode: "minimize",
    axes: inputs
      .filter((i) => i.related)
      .slice(0, 2)
      .map(defaultAxis),
    requirements: requirements
      .filter((r) => !r.error)
      .slice(0, 16)
      .map((r) => r.id),
    reports: [],
  };
}

/** Validate before publishing a study. Give unitless entries their current axis unit,
 * so later changes to the source's display unit cannot reinterpret saved ranges. */
export function captureStudySpec(page: Page, settings: DesignSpec): DesignSpec {
  assert(settings.axes.length === 2, "Choose two inputs to map.");
  const { axes, spec } = captureDesignProblem(page, settings);
  return {
    ...spec,
    axes: spec.axes.map((a, i) => {
      const unit = axes[i].unit;
      const explicit = (text: string) => {
        const value = text.trim();
        return unit &&
          /^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?$/i.test(value)
          ? `${value} ${unit}`
          : value;
      };
      return { id: a.id, low: explicit(a.low), high: explicit(a.high) };
    }),
  };
}

function captureDesignProblem(page: Page, settings: DesignSpec) {
  const spec = structuredClone(settings),
    p = project(page);
  const goal = resolved(p, spec.goal);
  assert(
    goal.s.relation === "=" &&
      !goal.s.anonymous &&
      p.kinds[spec.goal] === "equation",
    "Select a resolved named equation to optimize.",
  );
  assert(
    spec.mode === "minimize" || spec.mode === "maximize",
    "Select a goal.",
  );
  assert(
    spec.axes.length >= 1 &&
      spec.axes.length <= 2 &&
      new Set(spec.axes.map((a) => a.id)).size === spec.axes.length,
    "Vary one or two distinct assigned inputs.",
  );
  assert(
    spec.requirements.length <= 16 &&
      spec.reports.length <= 32 &&
      new Set(spec.requirements).size === spec.requirements.length &&
      new Set(spec.reports).size === spec.reports.length,
    "Use at most 16 requirements and 32 reported quantities.",
  );
  for (const id of spec.reports)
    assert(resolved(p, id).s.relation === "=", "Report a resolved quantity.");
  const axes = spec.axes.map(({ id, low, high }) => {
    const { s, q } = resolved(p, id);
    assert(
      p.kinds[id] === "quantity" &&
        !q.absolute &&
        quantityLiteral(s.expression),
      "Vary assigned literal quantities, not formulas or absolute temperatures.",
    );
    const unit = worksheetInputUnit(s, q),
      bounds = [
        optimizationQuantity(low, unit.label || "1"),
        optimizationQuantity(high, unit.label || "1"),
      ];
    assert(
      bounds.every((v) => Math.abs(v) <= 1e12) && bounds[0] < bounds[1],
      `Use an increasing range within ±1e12 for ${s.name}.`,
    );
    return {
      id,
      name: s.name,
      unit: unit.label,
      scale: unit.scale,
      suffix: unit.suffix,
      current: unit.fromBase(q.value),
      bounds,
    };
  });
  for (const id of spec.requirements)
    assert(
      p.solved.constraints.has(id),
      "Resolve the selected worksheet inequality before analysis.",
    );
  const problem = scalarProblem(page, {
    inputs: axes.map((a) => a.id),
    outputs: [
      spec.goal,
      ...spec.reports,
      ...spec.requirements.map(
        (id) => p.bindings[id][p.statements.get(id)!.name],
      ),
    ],
    requirements: spec.requirements,
  });
  assert(
    axes.every((a) =>
      [spec.goal, ...spec.requirements].some(
        (id) => id !== a.id && ancestors(p, id).includes(a.id),
      ),
    ),
    "Each varied input must affect the goal or a selected requirement.",
  );
  return { spec, axes, problem };
}

export function captureDesign(page: Page, settings: DesignSpec) {
  const { spec, axes, problem } = captureDesignProblem(page, settings);
  const { nodes, put } = numericDag(),
    cache = new Map<string, number>(),
    constant = (value: number) => put({ op: "const", value });
  const varies = (id: string | undefined) =>
    id !== undefined && problem.varies(id);
  function row(id: string): number {
    if (cache.has(id)) return cache.get(id)!;
    const { s, q } = problem.baselineValue(id),
      axis = axes.findIndex((a) => a.id === id);
    let index: number;
    if (axis >= 0) {
      index = put({ op: axis === 0 ? "x" : "y" });
      if (axes[axis].scale !== 1)
        index = put({ op: "mul", args: [index, constant(axes[axis].scale)] });
    } else
      index =
        varies(id) || Math.abs(q.value) > 1e12
          ? expression(s.expression, id, s)
          : constant(q.value);
    cache.set(id, index);
    return index;
  }
  function expression(e: Expression, id: string, s: Statement): number {
    const ref = (name: string) => problem.binding(id, name);
    const deps = references(e);
    if (!deps.some((name) => varies(ref(name)))) {
      const fixed = evaluate(
        e,
        (name) => problem.baselineValue(ref(name)!).q,
        s.mathVersion ?? 1,
      ).value;
      // Preserve the cap on wire literals without turning a valid product (48 * E) into an oversized literal.
      if (
        Math.abs(fixed) <= 1e12 ||
        (e.kind !== "binary" &&
          e.kind !== "unary" &&
          e.kind !== "call" &&
          !(e.kind === "name" && ref(e.name)))
      )
        return constant(fixed);
    }
    if (e.kind === "name") return row(ref(e.name)!);
    if (e.kind === "unary")
      return put({ op: "neg", args: [expression(e.expression, id, s)] });
    if (e.kind === "call")
      return put({
        op: e.name,
        args: e.args.map((arg) => expression(arg, id, s)),
      });
    assert(e.kind === "binary", "Unsupported numerical expression.");
    if (e.op === "^")
      assert(
        !references(e.right).some((name) => varies(ref(name))),
        "Use a fixed power exponent for worksheet optimization.",
      );
    const ops: Record<string, string> = {
      "+": "add",
      "-": "sub",
      "*": "mul",
      "/": "div",
      "^": "pow",
    };
    assert(ops[e.op], "Unsupported numerical operator.");
    return put({
      op: ops[e.op],
      args: [expression(e.left, id, s), expression(e.right, id, s)],
    });
  }
  const output = row(spec.goal),
    requirements = problem.requirements.map(({ id, s, subject, relation }) => ({
      left: row(subject),
      right: expression(s.expression, id, s),
      relation,
    }));
  const program: DesignProgram = { nodes, output, requirements },
    request = {
      version: DESIGN_VERSION,
      program,
      program_sha256: programDigest(program, DESIGN_VERSION),
      mode: spec.mode,
      bounds: axes.map((a) => a.bounds),
      start: axes.map((a) =>
        Math.min(a.bounds[1], Math.max(a.bounds[0], a.current)),
      ),
      limits: { evaluations: 500, iterations: 160, wall_ms: 5000 },
    };
  return immutable({ spec, axes, request });
}
export function scanDesignRange(page: Page, settings: DesignSpec) {
  assert(settings.axes.length === 1, "Scan a single input range.");
  const {
    axes: [axis],
    spec,
    problem,
  } = captureDesignProblem(page, settings);
  const points = sampleScalarAxis(axis.bounds[0], axis.bounds[1], (x) => {
    const result = problem.at([x * axis.scale]);
    const checks = problem.requirements.map(
      ({ id }) => result.requirements.get(id)?.pass ?? null,
    );
    const goalDefined = !!result.values.get(spec.goal);
    return { x, checks, pass: sampledFeasibility(goalDefined, checks) };
  });
  return immutable({
    input: axis.name,
    unit: axis.unit,
    labels: problem.requirements.map(({ s }) => s.raw),
    points,
  });
}
export type DesignRange = ReturnType<typeof scanDesignRange>;

function sampledFeasibility(goalDefined: boolean, checks: (boolean | null)[]) {
  // A known failure remains a failure even if another equation is undefined.
  return checks.includes(false)
    ? false
    : !goalDefined || checks.includes(null)
      ? null
      : true;
}

function requirementUnits(p: ReturnType<typeof project>, id: string) {
  const s = p.statements.get(id)!,
    { bound } = p.solved.constraints.get(id)!;
  const source =
    s.expression.kind === "name" && p.bindings[id][s.expression.name];
  const units = worksheetInputUnit(
    source
      ? p.statements.get(source)
      : { ...s, raw: s.raw.replace(/<=|>=|≤|≥|<|>/, ":=") },
    bound,
  );
  return { ...units, marginUnit: bound.absolute ? "K" : units.label };
}

export type DesignMargin = {
  value: number;
  atLimit: boolean;
  roundoff: boolean;
};
function requirementMargin(
  relation: Relation,
  bound: Quantity,
  actual: Quantity,
  scale: number,
): DesignMargin | null {
  const slack = relation.startsWith("<")
    ? bound.value - actual.value
    : actual.value - bound.value;
  const value = slack / scale;
  if (!Number.isFinite(value)) return null;
  const magnitude = Math.max(
    Math.abs(actual.value),
    Math.abs(bound.value),
    1e-15,
  );
  // A display cue only. The worksheet's exact pass/fail check still applies.
  return {
    value,
    atLimit: Math.abs(slack) <= 1e-6 * magnitude,
    roundoff: slack !== 0 && Math.abs(slack) < 16 * Number.EPSILON * magnitude,
  };
}

export type DesignMapPoint = {
  x: number;
  y: number;
  values: readonly (number | null)[];
  checks: readonly (boolean | null)[];
  margins: readonly (DesignMargin | null)[];
  pass: boolean | null;
};

export type DesignLimitPreview = { id: string; text: string };

/** A bounded grid of actual worksheet probes, not a solver run or a persisted artifact.
 * An optional fixed-limit preview changes the comparison, never the worksheet values. */
export function mapDesignResponses(
  page: Page,
  settings: DesignSpec,
  preview?: DesignLimitPreview,
) {
  assert(settings.axes.length === 2, "Choose two inputs to map.");
  const {
    axes: [xAxis, yAxis],
    spec,
    problem,
  } = captureDesignProblem(page, settings);
  const p = project(page);
  const requirements = problem.requirements.map(
    ({ id, s, relation, subject }) => ({
      id,
      label: s.raw,
      name: s.name,
      relation,
      subject,
      units: requirementUnits(p, id),
      bound: p.solved.constraints.get(id)!.bound,
      fixed: !references(s.expression).some((name) =>
        problem.varies(problem.binding(id, name) ?? ""),
      ),
    }),
  );
  let trial:
    | { id: string; bound: Quantity; label: string; text: string }
    | undefined;
  if (preview) {
    const requirement = requirements.find((r) => r.id === preview.id);
    assert(requirement?.fixed, "Choose a requirement with a fixed limit.");
    const input = preview.text.trim();
    assert(
      input.length > 0 && input.length <= 256,
      "Enter a limit with compatible units.",
    );
    const text = /^[+−-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+−-]?\d+)?$/i.test(input)
      ? `${input} ${requirement.units.suffix}`.trim()
      : input;
    const bound = parseLiteralQuantity(text);
    assert(
      Number.isFinite(bound.value) &&
        same(bound.dimension, requirement.bound.dimension) &&
        !!bound.absolute === !!requirement.bound.absolute,
      `Enter a finite limit compatible with ${requirement.units.label || "a dimensionless value"}.`,
    );
    trial = {
      id: preview.id,
      bound,
      text,
      label: `${requirement.name} ${requirement.relation} ${text}`,
    };
  }
  const defaults = [
    ...new Set([spec.goal, ...problem.requirements.map((r) => r.subject)]),
  ];
  const outputs = [...new Set([...defaults, ...spec.reports])].map((id) => {
    const { s, q } = problem.baselineValue(id);
    const preferred = requirements.filter((r) => r.subject === id).at(-1);
    const fallback = worksheetInputUnit(s, q);
    const label =
      preferred?.units.label ||
      page.regions.find((r) => r.id === id)?.displayUnit;
    let unit = fallback.label,
      scale = fallback.scale;
    if (label) {
      try {
        const u = measurementUnit(label);
        if (!q.absolute && !u.absolute && same(q.dimension, u.dimension)) {
          unit = label;
          scale = u.value;
        }
      } catch {
        /* Ignore invalid display annotations. */
      }
    }
    return {
      id,
      name: s.name,
      unit,
      scale,
      offset: q.absolute ? 273.15 : 0,
      dimension: q.dimension,
      absolute: !!q.absolute,
      default: defaults.includes(id),
    };
  });
  const makePoint = (
    x: number,
    y: number,
    values: (id: string) => Quantity | undefined,
    constraint: (id: string) => { pass: boolean; bound: Quantity } | undefined,
  ): DesignMapPoint => {
    const measured = outputs.map(
      ({ id, scale, offset, dimension, absolute }) => {
        const q = values(id);
        if (!q || !same(q.dimension, dimension) || !!q.absolute !== absolute)
          return null;
        const value = (q.value - offset) / scale;
        return Number.isFinite(value) ? value : null;
      },
    );
    const checked = requirements.map(({ id, subject, relation }) => {
      if (trial?.id !== id) return constraint(id);
      const actual = values(subject),
        { bound } = trial;
      if (
        !actual ||
        !same(actual.dimension, bound.dimension) ||
        !!actual.absolute !== !!bound.absolute
      )
        return undefined;
      return { bound, pass: passes(relation, actual.value, bound.value) };
    });
    const checks = checked.map((c) => c?.pass ?? null);
    const margins = requirements.map(({ subject, relation, units }, k) => {
      const bound = checked[k]?.bound,
        actual = values(subject);
      return bound && actual
        ? requirementMargin(relation, bound, actual, units.scale)
        : null;
    });
    return {
      x,
      y,
      values: measured,
      checks,
      margins,
      pass: sampledFeasibility(measured[0] !== null, checks),
    };
  };
  const size = 25;
  const coordinates = (bounds: number[], i: number) =>
    i === size - 1
      ? bounds[1]
      : bounds[0] + ((bounds[1] - bounds[0]) * i) / (size - 1);
  const points = Array.from({ length: size * size }, (_, i) => {
    const x = coordinates(xAxis.bounds, i % size),
      y = coordinates(yAxis.bounds, Math.floor(i / size));
    const result = problem.at([x * xAxis.scale, y * yAxis.scale]);
    return makePoint(
      x,
      y,
      (id) => result.values.get(id),
      (id) => result.requirements.get(id),
    );
  });
  return immutable({
    xAxis,
    yAxis,
    size,
    points,
    outputs,
    requirements: requirements.map(
      ({ id, label, name, units, fixed, bound }) => ({
        id,
        name,
        label: trial?.id === id ? trial.label : label,
        unit: units.marginUnit,
        fixedValue: fixed
          ? `${units.fromBase(bound.value)} ${units.label}`.trim()
          : undefined,
      }),
    ),
    preview: trial && { id: trial.id, label: trial.label, text: trial.text },
    current: makePoint(
      xAxis.current,
      yAxis.current,
      (id) => problem.baselineValue(id).q,
      (id) => p.solved.constraints.get(id),
    ),
  });
}
export type DesignResponseMap = ReturnType<typeof mapDesignResponses>;

type Capture = ReturnType<typeof captureDesign>;
type Candidate = { x: number[]; output: number };
export type DesignExecutor = (
  capture: Capture,
  signal: AbortSignal,
) => Promise<Candidate>;
function checkedCandidate(c: Capture, v: unknown): asserts v is Candidate {
  assert(
    object(v) &&
      Array.isArray(v.x) &&
      v.x.length === c.axes.length &&
      v.x.every(
        (x, i) =>
          typeof x === "number" &&
          Number.isFinite(x) &&
          c.axes[i].bounds[0] <= x &&
          x <= c.axes[i].bounds[1],
      ) &&
      typeof v.output === "number" &&
      Number.isFinite(v.output),
    "Candidate does not match the captured inputs and bounds.",
  );
  fields(v, ["x", "output"]);
}
export function decodeDesign(c: Capture, backend: Backend, v: unknown) {
  const equal = (a: unknown, b: unknown) =>
    canonical(a as Json) === canonical(b as Json);
  assert(
    object(v) &&
      v.version === DESIGN_VERSION &&
      v.program_sha256 === c.request.program_sha256 &&
      v.mode === c.spec.mode &&
      equal(v.bounds, c.request.bounds) &&
      v.algorithm === "scipy.optimize.minimize:SLSQP" &&
      typeof v.code === "string" &&
      v.success === (v.code === "converged"),
    "Result does not match this optimization run.",
  );
  fields(v, [
    "version",
    "program_sha256",
    "backend",
    "mode",
    "bounds",
    "algorithm",
    "success",
    "code",
    "candidate",
    "evaluations",
    "iterations",
  ]);
  for (const field of ["evaluations", "iterations"] as const) {
    const n = v[field];
    assert(
      (!v.success && n === null) ||
        (typeof n === "number" &&
          Number.isInteger(n) &&
          n >= 0 &&
          n <= c.request.limits[field]),
      "Invalid numerical work count.",
    );
  }
  if (!v.success) {
    assert(
      v.candidate === null,
      "Failed searches must not return an applicable candidate.",
    );
    const reasons: Record<string, string> = {
      no_feasible_candidate:
        "No feasible candidate found. Review the input bounds and selected requirements.",
      not_converged:
        "Search did not converge. Review the ranges or try a different starting design.",
      domain_error:
        "An equation is undefined within the search range. Narrow the input bounds.",
      unavailable: "Numerical runtime unavailable.",
      backend_mismatch: "Numerical runtime changed; run again.",
      iteration_limit: "Iteration limit reached.",
      evaluation_limit: "Evaluation limit reached.",
      deadline: "Optimization timed out.",
      cancelled: "Optimization cancelled.",
    };
    throw Error(
      reasons[v.code] || "Numerical search failed; no values were changed.",
    );
  }
  assert(equal(v.backend, backend), "Numerical backend changed; run again.");
  checkedCandidate(c, v.candidate);
  return v.candidate;
}
export const executeWorksheetDesign: DesignExecutor = async (c, signal) => {
  const backend = await optimizationCapability(signal);
  return decodeDesign(
    c,
    backend,
    await requestOptimization({ ...c.request, backend }, signal),
  );
};

function shown(q: Quantity, unit?: string) {
  if (unit) {
    try {
      const u = measurementUnit(unit);
      if (!u.absolute && !q.absolute && same(u.dimension, q.dimension))
        return `${Number((q.value / u.value).toPrecision(7))} ${unit}`.trim();
    } catch {
      /* A display annotation is not part of the calculation. */
    }
  }
  return display(q);
}
export function reviewDesign(page: Page, c: Capture, candidate: Candidate) {
  checkedCandidate(c, candidate);
  const before = project(page),
    writes = c.axes.map((a, i) => ({
      id: a.id,
      text:
        candidate.x[i] === a.current
          ? before.texts[a.id]
          : `${a.name} := ${candidate.x[i]} ${a.suffix}`.trim(),
    })),
    edits = Object.fromEntries(writes.map((v) => [v.id, v.text])),
    after = project({
      ...page,
      contexts: page.contexts.map((ctx) =>
        ctx.id === page.active
          ? { ...ctx, overrides: { ...ctx.overrides, ...edits } }
          : ctx,
      ),
    });
  for (const [id, reason] of after.errors)
    assert(
      before.errors.has(id) &&
        !c.axes.some((a) => a.id === id || ancestors(after, id).includes(a.id)),
      `Proposed worksheet cannot be evaluated: ${reason}`,
    );
  const output = resolved(after, c.spec.goal).q.value;
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b), 1e-12);
  assert(
    near(output, candidate.output),
    "The worksheet and solver disagree on the proposed goal. Nothing was changed.",
  );
  c.axes.forEach((a, i) => {
    const value = resolved(after, a.id).q.value;
    assert(
      near(value, candidate.x[i] * a.scale) &&
        value >= a.bounds[0] * a.scale &&
        value <= a.bounds[1] * a.scale,
      "The written input does not match its checked range.",
    );
  });
  const units = new Map<string, string>(),
    limits = c.spec.requirements.map((id) => {
      const s = before.statements.get(id)!,
        old = before.solved.constraints.get(id)!,
        next = after.solved.constraints.get(id);
      assert(
        next?.pass,
        `Proposed worksheet fails ${s.raw}. Nothing was changed.`,
      );
      const lhs = before.bindings[id][s.name],
        now = resolved(before, lhs).q,
        proposed = resolved(after, lhs).q,
        { label: unit, marginUnit, scale } = requirementUnits(before, id);
      units.set(lhs, unit);
      assert(s.relation !== "=", "Expected a worksheet inequality.");
      const beforeMargin = requirementMargin(s.relation, old.bound, now, scale);
      const mapMargin = requirementMargin(
        s.relation,
        next.bound,
        proposed,
        scale,
      );
      const format = (m: DesignMargin | null) =>
        m ? `${Number(m.value.toPrecision(7))} ${marginUnit}`.trim() : "—";
      const checkedMargin = format(mapMargin);
      return {
        id,
        label: s.raw,
        current: format(beforeMargin),
        proposed: mapMargin?.roundoff
          ? `≈0 ${marginUnit}`.trim()
          : checkedMargin,
        checkedMargin,
        mapMargin,
        active: !!mapMargin?.atLimit,
      };
    });
  const ids = [
    ...new Set([
      ...c.axes.map((a) => a.id),
      c.spec.goal,
      ...c.spec.requirements.map(
        (id) => before.bindings[id][before.statements.get(id)!.name],
      ),
      ...c.spec.reports,
    ]),
  ];
  const rows = ids.map((id) => {
    const { s, q } = resolved(before, id),
      next = resolved(after, id).q;
    assert(
      same(q.dimension, next.dimension) && !!q.absolute === !!next.absolute,
      "Reported quantity changed dimensions.",
    );
    const unit =
      units.get(id) ||
      page.regions.find((r) => r.id === id)?.displayUnit ||
      (quantityLiteral(s.expression)
        ? worksheetInputUnit(s, q).label
        : undefined);
    const axis = c.axes.find((a) => a.id === id),
      bounds = axis?.bounds;
    const atBound =
      axis &&
      bounds &&
      (near(next.value, bounds[0] * axis.scale)
        ? "At minimum"
        : near(next.value, bounds[1] * axis.scale)
          ? "At maximum"
          : undefined);
    return {
      id,
      name: s.name,
      atBound,
      current: shown(q, unit),
      proposed: shown(next, unit),
      value: next.value,
    };
  });
  return immutable({ writes, rows, limits });
}
export type DesignReview = ReturnType<typeof reviewDesign>;
