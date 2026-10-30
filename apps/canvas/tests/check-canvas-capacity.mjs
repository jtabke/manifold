import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import {
  archive,
  decodeWorkspace,
  inspectWorkspace,
} from "../src/regions/artifacts.ts";
import { canvasWorkspace } from "../src/regions/app/workspaceFiles.ts";
import {
  canvasSchemas,
  canvasMethods,
} from "../src/regions/app/canvasDocument.ts";
import {
  CanvasStorageBudget,
  MAX_CANVAS_LOCAL_BYTES,
  MAX_CANVAS_FILE_BYTES,
} from "../src/regions/app/canvasStorageBudget.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { legacyCapacitySnapshot, withoutScene } from "./capacity-fixture.mjs";
import { checkWorkspaceFileSize } from "../src/regions/app/workspaceCodec.ts";

const csv = "gain,noise\n10," + "u".repeat(900_000);
const page = {
  regions: Array.from({ length: 9 }, (_, index) => ({
    id: "region-data-" + index,
    text: "Source " + index,
    data: { name: index + ".csv", csv },
  })),
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  origin: { x: 110, y: 110 },
  layout: {},
  plots: [],
};
const session = new RegionSession(page),
  backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
const native = archive(session.native()),
  capture = session.capture();
assert.ok(
  f.byteLength(native) > 8_000_000,
  "reproduce the retired file-size mismatch",
);
assert.ok(f.byteLength(native) <= capture.storageUpperBytes);
assert.ok(capture.storageUpperBytes < MAX_CANVAS_LOCAL_BYTES);
await store.save(session);
const physical = await backend.inspect();
assert.ok(physical.after.bytes <= capture.storageUpperBytes);
const data = await decodeWorkspace(native);
assert.equal(data.page.regions.length, 9);
assert.equal(data.page.regions[8].data.csv, csv);
const saved = await store.exportSaved();
assert.equal((await decodeWorkspace(saved)).page.regions[0].data.csv, csv);

// A proposed retained graph above the common budget is refused before changing state/Undo/Save.
const before = session.capture(),
  allocated = before.document.allocated;
const tooMany = f.SharedMap.from(
  Array.from({ length: 75000 }, (_, index) => [
    "retired-capacity:" + index,
    true,
  ]),
);
const oversized = Object.freeze({
  ...before.document,
  allocated: Object.freeze({
    ...allocated,
    revisions: f.SharedMap.from([
      ...allocated.revisions.entries(),
      ...tooMany.entries(),
    ]),
  }),
});
assert.throws(
  () => new RegionSession(page, () => [], oversized),
  /recovery budget/,
);
assert.equal(session.document, before.document);
assert.equal(session.isSaved, true);
const minimal = new RegionSession(),
  minimalDoc = withoutScene(minimal.document);
const oldDoc = Object.freeze({
  ...minimalDoc,
  allocated: Object.freeze({
    ...minimalDoc.allocated,
    revisions: f.SharedMap.from([
      ...minimalDoc.allocated.revisions.entries(),
      ...tooMany.entries(),
    ]),
  }),
});
const legacyText = JSON.stringify({
  format: "manifold-region-artifacts",
  version: 5,
  foundation: JSON.parse(
    f.encode(oldDoc, [], minimal.capture().foundation.resources, canvasSchemas),
  ),
  results: [],
});
assert.ok(
  f.byteLength(legacyText) < 8_000_000,
  "this was a readable old backup",
);
await assert.rejects(() => decodeWorkspace(legacyText), /recovery budget/);
const inspectedLegacy = await inspectWorkspace(legacyText);
assert.equal(
  inspectedLegacy.document.allocated.revisions.size,
  oldDoc.allocated.revisions.size + 1,
  "migration installs the explicit empty scene marker without dropping old identities",
);
const backup = canvasWorkspace({
  session: minimal,
  key: "legacy",
  blocked: true,
  legacyRescue: legacyText,
  reportError: () => {},
  openStore: async () => {
    throw Error("Rescue must not open a new write binding");
  },
});
assert.equal(await backup.rescueSaved(), legacyText);
minimal.dispose();
const budget = new CanvasStorageBudget();
assert.equal(
  budget.check(before.foundation, canvasSchemas),
  before.storageUpperBytes,
);
assert.throws(
  () => checkWorkspaceFileSize(MAX_CANVAS_FILE_BYTES + 1),
  /128 MiB/,
);

// Legacy retained work may validate yet exceed admission policy. Rescue does not adopt, ACK or write it.
const old = await legacyCapacitySnapshot(),
  reader = canvasLocalStore(old.backend),
  head = await old.backend.head();
await assert.rejects(() => reader.load(), /recovery budget/);
const rescued = await reader.exportSaved(),
  envelope = JSON.parse(rescued).foundation;
let selectedSnapshot = await backend.snapshot();
const changing = canvasLocalStore({
  ...backend,
  snapshot: async () => selectedSnapshot,
});
await changing.load();
assert.equal(changing.acknowledgeRecovery(session), true);
selectedSnapshot = old.snapshot;
await assert.rejects(() => changing.load(), /recovery budget/);
assert.equal(
  changing.acknowledgeRecovery(session),
  false,
  "a failed reload cannot ACK an older recovery against the new head",
);
await assert.rejects(changing.save(session), /Open and validate/);
changing.close();
const inspected = await f.decode(
  JSON.stringify(envelope),
  canvasSchemas,
  canvasMethods,
  f.webHash,
  { maxBytes: MAX_CANVAS_FILE_BYTES },
);
assert.equal(inspected.receipts.length, old.count);
assert.deepEqual(await old.backend.head(), head);
assert.equal(
  (await old.backend.snapshot()).state.revision,
  old.snapshot.state.revision,
);
await assert.rejects(
  () => decodeWorkspace(rescued),
  /recovery budget/,
  "a rescued over-policy file is preserved without silently becoming newly admitted work",
);
const unreadable = {
  ...old.backend,
  snapshot: async () => ({ ...old.snapshot, package: async () => undefined }),
};
await assert.rejects(
  () => canvasLocalStore(unreadable).exportSaved(),
  /Missing/,
);
session.dispose();
store.close();
reader.close();
console.log(
  "Canvas capacity: >8 MB native/local handoff, conservative byte bounds, pre-adoption rejection, complete validated legacy rescue, no ACK/write and corrupt rescue rejection pass.",
);
