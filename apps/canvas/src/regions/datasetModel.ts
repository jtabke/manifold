/** Reviewed, row-aligned use of a structured source by an existing equation.
 * Arrays remain results of a relation; they never become scalar worksheet definitions.
 */
import { references, type Quantity, type Statement } from "../notebook/math.ts";
import { immutable } from "../notebook/immutable.ts";
import { project, type Page, type Projection } from "./document.ts";
import { deeplyFrozen, sameJson } from "./immutableJson.ts";
import type { CsvData } from "./dataSources.ts";
import { calculateDatasetRows, datasetOutcome } from "./datasetRows.ts";
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
  return calculateDatasetRows({
    source: sourceFor(page, relation),
    relation,
    context,
    model: modelFor(page, relation, context),
  });
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
export type DatasetRequest = Readonly<{
  relation: DatasetComputation;
  source?: CsvData;
  context: string;
  model: ReturnType<typeof modelFor>;
}>;
export type DatasetState = Readonly<
  | {
      result: ReturnType<typeof calculateDatasetRows>;
      error?: never;
      pending?: never;
    }
  | { result?: never; error: string; pending?: never }
  | { result?: never; error?: never; pending: true }
>;
export type DatasetStates = Readonly<Record<string, DatasetState>>;

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
export function createDatasetSelector<T>(derive: (input: DatasetRequest) => T) {
  type Entry = { input: DatasetRequest; state: T };
  let entries = new Map<string, Entry>(),
    worksheet: Projection | undefined,
    context: string | undefined,
    frozenInputs: readonly unknown[] | undefined,
    states: Readonly<Record<string, T>> = Object.freeze({});
  return (
    page: Page,
    relations: readonly DatasetComputation[] = page.dataRelations ?? [],
  ): Readonly<Record<string, T>> => {
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
        sameRelation = prior && sameMapping(prior.input.relation, relation),
        model =
          sameRelation && sameWorksheet
            ? prior.input.model
            : modelFor(page, relation, page.active, projection);
      if (
        sameRelation &&
        sameJson(prior.input.source, source) &&
        sameJson(prior.input.model, model)
      ) {
        next.set(relation.id, prior);
        continue;
      }
      changed = true;
      const input = immutable({
        relation: deeplyFrozen(relation) ? relation : structuredClone(relation),
        source,
        model,
        context: page.active,
      });
      next.set(relation.id, { input, state: derive(input) });
    }
    entries = next;
    if (changed)
      states = Object.freeze(
        Object.fromEntries([...next].map(([id, e]) => [id, e.state])),
      );
    return states;
  };
}

export function createDatasetStatesSelector() {
  return createDatasetSelector((input) => immutable(datasetOutcome(input)));
}

/** Check that a completed review still describes the exact mapping being accepted. */
export function matchesDatasetReview(
  page: Page,
  relation: DatasetComputation,
  checked: DatasetRequest,
) {
  return (
    checked.context === page.active &&
    sameMapping(checked.relation, relation) &&
    sameJson(checked.source, sourceFor(page, relation)) &&
    sameJson(checked.model, modelFor(page, relation, page.active))
  );
}

/** Observations are evaluated as paired records, never points on a fixed-input sweep. */
export function measurementMapping(page: Page, output: string, input: string) {
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
  return {
    relation,
    column: source.column,
    input: p.statements.get(input)!.name,
  };
}
export function measurementOverlay(
  page: Page,
  output: string,
  input: string,
  select = createDatasetStatesSelector(),
) {
  const mapping = measurementMapping(page, output, input);
  if (!mapping) return;
  const { relation, column, input: name } = mapping;
  const { result, error } = select(page, [relation])[relation.id];
  if (!result) throw Error(error);
  return { ...result, dataset: relation.dataset, column, input: name };
}
