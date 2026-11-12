import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { readWorkspace } from "./browser-workspace.mjs";
import { chromium, expect } from "@playwright/test";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const editor = page.getByLabel("Write an engineering region", { exact: true });
const saved = () => readWorkspace(page);
try {
  // No feature flags, templates, model boundary, or prior workspace.
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "A page to think on." }),
  ).toBeVisible();
  await expect(page.locator(".er-region")).toHaveCount(0);
  await expect(page.locator(".workshop-guide")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Manifold Workshop", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Reveal layer", { exact: true })).toHaveCount(0);
  await captureEvidence(page, {
    path: new URL("../screenshots/blank-canvas-reset.png", import.meta.url)
      .pathname,
  });
  await page.keyboard.type("P = F*v");
  await expect(editor).toHaveValue("P = F*v");
  await editor.press("Enter");
  for (const text of ["F = 20 N", "v = 3 m/s", "Check the operating point"]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect((await saved()).page.models || []).toHaveLength(0);
  await page.reload();
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  await expect(
    page.getByText("Check the operating point", { exact: true }),
  ).toBeVisible();

  // Existing controls keep their normal keyboard behavior.
  await page.getByLabel("Page title", { exact: true }).fill("Power check");
  expect((await saved()).page.regions).toHaveLength(4);
  await page.getByLabel("Write equation or note", { exact: true }).click();
  await editor.fill("1+1");
  await editor.press("Escape");
  await expect(
    page.getByLabel("Inspect result expression", { exact: true }),
  ).toContainText("2");

  // File drop shares import semantics and retains original CSV records.
  const csv = "force [N],speed [m/s]\n20,3\n24,4";
  const transfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "measurements.csv", { type: "text/csv" }));
    return dt;
  }, csv);
  await page.locator(".er-canvas").dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: 700,
    clientY: 300,
  });
  await expect(
    page.getByLabel("Data source measurements.csv", { exact: true }),
  ).toBeVisible();
  expect((await saved()).page.regions.find((r) => r.data)?.data.csv).toBe(csv);
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".er-data")).toHaveCount(0);
  const csvInput = page.getByLabel("Import CSV file");
  const importFile = {
    name: "measurements.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  };
  await csvInput.setInputFiles(importFile);
  await expect(page.locator(".er-data")).toBeVisible();
  await expect(csvInput).toHaveValue("");
  expect((await saved()).page.regions.find((r) => r.data)?.data.csv).toBe(csv);
  // Reset after reading must still allow the same file to be chosen again.
  await page.getByLabel("Undo", { exact: true }).click();
  await expect(page.locator(".er-data")).toHaveCount(0);
  await csvInput.setInputFiles(importFile);
  await expect(page.locator(".er-data")).toBeVisible();
  await expect(csvInput).toHaveValue("");
  await page.reload();
  await expect(page.locator(".er-data")).toBeVisible();

  // Unsupported dropped files leave engineering work intact.
  const before = (await saved()).page.regions.length;
  const canvasBox = await page.locator(".er-canvas").boundingBox();
  const feedbackPoint = { x: canvasBox.x + 210, y: canvasBox.y + 210 };
  await page.mouse.move(feedbackPoint.x, feedbackPoint.y);
  const invalid = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["not data"], "notes.txt", { type: "text/plain" }));
    return dt;
  });
  await page
    .locator(".er-canvas")
    .dispatchEvent("drop", { dataTransfer: invalid });
  await expect(
    page.getByText("Choose a CSV file.", { exact: true }),
  ).toBeVisible();
  const notice = await page.locator(".er-message").boundingBox();
  expect(notice.x).toBeCloseTo(feedbackPoint.x, 0);
  expect(notice.y).toBeCloseTo(feedbackPoint.y + 8, 0);
  expect(notice.x + notice.width).toBeLessThanOrEqual(1440);
  expect((await saved()).page.regions).toHaveLength(before);
  // Starting fresh never replaces the original canvas or its name.
  const originalURL = page.url();
  await page.getByRole("button", { name: "New canvas", exact: true }).click();
  await expect(page).toHaveURL(/canvas=[a-f0-9-]{36}/);
  await expect(
    page.getByRole("heading", { name: "A page to think on." }),
  ).toBeVisible();
  await expect(page.locator(".er-region")).toHaveCount(0);
  await page.goto(originalURL);
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(
    "Power check",
  );
  expect(errors).toEqual([]);
  console.log(
    "Blank canvas: direct typing, calculation, notes, persistence, file drop/import, Undo, rejected files and independent canvas recovery pass.",
  );
} finally {
  await browser.close();
}
