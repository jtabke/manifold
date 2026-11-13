import {
  testSession,
  deliver,
  recovery,
  evidence as evidenceMap,
} from "./sampling-test-helpers.mjs";
import {
  decodeWorkspace,
  validateWorkspaceData,
} from "../src/regions/artifacts.ts";
import {
  documentTitle,
  documentFilename,
  titleFromFilename,
} from "../src/regions/documentTitle.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { memoryBackend } from "@manifold/foundation";
import { canvasLocalStore } from "../src/regions/app/canvasLocalStore.ts";
import {
  canvasWorkspace,
  createEditBuffers,
} from "../src/regions/app/workspaceFiles.ts";
import { RegionSession, project } from "../src/regions/document.ts";
import {
  archive,
  restore,
  prepare,
  acceptData,
} from "../src/regions/artifacts.ts";
const fixture = readFileSync(
  new URL("./canvas-v2.fixture.json", import.meta.url),
  "utf8",
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const file = { size: fixture.length, text: async () => fixture };
// Renderers contribute transient buffers to the same file-transition guard and finish protocol.
{
  const buffers = createEditBuffers();
  let draft = "3",
    finished = 0;
  const port = {
      read: () => draft,
      finish: () => {
        draft = undefined;
        finished++;
        return true;
      },
    },
    detach = buffers.register("model-input", port),
    primary = {
      read: () => ({ draft: "worksheet", editing: undefined }),
      finish: () => true,
      settle: async () => {},
    },
    combined = buffers.compose(primary),
    before = combined.read();
  assert.equal(before.editing, "extension-buffer");
  draft = "4";
  assert.notEqual(combined.read().draft, before.draft);
  assert.equal(combined.finish(), true);
  assert.equal(finished, 1);
  assert.equal(combined.read().editing, undefined);
  detach();
  detach();
  assert.throws(() => {
    buffers.register("same", port);
    buffers.register("same", port);
  }, /Duplicate/);
}
async function setup(options = {}) {
  const data = restore(fixture),
    session = testSession(data.page, () => [], data.document, data.artifacts),
    backend = memoryBackend(),
    store = canvasLocalStore(backend),
    destinations = new Map(),
    marks = [],
    discarded = [],
    errors = [];
  await store.load();
  const buffer = { editing: undefined, draft: "" };
  const edits = {
    read: () => ({ ...buffer }),
    finish: () => {
      buffer.editing = undefined;
      return true;
    },
    settle: async () => {},
  };
  const workspace = canvasWorkspace({
    session,
    key: "current",
    store,
    newSearch: () => "?canvas=00000000-0000-0000-0000-000000000001",
    reportError: (error) => errors.push(error),
    markPrimary: (key) => marks.push(key),
    discard: async (key) => {
      discarded.push(key);
      destinations.delete(key);
    },
    openStore: async (key) => {
      const target = destinations.get(key) || memoryBackend();
      destinations.set(key, target);
      return canvasLocalStore(target);
    },
    ...options.configure?.({ session, backend, store, buffer, destinations }),
  });
  return {
    workspace,
    session,
    backend,
    store,
    buffer,
    edits,
    destinations,
    marks,
    discarded,
    errors,
  };
}

// Names are authored metadata, survive recovery, and never depend on a transport filename.
{
  assert.equal(documentTitle("  Pump sizing  "), "Pump sizing");
  assert.equal(documentTitle("\n\t"), "Untitled document");
  assert.equal(
    titleFromFilename("Thermal balance.MANIFOLD"),
    "Thermal balance",
  );
  assert.equal(documentFilename("Pump: A/B"), "Pump- A-B.manifold");
  assert.equal(documentFilename(".."), "manifold-workspace.manifold");
  const h = await setup();
  const original = h.session.state;
  h.session.renameDocument("Pump sizing");
  assert.equal(h.session.state.title, "Pump sizing");
  assert.deepEqual(h.session.state.regions, original.regions);
  h.session.undo();
  assert.equal(h.session.state.title, undefined);
  h.session.redo();
  const bytes = await h.workspace.export(h.edits);
  assert.equal((await decodeWorkspace(bytes)).page.title, "Pump sizing");
  assert.equal(await h.workspace.save(), true);
  assert.equal(
    (await canvasLocalStore(h.backend).load()).page.title,
    "Pump sizing",
  );
  const incoming = await setup();
  await incoming.workspace.open(
    { name: "transport.manifold", size: bytes.length, text: async () => bytes },
    incoming.edits,
  );
  assert.equal(
    (await canvasLocalStore([...incoming.destinations.values()][0]).load()).page
      .title,
    "Pump sizing",
  );
  const fallback = await setup();
  await fallback.workspace.open(
    { ...file, name: "Original machine.manifold" },
    fallback.edits,
  );
  assert.equal(
    (await canvasLocalStore([...fallback.destinations.values()][0]).load()).page
      .title,
    "Original machine",
  );
  for (const title of [4, "", "x".repeat(161), "bad\nname"])
    assert.throws(
      () => validateWorkspaceData({ ...original, title }, h.session.artifacts),
      /Unsupported workspace/,
    );
}

// Concurrent saves share one promise; a late edit gets a fresh capture and acknowledgement.
{
  const entered = deferred(),
    release = deferred();
  let calls = 0;
  const h = await setup({
    configure: ({ store }) => ({
      store: {
        ...store,
        save: (session) =>
          store.save(session, session.capture(), undefined, async () => {
            if (++calls === 1) {
              entered.resolve();
              await release.promise;
            }
          }),
      },
    }),
  });
  const first = h.workspace.save();
  assert.equal(h.workspace.save(), first);
  await entered.promise;
  h.session.write(h.session.artifacts[0].input, "x := 4 mm");
  release.resolve();
  assert.equal(await first, true);
  assert.equal(calls, 2);
  assert.equal(h.session.isSaved, true);
  const saved = await canvasLocalStore(h.backend).load();
  assert.equal(project(saved.page).solved.values.get("x").value, 0.004);
}

// Save failure preserves the durable head and exportable work, and Retry uses the same owner.
{
  let fail = false;
  const h = await setup({
    configure: ({ store }) => ({
      store: {
        ...store,
        save: (...args) => {
          if (fail) throw Error("Quota exceeded");
          return store.save(...args);
        },
      },
    }),
  });
  assert.equal(await h.workspace.save(), true);
  const head = await h.backend.head();
  h.session.write(h.session.artifacts[0].input, "x := 3 mm");
  fail = true;
  assert.equal(await h.workspace.save(), false);
  assert.equal(h.session.isSaved, false);
  assert.deepEqual(await h.backend.head(), head);
  assert.match(h.errors.at(-1), /retry or export/);
  assert.equal(
    project(
      (await decodeWorkspace(await h.workspace.export(h.edits))).page,
    ).solved.values.get("x").value,
    0.003,
  );
  await assert.rejects(h.workspace.newCanvas(h.edits), /Export current work/);
  fail = false;
  assert.equal(await h.workspace.save(), true);
  assert.equal(h.errors.at(-1), "");
  assert.match(await h.workspace.newCanvas(h.edits), /^\?canvas=/);
}

// Refused buffer commits and serialization faults cannot navigate or mark work saved.
{
  const h = await setup();
  const refused = { ...h.edits, finish: () => false };
  assert.equal(await h.workspace.newCanvas(refused), undefined);
  assert.equal(await h.workspace.export(refused), undefined);
  assert.equal(await h.backend.head(), null);
  h.session.native = () => {
    throw Error("Serialization failed");
  };
  await assert.rejects(h.workspace.export(h.edits), /Serialization failed/);
  assert.equal(h.session.isSaved, false);
}

// Validate before commits/I/O; a slow read cannot discard newly typed, unaccepted text.
{
  const h = await setup();
  let finishes = 0;
  const edits = {
    ...h.edits,
    finish: () => {
      finishes++;
      return true;
    },
  };
  await assert.rejects(
    h.workspace.open({ size: 1, text: async () => "invalid" }, edits),
  );
  await assert.rejects(
    h.workspace.open(
      {
        size: 128 * 1024 * 1024 + 1,
        text: async () => {
          throw Error("must not read");
        },
      },
      edits,
    ),
    /128 MiB/,
  );
  assert.equal(finishes, 0);
  assert.equal(await h.backend.head(), null);
  const read = deferred();
  const opened = h.workspace.open(
    { size: fixture.length, text: () => read.promise },
    edits,
  );
  await assert.rejects(h.workspace.newCanvas(h.edits), /already in progress/);
  h.buffer.editing = "new";
  h.buffer.draft = "unfinished thought";
  read.resolve(fixture);
  await assert.rejects(opened, /Work changed/);
  assert.equal(h.buffer.draft, "unfinished thought");
  assert.equal(finishes, 0);
  assert.equal(h.destinations.size, 0);
}

// Staging has no publication authority. Both late typing and evidence invalidate navigation.
for (const change of ["draft", "evidence"]) {
  const entered = deferred(),
    release = deferred();
  let targetBackend,
    closed = false;
  const h = await setup({
    configure: () => ({
      openStore: async () => {
        targetBackend = memoryBackend();
        const target = canvasLocalStore(targetBackend);
        return {
          ...target,
          save: async (...args) => {
            const result = await target.save(...args);
            entered.resolve();
            await release.promise;
            return result;
          },
          close: () => {
            closed = true;
            target.close();
          },
        };
      },
    }),
  });
  const opened = h.workspace.open(file, h.edits);
  await entered.promise;
  if (change === "draft") h.buffer.draft = "new typing after commit";
  else {
    const a = h.session.artifacts[0],
      job = prepare(h.session.state, a),
      receipt = acceptData(h.session.state, a, job, {
        points: [
          [a.low, 10000 * a.low],
          [a.high, 10000 * a.high],
        ],
        code_sha256: createHash("sha256").update(job.code).digest("hex"),
        runtime: {
          adapter: `bounded-python-sampler/${Math.max(1, ...job.definitions.map((r) => r.mathVersion ?? 1))}`,
          python: "test",
        },
      }).receipt;
    assert.equal(await deliver(h.session, a.id, receipt), true);
  }
  release.resolve();
  await assert.rejects(opened, /Work changed/);
  assert.equal(closed, true);
  assert.equal(h.discarded.length, 1);
  assert.equal(
    h.marks.length,
    1,
    "Only the current saved workspace is published",
  );
  assert.ok(await h.backend.head());
  assert.ok(
    await targetBackend.head(),
    "The unpublished destination had a completed save",
  );
}

// Successful handoff is independently recoverable; occupied destinations are never deleted.
{
  const h = await setup();
  assert.match(await h.workspace.open(file, h.edits), /^\?canvas=/);
  assert.equal(h.discarded.length, 0);
  const key = h.marks.at(-1),
    target = h.destinations.get(key),
    loaded = await canvasLocalStore(target).load();
  assert.deepEqual(loaded.page, restore(fixture).page);
  assert.equal(
    loaded.document.document,
    h.session.document.document,
    "Native handoff preserves document identity",
  );
  assert.notEqual(
    loaded.document,
    h.session.document,
    "Recovery owns an independent immutable selection",
  );
  const head = await target.head();
  await assert.rejects(h.workspace.open(file, h.edits), /already exists/);
  assert.equal(h.discarded.length, 0);
  assert.deepEqual(await target.head(), head);
}

// Continuous mutation cannot create an unbounded save loop; a later explicit retry can recover.
{
  let calls = 0,
    keepChanging = true;
  const h = await setup({
    configure: ({ store }) => ({
      store: {
        ...store,
        save: async (session) => {
          const result = await store.save(session);
          calls++;
          if (keepChanging)
            session.write(session.artifacts[0].input, `x := ${calls + 1} mm`);
          return { ...result, current: session.isSaved };
        },
      },
    }),
  });
  assert.equal(await h.workspace.save(), false);
  assert.equal(calls, 8);
  assert.equal(h.session.isSaved, false);
  keepChanging = false;
  assert.equal(await h.workspace.save(), true);
  assert.equal(calls, 9);
}
console.log(
  "Workspace lifecycle: coalesced bounded saves, commit refusal, failures/retry/export, guarded Open/New, late typing/evidence and recoverable staged handoff pass.",
);
