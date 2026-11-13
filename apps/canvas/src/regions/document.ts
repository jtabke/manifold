import { documentTitle } from "./documentTitle.ts";
import {
  project,
  effective,
  semanticKey,
  mathematical,
  type Projection,
} from "./worksheetProjection.ts";
export {
  project,
  effective,
  semanticKey,
  curve,
  type Projection,
} from "./worksheetProjection.ts";
import { sameJson } from "./immutableJson.ts";
import { PageEdit } from "./pageEdits.ts";
import { readScene, sceneCommands } from "./sceneRecords.ts";
import type { CanvasScene } from "./canvasScene.ts";
/** Compatibility authoring commands over the existing arithmetic; accepted Page/history live in the foundation owner. */
import {
  calculate,
  parse,
  references,
  same,
  type Quantity,
} from "../notebook/math.ts";
import { CanvasDocument, type CanvasRecovery } from "./app/canvasDocument.ts";
import {
  createTaskScheduler,
  type Command,
  type Reference,
  type Revision,
  type View,
  type Scope,
} from "@manifold/foundation";
import { type Artifact } from "./artifacts.ts";
import {
  createArtifactComputations,
  type ArtifactExecutor,
} from "./artifactComputations.ts";
import {
  RecentCalculations,
  captureWorksheet,
  type WorksheetReceipt,
  type KeptCalculation,
} from "./worksheetHistory.ts";
import {
  positions,
  regionAdvance,
  freeRegionPosition,
  REGION_STEP,
} from "./pageLayout.ts";
export { positions } from "./pageLayout.ts";
import type { Document as FoundationDocument } from "@manifold/foundation";
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
  mathVersion?: 2 | 3;
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
  title?: string;
  regions: Region[];
  contexts: Context[];
  active: string;
  layout: Record<string, Point>;
  plots: Plot[];
  origin: Point;
  links?: Record<string, Record<string, string>>;
  dataRelations?: DatasetComputation[];
  models?: NestedModel[];
  calculations?: KeptCalculation[];
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
export type Receipt = WorksheetReceipt;

const clone = <T>(value: T): T => structuredClone(value);
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
// An unused writing cursor is presentation, not authored content. Retain any
// region that still has a definition in another context or a native plot binding.
function withoutEmpty(page: Page, retained: readonly string[] = []): Page {
  const empty = new Set(
    page.regions
      .filter(
        (r) =>
          !retained.includes(r.id) &&
          !Object.values(page.links || {}).some((bindings) =>
            Object.values(bindings).includes(r.id),
          ) &&
          !r.text.trim() &&
          page.contexts.every(
            (c) =>
              !(c.base[r.id] || "").trim() && !(c.overrides[r.id] || "").trim(),
          ) &&
          !page.plots.some((p) => p.input === r.id || p.output === r.id),
      )
      .map((r) => r.id),
  );
  if (!empty.size) return page;
  const edit = new PageEdit(page),
    next = edit.page;
  next.regions = next.regions.filter((r) => !empty.has(r.id));
  for (const m of next.models || []) {
    if (![...m.members, ...m.inputs, ...m.outputs].some((id) => empty.has(id)))
      continue;
    const model = edit.model(m.id)!;
    model.members = m.members.filter((id) => !empty.has(id));
    model.inputs = m.inputs.filter((id) => !empty.has(id));
    model.outputs = m.outputs.filter((id) => !empty.has(id));
  }
  for (const id of empty) {
    if (Object.hasOwn(next.layout, id)) delete edit.layout[id];
    if (next.links?.[id]) {
      edit.links(id);
      delete next.links[id];
    }
    for (const c of next.contexts) {
      if (!Object.hasOwn(c.base, id) && !Object.hasOwn(c.overrides, id))
        continue;
      const context = edit.context(c.id)!;
      delete context.base[id];
      delete context.overrides[id];
    }
  }
  if (!next.regions.length) next.origin = { x: 110, y: 110 };
  return next;
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
export class RegionSession {
  private readonly documentOwner: CanvasDocument;
  private cursors: {
    region: Region;
    index: number;
    at?: Point;
    scope?: string;
  }[] = [];
  private cursorOrigin?: Point;
  private cursorPage?: Page;
  get state(): Page {
    const base = this.documentOwner.page;
    if (!this.cursors.length) return base;
    if (this.cursorPage) return this.cursorPage;
    const next: Page = {
      ...base,
      regions: [...base.regions],
      layout: { ...base.layout },
      ...(this.cursorOrigin && !base.regions.length
        ? { origin: this.cursorOrigin }
        : {}),
    };
    for (const cursor of this.cursors) {
      next.regions.splice(
        Math.min(cursor.index, next.regions.length),
        0,
        cursor.region,
      );
      if (cursor.at) next.layout[cursor.region.id] = cursor.at;
      if (cursor.scope) {
        next.models = next.models?.map((model) =>
          model.id === cursor.scope
            ? { ...model, members: [...model.members, cursor.region.id] }
            : model,
        );
      }
    }
    return (this.cursorPage = freeze(next));
  }
  get document() {
    return this.documentOwner.document;
  }
  private readonly taskScheduler: ReturnType<typeof createTaskScheduler>;
  private readonly ownsScheduler: boolean;
  readonly samplingAvailable: boolean;
  get executionDiagnostics() {
    return this.taskScheduler.diagnostics();
  }
  private closed = false;
  private attachments = 0;
  /** The application host leases the whole session, including every computation adapter. */
  attach() {
    if (this.closed) throw Error("Workspace owner is closed");
    this.attachments++;
    const detach = this.computations.attach();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      detach();
      this.attachments--;
      queueMicrotask(() => {
        if (!this.attachments) this.dispose();
      });
    };
  }
  dispose() {
    if (this.closed) return;
    this.documentOwner.dispose();
    this.closed = true;
    this.computationOwner?.dispose();
    if (this.ownsScheduler) this.taskScheduler.dispose();
    this.listeners.clear();
  }
  get foundation() {
    return this.documentOwner.reader;
  }
  get scene(): CanvasScene {
    return readScene(this.document);
  }
  setScene(update: CanvasScene | ((scene: CanvasScene) => CanvasScene)) {
    const expected = this.document,
      before = this.scene,
      scene = typeof update === "function" ? update(before) : update;
    return this.applyCommands(sceneCommands(expected, scene), expected);
  }
  applyCommands(commands: readonly Command[], expected = this.document) {
    const changed = this.documentOwner.applyCommands(commands, expected);
    if (changed) {
      this.future = [];
      this.past.push({});
      this.past = this.past.slice(-this.documentOwner.historySize);
      this.cursorPage = undefined;
      this.emit();
    }
    return changed;
  }
  compute(target: Reference, scope: Scope = "baseline") {
    const job = this.documentOwner.compute(target, scope);
    this.emit();
    void job.completion.then(() => this.emit());
    return job;
  }
  preview(
    target: Reference,
    overrides: readonly { item: string; revision: Revision }[],
  ) {
    const result = this.documentOwner.preview(target, overrides);
    this.emit();
    return result;
  }
  cancelPreview() {
    this.documentOwner.cancelPreview();
    this.emit();
  }
  keepPreview(label: string, view: Omit<View, "alternative">) {
    const result = this.documentOwner.keepPreview(label, view);
    this.future = [];
    this.past.push({});
    this.past = this.past.slice(-this.documentOwner.historySize);
    this.emit();
    return result;
  }
  native(capture?: ReturnType<CanvasDocument["capture"]>) {
    return this.documentOwner.native(capture);
  }
  get artifacts() {
    return this.documentOwner.artifacts;
  }
  get evidenceSequence() {
    return this.documentOwner.evidenceSequence;
  }
  get isSaved() {
    return this.documentOwner.isSaved;
  }
  capture() {
    return this.documentOwner.capture();
  }
  private retentionReviews = new WeakMap<object, number>();
  reviewRetention() {
    const review = this.documentOwner.reviewRetention(this.recent.references);
    this.retentionReviews.set(review, this.recent.version);
    return review;
  }
  compact(review: ReturnType<CanvasDocument["reviewRetention"]>) {
    if (this.retentionReviews.get(review) !== this.recent.version)
      throw Error(
        "Cleanup review is stale because recent calculations changed; review again",
      );
    this.documentOwner.compact(review);
    this.retentionReviews.delete(review);
    this.cursorPage = undefined;
    this.emit();
  }
  checkCapture(capture: ReturnType<CanvasDocument["capture"]>) {
    this.documentOwner.checkCapture(capture);
  }
  acknowledge(capture: ReturnType<CanvasDocument["capture"]>) {
    const before = this.isSaved,
      accepted = this.documentOwner.acknowledge(capture);
    if (before !== this.isSaved) this.emit();
    return accepted;
  }
  setArtifacts = (update: Artifact[] | ((items: Artifact[]) => Artifact[])) => {
    const artifacts =
      typeof update === "function" ? update(this.artifacts) : update;
    this.apply(this.state, false, undefined, artifacts);
  };
  private computationOwner?: ReturnType<typeof createArtifactComputations>;
  private loadedArtifacts: string[] = [];
  get computations(): ReturnType<typeof createArtifactComputations> {
    if (this.closed) throw Error("Workspace owner is closed");
    return (this.computationOwner ??= createArtifactComputations(this, {
      paused: this.loadedArtifacts,
    }));
  }
  /** Build a reviewable command batch without publishing, executing or changing attention. */
  prepare<T>(operation: (staged: RegionSession) => T) {
    const expected = this.document;
    const staged = new RegionSession(
      this.documentOwner.page,
      () => this.retainedRegions(),
      expected,
      this.artifacts,
      true,
      undefined,
      { artifactExecutor: null },
    );
    try {
      const value = operation(staged);
      if (value && typeof (value as { then?: unknown }).then === "function") {
        void Promise.resolve(value).catch(() => {});
        throw Error("Workspace preparations must be synchronous");
      }
      return Object.freeze({
        expected,
        commands: staged.documentOwner.stagedCommands(),
        value,
      });
    } finally {
      staged.dispose();
    }
  }
  /** Staging runs only synchronous domain commands; subscribers see one final publication. */
  atomic<T>(
    operation: (staged: RegionSession) => T,
    undoAttention?: () => void,
  ): T {
    const expected = this.document,
      beforeMeaning = semanticKey(this.state);
    const staged = new RegionSession(
      this.state,
      () => this.retainedRegions(),
      this.document,
      this.artifacts,
      true,
    );
    staged.cursors = this.cursors;
    staged.cursorOrigin = this.cursorOrigin;
    staged.cursorPage = undefined;
    const value = operation(staged);
    if (value && typeof (value as { then?: unknown }).then === "function")
      throw Error("Workspace operations must be synchronous");
    const changed = this.documentOwner.applyCommands(
      staged.documentOwner.stagedCommands(),
      expected,
      !!undoAttention,
    );
    if (changed) {
      this.future = [];
      this.past.push({ undo: undoAttention });
      this.past = this.past.slice(-this.documentOwner.historySize);
    }
    this.cursors = staged.cursors;
    this.cursorOrigin = staged.cursorOrigin;
    this.cursorPage = undefined;
    if (semanticKey(staged.state) !== beforeMeaning) this.evaluate();
    else this.emit();
    return value;
  }
  private recent = new RecentCalculations();
  get receipts() {
    return this.recent.receipts;
  }
  get recentHistory() {
    return this.recent.diagnostics;
  }
  currentCalculation() {
    return captureWorksheet(
      this.documentOwner.page,
      this.document,
      project(this.documentOwner.page),
    );
  }
  clearRecentCalculations() {
    this.recent.clear();
    this.emit();
  }
  keepCalculation(id: string, label?: string) {
    const receipt = this.receipts.find((r) => r.id === id);
    if (!receipt)
      throw Error(
        "This recent calculation is no longer available. Keep current work or choose another snapshot.",
      );
    return this.keepReceipt(receipt, label);
  }
  keepCurrentCalculation(label?: string) {
    const receipt = this.currentCalculation();
    if (!receipt.definitions.length)
      throw Error("Write mathematics before keeping a calculation.");
    return this.keepReceipt(receipt, label);
  }
  private keepReceipt(receipt: WorksheetReceipt, label?: string) {
    if (!receipt.definitions.length)
      throw Error("Write mathematics before keeping a calculation.");
    const name = label ?? `${receipt.contextLabel} calculation`;
    const existing = this.state.calculations?.find(
      (c) =>
        c.snapshot.id === receipt.id ||
        (c.snapshot.key === receipt.key && c.label === name),
    );
    if (existing) return existing.id;
    const calculation = {
      id: `kept-calculation-${crypto.randomUUID()}`,
      label: name,
      snapshot: receipt,
    };
    this.apply({
      ...this.state,
      calculations: [...(this.state.calculations ?? []), calculation],
    });
    return calculation.id;
  }
  removeCalculation(id: string) {
    if (this.state.calculations?.some((c) => c.id === id))
      this.apply({
        ...this.state,
        calculations: this.state.calculations.filter((c) => c.id !== id),
      });
  }
  /** Optional browser arrangement restoration; accepted definitions and views restore through the owner. */
  private past: { undo?: () => void }[] = [];
  private future: { undo?: () => void }[] = [];
  private listeners = new Set<() => void>();
  private staging = false;
  private retainedRegions: () => string[];
  constructor(
    initial?: Page,
    retainedRegions: () => string[] = () => [],
    document?: FoundationDocument,
    artifacts: readonly Artifact[] = [],
    staging = false,
    recovery?: CanvasRecovery,
    execution: {
      artifactExecutor?: ArtifactExecutor | null;
      scheduler?: ReturnType<typeof createTaskScheduler>;
    } = {},
  ) {
    this.taskScheduler = execution.scheduler ?? createTaskScheduler();
    this.ownsScheduler = !execution.scheduler;
    this.samplingAvailable = execution.artifactExecutor !== null;
    this.retainedRegions = retainedRegions;
    this.loadedArtifacts = artifacts.map((a) => a.id);
    const page = initial
      ? document
        ? initial
        : withoutEmpty(initial, this.retainedRegions())
      : {
          regions: [],
          contexts: [
            { id: "original", label: "Original", base: {}, overrides: {} },
          ],
          active: "original",
          layout: {},
          plots: [],
          origin: { x: 110, y: 110 },
        };
    this.documentOwner = new CanvasDocument(
      page,
      document,
      artifacts,
      staging,
      recovery,
      this.taskScheduler,
      execution.artifactExecutor,
    );
    this.staging = staging;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    if (this.staging) return;
    this.listeners.forEach((listener) => listener());
  }
  private apply(
    next: Page,
    evaluate = false,
    undo?: () => void,
    artifacts: Artifact[] = this.artifacts,
  ) {
    const accepted = withoutEmpty(next, [
        ...this.retainedRegions(),
        ...artifacts.flatMap((a) => [a.input, a.output]),
      ]),
      ids = new Set(accepted.regions.map((r) => r.id));
    const cursors = next.regions.flatMap((region, index) =>
      ids.has(region.id)
        ? []
        : [
            {
              region: freeze(clone(region)),
              index,
              ...(next.layout[region.id]
                ? { at: freeze(clone(next.layout[region.id])) }
                : {}),
              ...(modelParent(next, region.id)
                ? { scope: modelParent(next, region.id) }
                : {}),
            },
          ],
    );
    const changed = this.documentOwner.apply(accepted, !!undo, artifacts);
    if (changed) {
      this.future = [];
      this.past.push({ undo });
      this.past = this.past.slice(-this.documentOwner.historySize);
    }
    this.cursors = cursors;
    this.cursorOrigin = next.origin;
    this.cursorPage = undefined;
    if (evaluate) this.evaluate();
    else this.emit();
  }
  get canUndo() {
    return this.documentOwner.canUndo;
  }
  get canRedo() {
    return this.documentOwner.canRedo;
  }
  create(at?: Point, scope?: string): string {
    if (scope && !at) {
      const current = positions(this.state),
        members = this.state.models?.find((m) => m.id === scope)?.members || [];
      const last = this.state.regions
        .filter((r) => members.includes(r.id))
        .at(-1);
      at = last
        ? {
            x: current[last.id].x,
            y: current[last.id].y + regionAdvance(last.text),
          }
        : { x: 110, y: 130 };
    }
    const edit = new PageEdit(this.state),
      next = edit.page,
      id = `region-${crypto.randomUUID()}`;
    if (!next.regions.length && at) next.origin = at;
    else if (at) edit.layout[id] = at;
    next.regions = [...next.regions, { id, text: "", mathVersion: 3 }];
    if (scope) edit.model(scope)?.members.push(id);
    this.apply(next);
    return id;
  }
  /** Copy authored regions with fresh identities and unambiguous local symbol names. */
  duplicateRegions(ids: readonly string[], placements: Record<string, Point>) {
    const next = clone(this.state),
      selected = new Set(ids),
      projection = project(this.state);
    const source = next.regions.filter((r) => selected.has(r.id));
    if (next.regions.length + source.length > 256)
      throw Error("This page supports up to 256 regions.");
    const mapping = new Map(
      source.map((r) => [r.id, `region-${crypto.randomUUID()}`]),
    );
    const used = new Set(
      next.contexts.flatMap((context) =>
        [...project(this.state, context.id).statements.values()].map(
          (s) => s.name,
        ),
      ),
    );
    const names = new Map<string, string>();
    for (const region of source) {
      const statement = projection.statements.get(region.id);
      if (!statement || statement.anonymous || statement.relation !== "=")
        continue;
      let name = `${statement.name}_copy`,
        suffix = 2;
      while (used.has(name)) name = `${statement.name}_copy${suffix++}`;
      used.add(name);
      names.set(region.id, name);
    }
    const rewrite = (text: string, id: string) => {
      const aliases = new Map<string, string>();
      const own = projection.statements.get(id);
      if (own && names.has(id)) aliases.set(own.name, names.get(id)!);
      else if (own && own.relation !== "=") {
        const source = projection.sources[own.name]?.find((target) =>
          names.has(target),
        );
        if (source) aliases.set(own.name, names.get(source)!);
      }
      for (const [alias, target] of Object.entries(
        projection.bindings[id] || {},
      ))
        if (names.has(target)) aliases.set(alias, names.get(target)!);
      return text.replace(
        /[\p{L}_][\p{L}\p{N}_]*/gu,
        (token) => aliases.get(token) || token,
      );
    };
    for (const region of source) {
      const id = mapping.get(region.id)!;
      next.regions.push({
        ...region,
        id,
        text: rewrite(region.text, region.id),
        ...(region.source
          ? {
              source: {
                ...region.source,
                dataset:
                  mapping.get(region.source.dataset) || region.source.dataset,
              },
            }
          : {}),
      });
      const at = placements[region.id] || positions(this.state)[region.id];
      next.layout[id] = { x: at.x + 24, y: at.y + 24 };
      const parent = next.models?.find((model) =>
        model.members.includes(region.id),
      );
      parent?.members.push(id);
      const bindings = {
        ...projection.bindings[region.id],
        ...next.links?.[region.id],
      };
      if (Object.keys(bindings).length)
        (next.links ||= {})[id] = Object.fromEntries(
          Object.entries(bindings).map(([alias, target]) => [
            names.get(target) || alias,
            mapping.get(target) || target,
          ]),
        );
      for (const context of next.contexts)
        for (const key of ["base", "overrides"] as const)
          if (context[key][region.id] !== undefined)
            context[key][id] = rewrite(context[key][region.id], region.id);
    }
    this.apply(next);
    return [...mapping.values()];
  }
  renameDocument(value: string) {
    const title = documentTitle(value);
    if (title !== this.state.title) this.apply({ ...this.state, title });
  }
  /** Refuse partial deletion of live engineering dependencies rather than silently rebinding them. */
  deleteRegions(ids: readonly string[]) {
    const removed = new Set(ids),
      next = clone(this.state);
    for (const context of next.contexts) {
      const projection = project(this.state, context.id);
      if (
        Object.entries(projection.bindings).some(
          ([id, links]) =>
            !removed.has(id) &&
            Object.values(links).some((target) => removed.has(target)),
        )
      )
        throw Error(
          "Other regions depend on this selection. Select the dependent regions too, or disconnect them first.",
        );
    }
    if (
      next.regions.some(
        (r) => !removed.has(r.id) && r.source && removed.has(r.source.dataset),
      ) ||
      next.plots.some((p) => removed.has(p.input) || removed.has(p.output)) ||
      next.dataRelations?.some((r) =>
        [r.dataset, r.output, ...r.bindings.map((b) => b.quantity)].some(
          (id) => id && removed.has(id),
        ),
      ) ||
      this.artifacts.some((a) => removed.has(a.input) || removed.has(a.output))
    )
      throw Error(
        "This selection has live data, plot or artifact references. Remove those references first.",
      );
    next.regions = next.regions.filter((r) => !removed.has(r.id));
    for (const id of removed) {
      delete next.layout[id];
      if (next.links) delete next.links[id];
      for (const context of next.contexts) {
        delete context.base[id];
        delete context.overrides[id];
      }
    }
    for (const model of next.models || []) {
      model.members = model.members.filter((id) => !removed.has(id));
      model.inputs = model.inputs.filter((id) => !removed.has(id));
      model.outputs = model.outputs.filter((id) => !removed.has(id));
    }
    this.apply(next);
  }
  importData(name: string, csv: string, at: Point, scope?: string): string {
    const data = { name, csv };
    readCsv(data);
    if (this.state.regions.length >= 256)
      throw Error("This page supports up to 256 regions.");
    const edit = new PageEdit(this.state),
      next = edit.page,
      id = `region-${crypto.randomUUID()}`;
    next.regions = [...next.regions, { id, text: `Data · ${name}`, data }];
    edit.layout[id] = at;
    if (scope) edit.model(scope)?.members.push(id);
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
    const edit = new PageEdit(this.state),
      next = edit.page;
    if (existing) {
      const region = edit.region(existing);
      if (!region?.external) throw Error("This reference no longer exists.");
      region.label = name;
      region.external = clone(external);
      this.apply(next);
      return region.id;
    }
    if (next.regions.length >= 256)
      throw Error("This page supports up to 256 regions.");
    const id = `region-${crypto.randomUUID()}`;
    next.regions = [
      ...next.regions,
      {
        id,
        text: `Source · ${name}`,
        label: name,
        external: clone(external),
      },
    ];
    edit.layout[id] = at;
    if (scope) edit.model(scope)?.members.push(id);
    this.apply(next);
    return id;
  }
  /** Compatibility API: explicitly enables v2, never downgrades v3. */
  enableScientificMath(id: string) {
    this.upgradeMath(id, 2);
  }
  enableScientificMathV3(id: string) {
    this.upgradeMath(id, 3);
  }
  private upgradeMath(id: string, version: 2 | 3) {
    const edit = new PageEdit(this.state),
      region = edit.region(id);
    if (!region || region.data || region.external || region.source)
      throw Error("Choose a plain worksheet equation.");
    if ((region.mathVersion ?? 1) >= version) return;
    region.mathVersion = version;
    this.apply(edit.page, true);
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
      edit = new PageEdit(this.state),
      next = edit.page,
      id = `region-${crypto.randomUUID()}`;
    next.regions = [
      ...next.regions,
      {
        id,
        text: value.text,
        mathVersion: 3,
        source: { dataset, row, column, raw: value.raw, unit: value.unit },
      },
    ];
    edit.layout[id] = at;
    const parent = modelParent(next, dataset);
    if (parent) edit.model(parent)?.members.push(id);
    this.apply(next, true);
    return id;
  }
  bindDataset(binding: DatasetComputation, at?: Point): string {
    evaluateDataset(this.state, binding);
    if ((this.state.dataRelations?.length || 0) >= 16)
      throw Error("This experiment supports up to 16 dataset relationships.");
    const edit = new PageEdit(this.state),
      next = edit.page,
      id = `data-relation-${crypto.randomUUID()}`;
    next.dataRelations = [
      ...(next.dataRelations || []),
      { ...clone(binding), id },
    ];
    edit.layout[id] = at || { x: 650, y: 420 };
    const parent = modelParent(next, binding.output);
    if (parent) edit.model(parent)?.members.push(id);
    this.apply(next);
    return id;
  }
  removeDatasetRelation(id: string) {
    const edit = new PageEdit(this.state),
      next = edit.page;
    next.dataRelations = next.dataRelations?.filter((r) => r.id !== id);
    delete edit.layout[id];
    for (const model of next.models || []) {
      if (![...model.members, ...model.inputs, ...model.outputs].includes(id))
        continue;
      const changed = edit.model(model.id)!;
      changed.members = model.members.filter((m) => m !== id);
      changed.inputs = model.inputs.filter((m) => m !== id);
      changed.outputs = model.outputs.filter((m) => m !== id);
    }
    this.apply(next);
  }
  discardEmpty() {
    if (!this.cursors.length) return;
    this.cursors = [];
    this.cursorOrigin = undefined;
    this.cursorPage = undefined;
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
    if (
      text.trim() &&
      !this.documentOwner.page.regions.some((r) => r.id === id) &&
      this.documentOwner.page.regions.length >= 256
    )
      return { ok: false, error: "This workspace supports up to 256 regions." };
    const edit = new PageEdit(this.state),
      next = edit.page,
      region = edit.region(id);
    if (!region) return { ok: false, error: "This region no longer exists." };
    const context = edit.context(next.active)!;
    const unchanged = effective(next).find((r) => r.id === id)?.text === text;
    if (
      !unchanged &&
      context.id !== "original" &&
      !!effective(next)
        .find((r) => r.id === id)
        ?.text.trim() &&
      (mathematical(text, region.mathVersion ?? 1) ||
        mathematical(
          effective(next).find((r) => r.id === id)?.text || "",
          region.mathVersion ?? 1,
        ))
    ) {
      const p = project(next);
      const before = p.statements.get(id);
      try {
        const after = parse(text.trim(), id, region.mathVersion ?? 1),
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
          Object.assign(edit.links(id), bindings);
          const trial = project(next);
          if (trial.errors.has(id)) throw Error(trial.errors.get(id));
          q = trial.solved.values.get(after.name);
        } else
          q = calculate([
            {
              id,
              text: text.trim(),
              x: 0,
              y: 0,
              ...(region.mathVersion
                ? { mathVersion: region.mathVersion }
                : {}),
            },
          ]).values.get(after.name);
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
    if (bindings) Object.assign(edit.links(id), clone(bindings));
    try {
      const after = parse(text, id, region.mathVersion ?? 1);
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
            if (r.id !== id) {
              const changed = edit.region(r.id)!;
              changed.text = replace(changed.text, alias);
            }
            const links = edit.links(r.id);
            delete links[alias];
            links[after.name] = id;
            for (const c of next.contexts)
              for (const key of ["base", "overrides"] as const)
                if (c[key][r.id]) {
                  const entries = edit.context(c.id)![key];
                  entries[r.id] = replace(entries[r.id], alias);
                }
          }
        }
        for (const c of next.contexts)
          for (const key of ["base", "overrides"] as const)
            if (c[key][id])
              edit.context(c.id)![key][id] = replace(c[key][id], before.name);
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
        nextId = `region-${crypto.randomUUID()}`;
        next.regions.splice(index + 1, 0, {
          id: nextId,
          text: "",
          mathVersion: 3,
        });
      }
      if (next.layout[id]) {
        const at = next.layout[id],
          scope = modelParent(next, id),
          current = positions(this.state);
        const occupied = this.state.regions
          .filter(
            (r) =>
              r.id !== id &&
              r.id !== nextId &&
              modelParent(this.state, r.id) === scope,
          )
          .map((r) => ({
            ...current[r.id],
            width: 500,
            height: regionAdvance(r.text) - 16,
          }));
        edit.layout[nextId] = freeRegionPosition(
          { x: at.x, y: at.y + regionAdvance(text) },
          REGION_STEP,
          occupied,
        );
      }
      if (nextId && !next.models?.some((m) => m.members.includes(nextId!))) {
        const parent = modelParent(next, id);
        if (parent) edit.model(parent)?.members.push(nextId);
      }
    }
    try {
      this.apply(next, semanticKey(next) !== semanticKey(this.state));
      if (!text.trim()) this.discardEmpty();
      return { ok: true, next: nextId };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
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
      const candidate = new PageEdit(this.state),
        next = candidate.page,
        c = candidate.context(next.active)!;
      if (c.id === "original") candidate.region(edit.target)!.text = edit.text;
      else c.overrides[edit.target] = edit.text;
      const parsed = parse(
        edit.text,
        undefined,
        candidate.region(edit.target)!.mathVersion ?? 1,
      );
      if (
        edit.alias !== source.name ||
        (parsed.relation === "=" && parsed.name !== target.name)
      )
        throw Error("The proposed reference no longer matches its objects.");
      candidate.links(edit.target)[edit.alias] = edit.source;
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
    if (this.staging) return;
    const p = project(this.documentOwner.page);
    this.recent.record(
      captureWorksheet(this.documentOwner.page, this.document, p),
      this.document,
    );
    this.emit();
  }
  addPlot(output: string, input: string): string {
    if (this.state.plots.length >= 16)
      throw Error("This workspace supports up to 16 plots.");
    const p = project(this.state),
      s = p.statements.get(input),
      value = s && p.solved.values.get(s.name);
    if (!value || !ancestors(p, output).includes(input))
      throw Error("Choose a resolved assigned quantity used by this equation.");
    if (references(s!.expression).length)
      throw Error(
        "This sweep varies an assigned quantity, not a computed output.",
      );
    const edit = new PageEdit(this.state),
      next = edit.page,
      id = `plot-${crypto.randomUUID()}`;
    const center = value.value,
      delta = Math.abs(center) * 0.65 || 1;
    const sourceY = positions(next)[output].y;
    const occupied = next.plots.filter(
      (plot) => Math.abs(positions(next)[plot.id].y - sourceY) < 320,
    ).length;
    next.plots = [
      ...next.plots,
      {
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
      },
    ];
    const parent = modelParent(next, output);
    if (parent) edit.model(parent)?.members.push(id);
    this.apply(next);
    return id;
  }
  branch(): string {
    if (this.state.contexts.length >= 16)
      throw Error("This workspace supports up to 16 scenarios.");
    const next = new PageEdit(this.state).page,
      p = project(next),
      base: Record<string, string> = {};
    for (const r of effective(next))
      if (p.kinds[r.id] === "quantity" && !p.errors.has(r.id))
        base[r.id] = r.text;
    const id = `alternative-${crypto.randomUUID()}`;
    next.contexts = [
      ...next.contexts,
      {
        id,
        label: `Alternative ${next.contexts.length}`,
        base,
        overrides: {},
      },
    ];
    next.active = id;
    this.apply(next, true);
    return id;
  }
  switchContext(id: string) {
    if (!this.state.contexts.some((c) => c.id === id)) return;
    this.apply({ ...this.state, active: id });
  }
  /** Stage a proposed scalar change in a new context, then publish once. */
  branchValue(input: string, text: string): string {
    const staged = new RegionSession(
      this.state,
      () => this.retainedRegions(),
      this.document,
      this.artifacts,
      true,
    );
    const before = project(this.state);
    if (before.kinds[input] !== "quantity" || before.errors.has(input))
      throw Error("Choose a resolved assigned quantity to explore.");
    const context = staged.branch();
    const result = staged.write(input, text);
    if (!result.ok) throw Error(result.error);
    const after = project(staged.state);
    if (
      [...after.errors].some(
        ([id]) => id === input || ancestors(after, id).includes(input),
      )
    )
      throw Error(
        "Resolve the affected calculation before keeping an alternative.",
      );
    this.apply(staged.state, true);
    return context;
  }
  keepAlternative(
    input: string,
    text: string,
    expected: { context: string; key: string },
  ): string {
    if (
      expected.context !== this.state.active ||
      expected.key !== semanticKey(this.state)
    )
      throw Error("The model changed. Review this alternative again.");
    const before = project(this.state),
      baseline = this.state.active;
    return this.atomic((staged) => {
      const context = staged.branchValue(input, text);
      staged.setArtifacts((items) =>
        items.map((a) =>
          a.input === input || ancestors(before, a.output).includes(input)
            ? { ...a, compareContext: baseline, comparing: true }
            : a,
        ),
      );
      return context;
    });
  }
  branchEdit(input: string, before: Page): string {
    if (this.state.contexts.length >= 16)
      throw Error("This workspace supports up to 16 scenarios.");
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
      !sameJson(
        effective(before).filter((r) => r.id !== input),
        effective(this.state).filter((r) => r.id !== input),
      )
    )
      throw Error(
        "The model changed; compare only the compatible quantity edit just made.",
      );
    const edit = new PageEdit(this.state),
      next = edit.page,
      text = current.texts[input];
    const source = edit.context(next.active)!;
    if (source.id === "original")
      edit.region(input)!.text = baseline.texts[input];
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
    const id = `alternative-${crypto.randomUUID()}`;
    next.contexts = [
      ...next.contexts,
      {
        id,
        label: `Alternative ${next.contexts.length}`,
        base,
        overrides: { [input]: text },
      },
    ];
    next.active = id;
    this.apply(next, true);
    return id;
  }
  move(id: string, at: Point) {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    const edit = new PageEdit(this.state),
      next = edit.page,
      plot = edit.plot(id);
    if (plot) plot.at = at;
    else edit.layout[id] = at;
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
    const edit = new PageEdit(this.state),
      next = edit.page,
      parent = [...parents][0];
    const owner = parent ? edit.model(parent) : undefined;
    if (owner)
      owner.members = [
        ...owner.members.filter((id) => !model.members.includes(id)),
        model.id,
      ];
    next.models = [...(next.models || []), clone(model)];
    // Freeze existing coordinates at the scope boundary. Subsequent writing
    // flows within its owner instead of shifting another model's worksheet.
    const current = positions(this.state);
    for (const r of next.regions) edit.layout[r.id] = { ...current[r.id] };
    for (const p of next.plots) edit.plot(p.id)!.at = { ...current[p.id] };
    edit.layout[model.id] = at;
    validateModels(next, representations);
    this.apply(next);
  }
  addModelMember(model: string | undefined, id: string) {
    if (!model || modelParent(this.state, id)) return;
    const edit = new PageEdit(this.state),
      next = edit.page,
      target = edit.model(model);
    if (target) {
      target.members.push(id);
      this.apply(next);
    }
  }
  exposeModel(id: string, inputs: string[], outputs: string[], name?: string) {
    const edit = new PageEdit(this.state),
      next = edit.page,
      model = edit.model(id);
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
    const edit = new PageEdit(this.state),
      next = edit.page,
      model = edit.model(id);
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
    const viewCommands: Command[] = [...this.document.views.entries()].flatMap(
      ([id, view]) => {
        const at = placements[id];
        return at && (at.x !== view.x || at.y !== view.y)
          ? [{ kind: "view" as const, view: { ...view, ...at } }]
          : [];
      },
    );
    if (viewCommands.length) {
      this.atomic((staged) => {
        staged.applyCommands(viewCommands);
        staged.arrange(placements, checkpoint);
      }, undo);
      return;
    }
    const edit = new PageEdit(this.state),
      next = edit.page;
    for (const [id, at] of Object.entries(placements)) {
      const plot = edit.plot(id);
      if (plot) plot.at = at;
      else if (
        next.regions.some((r) => r.id === id) ||
        next.dataRelations?.some((r) => r.id === id) ||
        next.models?.some((m) => m.id === id)
      )
        edit.layout[id] = at;
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
      for (const r of column) delete edit.layout[r.id];
    }
    this.apply(next, false, undo);
  }
  resize(id: string, width: number, height: number) {
    const edit = new PageEdit(this.state),
      next = edit.page,
      plot = edit.plot(id);
    if (!plot || !Number.isFinite(width + height)) return;
    plot.width = Math.max(320, Math.min(1100, width));
    plot.height = Math.max(240, Math.min(750, height));
    this.apply(next);
  }
  stack() {
    this.apply({ ...this.state, layout: {} });
  }
  redo() {
    if (!this.canRedo) return;
    this.documentOwner.redo();
    this.past.push(this.future.pop() ?? {});
    this.cursors = [];
    this.cursorOrigin = undefined;
    this.cursorPage = undefined;
    this.emit();
  }
  undo() {
    if (this.documentOwner.reader.preview()) {
      this.cancelPreview();
      return;
    }
    const previous = this.past.pop();
    this.cursors = [];
    this.cursorOrigin = undefined;
    this.cursorPage = undefined;
    try {
      if (this.documentOwner.canUndo) {
        this.documentOwner.undo();
        this.future.push(previous ?? {});
        previous?.undo?.();
      }
    } finally {
      this.emit();
    }
  }
}
