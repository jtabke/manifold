import { calculate, display, same, references } from "../notebook/math.ts";
import { PageEdit } from "./pageEdits.ts";
import {
  ancestors,
  project,
  semanticKey,
  remainsUnresolved,
  type ConnectionEdit,
  type Page,
} from "./document.ts";
export const quantityDescription = (name: string) =>
  (
    ({
      A: "Cooling area",
      Q: "Heat input",
      h: "Convection coefficient",
      T: "Temperature",
      T_inf: "Ambient temperature",
    }) as Record<string, string>
  )[name] || name;
export function plotChoices(page: Page, source: string) {
  const p = project(page);
  if (p.errors.has(source)) return [];
  if (p.kinds[source] === "quantity")
    return page.regions
      .filter(
        (r) =>
          p.kinds[r.id] === "equation" &&
          !p.errors.has(r.id) &&
          ancestors(p, r.id).includes(source),
      )
      .map((r) => ({ output: r.id, input: source }));
  if (p.kinds[source] === "equation")
    return ancestors(p, source)
      .filter((id) => p.kinds[id] === "quantity" && !p.errors.has(id))
      .map((input) => ({ output: source, input }));
  return [];
}
export function planConnection(
  page: Page,
  dragged: string,
  dropped: string,
  symbol?: string,
): ConnectionEdit {
  const p = project(page),
    origin = p.statements.get(dragged),
    destination = p.statements.get(dropped);
  if (!origin || !destination)
    throw Error("Choose mathematical objects to connect.");
  let source = dragged,
    target = dropped,
    text: string,
    alias: string,
    kind: ConnectionEdit["kind"],
    label: string;
  if (origin.relation !== "=") {
    source = dropped;
    target = dragged;
    alias = destination.name;
    kind = "constrain";
    if (destination.relation !== "=" || p.errors.has(dropped))
      throw Error("Connect a requirement to a resolved result.");
    const bound = calculate([
      {
        id: "bound",
        text: `bound_value := ${p.texts[dragged].split(/<=|>=|<|>|≤|≥/)[1]}`,
        x: 0,
        y: 0,
      },
    ]).values.get("bound_value");
    const q = p.solved.values.get(destination.name);
    if (
      !bound ||
      !q ||
      !same(bound.dimension, q.dimension) ||
      !!bound.absolute !== !!q.absolute
    )
      throw Error("The requirement and result have incompatible units.");
    text = p.texts[dragged].replace(
      /^\s*[A-Za-z_][A-Za-z_0-9]*/,
      destination.name,
    );
    label = `Apply this requirement to ${destination.name}`;
  } else {
    alias = origin.name;
    if (p.errors.has(dragged) || p.sources[alias]?.length !== 1)
      throw Error("Resolve the source before linking it.");
    if (dragged === dropped || ancestors(p, dragged).includes(dropped))
      throw Error(
        "This source already depends on the target; the connection would create a cycle.",
      );
    if (destination.relation !== "=")
      return planConnection(page, dropped, dragged);
    if (
      p.kinds[dropped] === "quantity" ||
      (destination.expression.kind === "name" &&
        page.links?.[dropped]?.[destination.expression.name])
    ) {
      const a = p.solved.values.get(origin.name),
        b = p.solved.values.get(destination.name);
      if (
        !a ||
        !b ||
        !same(a.dimension, b.dimension) ||
        !!a.absolute !== !!b.absolute
      )
        throw Error("These quantities have incompatible units.");
      text = `${destination.name} := ${origin.name}`;
      kind = "compute";
      label = `Use ${origin.name} for ${destination.name} instead of ${display(b)}`;
    } else if (symbol && references(destination.expression).includes(symbol)) {
      const split = p.texts[dropped].search(/:=|=/),
        prefix = p.texts[dropped].slice(0, split);
      text =
        prefix +
        p.texts[dropped]
          .slice(split)
          .replace(
            new RegExp(`(?<![A-Za-z_0-9])${symbol}(?![A-Za-z_0-9])`, "g"),
            origin.name,
          );
      kind = "reference";
      label = `Use ${origin.name} in ${destination.name} instead of ${symbol}`;
    } else
      throw Error(
        "Drop onto an assumed quantity or an equation term to replace its source.",
      );
  }
  const draft = new PageEdit(page),
    candidate = draft.page,
    context = draft.context(candidate.active)!;
  if (context.id === "original") draft.region(target)!.text = text;
  else context.overrides[target] = text;
  draft.links(target)[alias] = source;
  const result = project(candidate);
  if (result.errors.has(target) && !remainsUnresolved(p, result, target))
    throw Error(result.errors.get(target));
  const before = p.solved.values.get(destination.name),
    after = result.solved.values.get(destination.name);
  if (
    kind !== "constrain" &&
    before &&
    after &&
    (!same(before.dimension, after.dimension) ||
      !!before.absolute !== !!after.absolute)
  )
    throw Error("The connection has incompatible units.");
  for (const [id, error] of result.errors)
    if (!p.errors.has(id) && ancestors(result, id).includes(target))
      throw Error(error);
  return {
    source,
    target,
    text,
    alias,
    kind,
    context: page.active,
    key: semanticKey(page),
    label,
  };
}

/** Enumerate the same typed proposals used by drag/drop; no alternate mutation path. */
export function connectionChoices(page: Page, source: string, target?: string) {
  const p = project(page);
  const candidates = target
    ? page.regions.filter((r) => r.id === target)
    : page.regions.filter((r) => r.id !== source);
  const choices = candidates.flatMap((r) => {
    const statement = p.statements.get(r.id);
    if (!statement) return [];
    const symbols =
      statement.relation === "=" && p.kinds[r.id] === "equation"
        ? references(statement.expression)
        : [undefined];
    return [...new Set(symbols)].flatMap((symbol) => {
      try {
        const edit = planConnection(page, source, r.id, symbol);
        if (
          edit.text === p.texts[edit.target] &&
          p.bindings[edit.target]?.[edit.alias] === edit.source
        )
          return [];
        return [{ edit, symbol }];
      } catch {
        return [];
      }
    });
  });
  return choices.filter(
    (c, i) =>
      choices.findIndex(
        (v) =>
          v.edit.target === c.edit.target &&
          v.edit.source === c.edit.source &&
          v.edit.text === c.edit.text,
      ) === i,
  );
}
