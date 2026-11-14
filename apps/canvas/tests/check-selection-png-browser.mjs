import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { readWorkspace } from "./browser-workspace.mjs";

const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.pngCopies = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async ([item]) => {
          const blob = await item.getType("image/png");
          window.pngCopies.push(
            Array.from(new Uint8Array(await blob.arrayBuffer())),
          );
          if (window.rejectPngCopy) throw new Error("Permission denied");
        },
      },
    });
  });
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  await page
    .locator(".er-canvas")
    .click({ position: { x: 250, y: 240 }, button: "right" });
  await page.getByRole("menuitem", { name: "Write here", exact: true }).click();
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  for (const text of ["P = F*v", "F = 20 N", "v = 3 m/s"]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  const power = page.locator('.er-region[data-kind="equation"]').first();
  const open = async (node = power) => {
    await node.click({ button: "right", position: { x: 150, y: 20 } });
  };
  const copy = async () => {
    const before = await page.evaluate(() => window.pngCopies.length);
    await page
      .getByRole("menuitem", { name: "Copy as PNG", exact: true })
      .click();
    await expect(page.locator(".er-message")).toHaveText(
      "Copied transparent PNG.",
    );
    await expect
      .poll(() => page.evaluate(() => window.pngCopies.length))
      .toBe(before + 1);
    await expect(page.locator(".er-message")).toHaveText(
      "Copied transparent PNG.",
    );
    return page.evaluate(async () => {
      const bytes = window.pngCopies.at(-1);
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let painted = 0,
        transparent = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i]) painted++;
        else transparent++;
      }
      return {
        width: image.width,
        height: image.height,
        corner: data[3],
        painted,
        transparent,
      };
    });
  };
  const before = (await readWorkspace(page)).page;
  await open();
  const single = await copy();
  expect(single.corner).toBe(0);
  expect(single.painted).toBeGreaterThan(200);
  expect(single.transparent).toBeGreaterThan(single.painted);
  expect(single.width).toBeLessThan(970); // trims the 485px interaction box at 2x
  expect((await readWorkspace(page)).page).toEqual(before);

  // Search uses the same selection and command, without changing normal Copy.
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  const search = page.getByRole("textbox", {
    name: "Search commands",
    exact: true,
  });
  await search.fill("copy png");
  await page.getByRole("button").filter({ hasText: "Copy as PNG" }).click();
  await expect.poll(() => page.evaluate(() => window.pngCopies.length)).toBe(2);

  // Export a natively skipped object without revealing or modifying its live
  // subtree. The raster clone must disable viewport culling, not capture a box.
  await open();
  await power.evaluate((node) => {
    node.style.setProperty("--canvas-object-width", `${node.clientWidth}px`);
    node.style.setProperty("--canvas-object-height", `${node.clientHeight}px`);
    node.dataset.canvasCull = "";
    node.dataset.canvasOffscreen = "";
    node.style.contentVisibility = "auto";
    node.closest(".er-canvas").scrollLeft += 20000;
  });
  await expect
    .poll(() =>
      power
        .locator(".er-math-line")
        .evaluate((node) =>
          node.checkVisibility({ contentVisibilityAuto: true }),
        ),
    )
    .toBe(false);
  const culled = await copy();
  expect(culled.painted).toBeGreaterThan(200);
  expect(Math.abs(culled.width - single.width)).toBeLessThanOrEqual(2);
  expect(await power.evaluate((node) => node.style.contentVisibility)).toBe(
    "auto",
  );
  expect((await readWorkspace(page)).page).toEqual(before);
  await power.evaluate((node) => {
    node.style.removeProperty("content-visibility");
    delete node.dataset.canvasCull;
    delete node.dataset.canvasOffscreen;
  });
  await power.scrollIntoViewIfNeeded();

  // A refused clipboard write downloads the same PNG, not a second render.
  await page.evaluate(() => {
    window.rejectPngCopy = true;
  });
  await open();
  const fallback = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Copy as PNG", exact: true })
    .click();
  expect((await fallback).suggestedFilename()).toBe("manifold-selection.png");
  await expect(page.locator(".er-message")).toHaveText(
    "Clipboard unavailable. Saved transparent PNG instead.",
  );
  await page.evaluate(() => {
    window.rejectPngCopy = false;
  });
  await open();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Save as PNG…", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("manifold-selection.png");

  // Raster resolution is independent of navigation zoom.
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await open();
  const zoomed = await copy();
  expect(Math.abs(zoomed.width - single.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(zoomed.height - single.height)).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();

  // Multiple objects retain spatial arrangement and exclude unrelated objects.
  const quantities = page.locator('.er-region[data-kind="quantity"]');
  await quantities
    .first()
    .click({ modifiers: ["Shift"], position: { x: 400, y: 20 } });
  await quantities
    .last()
    .click({ modifiers: ["Shift"], position: { x: 400, y: 20 } });
  await open(quantities.first());
  await expect(page.locator(".cam-subject")).toHaveText("2 selected");
  const multiple = await copy();
  expect(multiple.height).toBeGreaterThan(single.height);
  expect(multiple.corner).toBe(0);
  // A plot is exported by its view identity rather than its source equation.
  await open();
  await page
    .getByRole("menuitem", { name: "Plot response", exact: true })
    .click();
  const plot = page.getByLabel("Python response artifact", { exact: true });
  await expect(plot).toHaveAttribute("data-status", "current");
  await open(plot);
  const chart = await copy();
  expect(chart.width).toBeGreaterThan(single.width);
  expect(chart.height).toBeGreaterThan(single.height);
  expect(chart.corner).toBe(0);

  // Exercise the browser's real image clipboard as well as the permission mock.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => {
    delete navigator.clipboard;
  });
  await open();
  await page
    .getByRole("menuitem", { name: "Copy as PNG", exact: true })
    .click();
  await expect(page.locator(".er-message")).toHaveText(
    "Copied transparent PNG.",
  );
  expect(
    await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      return (await items[0].getType("image/png")).size;
    }),
  ).toBeGreaterThan(100);
  expect(errors).toEqual([]);
  console.log(
    "PNG export: transparent cropped 2x selection, multi-selection, search, file save, clipboard rejection fallback and unchanged document pass.",
  );
} finally {
  await browser.close();
}
