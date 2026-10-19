/** A bounded authoring experiment over the existing arithmetic; not a new core model. */
import {
  calculate,
  parse,
  expressionBody,
  references,
  same,
  type Quantity,
  type Solved,
  type Statement,
} from "../notebook/math.ts";
import { readCsv, csvQuantity, type CsvData } from "./dataSources.ts";
import { evaluateDataset, type DatasetComputation } from "./datasetModel.ts";
import {
  validateExternalReference,
  type ExternalReference,
} from "./externalReference.ts";
import {
  modelParent,
  validateModels,
  validateModelPresentation,
  type NestedModel,
  type ModelAppearancePatch,
} from "./models.ts";
export type Point = { x: number; y: number };
export type Region = {
  id: string;
  text: string;
  label?: string;
  provisional?: boolean;
  requirement?: boolean;
  interfaceHidden?: boolean;
  displayUnit?: string;
  data?: CsvData;
  external?: ExternalReference;
  source?: {
    dataset: string;
    row: number;
    column: number;
    raw: string;
    unit: string;
  };
};
export type Context = {
  id: string;
  label: string;
  base: Record<string, string>;
  overrides: Record<string, string>;
};
export type Plot = {
  id: string;
  output: string;
  input: string;
  low: number;
  high: number;
  width: number;
  height: number;
  at?: Point;
};
export type Page = {
  regions: Region[];
  contexts: Context[];
  active: string;
  layout: Record<string, Point>;
  plots: Plot[];
  origin: Point;
  links?: Record<string, Record<string, string>>;
  dataRelations?: DatasetComputation[];
  models?: NestedModel[];
};
export type ConnectionEdit = {
  source: string;
  target: string;
  kind: "compute" | "constrain" | "reference";
  text: string;
  alias: string;
  context: string;
  key: string;
  label: string;
};
export type Projection = {
  solved: Solved;
  statements: Map<string, Statement>;
  errors: Map<string, string>;
  kinds: Record<
    string,
    "note" | "quantity" | "equation" | "constraint" | "draft"
  >;
  bindings: Record<string, Record<string, string>>;
  sources: Record<string, string[]>;
  texts: Record<string, string>;
};
export type Receipt = {
  id: string;
  context: string;
  key: string;
  definitions: Region[];
  values: Record<string, Quantity>;
  errors: Record<string, string>;
  conditions: Record<string, { pass: boolean; bound: Quantity }>;
  time: string;
};
const clone = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const mathematical = (text: string) =>
  /^\s*[A-Za-z_][A-Za-z_0-9]*\s*(?::=|<=|>=|<|>|=|≤|≥)/.test(text) ||
  expressionBody(text) !== undefined;
// An unused writing cursor is presentation, not authored content. Retain any
// region that still has a definition in another context or a native plot binding.
function withoutEmpty(page: Page, retained: readonly string[] = []): Page {
  const next = clone(page);
  const empty = new Set(
    next.regions
      .filter(
        (r) =>
          !retained.includes(r.id) &&
          !Object.values(next.links || {}).some((bindings) =>
            Object.values(bindings).includes(r.id),
          ) &&
          !r.text.trim() &&
          next.contexts.every(
            (c) =>
              !(c.base[r.id] || "").trim() && !(c.overrides[r.id] || "").trim(),
          ) &&
          !next.plots.some((p) => p.input === r.id || p.output === r.id),
      )
      .map((r) => r.id),
  );
  if (!empty.size) return page;
  next.regions = next.regions.filter((r) => !empty.has(r.id));
  for (const m of next.models || []) {
    m.members = m.members.filter((id) => !empty.has(id));
    m.inputs = m.inputs.filter((id) => !empty.has(id));
    m.outputs = m.outputs.filter((id) => !empty.has(id));
  }
  for (const id of empty) {
    delete next.layout[id];
    if (next.links) delete next.links[id];
    for (const c of next.contexts) {
      delete c.base[id];
      delete c.overrides[id];
    }
  }
  if (!next.regions.length) next.origin = { x: 110, y: 110 };
  return next;
}
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
export function project(page: Page, context = page.active): Projection {
  const regions = effective(page, context),
    statements = new Map<string, Statement>(),
    kinds: Projection["kinds"] = {},
    sources: Projection["sources"] = {};
  const drafts = new Map<string, string>();
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
      drafts.set(r.id, (e as Error).message);
      const definition = r.text.match(
        /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*(?::=|=(?!=))/,
      );
      if (definition) (sources[definition[1]] ||= []).push(r.id);
    }
  }
  const linkErrors = new Map<string, string>();
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
            `${statements.get(r.id)!.relation} (1/0)`,
          )
        : drafts.has(r.id)
          ? r.text.replace(/(?::=|<=|>=|<|>|=|≤|≥).*/, "= __unfinished_value")
          : r.text.trim(),
    }));
  const solved = calculate(calculations),
    errors = new Map([...solved.errors, ...drafts, ...linkErrors]);
  const bindings: Projection["bindings"] = {};
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
/** A reviewed binding may resolve one input while other authored inputs remain missing. */
export function remainsUnresolved(
  before: Projection,
  after: Projection,
  target: string,
): boolean {
  const missing = (value: string | undefined) =>
    !!value &&
    /^Define [A-Za-z_][A-Za-z_0-9]* with a value and units\.$/.test(value);
  return (
    before.kinds[target] === "equation" &&
    missing(before.errors.get(target)) &&
    missing(after.errors.get(target))
  );
}
export function semanticKey(page: Page, context = page.active): string {
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
export function positions(page: Page): Record<string, Point> {
  let y = page.origin.y;
  const out: Record<string, Point> = {};
  for (const r of page.regions) {
    if (page.layout[r.id]) out[r.id] = page.layout[r.id];
    else {
      out[r.id] = { x: page.origin.x, y };
    }
    // Moving one region leaves the other authored lines in their flow slots.
    y += Math.max(92, 65 + (r.text.split("\n").length - 1) * 25);
  }
  for (const plot of page.plots)
    out[plot.id] = plot.at || {
      x: (out[plot.output]?.x || page.origin.x) + 555,
      y: out[plot.output]?.y || page.origin.y,
    };
  for (const relation of page.dataRelations || [])
    out[relation.id] = page.layout[relation.id] || { x: 650, y: 420 };
  return out;
}
export function ancestors(p: Projection, id: string): string[] {
  const result = new Set<string>(),
    visit = (current: string) => {
      for (const ref of Object.values(p.bindings[current] || {}))
        if (!result.has(ref)) {
          result.add(ref);
          visit(ref);
        }
    };
  visit(id);
  return [...result];
}
export function curve(
  page: Page,
  plot: Plot,
  context: string,
): {
  points: { x: number; y?: number; limit?: number; pass?: boolean }[];
  unit: Quantity | undefined;
} {
  const p = project(page, context),
    input = p.statements.get(plot.input),
    output = p.statements.get(plot.output);
  const quantity = input && p.solved.values.get(input.name);
  if (
    !input ||
    !output ||
    !quantity ||
    p.errors.has(plot.input) ||
    p.errors.has(plot.output) ||
    p.sources[input.name]?.length !== 1
  )
    return {
      points: [] as { x: number; y?: number; limit?: number; pass?: boolean }[],
      unit: undefined as Quantity | undefined,
    };
  const condition = [...p.statements].find(
    ([, s]) => s.name === output.name && s.relation !== "=",
  );
  const calculations = effective(page, context)
    .filter((r) => p.kinds[r.id] !== "note")
    .map((r) => ({ ...r, x: 0, y: 0 }));
  let unit: Quantity | undefined;
  const points = Array.from({ length: 81 }, (_, i) => {
    const x = plot.low + ((plot.high - plot.low) * i) / 80;
    const result = calculate(calculations, {
      [input.name]: { ...quantity, value: x },
    });
    const q = result.values.get(output.name);
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
export class RegionSession {
  state: Page = freeze({
    regions: [],
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: {},
    plots: [],
    origin: { x: 110, y: 110 },
  });
  receipts: Receipt[] = [];
  private past: { page: Page; undo?: () => void }[] = [];
  private listeners = new Set<() => void>();
  private serial = 0;
  private retainedRegions: () => string[];
  constructor(initial?: Page, retainedRegions: () => string[] = () => []) {
    this.retainedRegions = retainedRegions;
    if (initial) {
      this.state = freeze(clone(withoutEmpty(initial, this.retainedRegions())));
      this.serial = Math.max(
        0,
        ...[
          ...initial.regions.map((r) => r.id),
          ...initial.plots.map((p) => p.id),
          ...initial.contexts.map((c) => c.id),
          ...(initial.dataRelations || []).map((r) => r.id),
        ].map((id) =>
          Number(
            id.match(
              /^(?:region|plot|alternative|data-relation)-(\d+)$/,
            )?.[1] || 0,
          ),
        ),
      );
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  private apply(next: Page, evaluate = false, undo?: () => void) {
    this.past.push({ page: this.state, undo });
    this.state = freeze(next);
    if (evaluate) this.evaluate();
    else this.emit();
  }
  get canUndo() {
    return this.past.length > 0;
  }
  create(at?: Point, scope?: string): string {
    if (scope && !at) {
      const current = positions(this.state),
        members = this.state.models?.find((m) => m.id === scope)?.members || [];
      const last = this.state.regions
        .filter((r) => members.includes(r.id))
        .at(-1);
      at = last
        ? { x: current[last.id].x, y: current[last.id].y + 92 }
        : { x: 110, y: 130 };
    }
    const next = clone(this.state),
      id = `region-${++this.serial}`;
    if (!next.regions.length && at) next.origin = at;
    else if (at) next.layout[id] = at;
    next.regions.push({ id, text: "" });
    if (scope) next.models?.find((m) => m.id === scope)?.members.push(id);
    this.apply(next);
    return id;
  }
  importData(name: string, csv: string, at: Point, scope?: string): string {
    const data = { name, csv };
    readCsv(data);
    if (this.state.regions.length >= 256)
      throw Error("This page supports up to 256 regions.");
    const next = clone(this.state),
      id = `region-${++this.serial}`;
    next.regions.push({ id, text: `Data · ${name}`, data });
    next.layout[id] = at;
    if (scope) next.models?.find((m) => m.id === scope)?.members.push(id);
    this.apply(next);
    return id;
  }
  reference(
    name: string,
    external: ExternalReference,
    at: Point,
    scope?: string,
    existing?: string,
  ): string {
    validateExternalReference(external);
    external = {
      url: external.url,
      ...(external.revision ? { revision: external.revision } : {}),
    };
    if (!name.trim() || name.length > 160)
      throw Error("Name the source in 160 characters or fewer.");
    const next = clone(this.state);
    if (existing) {
      const region = next.regions.find((r) => r.id === existing && r.external);
      if (!region) throw Error("This reference no longer exists.");
      region.label = name;
      region.external = clone(external);
      this.apply(next);
      return region.id;
    }
    if (next.regions.length >= 256)
      throw Error("This page supports up to 256 regions.");
    const id = `region-${++this.serial}`;
    next.regions.push({
      id,
      text: `Source · ${name}`,
      label: name,
      external: clone(external),
    });
    next.layout[id] = at;
    if (scope) next.models?.find((m) => m.id === scope)?.members.push(id);
    this.apply(next);
    return id;
  }
  quantityFromCell(
    dataset: string,
    row: number,
    column: number,
    name: string,
    unit: string,
    at: Point,
  ): string {
    const data = this.state.regions.find((r) => r.id === dataset)?.data;
    if (!data) throw Error("This data source is unavailable.");
    if (project(this.state).sources[name]?.length)
      throw Error("That quantity already exists; choose a distinct name.");
    if (this.state.regions.length >= 256)
      throw Error("This page supports up to 256 regions.");
    const value = csvQuantity(data, row, column, name, unit),
      next = clone(this.state),
      id = `region-${++this.serial}`;
    next.regions.push({
      id,
      text: value.text,
      source: { dataset, row, column, raw: value.raw, unit: value.unit },
    });
    next.layout[id] = at;
    next.models
      ?.find((m) => m.id === modelParent(next, dataset))
      ?.members.push(id);
    this.apply(next, true);
    return id;
  }
  bindDataset(binding: DatasetComputation, at?: Point): string {
    evaluateDataset(this.state, binding);
    if ((this.state.dataRelations?.length || 0) >= 16)
      throw Error("This experiment supports up to 16 dataset relationships.");
    const next = clone(this.state),
      id = `data-relation-${++this.serial}`;
    (next.dataRelations ||= []).push({ ...clone(binding), id });
    next.layout[id] = at || { x: 650, y: 420 };
    next.models
      ?.find((m) => m.id === modelParent(next, binding.output))
      ?.members.push(id);
    this.apply(next);
    return id;
  }
  removeDataset(id: string) {
    const next = clone(this.state);
    next.dataRelations = next.dataRelations?.filter((r) => r.id !== id);
    delete next.layout[id];
    for (const model of next.models || []) {
      model.members = model.members.filter((m) => m !== id);
      model.inputs = model.inputs.filter((m) => m !== id);
      model.outputs = model.outputs.filter((m) => m !== id);
    }
    this.apply(next);
  }
  discardEmpty() {
    const retained = this.retainedRegions();
    const next = withoutEmpty(this.state, retained);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = freeze(next);
    // Undo restores authored work, never abandoned cursors. Preserve snapshots
    // containing text so erasing a real note or equation remains reversible.
    this.past = this.past
      .map((p) => ({ ...p, page: freeze(withoutEmpty(p.page, retained)) }))
      .filter(
        (p, i, all) =>
          !!p.undo ||
          JSON.stringify(p.page) !== JSON.stringify(all[i + 1]?.page || next),
      );
    this.emit();
  }
  write(
    id: string,
    text: string,
    continueBelow = false,
    bindings?: Record<string, string>,
  ): { ok: boolean; error?: string; next?: string } {
    if (text.length > 5000)
      return { ok: false, error: "Keep this region under 5,000 characters." };
    const next = clone(this.state),
      region = next.regions.find((r) => r.id === id);
    if (!region) return { ok: false, error: "This region no longer exists." };
    const context = next.contexts.find((c) => c.id === next.active)!;
    const unchanged = effective(next).find((r) => r.id === id)?.text === text;
    if (
      !unchanged &&
      context.id !== "original" &&
      !!effective(next)
        .find((r) => r.id === id)
        ?.text.trim() &&
      (mathematical(text) ||
        mathematical(effective(next).find((r) => r.id === id)?.text || ""))
    ) {
      const p = project(next);
      const before = p.statements.get(id);
      try {
        const after = parse(text.trim(), id),
          original = before && p.solved.values.get(before.name);
        const linkedBefore =
          before?.expression.kind === "name" &&
          next.links?.[id]?.[before.expression.name];
        const linkedAfter =
          after.expression.kind === "name" &&
          (bindings?.[after.expression.name] ||
            next.links?.[id]?.[after.expression.name]);
        if (
          !before ||
          before.relation !== "=" ||
          (references(before.expression).length && !linkedBefore) ||
          after.name !== before.name ||
          after.relation !== "=" ||
          (references(after.expression).length && !linkedAfter)
        )
          throw Error(
            "This alternative changes assigned assumptions. Edit shared relationships in Original.",
          );
        let q: Quantity | undefined;
        if (linkedAfter) {
          context.overrides[id] = text;
          (next.links ||= {})[id] = { ...next.links?.[id], ...bindings };
          const trial = project(next);
          if (trial.errors.has(id)) throw Error(trial.errors.get(id));
          q = trial.solved.values.get(after.name);
        } else
          q = calculate([{ id, text: text.trim(), x: 0, y: 0 }]).values.get(
            after.name,
          );
        if (
          !q ||
          !original ||
          !same(q.dimension, original.dimension) ||
          !!q.absolute !== !!original.absolute
        )
          throw Error(
            "Keep the assumption's quantity and unit dimensions. The original is unchanged.",
          );
        context.overrides[id] = text;
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    } else if (!unchanged) {
      region.text = text;
      // Original definitions are authoritative. Imported snapshots must not
      // silently mask a later accepted edit; alternative snapshots stay intact.
      if (context.id === "original") {
        delete context.base[id];
        delete context.overrides[id];
      }
    }
    if (bindings)
      (next.links ||= {})[id] = { ...next.links?.[id], ...clone(bindings) };
    try {
      const after = parse(text, id);
      const before = project(this.state).statements.get(id);
      if (
        context.id === "original" &&
        before?.relation === "=" &&
        after.relation === "=" &&
        before.name !== after.name
      ) {
        const previous = project(this.state);
        if (previous.sources[after.name]?.some((source) => source !== id))
          return {
            ok: false,
            error: `A definition named ${after.name} already exists. Choose another name.`,
          };
        const replace = (value: string, from: string) =>
          value.replace(
            new RegExp(`(?<![A-Za-z_0-9])${from}(?![A-Za-z_0-9])`, "g"),
            after.name,
          );
        for (const r of next.regions) {
          const aliases = new Set(
            Object.entries({
              ...previous.bindings[r.id],
              ...this.state.links?.[r.id],
            })
              .filter(([, source]) => source === id)
              .map(([name]) => name),
          );
          for (const alias of aliases) {
            if (r.id !== id) r.text = replace(r.text, alias);
            const links = ((next.links ||= {})[r.id] ||= {});
            delete links[alias];
            links[after.name] = id;
            for (const c of next.contexts)
              for (const entries of [c.base, c.overrides])
                if (entries[r.id])
                  entries[r.id] = replace(entries[r.id], alias);
          }
        }
        for (const c of next.contexts)
          for (const entries of [c.base, c.overrides])
            if (entries[id]) entries[id] = replace(entries[id], before.name);
      }
    } catch {
      /* Unfinished source keeps its bindings until it can be parsed again. */
    }
    let nextId: string | undefined;
    if (continueBelow && text.trim()) {
      const index = next.regions.findIndex((r) => r.id === id);
      if (
        next.regions[index + 1]?.text === "" &&
        modelParent(next, next.regions[index + 1].id) === modelParent(next, id)
      )
        nextId = next.regions[index + 1].id;
      else {
        nextId = `region-${++this.serial}`;
        next.regions.splice(index + 1, 0, { id: nextId, text: "" });
      }
      if (next.layout[id])
        next.layout[nextId] = {
          x: next.layout[id].x,
          y:
            next.layout[id].y +
            Math.max(92, 65 + (text.split("\n").length - 1) * 25),
        };
      if (next.layout[id]) {
        const below = next.layout[nextId],
          scope = modelParent(next, id),
          current = positions(this.state);
        const column = this.state.regions.filter(
          (r) =>
            r.id !== id &&
            modelParent(this.state, r.id) === scope &&
            Math.abs(current[r.id].x - below.x) < 80 &&
            current[r.id].y >= below.y,
        );
        if (column.some((r) => current[r.id].y < below.y + 92))
          for (const r of column)
            next.layout[r.id] = { ...current[r.id], y: current[r.id].y + 92 };
      }
      if (nextId && !next.models?.some((m) => m.members.includes(nextId!)))
        next.models
          ?.find((m) => m.id === modelParent(next, id))
          ?.members.push(nextId);
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.state);
    if (changed)
      this.apply(next, semanticKey(next) !== semanticKey(this.state));
    if (!text.trim()) this.discardEmpty();
    return { ok: true, next: nextId };
  }
  connect(
    edit: ConnectionEdit,
    undo?: () => void,
  ): { ok: boolean; error?: string } {
    try {
      if (
        edit.context !== this.state.active ||
        edit.key !== semanticKey(this.state)
      )
        throw Error("The model changed. Review this connection again.");
      const before = project(this.state),
        source = before.statements.get(edit.source),
        target = before.statements.get(edit.target);
      if (
        !source ||
        !target ||
        source.relation !== "=" ||
        before.errors.has(edit.source) ||
        before.sources[source.name]?.length !== 1 ||
        edit.source === edit.target
      )
        throw Error("Choose a resolved, unambiguous source.");
      if (ancestors(before, edit.source).includes(edit.target))
        throw Error(
          "This source already depends on the target; the link would create a cycle.",
        );
      const next = clone(this.state),
        c = next.contexts.find((v) => v.id === next.active)!;
      if (c.id === "original")
        next.regions.find((r) => r.id === edit.target)!.text = edit.text;
      else c.overrides[edit.target] = edit.text;
      const parsed = parse(edit.text);
      if (
        edit.alias !== source.name ||
        (parsed.relation === "=" && parsed.name !== target.name)
      )
        throw Error("The proposed reference no longer matches its objects.");
      (next.links ||= {})[edit.target] = {
        ...next.links?.[edit.target],
        [edit.alias]: edit.source,
      };
      const after = project(next),
        q = before.solved.values.get(target.name),
        replacement = after.solved.values.get(parsed.name);
      if (
        after.errors.has(edit.target) &&
        !remainsUnresolved(before, after, edit.target)
      )
        throw Error(after.errors.get(edit.target));
      if (
        parsed.relation === "=" &&
        q &&
        replacement &&
        (!same(q.dimension, replacement.dimension) ||
          !!q.absolute !== !!replacement.absolute)
      )
        throw Error("The connection has incompatible units.");
      for (const [id, error] of after.errors)
        if (
          !before.errors.has(id) &&
          ancestors(after, id).includes(edit.target)
        )
          throw Error(error);
      this.apply(next, semanticKey(next) !== semanticKey(this.state), undo);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  evaluate() {
    const p = project(this.state),
      key = semanticKey(this.state);
    this.receipts = [
      ...this.receipts,
      freeze({
        id: `calculation-${++this.serial}`,
        context: this.state.active,
        key,
        definitions: effective(this.state),
        values: Object.fromEntries(p.solved.values),
        errors: Object.fromEntries(p.errors),
        conditions: Object.fromEntries(
          [...p.solved.constraints].map(([id, c]) => [
            id,
            { pass: c.pass, bound: c.bound },
          ]),
        ),
        time: new Date().toISOString(),
      }),
    ];
    this.emit();
  }
  addPlot(output: string, input: string): string {
    const p = project(this.state),
      s = p.statements.get(input),
      value = s && p.solved.values.get(s.name);
    if (!value || !ancestors(p, output).includes(input))
      throw Error("Choose a resolved assigned quantity used by this equation.");
    if (references(s!.expression).length)
      throw Error(
        "This sweep varies an assigned quantity, not a computed output.",
      );
    const next = clone(this.state),
      id = `plot-${++this.serial}`;
    const center = value.value,
      delta = Math.abs(center) * 0.65 || 1;
    const sourceY = positions(next)[output].y;
    const occupied = next.plots.filter(
      (plot) => Math.abs(positions(next)[plot.id].y - sourceY) < 320,
    ).length;
    next.plots.push({
      id,
      output,
      input,
      low: center - delta,
      high: center + delta,
      width: 500,
      height: 325,
      ...(occupied
        ? { at: { x: next.origin.x + 555, y: sourceY + occupied * 345 } }
        : {}),
    });
    next.models
      ?.find((m) => m.id === modelParent(next, output))
      ?.members.push(id);
    this.apply(next);
    return id;
  }
  branch(): string {
    const next = clone(this.state),
      p = project(next),
      base: Record<string, string> = {};
    for (const r of effective(next))
      if (p.kinds[r.id] === "quantity" && !p.errors.has(r.id))
        base[r.id] = r.text;
    const id = `alternative-${++this.serial}`;
    next.contexts.push({
      id,
      label: `Alternative ${next.contexts.length}`,
      base,
      overrides: {},
    });
    next.active = id;
    this.apply(next, true);
    return id;
  }
  switchContext(id: string) {
    if (!this.state.contexts.some((c) => c.id === id)) return;
    const next = clone(this.state);
    next.active = id;
    this.apply(next);
  }
  branchEdit(input: string, before: Page): string {
    const current = project(this.state),
      baseline = project(before);
    const prior = baseline.statements.get(input),
      assigned = current.statements.get(input);
    const q = assigned && current.solved.values.get(assigned.name);
    const previous = prior && baseline.solved.values.get(prior.name);
    if (
      before.active !== this.state.active ||
      !q ||
      !previous ||
      current.kinds[input] !== "quantity" ||
      baseline.kinds[input] !== "quantity" ||
      assigned!.name !== prior!.name ||
      !same(q.dimension, previous.dimension) ||
      !!q.absolute !== !!previous.absolute ||
      JSON.stringify(effective(before).filter((r) => r.id !== input)) !==
        JSON.stringify(effective(this.state).filter((r) => r.id !== input))
    )
      throw Error(
        "The model changed; compare only the compatible quantity edit just made.",
      );
    const next = clone(this.state),
      text = current.texts[input];
    const source = next.contexts.find((c) => c.id === next.active)!;
    if (source.id === "original")
      next.regions.find((r) => r.id === input)!.text = baseline.texts[input];
    else {
      const earlier = before.contexts.find((c) => c.id === before.active)!;
      source.base = clone(earlier.base);
      source.overrides = clone(earlier.overrides);
    }
    const p = project(next),
      base: Record<string, string> = {};
    for (const r of effective(next))
      if (p.kinds[r.id] === "quantity" && !p.errors.has(r.id))
        base[r.id] = r.text;
    const id = `alternative-${++this.serial}`;
    next.contexts.push({
      id,
      label: `Alternative ${next.contexts.length}`,
      base,
      overrides: { [input]: text },
    });
    next.active = id;
    this.apply(next, true);
    return id;
  }
  move(id: string, at: Point) {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    const next = clone(this.state),
      plot = next.plots.find((p) => p.id === id);
    if (plot) plot.at = at;
    else next.layout[id] = at;
    this.apply(next);
  }
  makeModel(model: NestedModel, at: Point, representations: string[] = []) {
    if (
      this.state.models?.some((m) => m.id === model.id) ||
      !model.name.trim() ||
      !model.members.length
    )
      throw Error("Choose content and a model name.");
    const parents = new Set(
      model.members.map((id) => modelParent(this.state, id)),
    );
    if (parents.size !== 1)
      throw Error("Choose content from one working scope.");
    const next = clone(this.state),
      parent = [...parents][0];
    const owner = next.models?.find((m) => m.id === parent);
    if (owner)
      owner.members = [
        ...owner.members.filter((id) => !model.members.includes(id)),
        model.id,
      ];
    (next.models ||= []).push(clone(model));
    // Freeze existing coordinates at the scope boundary. Subsequent writing
    // flows within its owner instead of shifting another model's worksheet.
    const current = positions(this.state);
    for (const r of next.regions) next.layout[r.id] = { ...current[r.id] };
    for (const p of next.plots) p.at = { ...current[p.id] };
    next.layout[model.id] = at;
    validateModels(next, representations);
    this.apply(next);
  }
  addModelMember(model: string | undefined, id: string) {
    if (!model || modelParent(this.state, id)) return;
    const next = clone(this.state),
      target = next.models?.find((m) => m.id === model);
    if (target) {
      target.members.push(id);
      this.apply(next);
    }
  }
  exposeModel(id: string, inputs: string[], outputs: string[], name?: string) {
    const next = clone(this.state),
      model = next.models?.find((m) => m.id === id);
    if (model) {
      if (name?.trim()) model.name = name.trim().slice(0, 80);
      model.inputs = [...inputs];
      model.outputs = [...outputs];
      if (
        model.presentation?.primaryOutput &&
        !outputs.includes(model.presentation.primaryOutput)
      )
        delete model.presentation.primaryOutput;
      if (
        model.presentation?.exploreInput &&
        !inputs.includes(model.presentation.exploreInput)
      )
        delete model.presentation.exploreInput;
      this.apply(next);
    }
  }
  styleModel(id: string, patch: ModelAppearancePatch) {
    const next = clone(this.state),
      model = next.models?.find((m) => m.id === id);
    if (!model) return;
    model.presentation = { ...model.presentation, ...patch };
    if (
      model.presentation.exterior?.source === undefined &&
      model.presentation.exterior
    )
      delete model.presentation.exterior.source;
    validateModelPresentation(model);
    this.apply(next);
  }
  arrange(
    placements: Record<string, Point>,
    checkpoint = false,
    undo?: () => void,
  ) {
    if (Object.values(placements).some((p) => !Number.isFinite(p.x + p.y)))
      return;
    const next = clone(this.state);
    for (const [id, at] of Object.entries(placements)) {
      const plot = next.plots.find((p) => p.id === id);
      if (plot) plot.at = at;
      else if (
        next.regions.some((r) => r.id === id) ||
        next.dataRelations?.some((r) => r.id === id) ||
        next.models?.some((m) => m.id === id)
      )
        next.layout[id] = at;
    }
    // A whole calculation arranged in one column remains a writing flow,
    // rather than turning each equation into a fixed obstacle to Enter.
    const column = next.regions
      .filter((r) => placements[r.id])
      .sort((a, b) => placements[a.id].y - placements[b.id].y);
    if (
      column.length &&
      column.length === next.regions.length &&
      column.every((r) => placements[r.id].x === placements[column[0].id].x)
    ) {
      next.origin = placements[column[0].id];
      next.regions = column;
      for (const r of column) delete next.layout[r.id];
    }
    if (checkpoint || JSON.stringify(next) !== JSON.stringify(this.state))
      this.apply(next, false, undo);
  }
  resize(id: string, width: number, height: number) {
    const next = clone(this.state),
      plot = next.plots.find((p) => p.id === id);
    if (!plot || !Number.isFinite(width + height)) return;
    plot.width = Math.max(320, Math.min(1100, width));
    plot.height = Math.max(240, Math.min(750, height));
    this.apply(next);
  }
  stack() {
    const next = clone(this.state);
    next.layout = {};
    this.apply(next);
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.state = freeze(withoutEmpty(previous.page, this.retainedRegions()));
      previous.undo?.();
      this.emit();
    }
  }
}
