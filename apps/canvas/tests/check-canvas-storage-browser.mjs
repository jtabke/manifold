import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { canvasDatabaseName } from "../src/regions/app/canvasLocalStore.ts";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  readWorkspace,
  readWorkspaceBytes,
  startWriting,
} from "./browser-workspace.mjs";
const fixture = readFileSync(
  new URL("./canvas-v2.fixture.json", import.meta.url),
  "utf8",
);
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310",
  key = "manifold.artifact-experiment.v1";
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    a = await context.newPage();
  a.setDefaultTimeout(10000);
  a.on("pageerror", (e) => errors.push(e.message));
  await a.addInitScript((text) => {
    if (!localStorage.getItem("manifold.artifact-experiment.v1"))
      localStorage.setItem("manifold.artifact-experiment.v1", text);
  }, fixture);
  await a.goto(base);
  await expect(a.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  expect(await a.evaluate((key) => localStorage.getItem(key), key)).toBe(
    fixture,
    "migration preserves legacy recovery bytes",
  );
  const before = await readWorkspaceBytes(a),
    generation = JSON.parse(before).head.generation;
  const b = await context.newPage();
  b.setDefaultTimeout(10000);
  b.on("pageerror", (e) => errors.push(e.message));
  await b.goto(base);
  await expect(b.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  expect(JSON.parse(await readWorkspaceBytes(b)).head.generation).toBe(
    generation,
    "read-only recovery does not publish a new generation",
  );
  const write = async (page, text) => {
    await startWriting(page);
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    await editor.fill(text);
    await editor.press("Escape");
  };
  await write(a, "First writer keeps this");
  await expect(a.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  const accepted = await readWorkspaceBytes(a);
  await write(b, "Second writer remains in memory");
  await expect(b.getByText(/Another tab saved a newer version/)).toBeVisible();
  await expect(b.getByLabel("Workspace save status")).toHaveText(
    "Local save needs attention",
  );
  expect(await readWorkspaceBytes(b)).toBe(
    accepted,
    "losing writer does not change any durable byte",
  );
  await b
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await b
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Save workspace file");
  const event = b.waitForEvent("download");
  await b
    .getByRole("button", { name: "Save workspace file", exact: true })
    .click();
  const download = await event,
    exported = await decodeWorkspace(
      await readFile(await download.path(), "utf8"),
    );
  expect(
    exported.page.regions.some(
      (r) => r.text === "Second writer remains in memory",
    ),
  ).toBe(true);
  expect(
    (await readWorkspace(a)).page.regions.some(
      (r) => r.text === "Second writer remains in memory",
    ),
  ).toBe(false);
  await b.close();
  // Corrupting the current record must not cause fallback to the older legacy backup.
  const name = await canvasDatabaseName(key);
  await a.evaluate(async (name) => {
    const db = await new Promise((resolve, reject) => {
      const q = indexedDB.open(name, 2);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["head", "packages"], "readwrite");
        const q = tx.objectStore("head").get("current");
        q.onsuccess = () =>
          tx.objectStore("packages").put("{}", q.result.package);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, name);
  const corrupt = await readWorkspaceBytes(a);
  await a.reload();
  await expect(
    a.getByText(/Saved workspace could not be opened:/),
  ).toBeVisible();
  await expect(a.locator(".er-region")).toHaveCount(0);
  expect(await readWorkspaceBytes(a)).toBe(corrupt);
  expect(await a.evaluate((key) => localStorage.getItem(key), key)).toBe(
    fixture,
  );
  expect(errors).toEqual([]);
  await context.close();
  for (const unavailable of [false, true]) {
    const missing = await browser.newContext();
    const page = await missing.newPage();
    await page.addInitScript(
      ({ key, fixture, unavailable }) => {
        localStorage.setItem(key, fixture);
        localStorage.setItem(key + ".indexed-primary.v1", "1");
        if (unavailable)
          indexedDB.open = () => {
            throw Error("Injected unavailable primary");
          };
      },
      { key, fixture, unavailable },
    );
    await page.goto(base);
    await expect(
      page.getByText(
        unavailable
          ? /Local storage is unavailable:|Local save failed/
          : /Saved primary storage is missing/,
      ),
    ).toBeVisible();
    await expect(page.locator(".er-region")).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      fixture,
      "missing or unavailable primary never adopts an older marked backup",
    );
    await missing.close();
  }
  console.log(
    "IndexedDB canvas: legacy migration preserves backup bytes, read-only Open does not write, two tabs detect CAS conflicts and preserve exportable work, and corrupt, missing or unavailable primary data never falls back silently.",
  );
} finally {
  await browser.close();
}
