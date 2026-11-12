import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  createAgentSession,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { startCompanion } from "../src/server.mjs";
import { canvasTools, sessionOptions } from "../src/pi.mjs";

function client(url, origin = "http://127.0.0.1:58310") {
  const ws = new WebSocket(url, { origin });
  const queue = [],
    waiters = [];
  ws.on("message", (bytes) => {
    const value = JSON.parse(bytes.toString());
    if (waiters.length) waiters.shift()(value);
    else queue.push(value);
  });
  return {
    ws,
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift())
        : new Promise((resolve) => waiters.push(resolve)),
    send: (value) => ws.send(JSON.stringify(value)),
    close: async () => {
      const closed = once(ws, "close");
      ws.close();
      await closed;
    },
  };
}
function fakeSession(call) {
  let listener, rejectAbort;
  return {
    subscribe(fn) {
      listener = fn;
    },
    async prompt(text) {
      if (text.startsWith("wait")) {
        await new Promise((_resolve, reject) => {
          rejectAbort = reject;
        });
      } else {
        const result = await call("inspect_workspace", {}, undefined);
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: `Inspected ${result.documentId}`,
          },
        });
      }
    },
    async abort() {
      rejectAbort?.(Error("Cancelled"));
    },
    dispose() {
      rejectAbort?.(Error("Disconnected"));
    },
  };
}

test(
  "authenticated local bridge: inspect round trip, streaming, duplicates, busy, cancellation and disconnect",
  { timeout: 15000 },
  async () => {
    let disposed = 0;
    const companion = await startCompanion({
      port: 0,
      createSession: async (call) => {
        const session = fakeSession(call),
          dispose = session.dispose;
        session.dispose = () => {
          disposed++;
          dispose();
        };
        return session;
      },
    });
    let c;
    try {
      for (const [url, origin] of [
        [
          companion.url.replace(/token=.*/, "token=wrong"),
          "http://127.0.0.1:58310",
        ],
        [companion.url, "https://attacker.example"],
        [companion.url, undefined],
      ]) {
        const socket = new WebSocket(url, origin ? { origin } : {});
        const rejected = new Promise((resolve) =>
          socket.once("unexpected-response", (_req, res) => {
            res.resume();
            socket.terminate();
            resolve(res.statusCode);
          }),
        );
        socket.on("error", () => {});
        assert.equal(await rejected, 403);
      }
      // Malformed unauthenticated upgrade targets must not crash the local process.
      const port = Number(new URL(companion.url).port);
      const malformed = createConnection({ host: "127.0.0.1", port });
      await once(malformed, "connect");
      malformed.write(
        `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
      );
      const [response] = await once(malformed, "data");
      assert.match(response.toString(), /400 Bad Request/);
      malformed.destroy();
      c = client(companion.url);
      assert.equal((await c.next()).type, "ready");
      c.send({
        type: "prompt",
        requestId: "one",
        text: "Inspect",
        selection: ["selected-id"],
      });
      const tool = await c.next();
      assert.equal(tool.type, "tool");
      assert.equal(tool.name, "inspect_workspace");
      c.send({
        type: "prompt",
        requestId: "overlap",
        text: "Inspect",
        selection: [],
      });
      assert.match((await c.next()).message, /busy/);
      c.send({
        type: "tool_result",
        id: tool.id,
        requestId: "wrong",
        result: { documentId: "wrong" },
      });
      c.send({
        type: "tool_result",
        id: tool.id,
        requestId: "one",
        result: { documentId: "root-1" },
      });
      assert.deepEqual(await c.next(), {
        type: "text",
        requestId: "one",
        text: "Inspected root-1",
      });
      assert.equal((await c.next()).type, "done");
      c.send({
        type: "prompt",
        requestId: "one",
        text: "Replay",
        selection: [],
      });
      assert.equal((await c.next()).type, "error");
      c.send({ type: "prompt", requestId: "two", text: "wait", selection: [] });
      c.send({ type: "cancel", requestId: "two" });
      assert.equal((await c.next()).type, "error");
      c.send({
        type: "prompt",
        requestId: "three",
        text: "Inspect again",
        selection: [],
      });
      const next = await c.next();
      assert.equal(next.type, "tool");
      c.send({
        type: "tool_result",
        id: next.id,
        requestId: "three",
        result: { documentId: "root-2" },
      });
      assert.equal((await c.next()).text, "Inspected root-2");
      assert.equal((await c.next()).type, "done");
      await c.close();
      c = undefined;
      assert.equal(disposed, 1);
    } finally {
      c?.ws.terminate();
      await companion.close();
    }
  },
);

test(
  "tool cancellation, timeouts and dropped connections release pending work",
  { timeout: 15000 },
  async () => {
    const companion = await startCompanion({
      port: 0,
      toolTimeoutMs: 20,
      createSession: async (call) => ({
        subscribe() {},
        async prompt() {
          await call("inspect_workspace", {}, undefined);
        },
        async abort() {},
        dispose() {},
      }),
    });
    const c = client(companion.url);
    try {
      await c.next();
      c.send({
        type: "prompt",
        requestId: "timeout",
        text: "Inspect",
        selection: [],
      });
      assert.equal((await c.next()).type, "tool");
      assert.match((await c.next()).message, /timed out/);
      c.send({
        type: "prompt",
        requestId: "cancel",
        text: "Inspect",
        selection: [],
      });
      assert.equal((await c.next()).type, "tool");
      c.send({ type: "cancel", requestId: "cancel" });
      assert.match((await c.next()).message, /stopped/);
      c.send({
        type: "prompt",
        requestId: "disconnect",
        text: "Inspect",
        selection: [],
      });
      assert.equal((await c.next()).type, "tool");
      await c.close();
    } finally {
      c.ws.terminate();
      await companion.close();
    }
  },
);

test("real Pi SDK session loads only canvas tools and no discovered resources; no model call", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "manifold-pi-test-"));
  let session;
  try {
    const runtime = await ModelRuntime.create({
      authPath: join(cwd, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(cwd, "models.json"),
      refreshOnCreate: false,
    });
    const model = runtime.getModels()[0];
    assert(model, "static Pi model catalog must be available");
    const options = sessionOptions({
      modelRuntime: runtime,
      model,
      cwd,
      call: async () => ({ documentId: "test" }),
    });
    ({ session } = await createAgentSession(options));
    assert.deepEqual(session.getActiveToolNames().sort(), [
      "capabilities",
      "inspect_workspace",
      "prepare_edit",
    ]);
    assert.equal(options.resourceLoader.getExtensions().extensions.length, 0);
    assert.equal(options.resourceLoader.getAgentsFiles().agentsFiles.length, 0);
    assert.equal(options.resourceLoader.getSkills().skills.length, 0);
    assert.match(session.systemPrompt, /untrusted data/);
    assert.match(session.systemPrompt, /Never claim it was applied/);
    const tools = canvasTools(async (name) => ({ name }));
    const result = await tools[0].execute("call", {}, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), {
      name: "inspect_workspace",
    });
    assert.equal(session.messages.length, 0);
  } finally {
    session?.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
