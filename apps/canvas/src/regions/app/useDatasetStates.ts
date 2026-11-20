import { useMemo, useSyncExternalStore } from "react";
import type { Page } from "../document";
import {
  createDatasetSelector,
  type DatasetComputation,
  type DatasetStates,
} from "../datasetModel";
import { createDatasetTask } from "../datasetExecution";

/** Select by exact dependencies during render. Only committed subscriptions
 * launch background work; a superseded input never returns its old result. */
export function useDatasetStates(
  page: Page,
  relations?: readonly DatasetComputation[],
): DatasetStates {
  const select = useMemo(() => createDatasetSelector(createDatasetTask), []);
  const jobs = useMemo(
    () => select(page, relations),
    [page, relations, select],
  );
  const observation = useMemo(() => {
    const entries = Object.entries(jobs);
    const read = (): DatasetStates =>
      Object.freeze(
        Object.fromEntries(entries.map(([id, job]) => [id, job.read()])),
      );
    let states = read();
    return {
      snapshot: () => {
        if (entries.some(([id, job]) => states[id] !== job.read()))
          states = read();
        return states;
      },
      subscribe: (notify: () => void) => {
        const stops = entries.map(([, job]) => job.subscribe(notify));
        return () => {
          for (const stop of stops) stop();
        };
      },
    };
  }, [jobs]);
  return useSyncExternalStore(
    observation.subscribe,
    observation.snapshot,
    observation.snapshot,
  );
}
