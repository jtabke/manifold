import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { restore } from "../src/regions/artifacts.ts";
import {
  canvasLocalStore,
  canvasDatabaseName,
} from "../src/regions/app/canvasLocalStore.ts";
import { workspaceStorage } from "../src/regions/workspaceStorage.ts";
import {
  readWorkspace,
  readWorkspaceBytes,
  startWriting,
} from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const fixture = restore(
  readFileSync(new URL("./canvas-v2.fixture.json", import.meta.url), "utf8"),
);
const session = new RegionSession(
    fixture.page,
    () => [],
    fixture.document,
    fixture.artifacts,
  ),
  backend = f.memoryBackend(),
  store = canvasLocalStore(backend);
await store.load();
await store.save(session);
for (let i = 0; i < 40; i++) session.write("region-1", `k := ${10 + i} N/mm`);
await store.save(session);
const snapshot = await backend.snapshot(),
  search = `?canvas=${crypto.randomUUID()}`,
  key = workspaceStorage("manifold.artifact-experiment.v1", search),
  name = await canvasDatabaseName(key);
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await page.evaluate(
    async ({ name, state, records }) => {
      const db = await new Promise((resolve, reject) => {
        const q = indexedDB.open(name, 2);
        q.onupgradeneeded = () => {
          for (const s of ["head", "packages", "assets"])
            q.result.createObjectStore(s);
        };
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["head", "packages", "assets"], "readwrite");
        for (const [store, key, value] of records)
          tx.objectStore(store).put(value, key);
        for (const [key, value] of Object.entries({
          current: state.head,
          epoch: state.epoch,
          revision: state.revision,
        }))
          tx.objectStore("head").put(value, key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { name, state: snapshot.state, records: [...snapshot.records()] },
  );
  await page.goto(base + search);
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  await expect(page.locator('[data-result-for="F"]')).toContainText("49 N");
  const raw = () => readWorkspaceBytes(page, key),
    before = await raw();
  const open = async () => {
    await page
      .getByRole("button", { name: "Search objects and commands", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search commands", exact: true })
      .fill("Review workspace cleanup");
    await page
      .getByRole("button", { name: "Review workspace cleanup", exact: true })
      .click();
    return page.getByRole("dialog", { name: "Workspace cleanup", exact: true });
  };
  let dialog = await open();
  await expect(
    dialog.getByRole("button", { name: "Clean history and save", exact: true }),
  ).toBeEnabled();
  await captureEvidence(page, {
    path: `${tmpdir()}/manifold-cleanup-desktop.png`,
  });
  await dialog
    .getByRole("button", { name: "Close", exact: true })
    .press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await raw()).toBe(before, "Cancel writes nothing");
  dialog = await open();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put,
      remove = IDBObjectStore.prototype.delete;
    window.failCleanupSave = true;
    window.failCleanupDelete = false;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "head" && key === "current" && window.failCleanupSave)
        throw new DOMException("Injected quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
    IDBObjectStore.prototype.delete = function (key) {
      if (this.name === "packages" && window.failCleanupDelete)
        throw Error("Injected cleanup interruption");
      return remove.call(this, key);
    };
  });
  await dialog
    .getByRole("button", { name: "Clean history and save", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Current work could not be saved",
  );
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Local save needs attention",
  );
  expect(await raw()).toBe(
    before,
    "Failed Save cannot trigger physical deletion",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Remove obsolete saved data",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.failCleanupSave = false;
  });
  await dialog
    .getByRole("button", { name: "Save and review stored data", exact: true })
    .click();
  const remove = dialog.getByRole("button", {
    name: "Remove obsolete saved data",
    exact: true,
  });
  await expect(remove).toBeEnabled();
  const saved = await raw(),
    savedData = JSON.parse(saved);
  expect(savedData.packages.length).toBeGreaterThan(100);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(390);
  await captureEvidence(page, {
    path: `${tmpdir()}/manifold-cleanup-mobile.png`,
  });
  await page.evaluate(() => {
    window.failCleanupDelete = true;
  });
  await remove.click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Injected cleanup interruption",
  );
  expect(await raw()).toBe(
    saved,
    "Failed reclaim rolls back every durable byte and storage clock",
  );
  await page.evaluate(() => {
    window.failCleanupDelete = false;
  });
  await remove.click();
  await expect(
    dialog.getByText(/Removed .* obsolete saved data/),
  ).toBeVisible();
  const after = JSON.parse(await raw());
  expect(after.head).toEqual(
    savedData.head,
    "Physical cleanup preserves the exact saved head",
  );
  expect(after.epoch).toBe(savedData.epoch + 1);
  expect(after.packages.length).toBeLessThan(savedData.packages.length);
  expect((await readWorkspace(page, key)).document.revisions.size).toBeLessThan(
    session.document.revisions.size,
  );
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startWriting(page);
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await editor.fill("Saved after cleanup epoch");
  await editor.press("Escape");
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  await page.reload();
  await expect(
    page.getByText("Saved after cleanup epoch", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-result-for="F"]')).toContainText("49 N");
  expect(errors).toEqual([]);
  await context.close();
  console.log(
    "Canvas cleanup Chrome: explicit review/Cancel, quota failure before reclamation, exact rollback on deletion failure, unchanged saved head, reduced durable records, mobile dialog and post-epoch Save/reload pass.",
  );
} finally {
  await browser.close();
}
