import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { startCompanion } from "../../assistant/src/server.mjs";
import { readWorkspace } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const requests = [];
let tools = 0,
  disposed = 0;
const companion = await startCompanion({
  port: 0,
  origins: [new URL(base).origin],
  createSession: async (call) => {
    let listener, aborted;
    return {
      subscribe(fn) {
        listener = fn;
      },
      async prompt(text) {
        requests.push(text);
        if (text.startsWith("Wait")) {
          await new Promise((_resolve, reject) => {
            aborted = reject;
          });
          return;
        }
        const state = await call("inspect_workspace", {}, undefined);
        tools++;
        const model = state.models[0];
        await call("capabilities", {}, undefined);
        tools++;
        await call(
          "prepare_edit",
          {
            explanation:
              "Set spring displacement to 3 mm. Recompute explicitly for checked evidence.",
            batch: {
              expectedDocumentId: state.documentId,
              edits: [
                {
                  operation: "setModelInput",
                  model: model.id,
                  input: "displacement",
                  value: 3,
                },
                { operation: "createNote", text: "Assume a linear spring" },
              ],
            },
          },
          undefined,
        );
        tools++;
        listener({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: "Prepared for review; nothing has been applied.",
          },
        });
      },
      async abort() {
        aborted?.(Error("Request cancelled"));
      },
      dispose() {
        disposed++;
        aborted?.(Error("Disconnected"));
      },
    };
  },
});
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
try {
  const configurations = [];
  let failNextConnection = false;
  let delayedConnection;
  await page.route("**/api/assistant/configuration", (route) =>
    route.fulfill({
      json: {
        defaultProvider: "test",
        defaultModel: "configured-default",
        providers: [
          {
            id: "test",
            name: "Existing Pi provider",
            configured: true,
            models: [{ id: "configured-default", name: "Configured default" }],
          },
          {
            id: "key-only",
            name: "API key provider",
            configured: false,
            models: [{ id: "small", name: "Small" }],
          },
        ],
      },
    }),
  );
  await page.route("**/api/assistant/connect", async (route) => {
    configurations.push(route.request().postDataJSON());
    if (failNextConnection) {
      failNextConnection = false;
      return route.fulfill({
        status: 503,
        json: { error: "Temporary assistant setup failure" },
      });
    }
    const delayed = delayedConnection;
    if (delayed) await delayed.hold;
    else await new Promise((resolve) => setTimeout(resolve, 50));
    await route.fulfill({ json: { url: companion.url } });
    delayed?.complete();
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Insert spring model");
  await page
    .getByRole("button", { name: "Insert spring model", exact: true })
    .click();
  const model = page.getByLabel("Spring model", { exact: true });
  await model
    .getByRole("button", { name: "Compute model", exact: true })
    .click();
  await expect(model.locator(".im-status")).toContainText("current");
  const trigger = model.getByRole("button", {
    name: "Ask agent about Spring",
    exact: true,
  });
  const triggerBounds = await trigger.boundingBox();
  await trigger.click();
  const panel = page.getByRole("dialog", {
    name: "Canvas assistant Pi · experimental",
  });
  await expect(panel).toBeVisible();
  const settings = panel.getByRole("button", {
    name: "Assistant settings",
    exact: true,
  });
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByLabel("Provider", { exact: true })).toBeHidden();
  const input = panel.getByRole("textbox", {
    name: "Ask about or edit the canvas",
  });
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  const compact = await panel.boundingBox();
  expect(compact.width).toBeLessThanOrEqual(320);
  expect(compact.height).toBeLessThanOrEqual(60);
  expect(
    Math.abs(compact.x - (triggerBounds.x + triggerBounds.width / 2 + 12)),
  ).toBeLessThan(2);
  expect(
    Math.abs(compact.y - (triggerBounds.y + triggerBounds.height / 2 + 12)),
  ).toBeLessThan(2);
  await input.fill("Keep this draft");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("Keep this draft\n");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  expect(configurations).toHaveLength(0);
  await settings.click();
  await expect(panel.getByLabel("Provider", { exact: true })).toHaveValue(
    "test",
  );
  await expect(panel.getByLabel("Model", { exact: true })).toHaveValue(
    "configured-default",
  );
  // DOM order follows the visible composer/settings order for keyboard navigation.
  const closeButton = panel.getByRole("button", {
    name: "Close canvas assistant",
    exact: true,
  });
  await closeButton.focus();
  await closeButton.press("Tab");
  await expect(panel.getByLabel("Provider", { exact: true })).toBeFocused();
  await settings.click();
  await expect(input).toHaveValue("Keep this draft\n");
  await expect(input).toBeFocused();
  await expect(input).toHaveAccessibleDescription(
    /1 selected object\(s\) will be attached/,
  );
  const before = await readWorkspace(page);
  const ask = async (text) => {
    const turns = await panel.locator(".assistant-turn").count();
    await input.fill(text);
    await input.press("Enter");
    await input.press("Enter"); // Repeated submission while connecting/running must not duplicate requests.
    await expect(panel.locator(".assistant-turn")).toHaveCount(turns + 1);
    await expect(
      panel.getByRole("button", { name: "Stop request", exact: true }),
    ).toHaveCount(0);
  };
  await ask("Set displacement to 3 mm");
  expect(configurations).toEqual([
    { provider: "test", model: "configured-default" },
  ]);
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  const proposal = panel
    .getByRole("article", { name: "Proposed canvas edit" })
    .last();
  await expect(proposal).toContainText("pending");
  await expect(proposal).toContainText("Displacement [mm]");
  await expect(
    model.getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("2");
  await expect(model.getByLabel("Model force")).toHaveText("20 N");
  expect((await readWorkspace(page)).document.id).toBe(before.document.id);
  expect(requests[0]).toContain(
    before.document.items
      .entries()
      .find(([, item]) => item.label === "Spring")[0],
  );
  await proposal
    .getByRole("button", { name: "Apply edit", exact: true })
    .click();
  await expect(proposal).toContainText("applied");
  await expect(
    model.getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("3");
  await expect(model.getByLabel("Model force")).toHaveText("30 N");
  await expect(model.locator(".im-status")).not.toContainText("current");
  // Panel keyboard events cannot trigger canvas Undo; the canvas remains usable outside it.
  await input.fill("Preserve this draft");
  await input.press("Control+z");
  await expect(
    model.getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("3");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    model.getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("2");
  expect(
    (await readWorkspace(page)).page.regions.some(
      (r) => r.text === "Assume a linear spring",
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    model.getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("3");

  await ask("Prepare another change");
  const stale = panel
    .getByRole("article", { name: "Proposed canvas edit" })
    .last();
  await expect(stale).toContainText("pending");
  const displacement = model.getByLabel("Spring Displacement", { exact: true });
  await displacement.fill("4");
  // An unaccepted renderer draft blocks Apply without implicitly accepting it.
  await stale.getByRole("button", { name: "Apply edit", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Finish or cancel");
  await displacement
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Use value", exact: true })
    .click();
  await expect(stale).toContainText("stale");
  await expect(
    stale.getByRole("button", { name: "Apply edit", exact: true }),
  ).toBeDisabled();
  await stale.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(stale).toContainText("dismissed");
  await expect(displacement).toHaveValue("4");

  await input.fill("Wait until stopped");
  await panel
    .getByRole("button", { name: "Send request", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Stop request", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Stop request", exact: true }),
  ).toHaveCount(0);
  await expect(displacement).toHaveValue("4");
  await ask("Prepare for disconnect");
  await expect(panel.getByRole("article").last()).toContainText("pending");
  await panel
    .getByRole("button", { name: "Close canvas assistant", exact: true })
    .click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => disposed).toBe(1);
  await expect(displacement).toHaveValue("4");
  await page.reload();
  await expect(
    page
      .getByLabel("Spring model", { exact: true })
      .getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("4");
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("article")).toHaveCount(0);
  const setup = page.getByRole("dialog");
  const setupGear = setup.getByRole("button", {
    name: "Assistant settings",
    exact: true,
  });
  await setupGear.click();
  await setup.getByLabel("Provider", { exact: true }).selectOption("key-only");
  await setupGear.click();
  const draft = setup.getByRole("textbox", {
    name: "Ask about or edit the canvas",
  });
  await draft.fill("Keep this request until credentials are configured");
  await draft.press("Enter");
  await expect(setupGear).toHaveAttribute("aria-expanded", "true");
  await expect(draft).toHaveValue(
    "Keep this request until credentials are configured",
  );
  expect(configurations).toHaveLength(1);
  await expect(
    setup.getByRole("button", { name: "Connect assistant", exact: true }),
  ).toBeDisabled();
  await setup.getByText("Configure an API key", { exact: true }).click();
  await setup
    .getByLabel("Provider API key", { exact: true })
    .fill("key-for-wrong-provider");
  await setup.getByLabel("Provider", { exact: true }).selectOption("test");
  expect(
    await setup.getByLabel("Provider API key", { exact: true }).inputValue(),
  ).toBe("");
  await setup.getByLabel("Provider", { exact: true }).selectOption("key-only");
  await setup
    .getByLabel("Provider API key", { exact: true })
    .fill("test-only-browser-key");
  failNextConnection = true;
  await setup
    .getByRole("button", { name: "Connect assistant", exact: true })
    .click();
  await expect(setup.getByRole("alert")).toContainText(
    "Temporary assistant setup failure",
  );
  await expect(setupGear).toHaveAttribute("aria-expanded", "true");
  await expect(draft).toHaveValue(
    "Keep this request until credentials are configured",
  );
  await setup
    .getByLabel("Provider API key", { exact: true })
    .fill("test-only-browser-key");
  await setup
    .getByRole("button", { name: "Connect assistant", exact: true })
    .click();
  await expect(setupGear).toHaveAttribute("aria-expanded", "false");
  await expect(draft).toHaveValue(
    "Keep this request until credentials are configured",
  );
  expect(configurations).toHaveLength(3);
  expect(configurations[2]).toEqual({
    provider: "key-only",
    model: "small",
    apiKey: "test-only-browser-key",
  });
  expect(
    await setup.getByLabel("Provider API key", { exact: true }).inputValue(),
  ).toBe("");
  expect(JSON.stringify((await readWorkspace(page)).page)).not.toContain(
    "test-only-browser-key",
  );
  await setup
    .getByRole("button", { name: "Close canvas assistant", exact: true })
    .click();
  await expect.poll(() => disposed).toBe(2);
  // A contextual request opens at the canvas point, not in a sidebar, and stays on-screen.
  await page.mouse.click(1480, 940, { button: "right" });
  await page.getByRole("menuitem", { name: "Ask agent", exact: true }).click();
  const contextual = page.getByRole("dialog", {
    name: "Canvas assistant Pi · experimental",
  });
  const contextualInput = contextual.getByRole("textbox", {
    name: "Ask about or edit the canvas",
  });
  await expect(contextualInput).toBeFocused();
  const edge = await contextual.boundingBox();
  expect(edge.x + edge.width).toBeLessThanOrEqual(1492);
  expect(edge.y + edge.height).toBeLessThanOrEqual(992);
  expect(edge.height).toBeLessThanOrEqual(60);
  await page.setViewportSize({ width: 390, height: 700 });
  await contextual
    .getByRole("button", { name: "Assistant settings", exact: true })
    .click();
  await expect(async () => {
    const bounds = await contextual.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(382);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(692);
  }).toPass();
  await contextualInput.press("Escape");
  await expect(contextual).toHaveCount(0);
  expect(configurations).toHaveLength(3);
  // Closing during managed setup must revoke the pending request, not connect/send later.
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  await contextualInput.fill("Close before connecting");
  await expect(
    contextual.getByRole("button", { name: "Send request", exact: true }),
  ).toBeEnabled();
  const held = Promise.withResolvers();
  const completed = Promise.withResolvers();
  delayedConnection = { hold: held.promise, complete: completed.resolve };
  const inferenceCount = requests.length;
  const connecting = page.waitForRequest("**/api/assistant/connect");
  await contextualInput.press("Enter");
  await connecting;
  await contextualInput.press("Escape");
  await expect(contextual).toHaveCount(0);
  held.resolve();
  await completed.promise;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(configurations).toHaveLength(4);
  expect(requests).toHaveLength(inferenceCount);
  expect(disposed).toBe(2);
  expect(tools).toBe(9, "configuration and Connect must not request the model");
  expect(errors).toEqual([]);
  console.log(
    "Canvas assistant browser: selected model context, real companion transport, review-only edits, Apply/Undo/Redo, evidence currency, human drafts, stale/dismiss, Stop, disconnect and saved continuity pass (deterministic agent; no paid calls).",
  );
} finally {
  await browser.close();
  await companion.close();
}
