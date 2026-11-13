import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { readWorkspace } from "./browser-workspace.mjs";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const key = "manifold.workspace-chrome.v1";
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const view = async () => {
    if ((await button("View").getAttribute("aria-expanded")) !== "true")
      await button("View").click();
  };
  const dismiss = () => page.keyboard.press("Escape");
  const saved = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  const panel = (name) => page.getByRole("tabpanel", { name, exact: true });
  await expect(page.locator(".er-canvas")).toBeVisible();
  await page.locator(".er-canvas").evaluate((canvas) => {
    window.__originalCanvas = canvas;
  });
  await view();
  await page.getByLabel("Relationships", { exact: true }).check();
  await page.getByLabel("Results", { exact: true }).check();
  await dismiss();
  await expect(panel("Results")).toBeVisible();
  await page.getByRole("tab", { name: "Relationships", exact: true }).click();
  await expect(panel("Relationships")).toBeVisible();
  await page
    .getByRole("tab", { name: "Relationships", exact: true })
    .press("ArrowRight");
  await expect(panel("Results")).toBeVisible();
  await page
    .getByLabel("Move Results panel", { exact: true })
    .selectOption("bottom");
  await expect(page.getByLabel("bottom dock", { exact: true })).toBeVisible();
  await button("Collapse bottom dock").click();
  await expect(panel("Results")).toBeHidden();
  await button("Expand bottom dock").click();
  await expect(panel("Results")).toBeVisible();
  const separator = page.getByRole("separator", { name: "Resize bottom dock" });
  await separator.focus();
  await separator.press("ArrowUp");
  expect((await saved()).layout.groups.bottom.size).toBe(260);
  const bounds = await separator.boundingBox();
  await page.mouse.move(bounds.x + 40, bounds.y + 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y - 60);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await saved()).layout.groups.bottom.size).toBe(260);
  await page.mouse.move(bounds.x + 40, bounds.y + 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y - 38);
  await page.mouse.up();
  expect((await saved()).layout.groups.bottom.size).toBe(300);

  // Native drag creates explicit edge destinations, including an empty dock.
  const tab = page.getByRole("tab", { name: "Relationships", exact: true });
  const tabBounds = await tab.boundingBox();
  await page.mouse.move(tabBounds.x + 20, tabBounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(tabBounds.x - 100, tabBounds.y + 80, { steps: 10 });
  await expect(page.locator(".wc-drop-left")).toBeVisible();
  const drop = await page.locator(".wc-drop-left").boundingBox();
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.getByLabel("left dock", { exact: true })).toBeVisible();
  expect((await saved()).layout.groups.left.tabs).toEqual(["relationships"]);

  // The toolbar grip uses the same native edge-docking interaction.
  const grip = await button("Move canvas toolbar").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 100, grip.y + 100, { steps: 10 });
  await expect(page.locator(".wc-drop-bottom")).toBeVisible();
  const toolbarDrop = await page.locator(".wc-drop-bottom").boundingBox();
  await page.mouse.move(
    toolbarDrop.x + toolbarDrop.width / 2,
    toolbarDrop.y + toolbarDrop.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  expect((await saved()).layout.toolbar).toBe("bottom");

  // Moving/hiding chrome preserves the actual canvas node and its editor draft.
  await button("Close Relationships panel").click();
  await button("Close Results panel").click();
  await page.locator(".er-canvas").click({ position: { x: 100, y: 100 } });
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await writer.fill("mass = 2 kg");
  for (const side of ["left", "right", "bottom", "hidden", "top"]) {
    await view();
    await page
      .getByLabel("Canvas toolbar position", { exact: true })
      .selectOption(side);
    await dismiss();
    await expect
      .poll(async () =>
        (await readWorkspace(page)).page.regions.some(
          (region) => region.text === "mass = 2 kg",
        ),
      )
      .toBe(true);
    expect(
      await page
        .locator(".er-canvas")
        .evaluate((canvas) => canvas === window.__originalCanvas),
    ).toBe(true);
    if (side === "hidden") await expect(button("Select / Edit")).toBeHidden();
    else await expect(button("Select / Edit")).toBeVisible();
  }
  const undo = await button("Undo").isEnabled();
  await view();
  await page.getByLabel("Relationships", { exact: true }).check();
  await page
    .getByLabel("Canvas toolbar position", { exact: true })
    .selectOption("bottom");
  await page
    .getByLabel("Workspace preset name", { exact: true })
    .fill("Review");
  await button("Save preset").click();
  await view();
  await button("Reset workspace").click();
  expect((await saved()).layout.toolbar).toBe("top");
  await view();
  await button("Load workspace Review").click();
  expect((await saved()).layout.toolbar).toBe("bottom");
  expect(await button("Undo").isEnabled()).toBe(undo);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Relationships", exact: true }),
  ).toBeVisible();
  expect((await saved()).layout.toolbar).toBe("bottom");
  // Tab switches and docking never discard assistant drafts or restart its component.
  await button("Ask agent").click();
  const prompt = page.getByRole("textbox", {
    name: "Ask about or edit the canvas",
  });
  await prompt.fill("Draft request — do not send");
  await page.getByLabel("Move Agent panel").selectOption("left");
  await expect(prompt).toHaveValue("Draft request — do not send");
  await view();
  await page.getByLabel("Results", { exact: true }).check();
  await dismiss();
  await page.getByLabel("Move Results panel").selectOption("left");
  await expect(prompt).toBeHidden();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await expect(prompt).toHaveValue("Draft request — do not send");
  // Docking/restoring explicitly reactivates and expands the original dock group.
  await button("Float assistant panel").click();
  await button("Collapse left dock").click();
  await button("Dock assistant panel").click();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue("Draft request — do not send");
  await button("Minimize canvas assistant").click();
  await button("Collapse left dock").click();
  const beforeRestoreFailure = await saved();
  await page.evaluate(() => {
    window.__assistantSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "manifold.workspace-chrome.v1")
        throw new DOMException("Full", "QuotaExceededError");
      return window.__assistantSetItem.call(this, key, value);
    };
  });
  await button("Restore canvas assistant").click();
  await expect(button("Restore canvas assistant")).toBeVisible();
  await expect(page.locator(".wc-error")).toContainText("could not be saved");
  expect(await saved()).toEqual(beforeRestoreFailure);
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__assistantSetItem;
  });
  await button("Restore canvas assistant").click();
  await expect(prompt).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Agent", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(prompt).toHaveValue("Draft request — do not send");
  await prompt.press("Escape");
  await view();
  await button("Reset workspace").click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await view();
    await page.getByLabel("Results", { exact: true }).check();
    await dismiss();
    await expect(panel("Results")).toBeVisible();
    const geometry = await page.locator(".er-app").evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      canvas: el.querySelector(".er-canvas").getBoundingClientRect().width,
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    expect(geometry.canvas).toBeGreaterThan(100);
    await button("Close Results panel").click();
  }
  // Failed preference writes cannot publish a layout that was not saved.
  const beforeFailure = await saved();
  await page.evaluate(() => {
    window.__setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "manifold.workspace-chrome.v1")
        throw new DOMException("Full", "QuotaExceededError");
      return window.__setItem.call(this, key, value);
    };
  });
  await view();
  await page
    .getByLabel("Canvas toolbar position", { exact: true })
    .selectOption("hidden");
  await dismiss();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Workspace preferences could not be saved" }),
  ).toBeVisible();
  expect(await saved()).toEqual(beforeFailure);
  await expect(button("Select / Edit")).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__setItem;
  });
  expect(errors).toEqual([]);
  // Corrupt preferences are preserved until an explicit reset.
  await page.evaluate((key) => localStorage.setItem(key, "broken"), key);
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved workspace preferences" }),
  ).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    "broken",
  );
  await view();
  await button("Reset workspace").click();
  expect((await saved()).layout.toolbar).toBe("top");
  console.log(
    "Workspace chrome: panel tabs, edge docking, resize/cancel, toolbar positions, draft identity, presets, reload, responsive recovery and invalid storage pass.",
  );
} finally {
  await browser.close();
}
