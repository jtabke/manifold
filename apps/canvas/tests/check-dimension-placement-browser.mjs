import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { drawings } from "../src/regions/drawing.ts";
import {
  chooseDrawingTool,
  readWorkspace,
  readWorkspaceBytes,
} from "./browser-workspace.mjs";
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const canvas = page.locator(".er-canvas"),
    trigger = page.getByRole("button", {
      name: "Scaled drawings",
      exact: true,
    }),
    menu = page.getByRole("group", {
      name: "Scaled drawings commands",
      exact: true,
    });
  const open = async () => {
    if (!(await menu.isVisible())) await trigger.click();
  };
  const entries = async () => drawings((await readWorkspace(page)).document);
  const mark = async (id) => (await entries()).find((e) => e.id === id);
  const dragCanvas = async (a, b) => {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + a.x, box.y + a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 8 });
    await page.mouse.up();
  };
  await chooseDrawingTool(page, "Scaled drawing area");
  await dragCanvas({ x: 80, y: 180 }, { x: 700, y: 600 });
  await open();
  await expect(
    menu.getByLabel("Show all dimensions", { exact: true }),
  ).not.toBeChecked();
  await menu
    .getByLabel("Exact geometry", { exact: true })
    .selectOption("rectangle");
  await menu
    .getByLabel("Exact drawing width or length", { exact: true })
    .fill("160 mm");
  await menu.getByLabel("Exact drawing height", { exact: true }).fill("100 mm");
  await menu
    .getByRole("button", { name: "Create exact rectangle", exact: true })
    .click();
  const rectangle = (await entries()).find((e) => e.mark.kind === "rectangle"),
    id = rectangle.id,
    areaId = rectangle.mark.area.item;
  const dimension = page.locator(`[data-drawing-dimension="${id}"]`),
    shape = page.locator(`[data-drawing-id="${id}"]`);
  const axis = (name) => dimension.locator(`[data-dimension-axis="${name}"]`);
  const control = (name, part) =>
    axis(name).getByRole("button", {
      name: `Move ${name} dimension ${part}`,
      exact: true,
    });
  await page.keyboard.press("Escape");
  await expect(dimension).toHaveAttribute("aria-label", "160 mm × 100 mm");
  await expect(
    axis("width").locator(".drawing-dimension-extension"),
  ).toHaveCount(2);
  await expect(axis("height").locator(".drawing-dimension-arrow")).toHaveCount(
    2,
  );
  const widthLabel = axis("width").locator("text"),
    heightLabel = axis("height").locator("text");
  await expect(widthLabel).toHaveText("160 mm");
  await expect(heightLabel).toHaveText("100 mm");
  const sourcePoints = rectangle.mark.points,
    sourceView = rectangle.view;
  const handlePoint = async (name, part) => {
    const b = await control(name, part).boundingBox();
    return {
      x: b.x + (part === "line" ? 8 : b.width / 2),
      y: b.y + b.height / 2,
    };
  };
  const begin = async (name, part) => {
    const p = await handlePoint(name, part);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    return p;
  };
  // Previews publish nothing; one release publishes only annotation coordinates.
  const before = await readWorkspaceBytes(page),
    p = await begin("width", "line");
  await page.mouse.move(p.x, p.y + 55, { steps: 8 });
  expect(await readWorkspaceBytes(page)).toBe(before);
  await page.mouse.up();
  let persisted = await mark(id);
  expect(persisted.mark.dimensionPlacement.width.offset).toBeCloseTo(83, 5);
  expect(persisted.mark.points).toEqual(sourcePoints);
  expect(persisted.view).toEqual(sourceView);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await mark(id)).mark.dimensionPlacement).toBeUndefined();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await mark(id)).mark.dimensionPlacement.width.offset).toBeCloseTo(
    83,
    5,
  );
  // Label movement is tangential, not a value edit or geometry resize.
  const labelBefore = Number(await widthLabel.getAttribute("x")),
    q = await begin("width", "label");
  await page.mouse.move(q.x + 45, q.y, { steps: 8 });
  await page.mouse.up();
  const placed = (await mark(id)).mark.dimensionPlacement.width;
  expect(placed.label).toBeCloseTo(45, 5);
  expect(placed.offset).toBeCloseTo(83, 5);
  expect(Number(await widthLabel.getAttribute("x")) - labelBefore).toBeCloseTo(
    45,
    5,
  );
  await expect(widthLabel).toHaveText("160 mm");
  expect((await mark(id)).mark.points).toEqual(sourcePoints);
  // Escape and pointer cancellation discard the whole gesture without clearing selection.
  const saved = await readWorkspaceBytes(page),
    r = await begin("height", "line");
  await page.mouse.move(r.x + 50, r.y, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await readWorkspaceBytes(page)).toBe(saved);
  await expect(shape).toHaveAttribute("aria-pressed", "true");
  const c = await begin("height", "line");
  await page.mouse.move(c.x + 35, c.y, { steps: 4 });
  await control("height", "line").dispatchEvent("pointercancel", {
    pointerId: 1,
  });
  await page.mouse.up();
  expect(await readWorkspaceBytes(page)).toBe(saved);
  // Cancellation still belongs to this gesture if focus leaves its SVG control.
  const away = await begin("height", "line");
  await page.mouse.move(away.x + 30, away.y, { steps: 4 });
  await page.getByRole("button", { name: "Undo", exact: true }).focus();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await readWorkspaceBytes(page)).toBe(saved);
  await expect(shape).toHaveAttribute("aria-pressed", "true");
  const blurred = await begin("height", "line");
  await page.mouse.move(blurred.x + 30, blurred.y, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.mouse.up();
  expect(await readWorkspaceBytes(page)).toBe(saved);
  // Keyboard placement and native Undo work while the annotation handle owns focus.
  await control("height", "line").focus();
  await page.keyboard.press("ArrowRight");
  expect((await mark(id)).mark.dimensionPlacement.height.offset).toBeCloseTo(
    33,
    5,
  );
  await page.keyboard.press("Control+z");
  expect((await mark(id)).mark.dimensionPlacement.height).toBeUndefined();
  await control("height", "line").focus();
  await page.keyboard.press("Shift+ArrowRight");
  expect((await mark(id)).mark.dimensionPlacement.height.offset).toBeCloseTo(
    48,
    5,
  );
  await page.keyboard.press("Home");
  expect((await mark(id)).mark.dimensionPlacement.height).toBeUndefined();
  // Only pinned dimensions remain after deselection; saved placement survives reload.
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(axis("width")).toHaveCount(1);
  await expect(axis("height")).toHaveCount(0);
  await page.reload();
  await expect(axis("width")).toHaveCount(1);
  await expect(axis("height")).toHaveCount(0);
  expect((await mark(id)).mark.dimensionPlacement.width).toEqual(placed);
  // The visible pinned annotation itself can select its shape and be touched/dragged.
  const touch = await page.context().newCDPSession(page),
    t = await handlePoint("width", "line");
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: t.x, y: t.y, id: 7 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: t.x, y: t.y + 30, id: 7 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(shape).toHaveAttribute("aria-pressed", "true");
  expect((await mark(id)).mark.dimensionPlacement.width.offset).toBeCloseTo(
    113,
    4,
  );
  expect((await mark(id)).mark.points).toEqual(sourcePoints);
  // Zoom affects decoration legibility, not stored placement or physical values.
  const pin = (await mark(id)).mark.dimensionPlacement;
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect((await mark(id)).mark.dimensionPlacement).toEqual(pin);
  await expect(widthLabel).toHaveText("160 mm");
  await open();
  await menu.getByLabel("Drawing display unit", { exact: true }).fill("in");
  await menu
    .getByRole("button", { name: "Apply area properties", exact: true })
    .click();
  expect((await mark(id)).mark.dimensionPlacement).toEqual(pin);
  expect((await mark(id)).mark.points).toEqual(sourcePoints);
  await expect(widthLabel).toHaveText("6.2992126 in");
  await menu
    .getByRole("button", { name: "Reset dimension placement", exact: true })
    .click();
  expect((await mark(id)).mark.dimensionPlacement).toBeUndefined();
  await page.keyboard.press("Escape");
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(dimension).toHaveCount(0);
  // Show all is an explicit per-area choice; it does not manufacture placement records.
  await open();
  await menu.getByLabel("Drawing area", { exact: true }).selectOption(areaId);
  await menu.getByLabel("Show all dimensions", { exact: true }).check();
  await menu
    .getByRole("button", { name: "Apply area properties", exact: true })
    .click();
  await expect(dimension).toHaveCount(1);
  await expect(axis("height")).toHaveCount(1);
  expect((await mark(id)).mark.dimensionPlacement).toBeUndefined();
  await menu.getByLabel("Show dimensions", { exact: true }).uncheck();
  await menu
    .getByRole("button", { name: "Apply area properties", exact: true })
    .click();
  await expect(dimension).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "Drafting dimensions: extension lines/arrows, selected-only defaults, independent line/label dragging, zero-write previews, cancel, keyboard/reset/Undo, pinned persistence, touch, zoom/unit invariance and explicit show-all/hide pass.",
  );
} finally {
  await browser.close();
}
