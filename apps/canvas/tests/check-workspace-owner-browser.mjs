import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile as readAsync } from "node:fs/promises";
import { decodeWorkspace, prepare } from "../src/regions/artifacts.ts";
import {
  readWorkspace,
  readWorkspaceBytes,
  revealRegionActions,
} from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const fixture = readFileSync(
  new URL("./canvas-v2.fixture.json", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((text) => {
    if (!localStorage.getItem("manifold.artifact-experiment.v1"))
      localStorage.setItem("manifold.artifact-experiment.v1", text);
  }, fixture);
  await page.goto(base);
  const artifact = page.getByLabel("Python response artifact", { exact: true });
  await expect(artifact).toHaveAttribute("data-status", "ready");
  await artifact
    .getByRole("button", { name: "Run Python", exact: true })
    .click();
  await expect(artifact).toHaveAttribute("data-status", "current");
  await expect
    .poll(async () => !!(await readWorkspace(page)).artifacts[0].receipt)
    .toBe(true);
  const initial = await readWorkspace(page),
    input = initial.artifacts[0].input;
  const raw = () => readWorkspaceBytes(page);
  const originalBytes = await raw();
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.failWorkspaceWrites = true;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === "head" &&
        key === "current" &&
        window.failWorkspaceWrites
      )
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await page
    .locator(`[data-region-id="${input}"]`)
    .click({ position: { x: 400, y: 25 } });
  await revealRegionActions(page);
  await page
    .getByRole("toolbar", { name: "Quantity x actions", exact: true })
    .locator('[data-command-id="quantity.vary"]')
    .click();
  const controls = page.getByLabel("Explore x", { exact: true }),
    value = controls.getByLabel("Exploration value x", { exact: true });
  await controls
    .getByLabel("Exploration maximum", { exact: true })
    .fill("0.003");
  await value.fill("0.002");
  await value.press("Enter");
  await expect(page.locator('[data-result-for="F"]')).toContainText("20 N");
  await controls
    .getByRole("button", { name: "Keep as alternative", exact: true })
    .click();
  await expect(controls).toHaveCount(0);
  await expect(artifact).toHaveAttribute("data-status", "current");
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Local save needs attention",
  );
  await expect(
    page.getByRole("button", { name: "Retry local save", exact: true }),
  ).toBeVisible();
  expect(await raw()).toBe(originalBytes);
  // Export uses the coherent accepted capture even while every local write fails.
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Save workspace file");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save workspace file", exact: true })
    .click();
  const download = await downloadEvent,
    exported = await readAsync(await download.path(), "utf8"),
    kept = await decodeWorkspace(exported);
  expect(kept.page.contexts).toHaveLength(2);
  expect(kept.artifacts[0].compareContext).toBe("original");
  expect(kept.artifacts[0].comparing).toBe(true);
  expect(await raw()).toBe(originalBytes);
  // A fresh reader receives the complete Keep, without executing loaded code.
  const receiverContext = await browser.newContext(),
    receiver = await receiverContext.newPage();
  let receiverRuns = 0;
  receiver.on("request", (r) => {
    if (r.url().endsWith("/api/artifact-sample")) receiverRuns++;
  });
  await receiver.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    exported,
  );
  await receiver.goto(base);
  await expect(receiver.locator('[data-result-for="F"]')).toContainText("20 N");
  const received = await readWorkspace(receiver);
  expect(received.artifacts[0].compareContext).toBe("original");
  expect(received.artifacts[0].comparing).toBe(true);
  expect(receiverRuns).toBe(0);
  await receiverContext.close();
  // Retry persists both halves, then one Undo restores both without deleting evidence.
  await page.evaluate(() => (window.failWorkspaceWrites = false));
  await page
    .getByRole("button", { name: "Retry local save", exact: true })
    .click();
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  const persisted = await readWorkspace(page);
  expect(persisted.page.contexts).toHaveLength(2);
  expect(persisted.artifacts[0].comparing).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-result-for="F"]')).toContainText("10 N");
  expect((await readWorkspace(page)).page.contexts).toHaveLength(1);
  expect((await readWorkspace(page)).artifacts[0].comparing).toBe(
    initial.artifacts[0].comparing,
  );
  await expect(artifact).toHaveAttribute("data-status", "current");
  // Hold a real response for changed inputs, Undo, then deliver it out of order.
  let release;
  await page.route(
    "**/api/artifact-sample",
    async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => {
        release = resolve;
      });
      try {
        await route.fulfill({ response });
      } catch {
        /* The abandoned request may already be cancelled. */
      }
    },
    { times: 1 },
  );
  await page.locator(`[data-region-id="${input}"] math`).dblclick();
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await expect(editor.locator("..")).toHaveAttribute("data-region-id", input);
  await editor.fill("x := 3 mm");
  await editor.press("Escape");
  await expect.poll(() => typeof release).toBe("function");
  await expect(page.locator('[data-result-for="F"]')).toContainText("30 N");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-result-for="F"]')).toContainText("10 N");
  release();
  await page.waitForLoadState("networkidle");
  await expect(artifact).toHaveAttribute("data-status", "current");
  const recovered = await readWorkspace(page);
  expect(recovered.artifacts[0].receipt.key).toBe(
    prepare(recovered.page, recovered.artifacts[0]).key,
  );
  expect(errors).toEqual([]);
  await context.close();
  console.log(
    "Workspace ownership: quota failure after Keep preserves previous bytes, exposes unsaved status, exports/reopens the whole operation, retries, undoes once and rejects an out-of-order sample after Undo.",
  );
} finally {
  await browser.close();
}
