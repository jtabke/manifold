import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive } from "../src/regions/artifacts.ts";
import {
  readWorkspace,
  readWorkspaceBytes,
  chooseDrawingTool,
} from "./browser-workspace.mjs";
import { keyboardShortcuts } from "../src/regions/interaction/keyboardShortcuts.ts";
import { drawings } from "../src/regions/drawing.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const { session, input } = await sceneFixture(1);
const source = archive(session.native());
session.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    source,
  );
  await page.goto(base);
  const initial = await readWorkspace(page),
    bytes = await readWorkspaceBytes(page);
  const help = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  const search = () =>
    help.getByRole("searchbox", {
      name: "Search keyboard shortcuts",
      exact: true,
    });
  const trigger = page.getByRole("button", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await trigger.click();
  await expect(help).toBeVisible();
  await expect(search()).toBeFocused();
  await expect(help.locator("dt")).toHaveCount(keyboardShortcuts.length);
  await search().fill("ctrl+k");
  await expect(help.locator("dt")).toHaveCount(1);
  await expect(help.locator("dt")).toContainText("Search objects and commands");
  await search().fill("backspace");
  await expect(help.locator("dt")).toHaveCount(1);
  await search().fill("nothing-matches-921");
  await expect(help.getByText(/No shortcuts match/)).toBeVisible();
  await search().fill("pan");
  await expect(help.locator("dt")).toHaveCount(2);
  await expect(search()).toHaveCSS("outline-style", "none");
  await captureEvidence(page, { path: "screenshots/keyboard-shortcuts.png" });
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(trigger).toBeFocused();
  assert.equal(await readWorkspaceBytes(page), bytes);
  // The shared Help command is discoverable without knowing a key binding.
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("help");
  await page
    .locator('.er-command-item[data-command-id="help.shortcuts"]')
    .click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menu", { name: "Context actions", exact: true })
    .getByRole("menuitem", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  // Opening reference from the purple-caret writer must not finish or publish its draft.
  const region = page.locator(`[data-region-id="${input}"]`);
  await region.locator(".er-editable-math").dblclick();
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await writer.fill("x := 2 mm");
  await writer.evaluate((node) => node.setSelectionRange(5, 6));
  const range = () =>
    writer.evaluate((node) => [node.selectionStart, node.selectionEnd]);
  const priorRange = await range();
  await trigger.click();
  await expect(help).toBeVisible();
  await search().fill("undo");
  await page.keyboard.press("Escape");
  await expect(writer).toBeFocused();
  await expect(writer).toHaveValue("x := 2 mm");
  assert.deepEqual(await range(), priorRange);
  assert.equal(await readWorkspaceBytes(page), bytes);
  await writer.fill(initial.page.regions.find((r) => r.id === input).text);
  await writer.press("Escape");
  // Global drawing/navigation handlers must yield even when a dialog button has focus.
  const toolbar = page.getByRole("toolbar", {
    name: "Drawing and diagram tools",
  });
  await chooseDrawingTool(page, "Rectangle");
  const canvas = await page.locator(".er-canvas").boundingBox();
  await page.mouse.move(canvas.x + 1100, canvas.y + 450);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 1200, canvas.y + 550, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => drawings((await readWorkspace(page)).document).length)
    .toBe(1);
  await expect(
    toolbar.locator('button[aria-label="Duplicate drawings"]'),
  ).toBeEnabled();
  const drawnBytes = await readWorkspaceBytes(page),
    zoom = await page.locator(".er-zoom").textContent();
  await trigger.click();
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "Close keyboard shortcuts" }).focus();
  for (const key of [
    "Delete",
    "Backspace",
    "ControlOrMeta+d",
    "ControlOrMeta+z",
    "+",
    "-",
    "Shift+Digit1",
  ])
    await page.keyboard.press(key);
  await expect(help).toBeVisible();
  assert.equal(await page.locator(".er-zoom").textContent(), zoom);
  assert.equal(await readWorkspaceBytes(page), drawnBytes);
  // Native modal focus stays inside and search typing is never a canvas/tool gesture.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await help.evaluate((node) => node.contains(document.activeElement)),
      true,
    );
  }
  await expect(search()).toBeFocused();
  await search().fill("drawing shift");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(search()).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const modalBox = await help.boundingBox();
  assert.ok(modalBox.x >= 0 && modalBox.x + modalBox.width <= 390);
  assert.equal(
    await help.evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  assert.equal(await readWorkspaceBytes(page), drawnBytes);
  await expect(
    toolbar.locator('button[aria-label="Duplicate drawings"]'),
  ).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log(
    "Shortcut reference: search/aliases, Help discovery, keyboard/touch-sized layout, focus/caret restoration, draft isolation and modal key ownership passed.",
  );
} finally {
  await browser.close();
}
