import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { archive } from "../src/regions/artifacts.ts";
import { drawings, editDrawings } from "../src/regions/drawing.ts";
import { drawingFixture } from "./drawing-fixture.mjs";
import {
  readWorkspace as readStoredWorkspace,
  readWorkspaceBytes as readStoredWorkspaceBytes,
} from "./browser-workspace.mjs";

// Deterministic work budgets, not a machine-dependent FPS assertion.
const count = 256;
const { session } = drawingFixture(100, {
  regions: Array.from({ length: count }, (_, i) => ({
    id: `fast-${i}`,
    text: `v${i} = ${i + 2} m`,
  })),
  contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
  active: "original",
  layout: Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `fast-${i}`,
      { x: 120 + Math.floor(i / 6) * 600, y: 100 + (i % 6) * 105 },
    ]),
  ),
  plots: [],
  origin: { x: 120, y: 100 },
});
editDrawings(
  session,
  drawings(session.document).map((entry) => ({
    entry,
    at: { x: entry.view.x, y: entry.view.y + 700 },
  })),
);
const source = archive(session.native());
session.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1700, height: 1200 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "interaction-load.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(source),
  });
  await expect(page.locator("[data-region-id]")).toHaveCount(count);
  await expect(page.locator("[data-drawing-id]")).toHaveCount(100);
  const key = `manifold.artifact-experiment.v1.canvas-${new URL(page.url()).searchParams.get("canvas")}`;
  const readWorkspace = (page) => readStoredWorkspace(page, key);
  const readWorkspaceBytes = (page) => readStoredWorkspaceBytes(page, key);
  const admitted = await readWorkspace(page);
  assert.equal(admitted.page.regions.length, count);
  assert.equal(drawings(admitted.document).length, 100);
  const canvas = page.locator(".er-canvas");
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const counts = () =>
    page.evaluate(() => ({
      scene: Number(document.querySelector(".er-paper").dataset.canvasRenders),
      math: [...document.querySelectorAll("[data-math-renders]")].map((n) =>
        Number(n.dataset.mathRenders),
      ),
      drawing: [...document.querySelectorAll("[data-drawing-renders]")].map(
        (n) => Number(n.dataset.drawingRenders),
      ),
      measurements: window.objectMeasurements || 0,
    }));
  await readWorkspaceBytes(page);
  await paint();
  const original = await readWorkspaceBytes(page);
  await page.evaluate(() => {
    window.objectMeasurements = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (
        this.matches(
          "[data-region-id],[data-plot-id],[data-tool-id],[data-view-id],[data-model-id],[data-drawing-id]",
        )
      )
        window.objectMeasurements++;
      return original.call(this);
    };
  });
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 50);
  await expect(page.locator(".er-selection-marquee")).toBeVisible();
  await paint();
  const marqueeBefore = await counts();
  await page.mouse.move(box.x + 80, box.y + 80, { steps: 36 });
  await paint();
  const marqueeAfter = await counts();
  assert.deepEqual(
    marqueeAfter,
    marqueeBefore,
    "steady marquee movement must not render the scene/content or remeasure objects",
  );
  const marqueeBox = await page.locator(".er-selection-marquee").boundingBox();
  assert.ok(
    Math.abs(marqueeBox.x - box.x - 10) <= 1 &&
      Math.abs(marqueeBox.y - box.y - 10) <= 1,
    "the compositor-positioned marquee stays anchored to its starting point",
  );
  assert.ok(
    Math.abs(marqueeBox.width - 70) <= 1 &&
      Math.abs(marqueeBox.height - 70) <= 1,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await paint();
  await expect(page.locator(".er-selection-marquee")).toHaveCount(0);
  assert.equal(await readWorkspaceBytes(page), original);

  // A queued move cannot override the release's final coordinates.
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: rect.left + 60,
        clientY: rect.top + 60,
      }),
    );
    node.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: rect.left + 350,
        clientY: rect.top + 180,
      }),
    );
  });
  await page.mouse.up();
  await paint();
  await expect(
    page.locator('.er-selection-outline[data-selection-object="fast-0"]'),
  ).toHaveCount(1);
  await expect(page.locator(".er-selection-marquee")).toHaveCount(0);
  await canvas.focus();
  await page.keyboard.press("Escape");

  // A single selection change must not rebuild all other SVG objects or math.
  const firstDrawing = page.locator('[data-drawing-id="drawing-load-0"]');
  await paint();
  const drawingBefore = await counts();
  await firstDrawing.click({ position: { x: 20, y: 20 } });
  await expect(firstDrawing).toHaveAttribute("aria-pressed", "true");
  await paint();
  const drawingAfter = await counts();
  assert.deepEqual(drawingAfter.math, drawingBefore.math);
  assert.deepEqual(
    drawingAfter.drawing.slice(1),
    drawingBefore.drawing.slice(1),
    "selecting one drawing retains all unrelated SVG subtrees",
  );
  await canvas.focus();
  await page.keyboard.press("Escape");

  const handle = page.getByRole("button", { name: "Move v0", exact: true });
  await handle.scrollIntoViewIfNeeded();
  const grip = await handle.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 30, grip.y + 30);
  await paint();
  const dragBefore = await counts();
  await page.mouse.move(grip.x + 70, grip.y + 50, { steps: 36 });
  await paint();
  const dragAfter = await counts();
  assert.equal(
    dragAfter.measurements,
    dragBefore.measurements,
    "steady object dragging uses captured geometry, not scene-wide DOM reads",
  );
  assert.deepEqual(dragAfter.math, dragBefore.math);
  assert.deepEqual(dragAfter.drawing, dragBefore.drawing);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(
    await readWorkspaceBytes(page),
    original,
    "cancelled layout never changes accepted bytes",
  );

  await paint();
  const panBefore = await counts();
  await canvas.evaluate((node) => {
    for (let i = 0; i < 36; i++)
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 3,
          deltaY: 2,
        }),
      );
  });
  await paint();
  const panAfter = await counts();
  assert.deepEqual(
    panAfter,
    panBefore,
    "panning does not render the scene or remeasure content",
  );

  // An open dialog follows the viewport through its own lightweight placement,
  // not a camera-state update in the application shell.
  await page.getByRole("button", { name: "Link v0", exact: true }).click();
  const connection = page.getByRole("dialog", {
    name: "Connections",
    exact: true,
  });
  await expect(connection).toBeVisible();
  await paint();
  const popoverBefore = await counts();
  await canvas.evaluate((node) =>
    node.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 400,
        deltaY: 400,
      }),
    ),
  );
  await paint();
  assert.deepEqual(
    await counts(),
    popoverBefore,
    "an anchored connection dialog does not force scene renders while panning",
  );
  const popoverBox = await connection.boundingBox();
  assert.ok(
    popoverBox.x >= box.x + 10 &&
      popoverBox.x + popoverBox.width <= box.x + box.width - 10,
  );
  assert.ok(
    popoverBox.y >= box.y + 10 &&
      popoverBox.y + popoverBox.height <= box.y + box.height - 10,
  );
  await connection
    .getByRole("button", { name: "Close connections", exact: true })
    .click();
  await canvas.focus();
  await page.keyboard.press("Escape");
  await paint();

  // Wheel bursts accumulate all zoom deltas but publish at most one zoom render
  // plus its bounded measurement/selection reconciliation, not 36 full renders.
  const zoomBefore = await counts();
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    for (let i = 0; i < 36; i++)
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -0.5,
          clientX: rect.left + 300,
          clientY: rect.top + 200,
        }),
      );
  });
  await expect(
    page.getByRole("button", { name: "Fit page", exact: true }),
  ).toHaveText(`${Math.round(Math.exp(0.18) * 100)}%`);
  await paint();
  const zoomAfter = await counts();
  assert.ok(
    zoomAfter.scene - zoomBefore.scene <= 3,
    "a wheel burst has a bounded scene-render count",
  );
  assert.deepEqual(zoomAfter.math, zoomBefore.math);
  assert.equal(
    await readWorkspaceBytes(page),
    original,
    "camera movement is not authored history",
  );
  // Completion must consume the newest queued multi-object preview, even
  // when move and release arrive in the same task without an intervening RAF.
  await page.keyboard.press("ControlOrMeta+0");
  await expect(
    page.getByRole("button", { name: "Fit page", exact: true }),
  ).toHaveText("100%");
  const first = page.locator('[data-region-id="fast-0"]');
  await first.locator(".er-math-line").click();
  await page
    .locator('[data-region-id="fast-1"] .er-math-line')
    .click({ modifiers: ["Shift"] });
  const moveSelection = page.getByRole("button", {
    name: "Move selected objects",
    exact: true,
  });
  await expect(moveSelection).toBeVisible();
  const beforeMove = await readWorkspace(page);
  const moveBox = await moveSelection.boundingBox();
  const start = {
    x: moveBox.x + moveBox.width / 2,
    y: moveBox.y + moveBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await moveSelection.evaluate((node, start) => {
    for (let dx = 10; dx <= 40; dx++)
      node.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: start.x + dx,
          clientY: start.y + 25,
          altKey: true,
        }),
      );
    node.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: start.x + 40,
        clientY: start.y + 25,
        altKey: true,
      }),
    );
  }, start);
  await page.mouse.up();
  await expect
    .poll(async () => (await readWorkspace(page)).page.layout["fast-0"].x)
    .toBeCloseTo(beforeMove.page.layout["fast-0"].x + 40, 5);
  const afterMove = await readWorkspace(page);
  assert.equal(
    afterMove.document.revisions.size,
    beforeMove.document.revisions.size,
    "a view-only group move preserves all source revisions",
  );
  for (const id of ["fast-0", "fast-1"]) {
    assert.ok(
      Math.abs(
        afterMove.page.layout[id].x - beforeMove.page.layout[id].x - 40,
      ) < 0.01,
    );
    assert.ok(
      Math.abs(
        afterMove.page.layout[id].y - beforeMove.page.layout[id].y - 25,
      ) < 0.01,
    );
  }
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await readWorkspace(page)).page.layout)
    .toEqual(beforeMove.page.layout);
  assert.deepEqual(errors, []);
  console.log(
    "Canvas interaction budgets: 256 worksheet rows + 100 mixed drawings; steady marquee and pan render/measure nothing, dragging reuses captured geometry, selection retains unrelated SVG/math, zoom bursts coalesce, and release/cancel preserve authored bytes.",
  );
} finally {
  await browser.close();
}
