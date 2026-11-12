/** Session recency is bounded attention. Explicitly kept snapshots are portable typed content. */
import { deeplyFrozen } from "./immutableJson.ts";
import * as f from "@manifold/foundation";
import { project, effective, type Page, type Projection } from "./document.ts";
import {
  mathSource,
  type MathSource,
  type Quantity,
} from "../notebook/math.ts";
import {
  validateSourceEvidence,
  type SourceEvidence,
} from "./resultSnapshot.ts";
export type WorksheetReceipt = Readonly<{
  id: string;
  version: 1 | 2;
  method: "manifold-worksheet/1" | "manifold-worksheet/2";
  validation: "not-assessed";
  origin: { document: string; root: string };
  context: string;
  contextLabel: string;
  key: string;
  definitions: MathSource[];
  links: Record<string, Record<string, string>>;
  sources: SourceEvidence[];
  unavailableSources: {
    region: string;
    dataset: string;
    row: number;
    column: number;
    raw: string;
    unit: string;
  }[];
  values: Record<string, Quantity>;
  errors: Record<string, string>;
  conditions: Record<string, { pass: boolean; bound: Quantity }>;
  time: string;
}>;
export type KeptCalculation = Readonly<{
  id: string;
  label: string;
  snapshot: WorksheetReceipt;
}>;
const plainQuantity = (q: Quantity): Quantity => ({
  value: q.value,
  dimension: q.dimension,
  ...(q.absolute !== undefined ? { absolute: q.absolute } : {}),
});
const quantities = (p: Projection) => ({
  values: Object.fromEntries(
    [...p.solved.values].map(([name, q]) => [name, plainQuantity(q)]),
  ),
  errors: Object.fromEntries(p.errors),
  conditions: Object.fromEntries(
    [...p.solved.constraints].map(([id, c]) => [
      id,
      { pass: c.pass, bound: plainQuantity(c.bound) },
    ]),
  ),
});
const key = (
  v: Pick<
    WorksheetReceipt,
    | "origin"
    | "context"
    | "definitions"
    | "links"
    | "sources"
    | "unavailableSources"
  > & { version?: 1 | 2 },
) =>
  f.canonical([
    v.version ?? 1,
    v.origin.document,
    v.context,
    v.definitions,
    v.links,
    v.sources,
    v.unavailableSources,
  ] as unknown as f.Json);
export function captureWorksheet(
  page: Page,
  document: f.Document,
  p = project(page),
): WorksheetReceipt {
  const definitions = effective(page)
      .filter((r) => p.kinds[r.id] !== "note")
      .map(mathSource),
    ids = new Set(definitions.map((r) => r.id)),
    links = Object.fromEntries(
      Object.entries(page.links ?? {}).filter(([id]) => ids.has(id)),
    ),
    sources: SourceEvidence[] = [],
    unavailableSources: WorksheetReceipt["unavailableSources"] = [];
  for (const region of page.regions.filter((r) => ids.has(r.id) && r.source)) {
    const source = region.source!,
      item = "region:" + source.dataset,
      revision = f.current(document, item);
    if (
      !revision ||
      !f.object(revision.body) ||
      !f.object(revision.body.value) ||
      !f.object(revision.body.value.data)
    ) {
      unavailableSources.push({ region: region.id, ...source });
      continue;
    }
    const evidence: SourceEvidence = {
      region: region.id,
      reference: {
        document: document.document,
        item,
        selection: { kind: "pin", revision: revision.id },
        selector: null,
      },
      row: source.row,
      column: source.column,
      raw: source.raw,
      unit: source.unit,
    };
    validateSourceEvidence(document, [evidence]);
    sources.push(evidence);
  }
  const version: 1 | 2 = definitions.some((r) => r.mathVersion === 2) ? 2 : 1;
  const data = {
    version,
    origin: { document: document.document, root: document.id },
    context: page.active,
    definitions,
    links,
    sources,
    unavailableSources,
  };
  return f.retained({
    id: `calculation-${crypto.randomUUID()}`,
    method: version === 2 ? "manifold-worksheet/2" : "manifold-worksheet/1",
    validation: "not-assessed",
    ...data,
    contextLabel: page.contexts.find((c) => c.id === page.active)!.label,
    key: key(data),
    ...quantities(p),
    time: new Date().toISOString(),
  } as unknown as f.Json) as unknown as WorksheetReceipt;
}
const validated = new WeakSet<object>();
/** Imported content is checked against the fixed worksheet/1 evaluator, never embedded code. */
export function validateWorksheetReceipt(
  value: unknown,
): asserts value is WorksheetReceipt {
  f.assert(f.object(value), "Invalid calculation snapshot");
  if (validated.has(value)) return;
  f.fields(value, [
    "id",
    "version",
    "method",
    "validation",
    "origin",
    "context",
    "contextLabel",
    "key",
    "definitions",
    "links",
    "sources",
    "unavailableSources",
    "values",
    "errors",
    "conditions",
    "time",
  ]);
  f.identity(value.id);
  f.identity(value.context);
  f.assert(f.object(value.origin), "Missing calculation origin");
  f.fields(value.origin, ["document", "root"]);
  f.identity(value.origin.document);
  f.identity(value.origin.root);
  f.assert(
    ((value.version === 1 && value.method === "manifold-worksheet/1") ||
      (value.version === 2 && value.method === "manifold-worksheet/2")) &&
      value.validation === "not-assessed" &&
      typeof value.contextLabel === "string" &&
      value.contextLabel.length < 100 &&
      typeof value.time === "string" &&
      Number.isFinite(Date.parse(value.time)),
    "Unsupported calculation snapshot",
  );
  f.assert(
    Array.isArray(value.definitions) &&
      value.definitions.length <= 256 &&
      value.definitions.every((v) => {
        f.assert(f.object(v), "Invalid calculation definition");
        f.fields(v, ["id", "text", "mathVersion"]);
        f.identity(v.id);
        return (
          typeof v.text === "string" &&
          v.text.length <= 5000 &&
          (v.mathVersion === undefined ||
            (value.version === 2 && v.mathVersion === 2))
        );
      }),
    "Invalid calculation definitions",
  );
  const ids = new Set(value.definitions.map((v) => (v as { id: string }).id));
  f.assert(
    ids.size === value.definitions.length &&
      f.object(value.links) &&
      Object.entries(value.links).every(
        ([id, links]) =>
          ids.has(id) &&
          f.object(links) &&
          Object.entries(links).every(
            ([name, target]) =>
              /^[A-Za-z_][A-Za-z_0-9]*$/.test(name) &&
              typeof target === "string",
          ),
      ),
    "Invalid calculation bindings",
  );
  f.assert(
    Array.isArray(value.sources) &&
      Array.isArray(value.unavailableSources) &&
      value.sources.length + value.unavailableSources.length <= 256,
    "Invalid calculation sources",
  );
  const seen = new Set<string>();
  for (const raw of [...value.sources, ...value.unavailableSources]) {
    f.assert(
      f.object(raw) &&
        typeof raw.region === "string" &&
        ids.has(raw.region) &&
        !seen.has(raw.region),
      "Invalid calculation source target",
    );
    seen.add(raw.region);
    const available = Object.hasOwn(raw, "reference");
    f.fields(
      raw,
      available
        ? ["region", "reference", "row", "column", "raw", "unit"]
        : ["region", "dataset", "row", "column", "raw", "unit"],
    );
    if (available) {
      f.validateReference(raw.reference);
      f.assert(
        raw.reference.selection.kind === "pin" &&
          raw.reference.selector === null,
        "Calculation sources must pin revisions",
      );
    } else f.identity(raw.dataset);
    f.assert(
      Number.isInteger(raw.row) &&
        Number(raw.row) >= 0 &&
        Number(raw.row) < 10000 &&
        Number.isInteger(raw.column) &&
        Number(raw.column) >= 0 &&
        Number(raw.column) < 12 &&
        typeof raw.raw === "string" &&
        raw.raw.length <= 200 &&
        typeof raw.unit === "string" &&
        raw.unit.length <= 80,
      "Invalid calculation source cell",
    );
  }
  const receipt = value as unknown as WorksheetReceipt;
  f.assert(
    receipt.key === key(receipt),
    "Calculation snapshot identity mismatch",
  );
  const p = project({
    regions: receipt.definitions,
    contexts: [
      {
        id: receipt.context,
        label: receipt.contextLabel,
        base: {},
        overrides: {},
      },
    ],
    active: receipt.context,
    links: receipt.links,
    plots: [],
    layout: {},
    origin: { x: 0, y: 0 },
  });
  f.assert(
    f.canonical(quantities(p) as unknown as f.Json) ===
      f.canonical({
        values: receipt.values,
        errors: receipt.errors,
        conditions: receipt.conditions,
      } as unknown as f.Json),
    "Calculation output differs from its captured definitions",
  );
  if (deeplyFrozen(value)) validated.add(value);
}
export function validateKeptCalculation(
  value: unknown,
): asserts value is KeptCalculation {
  f.assert(f.object(value), "Invalid kept calculation");
  f.fields(value, ["id", "label", "snapshot"]);
  f.identity(value.id);
  f.assert(
    typeof value.label === "string" &&
      value.label.trim().length > 0 &&
      value.label.length <= 160,
    "Name the kept calculation in 160 characters or fewer",
  );
  validateWorksheetReceipt(value.snapshot);
}
const sourceChecks = new WeakMap<WorksheetReceipt, readonly f.Revision[]>();
export function validateWorksheetSources(
  document: f.Document,
  receipt: WorksheetReceipt,
) {
  const records = receipt.sources.map((s) => {
    const got = f.resolve(document, s.reference);
    return got.status === "resolved" ? got.revision : undefined;
  });
  const old = sourceChecks.get(receipt);
  if (
    old &&
    old.length === records.length &&
    old.every((r, i) => r === records[i])
  )
    return;
  validateSourceEvidence(document, receipt.sources);
  if (deeplyFrozen(receipt) && records.every((r) => r && deeplyFrozen(r)))
    sourceChecks.set(receipt, records as f.Revision[]);
}
export const RECENT_LIMITS = Object.freeze({
  entries: 128,
  bytes: 8 * 1024 * 1024,
});
/** Counts serialized receipt bytes and unique retained source revisions; this is not heap usage. */
export class RecentCalculations {
  #entries: { receipt: WorksheetReceipt; bytes: number; sources: string[] }[] =
    [];
  #sources = new Map<
    string,
    { revision: f.Revision; bytes: number; uses: number }
  >();
  #weights = new WeakMap<object, number>();
  #bytes = 0;
  #version = 0;
  #omitted = 0;
  readonly limits: Readonly<{ entries: number; bytes: number }>;
  constructor(
    limits: Readonly<{ entries: number; bytes: number }> = RECENT_LIMITS,
  ) {
    this.limits = Object.freeze({ ...limits });
    f.assert(
      Number.isSafeInteger(limits.entries) &&
        limits.entries > 0 &&
        Number.isSafeInteger(limits.bytes) &&
        limits.bytes > 0,
      "Invalid recent-history limits",
    );
  }
  get version() {
    return this.#version;
  }
  get receipts(): readonly WorksheetReceipt[] {
    return Object.freeze(this.#entries.map((e) => e.receipt));
  }
  get references() {
    return this.#entries.flatMap((e) =>
      e.receipt.sources.map((s) => s.reference),
    );
  }
  get diagnostics() {
    return Object.freeze({
      version: this.#version,
      entries: this.#entries.length,
      bytes: this.#bytes,
      sources: this.#sources.size,
      omitted: this.#omitted,
    });
  }
  record(receipt: WorksheetReceipt, document: f.Document): boolean {
    if (!deeplyFrozen(receipt))
      receipt = f.retained(
        receipt as unknown as f.Json,
      ) as unknown as WorksheetReceipt;
    const duplicate = this.#entries.findIndex(
      (e) => e.receipt.key === receipt.key,
    );
    if (duplicate >= 0) {
      if (duplicate !== this.#entries.length - 1) {
        this.#entries.push(...this.#entries.splice(duplicate, 1));
        this.#version++;
      }
      return true;
    }
    const bytes = f.byteLength(f.canonical(receipt as unknown as f.Json)),
      sources = new Map<string, { revision: f.Revision; bytes: number }>();
    for (const source of receipt.sources) {
      const got = f.resolve(document, source.reference);
      f.assert(
        got.status === "resolved",
        "Recent calculation source is unavailable",
      );
      const id = source.reference.document + ":" + got.revision.id;
      let weight = this.#weights.get(got.revision);
      if (weight === undefined) {
        weight = f.byteLength(f.canonical(got.revision as unknown as f.Json));
        this.#weights.set(got.revision, weight);
      }
      sources.set(id, { revision: got.revision, bytes: weight });
    }
    if (
      bytes + [...sources.values()].reduce((n, s) => n + s.bytes, 0) >
      this.limits.bytes
    ) {
      this.#omitted++;
      this.#version++;
      return false;
    }
    for (const [id, source] of sources) {
      const old = this.#sources.get(id);
      if (old) old.uses++;
      else {
        this.#sources.set(id, { ...source, uses: 1 });
        this.#bytes += source.bytes;
      }
    }
    this.#entries.push({ receipt, bytes, sources: [...sources.keys()] });
    this.#bytes += bytes;
    while (
      this.#entries.length > this.limits.entries ||
      this.#bytes > this.limits.bytes
    ) {
      const removed = this.#entries.shift()!;
      this.#bytes -= removed.bytes;
      for (const id of removed.sources) {
        const source = this.#sources.get(id)!;
        if (!--source.uses) {
          this.#bytes -= source.bytes;
          this.#sources.delete(id);
        }
      }
    }
    this.#version++;
    return true;
  }
  clear() {
    if (this.#entries.length || this.#omitted) {
      this.#entries = [];
      this.#sources.clear();
      this.#bytes = 0;
      this.#omitted = 0;
      this.#version++;
    }
  }
}
