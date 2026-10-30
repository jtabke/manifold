import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { compileModel, AUTHORED_MODEL } from "../src/regions/authoredModels.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  publishModel,
  instantiateModel,
  inspectModel,
  modelReference,
  modelRequest,
  setModelInput,
  previewModelInput,
  keepModelPreview,
  reviewInstanceUpdate,
  applyInstanceUpdate,
  reviewModelCsv,
  applyModelConnection,
  reviewModelConnection,
} from "../src/regions/modelCommands.ts";
const source = {
  rows: [
    { id: "force", text: "F = 20 N" },
    { id: "speed", text: "v = 3 m/s" },
    { id: "power", text: "P = F*v" },
    { id: "alias", text: "power = P" },
  ],
  inputs: ["force", "speed"],
  outputs: ["power", "alias"],
};
const renamed = {
  ...source,
  rows: source.rows.map((r) => ({
    ...r,
    text: r.text.replaceAll("P", "output"),
  })),
};
assert.deepEqual(
  Object.keys(compileModel(renamed).outputs),
  Object.keys(compileModel(source).outputs),
  "renaming notation preserves public port identity",
);
const s = new RegionSession();
let notices = 0;
const off = s.subscribe(() => notices++);
const a = s.atomic((staged) => {
  const definition = publishModel(staged, "Drive", source);
  return instantiateModel(staged, modelReference(staged.document, definition), {
    x: 0,
    y: 0,
  });
});
assert.equal(
  notices,
  1,
  "publication and first instance share one accepted operation",
);
off();
const pin = inspectModel(s, a).body.model;
const b = instantiateModel(s, pin, { x: 440, y: 0 }, "Drive B");
const value = (
  session,
  id,
  port = "power",
  document = session.document,
  context,
) => {
  const got = f.project(
    document,
    modelReference(document, id, f.modelPort(port)),
    canvasSchemas,
    session.foundation.resources(),
    context,
  );
  assert.equal(got.status, "resolved", JSON.stringify(got));
  return got.projection.value;
};
assert.equal(value(s, a).value, 60);
assert.equal(value(s, a).unit, "W");
assert.equal(value(s, a, "alias").value, 60);
setModelInput(s, b, "speed", 4);
assert.equal(value(s, b).value, 80);
assert.equal(value(s, a).value, 60);
assert.equal(
  inspectModel(s, a).body.model.selection.revision,
  inspectModel(s, b).body.model.selection.revision,
);
const request = modelReference(s.document, modelRequest(a));
assert.equal((await s.compute(request).completion).status, "retained");
const receipt = s.foundation.result(request).receipt;
assert.equal(receipt.kind, "typed@1");
assert.equal(receipt.outcome.output.body.power.value, 60);
assert.equal(receipt.outcome.output.body.alias.unit, "W");
const preview = previewModelInput(s, a, "speed", 5);
assert.equal(
  value(s, a, "power", preview.document, preview.context).value,
  100,
);
await s.compute(request, "preview").completion;
const kept = keepModelPreview(s, a, "5 m/s", { x: 0, y: 500 });
assert.equal(value(s, a).value, 60);
const frozen = s.document.alternatives.get(kept).context;
assert.equal(value(s, a, "power", s.document, frozen).value, 100);
const changed = {
  ...source,
  rows: source.rows.map((r) =>
    r.id === "power" ? { ...r, text: "P = 2*F*v" } : r,
  ),
};
publishModel(s, "Drive revised", changed, pin.item);
assert.equal(
  value(s, a).value,
  60,
  "publishing never updates pinned instances",
);
const review = reviewInstanceUpdate(s, a);
assert.equal(value(s, a).value, 60);
applyInstanceUpdate(s, review);
assert.equal(value(s, a).value, 120);
assert.equal(value(s, b).value, 80);
assert.equal(
  value(s, a, "power", s.document, frozen).value,
  100,
  "kept source and definitions retain old meaning",
);
s.undo();
assert.equal(value(s, a).value, 60);
assert.equal(
  s.foundation.result(request, { alternative: kept }).receipt.outcome.output
    .body.power.value,
  100,
);
assert.throws(
  () => applyInstanceUpdate(s, review),
  /changed/,
  "undo does not make a stale review authoritative",
);
const csv = s.importData("speeds.csv", "v\n7\n8\n", { x: 0, y: 900 });
applyModelConnection(s, reviewModelCsv(s, b, "speed", csv, 0, 0, "m*s^-1"));
assert.equal(value(s, b).value, 140);
const before = s.document;
const removed = {
  ...changed,
  rows: changed.rows.map((r) =>
    r.id === "speed" ? { ...r, text: "v = 3 s" } : r,
  ),
};
publishModel(s, "Different units", removed, pin.item);
assert.throws(() => reviewInstanceUpdate(s, b), /unit|binding/i);
assert.equal(value(s, b).value, 140);
applyInstanceUpdate(s, reviewInstanceUpdate(s, b, true));
assert.equal(value(s, b).unit, "kg*m*s^-1");
s.undo();
assert.equal(value(s, b).value, 140);
// A reviewed update is invalidated by unrelated accepted work; no partial request revision publishes.
const stale = reviewInstanceUpdate(s, a);
const note = s.create();
s.write(note, "review changed");
assert.throws(() => applyInstanceUpdate(s, stale), /changed/);
for (const invalid of [
  {
    ...source,
    rows: [
      { id: "x", text: "x = y" },
      { id: "y", text: "y = x" },
    ],
    inputs: [],
    outputs: ["x"],
  },
  {
    ...source,
    rows: [{ id: "x", text: "x = 1/0" }],
    inputs: [],
    outputs: ["x"],
  },
  {
    ...source,
    rows: [{ id: "x", text: "x = 2 N + 3 m" }],
    inputs: [],
    outputs: ["x"],
  },
  {
    ...source,
    rows: [{ id: "x", text: "x = 20 degC" }],
    inputs: ["x"],
    outputs: ["x"],
  },
  {
    ...source,
    rows: [{ id: "x", text: "x = missing*2" }],
    inputs: [],
    outputs: ["x"],
  },
  {
    ...source,
    rows: [{ id: "x", text: "x <= 2 N" }],
    inputs: [],
    outputs: ["x"],
  },
]) {
  const before = s.document;
  assert.throws(() => publishModel(s, "Invalid", invalid));
  assert.equal(s.document, before);
}
const fresh = s.document,
  body = { source, model: compileModel(source) };
body.model.nodes["n-force"].default = 999;
assert.throws(() =>
  s.applyCommands([
    {
      kind: "create",
      item: "forged",
      label: "Forged",
      revision: {
        item: "forged",
        id: "forged-r1",
        schema: AUTHORED_MODEL,
        required: true,
        body,
      },
    },
  ]),
);
assert.equal(s.document, fresh);
// Same local names across different authored definitions do not collide.
const other = {
  rows: [
    { id: "force", text: "F = 4 kg" },
    { id: "speed", text: "v = 2 m/s" },
    { id: "power", text: "P = F*v^2/2" },
  ],
  inputs: ["force", "speed"],
  outputs: ["power"],
};
const energy = publishModel(s, "Energy", other);
const c = instantiateModel(s, modelReference(s.document, energy), {
  x: 900,
  y: 0,
});
assert.equal(value(s, c).value, 8);
assert.equal(value(s, c).unit, "J");
assert.throws(
  () =>
    reviewModelConnection(
      s,
      c,
      "force",
      modelReference(s.document, a, f.modelPort("power")),
    ),
  /mismatch/,
);
await s.compute(modelReference(s.document, modelRequest(b))).completion;
const text = archive(s.native()),
  opened = await stageWorkspaceFile(text);
assert.equal(value(opened, a).value, value(s, a).value);
assert.equal(value(opened, b).value, 140);
assert.equal(value(opened, c).unit, "J");
assert.equal(opened.document.alternatives.size, 1);
assert.equal(opened.computations.diagnostics().running, 0);
assert.equal(
  value(
    opened,
    a,
    "power",
    opened.document,
    opened.document.alternatives.get(kept).context,
  ).value,
  100,
);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(s);
const loaded = await store.load();
const recovered = new RegionSession(
  loaded.page,
  () => [],
  loaded.document,
  loaded.artifacts,
  false,
  loaded.recovery,
);
assert.equal(value(recovered, b).value, 140);
assert.equal(recovered.computations.diagnostics().running, 0);
assert.equal((await store.save(recovered)).writes.chunks, 0);
for (const session of [s, opened, recovered]) session.dispose();
console.log(
  "Authored models: stable equation ports, multi-unit/output composition, independent instances, shared checked receipts, pinned publication/review/Undo, CSV sources, atomic refusal and native/local recovery pass.",
);
