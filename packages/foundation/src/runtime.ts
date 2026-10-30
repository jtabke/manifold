import {
  assert,
  freeze,
  failure,
  identity,
  canonical,
  type Json,
} from "./value.ts";
import { byteLength } from "./resources.ts";
import { SharedMap, mapWork } from "./shared-map.ts";
import { restoreLayout } from "./recovery-layout.ts";
import { createTaskScheduler, type TaskScheduler } from "./tasks.ts";
import * as d from "./document.ts";
import {
  captureSelection,
  guardSelection,
  assertSelectionUnchanged,
  type SelectionGuard,
} from "./selection.ts";
import { compact, type RetentionPolicy, type Compaction } from "./retention.ts";
import {
  captureExecution as capture,
  isTypedSnapshot,
  validateOutput,
  validateReceipt,
  type Receipt,
  type Executor,
  type Outcome,
} from "./execution.ts";
import {
  validateTypedOutput,
  validateTypedOutputResources,
  type TypedExecutor,
  type TypedOutcome,
} from "./typed-execution.ts";
import {
  acquireExecutionResources,
  publishExecutionResources,
  retainExecutionResources,
  replaceExecutionResources,
} from "./execution-resources.ts";
import type {
  Schemas,
  Methods,
  Resources,
  Reference,
  Revision,
  View,
} from "./contracts.ts";
const workspaceCaptures = new WeakSet<object>();
/** Local persistence accepts only coherent captures produced by an operation owner. */
export const isWorkspaceCapture = (value: object) =>
  workspaceCaptures.has(value);
export type Loaded = Readonly<{
  document: d.Document;
  receipts: readonly Receipt[];
  resources: Resources;
  original?: string;
}>;
/** Complete retained candidate for trusted synchronous application policy, without write authority. */
export type WorkspaceState = Readonly<{
  document: d.Document;
  receipts: SharedMap<Receipt>;
  resources: Resources;
}>;
export type Stamp = Readonly<{
  root: string;
  evidence: number;
  binding: number;
}>;
export type Scope = "baseline" | "preview" | Readonly<{ alternative: string }>;
export type Event = d.Changes &
  Readonly<{
    evidence: boolean;
    preview: boolean;
    receiptIds: readonly string[];
  }>;
type Preview = Readonly<{
  token: string;
  document: d.Document;
  context: d.Context;
  guard: Readonly<Record<string, string | null>>;
  pinGuard: Readonly<Record<string, boolean>>;
}>;
type Job = Readonly<{
  id: string;
  binding: number;
  source: d.ResolutionSource;
  captured: Extract<ReturnType<typeof capture>, { ok: true }>;
  cancel: () => void;
  inputBytes: number;
  evidenceBytes: number;
}>;
export function createWorkspace(
  initial: Loaded,
  config: Readonly<{
    schemas: Schemas;
    methods?: Methods;
    executor?: Executor;
    typedExecutor?: TypedExecutor;
    namespace: string;
    historyLimit?: number;
    maxJobs?: number;
    scheduler?: TaskScheduler;
    maxInputBytes?: number;
    maxReceipts?: number;
    maxEvidenceBytes?: number;
    /** Trusted synchronous domain checks run before authored selection publication. */
    validateDocument?: (candidate: d.Document) => void;
    /** Runs before every retained-state publication, including evidence/resource admission. */
    validateState?: (candidate: WorkspaceState) => void;
  }>,
) {
  config = Object.freeze({ ...config });
  const methods: Methods =
    config.methods ?? Object.freeze({ get: () => undefined });
  identity(config.namespace);
  assert(config.namespace.length < 80, "Namespace too long");
  const historyLimit = config.historyLimit ?? 32,
    maxJobs = config.maxJobs ?? 4;
  const maxInputBytes = config.maxInputBytes ?? 64 * 1024 * 1024,
    maxReceipts = config.maxReceipts ?? 4096,
    maxEvidenceBytes = config.maxEvidenceBytes ?? 64 * 1024 * 1024;
  assert(
    Number.isSafeInteger(maxReceipts) &&
      maxReceipts > 0 &&
      maxReceipts <= 100000 &&
      Number.isSafeInteger(maxEvidenceBytes) &&
      maxEvidenceBytes > 0 &&
      maxEvidenceBytes <= 256 * 1024 * 1024,
    "Invalid evidence limits",
  );
  assert(
    Number.isSafeInteger(historyLimit) &&
      historyLimit >= 0 &&
      historyLimit <= 1024 &&
      Number.isSafeInteger(maxJobs) &&
      maxJobs > 0 &&
      maxJobs <= 64,
    "Invalid runtime limits",
  );
  assert(
    Number.isSafeInteger(maxInputBytes) &&
      maxInputBytes >= 0 &&
      maxInputBytes <= 256 * 1024 * 1024,
    "Invalid execution input budget",
  );
  const scheduler =
    config.scheduler ??
    createTaskScheduler({ concurrency: maxJobs, maxQueued: 0 });
  let doc = d.fromPlain(d.toPlain(initial.document), config.schemas),
    resources = initial.resources,
    original = initial.original,
    receipts = SharedMap.empty<Receipt>(),
    byKey = SharedMap.empty<string>(),
    binding = 0,
    serial = 0,
    busy = false,
    closed = false,
    preview: Preview | undefined,
    notificationErrors = 0;
  const receiptWeights = new WeakMap<object, number>(),
    evidenceMemo = new WeakMap<object, number>();
  function receiptBytes(receipt: Receipt) {
    const known = receiptWeights.get(receipt);
    if (known !== undefined) return known;
    const bytes = byteLength(
      canonical({
        ...receipt,
        context: d.contextToPlain(receipt.context),
      } as unknown as Json),
    );
    receiptWeights.set(receipt, bytes);
    return bytes;
  }
  const evidenceBytes = () =>
    receipts.fold<number>(
      (_id, receipt, left, right) =>
        receiptBytes(receipt) + (left ?? 0) + (right ?? 0),
      evidenceMemo,
    ) ?? 0;
  const usedAlternatives = new Set(
    [...doc.alternatives.entries()].map(([id]) => id),
  );
  const history: { selection: d.Selection; changes: d.Changes }[] = [],
    future: { selection: d.Selection; changes: d.Changes }[] = [],
    previewGuards = new WeakMap<Preview, SelectionGuard>(),
    listeners = new Set<(event: Event) => void>(),
    jobs = new Map<string, Job>(),
    usedRoots = new Set([doc.id]),
    reservedRevisions = new Set<string>();
  const stamp = (): Stamp =>
    Object.freeze({ root: doc.id, evidence: doc.evidenceSequence, binding });
  const noChanges: d.Changes = freeze({
    items: [],
    affected: [],
    views: [],
    alternatives: [],
  });
  function notify(
    changes: d.Changes = noChanges,
    evidence = false,
    previewChanged = false,
    receiptIds: readonly string[] = [],
  ) {
    const event = Object.freeze({
      ...changes,
      evidence,
      preview: previewChanged,
      receiptIds,
    });
    for (const listener of listeners)
      try {
        listener(event);
      } catch {
        notificationErrors++;
      }
  }
  function load(next: Loaded) {
    let rs = SharedMap.empty<Receipt>(),
      index = SharedMap.empty<string>(),
      order = 0;
    const orders = new Set<number>();
    for (const r of next.receipts) {
      assert(
        !rs.get(r.id) && !orders.has(r.order),
        "Duplicate receipt identity/order",
      );
      validateReceipt(
        next.document,
        r,
        config.schemas,
        methods,
        next.resources,
      );
      orders.add(r.order);
      rs = rs.set(
        r.id,
        Object.freeze({
          ...r,
          context: d.contextFromPlain(d.contextToPlain(r.context)),
          snapshot: freeze(structuredClone(r.snapshot)),
          outcome: freeze(structuredClone(r.outcome)),
        }) as Receipt,
      );
      const old = index.get(r.key);
      if (!old || rs.get(old)!.order < r.order) index = index.set(r.key, r.id);
      order = Math.max(order, r.order);
    }
    for (const [, r] of next.document.revisions.entries())
      for (const id of config.schemas.get(r.schema)?.evidence?.(r.body) ?? [])
        assert(rs.get(id), "Cited receipt unavailable");
    return {
      rs,
      index,
      order: Math.max(order, next.document.evidenceSequence),
    };
  }
  function validateDocument(candidate: d.Document) {
    synchronous(config.validateDocument?.(candidate), "Document");
    return candidate;
  }
  function synchronous(result: unknown, kind: string) {
    if (result !== undefined) {
      // Reject async validation without leaving its eventual failure unhandled.
      void Promise.resolve(result).catch(() => {});
      throw Error(
        kind + " validation must be synchronous; throw to reject a candidate",
      );
    }
  }
  function validateState(
    candidate: d.Document,
    nextReceipts = receipts,
    nextResources = resources,
  ) {
    synchronous(
      config.validateState?.(
        Object.freeze({
          document: candidate,
          receipts: nextReceipts,
          resources: nextResources,
        }),
      ),
      "State",
    );
    return candidate;
  }
  const loaded = load({ ...initial, document: doc });
  receipts = loaded.rs;
  byKey = loaded.index;
  doc = Object.freeze({
    ...doc,
    evidenceSequence: loaded.order,
    allocated: Object.freeze({
      ...doc.allocated,
      receipts: SharedMap.from([
        ...doc.allocated.receipts.entries(),
        ...[...receipts.entries()].map(([id]) => [id, true] as const),
      ]),
    }),
  });
  const continuous = restoreLayout(initial, { document: doc, receipts });
  receipts = continuous.receipts;
  doc = validateState(validateDocument(continuous.document));
  let lifecycle = 0;
  const reviews = new WeakMap<
    object,
    {
      candidate: Compaction;
      document: d.Document;
      receipts: SharedMap<Receipt>;
      lifecycle: number;
      preview: Preview | undefined;
      binding: number;
    }
  >();
  function reviewCompaction(policy: RetentionPolicy) {
    assert(!closed, "Workspace owner is closed");
    assert(!busy, "Operation in progress");
    const active = [
      ...(preview
        ? [{ document: preview.document, context: preview.context }]
        : []),
      ...[...jobs.values()]
        .filter((j) => j.binding === binding)
        .map((j) => ({ document: j.source, context: j.captured.context })),
    ];
    const candidate = compact(
      doc,
      receipts,
      config.schemas,
      policy,
      [...history, ...future].map((h) => h.selection),
      active,
    );
    const review = Object.freeze({
      policy: freeze(structuredClone(policy)),
      before: candidate.before,
      after: candidate.after,
      removedRevisions: candidate.removedRevisions,
      removedReceipts: candidate.removedReceipts,
      assets: candidate.assets,
    });
    reviews.set(review, {
      candidate,
      document: doc,
      receipts,
      lifecycle,
      preview,
      binding,
    });
    return review;
  }
  function gate(expected: Stamp, id?: string, exactEvidence = false) {
    assert(!closed, "Workspace owner is closed");
    assert(!busy, "Operation in progress");
    assert(
      expected.root === doc.id &&
        expected.binding === binding &&
        (!exactEvidence || expected.evidence === doc.evidenceSequence),
      "Stale root/evidence/binding",
    );
    if (id) {
      identity(id);
      assert(!usedRoots.has(id), "Root identity reused");
    }
  }
  function reserve(commands: readonly d.Command[]) {
    for (const c of commands)
      if (c.kind === "create" || c.kind === "revise")
        assert(
          !reservedRevisions.has(c.revision.id),
          "Revision identity was already allocated",
        );
  }
  function recordReserved(commands: readonly d.Command[]) {
    for (const c of commands)
      if (c.kind === "create" || c.kind === "revise")
        reservedRevisions.add(c.revision.id);
  }
  function publish(next: d.Document, changes: d.Changes, clearPreview = false) {
    future.length = 0;
    if (historyLimit) {
      history.push({ selection: d.selection(doc), changes });
      if (history.length > historyLimit) history.shift();
    }
    doc = next;
    usedRoots.add(doc.id);
    original = undefined;
    if (clearPreview) preview = undefined;
    notify(changes, false, clearPreview);
  }
  function scoped(target: Reference, scope: Scope) {
    if (scope === "preview") {
      assert(preview, "No active preview");
      assert(
        target.document === preview.context.root.document &&
          target.item === preview.context.root.item,
        "Preview target mismatch",
      );
      return {
        document: preview.document,
        context: preview.context,
        target: preview.context.root,
      };
    }
    if (scope !== "baseline") {
      const a = doc.alternatives.get(scope.alternative);
      assert(a, "Alternative missing");
      assert(
        target.document === a.context.root.document &&
          target.item === a.context.root.item,
        "Alternative target mismatch",
      );
      return { document: doc, context: a.context, target: a.context.root };
    }
    return {
      document: doc,
      context: d.captureContext(doc, target, config.schemas),
      target,
    };
  }
  // Finish all full-document access before allocating asynchronous job closures.
  function executionSelection(target: Reference, scope: Scope) {
    const selected = scoped(target, scope),
      got = capture(
        selected.document,
        selected.target,
        config.schemas,
        methods,
        resources,
        selected.context,
      );
    assert(got.ok, got.ok ? "" : got.error);
    const revisions: [string, Revision][] = [];
    for (const [rid] of got.context.revisions.entries())
      revisions.push([rid, selected.document.revisions.get(rid)!]);
    return {
      got,
      source: Object.freeze({
        document: selected.document.document,
        revisions: SharedMap.from(revisions),
      }),
    };
  }
  function result(target: Reference, scope: Scope = "baseline") {
    try {
      assert(
        !doc.readOnly,
        "Read-only package: execution evidence is preserved without interpretation",
      );
      const source = scoped(target, scope),
        got = capture(
          source.document,
          source.target,
          config.schemas,
          methods,
          resources,
          source.context,
        );
      if (!got.ok) return { status: "blocked" as const, reason: got.error };
      const job = [...jobs.values()].find(
        (j) => j.binding === binding && j.captured.key === got.key,
      );
      if (job) return { status: "pending" as const, job: job.id };
      const id = byKey.get(got.key),
        receipt = id ? receipts.get(id) : undefined;
      if (
        receipt?.kind === "typed@1" &&
        receipt.outcome.status === "success" &&
        receipt.outcome.assets.some(
          (asset) => resources.read(asset).status !== "ready",
        )
      )
        return {
          status: "blocked" as const,
          reason: "Retained output bytes unavailable",
          receipt,
        };
      if (receipt)
        return {
          status:
            receipt.outcome.status === "success"
              ? ("current" as const)
              : ("failed" as const),
          receipt,
        };
      return { status: "ready" as const };
    } catch (e) {
      return { status: "blocked" as const, reason: String(e) };
    }
  }
  function guarded<T>(
    expected: Stamp,
    action: () => T,
    id?: string,
    exact = false,
  ) {
    let entered = false;
    try {
      gate(expected, id, exact);
      busy = true;
      entered = true;
      return { ok: true as const, value: action() };
    } catch (e) {
      return failure(e);
    } finally {
      if (entered) busy = false;
    }
  }
  return Object.freeze({
    reader: Object.freeze({
      read: () => doc,
      resources: () => resources,
      evidence: () => receipts,
      original: () => original,
      /** Coherent immutable input for local persistence; import validation belongs to Open. */
      capture: () => {
        const capture = Object.freeze({
          document: doc,
          receipts,
          resources,
          original,
          stamp: stamp(),
        });
        workspaceCaptures.add(capture);
        return capture;
      },
      reviewCompaction,
      stamp,
      result,
      preview: () => preview,
      subscribe: (fn: (event: Event) => void) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    }),
    diagnostics: () => ({
      undoSteps: history.length,
      redoSteps: future.length,
      activeJobs: jobs.size,
      activeRevisionPayloads: [...jobs.values()].reduce(
        (sum, job) => sum + job.source.revisions.size,
        0,
      ),
      receipts: receipts.size,
      evidenceBytes: evidenceBytes(),
      reservedEvidenceBytes: [...jobs.values()].reduce(
        (sum, job) => sum + job.evidenceBytes,
        0,
      ),
      notificationErrors,
      activeInputBytes: [...jobs.values()].reduce(
        (sum, job) => sum + job.inputBytes,
        0,
      ),
    }),
    owner: Object.freeze({
      /** Terminal host teardown; immutable reads/captures remain available for inspection. */
      dispose() {
        if (closed) return;
        assert(!busy, "Operation in progress");
        closed = true;
        binding++;
        lifecycle++;
        preview = undefined;
        for (const job of jobs.values()) job.cancel();
        if (!config.scheduler) scheduler.dispose();
        history.length = 0;
        future.length = 0;
        listeners.clear();
      },
      apply(
        expected: Stamp,
        id: string,
        commands: readonly d.Command[],
        nextResources?: Resources,
      ) {
        return guarded(
          expected,
          () => {
            if (nextResources)
              assert(
                expected.evidence === doc.evidenceSequence,
                "Resource replacement is stale after evidence arrival",
              );
            reserve(commands);
            const next = d.prepare(doc, id, commands, config.schemas);
            for (const c of commands)
              if (c.kind === "create" || c.kind === "revise")
                for (const id of config.schemas
                  .get(c.revision.schema)
                  ?.evidence?.(c.revision.body) ?? [])
                  assert(receipts.get(id), "Cited receipt unavailable");
            validateDocument(next.document);
            const candidateResources = nextResources
              ? replaceExecutionResources(resources, nextResources)
              : resources;
            validateState(next.document, receipts, candidateResources);
            recordReserved(commands);
            resources = candidateResources;
            publish(next.document, next.changes);
            return next;
          },
          id,
        );
      },
      undo(expected: Stamp, id: string) {
        return guarded(
          expected,
          () => {
            const previous = history.at(-1);
            assert(previous, "No retained Undo");
            assert(!doc.readOnly, "Read-only document");
            const next = validateState(
              validateDocument(d.restore(doc, previous.selection, id)),
            );
            future.push({
              selection: d.selection(doc),
              changes: previous.changes,
            });
            doc = next;
            history.pop();
            usedRoots.add(id);
            original = undefined;
            notify(previous.changes);
            return doc;
          },
          id,
        );
      },
      redo(expected: Stamp, id: string) {
        return guarded(
          expected,
          () => {
            const next = future.at(-1);
            assert(next, "No retained Redo");
            assert(
              !doc.readOnly && !preview,
              "Finish the active preview before Redo",
            );
            const restored = validateState(
              validateDocument(d.restore(doc, next.selection, id)),
            );
            history.push({
              selection: d.selection(doc),
              changes: next.changes,
            });
            future.pop();
            doc = restored;
            usedRoots.add(id);
            original = undefined;
            notify(next.changes);
            return doc;
          },
          id,
        );
      },
      preview(
        expected: Stamp,
        target: Reference,
        overrides: readonly Readonly<{ item: string; revision: Revision }>[],
      ) {
        return guarded(expected, () => {
          const commands = overrides.map((v) => ({
            kind: "revise" as const,
            ...v,
          }));
          reserve(commands);
          const candidate = d.prepare(
            doc,
            config.namespace + ":preview:" + ++serial,
            commands,
            config.schemas,
          );
          for (const c of commands)
            for (const id of config.schemas
              .get(c.revision.schema)
              ?.evidence?.(c.revision.body) ?? [])
              assert(receipts.get(id), "Cited receipt unavailable");
          validateDocument(candidate.document);
          validateState(candidate.document);
          const selected = captureSelection(
              candidate.document,
              target,
              config.schemas,
            ),
            before = captureSelection(doc, target, config.schemas),
            guard = guardSelection(doc, before, selected),
            context = selected.context;
          recordReserved(commands);
          lifecycle++;
          preview = Object.freeze({
            token: config.namespace + ":preview-token:" + serial,
            document: candidate.document,
            context,
            guard: guard.heads,
            pinGuard: guard.pins,
          });
          previewGuards.set(preview, guard);
          notify(noChanges, false, true);
          return preview;
        });
      },
      cancelPreview(expected: Stamp) {
        return guarded(expected, () => {
          lifecycle++;
          preview = undefined;
          notify(noChanges, false, true);
        });
      },
      keep(
        expected: Stamp,
        id: string,
        alternativeId: string,
        label: string,
        view: View,
      ) {
        return guarded(
          expected,
          () => {
            assert(preview, "No active preview");
            assert(
              !usedAlternatives.has(alternativeId),
              "Alternative identity reused",
            );
            const guard = previewGuards.get(preview);
            assert(guard, "Preview guard unavailable");
            assertSelectionUnchanged(doc, guard);
            const next = d.keep(
              doc,
              id,
              { id: alternativeId, label, context: preview.context },
              view,
              preview.document,
              config.schemas,
            );
            validateDocument(next.document);
            validateState(next.document);
            usedAlternatives.add(alternativeId);
            publish(next.document, next.changes, true);
            return next;
          },
          id,
        );
      },
      open(expected: Stamp, next: Loaded, nextResources?: Resources) {
        return guarded(
          expected,
          () => {
            // Public callers may build Loaded themselves; revalidate its entire plain contract before adoption.
            const candidate = d.fromPlain(
                d.toPlain(next.document),
                config.schemas,
              ),
              retained = load({ ...next, document: candidate });
            const validated = Object.freeze({
              ...candidate,
              evidenceSequence: retained.order,
              allocated: Object.freeze({
                ...candidate.allocated,
                receipts: SharedMap.from([
                  ...candidate.allocated.receipts.entries(),
                  ...[...retained.rs.entries()].map(
                    ([id]) => [id, true] as const,
                  ),
                ]),
              }),
            });
            const continuous = restoreLayout(next, {
              document: validated,
              receipts: retained.rs,
            });
            validateDocument(continuous.document);
            validateState(
              continuous.document,
              continuous.receipts,
              nextResources ?? next.resources,
            );
            for (const j of jobs.values()) j.cancel();
            doc = continuous.document;
            resources = nextResources ?? next.resources;
            original = next.original;
            receipts = continuous.receipts;
            byKey = retained.index;
            binding++;
            preview = undefined;
            history.length = 0;
            future.length = 0;
            usedRoots.clear();
            usedRoots.add(doc.id);
            reservedRevisions.clear();
            usedAlternatives.clear();
            for (const [id] of doc.alternatives.entries())
              usedAlternatives.add(id);
            notify(
              {
                items: [...doc.items.entries()].map(([id]) => id),
                affected: [],
                views: [...doc.views.entries()].map(([id]) => id),
                alternatives: [...doc.alternatives.entries()].map(([id]) => id),
              },
              true,
              true,
            );
            return doc;
          },
          undefined,
          true,
        );
      },
      compact(
        expected: Stamp,
        id: string,
        review: ReturnType<typeof reviewCompaction>,
        nextResources?: Resources,
      ) {
        return guarded(
          expected,
          () => {
            const state = reviews.get(review);
            assert(
              state &&
                state.document === doc &&
                state.receipts === receipts &&
                state.lifecycle === lifecycle &&
                state.preview === preview &&
                state.binding === binding,
              "Compaction review is stale or belongs to another workspace",
            );
            assert(
              Number.isSafeInteger(doc.evidenceSequence + 1) &&
                Number.isSafeInteger(doc.sequence + 1),
              "Compaction sequence exhausted",
            );
            const index = SharedMap.empty<string>();
            let associations = index;
            for (const [rid, r] of state.candidate.receipts.entries()) {
              const old = associations.get(r.key);
              if (!old || state.candidate.receipts.get(old)!.order < r.order)
                associations = associations.set(r.key, rid);
            }
            const candidate = validateDocument(
              Object.freeze({
                ...state.candidate.document,
                id,
                sequence: doc.sequence + 1,
                evidenceSequence: doc.evidenceSequence + 1,
              }),
            );
            const retainedResources = retainExecutionResources(
              resources,
              state.candidate.assets,
              nextResources,
            );
            validateState(
              candidate,
              state.candidate.receipts,
              retainedResources,
            );
            doc = candidate;
            receipts = state.candidate.receipts;
            byKey = associations;
            resources = retainedResources;
            usedRoots.add(id);
            original = undefined;
            reviews.delete(review);
            notify(noChanges, true);
            return review;
          },
          id,
          true,
        );
      },
      compute(expected: Stamp, target: Reference, scope: Scope = "baseline") {
        try {
          gate(expected);
          assert(!doc.readOnly, "Read-only document cannot execute");
          const { got, source } = executionSelection(target, scope);
          assert(
            ![...jobs.values()].some(
              (j) => j.binding === binding && j.captured.key === got.key,
            ),
            "Matching job already pending",
          );
          assert(jobs.size < maxJobs, "Executor queue full");
          assert(
            Number.isSafeInteger(doc.evidenceSequence + 1),
            "Evidence order exhausted",
          );
          // Reserve bounded output/header space before executing; durable history never silently evicts.
          const reservation =
            3 * byteLength(got.key) +
            byteLength(
              canonical(d.contextToPlain(got.context) as unknown as Json),
            ) +
            (isTypedSnapshot(got.snapshot) ? 256 * 1024 : byteLength(got.key)) +
            4096;
          assert(
            receipts.size + jobs.size < maxReceipts &&
              evidenceBytes() +
                [...jobs.values()].reduce(
                  (sum, job) => sum + job.evidenceBytes,
                  reservation,
                ) <=
                maxEvidenceBytes,
            "Execution evidence budget exceeded; review retained history",
          );
          let id: string;
          do {
            id = config.namespace + ":job:" + ++serial;
          } while (doc.allocated.receipts.get(id + ":receipt"));
          const snapshot = got.snapshot;
          const typedMethod = isTypedSnapshot(snapshot)
            ? methods.typed?.get(snapshot.method)
            : undefined;
          assert(
            isTypedSnapshot(snapshot)
              ? config.typedExecutor && typedMethod
              : config.executor,
            "Executor unavailable",
          );
          let executionSignal: AbortSignal | undefined;
          const lease = acquireExecutionResources(
            isTypedSnapshot(snapshot) ? snapshot.assets : [],
            resources,
            typedMethod?.limits.outputBytes ?? 0,
            () => executionSignal,
          );
          let task;
          try {
            assert(
              [...jobs.values()].reduce(
                (sum, job) => sum + job.inputBytes,
                lease.inputBytes,
              ) <= maxInputBytes,
              "Execution input byte budget exceeded",
            );
            task = scheduler.submit(async (signal) => {
              executionSignal = signal;
              if (isTypedSnapshot(snapshot)) {
                if (snapshot.assets.length) await lease.verify();
                const checked = validateTypedOutput(
                  typedMethod!,
                  snapshot,
                  await config.typedExecutor!(snapshot, signal, lease.io),
                );
                const output = lease.output(checked.assets);
                validateTypedOutputResources(
                  typedMethod!,
                  snapshot,
                  checked.output,
                  checked.assets,
                  output.resources,
                );
                return {
                  outcome: { status: "success" as const, ...checked },
                  staged: output.staged,
                };
              }
              return {
                outcome: {
                  status: "success" as const,
                  output: validateOutput(
                    snapshot,
                    await config.executor!(snapshot, signal),
                  ),
                },
                staged: new Map<
                  string,
                  Readonly<{ data: string; size: number }>
                >(),
              };
            });
          } catch (error) {
            lease.close();
            throw error;
          }
          const job: Job = Object.freeze({
            id,
            binding,
            source,
            captured: got,
            cancel: task.cancel,
            inputBytes: lease.inputBytes,
            evidenceBytes: reservation,
          });
          jobs.set(id, job);
          lifecycle++;
          const completion = task.completion.then((settled) => {
            lease.close();
            jobs.delete(id);
            lifecycle++;
            if (job.binding !== binding) {
              notify();
              return { status: "discarded" as const };
            }
            let entered = false;
            try {
              assert(!closed && !busy, "Operation in progress or owner closed");
              busy = true;
              entered = true;
              let outcome: Outcome | TypedOutcome =
                settled.status === "success"
                  ? settled.value.outcome
                  : { status: "failed", reason: settled.reason };
              let nextResources = resources;
              if (settled.status === "success") {
                try {
                  nextResources = publishExecutionResources(
                    resources,
                    settled.value.staged,
                  );
                } catch (error) {
                  outcome = {
                    status: "failed",
                    reason: String(error).slice(0, 2000),
                  };
                }
              }
              let revisions = doc.revisions,
                known = doc.known,
                allocated = doc.allocated;
              const cost = mapWork();
              for (const [rid] of got.context.revisions.entries()) {
                const r = job.source.revisions.get(rid)!;
                const prior = revisions.get(rid, cost);
                assert(
                  !prior || prior === r,
                  "Immutable evidence source conflict",
                );
                if (!prior) {
                  assert(
                    !allocated.revisions.get(rid),
                    "Retired evidence source identity reused",
                  );
                  allocated = Object.freeze({
                    ...allocated,
                    revisions: allocated.revisions.set(rid, true, cost),
                  });
                  revisions = revisions.set(rid, r, cost);
                  known = known.set(r.item, true, cost);
                }
              }
              assert(
                Number.isSafeInteger(doc.evidenceSequence + 1),
                "Evidence order exhausted",
              );
              const metadata = {
                id: id + ":receipt",
                order: doc.evidenceSequence + 1,
                context: got.context,
                requestRevision: got.requestRevision,
                key: got.key,
              };
              const receipt: Receipt = isTypedSnapshot(snapshot)
                ? Object.freeze({
                    ...metadata,
                    kind: "typed@1",
                    time: new Date().toISOString(),
                    snapshot,
                    outcome: freeze(outcome) as TypedOutcome,
                    physicalValidity: "not-assessed",
                  })
                : Object.freeze({
                    ...metadata,
                    snapshot,
                    outcome: freeze(outcome) as Outcome,
                    physicalValidity: "not-assessed",
                  });
              assert(
                receiptBytes(receipt) <= job.evidenceBytes &&
                  evidenceBytes() + receiptBytes(receipt) <= maxEvidenceBytes,
                "Execution evidence exceeds its reserved budget",
              );
              const next = Object.freeze({
                ...doc,
                revisions,
                known,
                allocated: Object.freeze({
                  ...allocated,
                  receipts: allocated.receipts.set(receipt.id, true, cost),
                }),
                evidenceSequence: doc.evidenceSequence + 1,
              });
              const nextReceipts = receipts.set(receipt.id, receipt, cost),
                nextIndex = byKey.set(receipt.key, receipt.id, cost);
              validateState(next, nextReceipts, nextResources);
              doc = next;
              receipts = nextReceipts;
              byKey = nextIndex;
              resources = nextResources;
              original = undefined;
              notify(noChanges, true, false, [receipt.id]);
              return { status: "retained" as const, receipt, cost };
            } catch (e) {
              notify();
              return { status: "discarded" as const, reason: String(e) };
            } finally {
              if (entered) busy = false;
            }
          });
          notify();
          return {
            ok: true as const,
            value: { id, completion, cancel: task.cancel },
          };
        } catch (e) {
          return failure(e);
        }
      },
    }),
  });
}
