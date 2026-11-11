import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonical, modelPort } from "@manifold/foundation";
import {
  createHeadlessWorkspace,
  openHeadlessWorkspace,
} from "manifold-canvas/headless";
import { RegionSession } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  insertModel,
  publishModel,
  instantiateModel,
  modelReference,
} from "../src/regions/modelCommands.ts";

assert.equal(typeof window, "undefined");
assert.equal(typeof document, "undefined");
assert.equal(typeof indexedDB, "undefined");
const sessions = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw Error("Unexpected network access");
};
try {
  // Begin with the actual canvas owner and native export, not a second file format.
  const canvas = new RegionSession();
  sessions.push(canvas);
  const model = insertModel(canvas, "spring", { x: 370, y: 220 });
  const note = canvas.create();
  canvas.write(note, "Preserve this unrelated note");
  const api = await openHeadlessWorkspace(archive(canvas.native()));
  sessions.push(api);
  const root = api.read().id;
  const before = api.read();
  assert(Object.isFrozen(before));
  assert(api.items().some((item) => item.id === model));
  assert.equal(
    api.inspectModel(model).definition.inputs.displacement.node,
    "x",
  );
  const target = api.reference(model, modelPort("force"));
  assert.equal(api.project(target).projection.value.value, 20);
  assert.equal(api.result(api.reference(model + ":result")).status, "ready");
  api.setModelInput(model, "displacement", 3, root);
  assert.equal(api.project(target).projection.value.value, 30);
  assert.equal(before.id, root, "old immutable snapshot survives mutation");
  const edited = api.read();
  assert.throws(
    () => api.setModelInput(model, "displacement", 4, root),
    /changed/,
  );
  assert.throws(() => api.setModelInput(model, "displacement", 4), /changed/);
  assert.throws(
    () => api.setModelInput(model, "missing", 4, edited.id),
    /finite/,
  );
  assert.throws(
    () => api.setModelInput(model, "displacement", NaN, edited.id),
    /finite/,
  );
  assert.equal(api.read(), edited, "invalid edits publish nothing");
  assert.throws(() =>
    api.apply(
      [
        { kind: "rename", item: model, label: "Must not publish" },
        { kind: "rename", item: "missing", label: "Missing" },
      ],
      edited.id,
    ),
  );
  assert.equal(api.read(), edited);
  api.undo(edited.id);
  assert.equal(api.project(target).projection.value.value, 20);
  api.redo(api.read().id);
  assert.equal(api.project(target).projection.value.value, 30);

  const job = api.compute(api.reference(model + ":result"));
  assert.equal((await job.completion).status, "retained");
  const result = api.result(api.reference(model + ":result"));
  assert.equal(result.status, "current");
  const text = api.export();
  const decoded = await decodeWorkspace(text);
  const reopenedCanvas = new RegionSession(
    decoded.page,
    () => [],
    decoded.document,
    decoded.artifacts,
    false,
    decoded.recovery,
    { artifactExecutor: null },
  );
  sessions.push(reopenedCanvas);
  assert.deepEqual(reopenedCanvas.state, canvas.state);
  assert.deepEqual(
    [...reopenedCanvas.document.views.entries()],
    [...canvas.document.views.entries()],
  );
  const reopened = await openHeadlessWorkspace(text);
  sessions.push(reopened);
  assert.equal(
    reopened.project(reopened.reference(model, modelPort("force"))).projection
      .value.value,
    30,
  );
  const retained = reopened.result(reopened.reference(model + ":result"));
  assert.equal(retained.status, result.status);
  assert.equal(retained.receipt.id, result.receipt.id);
  assert.equal(retained.receipt.key, result.receipt.key);
  assert.equal(
    canonical(retained.receipt.snapshot),
    canonical(result.receipt.snapshot),
  );
  assert.deepEqual(retained.receipt.outcome, result.receipt.outcome);
  assert.deepEqual(
    [...retained.receipt.context.heads.entries()],
    [...result.receipt.context.heads.entries()],
  );
  assert.equal(
    reopened.export(),
    text,
    "open/export preserves native bytes and evidence",
  );

  const fresh = createHeadlessWorkspace();
  sessions.push(fresh);
  assert.throws(
    () => fresh.createModel("toString", fresh.read().id),
    /Unknown/,
  );
  const created = fresh.createModel("spring", fresh.read().id);
  assert(fresh.inspectModel(created));
  assert.equal(
    fresh.apply(
      [{ kind: "rename", item: created, label: "API spring" }],
      fresh.read().id,
    ),
    true,
  );
  assert.equal(
    fresh.items().find((item) => item.id === created).label,
    "API spring",
  );
  const current = fresh.read();
  assert.equal(fresh.apply([], current.id), false);
  fresh.dispose();
  fresh.dispose();
  assert.throws(() => fresh.read(), /closed/);
  assert.throws(() => fresh.export(), /closed/);
  assert.throws(() => fresh.compute(target), /closed/);
  assert.throws(
    () => fresh.setModelInput(created, "displacement", 2, current.id),
    /closed/,
  );
  await assert.rejects(() => openHeadlessWorkspace("{}"));
  await assert.rejects(() => openHeadlessWorkspace("not json"));

  // Discovery follows the authored interface and general multi-output requests, not force/N conventions.
  const authoredCanvas = new RegionSession();
  sessions.push(authoredCanvas);
  const definition = publishModel(authoredCanvas, "Power", {
    rows: [
      { id: "force", text: "F = 20 N" },
      { id: "speed", text: "v = 3 m/s" },
      { id: "power", text: "P = F*v" },
    ],
    inputs: ["force", "speed"],
    outputs: ["power", "speed"],
  });
  instantiateModel(
    authoredCanvas,
    modelReference(authoredCanvas.document, definition),
    { x: 0, y: 0 },
  );
  const authored = await openHeadlessWorkspace(
    archive(authoredCanvas.native()),
  );
  sessions.push(authored);
  const [description] = authored.models();
  assert.equal(description.outputs.length, 2);
  assert.deepEqual(
    description.outputs.map((output) => output.unit),
    ["W", "m*s^-1"],
  );
  assert.equal(description.requests.length, 1);
  assert.deepEqual(
    description.requests[0].outputs,
    description.outputs.map((output) => output.id),
  );
  const speed = description.inputs.find((input) => input.unit === "m*s^-1");
  authored.setModelInput(description.id, speed.id, 4, description.documentId);
  assert.deepEqual(
    authored
      .describeModel(description.id)
      .outputs.map((output) => output.projection.projection.value.value),
    [80, 4],
  );
  assert.equal(
    (await authored.compute(description.requests[0].reference).completion)
      .receipt.outcome.status,
    "success",
  );

  // A real sampler-containing fixture opens/exports without a browser transport or execution.
  const fixture = readFileSync(
    new URL("./canvas-v2.fixture.json", import.meta.url),
    "utf8",
  );
  const imported = await openHeadlessWorkspace(fixture, {
    artifactExecutor: async () => {
      throw Error("Open must not execute");
    },
  });
  sessions.push(imported);
  const native = imported.export();
  await decodeWorkspace(native);
  console.log(
    "Headless API: Node-only canvas round trip, guarded edits, Undo/Redo, explicit execution, retained evidence, validation and lifecycle pass.",
  );
} finally {
  globalThis.fetch = originalFetch;
  for (const session of sessions) session.dispose();
}
