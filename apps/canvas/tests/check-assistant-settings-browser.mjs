import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { startCompanion } from "../../assistant/src/server.mjs";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const defaults = {
  provider: "settings-test",
  model: "engine-a",
  thinking: "low",
  permissions: "reviewed-edits",
};
let connected = defaults,
  sessions = 0,
  blocked = 0,
  release;
const requests = [],
  connections = [],
  errors = [];
const companion = await startCompanion({
  port: 0,
  origins: [new URL(base).origin],
  createSession: async (call) => {
    sessions++;
    let settings = { ...connected },
      listener;
    return {
      get canvasSettings() {
        return settings;
      },
      configureCanvas(next) {
        assert.equal(next.provider, "settings-test");
        const levels =
          next.model === "engine-a"
            ? ["off", "low", "high"]
            : next.model === "engine-b"
              ? ["off"]
              : [];
        assert(levels.includes(next.thinking));
        settings = { ...next };
        return settings;
      },
      subscribe(fn) {
        listener = fn;
      },
      async prompt(text) {
        requests.push({ text, settings: { ...settings } });
        const state = await call("inspect_workspace", {}, undefined);
        const proposal = {
          explanation: "An explicit reviewed note",
          batch: {
            expectedDocumentId: state.documentId,
            edits: [
              { operation: "createNote", text: "Reviewed settings note" },
            ],
          },
        };
        let answer = `Responded with ${settings.model}/${settings.thinking}.`;
        if (text.startsWith("Read-only probe")) {
          await assert.rejects(
            call("prepare_edit", proposal, undefined),
            /read.only/i,
          );
          blocked++;
          answer = "Read-only inspection succeeded; the edit was blocked.";
        } else if (text.startsWith("Propose")) {
          await call("prepare_edit", proposal, undefined);
          answer = "A note is ready for your review.";
        } else if (text.startsWith("Hold")) {
          await new Promise((resolve) => {
            release = resolve;
          });
        }
        listener({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: answer },
        });
      },
      async abort() {
        release?.();
      },
      dispose() {
        release?.();
      },
    };
  },
});
const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1450, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/assistant/configuration", (route) =>
    route.fulfill({
      json: {
        defaultProvider: defaults.provider,
        defaultModel: defaults.model,
        providers: [
          {
            id: defaults.provider,
            name: "Configured test provider",
            configured: true,
            models: [
              {
                id: "engine-a",
                name: "Engineering Alpha",
                thinkingLevels: ["off", "low", "high"],
                defaultThinking: "low",
              },
              {
                id: "engine-b",
                name: "Engineering Beta",
                thinkingLevels: ["off"],
                defaultThinking: "off",
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/assistant/connect", (route) => {
    connected = route.request().postDataJSON();
    connections.push(connected);
    return route.fulfill({ json: { url: companion.url, settings: connected } });
  });
  await page.goto(base);
  await readWorkspace(page);
  const original = await readWorkspaceBytes(page);
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  const panel = page.getByRole("dialog", {
      name: "Canvas assistant Pi · experimental",
      exact: true,
    }),
    picker = panel.getByRole("button", {
      name: "Choose assistant model and thinking",
      exact: true,
    }),
    permissions = panel.getByLabel("Assistant permissions", { exact: true }),
    input = panel.getByRole("textbox", {
      name: /^Ask about (?:or edit )?the canvas$/,
    });
  const openPicker = async () => {
    await picker.click();
    await expect(
      panel.getByRole("combobox", { name: "Search assistant models" }),
    ).toBeFocused();
  };
  const ask = async (text) => {
    await input.fill(text);
    await input.press("Enter");
    await expect(
      panel.getByRole("button", { name: "Stop request" }),
    ).toHaveCount(0);
    await expect(input).toHaveValue("");
  };
  await expect(picker).toContainText("Engineering Alpha");
  await expect(picker).toContainText("Thinking Low");
  await openPicker();
  await panel
    .getByLabel("Assistant thinking", { exact: true })
    .selectOption("high");
  await panel
    .getByRole("combobox", { name: "Search assistant models" })
    .press("Escape");
  await expect(picker).toBeFocused();
  await expect(panel).toBeVisible();
  await expect(picker).toContainText("Thinking High");
  await permissions.selectOption("read-only");
  assert.equal(
    connections.length,
    0,
    "choosing settings never sends a request",
  );
  await ask("Read-only probe");
  await expect(panel.locator(".assistant-answer").last()).toContainText(
    "the edit was blocked",
  );
  assert.equal(blocked, 1);
  assert.deepEqual(connections, [
    { ...defaults, thinking: "high", permissions: "read-only" },
  ]);
  assert.deepEqual(requests[0].settings, connections[0]);
  await expect(panel.locator(".assistant-turn-settings").first()).toContainText(
    "engine-a · Thinking high · Read-only",
  );
  assert.equal(await readWorkspaceBytes(page), original);

  await openPicker();
  const search = panel.getByRole("combobox", {
    name: "Search assistant models",
  });
  await search.fill("Beta");
  await expect(
    panel
      .getByRole("listbox", { name: "Available assistant models" })
      .getByRole("option"),
  ).toHaveCount(1);
  await search.press("Enter");
  await expect(picker).toBeFocused();
  await expect(picker).toContainText("Engineering Beta");
  await expect(picker).toContainText("Thinking Off");
  await openPicker();
  await expect(
    panel.getByLabel("Assistant thinking", { exact: true }),
  ).toBeDisabled();
  await search.press("Escape");
  await permissions.selectOption("reviewed-edits");
  await ask("Propose the first note");
  await expect(panel.getByRole("article").last()).toContainText("pending");
  await expect(panel.locator(".assistant-turn")).toHaveCount(2);
  assert.equal(sessions, 1, "model switches retain the actual agent session");
  assert.equal(connections.length, 1, "model switches do not reconnect");
  assert.deepEqual(requests[1].settings, {
    ...defaults,
    model: "engine-b",
    thinking: "off",
  });
  assert.equal(await readWorkspaceBytes(page), original);
  await permissions.selectOption("read-only");
  await expect(panel.getByRole("article").last()).toContainText("dismissed");
  await expect(
    panel.getByRole("button", { name: "Apply edit" }),
  ).toBeDisabled();
  await permissions.selectOption("reviewed-edits");
  await expect(
    panel.getByRole("button", { name: "Apply edit" }),
  ).toBeDisabled();
  await ask("Propose a fresh note");
  await panel.getByRole("button", { name: "Apply edit" }).last().click();
  await expect(panel.getByRole("article").last()).toContainText("applied");
  await expect(
    page.locator(".er-note").filter({ hasText: "Reviewed settings note" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.locator(".er-note").filter({ hasText: "Reviewed settings note" }),
  ).toHaveCount(0);

  await input.fill("Hold this turn");
  await input.press("Enter");
  await expect(
    panel.getByRole("button", { name: "Stop request" }),
  ).toBeVisible();
  await expect(picker).toBeDisabled();
  await expect(permissions).toBeDisabled();
  await expect.poll(() => typeof release).toBe("function");
  release();
  await expect(picker).toBeEnabled();
  await expect(panel.locator(".assistant-turn")).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 740 });
  await expect(picker).toBeInViewport();
  await expect(permissions).toBeInViewport();
  await openPicker();
  await expect(
    panel.getByRole("dialog", { name: "Assistant model and thinking" }),
  ).toBeInViewport();
  await search.press("Escape");
  assert.equal(sessions, 1);
  const saved = JSON.stringify((await readWorkspace(page)).page);
  assert(!saved.includes("engine-a") && !saved.includes("engine-b"));
  assert.deepEqual(errors, []);
  console.log(
    "Assistant settings: discoverable searchable model/thinking picker, keyboard/focus/mobile behavior, supported thinking levels, per-turn settings and history continuity, zero-request preferences, backend read-only enforcement, proposal revocation, explicit Apply/Undo, active-turn locking and no saved settings pass.",
  );
} finally {
  release?.();
  await browser.close();
  await companion.close();
}
