/** Reviewed, row-aligned use of a structured source by an existing equation.
 * Arrays remain results of a relation; they never become scalar worksheet definitions.
 */
import {
  prepareCalculation,
  references,
  same,
  solvePrepared,
  type CalculationState,
  type Quantity,
  type Statement,
} from "../notebook/math.ts";
import { immutable } from "../notebook/immutable.ts";
import { project, type Page, type Projection } from "./document.ts";
import { deeplyFrozen, sameJson } from "./immutableJson.ts";
import {
  readCsv,
  measurementUnit,
  numericCell,
  type CsvData,
} from "./dataSources.ts";
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
  return evaluateRelation(
    sourceFor(page, relation),
    relation,
    context,
    modelFor(page, relation, context),
  );
}
function sourceFor(page: Page, relation: DatasetComputation) {
  const data = page.regions.find((r) => r.id === relation.dataset)?.data;
  // Snapshot the two actual inputs to readCsv, even for mutable caller data.
  return data && { name: data.name, csv: data.csv };
}
function modelFor(
  page: Page,
  relation: DatasetComputation,
  context: string,
  worksheet?: Projection,
) {
  try {
    return resolveModel(page, relation, worksheet ?? project(page, context));
  } catch (e) {
    return { error: (e as Error).message };
  }
}
/** Re-resolve against the current worksheet, not just IDs found last time:
 * even a newly ambiguous name or a newly applicable limit matters. Return all
 * worksheet inputs to row evaluation as data; no CSV reads or reparsing here. */
function resolveModel(page: Page, relation: DatasetComputation, p: Projection) {
  const output = p.statements.get(relation.output);
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
  return {
    output: output.name,
    symbols,
    // The scalar value is overridden per row. Its *solved* units, including
    // absence and absolute temperature, still gate the mapping.
    boundUnits: symbols.map((symbol) => {
      const q = p.solved.values.get(symbol);
      return q && { dimension: q.dimension, absolute: !!q.absolute };
    }),
    definitions: page.regions
      .filter((r) => required.has(r.id))
      .map(({ id, mathVersion }) => ({ id, text: p.texts[id], mathVersion })),
    requirements: requirements.map(([id, s]) => ({
      id,
      text: s.raw,
      relation: s.relation as Exclude<Statement["relation"], "=">,
    })),
    assumptions: [...required]
      .filter(
        (id) =>
          id !== relation.output && !requirements.some(([rid]) => rid === id),
      )
      .map((id) => p.texts[id]),
  };
}
function evaluateRelation(
  source: CsvData | undefined,
  relation: DatasetComputation,
  context: string,
  model: ReturnType<typeof modelFor>,
) {
  // Preserve source/CSV diagnostics ahead of model and row diagnostics.
  if (!source) throw Error("The source dataset is unavailable.");
  const table = readCsv(source);
  if ("error" in model) throw Error(model.error);
  return {
    records: evaluateRows(table, relation, model),
    output: model.output,
    requirements: model.requirements.map(({ id, text }) => ({ id, text })),
    assumptions: model.assumptions,
    key: JSON.stringify([
      source.csv,
      model.definitions.map(({ id, text, mathVersion }) => [
        id,
        text,
        ...(mathVersion ? [mathVersion] : []),
      ]),
      relation.dataset,
      relation.output,
      relation.bindings,
      relation.scope,
      context,
    ]),
  };
}
function evaluateRows(
  table: ReturnType<typeof readCsv>,
  relation: DatasetComputation,
  {
    symbols,
    boundUnits,
    definitions,
    output,
    requirements,
  }: ReturnType<typeof resolveModel>,
): DataRecord[] {
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
    const q = measurementUnit(b.unit);
    const existing = boundUnits[i];
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
  const prepared = definitions.map(({ id, text, mathVersion }) =>
    prepareCalculation(id, text, mathVersion ?? 1),
  );
  let previousRow: CalculationState | undefined;
  const records: DataRecord[] = rows.map((row) => {
    const overrides: Record<string, Quantity> = {};
    relation.bindings.forEach((b, i) => {
      const raw = table.rows[row][b.column];
      if (!numericCell(raw))
        throw Error(
          `Row ${row + 1} · ${table.headers[b.column]}: a finite numeric measurement is required.`,
        );
      const u = units[i];
      const value = u.one.absolute
        ? Number(raw) + u.zero
        : Number(raw) * u.one.value;
      if (!Number.isFinite(value))
        throw Error(
          `Row ${row + 1} · ${table.headers[b.column]}: the measurement is not a finite real quantity.`,
        );
      overrides[symbols[i]] = {
        ...u.one,
        value,
      };
    });
    previousRow = solvePrepared(prepared, overrides, previousRow);
    const { solved } = previousRow,
      value = solved.values.get(output);
    const error =
      solved.errors.get(relation.output) ||
      requirements.map(({ id }) => solved.errors.get(id)).find(Boolean);
    if (!value || error)
      throw Error(
        `Row ${row + 1}: ${error || "The relationship did not produce a result."}`,
      );
    return {
      row,
      value,
      inputs: overrides,
      limits: Object.fromEntries(
        requirements.map(({ id, relation }) => [
          id,
          { bound: solved.constraints.get(id)!.bound, relation },
        ]),
      ),
      conditions: Object.fromEntries(
        requirements.map(({ id }) => [id, !!solved.constraints.get(id)?.pass]),
      ),
      pass: requirements.length
        ? requirements.every(({ id }) => solved.constraints.get(id)?.pass)
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
  return records;
}

export type DatasetState = Readonly<
  | { result: ReturnType<typeof evaluateDataset>; error?: never }
  | { result?: never; error: string }
>;
export type DatasetStates = Readonly<Record<string, DatasetState>>;
const emptyStates: DatasetStates = Object.freeze({});

// The public result key serializes bindings and scope in caller field order.
// Compare their JSON data exactly without serializing either side on a hit.
function sameMapping(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let i = 0; i < a.length; i++)
      if (
        Object.hasOwn(a, i) !== Object.hasOwn(b, i) ||
        !sameMapping(a[i], b[i])
      )
        return false;
    return true;
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.entries(a),
    right = Object.entries(b);
  return (
    left.length === right.length &&
    left.every(
      ([key, value], i) =>
        key === right[i][0] && sameMapping(value, right[i][1]),
    )
  );
}

/** Disposable derivation for one canvas (or its mapping preview). Keep only the
 * current relations, never a row cache indexed by every past page or mapping. */
export function createDatasetStatesSelector() {
  type Entry = {
    relation: DatasetComputation;
    source?: CsvData;
    model: ReturnType<typeof modelFor>;
    state: DatasetState;
  };
  let entries = new Map<string, Entry>(),
    worksheet: Projection | undefined,
    context: string | undefined,
    frozenInputs: readonly unknown[] | undefined,
    states = emptyStates;
  return (
    page: Page,
    relations: readonly DatasetComputation[] = page.dataRelations ?? [],
  ): DatasetStates => {
    const active = page.contexts.find((c) => c.id === page.active),
      inputs = [page.regions, page.links, active?.base, active?.overrides];
    // A layout edit can reuse the worksheet even if its bounded projection
    // cache has evicted it. Never trust identity for mutable caller input.
    const projection =
      !relations.length || !active
        ? undefined
        : sameJson(frozenInputs, inputs)
          ? worksheet
          : project(page);
    const sameWorksheet = !!projection && projection === worksheet,
      sameContext = context === page.active;
    worksheet = projection;
    context = page.active;
    frozenInputs = projection && deeplyFrozen(page) ? inputs : undefined;

    const next = new Map<string, Entry>();
    let changed = relations.length !== entries.size;
    for (const relation of relations) {
      const source = sourceFor(page, relation),
        prior = sameContext && entries.get(relation.id),
        sameRelation = prior && sameMapping(prior.relation, relation),
        model =
          sameRelation && sameWorksheet
            ? prior.model
            : modelFor(page, relation, page.active, projection);
      if (
        sameRelation &&
        sameJson(prior.source, source) &&
        sameJson(prior.model, model)
      ) {
        next.set(relation.id, prior);
        continue;
      }
      changed = true;
      let state: DatasetState;
      try {
        state = immutable({
          result: evaluateRelation(source, relation, page.active, model),
        });
      } catch (e) {
        state = Object.freeze({ error: (e as Error).message });
      }
      next.set(relation.id, {
        relation: deeplyFrozen(relation) ? relation : structuredClone(relation),
        source,
        model,
        state,
      });
    }
    entries = next;
    if (changed)
      states = Object.freeze(
        Object.fromEntries([...next].map(([id, e]) => [id, e.state])),
      );
    return states;
  };
}

/** Observations are evaluated as paired records, never points on a fixed-input sweep. */
export function measurementOverlay(
  page: Page,
  output: string,
  input: string,
  select = createDatasetStatesSelector(),
) {
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
  const relation: DatasetComputation = {
    id: "data-relation-overlay",
    dataset: source.dataset,
    output,
    bindings,
    scope: { kind: "all" },
    paired: true,
  };
  const { result, error } = select(page, [relation])[relation.id];
  if (!result) throw Error(error);
  return {
    ...result,
    dataset: source.dataset,
    column: source.column,
    input: p.statements.get(input)!.name,
  };
}
