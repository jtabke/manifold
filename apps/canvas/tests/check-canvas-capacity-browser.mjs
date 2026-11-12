import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as f from "@manifold/foundation";
import { canvasDatabaseName } from "../src/regions/app/canvasLocalStore.ts";
import {
  canvasSchemas,
  canvasMethods,
} from "../src/regions/app/canvasDocument.ts";
import { MAX_CANVAS_FILE_BYTES } from "../src/regions/app/canvasStorageBudget.ts";
import { legacyCapacitySnapshot } from "./capacity-fixture.mjs";
import { readWorkspaceBytes } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const old = await legacyCapacitySnapshot(),
  name = await canvasDatabaseName("manifold.artifact-experiment.v1");
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  const records = [...old.snapshot.records()];
  await page.evaluate(
    async ({ name, state, records }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction(
          ["head", "packages", "assets"],
          "readwrite",
        );
        for (const name of ["head", "packages", "assets"])
          transaction.objectStore(name).clear();
        for (const [store, key, value] of records)
          transaction.objectStore(store).put(value, key);
        const head = transaction.objectStore("head");
        head.put(state.head, "current");
        head.put(state.epoch, "epoch");
        head.put(state.revision, "revision");
        await new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    },
    { name, state: old.snapshot.state, records },
  );
  await page.reload();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Saved workspace could not be opened" }),
  ).toContainText("recovery budget");
  const before = await readWorkspaceBytes(page);
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export saved work", exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(
    "manifold-saved-workspace.manifold",
  );
  const text = await readFile(await download.path(), "utf8"),
    envelope = JSON.parse(text);
  const recovered = await f.decode(
    JSON.stringify(envelope.foundation),
    canvasSchemas,
    canvasMethods,
    f.webHash,
    { maxBytes: MAX_CANVAS_FILE_BYTES },
  );
  assert.equal(recovered.receipts.length, old.count);
  assert.equal(
    await readWorkspaceBytes(page),
    before,
    "rescue never overwrites or acknowledges the saved head",
  );
  const legacyContext = await browser.newContext(),
    legacy = await legacyContext.newPage();
  legacy.on("pageerror", (error) => errors.push(error.message));
  await legacy.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    text,
  );
  await legacy.goto(base);
  await expect(legacy.locator(".er-storage-error")).toBeVisible();
  const legacyDownload = legacy.waitForEvent("download");
  await legacy
    .getByRole("button", { name: "Export saved work", exact: true })
    .click();
  assert.equal(
    await readFile(await (await legacyDownload).path(), "utf8"),
    text,
    "unadopted backup rescue preserves the original bytes",
  );
  assert.equal(await readWorkspaceBytes(legacy), text);
  await legacyContext.close();
  expect(errors).toEqual([]);
  console.log(
    "Capacity Chrome: over-policy saved work blocks adoption, exports every validated receipt through the real rescue button, and preserves the exact IndexedDB head/bytes.",
  );
} finally {
  await browser.close();
}
