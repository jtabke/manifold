/** Read-only engineering status over the existing worksheet evaluation. */
import { project, semanticKey, type Page } from "./document.ts";
import { display, same, type Quantity } from "../notebook/math.ts";
import { findBalance } from "./systemExploration.ts";

export function evaluationKey(page: Page) {
  const source = `${page.active}:${semanticKey(page)}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++)
    hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${page.active}:${(hash >>> 0).toString(36)}`;
}
export function magnitude(q: Quantity): string {
  const value = Math.abs(q.value);
  if (same(q.dimension, [1, 2, -2, 0]))
    return value >= 3600000
      ? `${Number((value / 3600000).toPrecision(3))} kWh`
      : `${Number((value / 3600).toPrecision(4))} Wh`;
  if (same(q.dimension, [1, 2, -3, 0]) && value >= 1000)
    return `${Number((value / 1000).toPrecision(3))} kW`;
  if (same(q.dimension, [0, 0, 1, 0]) && value >= 60)
    return `${Number((value / 60).toPrecision(3))} min`;
  return display({ ...q, value });
}
export function assessConstraint(page: Page, id: string) {
  const p = project(page),
    condition = p.solved.constraints.get(id),
    statement = p.statements.get(id);
  if (!condition || !statement) return;
  const value = p.solved.values.get(statement.name);
  if (!value || p.errors.has(id)) return;
  const lower = statement.relation === ">=" || statement.relation === ">";
  const slack = lower
    ? value.value - condition.bound.value
    : condition.bound.value - value.value;
  const definition =
    p.sources[statement.name]?.length === 1
      ? p.sources[statement.name][0]
      : undefined;
  let gapQuantity: Quantity = { ...value, value: slack, absolute: undefined };
  const expression = definition && p.statements.get(definition)?.expression;
  if (
    same(value.dimension, [0, 0, 0, 0]) &&
    expression &&
    expression.kind === "binary" &&
    expression.op === "/" &&
    expression.right.kind === "name"
  ) {
    const divisor = p.solved.values.get(expression.right.name);
    if (divisor && divisor.value > 0)
      gapQuantity = {
        value: slack * divisor.value,
        dimension: divisor.dimension,
      };
  }
  return {
    id,
    definition,
    value,
    condition,
    provisional: page.regions.find((r) => r.id === id)?.provisional === true,
    gap: { ...value, value: Math.abs(slack), absolute: undefined },
    summary: condition.pass
      ? `${magnitude(gapQuantity)} margin`
      : slack === 0
        ? "At excluded boundary"
        : `${magnitude(gapQuantity)} ${lower ? "short" : "over"}`,
  };
}
export function systemAssessment(page: Page) {
  const p = project(page);
  const failures = [...p.solved.constraints]
    .filter(([, c]) => !c.pass)
    .map(([id]) => assessConstraint(page, id))
    .filter((c): c is NonNullable<typeof c> => !!c);
  // Balance checks are useful investigation entry points, not an inferred safety
  // ranking. Provisional limits remain visible and explicitly qualified.
  failures.sort(
    (a, b) =>
      Number(a.provisional) - Number(b.provisional) ||
      Number(!!findBalance(page, b.definition)) -
        Number(!!findBalance(page, a.definition)),
  );
  return {
    key: evaluationKey(page),
    context: page.active,
    label:
      page.contexts.find((c) => c.id === page.active)?.label || page.active,
    failures,
    blocked: p.errors.size,
    provisional: failures.filter((c) => c.provisional).length,
  };
}
