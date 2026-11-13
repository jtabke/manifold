/** Disposable worksheet derivation. Accepted state, history and persistence stay in the document. */
import {
  expressionBody,
  references,
  prepareCalculation,
  solvePrepared,
  type PreparedCalculation,
  type CalculationState,
  type Statement,
  type Solved,
  type Quantity,
  type MathVersion,
} from "../notebook/math.ts";
import { immutable, readMap } from "../notebook/immutable.ts";
import { deeplyFrozen } from "./immutableJson.ts";
import type { Page, Region, Plot } from "./document.ts";
export type Projection = Readonly<{
  solved: Solved;
  statements: ReadonlyMap<string, Statement>;
  errors: ReadonlyMap<string, string>;
  kinds: Readonly<
    Record<string, "note" | "quantity" | "equation" | "constraint" | "draft">
  >;
  bindings: Readonly<Record<string, Readonly<Record<string, string>>>>;
  sources: Readonly<Record<string, readonly string[]>>;
  texts: Readonly<Record<string, string>>;
}>;
export const mathematical = (text: string, mathVersion: MathVersion = 3) =>
  /^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(text) ||
  expressionBody(text, mathVersion) !== undefined;
const incompleteNumber = (text: string) =>
  /(?:^|[^A-Za-z_0-9.])(?:\d+\.(?!\d)|\d+(?:\.\d+)?[eE][+-]?(?![\dA-Za-z_]))(?=\s*(?:$|[)*/+^\-]|[A-Za-z]))/.test(
    text,
  );
export function effective(page: Page, context = page.active): Region[] {
  const c = page.contexts.find((c) => c.id === context)!;
  return page.regions.map((r) => ({
    ...r,
    text: c.overrides[r.id] ?? c.base[r.id] ?? r.text,
  }));
}
export const WORKSHEET_CACHE_LIMITS = Object.freeze({
  snapshots: 8,
  snapshotWeight: 8 * 1024 * 1024,
  rows: 1024,
  rowWeight: 2 * 1024 * 1024,
  curves: 4,
});
type Row = Readonly<{
  id: string;
  text: string;
  excluded: boolean;
  mathVersion: MathVersion;
  kind: Projection["kinds"][string];
  semantic?: PreparedCalculation;
  calculation?: PreparedCalculation;
  statement?: Statement;
  error?: string;
  source?: string;
  incomplete: boolean;
}>;
type Snapshot = {
  key: string;
  weight: number;
  rows: readonly Row[];
  state: CalculationState;
  projection: Projection;
  aliases: { page: WeakRef<Page>; context: string }[];
  semantic?: string;
  curves: Map<string, ReturnType<typeof sample>>;
};
function sample(
  p: Projection,
  state: CalculationState,
  rows: readonly PreparedCalculation[],
  plot: { input: string; output: string; low: number; high: number },
  count: (n: number) => void,
): {
  points: readonly Readonly<{
    x: number;
    y?: number;
    limit?: number;
    pass?: boolean;
  }>[];
  unit: Quantity | undefined;
} {
  const input = p.statements.get(plot.input),
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
    return immutable({
      points: [] as { x: number; y?: number; limit?: number; pass?: boolean }[],
      unit: undefined as Quantity | undefined,
    });
  const condition = [...p.statements].find(
    ([, s]) => s.name === output.name && s.relation !== "=",
  );
  let unit: Quantity | undefined;
  const points = Array.from({ length: 81 }, (_, i) => {
    const x = plot.low + ((plot.high - plot.low) * i) / 80;
    state = solvePrepared(
      rows,
      { [input.name]: { ...quantity, value: x } },
      state,
    );
    count(1);
    const result = state.solved,
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
  return immutable({ points, unit });
}
export function createWorksheetProjection() {
  const snapshots = new Map<string, Snapshot>(),
    prepared = new Map<string, { row: Row; weight: number }>();
  let snapshotWeight = 0,
    rowWeight = 0,
    scannedRows = 0,
    hits = 0,
    curveSamples = 0,
    builds = 0;
  const classify = (
    id: string,
    text: string,
    excluded: boolean,
    prior?: Row,
    mathVersion: MathVersion = 1,
  ): Row => {
    if (
      prior?.text === text &&
      prior.excluded === excluded &&
      prior.mathVersion === mathVersion
    )
      return prior;
    const key = JSON.stringify([id, text, excluded, mathVersion]),
      old = prepared.get(key);
    if (old) {
      prepared.delete(key);
      prepared.set(key, old);
      return old.row;
    }
    const row: {
      id: string;
      text: string;
      excluded: boolean;
      mathVersion: MathVersion;
      kind: Row["kind"];
      semantic?: PreparedCalculation;
      calculation?: PreparedCalculation;
      statement?: Statement;
      error?: string;
      source?: string;
      incomplete: boolean;
    } = { id, text, excluded, mathVersion, kind: "note", incomplete: false };
    if (!excluded && mathematical(text, mathVersion)) {
      row.semantic = prepareCalculation(id, text.trim(), mathVersion);
      row.incomplete = incompleteNumber(text);
      const s = row.semantic.statement;
      if (row.incomplete || !s) {
        row.kind = "draft";
        row.error = row.incomplete
          ? "Use a complete number before calculating; the draft is retained."
          : row.semantic.error;
        row.source = text.match(
          /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*(?::=|=(?!=))/,
        )?.[1];
        if (row.source)
          row.calculation = prepareCalculation(
            id,
            text.replace(/(?::=|<=|>=|<|>|=|≤|≥).*/, "= __unfinished_value"),
            mathVersion,
          );
      } else {
        row.statement = s;
        row.calculation = row.semantic;
        row.kind =
          s.relation !== "="
            ? "constraint"
            : s.anonymous || references(s.expression).length
              ? "equation"
              : "quantity";
        if (s.relation === "=") row.source = s.name;
      }
    }
    immutable(row);
    const weight = 512 + key.length * 96;
    if (weight <= WORKSHEET_CACHE_LIMITS.rowWeight) {
      prepared.set(key, { row, weight });
      rowWeight += weight;
      while (
        prepared.size > WORKSHEET_CACHE_LIMITS.rows ||
        rowWeight > WORKSHEET_CACHE_LIMITS.rowWeight
      ) {
        const first = prepared.keys().next().value!;
        rowWeight -= prepared.get(first)!.weight;
        prepared.delete(first);
      }
    }
    return row;
  };
  function get(page: Page, context = page.active): Snapshot {
    const frozen = deeplyFrozen(page);
    const touch = (s: Snapshot) => {
      snapshots.delete(s.key);
      snapshots.set(s.key, s);
    };
    if (frozen)
      for (const s of snapshots.values()) {
        const matched = s.aliases.some((a) => {
          const prior = a.page.deref();
          if (!prior) return false;
          if (prior === page && a.context === context) return true;
          const left = prior.contexts.find((c) => c.id === a.context),
            right = page.contexts.find((c) => c.id === context);
          return (
            prior.regions === page.regions &&
            prior.links === page.links &&
            !!left &&
            !!right &&
            left.base === right.base &&
            left.overrides === right.overrides
          );
        });
        if (matched) {
          hits++;
          s.aliases = [
            ...s.aliases.slice(-3),
            { page: new WeakRef(page), context },
          ];
          touch(s);
          return s;
        }
      }
    const c = page.contexts.find((c) => c.id === context)!;
    const selected = page.regions.map((r) => ({
      id: r.id,
      text: c.overrides[r.id] ?? c.base[r.id] ?? r.text,
      excluded: !!(r.data || r.external),
      mathVersion: (r.mathVersion ?? 1) as MathVersion,
    }));
    scannedRows += selected.length;
    const key = JSON.stringify([selected, page.links || {}]),
      old = snapshots.get(key);
    if (old) {
      hits++;
      if (frozen)
        old.aliases = [
          ...old.aliases.slice(-3),
          { page: new WeakRef(page), context },
        ];
      touch(old);
      return old;
    }
    builds++;
    const before = [...snapshots.values()].at(-1),
      byId = new Map(before?.rows.map((r) => [r.id, r]));
    const rows = selected.map((r) =>
        classify(r.id, r.text, r.excluded, byId.get(r.id), r.mathVersion),
      ),
      sources: Record<string, string[]> = Object.create(null),
      kinds: Record<string, Row["kind"]> = Object.create(null),
      texts: Record<string, string> = Object.create(null),
      statements = new Map<string, Statement>(),
      errors = new Map<string, string>(),
      bindings: Record<string, Record<string, string>> = Object.create(null);
    for (const row of rows) {
      kinds[row.id] = row.kind;
      texts[row.id] = row.text;
      if (row.source) (sources[row.source] ||= []).push(row.id);
      if (row.statement) statements.set(row.id, row.statement);
      if (row.error) errors.set(row.id, row.error);
    }
    const calculations: PreparedCalculation[] = [];
    for (const row of rows) {
      const s = row.statement;
      let linkError = false;
      if (s) {
        const used = [
          ...references(s.expression),
          ...(s.relation === "=" ? [] : [s.name]),
        ];
        const bound: Record<string, string> = Object.create(null);
        for (const name of used) {
          const target = page.links?.[row.id]?.[name];
          if (
            target &&
            (sources[name]?.length !== 1 ||
              sources[name][0] !== target ||
              statements.get(target)?.name !== name)
          ) {
            errors.set(
              row.id,
              `Linked ${name} is unavailable or ambiguous. Restore its definition or reconnect it.`,
            );
            linkError = true;
          }
          if (target || sources[name]?.length === 1)
            bound[name] = target || sources[name][0];
        }
        bindings[row.id] = Object.fromEntries(Object.entries(bound));
      }
      if (linkError)
        calculations.push(
          classify(
            row.id,
            row.text.replace(
              /(?::=|<=|>=|<|>|=|≤|≥).*/,
              `${s!.relation} (1/0)`,
            ),
            false,
            undefined,
            row.mathVersion,
          ).calculation!,
        );
      else if (row.calculation) calculations.push(row.calculation);
    }
    const state = solvePrepared(calculations, {}, before?.state),
      projection: Projection = Object.freeze({
        solved: state.solved,
        errors: readMap([...state.solved.errors, ...errors]),
        statements: readMap(statements),
        kinds: immutable(Object.fromEntries(Object.entries(kinds))),
        sources: immutable(Object.fromEntries(Object.entries(sources))),
        texts: immutable(Object.fromEntries(Object.entries(texts))),
        bindings: immutable(Object.fromEntries(Object.entries(bindings))),
      });
    const weight =
      1024 +
      key.length * 4 +
      rows.reduce((n, r) => n + 512 + r.text.length * 96, 0);
    const entry: Snapshot = {
      key,
      weight,
      rows,
      state,
      projection,
      aliases: frozen ? [{ page: new WeakRef(page), context }] : [],
      curves: new Map(),
    };
    if (weight <= WORKSHEET_CACHE_LIMITS.snapshotWeight) {
      snapshots.set(key, entry);
      snapshotWeight += weight;
      while (
        snapshots.size > WORKSHEET_CACHE_LIMITS.snapshots ||
        snapshotWeight > WORKSHEET_CACHE_LIMITS.snapshotWeight
      ) {
        const first = snapshots.keys().next().value!;
        snapshotWeight -= snapshots.get(first)!.weight;
        snapshots.delete(first);
      }
    }
    return entry;
  }
  return Object.freeze({
    project: (page: Page, context = page.active) =>
      get(page, context).projection,
    semanticKey(page: Page, context = page.active) {
      const entry = get(page, context);
      return (entry.semantic ||= JSON.stringify(
        entry.rows
          .filter((r) => r.kind !== "note")
          .map((r) => {
            const s = r.semantic?.statement;
            if (!s)
              return [
                r.id,
                r.text,
                ...(r.mathVersion > 1 ? [r.mathVersion] : []),
              ];
            return [
              r.id,
              s.name,
              s.relation,
              s.expression,
              r.incomplete,
              Object.entries(page.links?.[r.id] || {})
                .filter(([name]) =>
                  [
                    ...references(s.expression),
                    ...(s.relation !== "=" ? [s.name] : []),
                  ].includes(name),
                )
                .sort(([a], [b]) => a.localeCompare(b)),
              ...(s.mathVersion ? [s.mathVersion] : []),
            ];
          })
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
      ));
    },
    curve(
      page: Page,
      plot: { input: string; output: string; low: number; high: number },
      context = page.active,
    ) {
      const entry = get(page, context),
        key = JSON.stringify([plot.input, plot.output, plot.low, plot.high]),
        old = entry.curves.get(key);
      if (old) return old;
      const value = sample(
        entry.projection,
        entry.state,
        entry.rows.filter((r) => r.kind !== "note").map((r) => r.semantic!),
        plot,
        (n) => (curveSamples += n),
      );
      if (entry.curves.size >= WORKSHEET_CACHE_LIMITS.curves)
        entry.curves.delete(entry.curves.keys().next().value!);
      entry.curves.set(key, value);
      return value;
    },
    diagnostics: () =>
      Object.freeze({
        snapshots: snapshots.size,
        snapshotWeight,
        preparedRows: prepared.size,
        rowWeight,
        scannedRows,
        hits,
        builds,
        curveSamples,
      }),
    clear() {
      snapshots.clear();
      prepared.clear();
      snapshotWeight =
        rowWeight =
        scannedRows =
        hits =
        curveSamples =
        builds =
          0;
    },
  });
}
export const worksheetProjection = createWorksheetProjection();
export const project = worksheetProjection.project;
export const semanticKey = worksheetProjection.semanticKey;
export const curve = (page: Page, plot: Plot, context = page.active) =>
  worksheetProjection.curve(page, plot, context);
