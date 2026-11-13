/** Bounded display of original observations; never averages or invents records. */
import type { DataRecord } from "./datasetModel.ts";

export const DATASET_PLOT_POINT_LIMIT = 1000;

export type DatasetPlotSample = Readonly<{
  records: readonly DataRecord[];
  failureCount: number;
  omittedFailureCount: number;
  omittedSelectedCount: number;
}>;

/**
 * Keep endpoints, global axis extrema and at least one observation of each
 * requirement outcome. Retain selected rows next, then all failures that fit.
 * Fill the remaining budget evenly from the other original observations.
 * Omission counts keep bounded rendering from concealing unplotted evidence.
 */
export function sampleDatasetPlot(
  records: readonly DataRecord[],
  input: string,
  selectedRows: readonly number[] = [],
): DatasetPlotSample {
  const selected = new Set(selectedRows);
  let failureCount = 0,
    selectedCount = 0,
    firstFailure = -1,
    firstPass = -1,
    minX = 0,
    maxX = 0,
    minY = 0,
    maxY = 0;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.pass === false) {
      failureCount++;
      if (firstFailure < 0) firstFailure = i;
    } else if (record.pass === true && firstPass < 0) firstPass = i;
    if (selected.has(record.row)) selectedCount++;
    if (record.inputs[input].value < records[minX].inputs[input].value)
      minX = i;
    if (record.inputs[input].value > records[maxX].inputs[input].value)
      maxX = i;
    if (record.value.value < records[minY].value.value) minY = i;
    if (record.value.value > records[maxY].value.value) maxY = i;
  }
  if (records.length <= DATASET_PLOT_POINT_LIMIT)
    return {
      records: records.slice(),
      failureCount,
      omittedFailureCount: 0,
      omittedSelectedCount: 0,
    };

  const kept = new Set<number>();
  const keep = (index: number) => {
    if (index >= 0 && kept.size < DATASET_PLOT_POINT_LIMIT) kept.add(index);
  };
  for (const index of [0, records.length - 1, minX, maxX, minY, maxY])
    keep(index);
  keep(firstFailure);
  if (firstFailure >= 0) keep(firstPass);
  for (let i = 0; i < records.length; i++)
    if (selected.has(records[i].row)) keep(i);
  for (let i = 0; i < records.length; i++)
    if (records[i].pass === false) keep(i);

  const available = records.length - kept.size,
    remaining = DATASET_PLOT_POINT_LIMIT - kept.size;
  let position = available / 2;
  for (let i = 0; i < records.length && remaining > 0; i++) {
    if (kept.has(i)) continue;
    position += remaining;
    if (position >= available) {
      keep(i);
      position -= available;
    }
  }
  let plottedFailures = 0,
    plottedSelected = 0;
  const plotted = records.filter((record, index) => {
    if (!kept.has(index)) return false;
    if (record.pass === false) plottedFailures++;
    if (selected.has(record.row)) plottedSelected++;
    return true;
  });
  return {
    records: plotted,
    failureCount,
    omittedFailureCount: failureCount - plottedFailures,
    omittedSelectedCount: selectedCount - plottedSelected,
  };
}
