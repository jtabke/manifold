import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as f from "@manifold/foundation";
import { RegionSession, semanticKey } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  readScene,
  SCENE_ITEM,
  sceneSchemas,
} from "../src/regions/sceneRecords.ts";
import { sceneFixture } from "./scene-fixture.mjs";
import { insertModel } from "../src/regions/modelCommands.ts";
const s = new RegionSession();
const region = s.create();
s.write(region, "F := 20 N");
const before = s.state,
  meaning = semanticKey(before),
  evidence = s.evidenceSequence,
  recency = s.receipts.length;
const tool = {
  id: "tool-trace",
  editor: "dependencies",
  object: region,
  context: "original",
  at: { x: 700, y: 180 },
  width: 450,
  height: 270,
};
const group = {
  id: "group-review",
  name: "Review",
  members: [region, tool.id],
  layout: "row",
  auto: true,
};
let notices = 0;
const off = s.subscribe(() => notices++);
s.setScene({ ...s.scene, groups: [group], tools: [tool] });
off();
assert.equal(notices, 1);
assert.equal(s.state, before);
assert.equal(semanticKey(s.state), meaning);
assert.equal(s.evidenceSequence, evidence);
assert.equal(s.receipts.length, recency);
const authored = s.scene;
assert.ok(Object.isFrozen(authored) && Object.isFrozen(authored.tools[0].at));
assert.throws(() => authored.tools.push(tool), TypeError);
const index = f.current(s.document, SCENE_ITEM),
  groupHead = f.current(s.document, "canvas:scene:group:" + group.id);
const initialTool = f.current(s.document, "canvas:scene:tool:" + tool.id);
assert.throws(
  () =>
    sceneSchemas
      .find((schema) => schema.id === "canvas-scene-tool@1")
      .validate(groupHead.body),
  undefined,
  "cached validation of an immutable group body cannot validate it as a tool",
);
const beforeMove = s.document.revisions.size;
s.setScene((scene) => ({
  ...scene,
  tools: scene.tools.map((t) => ({ ...t, at: { x: 900, y: 200 } })),
}));
assert.equal(f.current(s.document, SCENE_ITEM), index);
assert.equal(f.current(s.document, groupHead.item), groupHead);
assert.equal(s.document.revisions.size, beforeMove + 1);
s.undo();
assert.deepEqual(s.scene, authored);
const view = {
  id: "viewpoint-review",
  name: "Review layout",
  camera: { x: 31, y: 47, zoom: 0.8 },
  positions: { [region]: { x: 100, y: 100 }, [tool.id]: tool.at },
  groups: s.scene.groups,
  tools: s.scene.tools,
  pins: { [tool.id]: "original" },
  closed: [],
};
s.setScene({ ...s.scene, viewpoints: [view] });
const capture = f.current(s.document, "canvas:scene:viewpoint:" + view.id);
assert.equal(
  capture.body.bindings["capture-tool:" + tool.id].selection.kind,
  "pin",
);
assert.equal(
  capture.body.bindings["capture-tool:" + tool.id].selection.revision,
  initialTool.id,
);
s.setScene({ ...s.scene, groups: [], tools: [] });
assert.equal(f.current(s.document, initialTool.item), undefined);
const decoded = await decodeWorkspace(archive(s.native()));
const recipient = new RegionSession(
  decoded.page,
  () => [],
  decoded.document,
  decoded.artifacts,
  false,
  decoded.recovery,
);
assert.deepEqual(recipient.scene.viewpoints[0], view);
assert.equal(recipient.scene.tools.length, 0);
recipient.compact(recipient.reviewRetention());
assert.ok(
  recipient.document.revisions.get(initialTool.id),
  "named layout retains the closed tool through cleanup",
);
recipient.setScene({
  ...recipient.scene,
  tools: recipient.scene.viewpoints[0].tools,
  groups: recipient.scene.viewpoints[0].groups,
});
assert.equal(
  f.current(recipient.document, initialTool.item).id,
  initialTool.id,
  "restore reuses the pinned scene revision",
);
assert.equal(semanticKey(recipient.state), meaning);
const backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(recipient);
const current = recipient.capture();
assert.equal((await store.save(recipient)).writes.chunks, 0);
const data = await canvasLocalStore(backend).load();
assert.deepEqual(readScene(data.document), recipient.scene);
const stranger = JSON.stringify({
  version: 1,
  groups: [],
  tools: [{ ...tool, object: "unknown" }],
  viewpoints: [],
});
assert.equal(
  (await decodeWorkspace(archive(recipient.native()), stranger)).sceneError,
  undefined,
  "portable work never absorbs recipient legacy layout",
);
assert.deepEqual(
  readScene(
    (await decodeWorkspace(archive(recipient.native()), stranger)).document,
  ),
  recipient.scene,
);
const fixture = readFileSync(
  new URL("./canvas-v2.fixture.json", import.meta.url),
  "utf8",
);
const old = JSON.parse(fixture),
  object = old.artifacts[0].output;
const historical = { ...tool, object, width: 400, context: "original" };
const legacy = {
  version: 1,
  groups: [],
  tools: [],
  viewpoints: [
    { ...view, positions: {}, groups: [], tools: [historical], pins: {} },
  ],
};
const migrated = await decodeWorkspace(fixture, JSON.stringify(legacy));
assert.deepEqual(
  readScene(migrated.document).viewpoints[0].tools[0],
  historical,
  "closed tools in legacy named layouts migrate without an active tool",
);
assert.equal(migrated.sceneError, undefined);
const corruptLegacy = await decodeWorkspace(fixture, stranger);
assert.match(corruptLegacy.sceneError, /raw copy is preserved/);
assert.deepEqual(readScene(corruptLegacy.document).tools, []);
const failed = recipient.document;
assert.throws(
  () =>
    recipient.setScene({
      ...recipient.scene,
      tools: [{ ...tool, object: "missing" }],
    }),
  /Unknown scene target/,
);
assert.equal(recipient.document, failed);
const forged = JSON.parse(archive(recipient.native()));
const snapshotId =
  forged.foundation.document.items["canvas:scene:viewpoint:" + view.id]
    .revision;
forged.foundation.document.revisions[snapshotId].body.bindings[
  "capture-tool:" + tool.id
].selection.revision = "missing";
await assert.rejects(() => decodeWorkspace(JSON.stringify(forged)));
assert.equal(recipient.document, current.document);
s.dispose();
recipient.dispose();
store.close();
const scoped = await sceneFixture(3, true);
const scopedRecipient = await decodeWorkspace(archive(scoped.session.native()));
assert.equal(
  readScene(scopedRecipient.document).viewpoints[0].scope,
  "model-scene",
);
assert.equal(
  f.current(scopedRecipient.document, "canvas:scene:viewpoint:viewpoint-scene")
    .body.bindings["scope:model-scene"].item,
  "model:model-scene",
);
assert.equal(scopedRecipient.artifacts[0].receipt.points.length, 201);
const instance = insertModel(scoped.session, "spring", { x: 80, y: 100 });
const reserved = "tool-reserved";
scoped.session.applyCommands([
  {
    kind: "view",
    view: {
      ...scoped.session.document.views.get(instance + ":view"),
      id: reserved,
    },
  },
]);
scoped.session.applyCommands([{ kind: "removeView", id: reserved }]);
const beforeReuse = scoped.session.document;
assert.throws(
  () =>
    scoped.session.setScene({
      ...scoped.session.scene,
      tools: [
        ...scoped.session.scene.tools,
        { ...tool, id: reserved, object: scoped.output },
      ],
    }),
  /retired representation/,
);
assert.equal(
  scoped.session.document,
  beforeReuse,
  "a retired view ID cannot be rebound by a later scene tool",
);
scoped.session.dispose();
console.log(
  "Portable scene: one owner/Undo, independent records, immutable reads, named pinned layouts, closed-tool cleanup/restore, native/local recovery, legacy adoption/isolation and corrupt binding refusal pass.",
);
