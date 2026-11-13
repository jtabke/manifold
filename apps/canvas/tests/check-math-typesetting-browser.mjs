import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const cases = [
  ["root", "sqrt(9 m^2)", "msqrt", "3 m"],
  ["nested", "sqrt(1 + sqrt(16))/sqrt(5)", "mfrac > mrow > msqrt", "1"],
  ["absolute", "abs(-3)", "mo", "3"],
  ["exponential", "exp(1 + 2)", "msup", "20.0855"],
  ["logarithm", "log10(100)", "msub", "2"],
  ["difference", "10-(3+2)", "mrow", "5"],
  ["negation", "-(3+2)", "mrow", "-5"],
  ["powerbase", "(2^3)^2", "msup > mrow msup", "64"],
  ["negativebase", "(-2)^2", "msup", "4"],
  ["negativepower", "-2^2", "msup", "-4"],
  ["exponentialbase", "exp(1)^2", "msup > mrow msup", "7.38906"],
  ["product", "(2+3)*4", "mrow", "20"],
  ["functions", "max(sin(30 deg),cos(60 deg))", "mi", "0.5"],
  ["fraction", "(1+2)/(3+4)", "mfrac", "0.428571"],
  [
    "longline",
    "sqrt(1+2+3+4+5+6+7+8+9+10+11+12+13+14+15+16+17+18+19+20)",
    "msqrt",
    "14.4914",
  ],
];
const fixture = {
  regions: cases.map(([name, body]) => ({
    id: name,
    text: `${name} = ${body}`,
    mathVersion: 2,
  })),
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  layout: {},
  plots: [],
  origin: { x: 70, y: 100 },
};
const session = new RegionSession(fixture);
const native = archive(session.native());
session.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  for (const width of [1440, 838]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles({
        name: "typesetting.manifold",
        mimeType: "application/json",
        buffer: Buffer.from(native),
      });
    const region = (id) => page.locator(`[data-region-id="${id}"]`);
    for (const [name, , selector, result] of cases) {
      await expect(
        region(name).locator(`math ${selector}`).first(),
      ).toBeAttached();
      await expect(page.locator(`[data-result-for="${name}"]`)).toContainText(
        result,
      );
    }
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check('26px "STIX Two Math"')),
    ).toBe(true);
    const text = async (id) =>
      (await region(id).locator("math").textContent())
        .replaceAll("⁡", "")
        .replace(":=", "=");
    expect(await text("difference")).toBe("difference=10−(3+2)");
    expect(await text("negation")).toBe("negation=−(3+2)");
    expect(await text("powerbase")).toBe("powerbase=(23)2");
    expect(await text("negativebase")).toBe("negativebase=(−2)2");
    expect(await text("negativepower")).toBe("negativepower=−22");
    expect(await text("exponentialbase")).toBe("exponentialbase=(e1)2");
    expect(await text("product")).toBe("product=(2+3)·4");
    expect(await text("absolute")).toBe("absolute=|−3|");
    await expect(region("root").locator("msqrt")).toHaveAttribute(
      "data-source-start",
      "7",
    );
    await expect(region("root").locator("msqrt")).toHaveAttribute(
      "data-source-end",
      "11",
    );
    await expect(
      region("root").locator("mi").filter({ hasText: /^m$/ }),
    ).toHaveAttribute("mathvariant", "normal");

    // Transformed notation still edits the original source, at the correct literal.
    const saved = (await readWorkspace(page)).page;
    const literal = region("root").getByRole("button", {
      name: "Edit value 9",
      exact: true,
    });
    await literal.dblclick({ position: { x: 1, y: 5 } });
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    await expect(editor).toHaveValue("root = sqrt(9 m^2)");
    expect(await editor.evaluate((e) => e.selectionStart)).toBe(
      "root = sqrt(".length,
    );
    await editor.fill("root = sqrt(16 m^2)");
    await editor.press("Escape");
    await expect(page.locator('[data-result-for="root"]')).toContainText("4 m");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator('[data-result-for="root"]')).toContainText("3 m");
    assert.deepEqual((await readWorkspace(page)).page, saved);

    // Check actual browser geometry at two zooms: tall notation fits its row,
    // following equations don't overlap, and the long-line result wraps below.
    for (let zoom = 0; zoom < 2; zoom++) {
      const boxes = await page
        .locator(".er-region:has(math)")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const row = node.getBoundingClientRect();
            const math = node.querySelector("math").getBoundingClientRect();
            const result = node
              .querySelector("[data-result-for]")
              ?.getBoundingClientRect();
            return {
              id: node.dataset.regionId,
              top: row.top,
              bottom: row.bottom,
              mathTop: math.top,
              mathBottom: math.bottom,
              mathRight: math.right,
              resultLeft: result?.left,
              resultTop: result?.top,
              resultBottom: result?.bottom,
            };
          }),
        );
      for (const box of boxes) {
        expect(box.mathTop).toBeGreaterThanOrEqual(box.top - 1);
        expect(box.mathBottom).toBeLessThanOrEqual(box.bottom + 1);
        if (box.resultLeft < box.mathRight)
          expect(box.resultTop).toBeGreaterThanOrEqual(box.mathBottom - 1);
      }
      for (let i = 1; i < boxes.length; i++)
        expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 1);
      await page.getByLabel("Zoom out", { exact: true }).click();
    }
    await page.reload();
    await expect(region("root").locator("msqrt")).toHaveCount(1);
    await expect(region("logarithm").locator("msub")).toHaveCount(1);
    assert.deepEqual((await readWorkspace(page)).page, saved);
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Math typesetting: radicals, functions, grouping, units, source editing/Undo, font loading, tall/long layout, zoom and reload pass at two viewport sizes.",
  );
} finally {
  await browser.close();
}
