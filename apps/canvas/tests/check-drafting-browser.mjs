import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { chooseDrawingTool, readWorkspace } from "./browser-workspace.mjs";
import { drawings } from "../src/regions/drawing.ts";

const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const canvas = page.locator(".er-canvas");
  const box = await canvas.boundingBox();
  const click = (x, y) => page.mouse.click(box.x + x, box.y + y);
  const drag = async (x, y, x2, y2) => {
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + x2, box.y + y2, { steps: 5 });
    await page.mouse.up();
  };
  const entries = async () => drawings((await readWorkspace(page)).document);
  const byKind = async (kind) =>
    (await entries()).find((e) => e.mark.kind === kind);
  const visibleKind = (kind) => page.locator(`[data-drawing-kind="${kind}"]`);
  const scale = page.getByRole("button", {
    name: "Scaled drawings",
    exact: true,
  });
  const scalePanel = page.getByRole("group", {
    name: "Scaled drawings commands",
    exact: true,
  });
  const select = () => chooseDrawingTool(page, "Select / Edit");

  await chooseDrawingTool(page, "Scaled drawing area");
  await drag(26, 50, 346, 580);
  await expect(visibleKind("area")).toHaveCount(1);
  await chooseDrawingTool(page, "Polyline / Polygon");
  await expect(
    page.getByRole("button", { name: "Shapes: Polyline", exact: true }),
  ).toBeVisible();
  await click(171, 225);
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 283, box.y + 243);
  const preview = page.locator("[data-polyline-preview]");
  await expect(preview).toBeVisible();
  await expect(preview.locator("polyline")).toHaveAttribute(
    "points",
    /,225 [^ ]+,225$/,
  );
  await click(283, 243);
  await page.keyboard.up("Shift");
  await click(286, 285);
  await page.keyboard.press("Backspace");
  await expect(visibleKind("polyline")).toHaveCount(0);
  await click(301, 268);
  await page.keyboard.press("Enter");
  await expect(visibleKind("polyline")).toHaveCount(1);
  const polyline = await byKind("polyline");
  assert.equal(polyline.mark.points.length, 3);
  assert.equal(
    polyline.mark.points[0].y,
    polyline.mark.points[1].y,
    "Shift locks the segment to the nearest 45°",
  );
  assert(polyline.mark.area, "polyline adopts the current area's scale");
  await click(51, 260);
  await click(146, 260);
  await click(146, 320);
  await click(91, 340);
  await click(52, 261);
  await expect(visibleKind("polygon").locator("polygon")).toBeVisible();
  assert.equal(
    (await byKind("polygon")).mark.points.length,
    4,
    "closing does not duplicate the first vertex",
  );
  await select();
  const vertex = page.getByRole("button", {
    name: "Vertex 2; arrow keys to move",
    exact: true,
  });
  await expect(vertex).toBeVisible();
  const beforeVertex = (await byKind("polygon")).mark.points[1].y;
  await vertex.press("ArrowUp");
  await expect
    .poll(async () => (await byKind("polygon")).mark.points[1].y)
    .toBe(beforeVertex - 5);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await byKind("polygon")).mark.points[1].y)
    .toBe(beforeVertex);
  await page
    .getByRole("button", { name: "Select / Edit", exact: true })
    .focus();
  await page.keyboard.press("y");
  await expect(
    page.getByRole("button", { name: "Shapes: Polyline", exact: true }),
  ).toBeVisible();
  await click(131, 505);
  await click(181, 525);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(visibleKind("polyline")).toHaveCount(1);

  await chooseDrawingTool(page, "Three-point arc");
  await click(196, 400);
  await click(246, 350);
  await click(296, 400);
  await select();
  const radius = page.getByRole("img", { name: "Radius 50 mm", exact: true });
  const diameter = page.getByRole("img", {
    name: "Diameter 100 mm",
    exact: true,
  });
  await expect(radius).toBeVisible();
  const arcPoints = (await byKind("arc")).mark.points;
  await scale.click();
  await scalePanel
    .getByRole("button", { name: "Keep diameter", exact: true })
    .click();
  await expect(diameter).toHaveAttribute("data-dimension-pinned", "true");
  assert.deepEqual((await byKind("arc")).mark.points, arcPoints);
  await page.keyboard.press("Escape");
  await chooseDrawingTool(page, "Ellipse");
  await page.keyboard.down("Shift");
  await drag(196, 465, 276, 529);
  await page.keyboard.up("Shift");
  await select();
  await expect(
    page.getByRole("img", { name: "Radius 40 mm", exact: true }),
  ).toBeVisible();
  await scale.click();
  await scalePanel
    .getByRole("button", { name: "Keep radius", exact: true })
    .click();
  await page.keyboard.press("Escape");

  await chooseDrawingTool(page, "Line");
  await drag(66, 185, 166, 185);
  await chooseDrawingTool(page, "Arrow");
  await drag(66, 185, 66, 85);
  await select();
  await click(130, 185);
  await page.keyboard.down("Shift");
  await click(66, 130);
  await page.keyboard.up("Shift");
  const angle = page.getByRole("img", {
    name: "Included angle 90°",
    exact: true,
  });
  await expect(angle).toHaveAttribute("data-dimension-pinned", "false");
  await scale.click();
  await scalePanel
    .getByRole("button", { name: "Keep angle dimension", exact: true })
    .click();
  await expect(angle).toHaveAttribute("data-dimension-pinned", "true");
  await page.keyboard.press("Escape");
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(angle).toHaveAttribute("data-dimension-pinned", "true");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(angle).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(angle).toBeVisible();
  await expect
    .poll(
      async () =>
        (await entries()).filter((e) => e.mark.angleDimensions?.length).length,
    )
    .toBe(1);
  await page.reload();
  await expect(angle).toHaveAttribute("data-dimension-pinned", "true");
  await expect(diameter).toHaveAttribute("data-dimension-pinned", "true");
  await expect(
    page.getByRole("img", { name: "Radius 40 mm", exact: true }),
  ).toHaveAttribute("data-dimension-pinned", "true");
  await captureEvidence(page, {
    path: "screenshots/drafting-dimensions-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(angle).toBeInViewport();
  await expect(diameter).toBeInViewport();
  await captureEvidence(page, {
    path: "screenshots/drafting-dimensions-390.png",
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  console.log(
    "Drafting browser: polygon closure, path snap and vertex edits, scaled radius/diameter and live angle preview, kept annotations and 390 px reopen pass.",
  );
} finally {
  await browser.close();
}
