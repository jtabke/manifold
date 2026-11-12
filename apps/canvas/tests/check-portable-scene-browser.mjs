import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { readScene, SCENE_ITEM } from "../src/regions/sceneRecords.ts";
import { current } from "@manifold/foundation";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const { session } = await sceneFixture(8, true);
const source = archive(session.native());
session.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
let debugPage;
try {
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1100 },
  });
  const page = await context.newPage();
  debugPage = page;
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((text) => {
    const key = "manifold.artifact-experiment.v1";
    if (!localStorage.getItem(key)) localStorage.setItem(key, text);
  }, source);
  await page.goto(base);
  const original = await readWorkspace(page);
  assert.equal(readScene(original.document).tools.length, 8);
  // Attention starts at the root; an authored named view can explicitly navigate.
  await expect(
    page.getByLabel("Model Scene model", { exact: true }),
  ).toBeVisible();
  const chooseView = async (p) => {
    await p
      .getByRole("button", { name: "Canvas viewpoints", exact: true })
      .click();
    await p
      .getByRole("button", { name: "Working layout", exact: true })
      .click();
    await expect(
      p.getByRole("navigation", { name: "Model hierarchy" }),
    ).toContainText("Scene model");
    await expect
      .poll(() =>
        p.locator(".er-canvas").evaluate((node) => ({
          x: node.scrollLeft - Number(node.dataset.canvasOriginX || 0),
          y: node.scrollTop - Number(node.dataset.canvasOriginY || 0),
        })),
      )
      .toEqual({ x: 0, y: 0 });
  };
  await chooseView(page);
  const tool = page.locator('[data-tool-id="tool-scene-0"]');
  await expect(tool).toBeVisible();
  const baseline = await readWorkspace(page);
  const durable = await readWorkspaceBytes(page);
  const grip = await tool
    .getByRole("button", { name: "Move canvas tool", exact: true })
    .boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 100, grip.y + 100, { steps: 12 });
  assert.equal(
    await readWorkspaceBytes(page),
    durable,
    "pointer movement is preview only",
  );
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        current(
          (await readWorkspace(page)).document,
          "canvas:scene:tool:tool-scene-0",
        ).id,
    )
    .not.toBe(current(baseline.document, "canvas:scene:tool:tool-scene-0").id);
  const moved = await readWorkspace(page);
  assert.equal(
    moved.document.revisions.size,
    baseline.document.revisions.size + 1,
  );
  assert.equal(
    current(moved.document, SCENE_ITEM).id,
    current(baseline.document, SCENE_ITEM).id,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(
      async () => readScene((await readWorkspace(page)).document).tools[0].at,
    )
    .toEqual(readScene(baseline.document).tools[0].at);
  // Resize cancellation, including the start before the first move, publishes nothing.
  const settled = await readWorkspaceBytes(page);
  const resize = await tool
    .getByRole("button", { name: "Resize canvas tool", exact: true })
    .boundingBox();
  await page.mouse.move(resize.x + 3, resize.y + 3);
  await page.mouse.down();
  await page.mouse.move(resize.x + 80, resize.y + 60, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(await readWorkspaceBytes(page), settled);
  const beforeResize = await readWorkspace(page);
  const corner = await tool
    .getByRole("button", { name: "Resize canvas tool", exact: true })
    .boundingBox();
  await page.mouse.move(corner.x + 3, corner.y + 3);
  await page.mouse.down();
  await page.mouse.move(corner.x + 80, corner.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        readScene((await readWorkspace(page)).document).tools[0].width,
    )
    .toBeGreaterThan(450);
  assert.equal(
    (await readWorkspace(page)).document.revisions.size,
    beforeResize.document.revisions.size + 1,
  );
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(
      async () =>
        readScene((await readWorkspace(page)).document).tools[0].width,
    )
    .toBe(450);
  await tool
    .getByRole("button", { name: "Move canvas tool", exact: true })
    .hover();
  await tool
    .getByRole("button", { name: "Close canvas tool", exact: true })
    .click();
  await expect(tool).toHaveCount(0);
  await chooseView(page);
  await expect(tool).toBeVisible();
  assert.deepEqual(
    readScene((await readWorkspace(page)).document),
    readScene(baseline.document),
  );
  // Export through the real command and import into an independent browser store.
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Save workspace file");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save workspace file", exact: true })
    .click();
  const bytes = await readFile(await (await downloading).path(), "utf8");
  const portable = await decodeWorkspace(bytes);
  assert.deepEqual(readScene(portable.document), readScene(baseline.document));
  const recipient = await browser.newContext({
    viewport: { width: 1800, height: 1100 },
  });
  const fresh = await recipient.newPage();
  fresh.on("pageerror", (error) => errors.push(error.message));
  let jobs = 0;
  fresh.on("request", (r) => {
    if (r.url().endsWith("/api/artifact-sample")) jobs++;
  });
  await fresh.goto(base);
  await fresh.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "shared-scene.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(bytes),
  });
  await fresh.waitForURL(/\?canvas=/);
  await expect(
    fresh.getByLabel("Model Scene model", { exact: true }),
  ).toBeVisible();
  await chooseView(fresh);
  await expect(fresh.locator('[data-tool-id="tool-scene-0"]')).toBeVisible();
  const key = `manifold.artifact-experiment.v1.canvas-${new URL(fresh.url()).searchParams.get("canvas")}`;
  const loaded = await readWorkspace(fresh, key);
  assert.deepEqual(readScene(loaded.document), readScene(portable.document));
  assert.equal(loaded.artifacts[0].receipt.points.length, 201);
  assert.equal(jobs, 0);
  await fresh.reload();
  await expect(fresh.locator('[data-tool-id="tool-scene-0"]')).toBeVisible();
  assert.equal(jobs, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Portable scene browser: named model navigation, preview/one-edit Undo, resize cancellation, close/restore and fresh recipient native/local recovery pass.",
  );
} catch (error) {
  await debugPage?.screenshot({ path: "/tmp/manifold-scene-failure.png" });
  throw error;
} finally {
  await browser.close();
}
