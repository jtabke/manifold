import { decodeWorkspace } from "../src/regions/artifacts.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CanvasDocument } from "../src/regions/app/canvasDocument.ts";
import { deeplyFrozen } from "../src/regions/immutableJson.ts";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  RecentCalculations,
  captureWorksheet,
  validateWorksheetReceipt,
} from "../src/regions/worksheetHistory.ts";
import { archive, restore } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import * as f from "@manifold/foundation";
const anonymous = new RegionSession(),
  expression = anonymous.create();
assert.equal(anonymous.write(expression, "1+1").ok, true);
validateWorksheetReceipt(anonymous.receipts.at(-1));
const anonymousKept = anonymous.keepCurrentCalculation("Expression check");
assert.equal(anonymous.state.calculations[0].id, anonymousKept);
const v4 = restore(
  readFileSync(new URL("./canvas-v4.fixture.json", import.meta.url), "utf8"),
);
assert.equal(v4.artifacts[0].receipt.snapshot, 2);
const s = new RegionSession(),
  input = s.create();
s.write(input, "x := 1 mm");
const output = s.create();
s.write(output, "F := 10 N/mm*x");
const initial = s.receipts.at(-1),
  before = s.document;
assert.ok(initial.definitions.every((r) => Object.keys(r).length === 2));
assert.equal(initial.values.F.value, 10);
validateWorksheetReceipt(initial);
s.evaluate();
assert.equal(s.receipts.at(-1).id, initial.id);
assert.equal(s.document, before);
s.move(output, { x: 300, y: 400 });
assert.equal(s.currentCalculation().key, initial.key);
const note = s.create();
s.write(note, "Assumption discussion");
assert.equal(s.currentCalculation().key, initial.key);
for (let i = 0; i < 400; i++) s.write(input, `x := ${i + 2} mm`);
assert.ok(s.receipts.length <= 128);
assert.ok(s.recentHistory.bytes <= 8 * 1024 * 1024);
assert.equal(
  initial.values.F.value,
  10,
  "external readers keep original immutable values",
);
assert.throws(() => s.keepCalculation(initial.id), /no longer/);
const chosen = s.receipts.at(-20),
  roots = s.document,
  counts = s.recentHistory.entries;
const kept = s.keepCalculation(chosen.id, "Earlier load case");
assert.notEqual(s.document, roots);
assert.equal(s.recentHistory.entries, counts);
assert.equal(
  s.state.calculations[0].snapshot.values.F.value,
  chosen.values.F.value,
);
assert.notEqual(
  chosen.values.F.value,
  project(s.state).solved.values.get("F").value,
);
const keptRoot = s.document;
assert.equal(s.keepCalculation(chosen.id), kept);
assert.equal(s.document, keptRoot);
s.removeCalculation(kept);
assert.equal(s.state.calculations.length, 0);
s.undo();
assert.equal(s.state.calculations[0].id, kept);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(s);
s.clearRecentCalculations();
assert.equal(s.receipts.length, 0);
assert.equal(s.isSaved, true);
const round = await decodeWorkspace(archive(s.native()));
assert.equal(JSON.parse(archive(s.native())).version, 7);
const reopened = new RegionSession(
  round.page,
  () => [],
  round.document,
  round.artifacts,
);
assert.equal(reopened.receipts.length, 0);
assert.equal(
  reopened.state.calculations[0].snapshot.values.F.value,
  chosen.values.F.value,
);
const reader = canvasLocalStore(backend),
  loaded = await reader.load();
const local = new RegionSession(
  loaded.page,
  () => [],
  loaded.document,
  loaded.artifacts,
  false,
  loaded.recovery,
);
assert.equal(local.state.calculations[0].label, "Earlier load case");
// Rejected numeric/identity/binding data cannot become kept evidence, including shallow frozen input.
for (const change of [
  (r) => r.values.F.value++,
  (r) => (r.key = "forged"),
  (r) => (r.definitions[0].text = "x := 900 mm"),
  (r) => (r.method = "unknown/1"),
]) {
  const bad = structuredClone(chosen);
  change(bad);
  Object.freeze(bad);
  assert.throws(() => validateWorksheetReceipt(bad));
}
const shallow = structuredClone(chosen);
Object.freeze(shallow);
validateWorksheetReceipt(shallow);
shallow.values.F.value++;
assert.throws(() => validateWorksheetReceipt(shallow), /output/);
// Shared CSV payload is counted once across recents and never copied into mathematical snapshots.
const data = s.importData(
    "source.csv",
    "gain,comment\n10," + "z".repeat(20000),
    { x: 500, y: 600 },
  ),
  gain = s.quantityFromCell(data, 0, 0, "gain", "N/mm", { x: 300, y: 600 });
s.write(output, "F := gain*x");
const sourceReceipt = s.receipts.at(-1),
  pin = sourceReceipt.sources[0].reference;
assert.equal(sourceReceipt.sources[0].region, gain);
assert.equal(JSON.stringify(sourceReceipt).includes("zzzzzzzz"), false);
const pool = new RecentCalculations({ entries: 3, bytes: 100000 });
pool.record(sourceReceipt, s.document);
const firstBytes = pool.diagnostics.bytes;
s.write(input, "x := 9 mm");
pool.record(s.receipts.at(-1), s.document);
assert.equal(pool.diagnostics.sources, 1);
assert.ok(pool.diagnostics.bytes - firstBytes < 10000);
const tiny = new RecentCalculations({ entries: 2, bytes: 100 });
assert.equal(tiny.record(sourceReceipt, s.document), false);
assert.equal(tiny.diagnostics.entries, 0);
assert.equal(tiny.diagnostics.omitted, 1);
const releasing = new RecentCalculations({ entries: 1, bytes: 100000 });
releasing.record(sourceReceipt, s.document);
releasing.record(anonymous.receipts.at(-1), anonymous.document);
assert.equal(releasing.diagnostics.sources, 0);
assert.equal(releasing.references.length, 0);
const refusing = new RecentCalculations({ entries: 3, bytes: 5000 });
refusing.record(anonymous.receipts.at(-1), anonymous.document);
assert.equal(refusing.record(sourceReceipt, s.document), false);
assert.equal(refusing.receipts[0].id, anonymous.receipts.at(-1).id);
// Undo can remove all live/Undo source roots while the bounded recent observation remains keepable.
const transient = new RegionSession(),
  td = transient.importData("old.csv", "k\n10", { x: 0, y: 0 });
transient.quantityFromCell(td, 0, 0, "k", "N/mm", { x: 0, y: 100 });
const tx = transient.create();
transient.write(tx, "x := 1 mm");
const tf = transient.create();
transient.write(tf, "F := k*x");
const earlier = transient.receipts.at(-1),
  tp = earlier.sources[0].reference;
while (transient.canUndo) transient.undo();
assert.equal(transient.state.regions.length, 0);
transient.compact(transient.reviewRetention());
assert.equal(f.resolve(transient.document, tp).status, "resolved");
transient.keepCalculation(earlier.id, "Restorable observation");
assert.equal(transient.state.calculations[0].snapshot.values.F.value, 10);
transient.undo();
transient.clearRecentCalculations();
transient.compact(transient.reviewRetention());
assert.equal(
  f.resolve(transient.document, tp).status,
  "resolved",
  "Redo retains the kept calculation's sources",
);
transient.write(transient.create(), "A fresh branch");
assert.equal(transient.canRedo, false);
transient.compact(transient.reviewRetention());
assert.equal(f.resolve(transient.document, tp).status, "missing");
// The cached recent observation protects a source revision that the live source has since left.
const keptSource = s.keepCalculation(sourceReceipt.id, "Measured original"),
  sourceRev = f.resolve(s.document, pin).revision;
for (let i = 0; i < 300; i++) s.write(input, `x := ${i + 20} mm`);
s.clearRecentCalculations();
s.compact(s.reviewRetention());
assert.equal(f.resolve(s.document, pin).status, "resolved");
assert.equal(
  s.state.calculations.find((c) => c.id === keptSource).snapshot.sources[0]
    .reference.selection.revision,
  sourceRev.id,
);
// A kept record retains the original source even after actual source deletion and old Undo expiry.
const owner = new CanvasDocument(s.state, s.document, s.artifacts);
owner.apply({
  ...owner.page,
  regions: owner.page.regions.filter((r) => r.id !== data),
  layout: Object.fromEntries(
    Object.entries(owner.page.layout).filter(([id]) => id !== data),
  ),
});
for (let i = 0; i < 270; i++)
  owner.apply({
    ...owner.page,
    regions: owner.page.regions.map((r) =>
      r.id === input ? { ...r, text: `x := ${i + 500} mm` } : r,
    ),
  });
owner.compact(owner.reviewRetention());
const unavailable = captureWorksheet(owner.page, owner.document);
assert.equal(unavailable.unavailableSources.length, 1);
validateWorksheetReceipt(unavailable);
assert.equal(f.resolve(owner.document, pin).status, "resolved");
const deletedSource = await decodeWorkspace(archive(owner.native()));
assert.equal(
  f.resolve(deletedSource.document, pin).revision.body.value.data.csv,
  sourceRev.body.value.data.csv,
);
// Shallow freezing cannot establish validator reuse; cycles/accessors are never read as JSON.
const cycle = {};
cycle.self = cycle;
Object.freeze(cycle);
assert.equal(deeplyFrozen(cycle), false);
let accessed = false;
const accessor = Object.freeze(
  Object.defineProperty({}, "read", {
    enumerable: true,
    get() {
      accessed = true;
      return 1;
    },
  }),
);
assert.equal(deeplyFrozen(accessor), false);
assert.equal(accessed, false);
const sourceWire = archive(s.native()),
  sourceOpen = await decodeWorkspace(sourceWire);
assert.equal(f.resolve(sourceOpen.document, pin).status, "resolved");
const wrong = JSON.parse(sourceWire);
const values = Object.values(wrong.foundation.document.revisions);
const record = values.find(
  (r) => r.schema === "canvas-calculation@1" && r.body.value.id === keptSource,
);
record.body.value.snapshot.sources[0].raw = "11";
await assert.rejects(
  () => decodeWorkspace(JSON.stringify(wrong)),
  /source|snapshot|cell/i,
);
// Changing only temporary recency invalidates a history-cleanup review without dirtying accepted work.
const reviewed = s.reviewRetention(),
  root = s.document;
s.evaluate();
assert.equal(s.document, root);
assert.throws(() => s.compact(reviewed), /stale/);
console.log(
  "Calculation history: bounded immutable recency, duplicate reuse, compact source-aware snapshots, explicit Keep/Remove/Undo, source closure, native/local recovery, corruption rejection and stale maintenance reviews pass.",
);
