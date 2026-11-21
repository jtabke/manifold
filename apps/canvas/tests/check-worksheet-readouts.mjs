import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  freeNoteAlias,
  noteReferences,
  noteToken,
} from "../src/regions/noteReferences.ts";
import {
  isPreviewReading,
  worksheetReadout,
} from "../src/regions/worksheetReadout.ts";
import { restoreMemory } from "../src/regions/workspaceMemory.ts";

const s = new RegionSession();
const write = (id, text, bindings) => {
  const r = s.write(id, text, false, bindings);
  assert.ok(r.ok, r.error);
};
const add = (text, bindings) => {
  const id = s.create();
  write(id, text, bindings);
  return id;
};
const input = add("p_drop := 7500 Pa"),
  flow = add("Q := 0.007697 m^3/s"),
  limit = add("Q >= 0.006 m^3/s"),
  upper = add("Q < 0.007 m^3/s");
const bindings = { Q: flow, Q_check: limit, Q_check_2: upper };
const text =
  "Q and {{Q}}. Lower: {{?Q_check}}. Upper: {{?Q_check_2}}. Not Q2 or {{flow}}.";
const note = add(text, bindings),
  refs = noteReferences(text, bindings);
assert.deepEqual(
  refs.map((r) => [r.id, r.mode]),
  [
    [flow, "name"],
    [flow, "value"],
    [limit, "status"],
    [upper, "status"],
  ],
);
for (const ref of refs)
  assert.equal(text.slice(ref.start, ref.end), noteToken(ref.alias, ref.mode));
assert.equal(freeNoteAlias("Q_check", upper, bindings), "Q_check_2");
assert.deepEqual(noteReferences("{{Q}}", {}), []);
assert.deepEqual(noteReferences("constructor then __proto__", {}), []);
const get = (id) => worksheetReadout(project(s.state), id);
const expression = add("2 * 5 W");
assert.equal(get(expression).label, "2 * 5 W");
assert.equal(get(expression).text, "10 W");
assert.equal(get(input).text, "7.5 kPa");
assert.equal(get(flow).text, "7.697 L/s");
assert.deepEqual([get(limit).label, get(limit).text], ["Q ≥ 6 L/s", "met"]);
assert.deepEqual([get(upper).label, get(upper).text], ["Q < 7 L/s", "not met"]);
assert.equal(isPreviewReading(project(s.state), limit, flow), true);
assert.equal(isPreviewReading(project(s.state), limit, input), false);
// Duplicate note and sources together. Copied prose stays bound to copied regions; identity, not spelling, chooses the row.
const [copyFlow, copyCheck, copyNote] = s.duplicateRegions(
  [flow, limit, note],
  {},
);
const copied = s.state.regions.find((r) => r.id === copyNote),
  copiedRefs = noteReferences(copied.text, s.state.links[copyNote]);
assert.deepEqual(
  copiedRefs.map((r) => r.id),
  [copyFlow, copyFlow, copyCheck, upper],
);
write(copyFlow, "Q_copy := 0.004 m^3/s");
assert.equal(get(copyCheck).text, "not met");
assert.equal(get(limit).text, "met");
write(flow, "flow := 0.007697 m^3/s");
assert.deepEqual(
  noteReferences(
    s.state.regions.find((r) => r.id === note).text,
    s.state.links[note],
  ).map((r) => r.id),
  [flow, flow, limit, upper],
);
assert.match(get(limit).label, /^flow/);
assert.equal(s.state.regions.find((r) => r.id === note).text, text);
assert.equal(s.state.links[note].flow, undefined);
s.branch();
write(flow, "flow := 0.00384845 m^3/s");
assert.equal(get(flow).text, "3.848 L/s");
assert.equal(get(limit).text, "not met");
s.switchContext("original");
assert.equal(get(limit).text, "met");
// An invalid source or missing identity never borrows another region's value.
write(flow, "flow := missing");
assert.equal(get(flow).available, false);
assert.equal(get(limit).available, false);
s.undo();
const duplicate = add("flow := 0.007 m^3/s");
assert.equal(get(flow).available, false);
assert.equal(get(duplicate).available, false);
s.undo();
assert.equal(get(flow).available, true);
const isolated = add("watch_me := 10 W"),
  sentence = add("Monitor {{watch_me}}.", { watch_me: isolated });
assert.throws(() => s.deleteRegions([isolated]), /reference/);
write(sentence, "No longer monitoring.");
assert.equal(s.state.links?.[sentence]?.watch_me, undefined);
s.deleteRegions([isolated]);
assert.equal(get(isolated), undefined);
s.undo();
s.undo();
assert.equal(s.state.links[sentence].watch_me, isolated);
const memory = JSON.stringify({
  document: "one",
  version: 2,
  camera: { x: 0, y: 0, zoom: 1 },
  selection: [],
  pinnedResults: [flow, limit, flow, "wrong", null],
});
assert.deepEqual(restoreMemory(memory, s.state, [], "one").pinnedResults, [
  flow,
  limit,
]);
assert.equal(restoreMemory(memory, s.state, [], "two"), undefined);
s.dispose();
console.log(
  "Worksheet readouts: explicit per-occurrence live values and status, strict bounds, units, stable links through copy/rename, invalid sources, scenarios, Undo and document-scoped pin identity pass.",
);
