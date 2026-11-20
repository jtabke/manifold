import {
  createTaskScheduler,
  deeplyFrozen,
  type ScheduledTask,
} from "@manifold/foundation";
import { immutable } from "../notebook/immutable.ts";
import type { DatasetRequest, DatasetState } from "./datasetModel.ts";
import { datasetOutcome } from "./datasetRows.ts";

type Outcome = ReturnType<typeof datasetOutcome>;
// Shared across accepted relations, mapping previews and overlays in this tab. A
// worker is created only when its slot starts, and terminated on every exit.
const scheduler = createTaskScheduler({ concurrency: 1, maxQueued: 256 });
const pending = Object.freeze({ pending: true } as const);
const reviews = new WeakMap<DatasetState, DatasetRequest>();
export const checkedDatasetRequest = (review: DatasetState) =>
  reviews.get(review);

function runWorker(
  input: DatasetRequest,
  signal: AbortSignal,
): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./dataset.worker.ts", import.meta.url), {
      type: "module",
    });
    const close = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      close();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<Outcome>) => {
      close();
      resolve(event.data);
    };
    worker.onmessageerror = worker.onerror = () => {
      close();
      reject(
        Error("The dataset calculation worker could not return a result."),
      );
    };
    try {
      worker.postMessage(input);
    } catch (error) {
      close();
      reject(error);
    }
  });
}

/** Disposable presentation work, not a document change or persisted receipt. */
export function createDatasetTask(raw: DatasetRequest) {
  const input = deeplyFrozen(raw) ? raw : immutable(structuredClone(raw));
  const complete = (outcome: Outcome): DatasetState => {
    const state = immutable(outcome);
    // Only the real evaluator issues this proof. A caller-supplied result, a
    // pending job or a copied result cannot authorize binding a mapping.
    if (state.result) reviews.set(state, input);
    return state;
  };
  // The length test does not parse a cold CSV just to choose its executor.
  const large =
    input.relation.scope.kind === "records"
      ? input.relation.scope.rows.length >= 512
      : (input.source?.csv.length ?? 0) >= 2048;
  let state: DatasetState =
    large && typeof Worker !== "undefined"
      ? pending
      : complete(datasetOutcome(input));
  const listeners = new Set<() => void>();
  let current: ScheduledTask<Outcome> | undefined;
  const publish = (next: DatasetState) => {
    state = next;
    for (const notify of listeners) notify();
  };
  return Object.freeze({
    read: () => state,
    subscribe(notify: () => void) {
      if (state !== pending) return () => {};
      listeners.add(notify);
      if (!current) {
        try {
          const task = (current = scheduler.submit((signal) =>
            runWorker(input, signal),
          ));
          void task.completion.then((outcome) => {
            if (current !== task) return;
            current = undefined;
            if (!listeners.size) return;
            publish(
              outcome.status === "success"
                ? complete(outcome.value)
                : Object.freeze({ error: outcome.reason }),
            );
          });
        } catch (error) {
          publish(Object.freeze({ error: (error as Error).message }));
        }
      }
      return () => {
        listeners.delete(notify);
        // A React re-subscription to the same input set is not a cancellation.
        queueMicrotask(() => {
          if (!listeners.size) {
            const task = current;
            current = undefined;
            task?.cancel();
          }
        });
      };
    },
  });
}
