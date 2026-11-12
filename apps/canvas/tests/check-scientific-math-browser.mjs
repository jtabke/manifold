import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({
  ...browserOptions(),
  headless: true,
});
const files = await mkdtemp(join(tmpdir(), "manifold-scientific-browser-"));
const errors = [];
try {
  for (const width of [1440, 838]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    await page
      .getByRole("button", { name: "Write equation or note", exact: true })
      .click();
    for (const text of [
      "theta := 30 deg",
      "F := 500 N",
      "Fx := F*cos(theta)",
      "Fx >= 400 N",
      "L := sqrt(9 m^2)",
    ]) {
      await editor.fill(text);
      await editor.press("Enter");
    }
    await editor.press("Escape");
    const result = page.locator('[data-result-for="Fx"]');
    await expect(result).toContainText("433.013 N");
    await expect(page.locator('[data-result-for="L"]')).toContainText("3 m");
    const saved = await readWorkspace(page);
    expect(saved.page.regions.every((r) => r.mathVersion === 2)).toBe(true);
    const theta = saved.page.regions.find(
      (r) => r.text === "theta := 30 deg",
    ).id;
    await page
      .locator(`[data-region-id="${theta}"]`)
      .click({ position: { x: 400, y: 25 } });
    await revealRegionActions(page);
    await page
      .getByRole("toolbar", { name: "Quantity theta actions", exact: true })
      .locator('[data-command-id="quantity.vary"]')
      .click();
    const controls = page.getByLabel("Explore theta", { exact: true });
    await controls
      .getByLabel("Exploration maximum", { exact: true })
      .fill("1.6");
    const value = controls.getByLabel("Exploration value theta", {
      exact: true,
    });
    await value.fill(String(Math.PI / 3));
    await value.press("Enter");
    await expect(result).toContainText("250 N");
    expect((await readWorkspace(page)).page).toEqual(saved.page);
    await controls.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(result).toContainText("433.013 N");
    // Save/Open is an authored UI action, not a hydration shortcut.
    await page
      .getByRole("button", { name: "Search objects and commands", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search commands", exact: true })
      .fill("Save workspace file");
    const event = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save workspace file", exact: true })
      .click();
    const download = await event,
      path = join(files, `${width}.manifold`);
    await download.saveAs(path);
    const recipient = await context.newPage();
    recipient.on("pageerror", (e) => errors.push(e.message));
    await recipient.goto(base);
    await recipient
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles(path);
    await recipient.waitForURL(/\?canvas=/);
    await expect(recipient.locator('[data-result-for="Fx"]')).toContainText(
      "433.013 N",
    );
    await recipient.reload();
    await expect(recipient.locator('[data-result-for="Fx"]')).toContainText(
      "433.013 N",
    );
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Scientific browser: authored calls/units/angles, mathematical rendering, precise transient Vary, native UI Save/Open and local reload pass at two viewport sizes.",
  );
} finally {
  await browser.close();
  await rm(files, { recursive: true, force: true });
}
