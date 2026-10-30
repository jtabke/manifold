/** Transient executor admission. Authored state, validation and evidence stay with callers. */
import { assert } from "./value.ts";
export type TaskOutcome<T> =
  | Readonly<{ status: "success"; value: T }>
  | Readonly<{ status: "failed" | "cancelled"; reason: string }>;
export type ScheduledTask<T> = Readonly<{
  completion: Promise<TaskOutcome<T>>;
  cancel: () => void;
  state: () => "queued" | "running" | "settled";
}>;
type Entry = {
  start: () => void;
  cancel: (reason: string) => void;
  aborted: () => boolean;
};
const message = (error: unknown) => {
  try {
    return String(error).slice(0, 2000);
  } catch {
    return "Executor failed";
  }
};
export function createTaskScheduler(
  options: {
    concurrency?: number;
    maxQueued?: number;
    deadlineMs?: number;
  } = {},
) {
  const concurrency = options.concurrency ?? 4,
    maxQueued = options.maxQueued ?? 32,
    deadlineMs = options.deadlineMs ?? 30_000;
  assert(
    Number.isSafeInteger(concurrency) &&
      concurrency > 0 &&
      concurrency <= 64 &&
      Number.isSafeInteger(maxQueued) &&
      maxQueued >= 0 &&
      maxQueued <= 1024 &&
      Number.isSafeInteger(deadlineMs) &&
      deadlineMs > 0 &&
      deadlineMs <= 300_000,
    "Invalid task scheduler limits",
  );
  const active = new Set<Entry>(),
    queue: Entry[] = [];
  let closed = false;
  function pump() {
    while (!closed && active.size < concurrency && queue.length) {
      const entry = queue.shift()!;
      active.add(entry);
      entry.start();
    }
  }
  return Object.freeze({
    submit<T>(
      execute: (signal: AbortSignal) => T | Promise<T>,
    ): ScheduledTask<T> {
      assert(!closed, "Execution host is closed");
      assert(
        active.size + queue.length < concurrency + maxQueued,
        "Executor queue full",
      );
      const controller = new AbortController();
      let state: "queued" | "running" | "settled" = "queued";
      let resolve: (outcome: TaskOutcome<T>) => void;
      const completion = new Promise<TaskOutcome<T>>((done) => {
        resolve = done;
      });
      const finish = (outcome: TaskOutcome<T>) => {
        if (state === "settled") return;
        state = "settled";
        clearTimeout(timer);
        active.delete(entry);
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        resolve(Object.freeze(outcome));
        queueMicrotask(pump);
      };
      const entry: Entry = {
        aborted: () => controller.signal.aborted,
        cancel: (reason) => {
          if (state === "settled" || controller.signal.aborted) return;
          controller.abort(reason);
          if (state === "queued") finish({ status: "cancelled", reason });
          // Running work keeps its slot until the adapter actually settles.
        },
        start: () => {
          state = "running";
          let result: T | Promise<T>;
          try {
            result = execute(controller.signal);
          } catch (error) {
            result = Promise.reject(error);
          }
          void Promise.resolve(result).then(
            (value) =>
              finish(
                controller.signal.aborted
                  ? {
                      status: "cancelled",
                      reason: message(controller.signal.reason),
                    }
                  : { status: "success", value },
              ),
            (error) =>
              finish({
                status: controller.signal.aborted ? "cancelled" : "failed",
                reason: message(
                  controller.signal.aborted ? controller.signal.reason : error,
                ),
              }),
          );
        },
      };
      const timer = setTimeout(
        () => entry.cancel("Execution deadline exceeded"),
        deadlineMs,
      );
      // Advisory cancellation alone need not keep a headless host alive.
      (timer as unknown as { unref?: () => void }).unref?.();
      queue.push(entry);
      queueMicrotask(pump);
      return Object.freeze({
        completion,
        cancel: () => entry.cancel("Execution cancelled"),
        state: () => state,
      });
    },
    diagnostics: () =>
      Object.freeze({
        running: active.size,
        queued: queue.length,
        cancelling: [...active].filter((entry) => entry.aborted()).length,
        closed,
      }),
    dispose() {
      if (closed) return;
      closed = true;
      for (const entry of [...queue, ...active])
        entry.cancel("Execution host closed");
    },
  });
}
export type TaskScheduler = ReturnType<typeof createTaskScheduler>;
