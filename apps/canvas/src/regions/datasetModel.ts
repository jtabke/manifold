/** Reviewed, row-aligned use of a structured source by an existing equation.
 * Arrays remain results of a relation; they never become scalar worksheet definitions.
 */
import {
  calculate,
  references,
  same,
  type Quantity,
  type Statement,
} from "../notebook/math.ts";
import { project, effective, type Page } from "./document.ts";
import { readCsv, measurementText, numericCell } from "./dataSources.ts";
export type DatasetComputation = {
  id: string;
  dataset: string;
  output: string;
  bindings: {
    symbol: string;
    column: number;
    unit: string;
    quantity?: string;
  }[];
  scope: { kind: "all" } | { kind: "records"; rows: number[] };
  paired: boolean;
};
export type DataRecord = {
  row: number;
  value: Quantity;
  inputs: Record<string, Quantity>;
  pass?: boolean;
  conditions: Record<string, boolean>;
  limits: Record<
    string,
    { bound: Quantity; relation: Exclude<Statement["relation"], "="> }
  >;
};
export function evaluateDataset(
  page: Page,
  relation: DatasetComputation,
  context = page.active,
) {
  const source = page.regions.find((r) => r.id === relation.dataset)?.data;
  if (!source) throw Error("The source dataset is unavailable.");
  const table = readCsv(source),
    p = project(page, context),
    output = p.statements.get(relation.output);
  if (
    !output ||
    output.relation !== "=" ||
    !references(output.expression).length
  )
    throw Error("Drop columns onto an existing mathematical relationship.");
  if (p.sources[output.name]?.length !== 1)
    throw Error(`${output.name} is ambiguous; keep one model definition.`);
  if (!relation.paired)
    throw Error(
      "Confirm that these columns describe the same measurement in each row.",
    );
  const symbols = relation.bindings.map((b) =>
    b.quantity ? p.statements.get(b.quantity)?.name || b.symbol : b.symbol,
  );
  if (symbols.includes(output.name))
    throw Error("Bind model inputs, not the output being calculated.");
  if (
    !symbols.length ||
    new Set(symbols).size !== symbols.length ||
    new Set(relation.bindings.map((b) => b.column)).size !== symbols.length
  )
    throw Error("Map each selected column to a different model input.");
  const required = new Set<string>(),
    inputs = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id))
      throw Error("The model contains a circular dependency.");
    if (required.has(id)) return;
    visiting.add(id);
    required.add(id);
    const s = p.statements.get(id);
    if (!s) throw Error("A model definition is unavailable.");
    for (const symbol of references(s.expression)) {
      if ((p.sources[symbol]?.length || 0) > 1)
        throw Error(`${symbol} is ambiguous.`);
      const linked = page.links?.[id]?.[symbol];
      if (linked && p.statements.get(linked)?.name !== symbol)
        throw Error(
          `Linked ${symbol} is unavailable. Restore its definition or reconnect it.`,
        );
      inputs.add(symbol);
      if (symbols.includes(symbol)) continue;
      const target = p.bindings[id]?.[symbol];
      if (!target)
        throw Error(
          `Bind ${symbol} to a dataset column, or define it with units.`,
        );
      if (p.sources[symbol]?.length !== 1)
        throw Error(`${symbol} is ambiguous.`);
      visit(target);
    }
    visiting.delete(id);
  };
  visit(relation.output);
  for (const symbol of symbols)
    if (!inputs.has(symbol))
      throw Error(`${symbol} is not an input of this relationship.`);
  const requirements = [...p.statements].filter(
    ([, s]) => s.relation !== "=" && s.name === output.name,
  );
  for (const [id] of requirements) visit(id);
  const definitions = effective(page, context)
    .filter((r) => required.has(r.id))
    .map((r) => ({ ...r, x: 0, y: 0 }));
  const rows =
    relation.scope.kind === "all"
      ? table.rows.map((_, i) => i)
      : relation.scope.rows;
  if (
    !rows.length ||
    new Set(rows).size !== rows.length ||
    rows.some((r) => !Number.isInteger(r) || !table.rows[r])
  )
    throw Error("Select existing measurement records.");
  const units = relation.bindings.map((b, i) => {
    if (!Number.isInteger(b.column) || !table.headers[b.column])
      throw Error("A mapped column is unavailable.");
    if (!b.unit.trim())
      throw Error(
        `Specify units for ${table.headers[b.column]} (1 for dimensionless).`,
      );
    const text = measurementText(symbols[i], "1", b.unit),
      check = calculate([{ id: "unit", text, x: 0, y: 0, mathVersion: 2 }]);
    const q = check.values.get(symbols[i]);
    if (!q || check.errors.size)
      throw Error(check.errors.get("unit") || "Unsupported units.");
    const existing = p.solved.values.get(symbols[i]);
    if (
      existing &&
      (!same(q.dimension, existing.dimension) ||
        !!q.absolute !== !!existing.absolute)
    )
      throw Error(
        `The units for ${symbols[i]} do not match its model definition.`,
      );
    return { one: q, zero: q.absolute ? q.value - 1 : 0 };
  });
  const records: DataRecord[] = rows.map((row) => {
    const overrides: Record<string, Quantity> = {};
    relation.bindings.forEach((b, i) => {
      const raw = table.rows[row][b.column];
      if (!numericCell(raw))
        throw Error(
          `Row ${row + 1} · ${table.headers[b.column]}: a finite numeric measurement is required.`,
        );
      const u = units[i];
      overrides[symbols[i]] = {
        ...u.one,
        value: u.one.absolute
          ? Number(raw) + u.zero
          : Number(raw) * u.one.value,
      };
    });
    const solved = calculate(definitions, overrides),
      value = solved.values.get(output.name);
    const error =
      solved.errors.get(relation.output) ||
      requirements.map(([id]) => solved.errors.get(id)).find(Boolean);
    if (!value || error)
      throw Error(
        `Row ${row + 1}: ${error || "The relationship did not produce a result."}`,
      );
    return {
      row,
      value,
      inputs: overrides,
      limits: Object.fromEntries(
        requirements.map(([id, s]) => [
          id,
          {
            bound: solved.constraints.get(id)!.bound,
            relation: s.relation as Exclude<Statement["relation"], "=">,
          },
        ]),
      ),
      conditions: Object.fromEntries(
        requirements.map(([id]) => [id, !!solved.constraints.get(id)?.pass]),
      ),
      pass: requirements.length
        ? requirements.every(([id]) => solved.constraints.get(id)?.pass)
        : undefined,
    };
  });
  const expected = records[0].value;
  if (
    records.some(
      (r) =>
        !same(r.value.dimension, expected.dimension) ||
        !!r.value.absolute !== !!expected.absolute,
    )
  )
    throw Error("The model's output units vary between records.");
  return {
    records,
    output: output.name,
    requirements: requirements.map(([id, s]) => ({ id, text: s.raw })),
    assumptions: [...required]
      .filter(
        (id) =>
          id !== relation.output && !requirements.some(([rid]) => rid === id),
      )
      .map((id) => p.texts[id]),
    key: JSON.stringify([
      source.csv,
      definitions.map((r) => [
        r.id,
        r.text,
        ...(r.mathVersion === 2 ? [2] : []),
      ]),
      relation.dataset,
      relation.output,
      relation.bindings,
      relation.scope,
      context,
    ]),
  };
}

/** Observations are evaluated as paired records, never points on a fixed-input sweep. */
export function measurementOverlay(page: Page, output: string, input: string) {
  const p = project(page),
    source = page.regions.find((r) => r.id === input)?.source;
  if (!source) return;
  const bindings: DatasetComputation["bindings"] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const [symbol, target] of Object.entries(p.bindings[id] || {})) {
      const origin = page.regions.find((r) => r.id === target)?.source;
      if (origin) {
        if (origin.dataset !== source.dataset || origin.row !== source.row)
          throw Error(
            "Measurements have different source rows; choose an explicit row-alignment operation.",
          );
        if (!bindings.some((b) => b.symbol === symbol))
          bindings.push({
            symbol,
            quantity: target,
            column: origin.column,
            unit: origin.unit || "1",
          });
      } else visit(target);
    }
  };
  visit(output);
  if (bindings.length < 2) return;
  const result = evaluateDataset(page, {
    id: "data-relation-overlay",
    dataset: source.dataset,
    output,
    bindings,
    scope: { kind: "all" },
    paired: true,
  });
  return {
    ...result,
    dataset: source.dataset,
    column: source.column,
    input: p.statements.get(input)!.name,
  };
}
