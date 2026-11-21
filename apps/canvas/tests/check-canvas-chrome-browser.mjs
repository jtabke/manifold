import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { RegionSession } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { readWorkspace } from "./browser-workspace.mjs";
import { shelfRail } from "./shelf-rail.mjs";
import { workspaceStorage } from "../src/regions/workspaceStorage.ts";

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
    for (const name of [
      "File",
      "View",
      "Shapes",
      "More drawing tools",
      "Scaled drawings",
    ]) {
      await button(name).click();
      await expect(button(name)).toHaveAttribute("aria-expanded", "true");
      const panel = page.getByRole("group", {
        name: `${name} commands`,
        exact: true,
      });
      const bounds = await panel.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(7);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 7);
      if (name === "Scaled drawings") {
        expect(
          await panel.evaluate((p) => p.scrollWidth <= p.clientWidth),
        ).toBe(true);
        await expect(
          panel.getByRole("button", { name: "Draw new area" }),
        ).toBeEnabled();
        await expect(
          panel.getByText("Select one line to calibrate from a known length."),
        ).toBeVisible();
        await expect(panel.getByLabel("Known line length")).toHaveCount(0);
        await expect(
          panel.getByLabel("Drawing area", { exact: true }),
        ).toHaveCount(0);
      }
      if (name === "File" && width <= 600)
        await expect(
          panel.getByRole("button", { name: "Download file" }),
        ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(button(name)).toBeFocused();
      await expect(panel).toHaveCount(0);
    }
    // The primary actions and navigation never drift off either edge.
    for (const name of [
      "File",
      "Search objects and commands",
      "Ask agent",
      ...(width > 600 ? ["Download file"] : []),
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

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(base);
  const phoneButton = (name) =>
    phone.getByRole("button", { name, exact: true });
  const touchHint = phone.getByText(
    "Tap the page to write an equation or note.",
  );
  await expect(touchHint).toBeVisible();
  const hint = await touchHint.boundingBox();
  await phone.touchscreen.tap(hint.x + 10, hint.y + 6);
  await expect(
    phone.getByLabel("Write an engineering region", { exact: true }),
  ).toBeFocused();
  await phone.keyboard.press("Escape");
  await phone.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(phoneButton("Move canvas toolbar")).toBeHidden();
  const toolNames = [
    "Select / Edit",
    "Pen",
    "Shapes",
    "Diagram label",
    "More drawing tools",
    "Scaled drawings",
  ];
  const toolBoxes = await Promise.all(
    toolNames.map((name) => phoneButton(name).boundingBox()),
  );
  const centreY = (box) => box.y + box.height / 2;
  for (const [index, bounds] of toolBoxes.entries()) {
    expect(centreY(bounds), toolNames[index]).toBeCloseTo(
      centreY(toolBoxes[0]),
      0,
    );
    expect(bounds.x + bounds.width, toolNames[index]).toBeLessThanOrEqual(390);
  }
  expect(toolBoxes[1].width).toBeGreaterThanOrEqual(44);
  expect(toolBoxes[4].width).toBeGreaterThanOrEqual(44);
  const styleSharesDrawingRow = async () => {
    const scale = await phoneButton("Scaled drawings").boundingBox();
    const style = await phoneButton("Drawing style").boundingBox();
    expect(centreY(style)).toBeCloseTo(centreY(scale), 0);
    expect(scale.x).toBeCloseTo(toolBoxes[5].x, 0);
    expect(style.x + style.width).toBeLessThanOrEqual(390);
  };
  await phoneButton("Pen").tap();
  await styleSharesDrawingRow();
  await phoneButton("Shapes").tap();
  const shapePicker = phone.getByRole("group", {
    name: "Shapes commands",
    exact: true,
  });
  await expect(shapePicker).toBeInViewport({ ratio: 1 });
  await expect(phoneButton("Rectangle")).toHaveText("");
  const arc = phoneButton("Three-point arc");
  await expect(arc).toHaveText("3-point arc");
  await expect(arc.locator("svg circle")).toHaveCount(3);
  await arc.tap();
  await expect(shapePicker).toHaveCount(0);
  await expect(phoneButton("Shapes: Arc")).toHaveText("");
  await expect(phoneButton("Shapes: Arc").locator("svg").first()).toBeVisible();
  await styleSharesDrawingRow();
  await phoneButton("Shapes: Arc").tap();
  await phoneButton("Rectangle").tap();
  await styleSharesDrawingRow();
  await phoneButton("More drawing tools").tap();
  await phoneButton("Highlighter").tap();
  await styleSharesDrawingRow();
  await phoneButton("Select / Edit").tap();
  for (const name of ["Zoom in", "Zoom out"]) {
    const target = await phoneButton(name).boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(33);
    expect(target.height).toBeGreaterThanOrEqual(36);
  }
  const rail = new RegionSession(shelfRail());
  await phone.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "Shelf rail.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(archive(rail.native())),
  });
  rail.dispose();
  await phone
    .locator('[data-region-id="mass"]')
    .tap({ position: { x: 6, y: 8 } });
  const strip = phone.getByRole("toolbar", {
    name: "Canvas selection",
    exact: true,
  });
  await expect(strip).toContainText("4.68 kg");
  await expect(strip.getByText("· 4.68 kg", { exact: true })).toBeInViewport({
    ratio: 1,
  });
  await expect(phone.locator('[data-result-for="mass"]')).not.toBeInViewport();
  const selectedActions = phoneButton("Open actions: mass");
  await expect(selectedActions).toHaveText("Actions: mass");
  await selectedActions.tap();
  const actions = phone.getByRole("menu", {
    name: "Context actions",
    exact: true,
  });
  await expect(actions).toHaveAttribute("aria-description", "Equation mass");
  await expect(actions.locator('[data-command-id^="response."]')).toHaveCount(
    1,
  );
  await actions.getByRole("menuitem", { name: "Plot", exact: true }).tap();
  const plots = phone.getByRole("menu", { name: "Plot mass", exact: true });
  await expect(
    plots.getByRole("menuitem", { name: "density", exact: true }),
  ).toBeFocused();
  await expect(
    plots.getByRole("menuitem", {
      name: "Map mass across two inputs",
      exact: true,
    }),
  ).toBeVisible();
  await phone.keyboard.press("Escape");
  await expect(selectedActions).toBeFocused();
  await phoneButton("View").tap();
  await phone
    .getByLabel("Canvas toolbar position", { exact: true })
    .selectOption("right");
  await phone.keyboard.press("Escape");
  await expect(phone.locator(".wc-toolbar-right")).toBeVisible();
  // The two-row strip fits into the narrow gap above mass, not the bottom shelf.
  await expect(strip).not.toHaveAttribute("data-docked", "");
  const sideResult = await strip.boundingBox();
  const equation = await phone.locator('[data-region-id="mass"]').boundingBox();
  const view = await phone.locator(".er-canvas").boundingBox();
  expect(sideResult.y).toBeGreaterThan(view.y);
  expect(sideResult.y + sideResult.height).toBeLessThan(equation.y);
  await strip
    .getByRole("button", { name: "Clear canvas selection", exact: true })
    .tap();
  await phoneButton("Open canvas actions").tap();
  await expect(actions).toHaveAttribute("aria-description", "Canvas");
  await phone.keyboard.press("Escape");
  await phone
    .locator('[data-region-id="mass"]')
    .tap({ position: { x: 6, y: 8 } });
  const savedRail = () =>
    readWorkspace(
      phone,
      workspaceStorage(
        "manifold.artifact-experiment.v1",
        new URL(phone.url()).search,
      ),
    );
  const beforePlot = await savedRail();
  await strip.getByRole("button", { name: "Plot", exact: true }).tap();
  await expect(
    plots.getByRole("menuitem", { name: "Back to actions", exact: true }),
  ).toHaveCount(0);
  expect(await savedRail()).toEqual(beforePlot);
  await expect(plots.locator('[data-axis="x"]')).toHaveText("Choose an input");
  await expect(
    plots.getByRole("menuitem", { name: "thickness", exact: true }),
  ).toContainText("mm");
  await plots
    .getByRole("menuitemcheckbox", { name: "Swap axes", exact: true })
    .tap();
  await expect(plots.locator('[data-axis="y"]')).toHaveText("Choose an input");
  expect(await savedRail()).toEqual(beforePlot);
  await plots.getByRole("menuitem", { name: "thickness", exact: true }).tap();
  await expect(plots).toHaveCount(0);
  await expect
    .poll(async () => (await savedRail()).artifacts.at(-1)?.input)
    .toBe("thickness");
  const plotted = (await savedRail()).artifacts.at(-1);
  expect(plotted.swapped).toBe(true);
  expect(plotted.output).toBe("mass");
  expect((await savedRail()).page.regions).toEqual(beforePlot.page.regions);
  await phone.close();

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
