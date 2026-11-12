import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startCanvasMcp } from "../src/mcp.mjs";

test("transport requires a grant, enforces scopes and preserves structured canvas errors", async () => {
  const app = await startCanvasMcp();
  const client = new Client({ name: "scope-client", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const decode = (result) => JSON.parse(result.content[0].text);
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  let ws;
  try {
    await app.server.connect(a);
    await client.connect(b);
    ws = new WebSocket(app.endpoint, { origin: "http://127.0.0.1:58310" });
    const hello = once(ws, "message");
    await once(ws, "open");
    await hello;
    assert.equal(
      decode(await call("connect_canvas")).connected,
      false,
      "a socket alone is not a grant",
    );
    for (const scope of ["read-only", "proposal-only", "edit"]) {
      const ready = once(ws, "message");
      ws.send(JSON.stringify({ type: "grant", scope, sessionId: "scope-tab" }));
      await ready;
      assert.equal(decode(await call("connect_canvas")).scope, scope);
      const denied = await call("start_compute", {
        operationId: "no-compute",
        expectedSessionId: "scope-tab",
        expectedDocumentId: "root",
        target: {
          document: "doc",
          item: "request",
          selection: { kind: "follow" },
          selector: { kind: "whole", version: 1 },
        },
      });
      assert.equal(decode(denied).error.code, "PERMISSION_DENIED");
      assert.deepEqual(denied.structuredContent, decode(denied));
      if (scope !== "edit")
        assert.equal(
          decode(
            await call("edit_canvas", {
              operationId: "no-edit",
              expectedSessionId: "scope-tab",
              batch: {},
            }),
          ).error.code,
          "PERMISSION_DENIED",
        );
      if (scope === "read-only")
        assert.equal(
          decode(
            await call("prepare_edit", {
              explanation: "no",
              batch: { expectedDocumentId: "root", edits: [{}] },
            }),
          ).error.code,
          "PERMISSION_DENIED",
        );
    }
    const request = once(ws, "message");
    const result = call("inspect_model", { id: "missing" });
    const message = JSON.parse((await request)[0].toString());
    ws.send(
      JSON.stringify({
        id: message.id,
        error: {
          code: "ITEM_NOT_FOUND",
          message: "Missing model",
          recovery: "Inspect models to find a valid ID.",
        },
      }),
    );
    assert.deepEqual(decode(await result), {
      error: {
        code: "ITEM_NOT_FOUND",
        message: "Missing model",
        recovery: "Inspect models to find a valid ID.",
      },
    });
    const tools = (await client.listTools()).tools;
    assert.equal(
      tools.find((tool) => tool.name === "inspect_model").annotations
        .readOnlyHint,
      true,
    );
    assert.equal(
      tools.find((tool) => tool.name === "edit_canvas").annotations
        .idempotentHint,
      true,
    );
  } finally {
    ws?.terminate();
    await client.close();
    await app.close();
  }
});
