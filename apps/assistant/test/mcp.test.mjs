import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startCanvasMcp } from "../src/mcp.mjs";

async function fixture(t, options) {
  const app = await startCanvasMcp(options);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await app.server.connect(a);
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await app.close();
  });
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  return { app, client, call };
}
const text = (result) => JSON.parse(result.content[0].text);
const open = async (endpoint, scope = "full-control") => {
  const ws = new WebSocket(endpoint, { origin: "http://127.0.0.1:58310" });
  const hello = once(ws, "message");
  await once(ws, "open");
  assert.equal(JSON.parse((await hello)[0].toString()).agent.name, "test");
  const ready = once(ws, "message");
  ws.send(JSON.stringify({ type: "grant", scope, sessionId: "tab-session" }));
  assert.equal(JSON.parse((await ready)[0].toString()).type, "ready");
  return ws;
};
const rejected = (url, origin) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.on("unexpected-response", (_request, response) => {
      response.resume();
      ws.terminate();
      resolve(response.statusCode);
    });
    ws.on("error", () => {});
    ws.on("open", () => {
      ws.close();
      reject(Error("Unauthorized socket opened"));
    });
  });

test("MCP discovery, explicit connection, schemas and correlated tools", async (t) => {
  const { app, client, call } = await fixture(t);
  const listed = await client.listTools();
  for (const name of [
    "connect_canvas",
    "edit_canvas",
    "compute",
    "undo",
    "redo",
    "apply_proposal",
    "look_at_canvas",
  ])
    assert(listed.tools.some((tool) => tool.name === name));
  assert.equal(
    text(await call("inspect_workspace")).error.code,
    "NO_CANVAS_CONNECTED",
  );
  assert.equal(text(await call("undo", {})).error.code, "INVALID_ARGUMENTS");
  assert.equal(
    text(await call("validate", { extra: true })).error.code,
    "INVALID_ARGUMENTS",
  );
  assert.equal(text(await call("bash")).error.code, "UNKNOWN_TOOL");
  const connection = text(await call("connect_canvas"));
  assert.equal(
    new URLSearchParams(new URL(connection.url).hash.slice(1)).get("mcp"),
    app.endpoint,
  );
  assert.equal(connection.connected, false);
  assert.equal(await rejected(app.endpoint, "https://evil.example"), 403);
  assert.equal(
    await rejected(
      app.endpoint.replace(/token=.*/, "token=bad"),
      "http://127.0.0.1:58310",
    ),
    403,
  );
  const ws = await open(app.endpoint);
  t.after(() => ws.terminate());
  assert.equal(
    await rejected(app.endpoint, "http://127.0.0.1:58310"),
    403,
    "only one canvas may own the connection",
  );
  assert.equal(text(await call("connect_canvas")).connected, true);
  const received = once(ws, "message");
  const response = call("inspect_canvas", { limit: 1 });
  const message = JSON.parse((await received)[0].toString());
  ws.send(JSON.stringify({ id: "wrong", result: "must be ignored" }));
  assert((await call("validate")).isError, "concurrent calls are rejected");
  ws.send(
    JSON.stringify({ id: message.id, result: { documentId: "reviewed" } }),
  );
  assert.equal(text(await response).documentId, "reviewed");
  const imageRequest = once(ws, "message");
  const imageResponse = call("look_at_canvas");
  const imageCall = JSON.parse((await imageRequest)[0].toString());
  ws.send(
    JSON.stringify({
      id: imageCall.id,
      result: { mimeType: "image/jpeg", data: "YWJj", width: 1, height: 1 },
    }),
  );
  assert.equal((await imageResponse).content[1].type, "image");
});

test("timeout cancels browser authority and disconnect releases a call", async (t) => {
  const { app, call } = await fixture(t, { timeoutMs: 40 });
  const ws = await open(app.endpoint);
  t.after(() => ws.terminate());
  const request = once(ws, "message");
  const response = call("validate");
  const id = JSON.parse((await request)[0].toString()).id;
  const cancelled = once(ws, "message");
  assert.equal(text(await response).error.code, "TIMEOUT");
  assert.deepEqual(JSON.parse((await cancelled)[0].toString()), {
    type: "cancel",
    id,
  });
  const next = once(ws, "message");
  const disconnected = call("inspect_workspace");
  await next;
  ws.close();
  assert.match((await disconnected).content[0].text, /disconnected/);
});

test("reject nonlocal canvas URL", async () => {
  await assert.rejects(
    startCanvasMcp({ canvasUrl: "https://example.com" }),
    /local HTTP/,
  );
});
