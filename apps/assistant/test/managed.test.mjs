import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startManagedCompanion } from "../src/managed.mjs";

const origin = "http://127.0.0.1:58310";
const configuration = {
  defaultProvider: "test",
  defaultModel: "small",
  providers: [
    {
      id: "test",
      name: "Test",
      configured: true,
      models: [{ id: "small", name: "Small" }],
    },
  ],
};
function request(companion, path, body) {
  const url = new URL(companion.url.replace("ws:", "http:"));
  url.pathname = path;
  return fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test(
  "managed setup: discovery is metadata-only, one-use connections, isolated keys and no model request",
  { timeout: 10000 },
  async () => {
    const supplied = [];
    let prompts = 0,
      disposed = 0;
    const companion = await startManagedCompanion({
      origins: [origin],
      configuration: async () => configuration,
      factory: async (provider, model, key) => {
        assert.equal(provider, "test");
        assert.equal(model, "small");
        supplied.push(key);
        return async () => ({
          subscribe() {},
          async prompt() {
            prompts++;
          },
          dispose() {
            disposed++;
          },
        });
      },
    });
    const clients = [];
    try {
      const response = await request(companion, "/configuration");
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), configuration);
      assert.equal(
        supplied.length,
        0,
        "opening setup must not create a conversation or request a model",
      );
      const wrong = new URL(companion.url.replace("ws:", "http:"));
      wrong.pathname = "/configuration";
      assert.equal(
        (
          await fetch(wrong, {
            headers: { Origin: "https://attacker.example" },
          })
        ).status,
        403,
      );
      for (const key of [undefined, "test-only-key"]) {
        const result = await request(companion, "/connect", {
          provider: "test",
          model: "small",
          ...(key ? { apiKey: key } : {}),
        });
        assert.equal(result.status, 200);
        const { url } = await result.json();
        assert(!url.includes("test-only-key"));
        const socket = new WebSocket(url, { origin });
        clients.push(socket);
        assert.equal(
          JSON.parse((await once(socket, "message"))[0].toString()).type,
          "ready",
        );
        const replay = new WebSocket(url, { origin });
        clients.push(replay);
        const error = JSON.parse((await once(replay, "message"))[0].toString());
        assert.equal(error.type, "error");
        assert.match(error.message, /expired/);
      }
      assert.deepEqual(supplied, [undefined, "test-only-key"]);
      assert.equal(
        prompts,
        0,
        "Connect alone never makes an inference request",
      );
    } finally {
      for (const client of clients) client.terminate();
      await companion.close();
    }
    assert.equal(disposed, 2);
  },
);

test(
  "managed setup failures are sanitized; unused tickets expire",
  { timeout: 10000 },
  async () => {
    const companion = await startManagedCompanion({
      origins: [origin],
      configuration: async () => {
        throw Error("private credential");
      },
      factory: async (provider) => {
        if (provider === "fail") throw Error("private credential");
        return async () => ({ subscribe() {}, dispose() {} });
      },
      grantTimeoutMs: 10,
    });
    let socket;
    try {
      for (const [path, body] of [
        ["/configuration", undefined],
        [
          "/connect",
          { provider: "fail", model: "small", apiKey: "private credential" },
        ],
        ["/connect", { provider: "test", model: "small", unexpected: true }],
      ]) {
        const response = await request(companion, path, body);
        assert.equal(response.status, 400);
        assert(!(await response.text()).includes("private credential"));
      }
      const response = await request(companion, "/connect", {
        provider: "test",
        model: "small",
      });
      const { url } = await response.json();
      await new Promise((resolve) => setTimeout(resolve, 30));
      socket = new WebSocket(url, { origin });
      assert.equal(
        JSON.parse((await once(socket, "message"))[0].toString()).type,
        "error",
      );
    } finally {
      socket?.terminate();
      await companion.close();
    }
  },
);
