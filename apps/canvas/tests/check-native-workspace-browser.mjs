import { browserOptions } from "../../../scripts/browser.mjs";
import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { RegionSession } from "../src/regions/document.ts";
import {
  archive,
  makeArtifact,
  decodeWorkspace,
} from "../src/regions/artifacts.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const s = new RegionSession(),
  ids = [];
for (const text of ["P = F*v", "F = 20 N", "v = 3 m/s"]) {
  const id = s.create();
  s.write(id, text);
  ids.push(id);
}
const dataset = s.importData(
  "measurements.csv",
  "force [N],speed [m/s]\n20,3\n24,4",
  {
    x: 100,
    y: 650,
  },
);
const measured = s.quantityFromCell(dataset, 0, 1, "observed_speed", "m/s", {
  x: 400,
  y: 650,
});
s.write(ids[0], "P = F*observed_speed");
const artifact = makeArtifact(
  s.state,
  ids[0],
  "Plot P versus F from 1 to 40 N",
);
artifact.at = { x: 700, y: 120 };
const legacy = legacyWorkspace(s.state, [artifact]);
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  let executions = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/artifact-sample") &&
      request.method() === "POST"
    )
      executions++;
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "Write equation or note", exact: true })
    .click();
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await editor.fill("Keep this previous work");
  await editor.press("Escape");
  const previous = await readWorkspace(page);
  const originalURL = page.url();
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "shared.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(legacy),
  });
  await page.waitForURL(/\?canvas=/);
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  const result = page.getByLabel("Python response artifact", { exact: true });
  await expect(result).toHaveAttribute("data-status", "ready");
  expect(executions).toBe(0);
  expect((await readWorkspace(page)).page).toEqual(previous.page);
  const search = new URL(page.url()).search;
  const key = `manifold.artifact-experiment.v1.canvas-${new URLSearchParams(search).get("canvas")}`;
  const opened = await readWorkspace(page, key);
  expect(opened.document).toBeTruthy();
  expect(opened.page).toEqual(s.state);
  await result.getByRole("button", { name: "Run Python", exact: true }).click();
  await expect(result).toHaveAttribute("data-status", "current");
  expect(executions).toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        (await readWorkspace(page, key)).artifacts[0].receipt?.points.length,
    )
    .toBe(201);
  const receipt = (await readWorkspace(page, key)).artifacts[0].receipt;
  expect(receipt.snapshot).toBe(2);
  expect(receipt.sources[0].region).toBe(measured);
  expect(receipt.definitions.some((r) => r.id === dataset || "data" in r)).toBe(
    false,
  );
  const ran = executions;
  await page.reload();
  await expect(result).toHaveAttribute("data-status", "current");
  expect(executions).toBe(ran);
  expect((await readWorkspace(page, key)).artifacts[0].receipt.time).toBe(
    receipt.time,
  );
  // Export uses the real application command and opens in an isolated browser.
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Export workspace");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("manifold-workspace.manifold");
  const bytes = await readFile(await download.path(), "utf8");
  expect(JSON.parse(bytes).version).toBe(8);
  expect((await decodeWorkspace(bytes)).document.document).toBe(
    opened.document.document,
  );
  expect((await decodeWorkspace(bytes)).artifacts[0].receipt.sources).toEqual(
    receipt.sources,
  );
  const fresh = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const receiver = await fresh.newPage();
  let receiverRuns = 0;
  receiver.on("request", (r) => {
    if (r.url().endsWith("/api/artifact-sample")) receiverRuns++;
  });
  await receiver.goto(base);
  await receiver
    .getByLabel("Open workspace file", { exact: true })
    .setInputFiles({
      name: "portable.manifold",
      mimeType: "application/json",
      buffer: Buffer.from(bytes),
    });
  await receiver.waitForURL(/\?canvas=/);
  await expect(
    receiver.getByLabel("Python response artifact", { exact: true }),
  ).toHaveAttribute("data-status", "current");
  expect(receiverRuns).toBe(0);
  // Invalid files leave the current root, URL, and saved bytes intact.
  const retainedURL = page.url(),
    retained = await readWorkspaceBytes(page, key);
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "broken.manifold",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":900}'),
  });
  await expect(page.getByText(/Could not open workspace:/)).toBeVisible();
  expect(page.url()).toBe(retainedURL);
  expect(await readWorkspaceBytes(page, key)).toBe(retained);
  // A read begun before typing cannot replace the newer draft.
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      const file = this;
      return new Promise((resolve) => {
        window.releaseWorkspaceRead = async () => {
          File.prototype.text = original;
          resolve(await original.call(file));
        };
      });
    };
  });
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "waiting.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(bytes),
  });
  await page
    .getByRole("button", { name: "Write equation or note", exact: true })
    .click();
  await editor.fill("A newer draft must survive");
  await page.evaluate(() => window.releaseWorkspaceRead());
  await expect(
    page.getByText(/Work changed while reading the file/),
  ).toBeVisible();
  await expect(editor).toHaveValue("A newer draft must survive");
  expect(page.url()).toBe(retainedURL);
  await editor.press("Escape");
  // Failed destination writes keep this canvas selected and its current work saved.
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "head" && key === "current")
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "no-space.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByText(/Could not open workspace: Quota exceeded/),
  ).toBeVisible();
  expect(page.url()).toBe(retainedURL);
  expect(
    (await readWorkspace(page, key)).page.regions.some(
      (r) => r.text === "A newer draft must survive",
    ),
  ).toBe(true);
  await page.goto(originalURL);
  await expect(
    page.getByText("Keep this previous work", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await fresh.close();
  await context.close();
  console.log(
    "Native workspace: legacy migration, isolated Open, preserved prior work, explicit execution, verified receipt recovery, download and fresh-browser handoff pass.",
  );
} finally {
  await browser.close();
}
