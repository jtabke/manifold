/** Presentation queries over authored definitions. No inferred physics or new solver. */
import {
  calculate,
  display,
  same,
  unitLabel,
  type Expression,
} from "../notebook/math.ts";
import {
  ancestors,
  curve,
  project,
  type Page,
  type Point,
} from "./document.ts";
import { modelContents, modelParent, type NestedModel } from "./models.ts";
import { evaluateDataset } from "./datasetModel.ts";
/** Labels belong to authored objects, never to a domain-wide symbol dictionary. */
export function quantityTitle(name: string, page?: Page): string {
  if (page) {
    const p = project(page);
    const region =
      page.regions.find((r) => r.id === name) ||
      page.regions.find(
        (r) => r.label && p.statements.get(r.id)?.name === name,
      );
    if (region?.label) return region.label;
    if (region && p.statements.get(region.id)?.anonymous)
      return p.texts[region.id];
    name = region ? p.statements.get(region.id)?.name || name : name;
  }
  return name.replaceAll("_", " ");
}
export function engineeringValue(page: Page, id: string): string {
  const p = project(page),
    s = p.statements.get(id),
    q = s && p.solved.values.get(s.name);
  if (!q || p.errors.has(id)) return "Unresolved";
  const preferredUnit = page.regions.find((r) => r.id === id)?.displayUnit;
  if (preferredUnit) {
    try {
      const unit = calculate([
        {
          id: "display-unit",
          text: `display_unit := 1 ${preferredUnit}`,
          ...(s?.mathVersion ? { mathVersion: s.mathVersion } : {}),
          x: 0,
          y: 0,
        },
      ]).values.get("display_unit");
      if (
        unit &&
        unit.value > 0 &&
        same(unit.dimension, q.dimension) &&
        !q.absolute
      )
        return `${Number((q.value / unit.value).toPrecision(4))} ${preferredUnit}`;
    } catch {
      /* Invalid display annotations never change calculation or mask its units. */
    }
  }
  const divisor =
    s!.expression.kind === "binary" &&
    s!.expression.op === "/" &&
    s!.expression.right.kind === "name"
      ? p.solved.values.get(s!.expression.right.name)
      : undefined;
  if (
    same(q.dimension, [0, 0, 0, 0]) &&
    divisor?.value === 3600 &&
    same(divisor.dimension, [1, 2, -2, 0])
  )
    return Math.abs(q.value) >= 1000
      ? `${Number((q.value / 1000).toPrecision(3))} kWh`
      : `${Number(q.value.toPrecision(4))} Wh`;

  if (same(q.dimension, [1, 2, -2, 0]))
    return Math.abs(q.value) >= 3600000
      ? `${Number((q.value / 3600000).toPrecision(3))} kWh`
      : `${Number((q.value / 3600).toPrecision(4))} Wh`;
  if (same(q.dimension, [1, 2, -3, 0]) && Math.abs(q.value) >= 1000)
    return `${Number((q.value / 1000).toPrecision(3))} kW`;
  if (same(q.dimension, [0, 0, 1, 0]) && q.value >= 60)
    return `${Number((q.value / 60).toPrecision(3))} min`;

  return display(q);
}
export function causalNeighborhood(page: Page, source: string) {
  const p = project(page),
    edges = Object.entries(p.bindings).flatMap(([to, bs]) =>
      Object.values(bs).map((from) => [from, to] as const),
    );
  const walk = (reverse: boolean) => {
    const seen = new Set<string>([source]),
      queue = [source];
    while (queue.length) {
      const id = queue.shift()!;
      for (const [from, to] of edges) {
        const next = reverse
          ? to === id
            ? from
            : undefined
          : from === id
            ? to
            : undefined;
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  return { upstream: walk(true), downstream: walk(false), edges };
}
export function definitionPath(page: Page, from: string, to: string): string[] {
  const { edges } = causalNeighborhood(page, from),
    queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!;
    if (path.at(-1) === to) return path;
    for (const [a, b] of edges)
      if (a === path.at(-1) && !seen.has(b)) {
        seen.add(b);
        queue.push([...path, b]);
      }
  }
  return [];
}
/** Bounded path inspection includes distinct loaded/return contributions. */
export function definitionPaths(
  page: Page,
  from: string,
  to: string,
  limit = 4,
): string[][] {
  const { edges } = causalNeighborhood(page, from),
    toward = new Set([to, ...ancestors(project(page), to)]),
    queue = [[from]],
    found: string[][] = [];
  let budget = 2048;
  while (queue.length && found.length < limit && budget-- > 0) {
    const path = queue.shift()!;
    if (path.at(-1) === to) {
      found.push(path);
      continue;
    }
    for (const [a, b] of edges)
      if (a === path.at(-1) && toward.has(b) && !path.includes(b))
        queue.push([...path, b]);
  }
  return found;
}
export function modelExterior(page: Page, model: NestedModel) {
  const p = project(page),
    inside = modelContents(page, model.members);
  const feeds = Object.entries(p.bindings)
    .flatMap(([target, bs]) =>
      Object.values(bs).flatMap((source) => {
        const owner = modelParent(page, target);
        return inside.has(source) &&
          !inside.has(target) &&
          owner &&
          owner !== model.id
          ? [{ source, target, model: owner }]
          : [];
      }),
    )
    .filter(
      (f, i, all) =>
        all.findIndex((a) => a.source === f.source && a.model === f.model) ===
        i,
    );
  const checks = [...p.solved.constraints].filter(([id]) => inside.has(id));
  const unresolved = [...inside].filter((id) => p.errors.has(id));
  // A reviewed vector relation can evaluate an equation without inventing a
  // scalar definition for its column-bound inputs. Keep those scopes distinct.
  const covered = new Set<string>();
  let dataCurrent = false,
    dataIncomplete = false;
  for (const relation of page.dataRelations || []) {
    if (!inside.has(relation.id)) continue;
    try {
      evaluateDataset(page, relation);
      dataCurrent = true;
      for (const id of [relation.output, ...ancestors(p, relation.output)])
        covered.add(id);
    } catch {
      dataIncomplete = true;
    }
  }
  return {
    inputs: model.inputs,
    outputs: model.outputs,
    feeds,
    checks,
    unresolved,
    // Requirement failure is independent of whether definitions evaluated.
    computation:
      dataIncomplete ||
      unresolved.some((id) => p.kinds[id] !== "constraint" && !covered.has(id))
        ? ("incomplete" as const)
        : dataCurrent ||
            [...inside].some((id) => {
              const statement = p.statements.get(id);
              return (
                statement?.relation === "=" &&
                p.solved.values.has(statement.name)
              );
            })
          ? ("current" as const)
          : ("defined" as const),
  };
}
export type Balance = {
  output: string;
  positive: string;
  negative: string;
  scale: number;
  unit: string;
};
export function findBalance(page: Page, output?: string): Balance | undefined {
  const p = project(page);
  let fallback: Balance | undefined;
  for (const [id, s] of p.statements) {
    if ((output && id !== output) || s.relation !== "=" || p.errors.has(id))
      continue;
    let expression: Expression = s.expression,
      scale = 1,
      unit = "";
    if (
      expression.kind === "binary" &&
      expression.op === "/" &&
      expression.right.kind === "name"
    ) {
      const divisor = p.bindings[id]?.[expression.right.name],
        q = p.solved.values.get(expression.right.name);
      if (!q || q.value <= 0 || !divisor || p.kinds[divisor] !== "quantity")
        continue;
      scale = q.value;
      unit =
        /^\s*\w+\s*(?::=|=)\s*1\s+([A-Za-z]+)\s*$/.exec(
          p.texts[divisor],
        )?.[1] || `per ${expression.right.name}`;
      expression = expression.left;
    }
    if (
      expression.kind !== "binary" ||
      expression.op !== "-" ||
      expression.left.kind !== "name" ||
      expression.right.kind !== "name"
    )
      continue;
    const positive = p.bindings[id]?.[expression.left.name],
      negative = p.bindings[id]?.[expression.right.name];
    const a = p.solved.values.get(expression.left.name),
      b = p.solved.values.get(expression.right.name);
    if (
      !positive ||
      !negative ||
      !a ||
      !b ||
      !same(a.dimension, b.dimension) ||
      a.absolute ||
      b.absolute ||
      p.errors.has(positive) ||
      p.errors.has(negative)
    )
      continue;
    const balance = {
      output: id,
      positive,
      negative,
      scale,
      unit: unit || unitLabel(a),
    };
    if (
      output ||
      (p.kinds[positive] === "equation" && p.kinds[negative] === "equation")
    )
      return balance;
    fallback ||= balance;
  }
  return fallback;
}
export function sampleBalance(
  page: Page,
  balance: Balance,
  input: string,
  low: number,
  high: number,
) {
  const plot = {
    id: "balance-preview",
    input,
    low,
    high,
    width: 600,
    height: 300,
  };
  const a = curve(page, { ...plot, output: balance.positive }, page.active),
    b = curve(page, { ...plot, output: balance.negative }, page.active);
  return a.points.map((point, i) => ({
    x: point.x,
    positive: point.y === undefined ? undefined : point.y / balance.scale,
    negative:
      b.points[i]?.y === undefined ? undefined : b.points[i].y! / balance.scale,
  }));
}
/** Actual cross-boundary bindings. Model cycles may summarize an acyclic quantity graph. */
export function systemArchitecture(page: Page) {
  const p = project(page);
  return Object.entries(p.bindings).flatMap(([target, bindings]) => {
    const to = modelParent(page, target);
    return Object.values(bindings).flatMap((source) => {
      const from = modelParent(page, source);
      return from && to && from !== to ? [{ from, to, source, target }] : [];
    });
  });
}
/** Authored arrangements are optional; unannotated models get distinct neutral positions. */
export function systemComposition(page: Page): Record<string, Point> {
  return Object.fromEntries(
    (page.models || [])
      .filter((m) => !modelParent(page, m.id))
      .map((m, i) => [
        m.id,
        m.presentation?.at || {
          x: 25 + (i % 4) * 360,
          y: 180 + Math.floor(i / 4) * 310,
        },
      ]),
  );
}
export function exteriorPorts(page: Page, model: NestedModel, focus?: string) {
  const p = project(page);
  const visible = model.inputs.filter(
    (id) => !page.regions.find((r) => r.id === id)?.interfaceHidden,
  );
  const rank = (id: string) =>
    id === focus ? 2 : focus && ancestors(p, id).includes(focus) ? 1 : 0;
  return visible.sort((a, b) => rank(b) - rank(a)).slice(0, 3);
}
/** Explicit interface order supplies priority; hidden helper regions stay inside. */
export function systemPortOutputs(page: Page, model: NestedModel) {
  return model.outputs.filter(
    (id) => !page.regions.find((r) => r.id === id)?.interfaceHidden,
  );
}
export function balanceInputs(page: Page, balance: Balance) {
  const p = project(page);
  return ancestors(p, balance.output).filter(
    (id) =>
      p.kinds[id] === "quantity" &&
      !p.errors.has(id) &&
      !page.regions.find((r) => r.id === id)?.interfaceHidden,
  );
}
