import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startManagedCompanion } from "../src/managed.mjs";
import { CanvasSettingsError } from "../src/canvas-settings.mjs";

const origin = "http://127.0.0.1:58310";
const configuration = {
  defaultProvider: "test",
  defaultModel: "small",
  providers: [
    {
      id: "test",
      name: "Test",
      configured: true,
      models: [
        {
          id: "small",
          name: "Small",
          thinkingLevels: ["off", "high"],
          defaultThinking: "off",
        },
      ],
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
  "concurrent managed setup reserves the connection limit and releases failed reservations",
  { timeout: 10000 },
  async () => {
    let releaseFactory, fourStarted, extraStarted;
    const factoryGate = new Promise((resolve) => {
      releaseFactory = resolve;
    });
    const fourFactoriesStarted = new Promise((resolve) => {
      fourStarted = resolve;
    });
    const extraFactoryStarted = new Promise((resolve) => {
      extraStarted = resolve;
    });
    let factories = 0;
    const companion = await startManagedCompanion({
      origins: [origin],
      configuration: async () => configuration,
      factory: async (provider) => {
        factories++;
        if (provider === "fail") throw Error("Provider setup failed");
        if (factories === 4) fourStarted();
        if (factories > 4) extraStarted();
        await factoryGate;
        return async () => ({ subscribe() {}, dispose() {} });
      },
    });
    const pending = [];
    let socket;
    try {
      for (let i = 0; i < 4; i++)
        pending.push(
          request(companion, "/connect", { provider: "test", model: "small" }),
        );
      await fourFactoriesStarted;
      const overflow = request(companion, "/connect", {
        provider: "test",
        model: "small",
      });
      pending.push(overflow);
      // Settle even under the regression: an incorrectly admitted fifth setup
      // signals its factory entry, rather than hanging this check on the gate.
      await Promise.race([overflow, extraFactoryStarted]);
      releaseFactory();
      const responses = await Promise.all(pending);
      assert.equal(responses[4].status, 400);
      assert.equal(factories, 4, "overflow must not allocate another runtime");
      const tickets = [];
      for (const response of responses.slice(0, 4)) {
        assert.equal(response.status, 200);
        tickets.push((await response.json()).url);
      }
      socket = new WebSocket(tickets[0], { origin });
      assert.equal(
        JSON.parse((await once(socket, "message"))[0].toString()).type,
        "ready",
      );
      const failed = await request(companion, "/connect", {
        provider: "fail",
        model: "small",
      });
      assert.equal(failed.status, 400);
      const retry = await request(companion, "/connect", {
        provider: "test",
        model: "small",
      });
      assert.equal(retry.status, 200, "failed setup releases its reservation");
      assert.equal(factories, 6);
    } finally {
      releaseFactory();
      socket?.terminate();
      await Promise.allSettled(pending);
      await companion.close();
    }
  },
);

test(
  "managed thinking/access settings reach the factory and ready metadata; unsupported choices never prompt",
  { timeout: 10000 },
  async () => {
    const received = [];
    let prompted = 0;
    const companion = await startManagedCompanion({
      origins: [origin],
      configuration: async () => configuration,
      factory: async (provider, model, key, settings) => {
        if (!["off", "high"].includes(settings.thinking))
          throw new CanvasSettingsError(
            "This model supports off or high thinking",
          );
        received.push({ provider, model, key, ...settings });
        return async () => ({
          subscribe() {},
          async prompt() {
            prompted++;
          },
          dispose() {},
        });
      },
    });
    const clients = [];
    try {
      for (const invalid of [
        { thinking: null },
        { permissions: null },
        { thinking: "unknown" },
        { thinking: "max" },
        { permissions: "full-control" },
      ]) {
        const response = await request(companion, "/connect", {
          provider: "test",
          model: "small",
          ...invalid,
        });
        assert.equal(response.status, 400);
      }
      assert.equal(received.length, 0);
      for (const input of [
        { provider: "test", model: "small" },
        {
          provider: "test",
          model: "small",
          thinking: "high",
          permissions: "read-only",
        },
      ]) {
        const response = await request(companion, "/connect", input);
        assert.equal(response.status, 200);
        const result = await response.json();
        const expected = {
          thinking: "off",
          permissions: "reviewed-edits",
          ...input,
        };
        assert.deepEqual(result.settings, expected);
        const socket = new WebSocket(result.url, { origin });
        clients.push(socket);
        const ready = JSON.parse((await once(socket, "message"))[0].toString());
        assert.deepEqual(ready, { type: "ready", settings: expected });
      }
      assert.deepEqual(received, [
        {
          provider: "test",
          model: "small",
          key: undefined,
          thinking: "off",
          permissions: "reviewed-edits",
        },
        {
          provider: "test",
          model: "small",
          key: undefined,
          thinking: "high",
          permissions: "read-only",
        },
      ]);
      assert.equal(
        prompted,
        0,
        "configuration and connection never run inference",
      );
    } finally {
      for (const socket of clients) socket.terminate();
      await companion.close();
    }
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
