import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { chooseDrawingTool, readWorkspace } from "./browser-workspace.mjs";
import { drawings } from "../src/regions/drawing.ts";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const canvas = page.locator(".er-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const click = (x, y) => page.mouse.click(box.x + x, box.y + y);
  const marks = async () => drawings((await readWorkspace(page)).document);
  await chooseDrawingTool(page, "Curve");
  await click(150, 150);
  await click(250, 350);
  assert.equal((await marks()).length, 0, "unfinished curve is not persisted");
  await page.mouse.move(box.x + 350, box.y + 150);
  await expect(
    page.locator('.drawing-surface > g[pointer-events="none"] path'),
  ).toHaveAttribute("d", / C/);
  await click(350, 150);
  await expect.poll(async () => (await marks()).length).toBe(1);
  const original = (await marks())[0];
  await expect(
    page.locator('[data-drawing-kind="curve"] path'),
  ).toHaveAttribute("d", / C/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await marks()).length).toBe(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(marks).toEqual([original]);
  await chooseDrawingTool(page, "Select / Edit");
  const control = page.locator('[data-curve-point="1"]');
  await expect(control).toBeVisible();
  const handle = await control.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 30,
    handle.y + handle.height / 2 - 40,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await marks())[0].mark.points[1].x)
    .toBe(original.mark.points[1].x + 30);
  await control.focus();
  await expect(control).toBeFocused();
  await control.press("ArrowRight");
  await expect
    .poll(async () => (await marks())[0].mark.points[1].x)
    .toBe(original.mark.points[1].x + 35);
  await page.keyboard.press("Escape");
  await chooseDrawingTool(page, "Spline");
  await click(500, 200);
  await click(600, 350);
  await click(700, 200);
  await page.keyboard.press("Backspace");
  await click(720, 250);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await marks()).length).toBe(2);
  assert.equal((await marks())[1].mark.points.length, 3);
  await click(500, 450);
  await click(600, 550);
  await page.mouse.dblclick(box.x + 700, box.y + 450);
  await expect.poll(async () => (await marks()).length).toBe(3);
  assert.equal(
    (await marks())[2].mark.points.length,
    3,
    "double-click adds no duplicate knot",
  );
  await click(800, 450);
  await click(900, 550);
  await page.keyboard.press("Escape");
  assert.equal((await marks()).length, 3, "Escape discards the draft");
  assert.deepEqual(errors, []);
  console.log(
    "drawing curves browser: previews, authoring, control editing, keyboard, history and cancellation passed",
  );
} finally {
  await browser.close();
}
