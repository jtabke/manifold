/** Renderer demand over shared core receipts. No result cache, admission or persistence owner. */
import type { Reference } from "@manifold/foundation";
import { samplingJob, samplingReference } from "./samplingPlans.ts";
import { samplingReceipt } from "./samplingExecution.ts";
import type { Artifact, Job } from "./artifacts.ts";
import type { RegionSession } from "./document.ts";
export { samplerExecutor, sourceHash } from "./samplingExecution.ts";
type Immutable<T> = T extends Reference
  ? T
  : T extends object
    ? { readonly [K in keyof T]: Immutable<T[K]> }
    : T;
export type ComputedResult = Immutable<NonNullable<Artifact["receipt"]>>;
export type ArtifactJob = Immutable<Omit<Job, "legacy">>;
export type ArtifactExecutor = (
  job: ArtifactJob,
  signal: AbortSignal,
) => Promise<unknown>;
export type ArtifactRuntime = Readonly<{
  job?: ArtifactJob;
  receipt?: ComputedResult;
  status: "current" | "running" | "blocked" | "failed" | "ready";
  error: string;
  current: boolean;
  run: () => void;
}>;
export const runtimeKey = (artifact: string, context: string) =>
  `${artifact}:${context}`;
type Host = Pick<
  RegionSession,
  | "state"
  | "document"
  | "artifacts"
  | "subscribe"
  | "foundation"
  | "compute"
  | "samplingAvailable"
  | "executionDiagnostics"
>;
export function createArtifactComputations(
  host: Host,
  options: { paused?: readonly string[] } = {},
) {
  const paused = new Set(options.paused),
    running = new Map<string, { key: string; cancel: () => void }>(),
    pending = new Set<Promise<unknown>>(),
    listeners = new Set<() => void>(),
    errors = new Map<string, string>();
  let wanted: readonly string[] = [],
    version = 0,
    attachments = 0,
    closed = false,
    unsubscribe: (() => void) | undefined,
    refreshing = false;
  function emit() {
    version++;
    for (const listener of listeners)
      try {
        listener();
      } catch {
        /* Read observers cannot own execution. */
      }
  }
  function inspect(artifact: string, context: string) {
    if (
      closed ||
      !host.artifacts.some((a) => a.id === artifact) ||
      !host.state.contexts.some((c) => c.id === context)
    )
      return {
        status: "blocked" as const,
        error: closed
          ? "Computation owner is closed"
          : "Calculation is unavailable",
      };
    try {
      const job = samplingJob(host.document, artifact, context),
        state = host.foundation.result(
          samplingReference(host.document, artifact, context),
        );
      if (state.status === "blocked")
        return { job, status: "blocked" as const, error: state.reason };
      const receipt =
        "receipt" in state && state.receipt
          ? samplingReceipt(state.receipt)
          : undefined;
      return {
        job,
        receipt,
        status:
          state.status === "pending" ? ("running" as const) : state.status,
        error:
          state.status === "failed" && state.receipt.outcome.status === "failed"
            ? state.receipt.outcome.reason
            : "",
      };
    } catch (failure) {
      return {
        status: "blocked" as const,
        error: String(failure).slice(0, 2000),
      };
    }
  }
  function start(artifact: string, context: string, force = false) {
    const slot = runtimeKey(artifact, context),
      state = inspect(artifact, context);
    if (
      !state.job ||
      state.status === "running" ||
      (!force && state.status !== "ready") ||
      !host.samplingAvailable ||
      host.document.readOnly ||
      (!force && paused.has(artifact))
    )
      return;
    try {
      const task = host.compute(
          samplingReference(host.document, artifact, context),
        ),
        entry = { key: state.job.key, cancel: task.cancel };
      running.set(slot, entry);
      errors.delete(slot);
      const done = task.completion.then(() => {
        pending.delete(done);
        if (running.get(slot) === entry) running.delete(slot);
        if (!closed) {
          refresh();
          emit();
        }
      });
      pending.add(done);
    } catch (failure) {
      errors.set(slot, String(failure).slice(0, 2000));
    }
  }
  function refresh() {
    if (closed || !attachments || refreshing) return;
    refreshing = true;
    try {
      const artifacts = new Set(host.artifacts.map((a) => a.id)),
        contexts = new Set(host.state.contexts.map((c) => c.id)),
        needed = new Set([
          host.state.active,
          ...wanted,
          ...host.artifacts
            .filter((a) => a.comparing)
            .map((a) => a.compareContext || host.state.active),
        ]);
      for (const [slot, task] of running) {
        const [artifact, context] = slot.split(":");
        if (
          !artifacts.has(artifact!) ||
          !contexts.has(context!) ||
          !needed.has(context!) ||
          inspect(artifact!, context!).job?.key !== task.key
        ) {
          task.cancel();
          running.delete(slot);
        }
      }
      for (const slot of errors.keys()) {
        const [artifact, context] = slot.split(":");
        if (!artifacts.has(artifact!) || !contexts.has(context!))
          errors.delete(slot);
      }
      for (const artifact of artifacts)
        for (const context of needed)
          if (contexts.has(context)) start(artifact, context);
      emit();
    } finally {
      refreshing = false;
    }
  }
  function dispose() {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    for (const task of running.values()) task.cancel();
    running.clear();
    errors.clear();
    emit();
    listeners.clear();
  }
  return Object.freeze({
    setContexts(contexts: readonly string[]) {
      wanted = [...new Set(contexts)].filter((id) =>
        host.state.contexts.some((context) => context.id === id),
      );
      refresh();
    },
    read(artifact: string, context: string): ArtifactRuntime {
      const state = inspect(artifact, context),
        slot = runtimeKey(artifact, context),
        status =
          state.status === "ready" && !host.samplingAvailable
            ? "blocked"
            : state.status;
      return Object.freeze({
        ...state,
        status,
        current: status === "current",
        error:
          state.error ||
          errors.get(slot) ||
          (!host.samplingAvailable && status === "blocked"
            ? "Executor unavailable"
            : ""),
        run() {
          if (closed) return;
          paused.delete(artifact);
          start(artifact, context, true);
          emit();
        },
      });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    attach() {
      if (closed) throw Error("Computation owner is closed");
      attachments++;
      unsubscribe ??= host.subscribe(refresh);
      refresh();
      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        attachments--;
        queueMicrotask(() => {
          if (!attachments) dispose();
        });
      };
    },
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
    diagnostics: () => ({
      ...host.executionDiagnostics,
      activeRequests: pending.size,
      observations: running.size,
    }),
    dispose,
  });
}
