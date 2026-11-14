import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.goto(base);
  const canvas = page.locator(".er-canvas");
  await expect(canvas).toBeVisible();
  const camera = () =>
    canvas.evaluate((node) => ({
      x: node.scrollLeft - Number(node.dataset.canvasOriginX || 0),
      y: node.scrollTop - Number(node.dataset.canvasOriginY || 0),
      zoom:
        Number(
          document.querySelector(".er-zoom").textContent.match(/(\d+)%/)[1],
        ) / 100,
    }));
  const bounds = await canvas.boundingBox();
  const anchor = { x: bounds.width * 0.4, y: bounds.height * 0.4 };
  await page.mouse.move(bounds.x + anchor.x, bounds.y + anchor.y);
  const before = await camera();
  // Real wheel input uses the same pixel deltas as two-finger trackpad scrolling.
  await page.mouse.wheel(73, 119);
  await expect
    .poll(async () => (await camera()).y)
    .toBeCloseTo(before.y + 119, 0);
  let after = await camera();
  expect(after.x).toBeCloseTo(before.x + 73, 0);
  expect(after.zoom).toBe(before.zoom);
  await page.mouse.wheel(-31, -57);
  await expect
    .poll(async () => (await camera()).y)
    .toBeCloseTo(after.y - 57, 0);
  expect((await camera()).zoom).toBe(before.zoom);

  // Chromium exposes trackpad pinch as Ctrl+wheel. Verify both directions,
  // pointer anchoring, and cancellation of the browser's page zoom.
  const pinch = (deltaY) =>
    canvas.evaluate(
      (node, { deltaY, anchor }) => {
        const rect = node.getBoundingClientRect();
        return node.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY,
            clientX: rect.left + anchor.x,
            clientY: rect.top + anchor.y,
          }),
        );
      },
      { deltaY, anchor },
    );
  const start = await camera();
  expect(await pinch(-40)).toBe(false);
  await expect
    .poll(async () => (await camera()).zoom)
    .toBeCloseTo(start.zoom * Math.exp(0.4), 2);
  const enlarged = await camera();
  expect(enlarged.zoom).toBeCloseTo(start.zoom * Math.exp(0.4), 2);
  expect(await pinch(80)).toBe(false);
  await expect
    .poll(async () => (await camera()).zoom)
    .toBeCloseTo(start.zoom * Math.exp(-0.4), 2);
  const reduced = await camera();
  expect(reduced.zoom).toBeCloseTo(start.zoom * Math.exp(-0.4), 2);
  // Zoom text is rounded to whole percentages; allow that precision here.
  for (const state of [enlarged, reduced]) {
    expect(
      Math.abs(
        (state.x + anchor.x) / state.zoom - (start.x + anchor.x) / start.zoom,
      ),
    ).toBeLessThan(6);
    expect(
      Math.abs(
        (state.y + anchor.y) / state.zoom - (start.y + anchor.y) / start.zoom,
      ),
    ).toBeLessThan(6);
  }
  after = await camera();
  await page.mouse.wheel(21, 35);
  await expect
    .poll(async () => (await camera()).y)
    .toBeCloseTo(after.y + 35, 0);
  expect((await camera()).zoom).toBe(after.zoom);

  // Real two-contact input must accumulate both scale and center movement
  // correctly while several pointer events share one queued display frame.
  await page.keyboard.press("ControlOrMeta+0");
  await expect.poll(async () => (await camera()).zoom).toBe(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const touchBefore = await camera();
  const cdp = await page.context().newCDPSession(page);
  const center = {
    x: Math.round(bounds.x + anchor.x),
    y: Math.round(bounds.y + anchor.y),
  };
  const contacts = (distance, dy) =>
    [-1, 1].map((side, i) => ({
      x: center.x + (side * distance) / 2,
      y: center.y + dy,
      id: i + 1,
    }));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: contacts(200, 0),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: contacts(220, 10),
  });
  await expect
    .poll(async () => {
      await page.clock.runFor(17);
      return (await camera()).zoom;
    })
    .toBeCloseTo(1.1, 2);
  const beforeRotation = await camera();
  // Rotate one contact through a 3-4-5 triangle: distance stays exactly 220,
  // but the center moves. A retained zoom preview must display that pan too.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: center.x - 66, y: center.y + 142, id: 1 },
      { x: center.x + 110, y: center.y + 10, id: 2 },
    ],
  });
  await expect
    .poll(async () => {
      await page.clock.runFor(17);
      return (await camera()).x;
    })
    .toBeCloseTo(beforeRotation.x - 22, 0);
  const rotated = await camera();
  expect(rotated.zoom).toBe(beforeRotation.zoom);
  expect(rotated.x).toBeCloseTo(beforeRotation.x - 22, 0);
  expect(rotated.y).toBeCloseTo(beforeRotation.y - 66, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.clock.runFor(34);
  await expect.poll(async () => (await camera()).zoom).toBeCloseTo(1.1, 2);
  const touchAfter = await camera();
  expect((touchAfter.x + anchor.x + 22) / touchAfter.zoom).toBeCloseTo(
    touchBefore.x + anchor.x,
    0,
  );
  expect((touchAfter.y + anchor.y + 76) / touchAfter.zoom).toBeCloseTo(
    touchBefore.y + anchor.y,
    0,
  );
  await cdp.detach();
  // Middle-button panning can overlap a wheel zoom without restoring the old
  // camera or dropping a movement that follows the preview frame.
  await page.mouse.move(center.x, center.y);
  await page.mouse.down({ button: "middle" });
  await pinch(-1);
  await page.clock.runFor(17);
  const chordBefore = await camera();
  await page.mouse.move(center.x + 30, center.y + 20);
  await expect
    .poll(async () => {
      await page.clock.runFor(17);
      return (await camera()).x;
    })
    .toBeCloseTo(chordBefore.x - 30, 0);
  const chordAfter = await camera();
  expect(chordAfter.zoom).toBe(chordBefore.zoom);
  expect(chordAfter.x).toBeCloseTo(chordBefore.x - 30, 0);
  expect(chordAfter.y).toBeCloseTo(chordBefore.y - 20, 0);
  await page.mouse.up({ button: "middle" });
  await page.clock.runFor(400);
  await page.clock.resume();
  expect(errors).toEqual([]);
  console.log(
    "Two-finger pan, bidirectional pointer-anchored wheel/pinch, two-contact touch zoom and pan after zoom passed.",
  );
} finally {
  await browser.close();
}
