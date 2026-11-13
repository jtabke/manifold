import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { startCompanion } from "../../assistant/src/server.mjs";
import { readWorkspace } from "./browser-workspace.mjs";
import { drawings } from "../src/regions/drawing.ts";
import { evidenceEnabled } from "./browser-evidence.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const requests = [];
const images = [];
const plotReads = [];
let releaseStream;
const formattedResponse = [
  "## Engineering review",
  "- **Assumption:** a linear spring.",
  "- Keep source units explicit.",
  "",
  "| Input | Value |",
  "| --- | --- |",
  "| Displacement | 3 mm |",
  "",
  "```python",
  "force = 3 * 10",
  "```",
  "",
  "$F = k x$",
  "",
  "$$\\frac{F}{k} = x$$",
  "",
  "A source note.[^source]",
  "",
  "[^source]: Check the original model assumptions.",
  "",
  "[Reference](https://example.com/reference)",
  "[Unsafe link](javascript:alert(1))",
  "![Remote tracking image](https://example.invalid/pixel.png)",
  '<img src="x" onerror="window.assistantInjected = true">',
  "<script>window.assistantInjected = true</script>",
].join("\n");
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
        if (text.startsWith("Formatted explanation")) {
          listener({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta: formattedResponse,
            },
          });
          return;
        }
        if (text.startsWith("Stream while minimized")) {
          listener({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta: "## In progress\n\n",
            },
          });
          await new Promise((resolve, reject) => {
            releaseStream = resolve;
            aborted = reject;
          });
          listener({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta: Array.from(
                { length: 80 },
                (_, i) => `Streamed step ${i + 1}: Review source assumptions.`,
              ).join("\n"),
            },
          });
          return;
        }
        if (text.startsWith("Long explanation")) {
          listener({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              delta: Array.from(
                { length: 80 },
                (_, i) =>
                  `Step ${i + 1}: Inspect the assumptions and keep source units explicit.`,
              ).join("\n"),
            },
          });
          return;
        }
        if (text.startsWith("Wait")) {
          await new Promise((_resolve, reject) => {
            aborted = reject;
          });
          return;
        }
        if (text.startsWith("Read created plot")) {
          const scene = await call("inspect_canvas", {}, undefined);
          tools++;
          const plot = scene.plots.at(-1);
          plotReads.push(
            await call("inspect_plot", { id: plot.id }, undefined),
          );
          tools++;
          images.push(await call("look_at_canvas", { id: plot.id }, undefined));
          tools++;
          return;
        }
        if (text.startsWith("Use canvas tools")) {
          const state = await call("inspect_workspace", {}, undefined);
          tools++;
          const scene = await call("inspect_canvas", {}, undefined);
          tools++;
          if (
            !scene.attention?.point ||
            !scene.attention?.viewport ||
            !scene.attention.frames.length
          )
            throw Error("Missing live cursor/viewport context");
          const view = scene.objects.find(
            (object) => object.object === state.models[0].id,
          );
          images.push(await call("look_at_canvas", {}, undefined));
          tools++;
          images.push(await call("look_at_canvas", { id: view.id }, undefined));
          tools++;
          await call(
            "prepare_edit",
            {
              explanation:
                "Draw a visual annotation, organize the spring and add a response plot.",
              batch: {
                expectedDocumentId: scene.documentId,
                edits: [
                  {
                    operation: "createDrawing",
                    mark: {
                      kind: "rectangle",
                      color: "#8b5cf6",
                      width: 3,
                      points: [
                        { x: 0, y: 0, pressure: 1 },
                        { x: 140, y: 80, pressure: 1 },
                      ],
                      text: "",
                      start: null,
                      end: null,
                    },
                    at: { x: 650, y: 600 },
                    as: "box",
                  },
                  {
                    operation: "placeObjects",
                    placements: [{ id: view.id, at: { x: 110, y: 300 } }],
                  },
                  {
                    operation: "createEquation",
                    text: "x := 2 mm",
                    as: "input",
                    at: { x: 650, y: 140 },
                  },
                  {
                    operation: "createEquation",
                    text: "y = 2*x",
                    as: "output",
                    at: { x: 650, y: 200 },
                  },
                  {
                    operation: "createPlot",
                    input: "$input",
                    output: "$output",
                    at: { x: 650, y: 250 },
                  },
                ],
              },
            },
            undefined,
          );
          tools++;
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
  await trigger.click();
  const panel = page.getByRole("dialog", {
    name: "Canvas assistant Pi · experimental",
  });
  await expect(panel).toBeVisible();
  const expectThemeToken = async (locator, property, token) => {
    await expect(async () => {
      const colors = await locator.evaluate(
        (element, { property, token }) => {
          const actual = getComputedStyle(element)[property];
          const probe = document.createElement("span");
          probe.style.color = getComputedStyle(element).getPropertyValue(token);
          document.body.append(probe);
          const expected = getComputedStyle(probe).color;
          probe.remove();
          return { actual, expected };
        },
        { property, token },
      );
      expect(colors.actual, `${property} should follow ${token}`).toBe(
        colors.expected,
      );
    }).toPass({ timeout: 15000 });
  };
  const expectPanelTheme = async () => {
    await expectThemeToken(panel, "backgroundColor", "--canvas-surface");
    await expectThemeToken(panel, "color", "--canvas-text");
    await expectThemeToken(
      panel.locator("textarea"),
      "backgroundColor",
      "--canvas-surface",
    );
    await expectThemeToken(panel.locator("textarea"), "color", "--canvas-text");
    await expectThemeToken(
      panel.locator(".assistant-context"),
      "color",
      "--canvas-muted",
    );
    await expectThemeToken(
      panel.locator(".assistant-settings"),
      "backgroundColor",
      "--canvas-bg",
    );
    await expectThemeToken(
      panel.getByLabel("Provider", { exact: true }),
      "backgroundColor",
      "--canvas-surface",
    );
  };
  await expectPanelTheme();
  // The default workspace is dark. Alternate palettes must flow through the same tokens.
  await panel.evaluate((element) => {
    for (const [key, value] of Object.entries({
      "--canvas-surface": "#ffffff",
      "--canvas-bg": "#faf9fc",
      "--canvas-text": "#343942",
      "--canvas-muted": "#606775",
    }))
      element.style.setProperty(key, value);
  });
  await expectPanelTheme();
  await panel.evaluate((element) => {
    for (const token of [
      "--canvas-surface",
      "--canvas-bg",
      "--canvas-text",
      "--canvas-muted",
    ])
      element.style.removeProperty(token);
  });
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
  const dock = page.getByLabel("right dock", { exact: true });
  await expect(dock).toBeVisible();
  await expect(
    dock.getByRole("tab", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const dockBounds = await dock.boundingBox();
  const panelBounds = await panel.boundingBox();
  expect(panelBounds.x).toBeGreaterThanOrEqual(dockBounds.x);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(
    dockBounds.x + dockBounds.width,
  );
  expect((await input.boundingBox()).height).toBeLessThanOrEqual(100);
  await expect(
    panel.getByText("Connects when you send", { exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".assistant-context")).toContainText("Spring");
  await panel
    .getByRole("button", {
      name: "Remove Spring from request focus",
      exact: true,
    })
    .click();
  await expect(input).toHaveAccessibleDescription(/Worksheet context/);
  await panel
    .getByRole("button", { name: "Use selection", exact: true })
    .click();
  await expect(input).toHaveAccessibleDescription(/1 selected object/);
  await panel
    .getByRole("button", { name: "What the assistant can access", exact: true })
    .click();
  await expect(panel.locator("#assistant-access-details")).toContainText(
    "not an access restriction",
  );
  await panel
    .getByRole("button", { name: "What the assistant can access", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Review assumptions", exact: true })
    .click();
  await expect(input).toHaveValue(/Review the assumptions and units/);
  await expect(input).toBeFocused();
  expect(configurations).toHaveLength(0);
  await expect(
    panel.getByRole("button", { name: "Explain this work", exact: true }),
  ).toBeDisabled();
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
  // Header actions precede the open settings in both DOM and visual order.
  const closeButton = panel.getByRole("button", {
    name: "End assistant session",
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
  await expect(panel.getByText("Connected", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("region", { name: "Get started with the assistant" }),
  ).toHaveCount(0);
  const proposal = panel
    .getByRole("article", { name: "Proposed canvas edit" })
    .last();
  await expect(proposal).toContainText("pending");
  await expectThemeToken(proposal, "backgroundColor", "--canvas-bg");
  await expectThemeToken(
    proposal.locator(".assistant-source-diff del"),
    "backgroundColor",
    "--canvas-danger-tint",
  );
  await expectThemeToken(
    proposal.locator(".assistant-source-diff ins"),
    "backgroundColor",
    "--canvas-success-tint",
  );
  await expectThemeToken(
    proposal.getByRole("button", { name: "Apply edit", exact: true }),
    "backgroundColor",
    "--canvas-accent-strong",
  );
  await expect(proposal).toContainText("Displacement [mm]");
  await expect(
    model.getByLabel("Spring Displacement", { exact: true }),
  ).toHaveValue("2");
  await expect(model.getByLabel("Model force")).toHaveText("20 N");
  expect((await readWorkspace(page)).document.id).toBe(before.document.id);
  // Presentation changes keep the real companion, pending proposal and draft alive.
  await input.fill("Preserve through float and minimize");
  const liveInput = await input.elementHandle();
  await panel
    .getByRole("button", { name: "Float assistant panel", exact: true })
    .click();
  await expect(panel).toHaveClass(/is-floating/);
  await expect(
    page.getByRole("tab", { name: "Agent", exact: true }),
  ).toHaveCount(0);
  await expect(input).toHaveValue("Preserve through float and minimize");
  expect(
    await input.evaluate((node, previous) => node === previous, liveInput),
  ).toBe(true);
  const moveHandle = panel.getByRole("button", {
    name: "Move floating assistant",
    exact: true,
  });
  const floatingBounds = await panel.boundingBox();
  await moveHandle.focus();
  await moveHandle.press("ArrowLeft");
  expect((await panel.boundingBox()).x).toBeLessThan(floatingBounds.x);
  const moveBounds = await moveHandle.boundingBox();
  await page.mouse.move(moveBounds.x + 20, moveBounds.y + 15);
  await page.mouse.down();
  await page.mouse.move(moveBounds.x - 30, moveBounds.y - 20);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox()).x).toBe(floatingBounds.x - 20);
  const resizeHandle = panel.getByRole("button", {
    name: "Resize floating assistant",
    exact: true,
  });
  await resizeHandle.focus();
  await resizeHandle.press("ArrowRight");
  expect((await panel.boundingBox()).width).toBe(floatingBounds.width + 20);
  const grip = await resizeHandle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 60, grip.y + 30);
  await page.mouse.up();
  expect((await panel.boundingBox()).width).toBeGreaterThan(
    floatingBounds.width + 20,
  );
  await input.press("Escape");
  await expect(panel).toHaveCount(0);
  const restore = page.getByRole("button", {
    name: "Restore canvas assistant",
    exact: true,
  });
  await expect(restore).toContainText("1 to review");
  expect(disposed).toBe(0);
  await restore.click();
  await expect(proposal).toContainText("pending");
  await expect(input).toHaveValue("Preserve through float and minimize");
  await panel
    .getByRole("button", { name: "Dock assistant panel", exact: true })
    .click();
  await expect(panel).toHaveClass(/is-embedded/);
  await expect(
    dock.getByRole("tab", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveValue("Preserve through float and minimize");
  expect(configurations).toHaveLength(1);
  expect(disposed).toBe(0);
  await proposal
    .getByRole("button", { name: "Show model on canvas", exact: true })
    .click();
  await expect(proposal.getByRole("status")).toContainText("Highlighted");
  await model.evaluate((element) => {
    element.style.display = "none";
  });
  await proposal
    .getByRole("button", { name: "Show model on canvas", exact: true })
    .click();
  await expect(proposal.getByRole("status")).toContainText(
    "not currently visible",
  );
  await model.evaluate((element) => {
    element.style.removeProperty("display");
  });
  await proposal
    .getByRole("button", { name: "Show source on canvas", exact: true })
    .click();
  await expect(proposal.getByRole("status")).toContainText(
    "New content appears after approval",
  );
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
  await expectThemeToken(panel.getByRole("alert"), "color", "--canvas-danger");
  await expectThemeToken(
    panel.getByRole("alert"),
    "backgroundColor",
    "--canvas-danger-tint",
  );
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
    .getByRole("button", { name: "End assistant session", exact: true })
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
    .getByRole("button", { name: "End assistant session", exact: true })
    .click();
  await expect.poll(() => disposed).toBe(2);
  // A contextual request retains its invocation context in the dock and stays on-screen.
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
  await expect(
    page.getByRole("tab", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await contextual
    .getByRole("button", { name: "Float assistant panel", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(contextual).toHaveClass(/is-floating/);
  await expect(contextualInput).toBeVisible();
  await expect(
    contextual.getByRole("button", {
      name: "Resize floating assistant",
      exact: true,
    }),
  ).toBeHidden();
  await contextual
    .getByRole("button", { name: "Assistant settings", exact: true })
    .click();
  await expect(async () => {
    const bounds = await contextual.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(8);
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(382);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(692);
  }).toPass({ timeout: 15000 });
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
  await contextual
    .getByRole("button", { name: "End assistant session", exact: true })
    .click();
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
  delayedConnection = undefined;
  await page.getByRole("button", { name: "Ask agent", exact: true }).click();
  const beforeCanvas = await readWorkspace(page);
  await ask("Use canvas tools to annotate, organize and plot");
  const canvasProposal = panel
    .getByRole("article", { name: "Proposed canvas edit" })
    .last();
  await expect(
    canvasProposal.getByText("Review drawing, plot and layout changes", {
      exact: true,
    }),
  ).toBeVisible();
  expect(drawings((await readWorkspace(page)).document)).toHaveLength(0);
  expect((await readWorkspace(page)).document.id).toBe(
    beforeCanvas.document.id,
  );
  expect(images).toHaveLength(2);
  for (const image of images) {
    expect(image.mimeType).toBe("image/jpeg");
    expect(image.width).toBeLessThanOrEqual(1280);
    expect(image.height).toBeLessThanOrEqual(960);
    const painted = await page.evaluate(async ({ data }) => {
      const image = await createImageBitmap(
        await (await fetch(`data:image/jpeg;base64,${data}`)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      image.close();
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180)
          dark++;
      return dark;
    }, image);
    expect(painted).toBeGreaterThan(100);
  }
  if (evidenceEnabled) {
    const directory = new URL(
      "../../../evidence/current/canvas/",
      import.meta.url,
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      new URL("assistant-viewport.jpg", directory),
      Buffer.from(images[0].data, "base64"),
    );
    await writeFile(
      new URL("assistant-object.jpg", directory),
      Buffer.from(images[1].data, "base64"),
    );
  }
  await canvasProposal
    .getByRole("button", { name: "Apply edit", exact: true })
    .click();
  await expect(page.locator('[data-drawing-kind="rectangle"]')).toHaveCount(1);
  expect((await readWorkspace(page)).page.plots).toHaveLength(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-drawing-kind="rectangle"]')).toHaveCount(0);
  expect((await readWorkspace(page)).page.plots).toHaveLength(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('[data-drawing-kind="rectangle"]')).toHaveCount(1);
  await ask("Read created plot without executing");
  expect(plotReads[0].status).toBe("derived-not-checked");
  expect(plotReads[0].points).toHaveLength(81);
  expect(images).toHaveLength(3);
  await ask("Long explanation of the worksheet");
  const history = panel.getByRole("region", {
    name: "Conversation history",
    exact: true,
  });
  await expect(async () => {
    const distance = await history.evaluate(
      (element) =>
        element.scrollHeight - element.scrollTop - element.clientHeight,
    );
    expect(distance).toBeLessThan(48);
  }).toPass({ timeout: 15000 });
  const composerBounds = await input.boundingBox();
  const historyBounds = await history.boundingBox();
  expect(composerBounds.y).toBeGreaterThanOrEqual(
    historyBounds.y + historyBounds.height,
  );
  await history.evaluate((element) => {
    element.scrollTop = 0;
  });
  await panel
    .getByRole("button", { name: "Latest response", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "Latest response", exact: true }),
  ).toHaveCount(0);
  await expect(panel.locator(".assistant-answer").last()).toContainText(
    "Step 80",
  );
  // Rich responses are readable but cannot execute HTML, fetch remote images or run links.
  const trackingRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("example.invalid"))
      trackingRequests.push(request.url());
  });
  await ask("Formatted explanation of the worksheet");
  await ask("Formatted explanation with another source note");
  const rich = panel.locator(".assistant-answer").last();
  await expect(
    rich.getByRole("heading", { name: "Engineering review", exact: true }),
  ).toBeVisible();
  await expect(
    rich.getByRole("region", { name: "Response table", exact: true }),
  ).toBeVisible();
  await expect(rich.locator(".katex")).toHaveCount(2);
  await expect(rich.locator(".katex-error")).toHaveCount(0);
  await expect(rich.locator("script,img,iframe")).toHaveCount(0);
  await expect(rich.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.assistantInjected)).toBeUndefined();
  expect(trackingRequests).toEqual([]);
  await expect(
    rich.getByRole("link", { name: "Reference", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  const footnote = rich.locator("a[data-footnote-ref]");
  await expect(footnote).not.toHaveAttribute("target", "_blank");
  const footnoteId = (await footnote.getAttribute("href")).slice(1);
  const referenceId = await footnote.getAttribute("id");
  const urlBeforeFootnote = page.url();
  await footnote.click();
  expect(await page.evaluate(() => document.activeElement.id)).toBe(footnoteId);
  await rich.locator("a[data-footnote-backref]").click();
  expect(await page.evaluate(() => document.activeElement.id)).toBe(
    referenceId,
  );
  expect(page.url()).toBe(urlBeforeFootnote);
  expect(page.context().pages()).toHaveLength(1);
  const responseIds = await panel
    .locator(".assistant-answer [id]")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(responseIds).size).toBe(responseIds.length);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.assistantCopied = text;
        },
      },
    }),
  );
  await rich.getByRole("button", { name: "Copy code", exact: true }).click();
  expect(await page.evaluate(() => window.assistantCopied)).toBe(
    "force = 3 * 10\n",
  );
  await rich
    .getByRole("button", { name: "Copy assistant response", exact: true })
    .click();
  expect(await page.evaluate(() => window.assistantCopied)).toBe(
    formattedResponse,
  );
  // A real active request continues while minimized, without losing its draft or scroll follow.
  await input.fill("Stream while minimized");
  await input.press("Enter");
  await expect.poll(() => typeof releaseStream).toBe("function");
  await expect(
    panel.getByRole("button", { name: "Stop request", exact: true }),
  ).toBeVisible();
  await input.fill("Keep the next draft while hidden");
  await panel
    .getByRole("button", { name: "Minimize canvas assistant", exact: true })
    .click();
  const runningRestore = page.getByRole("button", {
    name: "Restore canvas assistant",
    exact: true,
  });
  await expect(runningRestore).toContainText("Writing a response");
  expect(disposed).toBe(2);
  releaseStream();
  await expect(runningRestore).toContainText("Resume conversation");
  await runningRestore.click();
  await expect(input).toHaveValue("Keep the next draft while hidden");
  await expect(panel.locator(".assistant-answer").last()).toContainText(
    "Streamed step 80",
  );
  await expect(async () => {
    expect(
      await history.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    ).toBeLessThan(48);
  }).toPass({ timeout: 15000 });
  // Deliberately reading earlier messages also survives a minimize/restore cycle.
  await history.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    panel.getByRole("button", { name: "Latest response", exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Minimize canvas assistant", exact: true })
    .click();
  await runningRestore.click();
  await expect(
    panel.getByRole("button", { name: "Latest response", exact: true }),
  ).toBeVisible();
  expect(await history.evaluate((element) => element.scrollTop)).toBe(0);
  expect(configurations).toHaveLength(5);
  await panel
    .getByRole("button", { name: "End assistant session", exact: true })
    .click();
  await expect.poll(() => disposed).toBe(3);
  await page.reload();
  await expect(page.locator('[data-drawing-kind="rectangle"]')).toHaveCount(1);
  expect((await readWorkspace(page)).page.plots).toHaveLength(1);
  expect(tools).toBe(17);
  expect(errors).toEqual([]);
  console.log(
    "Canvas assistant browser: cursor/model context, real companion transport, bounded viewport/object images, drawing/plot/layout review, exact Apply/Undo/Redo, derived plot reads, human drafts, stale/dismiss, Stop, cancelled setup and saved continuity pass (deterministic agent; no paid calls).",
  );
} finally {
  await browser.close();
  await companion.close();
}
