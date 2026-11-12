import assert from "node:assert/strict";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { canvasSchemas } from "../src/regions/app/canvasDocument.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import {
  insertModel,
  inspectModel,
  modelReference,
  modelRequest,
  setModelInput,
  previewModelInput,
  keepModelPreview,
  reviewModelConnection,
  reviewModelCsv,
  applyModelConnection,
  modelViews,
} from "../src/regions/modelCommands.ts";
const s = new RegionSession(),
  a = insertModel(s, "spring", { x: 100, y: 100 }),
  b = insertModel(s, "spring", { x: 550, y: 100 }),
  c = insertModel(s, "scale", { x: 1000, y: 100 });
const scalar = (session, item, document = session.document, context) => {
  const got = f.project(
    document,
    modelReference(document, item, f.modelPort("force")),
    canvasSchemas,
    session.foundation.resources(),
    context,
  );
  assert.equal(got.status, "resolved", JSON.stringify(got));
  return got.projection.value.value;
};
assert.equal(
  inspectModel(s, a).body.model.selection.revision,
  inspectModel(s, b).body.model.selection.revision,
);
setModelInput(s, b, "displacement", 3);
assert.equal(scalar(s, a), 20);
assert.equal(scalar(s, b), 30);
assert.notEqual(inspectModel(s, a).revision.id, inspectModel(s, b).revision.id);
const review = reviewModelConnection(
  s,
  c,
  "load",
  modelReference(s.document, a, f.modelPort("force")),
);
assert.equal(scalar(s, c), 20, "review is not an accepted binding");
applyModelConnection(s, review);
assert.equal(scalar(s, c), 40);
assert.throws(
  () =>
    reviewModelConnection(
      s,
      c,
      "factor",
      modelReference(s.document, a, f.modelPort("force")),
    ),
  /mismatch/,
);
assert.throws(
  () =>
    reviewModelConnection(
      s,
      c,
      "load",
      modelReference(s.document, a, f.modelNode([], "force")),
    ),
  /public/,
);
setModelInput(s, a, "displacement", 4);
assert.equal(scalar(s, a), 40);
assert.equal(scalar(s, b), 30);
assert.equal(scalar(s, c), 80);
assert.throws(() => applyModelConnection(s, review), /changed/);

// Mixed adapters compose in one authored publication and one Undo, including nested staging.
const before = s.document;
let notices = 0;
const off = s.subscribe(() => notices++);
s.atomic((staged) => {
  setModelInput(staged, a, "displacement", 5);
  staged.atomic((inner) => {
    const note = inner.create();
    inner.write(note, "model note");
  });
  setModelInput(staged, b, "displacement", 6);
});
assert.equal(notices, 1);
assert.equal(scalar(s, a), 50);
assert.equal(scalar(s, b), 60);
s.undo();
off();
assert.equal(s.document.items, before.items);
assert.equal(scalar(s, a), 40);
assert.equal(modelViews(s.document).length, 3);
const worksheet = s.create();
s.write(worksheet, "ordinary note");
assert.equal(scalar(s, c), 80, "worksheet round trip preserves typed content");
const request = modelReference(s.document, modelRequest(a)),
  capture = s.capture();
s.acknowledge(capture);
assert.equal(s.isSaved, true);
const computed = await s.compute(request).completion;
assert.equal(computed.status, "retained");
assert.equal(s.foundation.result(request).status, "current");
assert.equal(
  s.isSaved,
  false,
  "new core evidence is unsaved even with unchanged authored root",
);
const authored = s.document;
const preview = previewModelInput(s, a, "displacement", 9);
assert.equal(s.document, authored);
assert.equal(scalar(s, a, preview.document, preview.context), 90);
await s.compute(request, "preview").completion;
const alternative = keepModelPreview(s, a, "9 mm comparison", {
  x: 100,
  y: 600,
});
assert.equal(scalar(s, a), 40);
assert.equal(s.document.alternatives.size, 1);
assert.equal(s.foundation.result(request, { alternative }).status, "current");

// A CSV binding retains the exact dataset revision, not the entire Page or a copied CSV per receipt.
const dataset = s.importData("measurements.csv", "x\n7\n8\n", {
  x: 10,
  y: 900,
});
const csvReview = reviewModelCsv(s, b, "displacement", dataset, 0, 0, "mm");
applyModelConnection(s, csvReview);
assert.equal(scalar(s, b), 70);
await s.compute(modelReference(s.document, modelRequest(b))).completion;
const selected = {
  context: f.captureContext(
    s.document,
    modelReference(s.document, modelRequest(b)),
    canvasSchemas,
  ),
};
assert.equal(
  selected.context.revisions.size,
  5,
  "request + instance + definition + observation + source",
);
assert.equal(
  [...selected.context.revisions.entries()].some(
    ([id]) => s.document.revisions.get(id).item === "canvas",
  ),
  false,
);

// Real file staging and warm local recovery retain evidence/alternatives and start no computation.
const bytes = archive(s.native());
assert.equal(JSON.parse(bytes).version, 8);
const loaded = await decodeWorkspace(bytes),
  opened = await stageWorkspaceFile(bytes);
assert.equal(scalar(opened, a), 40);
assert.equal(scalar(opened, b), 70);
assert.equal(opened.document.alternatives.size, 1);
assert.equal(opened.foundation.evidence().size, 3);
assert.equal(
  opened.foundation.result(modelReference(opened.document, modelRequest(b)))
    .status,
  "current",
);
assert.equal(opened.computations.diagnostics().running, 0);
const backend = f.memoryBackend(),
  freshRoot = opened.document,
  store = canvasLocalStore(backend);
assert.equal(opened.canUndo, false);
previewModelInput(opened, a, "displacement", 6);
assert.equal(opened.canUndo, true);
opened.undo();
assert.equal(opened.foundation.preview(), undefined);
assert.equal(opened.document, freshRoot);
await store.load();
await store.save(s);
const warmStore = canvasLocalStore(backend),
  warm = await warmStore.load(),
  recovered = new RegionSession(
    warm.page,
    () => [],
    warm.document,
    warm.artifacts,
    false,
    warm.recovery,
  );
assert.equal(warmStore.acknowledgeRecovery(recovered), true);
assert.equal(recovered.isSaved, true);
assert.equal(scalar(recovered, b), 70);
assert.equal(recovered.foundation.evidence().size, 3);
assert.equal(
  f.canonical(f.toPlain(recovered.document)),
  f.canonical(f.toPlain(s.document)),
);
const bad = JSON.parse(bytes);
bad.foundation.receipts[0].snapshot = "missing";
await assert.rejects(() => decodeWorkspace(JSON.stringify(bad)));
assert.equal(loaded.recovery.foundation.receipts.length, 3);
// Included resources are carried by the owner capture, never a second canvas asset store.
const payload = JSON.stringify([[42]]),
  digest = await f.webHash(payload),
  asset = {
    digest,
    size: f.byteLength(payload),
    mediaType: "application/json",
    disposition: "included",
  },
  sourceDocument = f.prepare(
    s.document,
    "asset-import-root",
    [
      {
        kind: "create",
        item: "extra-source",
        label: "Portable source",
        revision: {
          id: "extra-source-v1",
          item: "extra-source",
          schema: "source@1",
          required: true,
          body: {
            asset,
            rows: 1,
            columns: 1,
            interpretation: [
              {
                unit: "N",
                subject: s.document.document,
                frame: "world",
                condition: "nominal",
              },
            ],
          },
        },
      },
    ],
    canvasSchemas,
  ).document,
  sourceResources = await f.MemoryResources.verify(
    [[digest, payload]],
    f.webHash,
  ),
  richWire = JSON.parse(bytes);
richWire.foundation = JSON.parse(
  f.encode(
    sourceDocument,
    [...s.foundation.evidence().entries()].map(([, r]) => r),
    sourceResources,
    canvasSchemas,
  ),
);
const rich = await stageWorkspaceFile(JSON.stringify(richWire));
rich.write(rich.create(), "Asset preserving worksheet edit");
const richBackend = f.memoryBackend(),
  richStore = canvasLocalStore(richBackend);
await richStore.load();
await richStore.save(rich);
const richSaved = await canvasLocalStore(richBackend).load();
assert.equal(richSaved.recovery.foundation.resources.read(asset).data, payload);
const richOpened = await decodeWorkspace(archive(rich.native()));
assert.equal(
  richOpened.recovery.foundation.resources.read(asset).data,
  payload,
);
const corruptResource = JSON.parse(archive(rich.native()));
corruptResource.foundation.assets[digest] = "[[43]]";
await assert.rejects(
  () => stageWorkspaceFile(JSON.stringify(corruptResource)),
  /digest|corrupt|hash/i,
);
// Strict-mode detach/reattach is not a terminal close; actual host teardown is.
const host = new RegionSession(),
  model = insertModel(host, "spring", { x: 0, y: 0 });
const detach = host.attach();
detach();
const again = host.attach();
await Promise.resolve();
setModelInput(host, model, "displacement", 3);
const closing = host.compute(
    modelReference(host.document, modelRequest(model)),
  ).completion,
  atClose = host.document;
again();
await Promise.resolve();
await closing;
assert.equal(
  host.document,
  atClose,
  "a late computation cannot publish after terminal teardown",
);
assert.throws(() => setModelInput(host, model, "displacement", 4), /closed/);
assert.throws(() => host.attach(), /closed/);
const bounded = new RegionSession();
for (let i = 0; i < 64; i++)
  insertModel(bounded, "spring", { x: i * 450, y: 0 });
const atLimit = bounded.document;
assert.throws(() => insertModel(bounded, "spring", { x: 0, y: 0 }), /64/);
assert.equal(
  bounded.document,
  atLimit,
  "view admission failure publishes nothing",
);
bounded.dispose();
console.log(
  "Foundation canvas models: independent instances, reviewed public/CSV bindings, mixed atomic Undo, preview/Keep, evidence, native verification and warm recovery pass.",
);
