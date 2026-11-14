import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import { project } from "../src/regions/document.ts";
import { MAX_DRAWINGS } from "../src/regions/drawing.ts";
import { canvasSourceDigest } from "../tools/canvas-source-digest.mjs";
import { timingDistribution } from "./worksheet-timing.mjs";
import { archive } from "../src/regions/artifacts.ts";
import { drawings, editDrawings } from "../src/regions/drawing.ts";
import { drawingFixture } from "./drawing-fixture.mjs";
import {
  readWorkspace as readStoredWorkspace,
  readWorkspaceBytes as readStoredWorkspaceBytes,
} from "./browser-workspace.mjs";

// Deterministic work budgets, not a machine-dependent FPS assertion.
const count = 256;
const drawingCount = Number(process.env.MANIFOLD_INTERACTION_DRAWINGS || 100);
assert.ok([100, 1000, MAX_DRAWINGS - 1].includes(drawingCount));
const timing = {
  pointerDown: [],
  movement: [],
  typing: [],
  release: [],
  edit: [],
};
const { session } = drawingFixture(drawingCount, {
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
  await expect(page.locator("[data-drawing-id]")).toHaveCount(drawingCount);
  const key = `manifold.artifact-experiment.v1.canvas-${new URL(page.url()).searchParams.get("canvas")}`;
  const readWorkspace = (page) => readStoredWorkspace(page, key);
  const readWorkspaceBytes = (page) => readStoredWorkspaceBytes(page, key);
  const admitted = await readWorkspace(page);
  assert.equal(admitted.page.regions.length, count);
  assert.equal(drawings(admitted.document).length, drawingCount);
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
  const distant = page.locator('[data-region-id="fast-255"]');
  await expect(distant).toHaveAttribute("data-canvas-offscreen", "");
  await expect
    .poll(() =>
      distant.evaluate((node) =>
        node
          .querySelector(".er-math-line")
          .checkVisibility({ contentVisibilityAuto: true }),
      ),
    )
    .toBe(false);
  const distantSize = await distant.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  assert.ok(
    distantSize.width > 0 && distantSize.height > 0,
    "culled objects retain measured frames, not zero-size placeholders",
  );
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
  await page.evaluate(() => {
    window.pointerFeedback = new Promise((resolve) => {
      window.addEventListener(
        "pointerdown",
        (event) => {
          const at = performance.now(),
            target = event.target.closest("button") || event.target;
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                inputToFeedbackOpportunityMs: performance.now() - at,
                captured: target.hasPointerCapture(event.pointerId),
              }),
            ),
          );
        },
        { capture: true, once: true },
      );
    });
  });
  await page.mouse.down();
  const feedback = await page.evaluate(() => window.pointerFeedback);
  assert.equal(feedback.captured, true);
  timing.pointerDown.push({
    inputToFeedbackOpportunityMs: feedback.inputToFeedbackOpportunityMs,
  });
  const timedMove = (dx, dy) =>
    page.locator('[data-region-id="fast-0"]').evaluate(
      async (node, { x, y }) => {
        const before = node.style.translate;
        let observer, timer;
        const at = performance.now();
        const result = new Promise((resolve, reject) => {
          observer = new MutationObserver(() => {
            if (node.style.translate === before) return;
            observer.disconnect();
            const observed = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() =>
                resolve({
                  inputToPreviewDomMs: observed - at,
                  inputToPreviewOpportunityMs: performance.now() - at,
                }),
              ),
            );
          });
          observer.observe(node, {
            attributes: true,
            attributeFilter: ["style"],
          });
          timer = setTimeout(
            () => reject(Error("Move preview did not arrive")),
            10000,
          );
        });
        try {
          node.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              pointerId: 1,
              clientX: x,
              clientY: y,
              altKey: true,
            }),
          );
          return await result;
        } finally {
          observer.disconnect();
          clearTimeout(timer);
        }
      },
      { x: grip.x + dx, y: grip.y + dy },
    );
  timing.movement.push(await timedMove(30, 30));
  for (let i = 0; i < 5; i++)
    timing.movement.push(await timedMove(35 + i * 4, 35 + i * 2));
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
  assert.equal(
    dragAfter.scene,
    dragBefore.scene,
    "steady dragging must not render the application scene",
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

  // Wheel bursts accumulate all zoom deltas. This real-clock observation may
  // include the idle commit on a slow machine; exact steady-frame budgets are
  // enforced below with a controlled clock, separately from timing samples.
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
    "a wheel burst permits only bounded idle/measurement reconciliation",
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
    for (let dx = 10; dx <= 35; dx++)
      node.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientX: start.x + dx,
          clientY: start.y + 25,
          altKey: true,
        }),
      );
    window.releaseAt = performance.now();
    node.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 1,
        clientX: start.x + 40,
        clientY: start.y + 25,
        altKey: true,
      }),
    );
    window.releaseOpportunity = new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          resolve(performance.now() - window.releaseAt),
        ),
      ),
    );
  }, start);
  timing.release.push({
    releaseToSettledOpportunityMs: await page.evaluate(
      () => window.releaseOpportunity,
    ),
  });
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
  // Viewport culling retains DOM/identity and full object geometry when revealed.
  await distant.evaluate((node) => {
    window.distantMath = node.querySelector("[data-math-renders]");
  });
  await distant.scrollIntoViewIfNeeded();
  await expect(distant).not.toHaveAttribute("data-canvas-offscreen", "");
  assert.equal(
    await distant.evaluate(
      (node) =>
        window.distantMath === node.querySelector("[data-math-renders]"),
    ),
    true,
  );
  assert.equal(
    await distant.evaluate((node) => getComputedStyle(node).contentVisibility),
    "visible",
  );

  // Mixed-object previews keep SVG selection/visual connector geometry live,
  // without rerendering the worksheet or rebuilding unrelated SVG marks.
  await first.locator(".er-math-line").click();
  await firstDrawing.click({
    modifiers: ["Shift"],
    position: { x: 20, y: 20 },
  });
  await expect(moveSelection).toBeVisible();
  const connector = page.locator('[data-drawing-id="drawing-load-9"] line');
  const connectorPoints = () =>
    connector.evaluate((node) =>
      ["x1", "y1", "x2", "y2"].map((attribute) =>
        Number(node.getAttribute(attribute)),
      ),
    );
  const connectorBefore = await connectorPoints(),
    mixedBytes = await readWorkspaceBytes(page);
  const mixedGrip = await moveSelection.boundingBox();
  await page.mouse.move(
    mixedGrip.x + mixedGrip.width / 2,
    mixedGrip.y + mixedGrip.height / 2,
  );
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(
    mixedGrip.x + mixedGrip.width / 2 + 20,
    mixedGrip.y + mixedGrip.height / 2 + 15,
  );
  await paint();
  const mixedCounts = await counts();
  await page.mouse.move(
    mixedGrip.x + mixedGrip.width / 2 + 50,
    mixedGrip.y + mixedGrip.height / 2 + 35,
    { steps: 8 },
  );
  await paint();
  const movedConnector = await connectorPoints(),
    mixedAfter = await counts();
  assert.ok(Math.abs(movedConnector[0] - connectorBefore[0] - 50) < 0.01);
  assert.ok(Math.abs(movedConnector[1] - connectorBefore[1] - 35) < 0.01);
  assert.deepEqual(movedConnector.slice(2), connectorBefore.slice(2));
  assert.equal(mixedAfter.scene, mixedCounts.scene);
  assert.deepEqual(mixedAfter.math, mixedCounts.math);
  const drawingIds = await page
    .locator("[data-drawing-id]")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.drawingId));
  const changedDrawings = drawingIds.filter(
    (id, index) => mixedAfter.drawing[index] !== mixedCounts.drawing[index],
  );
  assert.ok(
    changedDrawings.every((id) =>
      ["drawing-load-0", "drawing-load-9"].includes(id),
    ),
    `only the active drawing and its connected visual reference may rerender: ${changedDrawings.join(", ")}`,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await paint();
  assert.deepEqual(await connectorPoints(), connectorBefore);
  assert.equal(await readWorkspaceBytes(page), mixedBytes);

  // The selected region's command resolver/panel stays closed until disclosure.
  await first.locator(".er-math-line").click();
  const disclosure = first.locator(".er-actions");
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure.getByRole("toolbar")).toHaveCount(0);
  await paint();
  const closedCommands = await counts();
  await disclosure.locator("summary").click();
  await expect(disclosure.getByRole("toolbar")).toBeVisible();
  assert.equal(
    (await counts()).scene,
    closedCommands.scene,
    "opening a region disclosure only renders its own controls",
  );
  await disclosure.locator("summary").click();
  await expect(disclosure.getByRole("toolbar")).toHaveCount(0);

  // Character/caret/reference feedback is local; file/commit guards still read
  // the newest buffer synchronously, not an older parent-render snapshot.
  await first
    .getByRole("button", { name: "Edit value 2", exact: true })
    .dblclick();
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await expect(editor).toBeFocused();
  await paint();
  const typingBefore = await counts(),
    writingBytes = await readWorkspaceBytes(page);
  await editor.pressSequentially(" scratch");
  for (let i = 0; i < 6; i++) {
    timing.typing.push(
      await editor.evaluate(
        async (node, value) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          ).set;
          setter.call(node, value);
          node.setSelectionRange(value.length, value.length);
          const at = performance.now();
          node.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: value,
            }),
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          if (node.value !== value || node.selectionStart !== value.length)
            throw Error("Typed value/caret did not settle");
          return { inputToCharacterOpportunityMs: performance.now() - at };
        },
        `v0 = ${20 + i} m`,
      ),
    );
  }
  await editor.fill("v0 = @v1");
  await expect(
    page.getByRole("listbox", { name: "Reference an object", exact: true }),
  ).toBeVisible();
  await editor.press("ArrowDown");
  await editor.press("ArrowUp");
  await editor.press("Enter");
  await expect(editor).toHaveValue("v0 = v1");
  const typingAfter = await counts();
  assert.equal(
    typingAfter.scene,
    typingBefore.scene,
    "ordinary typing, caret movement and reference-menu choices must not render the scene",
  );
  assert.deepEqual(typingAfter.drawing, typingBefore.drawing);
  assert.equal(await readWorkspaceBytes(page), writingBytes);
  await editor.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("v0 = v1");
  timing.edit.push(
    await editor.evaluate(async (node) => {
      const status = document.querySelector(
        '[aria-label="Workspace save status"]',
      );
      let observer,
        timer,
        published,
        opportunity,
        durableAt,
        sawPending = false;
      const at = performance.now();
      const saved = new Promise((resolve, reject) => {
        const finish = () => {
          if (
            published !== undefined &&
            opportunity !== undefined &&
            durableAt !== undefined
          )
            resolve({
              commitToResultDomMs: published - at,
              commitToResultOpportunityMs: opportunity - at,
              commitToDurableStatusMs: durableAt - at,
            });
        };
        observer = new MutationObserver(() => {
          if (status.textContent !== "Saved locally") sawPending = true;
          else if (sawPending && durableAt === undefined)
            durableAt = performance.now();
          if (!node.isConnected && published === undefined) {
            published = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                opportunity = performance.now();
                finish();
              }),
            );
          }
          finish();
        });
        observer.observe(document.querySelector(".er-app"), {
          subtree: true,
          childList: true,
          characterData: true,
        });
        timer = setTimeout(
          () => reject(Error("Accepted edit did not settle and save")),
          10000,
        );
      });
      try {
        node.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
        return await saved;
      } finally {
        observer.disconnect();
        clearTimeout(timer);
      }
    }),
  );
  const written = await readWorkspace(page);
  assert.equal(project(written.page).texts["fast-0"], "v0 = v1");
  assert.equal(written.page.links["fast-0"].v1, "fast-1");
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => project((await readWorkspace(page)).page).texts["fast-0"])
    .toBe("v0 = 2 m");

  // Several display frames and snapshot changes must not bypass the memory
  // debounce. Page exit flushes the displayed (not merely settled) camera once.
  await canvas.focus();
  await page.keyboard.press("Escape");
  await paint();
  // Reload after installing the clock: timers created before installation are
  // native timers and cannot be controlled or cancelled by the fake clock.
  // All latency samples above use the real clock/RAF, not this debounce probe.
  await page.clock.install();
  await page.reload();
  await expect(page.locator("[data-region-id]")).toHaveCount(count);
  await expect(page.locator("[data-drawing-id]")).toHaveCount(drawingCount);
  await readWorkspace(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.clock.runFor(400);
  await page.evaluate(() => {
    window.navigationWrites = [];
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.includes("manifold.canvas-attention.v1"))
        window.navigationWrites.push(JSON.parse(value));
      return save.call(this, key, value);
    };
  });
  const steadyZoom = await counts();
  for (let i = 0; i < 8; i++) {
    await canvas.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: -1,
          clientX: rect.left + 300,
          clientY: rect.top + 200,
        }),
      );
    });
    await page.clock.runFor(17);
  }
  assert.equal(
    (await counts()).scene,
    steadyZoom.scene,
    "continuous zoom inside one detail level never renders the scene",
  );
  assert.equal(await page.evaluate(() => window.navigationWrites.length), 0);
  // Crossing a semantic level changes the settled camera/scene snapshot. The
  // memory effect must still debounce, rather than saving in its cleanup.
  for (const deltaY of [-18, -1, -1, -1]) {
    await canvas.evaluate((node, deltaY) => {
      const rect = node.getBoundingClientRect();
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: rect.left + 300,
          clientY: rect.top + 200,
        }),
      );
    }, deltaY);
    await page.clock.runFor(17);
    assert.equal(
      await page.evaluate(() => window.navigationWrites.length),
      0,
      "camera snapshot changes must not synchronously write navigation memory",
    );
  }
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const memory = await page.evaluate(() => window.navigationWrites);
  assert.equal(
    memory.length,
    1,
    "exit flushes only the newest camera snapshot",
  );
  assert.ok(Math.abs(memory[0].camera.zoom - Math.exp(0.29)) < 1e-6);
  await page.clock.runFor(400);
  assert.equal(
    await page.evaluate(() => window.navigationWrites.length),
    1,
    "a pending debounce cannot duplicate the exit save",
  );
  await page.clock.resume();
  assert.deepEqual(errors, []);
  const output = new URL(
    `../../../evidence/current/canvas/interaction-${drawingCount}-results.json`,
    import.meta.url,
  );
  await mkdir(new URL("./", output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        sourceDigest: canvasSourceDigest(),
        browser: await browser.version(),
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          osRelease: release(),
          cpu: cpus()[0]?.model,
          headless: true,
          viewport: { width: 1700, height: 1200 },
        },
        workload: { regions: count, drawings: drawingCount },
        method:
          "Real mixed canvas and real input handlers. Trusted pointer-down is timed from window capture through owned pointer capture and two RAF callbacks. Programmatic move/input samples use page-side timestamps, MutationObserver for preview DOM, and two RAF callbacks for a rendering opportunity. First samples are cold and retained, not discarded warmups. Release includes one atomic multi-object publication. Edit timing ends at accepted DOM, a rendering opportunity and Saved locally (verified with a real IndexedDB read afterward). Storage remains enabled. These are device-specific DOM/rendering-opportunity observations, not compositor paint, physical input latency or a hardware-independent SLO.",
        timing: Object.fromEntries(
          Object.entries(timing).map(([kind, samples]) => [
            kind,
            Object.fromEntries(
              Object.keys(samples[0]).map((field) => [
                field,
                timingDistribution(samples.map((sample) => sample[field])),
              ]),
            ),
          ]),
        ),
        work: {
          steadyDragSceneRenders: dragAfter.scene - dragBefore.scene,
          steadyZoomSceneRenders: 0,
          typingSceneRenders: typingAfter.scene - typingBefore.scene,
          inGestureNavigationWrites: 0,
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Canvas interaction budgets: ${count} worksheet rows + ${drawingCount} mixed drawings; local typing/menus, viewport culling, zero steady drag/zoom scene renders, debounced navigation memory, atomic completion/Undo and page-clock feedback observations pass.`,
  );
} finally {
  await browser.close();
}
