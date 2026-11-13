import assert from "node:assert/strict";
import {
  DATASET_PLOT_POINT_LIMIT,
  sampleDatasetPlot,
} from "../src/regions/datasetPlot.ts";

const quantity = (value) => ({ value, dimension: [0, 0, 0, 0] });
const record = (row, x = row, y = row, pass) => ({
  row,
  inputs: { measured: quantity(x) },
  value: quantity(y),
  ...(pass === undefined ? {} : { pass }),
  conditions: pass === undefined ? {} : { limit: pass },
  limits:
    pass === undefined
      ? {}
      : { limit: { bound: quantity(100), relation: "<=" } },
});
const makeRecords = (count, pass) =>
  Array.from({ length: count }, (_, i) => record(i, i, i, pass));
const rowIds = (sample) => sample.records.map((entry) => entry.row);
const expectBudgetAndIdentity = (source, sample) => {
  assert.equal(
    sample.records.length,
    Math.min(source.length, DATASET_PLOT_POINT_LIMIT),
  );
  assert.equal(new Set(sample.records).size, sample.records.length);
  const positions = new Map(source.map((entry, i) => [entry.row, i]));
  let previous = -1;
  for (const entry of sample.records) {
    const index = positions.get(entry.row);
    assert.ok(index > previous, "retain original record order");
    assert.equal(entry, source[index], "retain the original record object");
    previous = index;
  }
};

assert.deepEqual(sampleDatasetPlot([], "measured"), {
  records: [],
  failureCount: 0,
  omittedFailureCount: 0,
  omittedSelectedCount: 0,
});
for (const count of [1, 999, 1000, 1001, 1999, 2000, 10000]) {
  const records = makeRecords(count);
  const before = structuredClone(records);
  for (const entry of records) {
    Object.freeze(entry.inputs.measured);
    Object.freeze(entry.inputs);
    Object.freeze(entry.value);
    Object.freeze(entry);
  }
  Object.freeze(records);
  const sample = sampleDatasetPlot(records, "measured");
  expectBudgetAndIdentity(records, sample);
  assert.deepEqual(records, before, "sampling must not mutate source data");
  assert.equal(sample.failureCount, 0);
  assert.equal(sample.omittedFailureCount, 0);
  assert.equal(sample.omittedSelectedCount, 0);
  assert.equal(sample.records[0], records[0]);
  assert.equal(sample.records.at(-1), records.at(-1));
  assert.deepEqual(
    sampleDatasetPlot(records, "measured"),
    sample,
    "sampling is deterministic",
  );
  if (count === 10000)
    for (let i = 1; i < sample.records.length; i++)
      assert.ok(
        sample.records[i].row - sample.records[i - 1].row <= 12,
        "ordinary fill spans the whole source rather than taking its prefix",
      );
}

// These isolated features all fall between the former ten-row stride points.
const spikes = makeRecords(10000, true);
spikes[3451] = record(3451, -1e6, 20, true);
spikes[6783] = record(6783, 1e6, 20, true);
spikes[2227] = record(2227, 20, -1e6, true);
spikes[4569] = record(4569, 20, 1e6, true);
spikes[9989] = record(9989, 20, 50, false);
const featured = sampleDatasetPlot(spikes, "measured", [7777, 7777, -1]);
expectBudgetAndIdentity(spikes, featured);
for (const row of [0, 9999, 3451, 6783, 2227, 4569, 9989, 7777])
  assert.ok(rowIds(featured).includes(row), `keep important source row ${row}`);
assert.equal(featured.failureCount, 1);
assert.equal(featured.omittedFailureCount, 0);
assert.equal(featured.omittedSelectedCount, 0);

const constrained = makeRecords(10000, true);
for (let i = 100; i < 500; i++) constrained[i] = record(i, i, i, false);
const failuresFit = sampleDatasetPlot(constrained, "measured", [9997]);
expectBudgetAndIdentity(constrained, failuresFit);
assert.equal(failuresFit.failureCount, 400);
assert.equal(failuresFit.omittedFailureCount, 0);
for (let i = 100; i < 500; i++)
  assert.ok(rowIds(failuresFit).includes(i), `keep failing row ${i}`);
assert.ok(rowIds(failuresFit).includes(9997));

const mostlyFailing = makeRecords(10000, false);
mostlyFailing[2347] = record(2347, 2347, 2347, true);
const overBudget = sampleDatasetPlot(mostlyFailing, "measured", [9876, 9997]);
expectBudgetAndIdentity(mostlyFailing, overBudget);
assert.equal(overBudget.failureCount, 9999);
assert.equal(overBudget.omittedFailureCount, 9000);
assert.equal(overBudget.omittedSelectedCount, 0);
assert.ok(rowIds(overBudget).includes(2347), "keep a passing observation too");
assert.ok(rowIds(overBudget).includes(9876));
assert.ok(rowIds(overBudget).includes(9997));
assert.deepEqual(
  sampleDatasetPlot(mostlyFailing, "measured", [9997, 9876]),
  overBudget,
  "selection order does not change the sampled observations",
);

// An oversized selection cannot exceed the rendering bound or hide the only failure.
const selectedRows = spikes.map((entry) => entry.row);
const allSelected = sampleDatasetPlot(spikes, "measured", selectedRows);
expectBudgetAndIdentity(spikes, allSelected);
assert.equal(allSelected.omittedFailureCount, 0);
assert.equal(allSelected.omittedSelectedCount, 9000);
assert.ok(rowIds(allSelected).includes(9989));
assert.deepEqual(
  selectedRows,
  spikes.map((entry) => entry.row),
);

// Scoped/reordered rows use array position for sampling and keep opaque source-row identity.
const scoped = Array.from({ length: 2000 }, (_, i) =>
  record(9000 - i * 2, i % 83, 2000 - i),
);
const originalRows = sampleDatasetPlot(scoped, "measured", [scoped[1777].row]);
expectBudgetAndIdentity(scoped, originalRows);
assert.ok(rowIds(originalRows).includes(scoped[1777].row));
assert.equal(originalRows.omittedSelectedCount, 0);

// Mixed feature/selection counts must still fill the exact budget and report
// omissions from the complete source, never from already sampled records.
for (let variant = 0; variant < 24; variant++) {
  const records = Array.from({ length: 1001 + variant * 97 }, (_, i) =>
    record(
      10000 - i,
      ((i * 43) % 251) - 125,
      ((i * 19) % 157) - 78,
      (i + variant) % 3 !== 0,
    ),
  );
  const selected = records
    .filter((_, i) => i % (variant + 1) === 0)
    .map((entry) => entry.row);
  const sample = sampleDatasetPlot(records, "measured", selected);
  expectBudgetAndIdentity(records, sample);
  assert.equal(
    sample.omittedFailureCount,
    records.filter((entry) => entry.pass === false).length -
      sample.records.filter((entry) => entry.pass === false).length,
  );
  assert.equal(
    sample.omittedSelectedCount,
    selected.length -
      sample.records.filter((entry) => selected.includes(entry.row)).length,
  );
  for (const value of ["x", "y"])
    for (const extremum of [Math.min, Math.max]) {
      const scalar = (entry) =>
        value === "x" ? entry.inputs.measured.value : entry.value.value;
      assert.equal(
        extremum(...sample.records.map(scalar)),
        extremum(...records.map(scalar)),
      );
    }
}

console.log(
  "Dataset plot sampling: bounded original records, source identity/order, endpoints and x/y extrema, late sole violation, all fitting failures, selected rows, mixed outcomes, explicit omissions, deterministic fill and no mutation pass.",
);
