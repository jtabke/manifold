import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readWorkspace } from "./browser-workspace.mjs";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1700, height: 1100 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "Write equation or note", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByLabel("Search commands", { exact: true })
    .fill("Create reusable model");
  await page
    .getByRole("button", { name: "Create reusable model", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Create reusable model" });
  await expect(editor).toBeVisible();
  await editor.getByLabel("Model name", { exact: true }).fill("Drive");
  await editor.getByLabel("Model equation 1", { exact: true }).fill("F = 20 N");
  await editor.getByLabel("Expose F input", { exact: true }).check();
  await editor
    .getByRole("button", { name: "Add model equation", exact: true })
    .click();
  await editor
    .getByLabel("Model equation 2", { exact: true })
    .fill("v = 3 m/s");
  await editor.getByLabel("Expose v input", { exact: true }).check();
  await editor
    .getByRole("button", { name: "Add model equation", exact: true })
    .click();
  await editor.getByLabel("Model equation 3", { exact: true }).fill("P = F*v");
  await editor.getByLabel("Expose P output", { exact: true }).check();
  const blank = new RegionSession();
  const incoming = archive(blank.native());
  blank.dispose();
  const currentURL = page.url();
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "blank.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(incoming),
  });
  await expect(editor.getByRole("alert")).toContainText(
    "Publish this definition or cancel",
  );
  assert.equal(page.url(), currentURL);
  await expect(
    editor.getByLabel("Model equation 3", { exact: true }),
  ).toHaveValue("P = F*v");
  await editor
    .getByRole("button", { name: "Publish and insert model", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const cards = page.locator('.im-card[data-comparison="false"]');
  const a = page.getByLabel("Drive model", { exact: true });
  await expect(a.getByLabel("Model P", { exact: true })).toContainText("60 W");
  await a
    .getByRole("button", { name: "Duplicate instance", exact: true })
    .click();
  await expect(cards).toHaveCount(2);
  const b = page.getByLabel("Drive copy model", { exact: true });
  const speed = b.getByRole("spinbutton", {
    name: "Drive copy v",
    exact: true,
  });
  await speed.fill("4");
  await speed.press("Enter");
  await expect(b.getByLabel("Model P", { exact: true })).toContainText("80 W");
  await expect(a.getByLabel("Model P", { exact: true })).toContainText("60 W");
  await a.getByRole("button", { name: "Compute model", exact: true }).click();
  await expect(a.locator(".im-status")).toContainText("current");
  await a
    .getByRole("button", { name: "Edit model definition", exact: true })
    .click();
  const revision = page.getByRole("dialog", {
    name: "Revise model definition",
  });
  await revision
    .getByLabel("Model equation 3", { exact: true })
    .fill("P = 2*F*v");
  await revision
    .getByRole("button", { name: "Publish model revision", exact: true })
    .click();
  await expect(a.getByLabel("Model P", { exact: true })).toContainText("60 W");
  await a
    .getByRole("button", { name: "Review definition update", exact: true })
    .click();
  await expect(
    a.getByRole("region", { name: "Definition update review" }),
  ).toBeVisible();
  await expect(
    a.getByLabel("Model definition changes", { exact: true }),
  ).toContainText("P = F*v → P = 2*F*v");
  await a
    .getByRole("button", { name: "Accept definition update", exact: true })
    .click();
  await expect(a.getByLabel("Model P", { exact: true })).toContainText("120 W");
  await expect(b.getByLabel("Model P", { exact: true })).toContainText("80 W");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(a.getByLabel("Model P", { exact: true })).toContainText("60 W");
  // Invalid revisions preserve the document and editable proposal.
  const before = (await readWorkspace(page)).document.id;
  await a
    .getByRole("button", { name: "Edit model definition", exact: true })
    .click();
  await revision
    .getByLabel("Model equation 3", { exact: true })
    .fill("P = F + v");
  await revision
    .getByRole("button", { name: "Publish model revision", exact: true })
    .click();
  await expect(revision.getByRole("alert")).toContainText("Units");
  assert.equal((await readWorkspace(page)).document.id, before);
  await revision
    .getByRole("button", { name: "Cancel model editing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByLabel("Search commands", { exact: true })
    .fill("Export workspace");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const text = await readFile(await (await download).path(), "utf8");
  const verified = await stageWorkspaceFile(text);
  assert.equal(verified.computations.diagnostics().running, 0);
  verified.dispose();
  const recipient = await browser.newContext({
    viewport: { width: 1700, height: 1100 },
  });
  const fresh = await recipient.newPage();
  let jobs = 0;
  fresh.on("request", (r) => {
    if (r.url().endsWith("/api/artifact-sample")) jobs++;
  });
  await fresh.goto(base);
  await fresh.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "drive.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(fresh.locator('.im-card[data-comparison="false"]')).toHaveCount(
    2,
  );
  await expect(
    fresh
      .getByLabel("Drive model", { exact: true })
      .getByLabel("Model P", { exact: true }),
  ).toContainText("60 W");
  await fresh.reload();
  await expect(fresh.locator('.im-card[data-comparison="false"]')).toHaveCount(
    2,
  );
  assert.equal(jobs, 0);
  assert.deepEqual(errors, []);
  await recipient.close();
  await context.close();
  console.log(
    "Authored model browser: blank authoring, independent duplicate, general-unit computation, pinned revision/review/Undo, invalid draft preservation and fresh native/local continuation pass.",
  );
} finally {
  await browser.close();
}
