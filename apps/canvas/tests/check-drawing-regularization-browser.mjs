import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
import { drawings } from "../src/regions/drawing.ts";
import { REGULARIZE_HOLD_MS } from "../src/regions/drawingRegularization.ts";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let checks = 0;
const paths = {
  line: Array.from({ length: 25 }, (_, i) => [
    180 + i * 9,
    170 + Math.sin(i / 4),
  ]),
  ellipse: Array.from({ length: 65 }, (_, i) => {
    const a = (i / 64) * 2 * Math.PI;
    return [340 + 65 * Math.cos(a), 230 + 65 * Math.sin(a)];
  }),
  rectangle: [
    [200, 160],
    [410, 160],
    [410, 290],
    [200, 290],
    [200, 160],
  ],
};
async function run(test) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install();
    await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
    await readWorkspaceBytes(page);
    const toolbar = page.getByRole("toolbar", {
      name: "Drawing and diagram tools",
    });
    const surface = page.locator("[data-drawing-surface]");
    const preview = page.locator("[data-regularized-preview]");
    const marks = async () => drawings((await readWorkspace(page)).document);
    const pause = async () =>
      page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const box = await page.locator(".er-canvas").boundingBox();
    const start = async (points, tool = "Pen") => {
      await toolbar.getByRole("button", { name: tool, exact: true }).click();
      await pause();
      await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
      await page.mouse.down();
      for (const [x, y] of points.slice(1))
        await page.mouse.move(box.x + x, box.y + y, { steps: 3 });
    };
    const release = async () => {
      await page.mouse.up();
      await page.clock.resume();
      return marks();
    };
    const undo = async () => {
      await page.keyboard.press("ControlOrMeta+z");
      return marks();
    };
    await test({
      page,
      toolbar,
      surface,
      preview,
      marks,
      start,
      release,
      undo,
      box,
    });
    checks++;
  } finally {
    await context.close();
  }
}
try {
  for (const kind of ["line", "ellipse", "rectangle"])
    await run(async ({ page, preview, start, release, undo, marks }) => {
      const before = await readWorkspaceBytes(page),
        baseline = await readWorkspace(page);
      await start(paths[kind]);
      await page.clock.runFor(REGULARIZE_HOLD_MS - 1);
      await expect(preview).toHaveCount(0);
      assert.equal(await readWorkspaceBytes(page), before);
      await page.clock.runFor(1);
      await expect(preview).toHaveAttribute("data-regularized-preview", kind);
      assert.equal(
        await readWorkspaceBytes(page),
        before,
        "hold previews never publish",
      );
      const appearance = await preview
        .locator(
          kind === "line" ? "line" : kind === "ellipse" ? "ellipse" : "rect",
        )
        .evaluate((node) =>
          Object.fromEntries(
            [...node.attributes].map((a) => [a.name, a.value]),
          ),
        );
      const accepted = await release();
      assert.equal(accepted.length, 1);
      assert.equal(accepted[0].mark.kind, kind);
      const clean = accepted[0].mark;
      if (kind === "line") {
        assert.equal(clean.points[0].x, Number(appearance.x1));
        assert.equal(clean.points[1].y, Number(appearance.y2));
      } else {
        const [a, b] = clean.points;
        assert(
          Math.abs(
            (kind === "ellipse" ? (a.x + b.x) / 2 : a.x) -
              Number(kind === "ellipse" ? appearance.cx : appearance.x),
          ) < 1e-8,
        );
      }
      const after = await readWorkspace(page);
      assert.deepEqual(after.page, baseline.page);
      assert.deepEqual(after.artifacts, baseline.artifacts);
      const raw = await undo();
      assert.equal(raw[0].mark.kind, "pen");
      assert(raw[0].mark.points.length > 2);
      const original = structuredClone(raw[0].mark);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      assert.deepEqual((await marks())[0].mark, clean);
      await undo();
      assert.deepEqual((await marks())[0].mark, original);
      await undo();
      assert.equal((await marks()).length, 0);
    });
  // A timer result queued just before release is not accepted until its preview reaches the DOM.
  await run(async ({ page, start, release, box }) => {
    await page.evaluate(() => {
      const schedule = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => {
        if (delay === 650 && typeof callback === "function") {
          window.__pendingRegularization = () => callback(...args);
          return schedule(() => {}, delay);
        }
        return schedule(callback, delay, ...args);
      };
    });
    await start(paths.line);
    const visibleBeforeRelease = await page.evaluate(
      ({ x, y }) => {
        window.__pendingRegularization();
        const visible = !!document.querySelector("[data-regularized-preview]");
        document.querySelector("[data-drawing-surface]").dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            buttons: 0,
            clientX: x,
            clientY: y,
          }),
        );
        return visible;
      },
      { x: box.x + paths.line.at(-1)[0], y: box.y + paths.line.at(-1)[1] },
    );
    assert.equal(visibleBeforeRelease, false);
    assert.equal(
      (await release())[0].mark.kind,
      "pen",
      "an unshown candidate must not replace ink",
    );
  });
  // Releasing just before dwell never snaps, and a late callback cannot rewrite accepted ink.
  await run(async ({ page, preview, start, release, undo, marks, toolbar }) => {
    await start(paths.line);
    await page.clock.runFor(REGULARIZE_HOLD_MS - 1);
    const raw = (await release())[0].mark;
    assert.equal(raw.kind, "pen");
    await page.waitForTimeout(REGULARIZE_HOLD_MS + 50);
    assert.deepEqual((await marks())[0].mark, raw);
    await expect(preview).toHaveCount(0);
    const button = toolbar.getByRole("button", {
      name: "Regularize selection",
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
    assert.equal((await marks())[0].mark.kind, "line");
    await undo();
    assert.deepEqual((await marks())[0].mark, raw);
  });
  // Resuming movement restores ink; another deliberate hold can arm a fresh preview.
  await run(async ({ page, preview, start, release, box }) => {
    await start(paths.line);
    await page.clock.runFor(REGULARIZE_HOLD_MS);
    await expect(preview).toHaveCount(1);
    await page.mouse.move(box.x + 550, box.y + 170);
    await page.clock.runFor(16);
    await expect(preview).toHaveCount(0);
    await page.clock.runFor(REGULARIZE_HOLD_MS);
    await expect(preview).toHaveAttribute("data-regularized-preview", "line");
    assert.equal((await release())[0].mark.kind, "line");
  });
  // Pointer-up outside the stability radius must not accept an unshown altered shape.
  await run(async ({ page, preview, start, release, box }) => {
    await start(paths.line);
    await page.clock.runFor(REGULARIZE_HOLD_MS);
    await expect(preview).toHaveCount(1);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      x: box.x + 600,
      y: box.y + 300,
    });
    await page.clock.resume();
    const accepted = await release();
    assert.equal(accepted[0].mark.kind, "pen");
  });
  // Foreign pointer events cannot cancel or advance the owned preview.
  await run(async ({ page, surface, preview, start, release }) => {
    await start(paths.line);
    for (const type of [
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ])
      await surface.dispatchEvent(type, {
        pointerId: 999,
        pointerType: "pen",
        clientX: 900,
        clientY: 800,
        bubbles: true,
      });
    await page.clock.runFor(REGULARIZE_HOLD_MS);
    await expect(preview).toHaveCount(1);
    assert.equal((await release())[0].mark.kind, "line");
  });
  for (const cancellation of ["Escape", "blur", "capture"])
    await run(async ({ page, surface, preview, start, release }) => {
      const before = await readWorkspaceBytes(page);
      await start(paths.ellipse);
      await page.clock.runFor(REGULARIZE_HOLD_MS);
      await expect(preview).toHaveCount(1);
      if (cancellation === "Escape") await page.keyboard.press("Escape");
      else if (cancellation === "blur")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else await surface.evaluate((node) => node.releasePointerCapture(1));
      await page.clock.runFor(REGULARIZE_HOLD_MS + 50);
      await expect(preview).toHaveCount(0);
      await release();
      assert.equal(
        await readWorkspaceBytes(page),
        before,
        cancellation + " cancels without publication",
      );
    });
  // Undo changes the accepted document and cancels a pending hold; timers/up cannot revive it.
  await run(async ({ page, preview, start, release }) => {
    await start(paths.line);
    assert.equal((await release()).length, 1);
    await start(paths.line);
    await page.keyboard.press("ControlOrMeta+z");
    await page.clock.runFor(REGULARIZE_HOLD_MS + 50);
    await expect(preview).toHaveCount(0);
    assert.equal((await release()).length, 0);
  });
  await run(async ({ page, preview, start, release }) => {
    await start(paths.line);
    await page.clock.runFor(REGULARIZE_HOLD_MS);
    await expect(preview).toHaveCount(1);
    const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoom.focus();
    await page.keyboard.press("Enter");
    await page.clock.runFor(20);
    await expect(preview).toHaveCount(0);
    assert.equal((await release())[0].mark.kind, "pen");
  });
  // Highlighter and ambiguous/open strokes are never regularized by a pause.
  for (const [tool, points, kind] of [
    ["Highlighter", paths.line, "highlighter"],
    ["Pen", paths.ellipse.slice(0, 40), "pen"],
  ])
    await run(async ({ page, preview, start, release }) => {
      await start(points, tool);
      await page.clock.runFor(REGULARIZE_HOLD_MS + 100);
      await expect(preview).toHaveCount(0);
      assert.equal((await release())[0].mark.kind, kind);
    });
  // Real stylus pressure survives the shape's Undo state.
  await run(async ({ page, toolbar, preview, box, release, undo }) => {
    await toolbar.getByRole("button", { name: "Pen", exact: true }).click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force: 0.2,
      x: box.x + 180,
      y: box.y + 170,
    });
    for (let i = 1; i <= 15; i++)
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        pointerType: "pen",
        force: i / 20,
        x: box.x + 180 + i * 12,
        y: box.y + 170,
      });
    await page.clock.runFor(REGULARIZE_HOLD_MS);
    await expect(preview).toHaveCount(1);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      pointerType: "pen",
      force: 0,
      x: box.x + 360,
      y: box.y + 170,
    });
    await release();
    const raw = (await undo())[0].mark;
    assert.equal(raw.kind, "pen");
    assert(new Set(raw.points.map((p) => p.pressure)).size > 2);
  });
  assert.deepEqual(errors, []);
  console.log(
    `${checks} pen hold/selection regularization browser scenarios passed: controlled dwell, preview bytes, exact acceptance, ink Undo/Redo, native pressure, pointer ownership, cancellation, staleness and exclusions.`,
  );
} finally {
  await browser.close();
}
