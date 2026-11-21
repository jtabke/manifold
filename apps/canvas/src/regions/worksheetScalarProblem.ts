/** A disposable, bound worksheet problem. Probe in base units using the same
 * prepared evaluator as the worksheet; numerical backends lower from its bindings. */
import { assert } from "@manifold/foundation";
import {
  compilePreparedSeries,
  type CalculationState,
} from "../notebook/math.ts";
import { readMap } from "../notebook/immutable.ts";
import type { Projection } from "./worksheetProjection.ts";

export type ScalarSelection = Readonly<{
  inputs: readonly string[];
  outputs: readonly string[];
  requirements: readonly string[];
}>;

export function resolvedScalar(p: Projection, id: string) {
  const s = p.statements.get(id),
    q = s && p.solved.values.get(s.name);
  assert(
    s && q && !p.errors.has(id) && p.sources[s.name]?.length === 1,
    `Resolve ${s?.name || "the selected quantity"} before analysis.`,
  );
  return { s, q };
}

export function compileScalarProblem(
  p: Projection,
  baseline: CalculationState,
  selection: ScalarSelection,
) {
  const baselineValue = (id: string) => resolvedScalar(p, id);
  const binding = (id: string, name: string) => {
    const refs = p.bindings[id];
    return refs && Object.hasOwn(refs, name) ? refs[name] : undefined;
  };
  const inputs = selection.inputs.map((id) => {
    const { s, q } = baselineValue(id);
    assert(s.relation === "=", "Vary an assigned worksheet quantity.");
    return { id, name: s.name, q };
  });
  const outputs = [...new Set(selection.outputs)].map((id) => ({
    id,
    name: baselineValue(id).s.name,
  }));
  const requirements = [...new Set(selection.requirements)].map((id) => {
    const s = p.statements.get(id),
      subject = s && binding(id, s.name);
    assert(
      s && s.relation !== "=" && subject,
      "Bind the worksheet inequality to its quantity before analysis.",
    );
    return Object.freeze({ id, s, subject, relation: s.relation });
  });
  const users = new Map<string, Set<string>>();
  for (const [id, refs] of Object.entries(p.bindings))
    for (const ref of Object.values(refs)) {
      let readers = users.get(ref);
      if (!readers) users.set(ref, (readers = new Set()));
      readers.add(id);
    }
  const pending = inputs.map((input) => input.id),
    varying = new Set(pending);
  for (const id of pending)
    for (const reader of users.get(id) ?? [])
      if (!varying.has(reader)) {
        varying.add(reader);
        pending.push(reader);
      }
  let evaluate: ReturnType<typeof compilePreparedSeries> | undefined;
  function at(coordinates: readonly number[]) {
    assert(
      coordinates.length === inputs.length &&
        coordinates.every(Number.isFinite),
      "Use finite coordinates for every selected input.",
    );
    evaluate ??= compilePreparedSeries(baseline);
    const result = evaluate(
      Object.fromEntries(
        inputs.map(({ name, q }, i) => [name, { ...q, value: coordinates[i] }]),
      ),
    );
    return Object.freeze({
      values: readMap(
        outputs.map(
          ({ id, name }) =>
            [
              id,
              result.errors.has(id) ? undefined : result.values.get(name),
            ] as const,
        ),
      ),
      requirements: readMap(
        requirements.map(({ id }) => [id, result.constraints.get(id)] as const),
      ),
    });
  }
  return Object.freeze({
    baselineValue,
    binding,
    varies: (id: string) => varying.has(id),
    requirements: Object.freeze(requirements),
    at,
  });
}

/** Identical closed grid for worksheet response and feasibility queries. */
export function sampleScalarAxis<T>(
  low: number,
  high: number,
  point: (x: number) => T,
): T[] {
  return Array.from({ length: 81 }, (_, i) => {
    if (i === 0) return point(low);
    if (i === 80) return point(high);
    const offset = (high - low) * i;
    return point(
      Number.isFinite(offset)
        ? low + offset / 80
        : low * (1 - i / 80) + high * (i / 80),
    );
  });
}
