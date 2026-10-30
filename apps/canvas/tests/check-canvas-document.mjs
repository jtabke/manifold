import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  CanvasDocument,
  canvasPage,
} from "../src/regions/app/canvasDocument.ts";
import { archive, restore } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
const s = new RegionSession();
const emptyRoot = s.document;
const id = s.create();
assert.equal(s.document, emptyRoot, "empty cursor is ephemeral");
s.write(id, "F = 20 N");
const accepted = s.document,
  page = s.state;
assert.ok(Object.isFrozen(page) && Object.isFrozen(page.regions[0]));
assert.deepEqual(canvasPage(accepted), page);
s.move(id, { x: 900, y: 300 });
assert.equal(
  s.document.revisions,
  accepted.revisions,
  "layout moves allocate no authored revisions",
);
s.undo();
assert.equal(s.state, page, "Undo projects the prior accepted root");
s.write(id, "F = 21 N");
assert.equal(canvasPage(accepted).regions[0].text, "F = 20 N");
assert.equal(s.document.revisions.size, accepted.revisions.size + 1);
const v2 = archive(s.native()),
  decoded = await decodeWorkspace(v2);
assert.equal(decoded.document.document, s.document.document);
assert.deepEqual(decoded.page, s.state);
assert.equal(
  decoded.document.revisions.size,
  [...s.document.items.entries()].filter(([, v]) => v.revision).length,
);
const noOpOwner = new CanvasDocument(decoded.page, decoded.document);
const beforeNoOp = noOpOwner.document;
assert.equal(noOpOwner.apply(noOpOwner.page), false);
assert.equal(noOpOwner.document, beforeNoOp);
assert.equal(noOpOwner.canUndo, false);
const resumed = new RegionSession(decoded.page, () => [], decoded.document);
assert.equal(resumed.canUndo, false);
assert.equal(project(resumed.state).solved.values.get("F").value, 21);
const next = resumed.create();
assert.notEqual(next, id);
resumed.write(next, "v = 3 m/s");
resumed.undo();
const retired = resumed.create();
assert.notEqual(retired, next, "Undo never recycles IDs");
const legacy = legacyWorkspace(s.state, []),
  migrated = await stageWorkspaceFile(legacy);
assert.deepEqual(migrated.state, s.state);
assert.ok(migrated.document);
const unsupported = JSON.parse(v2);
unsupported.foundation.document.items.canvas.revision = "missing";
await assert.rejects(() => stageWorkspaceFile(JSON.stringify(unsupported)));
const exhausted = JSON.parse(v2);
exhausted.foundation.document.identities.items.push("region:region-100000000");
await assert.rejects(
  () => decodeWorkspace(JSON.stringify(exhausted)),
  /allocation limit/,
);
const malicious = structuredClone(s.state);
malicious.extra = malicious;
assert.throws(() => new CanvasDocument(malicious), /Cyclic/);
console.log(
  "Canvas ownership: ephemeral cursors, immutable records, layout isolation, Undo, retired identities, native migration pass; shared I/O failures are covered by workspace lifecycle checks.",
);
