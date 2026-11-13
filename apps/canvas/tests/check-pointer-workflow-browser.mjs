import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { drawings } from "../src/regions/drawing.ts";
import {
  chooseDrawingTool,
  readWorkspace,
  readWorkspaceBytes,
} from "./browser-workspace.mjs";

const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const canvas = page.locator(".er-canvas");
  const toolbar = page.getByRole("toolbar", {
    name: "Drawing and diagram tools",
    exact: true,
  });
  const tool = (name) => toolbar.getByRole("button", { name, exact: true });
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  const pan = page.getByRole("button", { name: "Pan canvas", exact: true });
  const selection = page.getByRole("toolbar", {
    name: "Canvas selection",
    exact: true,
  });
  const marks = async () => drawings((await readWorkspace(page)).document);
  const drag = async (from, to) => {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
    await page.mouse.up();
  };
  await expect(tool("Select / Edit")).toHaveAttribute("aria-pressed", "true");
  await expect(toolbar.getByRole("button")).toHaveCount(5);
  await expect(tool("Rectangle")).toHaveCount(0);
  await expect(tool("Drawing style")).toHaveCount(0);
  await expect(tool("Duplicate drawings")).toHaveCount(0);

  // Writing and editing are one default-pointer workflow, never a separate mode.
  await canvas.click({ position: { x: 110, y: 110 } });
  await writer.fill("mass = 2 kg");
  await writer.press("Escape");
  const massId = (await readWorkspace(page)).page.regions[0].id;
  const equation = page.locator(`[data-region-id="${massId}"] .er-math-line`);
  await equation.click();
  await expect(writer).toHaveCount(0);
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(writer).toHaveValue("mass = 2 kg");
  await writer.fill("mass = 3 kg");
  await writer.press("Escape");
  await equation.dblclick();
  await expect(writer).toHaveValue("mass = 3 kg");
  await writer.fill("mass = 4 kg");
  await pan.click();
  await expect(writer).toHaveCount(0);
  expect(
    (await readWorkspace(page)).page.regions.find(
      (region) => region.id === massId,
    ).text,
  ).toBe("mass = 4 kg");
  await chooseDrawingTool(page, "Select / Edit");
  await expect(pan).toHaveAttribute("aria-pressed", "false");

  await chooseDrawingTool(page, "Rectangle");
  await expect(tool("Shapes")).toHaveAttribute("data-active", "true");
  await expect(tool("Shapes")).toHaveAttribute("aria-expanded", "false");
  await expect(tool("Drawing style")).toBeVisible();
  await drag({ x: 450, y: 140 }, { x: 650, y: 250 });
  expect(await marks()).toHaveLength(1);
  const head = await readWorkspaceBytes(page);

  // Escape dismisses the innermost picker, not the active tool or selection beneath it.
  await tool("Shapes").click();
  await page.keyboard.press("Escape");
  await expect(tool("Shapes")).toHaveAttribute("aria-expanded", "false");
  await expect(tool("Shapes")).toHaveAttribute("data-active", "true");
  expect(await readWorkspaceBytes(page)).toBe(head);
  await page.keyboard.press("Escape");
  await expect(tool("Select / Edit")).toHaveAttribute("aria-pressed", "true");
  await expect(tool("Drawing style")).toHaveCount(0);
  await chooseDrawingTool(page, "Pen");
  await tool("Drawing style").click();
  await page.getByLabel("Stroke width", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(tool("Drawing style")).toHaveAttribute("aria-expanded", "false");
  await expect(tool("Pen")).toHaveAttribute("aria-pressed", "true");
  expect(await readWorkspaceBytes(page)).toBe(head);

  // Pan suspends authoring; there is only one active-looking mode and no accidental edits.
  await chooseDrawingTool(page, "Rectangle");
  await pan.click();
  await expect(pan).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.locator('button[aria-pressed="true"],button[data-active="true"]'),
  ).toHaveCount(0);
  await expect(tool("Drawing style")).toHaveCount(0);
  await expect(page.locator(".drawing-background")).toHaveCount(0);
  await canvas.focus();
  for (const key of ["ArrowRight", "Delete", "Enter", "q"])
    await page.keyboard.press(key);
  await expect(writer).toHaveCount(0);
  await drag({ x: 800, y: 400 }, { x: 860, y: 440 });
  expect(await readWorkspaceBytes(page)).toBe(head);
  await page.keyboard.press("Escape");
  await expect(pan).toHaveAttribute("aria-pressed", "false");
  await expect(tool("Shapes")).toHaveAttribute("data-active", "true");
  await pan.click();
  await chooseDrawingTool(page, "Pen");
  await expect(pan).toHaveAttribute("aria-pressed", "false");
  await expect(tool("Pen")).toHaveAttribute("aria-pressed", "true");
  await chooseDrawingTool(page, "Select / Edit");

  const rectangle = page.getByRole("button", {
    name: /^rectangle drawing \d+$/,
  });
  await rectangle.click();
  await expect(selection).toBeVisible();
  await selection.locator(".er-selection-more > summary").click();
  await page.keyboard.press("Escape");
  await expect(selection.locator("details")).not.toHaveAttribute("open", "");
  await expect(page.locator(".drawing-selection")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".drawing-selection")).toHaveCount(0);

  // Aborting a move preserves selection and the exact persisted document head.
  await rectangle.click();
  const beforeMove = await readWorkspaceBytes(page);
  const box = await rectangle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 40,
    { steps: 5 },
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await readWorkspaceBytes(page)).toBe(beforeMove);
  await expect(page.locator(".drawing-selection")).toBeVisible();

  // One blank click clears object selection AND places the writer at that point.
  const blank = await canvas.boundingBox();
  await canvas.click({
    position: { x: blank.width - 100, y: blank.height - 100 },
  });
  await expect(writer).toBeFocused();
  await expect(page.locator(".drawing-selection")).toHaveCount(0);
  await writer.fill("A note placed directly on the canvas.");
  await writer.press("Escape");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(writer).toHaveValue("A note placed directly on the canvas.");
  await writer.press("Escape");

  // Menus retain active-tool feedback and primary controls never overflow on phones.
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of [
      "Select / Edit",
      "Pen",
      "Shapes",
      "Drawing label",
      "More drawing tools",
    ]) {
      const bounds = await tool(name).boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await tool("Shapes").click();
    const picker = page.getByRole("group", {
      name: "Shapes commands",
      exact: true,
    });
    const bounds = await picker.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(7);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 7);
    await chooseDrawingTool(page, "Ellipse");
    await expect(tool("Shapes")).toHaveAttribute("data-active", "true");
    await chooseDrawingTool(page, "Highlighter");
    await expect(tool("More drawing tools")).toHaveAttribute(
      "data-active",
      "true",
    );
    await chooseDrawingTool(page, "Select / Edit");
  }
  expect(errors).toEqual([]);
  console.log(
    "Pointer workflow: direct authoring, selected-region editing, compact pickers, layered Escape, exclusive Pan, cancellation, blank-click placement and four responsive widths pass.",
  );
} finally {
  await browser.close();
}
