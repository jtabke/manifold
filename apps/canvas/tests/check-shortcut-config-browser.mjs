import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
import { drawings } from "../src/regions/drawing.ts";
import {
  parseShortcutConfiguration,
  SHORTCUT_STORAGE,
  defaultBindings,
} from "../src/regions/interaction/shortcutBindings.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const { session, input } = await sceneFixture(1),
  source = archive(session.native());
session.dispose();
const json = (rows = []) =>
  JSON.stringify({
    version: 1,
    bindings: rows.map(([action, keys]) => ({
      action,
      context: "canvas",
      keys,
    })),
  });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((text) => {
    if (!localStorage.getItem("manifold.artifact-experiment.v1"))
      localStorage.setItem("manifold.artifact-experiment.v1", text);
  }, source);
  await page.goto(base);
  await readWorkspace(page);
  const original = await readWorkspaceBytes(page);
  const dialog = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  const trigger = page.getByRole("button", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  const customize = async () => {
    await trigger.click();
    await dialog
      .getByRole("button", { name: "Customize", exact: true })
      .click();
  };
  const stored = () =>
    page.evaluate((key) => localStorage.getItem(key), SHORTCUT_STORAGE);
  const record = async (label, key) => {
    await dialog
      .getByRole("button", { name: `Change ${label} shortcut`, exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: `Record ${label} shortcut`, exact: true })
      .press(key);
  };
  const importJSON = (text, name = "shortcuts.json") =>
    dialog
      .getByLabel("Import shortcut configuration", { exact: true })
      .setInputFiles({
        name,
        mimeType: "application/json",
        buffer: Buffer.from(text),
      });
  await trigger.focus();
  const punctuation = await page.evaluate(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ";",
        code: "KeyZ",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(
    punctuation,
    true,
    "ASCII punctuation must not invoke or intercept Undo",
  );
  assert.equal(await readWorkspaceBytes(page), original);
  await customize();
  await dialog
    .getByRole("button", {
      name: "Change Keyboard shortcuts shortcut",
      exact: true,
    })
    .click();
  const capture = dialog.getByRole("textbox", {
    name: "Record Keyboard shortcuts shortcut",
    exact: true,
  });
  const beforeTraversal = await stored();
  await capture.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", {
      name: "Reset Keyboard shortcuts shortcut",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(capture).toBeFocused();
  await capture.press("Tab");
  assert.equal(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
    true,
  );
  await expect(capture).not.toBeFocused();
  assert.equal(
    await stored(),
    beforeTraversal,
    "focus traversal cannot create a binding",
  );
  await capture.focus();
  await capture.press("Escape");
  await record("Keyboard shortcuts", "F1");
  await expect(
    dialog.getByRole("button", {
      name: "Change Keyboard shortcuts shortcut",
      exact: true,
    }),
  ).toBeFocused();
  await record("Search objects and commands", "ControlOrMeta+Shift+k");
  await dialog
    .getByRole("button", {
      name: "Clear Search objects and commands shortcut",
      exact: true,
    })
    .click();
  assert.deepEqual(
    parseShortcutConfiguration(await stored())["search.open"],
    [],
  );
  await dialog
    .getByRole("button", {
      name: "Reset Search objects and commands shortcut",
      exact: true,
    })
    .click();
  assert.deepEqual(
    parseShortcutConfiguration(await stored())["search.open"],
    defaultBindings["search.open"],
  );
  await record("Search objects and commands", "ControlOrMeta+Shift+k");
  const first = await stored();
  assert.deepEqual(parseShortcutConfiguration(first)["search.open"], [
    "Mod+Shift+K",
  ]);
  assert.equal(await readWorkspaceBytes(page), original);
  await record("Keyboard shortcuts", "ControlOrMeta+Shift+k");
  await expect(dialog.getByRole("alert")).toContainText("conflicts");
  assert.equal(await stored(), first);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await record("Keyboard shortcuts", "Enter");
  await expect(dialog.getByRole("alert")).toContainText("protected");
  assert.equal(await stored(), first);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Reference", exact: true }).click();
  const searchRow = dialog
    .locator("dt")
    .filter({ hasText: "Search objects and commands" });
  await expect(searchRow).toContainText("Shift");
  await page.keyboard.press("Escape");
  await trigger.focus();
  const oldSearch = await page.evaluate(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal(
    oldSearch,
    true,
    "old canvas search binding is no longer intercepted",
  );
  await expect(
    page.getByRole("textbox", { name: "Search commands", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+k");
  await expect(
    page.getByRole("textbox", { name: "Search commands", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await trigger.focus();
  await page.keyboard.press("F1");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await readWorkspace(page);
  await trigger.focus();
  await page.keyboard.press("F1");
  await expect(dialog).toBeVisible();
  assert.equal(
    await stored(),
    first,
    "preferences survive reload independently of workspace data",
  );
  await page.keyboard.press("Escape");
  // Editor-specific search and ordinary typing stay fixed despite remapping canvas actions.
  await page.locator(`[data-region-id="${input}"] .er-editable-math`).click();
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await expect(writer).toBeFocused();
  await writer.dispatchEvent("keydown", {
    key: "F1",
    code: "F1",
    bubbles: true,
    cancelable: true,
  });
  await expect(dialog).toHaveCount(0);
  await writer.press("ControlOrMeta+k");
  await expect(
    page.getByRole("textbox", { name: "Search commands", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await customize();
  for (const invalid of [
    "{",
    json([["unknown.action", ["F1"]]]),
    json([["help.shortcuts", ["Mod+Z"]]]),
    " ".repeat(65537),
  ]) {
    const prior = await stored();
    await importJSON(invalid);
    await expect(dialog.getByRole("alert")).toBeVisible();
    assert.equal(
      await stored(),
      prior,
      "invalid import cannot partially apply",
    );
  }
  // The text editor uses the same whole-configuration validator, allowing an atomic swap.
  await dialog
    .getByRole("button", { name: "Edit configuration", exact: true })
    .click();
  const editor = dialog.getByRole("textbox", {
    name: "Shortcut configuration JSON",
    exact: true,
  });
  await editor.fill(
    json([
      ["search.open", ["F1"]],
      ["help.shortcuts", ["Mod+Shift+K"]],
    ]),
  );
  await dialog.getByRole("button", { name: "Apply JSON", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("applied");
  const swapped = await stored();
  assert.equal(parseShortcutConfiguration(swapped)["search.open"][0], "F1");
  const downloadPromise = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Export JSON", exact: true })
    .click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "manifold-shortcuts.json");
  const exported = await readFile(await download.path(), "utf8");
  assert.deepEqual(
    parseShortcutConfiguration(exported),
    parseShortcutConfiguration(swapped),
  );
  await dialog
    .getByRole("button", { name: "Reset all shortcuts", exact: true })
    .click();
  assert.equal(await stored(), null);
  await importJSON(exported);
  await expect(dialog.getByRole("status")).toContainText("Imported");
  assert.deepEqual(
    parseShortcutConfiguration(await stored()),
    parseShortcutConfiguration(swapped),
  );
  assert.equal(
    await readWorkspaceBytes(page),
    original,
    "all configuration channels leave accepted workspace bytes unchanged",
  );
  // A late file read cannot replace a newer reset, even when it returns to the same defaults.
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === "read-failure.json")
        return Promise.reject("File read rejected");
      return this.name === "delayed-shortcuts.json"
        ? new Promise((resolve, reject) =>
            setTimeout(() => original.call(this).then(resolve, reject), 300),
          )
        : original.call(this);
    };
  });
  await importJSON(
    json([["help.shortcuts", ["F1"]]]),
    "delayed-shortcuts.json",
  );
  await dialog
    .getByRole("button", { name: "Reset all shortcuts", exact: true })
    .click();
  await page.waitForTimeout(400);
  assert.equal(await stored(), null);
  await expect(dialog.getByRole("status")).toContainText("Default");
  await importJSON("{}", "read-failure.json");
  await expect(dialog.getByRole("alert")).toContainText("File read rejected");
  assert.equal(await stored(), null);
  await expect(
    dialog.getByRole("button", { name: "Import JSON…", exact: true }),
  ).toBeEnabled();
  // Captured/global keys are real dispatch inputs, not just a changed reference table.
  await importJSON(
    json([
      ["canvas.fit", ["F8"]],
      ["canvas.undo", ["F2"]],
      ["canvas.redo", ["F9"]],
      ["help.shortcuts", ["Shift+1"]],
    ]),
  );
  await expect(dialog.getByRole("status")).toContainText("Imported");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Import JSON…", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Fit page", exact: true }),
  ).toHaveAttribute("title", /F8/);
  const toolbar = page.getByRole("toolbar", {
    name: "Drawing and diagram tools",
  });
  await toolbar.getByRole("button", { name: "Rectangle", exact: true }).click();
  const canvas = await page.locator(".er-canvas").boundingBox();
  await page.mouse.move(canvas.x + 1100, canvas.y + 450);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 1200, canvas.y + 550, { steps: 5 });
  await page.mouse.up();
  const count = async (n) =>
    expect
      .poll(async () => drawings((await readWorkspace(page)).document).length)
      .toBe(n);
  await count(1);
  await trigger.focus();
  await page.keyboard.press("Shift+Digit1");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("F2");
  await count(0);
  await page.keyboard.press("F9");
  await count(1);
  await page.getByRole("button", { name: "Fit page", exact: true }).click();
  const fitted = await page.locator(".er-zoom").textContent();
  await page.keyboard.press("ControlOrMeta+0");
  await page.keyboard.press("F8");
  await expect(page.locator(".er-zoom")).toHaveText(fitted);
  await customize();
  const beforeFailure = await stored();
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key)
        throw new DOMException("Preference quota test", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, SHORTCUT_STORAGE);
  await record("Keyboard shortcuts", "F1");
  await expect(dialog.getByRole("alert")).toContainText("quota");
  assert.equal(
    await stored(),
    beforeFailure,
    "failed persistence leaves live and saved shortcuts unchanged",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await trigger.focus();
  await page.keyboard.press("Shift+Digit1");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  // Corrupt saved preferences fall back without clobbering the file, and remain recoverable via ?.
  await page.evaluate((key) => {
    Storage.prototype.removeItem.call(localStorage, key);
  }, SHORTCUT_STORAGE);
  await page.reload();
  await readWorkspace(page);
  await page.evaluate(
    (key) => localStorage.setItem(key, "bad-json"),
    SHORTCUT_STORAGE,
  );
  await page.reload();
  await readWorkspace(page);
  await customize();
  await expect(dialog.getByRole("alert")).toContainText("defaults are active");
  assert.equal(await stored(), "bad-json");
  await dialog
    .getByRole("button", { name: "Reset all shortcuts", exact: true })
    .click();
  assert.equal(await stored(), null);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
  await page.screenshot({ path: "screenshots/shortcut-customization.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Configurable shortcuts: capture/conflicts/protection, strict JSON, atomic swaps/import/export, persistence, stale reads, storage failure, corrupt recovery, drawing dispatch and native history isolation passed.",
  );
} finally {
  await browser.close();
}
