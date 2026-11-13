import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { createCanvasPiSession, canvasTools } from "../src/pi.mjs";
import {
  canvasSettings,
  CanvasSettingsError,
} from "../src/canvas-settings.mjs";
import { startCompanion } from "../src/server.mjs";

const initial = Object.freeze({
  provider: "test",
  model: "one",
  thinking: "off",
  permissions: "reviewed-edits",
});

test("configuration respects supported Pi thinking defaults without rewriting them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "manifold-pi-thinking-defaults-"));
  try {
    const path = join(cwd, "settings.json"),
      source = JSON.stringify({
        defaultThinkingLevel: "low",
        modelThinkingLevels: { "openai/gpt-6.1-sol": "high" },
      });
    await writeFile(path, source);
    const module = fileURLToPath(new URL("../src/pi.mjs", import.meta.url));
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const {assistantConfiguration}=await import(${JSON.stringify(module)});const c=await assistantConfiguration();console.log(JSON.stringify(c.providers.find(p=>p.id==='openai').models.find(m=>m.id==='gpt-6.1-sol')));`,
      ],
      {
        cwd,
        env: { ...process.env, PI_CODING_AGENT_DIR: cwd },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const model = JSON.parse(child.stdout);
    assert(model.thinkingLevels.includes("high"));
    assert.equal(model.defaultThinking, "high");
    assert.equal(await readFile(path, "utf8"), source);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
function client(url) {
  const ws = new WebSocket(url, { origin: "http://127.0.0.1:58310" });
  const queue = [],
    waiters = [];
  ws.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    if (waiters.length) waiters.shift()(message);
    else queue.push(message);
  });
  return {
    ws,
    send: (message) => ws.send(JSON.stringify(message)),
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => waiters.push(resolve)),
    async close() {
      const closed = once(ws, "close");
      ws.close();
      await closed;
    },
  };
}

test("canvas settings reject incomplete, unknown and unsupported permission values", () => {
  assert.deepEqual(canvasSettings(initial), initial);
  assert(Object.isFrozen(canvasSettings(initial)));
  for (const invalid of [
    null,
    [],
    {},
    { ...initial, provider: " " },
    { ...initial, model: "" },
    { ...initial, thinking: "automatic" },
    { ...initial, thinking: null },
    { ...initial, permissions: "full-control" },
    { ...initial, permissions: null },
    { ...initial, execute: true },
  ])
    assert.throws(() => canvasSettings(invalid), CanvasSettingsError);
  const reads = canvasTools(async () => ({}), { permissions: "read-only" });
  assert.deepEqual(reads.map((tool) => tool.name).sort(), [
    "inspect_canvas",
    "inspect_plot",
    "inspect_workspace",
    "look_at_canvas",
  ]);
});

test("real SDK model/thinking/access changes preserve history without settings or credential writes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "manifold-pi-settings-"));
  let session;
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(cwd, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(cwd, "models.json"),
      refreshOnCreate: false,
    });
    const diskState = async () =>
      Promise.all(
        (await readdir(cwd))
          .sort()
          .map(async (name) => [name, await readFile(join(cwd, name), "utf8")]),
      );
    const beforeFiles = await diskState();
    // Deterministic auth metadata: no provider request or actual credential is needed.
    runtime.checkAuth = async () => ({ configured: true });
    const imageModel = runtime
      .getModels()
      .find(
        (model) =>
          model.input.includes("image") &&
          getSupportedThinkingLevels(model).includes("high"),
      );
    const textModel = runtime
      .getModels()
      .find(
        (model) =>
          !model.input.includes("image") &&
          getSupportedThinkingLevels(model).length === 1,
      );
    assert(imageModel && textModel, "static SDK catalog has both fixtures");
    const settings = {
      provider: imageModel.provider,
      model: imageModel.id,
      thinking: "high",
      permissions: "read-only",
    };
    let forwarded = 0;
    session = await createCanvasPiSession({
      modelRuntime: runtime,
      settings,
      cwd,
      call: async () => {
        forwarded++;
        return { documentId: "canvas" };
      },
    });
    const history = [
      { role: "user", content: "Keep the spring assumption", timestamp: 1 },
    ];
    session.agent.state.messages = history;
    assert.deepEqual(session.canvasSettings, settings);
    assert.equal(session.thinkingLevel, "high");
    assert.deepEqual(session.getActiveToolNames().sort(), [
      "inspect_canvas",
      "inspect_plot",
      "inspect_workspace",
      "look_at_canvas",
    ]);
    assert.deepEqual(
      session
        .getAllTools()
        .map((tool) => tool.name)
        .sort(),
      [
        "capabilities",
        "inspect_canvas",
        "inspect_plot",
        "inspect_workspace",
        "look_at_canvas",
        "prepare_edit",
      ],
      "mode changes cannot activate shell, file or computation tools",
    );
    const edit = session.getToolDefinition("prepare_edit");
    const capabilities = session.getToolDefinition("capabilities");
    const image = session.getToolDefinition("look_at_canvas");
    assert(
      edit && capabilities && image,
      "inactive tools remain registered for later switches",
    );
    for (const tool of [edit, capabilities])
      await assert.rejects(tool.execute("rogue", {}, undefined), /read-only/);
    assert.equal(forwarded, 0, "hiding tools is backed by execution denial");

    const modelChanges = [],
      thinkingChanges = [];
    const setModel = session.setModel.bind(session),
      setThinking = session.setThinkingLevel.bind(session);
    session.setModel = (model, options) => {
      modelChanges.push(options);
      return setModel(model, options);
    };
    session.setThinkingLevel = (level, options) => {
      thinkingChanges.push(options);
      return setThinking(level, options);
    };
    const switched = {
      provider: textModel.provider,
      model: textModel.id,
      thinking: "off",
      permissions: "reviewed-edits",
    };
    assert.deepEqual(await session.configureCanvas(switched), switched);
    assert.deepEqual(session.messages, history);
    assert.equal(session.model.id, textModel.id);
    assert.equal(session.thinkingLevel, "off");
    assert.deepEqual(modelChanges, [{ persist: false }]);
    assert.deepEqual(thinkingChanges.at(-1), { persist: false });
    assert.deepEqual(session.getActiveToolNames().sort(), [
      "capabilities",
      "inspect_canvas",
      "inspect_plot",
      "inspect_workspace",
      "prepare_edit",
    ]);
    await edit.execute("reviewed", {}, undefined);
    assert.equal(
      forwarded,
      1,
      "the reviewed tool reactivates in the same session",
    );
    await assert.rejects(
      image.execute("rogue-image", {}, undefined),
      /does not accept/,
    );
    const accepted = session.canvasSettings;
    await assert.rejects(
      session.configureCanvas({ ...switched, thinking: "high" }),
      /does not support/,
    );
    await assert.rejects(
      session.configureCanvas({ ...switched, model: "missing-model" }),
      /Model not found/,
    );
    assert.equal(session.canvasSettings, accepted);
    assert.equal(
      modelChanges.length,
      1,
      "unsupported choices are rejected before model mutation",
    );
    await session.configureCanvas(settings);
    await assert.rejects(
      edit.execute("old-tool-handle", {}, undefined),
      /read-only/,
    );
    assert.deepEqual(session.messages, history);
    assert.equal(session.settingsManager.getDefaultProvider(), undefined);
    runtime.checkAuth = async () => {
      throw Error("private credential material");
    };
    await assert.rejects(session.configureCanvas(switched), (error) => {
      assert.match(error.message, /Check Pi credentials/);
      assert(!error.message.includes("private credential material"));
      return true;
    });
    assert.deepEqual(session.canvasSettings, settings);
    assert.equal(session.settingsManager.getDefaultModel(), undefined);
    assert.equal(session.settingsManager.getDefaultThinkingLevel(), undefined);
    assert.deepEqual(
      await diskState(),
      beforeFiles,
      "changes never write session state, global defaults or credentials",
    );
  } finally {
    session?.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});

test(
  "turn settings acknowledge exact choices, preserve one session, enforce read-only and release invalid requests",
  { timeout: 15000 },
  async () => {
    const history = [],
      configurations = [];
    let created = 0;
    const companion = await startCompanion({
      port: 0,
      createSession: async (call) => {
        created++;
        let settings = initial;
        return {
          get canvasSettings() {
            return settings;
          },
          subscribe() {},
          async configureCanvas(value) {
            const next = canvasSettings(value);
            if (next.thinking !== "off" && next.thinking !== "high")
              throw new CanvasSettingsError("Unsupported test thinking level");
            configurations.push(next);
            settings = next;
            return settings;
          },
          async prompt(text) {
            history.push({ text, settings });
            if (text.startsWith("Try edit"))
              await call("prepare_edit", { explanation: "Review first" });
          },
          async abort() {},
          dispose() {},
        };
      },
    });
    const c = client(companion.url);
    const prompt = (requestId, settings, text = "Explain") =>
      c.send({ type: "prompt", requestId, text, selection: [], settings });
    try {
      assert.deepEqual(await c.next(), { type: "ready", settings: initial });
      const readOnly = {
        ...initial,
        model: "two",
        thinking: "high",
        permissions: "read-only",
      };
      prompt("read", readOnly, "Try edit despite read-only");
      assert.deepEqual(await c.next(), {
        type: "settings",
        requestId: "read",
        settings: readOnly,
      });
      const denied = await c.next();
      assert.equal(denied.type, "error");
      assert.equal(denied.requestId, "read");
      assert.match(denied.message, /read-only/);
      assert.equal(history.length, 1);
      const reviewed = { ...readOnly, permissions: "reviewed-edits" };
      prompt("edit", reviewed, "Try edit with review");
      assert.deepEqual(await c.next(), {
        type: "settings",
        requestId: "edit",
        settings: reviewed,
      });
      const tool = await c.next();
      assert.equal(tool.name, "prepare_edit");
      prompt("busy", readOnly);
      const busy = await c.next();
      assert.equal(busy.requestId, "busy");
      assert.match(busy.message, /busy/);
      assert.equal(
        configurations.length,
        2,
        "settings cannot change an active request",
      );
      c.send({
        type: "tool_result",
        requestId: "edit",
        id: tool.id,
        result: { status: "pending" },
      });
      assert.equal((await c.next()).type, "done");
      for (const [id, invalid] of [
        ["invalid-permissions", { ...initial, permissions: "full-control" }],
        ["invalid-thinking", { ...initial, thinking: "max" }],
        ["invalid-shape", { ...initial, execute: true }],
      ]) {
        prompt(id, invalid);
        const failure = await c.next();
        assert.equal(failure.type, "error");
        assert.equal(failure.requestId, id);
        assert.equal(history.length, 2, "invalid choices never call the model");
      }
      prompt("resume", readOnly);
      assert.equal((await c.next()).type, "settings");
      assert.deepEqual(await c.next(), {
        type: "done",
        requestId: "resume",
        cancelled: false,
      });
      c.send({
        type: "prompt",
        requestId: "legacy",
        text: "Try edit without settings",
        selection: [],
      });
      assert.match((await c.next()).message, /read-only/);
      assert.equal(created, 1);
      assert.equal(history.length, 4);
      assert.equal(history[0].settings.permissions, "read-only");
      assert.equal(history[1].settings.permissions, "reviewed-edits");
      assert.equal(history[3].settings.permissions, "read-only");
      await c.close();
    } finally {
      c.ws.terminate();
      await companion.close();
    }
  },
);

test(
  "settings cancellation never starts inference and inconsistent acknowledgements are rejected",
  { timeout: 15000 },
  async () => {
    let release, configured, cancelled;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const configuring = new Promise((resolve) => {
      configured = resolve;
    });
    const cancellation = new Promise((resolve) => {
      cancelled = resolve;
    });
    let prompted = 0;
    const companion = await startCompanion({
      port: 0,
      createSession: async () => {
        let settings = initial;
        return {
          get canvasSettings() {
            return settings;
          },
          subscribe() {},
          async configureCanvas(next) {
            configured();
            await gate;
            if (next.model === "wrong-ack")
              return { ...next, permissions: "reviewed-edits" };
            settings = next;
            return settings;
          },
          async prompt() {
            prompted++;
          },
          async abort() {
            cancelled();
          },
          dispose() {},
        };
      },
    });
    const c = client(companion.url);
    const readOnly = { ...initial, thinking: "high", permissions: "read-only" };
    try {
      await c.next();
      c.send({
        type: "prompt",
        requestId: "cancel-config",
        text: "Explain",
        selection: [],
        settings: readOnly,
      });
      await configuring;
      c.send({ type: "cancel", requestId: "cancel-config" });
      await cancellation;
      release();
      assert.deepEqual(await c.next(), {
        type: "settings",
        requestId: "cancel-config",
        settings: readOnly,
      });
      assert.deepEqual(await c.next(), {
        type: "done",
        requestId: "cancel-config",
        cancelled: true,
      });
      assert.equal(
        prompted,
        0,
        "Stop during configuration must precede any model request",
      );
      c.send({
        type: "prompt",
        requestId: "wrong",
        text: "Edit",
        selection: [],
        settings: { ...readOnly, model: "wrong-ack" },
      });
      const mismatch = await c.next();
      assert.equal(mismatch.type, "error");
      assert.equal(mismatch.requestId, "wrong");
      assert.match(mismatch.message, /did not accept/);
      assert.equal(
        prompted,
        0,
        "metadata cannot silently escalate read-only access",
      );
      c.send({
        type: "prompt",
        requestId: "resume",
        text: "Explain",
        selection: [],
        settings: initial,
      });
      assert.equal((await c.next()).type, "settings");
      assert.equal((await c.next()).type, "done");
      assert.equal(prompted, 1);
      await c.close();
    } finally {
      release();
      c.ws.terminate();
      await companion.close();
    }
  },
);

test("standalone CLI exposes and validates thinking/permission flags without model calls", () => {
  const script = new URL("../src/main.mjs", import.meta.url);
  const run = (...args) =>
    spawnSync(process.execPath, [script.pathname, ...args], {
      encoding: "utf8",
      timeout: 10000,
    });
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--thinking LEVEL/);
  assert.match(help.stdout, /--permissions read-only\|reviewed-edits/);
  for (const args of [
    ["--thinking", "automatic"],
    ["--permissions", "full-control"],
  ]) {
    const invalid = run("--provider", "test", "--model", "one", ...args);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /valid provider, model, thinking level/);
  }
});
