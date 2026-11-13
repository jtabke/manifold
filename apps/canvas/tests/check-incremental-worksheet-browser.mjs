import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
import { canvasSourceDigest } from "../tools/canvas-source-digest.mjs";
import {
  timingDistribution,
  timeWorksheetInteraction,
} from "./worksheet-timing.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const rows = [];
try {
  for (const count of [64, 256]) {
    const fixture = {
      regions: Array.from({ length: count }, (_, i) => ({
        id: "render-" + i,
        text: i === 1 ? "v1 = 3*v0" : `v${i} = ${i + 2} m`,
      })),
      contexts: [
        { id: "original", label: "Original", base: {}, overrides: {} },
      ],
      active: "original",
      layout: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          "render-" + i,
          { x: 100 + Math.floor(i / 12) * 580, y: 100 + (i % 12) * 110 },
        ]),
      ),
      plots: [],
      origin: { x: 100, y: 100 },
    };
    const session = new RegionSession(fixture),
      native = archive(session.native());
    session.dispose();
    const context = await browser.newContext({
        viewport: { width: 1700, height: 1100 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(10000);
    await page.goto(base);
    await page
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles({
        name: "worksheet.manifold",
        mimeType: "application/json",
        buffer: Buffer.from(native),
      });
    const r0 = page.locator('[data-region-id="render-0"]'),
      r2 = page.locator('[data-region-id="render-2"]');
    await expect(page.locator('[data-result-for="v1"]')).toContainText("6 m");
    await readWorkspace(page);
    const counts = () =>
      page
        .locator(".er-region math[data-math-renders]")
        .evaluateAll((nodes) =>
          Object.fromEntries(
            nodes.map((n) => [
              n.closest("[data-region-id]").dataset.regionId,
              Number(n.dataset.mathRenders),
            ]),
          ),
        );
    const before = await counts();
    assert.equal(Object.keys(before).length, count);
    const handle = r0.getByRole("button", { name: "Move v0", exact: true });
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 80,
      box.y + box.height / 2 + 30,
      { steps: 8 },
    );
    await page.mouse.up();
    await readWorkspace(page);
    const moved = await counts();
    assert.deepEqual(
      moved,
      before,
      "layout must reuse every mathematical subtree",
    );
    await r0
      .getByRole("button", { name: "Edit value 2", exact: true })
      .dblclick();
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    await editor.fill("v0 = 4 m");
    await editor.press("Escape");
    await expect(page.locator('[data-result-for="v1"]')).toContainText("12 m");
    await readWorkspace(page);
    const changed = await counts(),
      unrelated = Object.entries(before).filter(
        ([id]) => !["render-0", "render-1"].includes(id),
      );
    assert.ok(
      unrelated.every(([id, n]) => changed[id] === n),
      "independent rows must retain their rendered math",
    );
    // A reused row must route interactions through the latest committed handlers.
    await r2
      .getByRole("button", { name: "Edit value 4", exact: true })
      .dblclick();
    await editor.fill("v2 = 2*v0");
    await editor.press("Escape");
    await expect(page.locator('[data-result-for="v2"]')).toContainText("8 m");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      r2.getByRole("button", { name: "Edit value 4", exact: true }),
    ).toHaveCount(1);
    // Hot preview and Undo remain correct with the derived caches populated.
    await r0.click({ position: { x: 400, y: 25 } });
    await revealRegionActions(page);
    await page
      .getByRole("toolbar", { name: "Quantity v0 actions", exact: true })
      .locator('[data-command-id="quantity.vary"]')
      .click();
    const controls = page.getByLabel("Explore v0", { exact: true }),
      value = controls.getByLabel("Exploration value v0", { exact: true });
    await expect(controls).toBeVisible();
    await value.fill("5");
    await value.press("Enter");
    await expect(page.locator('[data-result-for="v1"]')).toContainText("15 m");
    await controls.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator('[data-result-for="v1"]')).toContainText("12 m");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator('[data-result-for="v1"]')).toContainText("6 m");
    const beforeReload = await readWorkspace(page);
    await page.reload();
    await expect(page.locator('[data-result-for="v1"]')).toContainText("6 m");
    assert.deepEqual((await readWorkspace(page)).page, beforeReload.page);

    // Keep trusted Playwright correctness actions above; these repeated timing probes
    // dispatch DOM events through the same real handlers entirely on the page clock.
    const warmups = 5,
      observations = 30,
      edits = [],
      variations = [];
    let current = 2;
    for (let sample = 0; sample < warmups + observations; sample++) {
      const next = 10 + sample;
      await r0
        .getByRole("button", { name: `Edit value ${current}`, exact: true })
        .dblclick();
      const timing = await timeWorksheetInteraction(editor, {
        kind: "edit",
        value: `v0 = ${next} m`,
        expected: `${3 * next} m`,
      });
      if (sample >= warmups) edits.push(timing);
      current = next;
    }
    // Durable storage is checked outside event-to-result timing windows.
    const timedBaseline = await readWorkspace(page);
    await r0.click({ position: { x: 400, y: 25 } });
    await revealRegionActions(page);
    await page
      .getByRole("toolbar", { name: "Quantity v0 actions", exact: true })
      .locator('[data-command-id="quantity.vary"]')
      .click();
    const timingControls = page.getByLabel("Explore v0", { exact: true }),
      slider = timingControls.getByLabel("Vary v0", { exact: true });
    await expect(slider).toBeVisible();
    for (let sample = 0; sample < warmups + observations; sample++) {
      const next = 20 + sample,
        timing = await timeWorksheetInteraction(slider, {
          kind: "vary",
          value: String(next),
          expected: `${3 * next} m`,
        });
      if (sample >= warmups) variations.push(timing);
    }
    await timingControls
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.locator('[data-result-for="v1"]')).toContainText(
      `${3 * current} m`,
    );
    assert.deepEqual((await readWorkspace(page)).page, timedBaseline.page);
    const summarize = (samples) =>
      Object.fromEntries(
        Object.keys(samples[0]).map((key) => [
          key,
          timingDistribution(samples.map((sample) => sample[key])),
        ]),
      );
    assert.deepEqual(errors, []);
    rows.push({
      regions: count,
      layoutMathRenders: Object.keys(before).reduce(
        (n, id) => n + Math.max(0, moved[id] - before[id]),
        0,
      ),
      unrelatedMathRenders: unrelated.reduce(
        (n, [id, old]) => n + Math.max(0, changed[id] - old),
        0,
      ),
      independentRows: unrelated.length,
      renderedMathRows: Object.keys(changed).length,
      interactionTiming: {
        warmups,
        observations,
        edit: summarize(edits),
        vary: summarize(variations),
      },
    });
    await context.close();
  }
  const output = new URL(
    "../../../evidence/current/canvas/worksheet-rendering-results.json",
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
          viewport: { width: 1700, height: 1100 },
        },
        method:
          "Real 64/256-row canvases. Count committed MathLine content renders from DOM diagnostics across accepted pointer layout and a sparse edit. Independent rows reuse mathematical subtrees; current-handler editing, hot preview/cancel/Undo and cold reload preserve results. Five warmups and 30 measured sparse edits and Vary slider events per size use programmatically dispatched DOM input/Escape events through real application handlers. Page-side performance.now timestamps input and commit, MutationObserver checks the expected dependent-result DOM, and two subsequent RAF callbacks mark an intervening rendering opportunity, not compositor paint. Edit input-to-result includes two RAF callbacks for controlled-draft settling; commit-to-result starts after that settling. Autosave runs normally, but durable reads/reload checks are outside these timing windows. Raw observations plus median/p95/max are device-specific diagnostics without a latency SLO. Counts do not cover the entire React application shell or imply virtualization.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Incremental worksheet Chrome: layout/independent math subtree reuse, current-handler editing, live dependent results, hot preview/cancel/Undo, cold reload and page-clock edit/Vary rendering-opportunity observations at 64/256 rows pass.",
  );
} finally {
  await browser.close();
}
