import { readWorkspace } from "./browser-workspace.mjs";
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  for (const width of [1440, 838]) {
    const context = await browser.newContext({
      viewport: { width, height: 960 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    const menu = page.getByRole("menu", {
      name: /^(Canvas|Context) actions$/,
    });
    const pie = page.getByRole("menu", { name: "Canvas actions", exact: true });
    const contextual = page.getByRole("menu", {
      name: "Context actions",
      exact: true,
    });
    const item = (name) => menu.getByRole("menuitem", { name, exact: true });
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    const saved = () => readWorkspace(page);
    const openBlank = async (x = width / 2, y = 460) => {
      await page.locator(".er-canvas").waitFor({ state: "visible" });
      await page.mouse.click(x, y, { button: "right" });
      await expect(menu).toBeVisible();
      await expect(contextual).toBeVisible();
    };
    await page.goto(base);

    // Opening and cancelling the menu is presentation only, even at an edge.
    await openBlank(width - 4, 950);
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(960);
    await expect(item("Undo")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("5");
    await expect(menu.getByRole("status")).toContainText("No changes to undo");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.locator(".er-region")).toHaveCount(0);
    await openBlank();
    await page.mouse.click(20, 100);
    await expect(menu).toHaveCount(0);
    await expect(editor).toHaveCount(0);

    // Hold Shift+Space, move and release to create at the original world point.
    // Pause timers to prove that execution does not wait for the visual reveal.
    const now = new Date();
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    await page.mouse.move(250, 340);
    await page.keyboard.down("Shift");
    await page.keyboard.down("Space");
    await expect(pie).toHaveAttribute("data-revealed", "false");
    await page.mouse.move(250, 270, { steps: 6 });
    await expect(pie).toHaveAttribute("data-revealed", "false");
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
    await page.clock.resume();
    await expect(editor).toBeFocused();
    await expect(menu).toHaveCount(0);
    await expect(page.locator(".er-region")).toHaveCount(1);
    const at = await editor.locator("..").boundingBox();
    expect(at.x).toBeCloseTo(250, 0);
    expect(at.y).toBeCloseTo(340, 0);
    for (const text of ["P = F*v", "F = 20 N", "v = 3 m/s"]) {
      await editor.fill(text);
      await editor.press("Enter");
    }
    await editor.press("Escape");
    await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
    const original = (await saved()).page;
    const power = page.locator('.er-region[data-kind="equation"]').first();

    // The menu targets the object under the pointer, without editing or moving it.
    await power.click({ button: "right", position: { x: 400, y: 25 } });
    await expect(item("Plot response")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect((await saved()).page).toEqual(original);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Space");
    await expect(pie).toHaveAttribute("data-revealed", "true");
    await expect(pie.getByRole("menuitem")).toHaveCount(4);
    await expect(item("Explore")).toHaveAttribute("title", "Plot response");
    await expect(page.locator(".er-object-actions:visible")).toHaveCount(0);
    await item("Explore").click();
    const plot = page.getByLabel("Python response artifact", { exact: true });
    await expect(plot).toHaveAttribute("data-status", "current");
    await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");

    await power.click({ button: "right", position: { x: 400, y: 25 } });
    if (width === 1440) {
      await mkdir(new URL("../screenshots/", import.meta.url), {
        recursive: true,
      });
      await page.screenshot({
        animations: "disabled",
        path: new URL("../screenshots/context-actions.png", import.meta.url)
          .pathname,
      });
    }
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+Space");
    await expect(pie).toBeVisible();
    const small = await pie.boundingBox();
    expect(small.width).toBeLessThanOrEqual(240);
    await expect(item("Try alternative")).toHaveCount(0);
    if (width === 1440)
      await page.screenshot({
        animations: "disabled",
        path: new URL("../screenshots/canvas-actions.png", import.meta.url)
          .pathname,
      });
    await page.keyboard.press("Escape");
    await power.click({ button: "right", position: { x: 400, y: 25 } });
    await item("Try alternative").click();
    expect((await saved()).page.contexts).toHaveLength(2);
    await expect(
      page.getByLabel("Artifact comparison", { exact: true }),
    ).toContainText("Original");
    const originalButton = page.getByRole("button", {
      name: "Original",
      exact: true,
    });
    const scenarioBounds = await originalButton.boundingBox();
    const drawingBounds = await page
      .locator(".drawing-toolbar-host")
      .boundingBox();
    expect(scenarioBounds.y + scenarioBounds.height).toBeLessThanOrEqual(
      drawingBounds.y,
    );
    await originalButton.click();

    await power.click({ button: "right", position: { x: 400, y: 25 } });
    await item("Trace").click();
    await expect(
      page.getByRole("dialog", { name: "Connections", exact: true }),
    ).toContainText("F");
    await page.keyboard.press("Escape");

    // Header and keyboard entry points use the same contextual menu.
    await page
      .getByRole("button", { name: "Open canvas actions", exact: true })
      .click();
    await expect(menu).toBeFocused();
    await expect(contextual).toBeVisible();
    await page.keyboard.press("Home");
    await expect(item("Edit equation")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveValue("P = F*v");
    await editor.press("End");
    await editor.press("Shift+Space");
    await expect(editor).toHaveValue("P = F*v ");
    await expect(menu).toHaveCount(0);
    await editor.fill("P = F*v");
    await editor.click({ button: "right" });
    await expect(menu).toHaveCount(0);
    await expect(editor).toBeVisible();
    await editor.press("Escape");
    await page.keyboard.press("Shift+F10");
    await expect(contextual).toBeVisible();
    await page.keyboard.press("Escape");

    // Search remains an independent path to the optional experiment.
    await page
      .getByRole("button", { name: "Search objects and commands", exact: true })
      .click();
    const search = page.getByRole("textbox", {
      name: "Search commands",
      exact: true,
    });
    await search.fill("Marking");
    await search.press("Shift+Space");
    await expect(search).toHaveValue("Marking ");
    await expect(menu).toHaveCount(0);
    await page
      .getByRole("button")
      .filter({ hasText: "Marking menu (experimental)" })
      .click();
    await expect(pie.getByRole("menuitem")).toHaveCount(4);
    await page.keyboard.press("Control+k");
    await expect(menu).toHaveCount(0);
    await expect(search).toBeFocused();
    await search.press("Escape");

    // Multi-selection exposes spatial and model operations, preserving definitions.
    const quantities = page.locator('.er-region[data-kind="quantity"]');
    for (const quantity of await quantities.all())
      await quantity.click({ modifiers: ["Shift"] });
    await quantities.first().click({ button: "right" });
    await expect(item("Group")).toBeVisible();
    await expect(item("Make model")).toBeVisible();
    const beforeGroup = (await saved()).page;
    await item("Group").click();
    await expect(page.locator(".cs-group")).toHaveCount(1);
    expect((await saved()).page.regions).toEqual(beforeGroup.regions);
    await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");

    // The new shortcut leaves ordinary Space-drag navigation intact.
    const camera = () =>
      page.locator(".er-canvas").evaluate((node) => ({
        x: node.scrollLeft - Number(node.dataset.canvasOriginX || 0),
        y: node.scrollTop - Number(node.dataset.canvasOriginY || 0),
      }));
    const beforePan = await camera();
    await page.mouse.move(width - 70, 850);
    await page.keyboard.down("Space");
    await page.mouse.down();
    await page.mouse.move(width - 170, 750, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    const afterPan = await camera();
    expect(afterPan.x - beforePan.x).toBeCloseTo(100, 0);
    expect(afterPan.y - beforePan.y).toBeCloseTo(100, 0);
    await expect(menu).toHaveCount(0);
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Canvas actions: right-click lists, Shift+Space pie gestures, source targeting, live plots, alternatives, tracing, keyboard access, native text editing, grouping and edge placement pass at two viewport sizes.",
  );
} finally {
  await browser.close();
}
