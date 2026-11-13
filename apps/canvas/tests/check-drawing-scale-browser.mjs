import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { drawings } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import {
  readWorkspace,
  readWorkspaceBytes,
  chooseDrawingTool,
} from "./browser-workspace.mjs";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const canvas = page.locator(".er-canvas"),
    trigger = page.getByRole("button", {
      name: "Scaled drawings",
      exact: true,
    });
  const menu = page.getByRole("group", {
    name: "Scaled drawings commands",
    exact: true,
  });
  const open = async () => {
    if (!(await menu.isVisible())) await trigger.click();
  };
  const marks = async () => drawings((await readWorkspace(page)).document);
  const drag = async (a, b) => {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + a.x, box.y + a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 8 });
    await page.mouse.up();
  };
  await chooseDrawingTool(page, "Scaled drawing area");
  await drag({ x: 80, y: 90 }, { x: 680, y: 480 });
  let entries = await marks(),
    area = entries.find((e) => e.mark.kind === "area");
  expect(area.mark.scale.unit).toBe("mm");
  await expect(page.locator(".drawing-area-grid pattern")).toHaveCount(1);
  await open();
  await menu.getByLabel("Drawing area name", { exact: true }).fill("Bracket");
  await menu.getByLabel("Show all dimensions", { exact: true }).check();
  await menu
    .getByRole("button", { name: "Apply area properties", exact: true })
    .click();
  await menu
    .getByLabel("Exact geometry", { exact: true })
    .selectOption("rectangle");
  await menu
    .getByLabel("Exact drawing width or length", { exact: true })
    .fill("120 mm");
  await menu.getByLabel("Exact drawing height", { exact: true }).fill("80 mm");
  await menu
    .getByRole("button", { name: "Create exact rectangle", exact: true })
    .click();
  entries = await marks();
  const rectangle = entries.find((e) => e.mark.kind === "rectangle"),
    rectId = rectangle.id;
  expect(rectangle.mark.area.item).toBe(area.id);
  const dimension = page.locator(`[data-drawing-dimension="${rectId}"]`);
  await expect(dimension).toHaveAttribute("aria-label", "120 mm × 80 mm");
  await expect(
    page.locator(`[data-drawing-id="${rectId}"]`),
  ).toHaveAccessibleDescription(/120 mm × 80 mm/);
  // Repeated display conversions must preserve the exact stored calibration, not round-trip formatted spans.
  const physicalPoints = rectangle.mark.points;
  for (const unit of ["in", "ft", "um", "inch", "mm"]) {
    await menu.getByLabel("Drawing display unit", { exact: true }).fill(unit);
    await menu
      .getByRole("button", { name: "Apply area properties", exact: true })
      .click();
    entries = await marks();
    expect(entries.find((e) => e.id === area.id).mark.scale.metresPerUnit).toBe(
      0.001,
    );
    expect(entries.find((e) => e.id === rectId).mark.points).toEqual(
      physicalPoints,
    );
  }
  await expect(dimension).toHaveAttribute("aria-label", "120 mm × 80 mm");
  const beforeBad = await readWorkspaceBytes(page);
  await menu
    .getByLabel("Exact drawing width or length", { exact: true })
    .fill("1 kg");
  await menu
    .getByRole("button", { name: "Apply dimensions", exact: true })
    .click();
  await expect(menu.getByRole("alert")).toContainText("length unit");
  expect(await readWorkspaceBytes(page)).toBe(beforeBad);
  await menu
    .getByLabel("Exact drawing width or length", { exact: true })
    .fill("60 mm");
  await menu.getByLabel("Exact drawing height", { exact: true }).fill("40 mm");
  await menu
    .getByRole("button", { name: "Apply dimensions", exact: true })
    .click();
  await expect(dimension).toHaveAttribute("aria-label", "60 mm × 40 mm");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(dimension).toHaveAttribute("aria-label", "120 mm × 80 mm");
  // A marquee within an area selects the object, never the whole area's contents.
  await chooseDrawingTool(page, "Select / Edit");
  await canvas.focus();
  await page.keyboard.press("Escape");
  await drag({ x: 110, y: 115 }, { x: 250, y: 230 });
  await expect(page.locator(`[data-drawing-id="${rectId}"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(`[data-drawing-id="${area.id}"]`)).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // Physical-grid snapping is applied to gesture endpoints in area-local coordinates.
  await chooseDrawingTool(page, "Rectangle");
  await drag({ x: 260, y: 200 }, { x: 383, y: 283 });
  entries = await marks();
  const snapped = entries.filter(
    (e) => e.mark.kind === "rectangle" && e.id !== rectId,
  )[0];
  expect(snapped.mark.area.item).toBe(area.id);
  const geometry = drawingGeometry(entries),
    origin = geometry.bounds(entries.find((e) => e.id === area.id));
  for (const p of geometry.points(snapped))
    for (const axis of ["x", "y"])
      expect(
        Math.abs(
          (p[axis] - origin[axis]) / 5 -
            Math.round((p[axis] - origin[axis]) / 5),
        ),
      ).toBeLessThan(1e-8);
  // The eraser removes marks, not the physical area that gives them meaning.
  const beforeErase = await readWorkspaceBytes(page);
  await chooseDrawingTool(page, "Eraser");
  await drag({ x: 80, y: 100 }, { x: 80, y: 120 });
  expect(await readWorkspaceBytes(page)).toBe(beforeErase);
  const savedPoints = entries.find((e) => e.id === rectId).mark.points;
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect((await marks()).find((e) => e.id === rectId).mark.points).toEqual(
    savedPoints,
  );
  await page.reload();
  await expect(dimension).toHaveAttribute("aria-label", "120 mm × 80 mm");
  expect((await marks()).find((e) => e.id === area.id).mark.scale.name).toBe(
    "Bracket",
  );
  // A second area's feet scale does not change the first area's millimetres.
  await chooseDrawingTool(page, "Scaled drawing area");
  await drag({ x: 760, y: 100 }, { x: 1120, y: 440 });
  entries = await marks();
  const second = entries.find(
    (e) => e.mark.kind === "area" && e.id !== area.id,
  );
  await open();
  await menu.getByLabel("Drawing area name", { exact: true }).fill("Building");
  await menu.getByLabel("Drawing display unit", { exact: true }).fill("ft");
  await menu.getByLabel("Drawing scale span", { exact: true }).fill("5 ft");
  await menu.getByLabel("Drawing grid spacing", { exact: true }).fill("1/4 ft");
  await menu
    .getByRole("button", { name: "Apply area properties", exact: true })
    .click();
  await menu.getByLabel("Exact geometry", { exact: true }).selectOption("line");
  await menu
    .getByLabel("Exact drawing width or length", { exact: true })
    .fill("6 ft");
  await menu.getByLabel("Exact drawing angle", { exact: true }).fill("0");
  await menu
    .getByRole("button", { name: "Create exact line", exact: true })
    .click();
  entries = await marks();
  const feetLine = entries.find((e) => e.mark.kind === "line");
  expect(feetLine.mark.area.item).toBe(second.id);
  const feetPoints = drawingGeometry(entries).points(feetLine);
  expect(feetPoints[1].x - feetPoints[0].x).toBeCloseTo(120, 8);
  await expect(
    page.locator(`[data-drawing-dimension="${feetLine.id}"]`),
  ).toHaveAttribute("aria-label", "6 ft · 0°");
  expect(entries.find((e) => e.id === area.id).mark.scale.metresPerUnit).toBe(
    0.001,
  );
  // Escape dismisses the inspector before touching the drawing selection, including on small screens.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(
    page.locator(`[data-drawing-id="${feetLine.id}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await open();
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await expect(
      menu.getByLabel("Drawing display unit", { exact: true }),
    ).toHaveValue("ft");
    await menu
      .getByLabel("Drawing area name", { exact: true })
      .fill(`Building ${width}`);
    await menu
      .getByRole("button", { name: "Apply area properties", exact: true })
      .click();
    await page.keyboard.press("Escape");
  }
  // A fresh sketch remains unscaled until explicit calibration, which is one Undo step.
  const raw = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  raw.on("pageerror", (e) => errors.push(e.message));
  await raw.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  await chooseDrawingTool(raw, "Line");
  const box = await raw.locator(".er-canvas").boundingBox();
  await raw.mouse.move(box.x + 100, box.y + 100);
  await raw.mouse.down();
  await raw.mouse.move(box.x + 300, box.y + 100, { steps: 8 });
  await raw.mouse.up();
  let rawEntries = drawings((await readWorkspace(raw)).document),
    reference = rawEntries[0];
  expect(reference.mark.area).toBeUndefined();
  await raw
    .getByRole("button", { name: "Scaled drawings", exact: true })
    .click();
  const rawMenu = raw.getByRole("group", {
    name: "Scaled drawings commands",
    exact: true,
  });
  await rawMenu.getByLabel("Known line length", { exact: true }).fill("2 m");
  await rawMenu
    .getByRole("button", { name: "Calibrate selected drawings", exact: true })
    .click();
  rawEntries = drawings((await readWorkspace(raw)).document);
  const calibrated = rawEntries.find((e) => e.mark.kind === "area");
  expect(calibrated.mark.scale.metresPerUnit).toBeCloseTo(0.01, 12);
  expect(rawEntries.find((e) => e.id === reference.id).mark.points).toEqual(
    reference.mark.points,
  );
  await expect(
    raw.locator(`[data-drawing-dimension="${reference.id}"]`),
  ).toHaveAttribute("aria-label", "2 m · 0°");
  await raw.getByRole("button", { name: "Undo", exact: true }).click();
  rawEntries = drawings((await readWorkspace(raw)).document);
  expect(rawEntries).toHaveLength(1);
  expect(rawEntries[0].mark.area).toBeUndefined();
  await raw.getByRole("button", { name: "Redo", exact: true }).click();
  expect(drawings((await readWorkspace(raw)).document)).toHaveLength(2);
  expect(errors).toEqual([]);
  console.log(
    "Scaled drawing areas: exact mixed-unit geometry, safe unit conversion and validation, grid snapping, zoom/reload stability, independent scales, calibration/Undo and responsive controls pass.",
  );
} finally {
  await browser.close();
}
