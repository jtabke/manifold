import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { RegionSession } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { readWorkspace } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const title = page.getByLabel("Document title", { exact: true });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const current = () => {
    const id = new URL(page.url()).searchParams.get("canvas");
    return readWorkspace(
      page,
      `manifold.artifact-experiment.v1${id ? `.canvas-${id}` : ""}`,
    );
  };
  await expect(button("Write equation or note")).toHaveCount(0);
  await expect(button("Select / Edit")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".er-canvas").click({ position: { x: 24, y: 24 } });
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await writer.fill("mass = 2 kg");
  await writer.press("Escape");
  await page.locator(".er-canvas").focus();
  await page.keyboard.press("Enter");
  await expect(writer).toHaveValue("mass = 2 kg");
  await writer.press("Escape");
  await expect(title).toHaveValue("Untitled document");
  await title.fill("Thermal balance");
  // Composing Enter/Escape must keep the unaccepted name and text focus intact.
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const key of ["Enter", "Escape"]) {
      const untouched = await title.evaluate(
        (node, options) =>
          node.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ...options,
            }),
          ),
        { key, ...composition },
      );
      expect(untouched).toBe(true);
      await expect(title).toBeFocused();
      await expect(title).toHaveValue("Thermal balance");
      expect((await current()).page.title).toBeUndefined();
    }
  }
  await title.press("Enter");
  await expect
    .poll(async () => (await current()).page.title)
    .toBe("Thermal balance");
  await expect(page).toHaveTitle("Thermal balance — Manifold");
  await title.fill("Discard this name");
  await title.press("Escape");
  await expect(title).toHaveValue("Thermal balance");
  await button("Undo").click();
  await expect(title).toHaveValue("Untitled document");
  await button("Redo").click();
  await expect(title).toHaveValue("Thermal balance");

  // Download finishes even an unblurred name, and the name is authored file data.
  await title.fill("Pump sizing");
  const downloading = page.waitForEvent("download");
  await title.press("ControlOrMeta+s");
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Pump sizing.manifold");
  const bytes = await readFile(await download.path());
  expect((await decodeWorkspace(bytes.toString())).page.title).toBe(
    "Pump sizing",
  );
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "different-transport-name.manifold",
    mimeType: "application/json",
    buffer: bytes,
  });
  await page.waitForURL(/\?canvas=/);
  await expect(title).toHaveValue("Pump sizing");
  await page.reload();
  await expect(title).toHaveValue("Pump sizing");

  // Older documents use the actual incoming filename, without changing their mathematics.
  const legacy = new RegionSession();
  legacy.write(legacy.create(), "mass = 2 kg");
  const previousURL = page.url();
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "Original machine.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(archive(legacy.native())),
  });
  await page.waitForURL((url) => url.href !== previousURL);
  await expect(title).toHaveValue("Original machine");
  expect((await current()).page.regions).toEqual(legacy.state.regions);

  // Disclosures stay within the viewport and preserve normal keyboard focus.
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(title).toBeVisible();
    const layout = await page.locator(".er-app").evaluate((app) => ({
      width: app.clientWidth,
      scroll: app.scrollWidth,
      canvas: app.querySelector(".er-canvas").getBoundingClientRect().height,
    }));
    expect(layout.scroll).toBeLessThanOrEqual(layout.width);
    expect(layout.canvas).toBeGreaterThan(600);
    for (const name of ["File", "View", "Shapes", "More drawing tools"]) {
      await button(name).click();
      await expect(button(name)).toHaveAttribute("aria-expanded", "true");
      const panel = page.getByRole("group", {
        name: `${name} commands`,
        exact: true,
      });
      const bounds = await panel.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(7);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 7);
      await page.keyboard.press("Escape");
      await expect(button(name)).toBeFocused();
      await expect(panel).toHaveCount(0);
    }
    // The primary actions and navigation never drift off either edge.
    for (const name of [
      "File",
      "Search objects and commands",
      "Ask agent",
      "Download file",
      "Select / Edit",
      "Pan canvas",
      "Fit page",
      "Keyboard shortcuts",
    ]) {
      const bounds = await button(name).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
  }
  await button("File").click();
  await page.keyboard.press("Tab");
  await expect(button("New canvas")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button("File")).toBeFocused();
  await button("View").click();
  await title.click();
  await expect(button("View")).toHaveAttribute("aria-expanded", "false");

  // A legacy browser-only title is migrated into the portable document once.
  const migrated = await browser.newContext();
  const older = await migrated.newPage();
  await older.addInitScript(() =>
    localStorage.setItem("manifold.canvas-title.v1", "Legacy study"),
  );
  await older.goto(base);
  await expect(older.getByLabel("Document title", { exact: true })).toHaveValue(
    "Legacy study",
  );
  await expect
    .poll(async () => (await readWorkspace(older)).page.title)
    .toBe("Legacy study");
  expect(errors).toEqual([]);
  console.log(
    "Canvas chrome: portable naming, filename fallback, draft/Undo semantics, grouped actions, keyboard disclosures and five responsive widths pass.",
  );
} finally {
  await browser.close();
}
