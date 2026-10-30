/** Pre-incremental full worksheet algorithm, retained only as a differential test oracle. */
import {
  parse,
  evaluate,
  same,
  passes,
  expressionBody,
  references,
} from "../src/notebook/math.ts";
const mathematical = (text) =>
  /^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(text) ||
  expressionBody(text) !== undefined;
const incompleteNumber = (text) =>
  /(?:^|[^A-Za-z_0-9.])(?:\d+\.(?!\d)|\d+(?:\.\d+)?[eE][+-]?(?![\dA-Za-z_]))(?=\s*(?:$|[)*/+^\-]|[A-Za-z]))/.test(
    text,
  );
export function effective(page, context = page.active) {
  const c = page.contexts.find((c) => c.id === context);
  return page.regions.map((r) => ({
    ...r,
    text: c.overrides[r.id] ?? c.base[r.id] ?? r.text,
  }));
}
export function referenceCalculate(regions, overrides = {}) {
  const statements = new Map(),
    byName = new Map(),
    values = new Map(),
    errors = new Map(),
    constraints = new Map();
  for (const region of regions) {
    try {
      const s = parse(region.text, region.id);
      statements.set(region.id, s);
      if (s.relation === "=") {
        if (byName.has(s.name)) {
          errors.set(region.id, `${s.name} is already defined.`);
          errors.set(byName.get(s.name), `${s.name} is defined twice.`);
        } else byName.set(s.name, region.id);
      }
    } catch (e) {
      errors.set(region.id, e.message);
    }
  }
  const visiting = new Set();
  const resolve = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (values.has(name)) return values.get(name);
    const id = byName.get(name);
    if (!id) throw Error(`Define ${name} with a value and units.`);
    if (errors.has(id)) throw Error(errors.get(id));
    if (visiting.has(name))
      throw Error(`Circular dependency involving ${name}.`);
    visiting.add(name);
    try {
      const value = evaluate(statements.get(id).expression, resolve);
      values.set(name, value);
      return value;
    } finally {
      visiting.delete(name);
    }
  };
  for (const [id, s] of statements) {
    if (errors.has(id)) continue;
    try {
      if (s.relation === "=") resolve(s.name);
      else {
        const actual = resolve(s.name),
          bound = evaluate(s.expression, resolve);
        if (
          !same(actual.dimension, bound.dimension) ||
          !!actual.absolute !== !!bound.absolute
        )
          throw Error(
            "The limit and the result need matching units and temperature conventions.",
          );
        constraints.set(id, {
          pass: passes(s.relation, actual.value, bound.value),
          bound,
          statement: s,
        });
      }
    } catch (e) {
      errors.set(id, e.message);
    }
  }
  return { statements, values, errors, constraints };
}
export function referenceProject(page, context = page.active) {
  const regions = effective(page, context),
    statements = new Map(),
    kinds = {},
    sources = {};
  const drafts = new Map();
  for (const r of regions) {
    if (r.external || r.data || !mathematical(r.text)) {
      kinds[r.id] = "note";
      continue;
    }
    try {
      if (incompleteNumber(r.text))
        throw Error(
          "Use a complete number before calculating; the draft is retained.",
        );
      const s = parse(r.text.trim(), r.id);
      statements.set(r.id, s);
      kinds[r.id] =
        s.relation !== "="
          ? "constraint"
          : s.anonymous || references(s.expression).length
            ? "equation"
            : "quantity";
      if (s.relation === "=") (sources[s.name] ||= []).push(r.id);
    } catch (e) {
      kinds[r.id] = "draft";
      drafts.set(r.id, e.message);
      const definition = r.text.match(
        /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*(?::=|=(?!=))/,
      );
      if (definition) (sources[definition[1]] ||= []).push(r.id);
    }
  }
  const linkErrors = new Map();
  for (const [id, s] of statements) {
    const used = [
      ...references(s.expression),
      ...(s.relation !== "=" ? [s.name] : []),
    ];
    for (const name of used) {
      const target = page.links?.[id]?.[name];
      if (
        target &&
        (sources[name]?.length !== 1 ||
          sources[name][0] !== target ||
          statements.get(target)?.name !== name)
      )
        linkErrors.set(
          id,
          `Linked ${name} is unavailable or ambiguous. Restore its definition or reconnect it.`,
        );
    }
  }
  // Failed definitions still reserve their symbol, so dependents never use a hidden old value.
  const calculations = regions
    .filter(
      (r) =>
        kinds[r.id] !== "note" &&
        (!drafts.has(r.id) ||
          /^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|=(?!=))/.test(r.text)),
    )
    .map((r) => ({
      ...r,
      x: 0,
      y: 0,
      text: linkErrors.has(r.id)
        ? r.text.replace(
            /(?::=|<=|>=|<|>|=|≤|≥).*/,
            `${statements.get(r.id).relation} (1/0)`,
          )
        : drafts.has(r.id)
          ? r.text.replace(/(?::=|<=|>=|<|>|=|≤|≥).*/, "= __unfinished_value")
          : r.text.trim(),
    }));
  const solved = referenceCalculate(calculations),
    errors = new Map([...solved.errors, ...drafts, ...linkErrors]);
  const bindings = {};
  for (const [id, s] of statements)
    bindings[id] = Object.fromEntries(
      [
        ...new Set([
          ...references(s.expression),
          ...(s.relation !== "=" ? [s.name] : []),
        ]),
      ]
        .filter(
          (name) => page.links?.[id]?.[name] || sources[name]?.length === 1,
        )
        .map((name) => [name, page.links?.[id]?.[name] || sources[name][0]]),
    );
  return {
    solved,
    errors,
    statements,
    kinds,
    sources,
    bindings,
    texts: Object.fromEntries(regions.map((r) => [r.id, r.text])),
  };
}
export function referenceSemanticKey(page, context = page.active) {
  return JSON.stringify(
    effective(page, context)
      .filter((r) => !r.external && !r.data && mathematical(r.text))
      .map((r) => {
        try {
          const s = parse(r.text.trim(), r.id);
          return [
            r.id,
            s.name,
            s.relation,
            s.expression,
            incompleteNumber(r.text),
            Object.entries(page.links?.[r.id] || {})
              .filter(([name]) =>
                [
                  ...references(s.expression),
                  ...(s.relation !== "=" ? [s.name] : []),
                ].includes(name),
              )
              .sort(([a], [b]) => a.localeCompare(b)),
          ];
        } catch {
          return [r.id, r.text];
        }
      })
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

/** Original 81-point worksheet curve, using the independent full-rebuild oracle. */
export function referenceCurve(page, plot, context = page.active) {
  const p = referenceProject(page, context),
    input = p.statements.get(plot.input),
    output = p.statements.get(plot.output),
    quantity = input && p.solved.values.get(input.name);
  if (
    !input ||
    !output ||
    !quantity ||
    p.errors.has(plot.input) ||
    p.errors.has(plot.output) ||
    p.sources[input.name]?.length !== 1
  )
    return { points: [], unit: undefined };
  const condition = [...p.statements].find(
    ([, s]) => s.name === output.name && s.relation !== "=",
  );
  const calculations = effective(page, context)
    .filter((r) => p.kinds[r.id] !== "note")
    .map((r) => ({ ...r, x: 0, y: 0 }));
  let unit;
  const points = Array.from({ length: 81 }, (_, i) => {
    const x = plot.low + ((plot.high - plot.low) * i) / 80,
      result = referenceCalculate(calculations, {
        [input.name]: { ...quantity, value: x },
      }),
      q = result.values.get(output.name);
    if (!q || result.errors.has(plot.output)) return { x };
    unit = q;
    const c = condition && result.constraints.get(condition[0]);
    return {
      x,
      y: q.absolute ? q.value - 273.15 : q.value,
      ...(c
        ? {
            limit: c.bound.absolute ? c.bound.value - 273.15 : c.bound.value,
            pass: c.pass,
          }
        : {}),
    };
  });
  return { points, unit };
}
