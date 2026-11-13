import {
  testSession,
  deliver,
  recovery,
  evidence as evidenceMap,
} from "./sampling-test-helpers.mjs";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  RegionSession,
  project,
  semanticKey,
} from "../src/regions/document.ts";
import {
  archive,
  restore,
  makeArtifact,
  prepare,
  acceptData,
} from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import { memoryBackend } from "@manifold/foundation";
const fixture = readFileSync(
  new URL("./canvas-v2.fixture.json", import.meta.url),
  "utf8",
);
function owner() {
  const data = restore(fixture),
    session = testSession(data.page, () => [], data.document, data.artifacts);
  return {
    session,
    input: session.artifacts[0].input,
    output: session.artifacts[0].output,
  };
}
function result(session, time = new Date().toISOString()) {
  const a = session.artifacts[0],
    job = prepare(session.state, a);
  const data = {
    points: [
      [a.low, a.low * 10000],
      [a.high, a.high * 10000],
    ],
    code_sha256: createHash("sha256").update(job.code).digest("hex"),
    runtime: {
      adapter: `bounded-python-sampler/${Math.max(1, ...job.definitions.map((r) => r.mathVersion ?? 1))}`,
      python: "test",
    },
  };
  return { ...acceptData(session.state, a, job, data).receipt, time };
}
const { session: s, input, output } = owner();
assert.equal(project(s.state).solved.values.get("F").value, 10);
const initial = s.capture(),
  events = [];
s.subscribe(() => events.push(s.capture()));
const proposed = { context: s.state.active, key: semanticKey(s.state) };
const alt = s.keepAlternative(input, "x := 2 mm", proposed);
assert.equal(events.length, 1, "Keep publishes exactly once");
assert.equal(events[0].page.active, alt);
assert.equal(events[0].artifacts[0].compareContext, "original");
assert.equal(events[0].artifacts[0].comparing, true);
assert.equal(project(s.state).solved.values.get("F").value, 20);
assert.equal(project(s.state, "original").solved.values.get("F").value, 10);
s.undo();
assert.equal(events.length, 2, "Undo publishes once");
assert.deepEqual(s.state, initial.page);
assert.deepEqual(s.artifacts, initial.artifacts);
assert.equal(s.canUndo, false, "one Undo covers context and comparison");
const before = s.capture();
assert.throws(
  () =>
    s.atomic((staged) => {
      staged.branch();
      throw Error("before publication");
    }),
  /before publication/,
);
assert.equal(s.document, before.document);
assert.equal(s.artifacts, before.artifacts);
assert.equal(events.length, 2);
assert.throws(
  () =>
    s.atomic((staged) => {
      staged.branch();
      staged.setArtifacts((items) =>
        items.map((a) => ({ ...a, compareContext: "missing" })),
      );
    }),
  /comparison target/,
);
assert.equal(s.document, before.document);
assert.equal(events.length, 2);
const revisions = s.document.revisions,
  semantic = semanticKey(s.state);
s.setArtifacts((items) =>
  items.map((a) => ({
    ...a,
    at: { x: 900, y: 300 },
    views: [
      {
        id: "view-shared-table",
        renderer: "table",
        at: { x: 900, y: 800 },
        width: 600,
        height: 450,
      },
    ],
  })),
);
assert.equal(
  s.document.revisions,
  revisions,
  "independent presentations do not revise the computation",
);
assert.equal(
  s.state,
  before.page,
  "artifact view changes do not replace the Page projection",
);
assert.equal(semanticKey(s.state), semantic);
const arranged = s.capture();
s.keepAlternative(input, "x := 2 mm", proposed);
s.undo();
assert.deepEqual(s.artifacts, arranged.artifacts);
assert.deepEqual(s.state, arranged.page);
s.write(output, "F := 2*k*x");
const changed = s.capture();
assert.throws(() => s.keepAlternative(input, "x := 2 mm", proposed), /changed/);
assert.equal(s.document, changed.document);
assert.equal(s.artifacts, changed.artifacts);
// Old v1 and v2 files migrate; V3 holds definitions once, in the foundation.
for (const text of [
  fixture,
  legacyWorkspace(initial.page, initial.artifacts),
]) {
  const staged = await stageWorkspaceFile(text),
    native = archive(staged.native()),
    wire = JSON.parse(native),
    decoded = await decodeWorkspace(native);
  assert.equal(wire.version, 9);
  assert.equal(wire.artifacts, undefined);
  assert.equal(wire.page, undefined);
  assert.deepEqual(decoded.page, initial.page);
  assert.deepEqual(decoded.artifacts, initial.artifacts);
  assert.equal(
    testSession(decoded.page, () => [], decoded.document, decoded.artifacts)
      .canUndo,
    false,
  );
}
// Checked output has a separate monotonic version and never creates Undo.
const { session: e } = owner(),
  root = e.document,
  r = result(e, "2026-10-26T00:00:00.000Z");
const backend = memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
assert.equal((await store.save(e)).current, true);
assert.equal(e.isSaved, true);
const oldCapture = e.capture();
assert.equal(await deliver(e, e.artifacts[0].id, r), true);
assert.equal(e.document.id, root.id);
assert.equal(e.document.items, root.items);
assert.equal(e.document.revisions, root.revisions);
assert.equal(e.canUndo, false);
assert.equal(e.isSaved, false);
assert.equal(
  e.acknowledge(oldCapture),
  false,
  "old evidence ACK cannot mark new output saved",
);
r.time = e.artifacts[0].receipt.time;
assert.ok(Number.isFinite(Date.parse(r.time)));
const recorded = e.capture();
assert.equal(
  await deliver(e, e.artifacts[0].id, {
    ...r,
    code_sha256: "0".repeat(64),
  }),
  false,
);
assert.equal(
  await deliver(e, e.artifacts[0].id, {
    ...r,
    points: [
      [0.0005, 99],
      [0.003, 99],
    ],
  }),
  false,
);
assert.equal(e.capture().evidence, recorded.evidence + 2);
assert.equal(
  await deliver(e, e.artifacts[0].id, r),
  true,
  "An explicit computation creates a new checked attempt; passive reads reuse existing receipts",
);
r.time = e.artifacts[0].receipt.time;
assert.equal((await store.save(e)).current, true);
const durableHead = await backend.head(),
  saved = e.capture(),
  bytes = archive(e.native(saved));
e.keepAlternative(e.artifacts[0].input, "x := 2 mm", {
  context: e.state.active,
  key: semanticKey(e.state),
});
const kept = e.capture(),
  keptBytes = archive(e.native(kept));
await assert.rejects(
  store.save(e, e.capture(), "before-publish"),
  /Interrupted|Aborted/,
);
assert.equal(e.isSaved, false);
assert.deepEqual(await backend.head(), durableHead);
assert.equal((await decodeWorkspace(bytes)).page.contexts.length, 1);
assert.equal((await decodeWorkspace(keptBytes)).page.contexts.length, 2);
assert.equal((await decodeWorkspace(keptBytes)).artifacts[0].comparing, true);
assert.equal(
  (await decodeWorkspace(keptBytes)).artifacts[0].receipt.time,
  r.time,
);
// Save stores its capture, but a newer publication during the write remains unsaved.
const staleSave = await store.save(e, e.capture(), undefined, async () => {
  e.setArtifacts((items) => items.map((a) => ({ ...a, renderer: "table" })));
});
assert.equal(staleSave.current, false);
assert.equal(e.isSaved, false);
assert.equal(
  (await canvasLocalStore(backend).load()).artifacts[0].renderer,
  "plot",
);
assert.equal(e.artifacts[0].renderer, "table");
assert.throws(() => e.acknowledge({ ...e.capture() }), /Unowned/);
await store.save(e);
assert.equal(e.isSaved, true);
// A receipt from a context removed by Undo cannot be accepted or replace definitions.
const late = result(e, "2026-10-26T01:00:00.000Z");
e.undo();
e.undo();
const restored = e.capture();
assert.equal(await deliver(e, e.artifacts[0].id, late), false);
assert.equal(e.document, restored.document);
assert.equal(e.capture().evidence, restored.evidence);
assert.equal(
  e.artifacts[0].receipt.time,
  r.time,
  "Undo does not erase evidence",
);
// A changed definition rejects a late result even when the transport completes later.
e.write(e.artifacts[0].input, "x := 3 mm");
const newer = e.capture();
assert.equal(await deliver(e, e.artifacts[0].id, r), false);
assert.equal(e.document, newer.document);
assert.equal(e.capture().evidence, newer.evidence);
const { session: pending } = owner();
const pendingCursor = pending.create({ x: 100, y: 600 });
pending.atomic((staged) =>
  staged.setArtifacts((items) =>
    items.map((a) => ({ ...a, renderer: "table" })),
  ),
);
assert.ok(
  pending.state.regions.some((r) => r.id === pendingCursor && r.text === ""),
);
assert.equal(
  pending.capture().page.regions.some((r) => r.id === pendingCursor),
  false,
  "empty cursors stay outside accepted work",
);
const { session: race } = owner();
race.keepAlternative(race.artifacts[0].input, "x := 2 mm", {
  context: race.state.active,
  key: semanticKey(race.state),
});
const raced = result(race),
  completion = deliver(race, race.artifacts[0].id, raced);
race.undo();
assert.equal(
  await completion,
  false,
  "verification finishing after Undo cannot accept removed-context output",
);
assert.equal(
  race.evidenceSequence,
  1,
  "A late closed-context outcome remains historical in the shared evidence clock",
);
const { session: clearance } = owner();
const art = clearance.artifacts[0],
  originalPosition = structuredClone(art.at);
const cursor = clearance.create({ x: art.at.x, y: art.at.y - 72 });
clearance.atomic((staged) => {
  assert.equal(staged.write(cursor, "Accepted note", true).ok, true);
});
assert.deepEqual(
  clearance.artifacts[0].at,
  originalPosition,
  "continuation never moves an independently placed artifact",
);
clearance.undo();
assert.deepEqual(clearance.artifacts[0].at, originalPosition);
assert.equal(
  clearance.state.regions.some((r) => r.text === "Accepted note"),
  false,
);
console.log(
  "Workspace owner: one Keep/Undo publication, staging failures, layout independence, stale proposals/results, V1/V2 migration, V3 handoff, evidence without Undo and capture-specific save ACKs pass.",
);
