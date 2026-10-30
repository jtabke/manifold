import { chromium, expect } from "@playwright/test";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const enlarged = await camera();
  expect(enlarged.zoom).toBeCloseTo(start.zoom * Math.exp(0.4), 2);
  expect(await pinch(80)).toBe(false);
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
  expect(errors).toEqual([]);
  console.log(
    "Two-finger pan, bidirectional pointer-anchored pinch and pan after zoom passed.",
  );
} finally {
  await browser.close();
}
