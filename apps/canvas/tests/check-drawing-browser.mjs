import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import { chromium, expect } from "@playwright/test";
import { drawings, MAX_LABEL_LENGTH } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const canvas = page.locator(".er-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  assert(box.height > 500, "toolbar must leave a usable canvas");
  const toolbar = page.getByRole("toolbar", {
    name: "Drawing and diagram tools",
  });
  const tool = (name) =>
    toolbar.getByRole("button", { name, exact: true }).click();
  const drag = async (a, b) => {
    await page.mouse.move(box.x + a.x, box.y + a.y);
    await page.mouse.down();
    await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 10 });
    await page.mouse.up();
  };
  const marks = async () => drawings((await readWorkspace(page)).document);
  const count = async (n) =>
    expect.poll(async () => (await marks()).length).toBe(n);
  await tool("Rectangle");
  await expect(page.locator(".er-empty")).toBeHidden();
  await drag({ x: 120, y: 120 }, { x: 280, y: 220 });
  await count(1);
  const a = (await marks()).find((e) => e.mark.kind === "rectangle");
  await tool("Ellipse");
  await drag({ x: 480, y: 120 }, { x: 640, y: 220 });
  await count(2);
  const b = (await marks()).find((e) => e.mark.kind === "ellipse");
  await tool("Visual connector");
  await drag({ x: 280, y: 170 }, { x: 480, y: 170 });
  await count(3);
  let connector = (await marks()).find((e) => e.mark.kind === "connector");
  assert.equal(connector.mark.start.target.item, a.id);
  assert.equal(connector.mark.end.target.item, b.id);
  await tool("Select drawings");
  await drag({ x: 380, y: 170 }, { x: 400, y: 250 });
  await expect
    .poll(
      async () => (await marks()).find((e) => e.id === connector.id).mark.start,
    )
    .toBeNull();
  await expect
    .poll(
      async () => (await marks()).find((e) => e.id === connector.id).mark.end,
    )
    .toBeNull();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(
      async () =>
        (await marks()).find((e) => e.id === connector.id).mark.start?.target
          .item,
    )
    .toBe(a.id);
  const beforeMove = await readWorkspaceBytes(page);
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 230, { steps: 5 });
  assert.equal(
    await readWorkspaceBytes(page),
    beforeMove,
    "drag preview writes nothing",
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await marks()).find((e) => e.id === a.id).view.x)
    .not.toBe(a.view.x);
  let moved = await marks();
  assert.equal(
    Number(
      await page
        .locator(`[data-drawing-id="${connector.id}"] line`)
        .getAttribute("y1"),
    ),
    240,
    "attached connector rendering must track the moved target",
  );
  assert.equal(
    await page
      .locator(`[data-drawing-id="${connector.id}"]`)
      .getAttribute("transform"),
    null,
    "connector endpoints already use world coordinates",
  );
  assert.equal(
    drawingGeometry(moved).points(moved.find((e) => e.id === connector.id))[0]
      .y,
    240,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await marks()).find((e) => e.id === a.id).view.x)
    .toBe(a.view.x);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => (await marks()).find((e) => e.id === a.id).view.x)
    .not.toBe(a.view.x);
  // Cancellation must leave the exact persisted head unchanged.
  const beforeCancel = await readWorkspaceBytes(page);
  await page.mouse.move(box.x + 240, box.y + 230);
  await page.mouse.down();
  await page.mouse.move(box.x + 290, box.y + 290, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await readWorkspaceBytes(page), beforeCancel);
  // A stylus stroke retains varying pressure; touch never authors ink.
  await tool("Pen");
  const beforePointerCancel = await readWorkspaceBytes(page);
  await page.mouse.move(box.x + 800, box.y + 500);
  await page.mouse.down();
  await page.mouse.move(box.x + 830, box.y + 520);
  await page.locator(".drawing-surface").evaluate((node) => {
    for (const type of ["pointermove", "pointerup", "pointercancel"])
      node.dispatchEvent(
        new PointerEvent(type, { pointerId: 999, bubbles: true }),
      );
  });
  await expect(page.locator("[data-drawing-active]")).toHaveCount(1);
  assert.equal(
    await readWorkspaceBytes(page),
    beforePointerCancel,
    "unrelated pointers neither sample nor commit the active gesture",
  );
  await page
    .locator(".drawing-surface")
    .evaluate((node) =>
      node.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }),
      ),
    );
  await expect(page.locator("[data-drawing-active]")).toHaveCount(0);
  assert.equal(
    await page
      .locator(".drawing-surface")
      .evaluate((node) => node.hasPointerCapture(1)),
    false,
  );
  await page.mouse.up();
  assert.equal(
    await readWorkspaceBytes(page),
    beforePointerCancel,
    "pointer cancellation releases capture and publishes nothing",
  );
  const cdp = await context.newCDPSession(page);
  for (const [type, x, y, force, button, buttons] of [
    ["mousePressed", 120, 360, 0.1, "left", 1],
    ["mouseMoved", 160, 390, 0.9, "none", 1],
    ["mouseMoved", 220, 355, 0.4, "none", 1],
    ["mouseReleased", 220, 355, 0, "left", 0],
  ])
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: box.x + x,
      y: box.y + y,
      force,
      button,
      buttons,
      pointerType: "pen",
    });
  await count(4);
  const ink = (await marks()).find((e) => e.mark.kind === "pen");
  assert(new Set(ink.mark.points.map((p) => p.pressure.toFixed(1))).size >= 2);
  await tool("Select drawings");
  const inkPath = page.locator(`[data-drawing-id="${ink.id}"] path`),
    inkBefore = await inkPath.getAttribute("d"),
    inkBox = await inkPath.boundingBox();
  const beforeInkMove = await readWorkspaceBytes(page);
  await page.mouse.move(box.x + 160, box.y + 390);
  await page.mouse.down();
  await page.mouse.move(box.x + 190, box.y + 410, { steps: 5 });
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.equal(
    await inkPath.getAttribute("d"),
    inkBefore,
    "pure-move previews reuse the local pressure outline",
  );
  const previewBox = await inkPath.boundingBox();
  assert(
    Math.abs(previewBox.x - inkBox.x - 30) < 1 &&
      Math.abs(previewBox.y - inkBox.y - 20) < 1,
    "SVG translation must move the visible outline in screen space",
  );
  assert.equal(
    await readWorkspaceBytes(page),
    beforeInkMove,
    "local rendering never publishes preview positions",
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await marks()).find((e) => e.id === ink.id).view.x)
    .not.toBe(ink.view.x);
  assert.equal(await inkPath.getAttribute("d"), inkBefore);
  assert.deepEqual((await marks()).find((e) => e.id === ink.id).mark, ink.mark);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await marks()).find((e) => e.id === ink.id).view.x)
    .toBe(ink.view.x);
  const inkHandle = await page.locator("[data-drawing-resize]").boundingBox();
  await page.mouse.move(
    inkHandle.x + inkHandle.width / 2,
    inkHandle.y + inkHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(inkHandle.x + 30, inkHandle.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => await inkPath.getAttribute("d"))
    .not.toBe(inkBefore);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => await inkPath.getAttribute("d"))
    .toBe(inkBefore);
  await tool("Highlighter");
  await drag({ x: 110, y: 365 }, { x: 230, y: 365 });
  await count(5);
  await page.mouse.click(box.x + 800, box.y + 400);
  await count(6);
  const tap = (await marks()).find(
    (e) => e.mark.kind === "highlighter" && e.mark.points.length === 1,
  );
  assert(tap);
  const tapPoints = await page
    .locator(`[data-drawing-id="${tap.id}"] polyline`)
    .getAttribute("points");
  assert.equal(
    tapPoints.trim().split(/\s+/).length,
    2,
    "a highlighter tap renders a round-capped segment",
  );
  await page.keyboard.press("ControlOrMeta+z");
  await count(5);
  await tool("Arrow");
  await page.keyboard.down("Shift");
  await drag({ x: 350, y: 350 }, { x: 450, y: 385 });
  await page.keyboard.up("Shift");
  await count(6);
  const arrow = (await marks()).find((e) => e.mark.kind === "arrow");
  assert.equal(
    arrow.mark.points[0].y,
    arrow.mark.points[1].y,
    "Shift snaps line angle",
  );
  await tool("Line");
  for (const [type, x, y, buttons] of [
    ["mousePressed", 350, 400, 1],
    ["mouseReleased", 450, 420, 0],
  ])
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x: box.x + x,
      y: box.y + y,
      button: "left",
      buttons,
      pointerType: "mouse",
    });
  await count(7);
  const finalLine = (await marks()).find((e) => e.mark.kind === "line");
  assert.equal(
    finalLine.mark.points[1].x,
    450,
    "release coordinates are sampled even without a final pointermove",
  );
  assert.equal(finalLine.mark.points[1].y, 420);
  await toolbar
    .getByRole("button", { name: "Drawing label", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    toolbar.getByRole("button", { name: "Drawing label", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(box.x + 500, box.y + 350);
  await expect(
    page.getByRole("textbox", { name: "Drawing label text" }),
  ).toHaveAttribute("maxlength", String(MAX_LABEL_LENGTH));
  await page
    .getByRole("textbox", { name: "Drawing label text" })
    .fill("Beam load");
  await page
    .getByRole("textbox", { name: "Drawing label text" })
    .press("Enter");
  await count(8);
  await expect(page.locator(".drawing-mark text")).toHaveText("Beam load");
  await page.mouse.click(box.x + 510, box.y + 360);
  await page
    .getByRole("textbox", { name: "Drawing label text" })
    .fill("Beam load\nF = 20 N");
  await page
    .getByRole("textbox", { name: "Drawing label text" })
    .press("Enter");
  await expect(page.locator(".drawing-mark text tspan")).toHaveCount(2);
  await expect
    .poll(
      async () =>
        (await marks()).find((e) => e.mark.kind === "text").mark.points[1].y,
    )
    .toBe(64);
  const beforeUnchangedLabel = await readWorkspaceBytes(page);
  await page.mouse.click(box.x + 510, box.y + 360);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(
    await readWorkspaceBytes(page),
    beforeUnchangedLabel,
    "finishing unchanged text creates no revision or Undo step",
  );
  // Lasso two shapes, resize as one operation, duplicate, delete and Undo.
  await tool("Lasso drawings");
  await page.mouse.move(box.x + 90, box.y + 90);
  await page.mouse.down();
  for (const p of [
    { x: 680, y: 90 },
    { x: 680, y: 310 },
    { x: 90, y: 310 },
    { x: 90, y: 90 },
  ])
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 8 });
  await page.mouse.up();
  await expect(
    toolbar.getByRole("button", { name: "Duplicate drawings" }),
  ).toBeEnabled();
  await tool("Select drawings");
  const handle = page.locator("[data-drawing-resize]");
  await expect(handle).toBeVisible();
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 40, { steps: 8 });
  await page.mouse.up();
  await toolbar.getByRole("button", { name: "Duplicate drawings" }).click();
  await count(11);
  await toolbar.getByRole("button", { name: "Delete drawings" }).click();
  await count(8);
  await page.keyboard.press("ControlOrMeta+z");
  await count(11);
  await page.keyboard.press("ControlOrMeta+z");
  await count(8);
  // Eraser gesture removes whole marks atomically, including connector detachment.
  await tool("Eraser");
  await drag({ x: 110, y: 365 }, { x: 230, y: 365 });
  await expect.poll(async () => (await marks()).length).toBeLessThan(8);
  await page.keyboard.press("ControlOrMeta+z");
  await count(8);
  const beforeSweep = await marks(),
    sweepGeometry = drawingGeometry(beforeSweep);
  const sweptMark = beforeSweep.find((e) => e.mark.kind === "rectangle"),
    sweptBounds = sweepGeometry.bounds(sweptMark);
  const sweepFrom = {
      x: sweptBounds.x - 30,
      y: sweptBounds.y + sweptBounds.height / 2,
    },
    sweepTo = { x: sweptBounds.x + sweptBounds.width + 30, y: sweepFrom.y };
  assert.equal(sweepGeometry.hit(sweptMark, sweepFrom, 9), false);
  assert.equal(sweepGeometry.hit(sweptMark, sweepTo, 9), false);
  const beforeSweepBytes = await readWorkspaceBytes(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x + sweepFrom.x,
    y: box.y + sweepFrom.y,
    button: "left",
    buttons: 1,
    pointerType: "mouse",
  });
  assert.equal(
    await readWorkspaceBytes(page),
    beforeSweepBytes,
    "eraser preview must remain transient",
  );
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x + sweepTo.x,
    y: box.y + sweepTo.y,
    button: "left",
    buttons: 0,
    pointerType: "mouse",
  });
  await expect
    .poll(async () => (await marks()).some((e) => e.id === sweptMark.id))
    .toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(marks).toEqual(beforeSweep);
  const beforeTouch = await marks();
  const camera = () =>
    canvas.evaluate((node) => ({
      x: node.scrollLeft - Number(node.dataset.canvasOriginX),
      y: node.scrollTop - Number(node.dataset.canvasOriginY),
    }));
  const beforeCamera = await camera();
  await tool("Pen");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 800, y: box.y + 500, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: box.x + 850, y: box.y + 550, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.deepEqual(await marks(), beforeTouch, "touch pans without adding ink");
  assert.notDeepEqual(
    await camera(),
    beforeCamera,
    "finger movement pans the camera",
  );
  const paper = page.locator(".er-paper");
  const beforeZoom = await paper.evaluate((node) => node.style.transform);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: box.x + 750, y: box.y + 450, id: 1 },
      { x: box.x + 900, y: box.y + 450, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: box.x + 700, y: box.y + 450, id: 1 },
      { x: box.x + 950, y: box.y + 450, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.notEqual(
    await paper.evaluate((node) => node.style.transform),
    beforeZoom,
    "two fingers pinch-zoom",
  );
  assert.deepEqual(await marks(), beforeTouch);
  await page.reload();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(8);
  assert.deepEqual(
    await marks(),
    beforeTouch,
    "local recovery preserves geometry and attachments",
  );
  // Export accepts the pending ordinary label through the shared edit-buffer port.
  await tool("Drawing label");
  await page.mouse.click(box.x + 800, box.y + 600);
  await page
    .getByRole("textbox", { name: "Drawing label text" })
    .fill("Exported draft label");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Export workspace");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const opened = await stageWorkspaceFile(
    await readFile(await (await downloading).path(), "utf8"),
  );
  assert(
    drawings(opened.document).some(
      (e) => e.mark.text === "Exported draft label",
    ),
  );
  assert.equal(drawings(opened.document).length, 9);
  opened.dispose();
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Drawing browser: mouse shapes, stylus pressure, connectors, drag/cancel/resize/lasso, labels, eraser, Undo/Redo and touch-safe local recovery pass.",
  );
} finally {
  await browser.close();
}
