import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { RegionSession } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
import { workspaceStorage } from "../src/regions/workspaceStorage.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310",
  s = new RegionSession(),
  csv = "gain,comment\n10,measured",
  dataset = s.importData("measured-gain.csv", csv, { x: 100, y: 550 });
s.quantityFromCell(dataset, 0, 0, "k", "N/mm", { x: 100, y: 110 });
const input = s.create({ x: 100, y: 240 });
s.write(input, "x := 1 mm");
const output = s.create({ x: 100, y: 370 });
s.write(output, "F := k*x");
const file = archive(s.native()),
  browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
const command = async (page, label) => {
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill(label);
  await page
    .locator(".er-palette")
    .getByRole("button", { name: label, exact: true })
    .click();
};
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "calculation.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(file),
  });
  await expect(page.locator('[data-result-for="F"]')).toContainText("10 N");
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  const key = workspaceStorage(
    "manifold.artifact-experiment.v1",
    new URL(page.url()).search,
  );
  await command(page, "Calculation history");
  const history = page.getByLabel("Calculation history", { exact: true });
  await expect(
    history.getByRole("button", { name: "Recent (0)", exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Keep current calculation", exact: true })
    .click();
  await expect(
    history.getByRole("button", { name: "Kept (1)", exact: true }),
  ).toBeVisible();
  await history.locator(".calculation-record > summary").click();
  await expect(
    history.locator("dd").filter({ hasText: /^10 N$/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  await captureEvidence(page, {
    path: `${tmpdir()}/manifold-kept-calculations-desktop.png`,
  });
  const original = (await readWorkspace(page, key)).page.calculations[0];
  await history
    .getByRole("button", { name: "Remove kept calculation", exact: true })
    .click();
  await expect(history.getByText("No kept calculations yet.")).toBeVisible();
  await history
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  await command(page, "Undo");
  await expect
    .poll(
      async () => (await readWorkspace(page, key)).page.calculations?.length,
    )
    .toBe(1);
  await page
    .locator(`[data-region-id="${input}"]`)
    .getByRole("button", { name: "Edit x", exact: true })
    .dblclick();
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await editor.fill("x := 2 mm");
  await editor.press("Escape");
  await expect(page.locator('[data-result-for="F"]')).toContainText("20 N");
  await command(page, "Calculation history");
  await history.getByRole("button", { name: /^Kept \(/ }).click();
  await history.locator(".calculation-record > summary").click();
  await expect(history.getByText("Earlier mathematics · Kept")).toBeVisible();
  await expect(
    history.locator("dd").filter({ hasText: /^10 N$/ }),
  ).toBeVisible();
  await history.getByRole("button", { name: /^Recent \(/ }).click();
  await history
    .getByRole("button", { name: "Clear recent calculations", exact: true })
    .click();
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  const before = await readWorkspaceBytes(page, key);
  await history
    .getByRole("button", { name: "Capture current calculation", exact: true })
    .click();
  await expect(
    history.getByRole("button", { name: "Recent (1)", exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Clear recent calculations", exact: true })
    .click();
  expect(await readWorkspaceBytes(page, key)).toBe(
    before,
    "temporary history does not publish a durable head",
  );
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.failCalculationSave = true;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === "head" &&
        key === "current" &&
        window.failCalculationSave
      )
        throw new DOMException("Injected quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await history
    .getByRole("button", { name: "Keep current calculation", exact: true })
    .click();
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Unsaved changes",
  );
  expect(await readWorkspaceBytes(page, key)).toBe(before);
  await expect(
    history.getByRole("button", { name: "Kept (2)", exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Close history", exact: true })
    .click();
  // Initiate a fresh export with the listener installed before its command.
  const event = page.waitForEvent("download");
  await command(page, "Save workspace file");
  const download = await event,
    bytes = await readFile(await download.path(), "utf8"),
    decoded = await decodeWorkspace(bytes);
  expect(JSON.parse(bytes).version).toBe(9);
  expect(
    decoded.page.calculations
      .map((c) => c.snapshot.values.F.value)
      .sort((a, b) => a - b),
  ).toEqual([10, 20]);
  expect(decoded.page.calculations[0].snapshot.time).toBe(
    original.snapshot.time,
  );
  const fresh = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    receiver = await fresh.newPage();
  receiver.setDefaultTimeout(10000);
  let executions = 0;
  receiver.on("request", (r) => {
    if (r.url().endsWith("/api/artifact-sample")) executions++;
  });
  receiver.on("pageerror", (e) => errors.push(e.message));
  await receiver.goto(base);
  await receiver
    .getByLabel("Open workspace file", { exact: true })
    .setInputFiles({
      name: "kept.manifold",
      mimeType: "application/json",
      buffer: Buffer.from(bytes),
    });
  await expect(receiver.locator('[data-result-for="F"]')).toContainText("20 N");
  await command(receiver, "Calculation history");
  const panel = receiver.getByLabel("Calculation history", { exact: true });
  await expect(
    panel.getByRole("button", { name: "Recent (0)", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Kept (2)", exact: true }),
  ).toBeVisible();
  await panel.locator(".calculation-record > summary").last().click();
  await panel
    .getByText("Definitions and source records", { exact: true })
    .last()
    .click();
  await panel
    .getByText("measured-gain.csv · row 1, column 1", { exact: true })
    .last()
    .click();
  await expect(panel.locator(".is-source-cell")).toHaveText("10");
  const sourceDownload = receiver.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download original CSV", exact: true })
    .click();
  expect(await readFile(await (await sourceDownload).path(), "utf8")).toBe(csv);
  const bounds = await panel.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(390);
  await captureEvidence(receiver, {
    path: `${tmpdir()}/manifold-kept-calculations-mobile.png`,
  });
  expect(executions).toBe(0);
  expect(errors).toEqual([]);
  await fresh.close();
  await context.close();
  console.log(
    "Calculation history Chrome: explicit Keep/Remove/Undo, earlier values after edits, temporary-only clear/capture, quota rollback/export, native V5 clean-browser source handoff/download and mobile inspection pass.",
  );
} finally {
  await browser.close();
}
