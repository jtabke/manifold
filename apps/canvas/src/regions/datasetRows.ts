/** The same bounded evaluator runs inline and in the browser worker. No document or UI state. */
import {
  compileRowCalculation,
  prepareCalculation,
  same,
  type Quantity,
} from "../notebook/math.ts";
import { readCsv, measurementUnit, numericCell } from "./dataSources.ts";
import type {
  DatasetRequest,
  DatasetComputation,
  DataRecord,
} from "./datasetModel.ts";

export function calculateDatasetRows({
  source,
  relation,
  context,
  model,
}: DatasetRequest) {
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
  }: Exclude<DatasetRequest["model"], { error: string }>,
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
  const solveRow = compileRowCalculation(prepared);
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
    const solved = solveRow(overrides),
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

export function datasetOutcome(input: DatasetRequest) {
  try {
    return { result: calculateDatasetRows(input) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
