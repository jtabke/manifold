import { browserOptions } from "../../../scripts/browser.mjs";
/** Input/render/retention observations of the shipped application, with isolated browser processes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { platform, arch, cpus } from "node:os";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace } from "./browser-workspace.mjs";
import { canvasSourceDigest } from "../tools/canvas-source-digest.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const stats = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
const limits = {
  pageJsBytes: 128 * 1024 * 1024,
  retainedJsGrowthBytes: 8 * 1024 * 1024,
  toolDescendants: 80,
};
const rows = [],
  errors = [];
let version;
for (const count of [1, 8, 24]) {
  const { session } = await sceneFixture(count, true);
  const source = archive(session.native());
  session.dispose();
  const browser = await chromium.launch({
    ...browserOptions(),
    headless: true,
  });
  version = browser.version();
  try {
    const context = await browser.newContext({
      viewport: { width: 1800, height: 1100 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    let jobs = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/artifact-sample")) jobs++;
    });
    await page.addInitScript((text) => {
      if (!localStorage.getItem("manifold.artifact-experiment.v1"))
        localStorage.setItem("manifold.artifact-experiment.v1", text);
    }, source);
    const paint = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    let started = performance.now();
    await page.goto(base);
    await expect(page.getByLabel("Workspace save status")).toHaveText(
      "Saved locally",
    );
    await page
      .getByRole("button", { name: "Canvas viewpoints", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Working layout", exact: true })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Model hierarchy" }),
    ).toContainText("Scene model");
    await expect(page.locator(".cs-tool")).toHaveCount(count);
    await paint();
    const openToFramesMs = performance.now() - started;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const heap = async () => {
      await cdp.send("HeapProfiler.collectGarbage");
      return (await cdp.send("Performance.getMetrics")).metrics.find(
        (m) => m.name === "JSHeapUsedSize",
      ).value;
    };
    const initialHeapBytes = await heap();
    const baseline = await readWorkspace(page);
    // Capture page-side event-to-two-frame opportunity, excluding automation round-trip time.
    await page.evaluate(() => {
      window.sceneFrames = [];
      window.sceneMeasure = false;
      document.addEventListener(
        "pointermove",
        (e) => {
          if (!e.buttons || !e.target.closest(".cs-tool")) return;
          const start = performance.now(),
            measure = window.sceneMeasure;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (measure) window.sceneFrames.push(performance.now() - start);
            }),
          );
        },
        true,
      );
    });
    const durable = [];
    const tool = page.locator('[data-tool-id="tool-scene-0"]');
    for (let i = 0; i < 35; i++) {
      const at = await tool
        .getByRole("button", { name: "Move canvas tool", exact: true })
        .boundingBox();
      const x = at.x + at.width / 2,
        y = at.y + at.height / 2,
        direction = i % 2 ? -1 : 1;
      await page.mouse.move(x, y);
      await page.evaluate((measure) => {
        window.sceneMeasure = measure;
      }, i >= 5);
      await page.mouse.down();
      await page.mouse.move(x + direction * 20, y + direction * 10, {
        steps: 3,
      });
      started = performance.now();
      await page.mouse.up();
      await expect(page.getByLabel("Workspace save status")).toHaveText(
        "Saved locally",
      );
      if (i >= 5) durable.push(performance.now() - started);
      await paint();
    }
    const after = await readWorkspace(page);
    assert.equal(
      after.document.revisions.size - baseline.document.revisions.size,
      35,
    );
    assert.equal(
      after.recovery.foundation.receipts.length,
      baseline.recovery.foundation.receipts.length,
    );
    const settledHeapBytes = await heap();
    const frames = await page.evaluate(() => window.sceneFrames);
    const toolNodes = await page
      .locator(".cs-tool")
      .evaluateAll((tools) =>
        tools.map((tool) => tool.querySelectorAll("*").length),
      );
    assert.ok(frames.length >= 30);
    assert.ok(Math.max(...toolNodes) <= limits.toolDescendants);
    assert.ok(settledHeapBytes <= limits.pageJsBytes);
    assert.ok(
      settledHeapBytes - initialHeapBytes <= limits.retainedJsGrowthBytes,
    );
    // CDP identifies this launched browser's processes. Summed RSS double-counts shared pages;
    // report it as a system diagnostic, not unique physical memory or a cross-platform gate.
    const system = await browser.newBrowserCDPSession();
    const processes = (await system.send("SystemInfo.getProcessInfo"))
      .processInfo;
    let processRssBytes = null;
    if (platform() === "darwin" || platform() === "linux") {
      const rss = execFileSync(
        "ps",
        ["-o", "rss=", "-p", processes.map((p) => String(p.id)).join(",")],
        { encoding: "utf8" },
      );
      processRssBytes = rss
        .trim()
        .split(/\s+/)
        .reduce((sum, kib) => sum + Number(kib) * 1024, 0);
    }
    started = performance.now();
    await page.reload();
    await expect(page.getByLabel("Workspace save status")).toHaveText(
      "Saved locally",
    );
    await expect(tool).toBeVisible();
    await paint();
    const reloadToFramesMs = performance.now() - started;
    assert.equal(jobs, 0);
    rows.push({
      tools: count,
      sourceBytes: 900014,
      checkedPoints: 201,
      authoredMoves: 35,
      changedRevisions: 35,
      openToFramesMs,
      pointerEventToTwoFramesMs: stats(frames),
      pointerUpToSavedMs: stats(durable),
      toolNodes: stats(toolNodes),
      initialHeapBytes,
      settledHeapBytes,
      retainedJsGrowthBytes: settledHeapBytes - initialHeapBytes,
      browserProcesses: processes.length,
      summedProcessRssBytes: processRssBytes,
      reloadToFramesMs,
      executionOnOpenOrLayout: jobs,
    });
  } finally {
    await browser.close();
  }
}
assert.deepEqual(errors, []);
const report = {
  date: new Date().toISOString(),
  sourceDigest: canvasSourceDigest(),
  browser: version,
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
  },
  limits,
  method:
    "Fresh Chrome process per 1/8/24-tool row at 1800×1100, one model, one pinned named layout, one 900,014-byte CSV and checked 201-point receipt. Real model-scope navigation; five warmups +30 alternating trusted tool drags of three pointer moves, one accepted revision each. Event-to-two-RAF measures page-side rendering opportunities, not compositor paint latency; pointer-up-to-Saved includes automation and IndexedDB. Times are device distributions, not product latency SLOs. Forced-GC page JS before/after 35 edits gates 128 MiB and 8 MiB retained growth; DOM gates 80 descendants per tool. Browser CDP process list plus ps summed RSS is diagnostic, may double-count shared memory and is not unique physical memory or a product capacity promise. Open/reload starts no execution. Workload does not represent all document sizes, source parsers, renderers or tools.",
  rows,
};
await writeFile(
  new URL(
    "../../../evidence/current/canvas/canvas-scene-browser-results.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
