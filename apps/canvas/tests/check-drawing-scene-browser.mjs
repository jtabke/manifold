import { browserOptions } from "../../../scripts/browser.mjs";
/** Correctness-only dense drawing workflow; timing/heap matrices are opt-in diagnostics. */
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { drawingFixture } from "./drawing-fixture.mjs";
import { readWorkspace } from "./browser-workspace.mjs";
import { drawings } from "../src/regions/drawing.ts";
import { drawingGeometry } from "../src/regions/drawingGeometry.ts";
import { archive } from "../src/regions/artifacts.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const count = 100;
const { session, ids } = drawingFixture(count);
let native;
try {
  native = archive(session.native());
} finally {
  session.dispose();
}
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [],
  requests = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
  });
  await context.route("**/api/artifact-sample", async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "drawing-scene.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(native),
  });
  await page.waitForURL(/\?canvas=/);
  await expect(page.locator("[data-drawing-id]")).toHaveCount(count);
  const saved = () =>
    readWorkspace(
      page,
      `manifold.artifact-experiment.v1.canvas-${new URL(page.url()).searchParams.get("canvas")}`,
    );
  const baseline = await saved(),
    before = drawings(baseline.document);
  const bounds = drawingGeometry(before).selectionBounds(new Set(ids));
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await page.getByRole("button", { name: "Fit page", exact: true }).click();
  await paint();
  const screen = (p) =>
    page.locator(".er-canvas").evaluate((node, p) => {
      const rect = node.getBoundingClientRect();
      const zoom = Number(
        node
          .querySelector(".er-paper")
          .style.transform.match(/scale\(([^)]+)\)/)[1],
      );
      return {
        x:
          rect.left +
          p.x * zoom -
          node.scrollLeft +
          Number(node.dataset.canvasOriginX),
        y:
          rect.top +
          p.y * zoom -
          node.scrollTop +
          Number(node.dataset.canvasOriginY),
      };
    }, p);
  const toolbar = page.getByRole("toolbar", {
    name: "Drawing and diagram tools",
    exact: true,
  });
  await toolbar
    .getByRole("button", { name: "Lasso drawings", exact: true })
    .click();
  const corner = await screen({ x: bounds.x, y: bounds.y });
  const far = await screen({
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height,
  });
  const start = { x: corner.x - 15, y: corner.y - 15 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of [
    { x: far.x + 15, y: start.y },
    { x: far.x + 15, y: far.y + 15 },
    { x: start.x, y: far.y + 15 },
    start,
  ])
    await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
  await expect(
    toolbar.getByRole("button", { name: "Duplicate drawings", exact: true }),
  ).toBeEnabled();
  await toolbar
    .getByRole("button", { name: "Select / Edit", exact: true })
    .click();
  const handle = await page.locator("[data-drawing-resize]").boundingBox();
  assert(handle);
  const at = {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2,
  };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 6, at.y + 4, { steps: 6 });
  await page.mouse.up();
  const resized = await saved();
  const resizedBounds = drawingGeometry(
    drawings(resized.document),
  ).selectionBounds(new Set(ids));
  assert(
    resizedBounds.width > bounds.width && resizedBounds.height > bounds.height,
    "Resize must change geometry, not merely mint revisions",
  );
  assert.deepEqual(
    drawings(resized.document)
      .map((entry) => entry.id)
      .sort(),
    [...ids].sort(),
  );
  for (const id of ids)
    assert.notEqual(
      resized.document.items.get(id).revision,
      baseline.document.items.get(id).revision,
      "Whole-scene resize must revise every selected mark",
    );
  assert.equal(
    resized.document.evidenceSequence,
    baseline.document.evidenceSequence,
  );
  await page.keyboard.press("ControlOrMeta+z");
  assert.deepEqual(
    drawings((await saved()).document),
    before,
    "One Undo restores the complete resize",
  );
  // Translate the still-selected group once; this must move views, not revise mark bodies.
  const group = await screen({ x: 160, y: 140 });
  await page.mouse.move(group.x, group.y);
  await page.mouse.down();
  await page.mouse.move(group.x + 8, group.y + 5, { steps: 6 });
  await page.mouse.up();
  const moved = await saved(),
    after = drawings(moved.document);
  const dx = after[0].view.x - before[0].view.x,
    dy = after[0].view.y - before[0].view.y;
  assert(dx !== 0 && dy !== 0);
  for (const entry of after) {
    const old = before.find((old) => old.id === entry.id);
    assert.deepEqual(entry.mark, old.mark);
    assert.equal(
      moved.document.items.get(entry.id).revision,
      baseline.document.items.get(entry.id).revision,
    );
    assert(Math.abs(entry.view.x - old.view.x - dx) < 1e-6);
    assert(Math.abs(entry.view.y - old.view.y - dy) < 1e-6);
  }
  await page.reload();
  await expect(page.locator("[data-drawing-id]")).toHaveCount(count);
  const reopened = await saved();
  assert.deepEqual(
    drawings(reopened.document),
    after,
    "Accepted group translation survives cold reload",
  );
  assert.equal(
    reopened.document.evidenceSequence,
    baseline.document.evidenceSequence,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Drawing scene: one 100-mark native Open, full-scene resize/Undo, view-only group translation and durable reload pass without execution or measurement loops.",
  );
} finally {
  await browser.close();
}
