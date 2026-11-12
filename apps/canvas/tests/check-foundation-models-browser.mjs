import { browserOptions } from "../../../scripts/browser.mjs";
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { canvasSourceDigest } from "../tools/canvas-source-digest.mjs";
import { decodeWorkspace, archive } from "../src/regions/artifacts.ts";
import { RegionSession } from "../src/regions/document.ts";
import { readWorkspace } from "./browser-workspace.mjs";
import {
  inspectModel,
  insertModel,
  modelReference,
  modelRequest,
} from "../src/regions/modelCommands.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  errors = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1600, height: 1100 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await expect(page.locator(".er-canvas")).toBeVisible();
  const command = async (name) => {
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Search objects and commands", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Search commands", exact: true })
      .fill(name);
    await page.getByRole("button", { name, exact: true }).click();
  };
  await command("Insert spring model");
  await expect(page.getByLabel("Spring model", { exact: true })).toHaveCount(1);
  // Position through the real move handle before adding the next model.
  const first = page.getByLabel("Spring model", { exact: true }).first();
  const initial = await first.boundingBox();
  const handle = first.getByLabel("Move Spring model"),
    at = await handle.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + 500, at.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await first.boundingBox()).x)
    .toBeGreaterThan(initial.x + 250);
  await command("Insert spring model");
  await expect(page.getByLabel("Spring model", { exact: true })).toHaveCount(2);
  const cards = page.getByLabel("Spring model", { exact: true }),
    second = cards.nth(1);
  const displacement = second.getByLabel("Spring Displacement", {
    exact: true,
  });
  await displacement.fill("3");
  await displacement
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Use value", exact: true })
    .click();
  await expect(cards.nth(0).getByLabel("Model force")).toHaveText("20 N");
  await expect(second.getByLabel("Model force")).toHaveText("30 N");
  await expect(second.getByLabel("Spring Displacement")).toHaveValue("3");
  await second
    .getByRole("button", { name: "Compute model", exact: true })
    .click();
  await expect(second.locator(".im-status")).toContainText("current");
  await displacement.fill("9");
  await displacement
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await expect(second.getByLabel("Model force")).toHaveText("90 N");
  await second
    .getByRole("button", { name: "Compute model", exact: true })
    .click();
  await expect(second.locator(".im-status")).toContainText("current");
  await second
    .getByRole("button", { name: "Keep comparison", exact: true })
    .click();
  const comparison = page.getByLabel("Spring comparison", { exact: true });
  await expect(comparison.getByLabel("Model force")).toHaveText("90 N");
  await expect(second.getByLabel("Model force")).toHaveText("30 N");
  await expect(comparison.locator(".im-status")).toContainText("current");
  await expect(second.getByLabel("Spring Displacement")).toHaveValue("3");
  await page.keyboard.press("Control+z");
  await expect(comparison).toHaveCount(0);
  await displacement.fill("11");
  await displacement
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await expect(second.getByLabel("Model force")).toHaveText("110 N");
  await displacement.focus();
  await displacement.press("Escape");
  await expect(second.getByLabel("Model force")).toHaveText("30 N");
  await expect(displacement).toHaveValue("3");
  // Use the real CSV import and explicit source-cell review.
  const saved = await readWorkspace(page),
    owner = new RegionSession(
      saved.page,
      () => [],
      saved.document,
      saved.artifacts,
      false,
      saved.recovery,
    );
  const dataset = owner.importData("spring-data.csv", "x [mm]\n7\n8", {
    x: 900,
    y: 700,
  });
  const bytes = archive(owner.native());
  await page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "models.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(bytes),
  });
  await page.waitForURL(/\?canvas=/);
  const bound = page.getByLabel("Spring model", { exact: true }).nth(1);
  await bound.getByText("Connect Displacement", { exact: true }).click();
  await bound
    .getByLabel("Source for Displacement")
    .selectOption(JSON.stringify(["csv", dataset]));
  await bound
    .getByRole("button", { name: "Review connection", exact: true })
    .click();
  await expect(
    bound.getByRole("region", { name: "Connection review" }),
  ).toContainText("7 mm");
  await expect(bound.getByLabel("Model force")).toHaveText("30 N");
  await bound
    .getByRole("button", { name: "Accept connection", exact: true })
    .click();
  await expect(bound.getByLabel("Model force")).toHaveText("70 N");
  await bound
    .getByRole("button", { name: "Compute model", exact: true })
    .click();
  await expect(bound.locator(".im-status")).toContainText("current");
  await command("Insert force scale model");
  const scale = page.getByLabel("Force scale model", { exact: true });
  const sourceId = await page
    .getByLabel("Spring model", { exact: true })
    .first()
    .getAttribute("data-independent-model");
  await scale.getByText("Connect Load", { exact: true }).click();
  await scale
    .getByLabel("Source for Load")
    .selectOption(JSON.stringify(["model", sourceId, "force"]));
  await scale
    .getByRole("button", { name: "Review connection", exact: true })
    .click();
  await expect(
    scale.getByRole("region", { name: "Connection review" }),
  ).toContainText("20 N");
  await scale
    .getByRole("button", { name: "Accept connection", exact: true })
    .click();
  await expect(scale.getByLabel("Model force")).toHaveText("40 N");
  const sourceInput = page
    .getByLabel("Spring model", { exact: true })
    .first()
    .getByLabel("Spring Displacement");
  await sourceInput.fill("4");
  await sourceInput.press("Enter");
  await expect(scale.getByLabel("Model force")).toHaveText("80 N");
  await expect(bound.getByLabel("Model force")).toHaveText("70 N");
  const key = `manifold.artifact-experiment.v1.canvas-${new URL(page.url()).searchParams.get("canvas")}`;
  await readWorkspace(page, key);
  await page.reload();
  await expect(bound.getByLabel("Model force")).toHaveText("70 N");
  await expect(bound.locator(".im-status")).toContainText("current");
  const download = page.waitForEvent("download");
  const gain = page.getByLabel("Force scale Gain", { exact: true });
  await gain.fill("3");
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Save workspace file");
  await page
    .getByRole("button", { name: "Save workspace file", exact: true })
    .click();
  const wire = await readFile(await (await download).path(), "utf8"),
    portable = await decodeWorkspace(wire),
    fresh = new RegionSession(
      portable.page,
      () => [],
      portable.document,
      portable.artifacts,
      false,
      portable.recovery,
    ),
    id = await bound.getAttribute("data-independent-model");
  expect(inspectModel(fresh, id).body.inputs.displacement.kind).toBe(
    "reference",
  );
  const scaleId = [...fresh.document.items.entries()].find(
    ([, item]) => item.label === "Force scale",
  )[0];
  expect(inspectModel(fresh, scaleId).body.inputs.factor.value).toBe(3);
  expect(
    fresh.foundation.result(modelReference(fresh.document, modelRequest(id)))
      .status,
  ).toBe("current");
  const isolated = await browser.newContext({
      viewport: { width: 1600, height: 1100 },
    }),
    other = await isolated.newPage();
  other.on("pageerror", (e) => errors.push(e.message));
  await other.goto(base);
  await other.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "portable.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(wire),
  });
  await other.waitForURL(/\?canvas=/);
  await expect(
    other
      .getByLabel("Spring model", { exact: true })
      .nth(1)
      .getByLabel("Model force"),
  ).toHaveText("70 N");
  await expect(
    other
      .getByLabel("Spring model", { exact: true })
      .nth(1)
      .locator(".im-status"),
  ).toContainText("current");
  expect(errors).toEqual([]);
  const rendering = [];
  for (const count of [1, 16, 64]) {
    const fixture = new RegionSession();
    for (let i = 0; i < count; i++)
      insertModel(fixture, "spring", {
        x: 100 + (i % 8) * 450,
        y: 100 + Math.floor(i / 8) * 550,
      });
    const text = archive(fixture.native()),
      isolated = await browser.newContext({
        viewport: { width: 1600, height: 1100 },
      }),
      display = await isolated.newPage();
    display.on("pageerror", (e) => errors.push(e.message));
    await display.goto(base);
    await expect(display.locator(".er-canvas")).toBeVisible();
    const started = performance.now();
    await display
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles({
        name: "rendering.manifold",
        mimeType: "application/json",
        buffer: Buffer.from(text),
      });
    await display.waitForURL(/\?canvas=/);
    await expect(display.locator(".im-card")).toHaveCount(count);
    await display.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const openToPaintMs = performance.now() - started,
      dom = await display.evaluate(() => ({
        nodes: document.querySelectorAll(".im-card *").length,
        eagerConnectionOptions:
          document.querySelectorAll(".im-card option").length,
      })),
      cdp = await isolated.newCDPSession(display);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = (await cdp.send("Performance.getMetrics")).metrics,
      heapBytes = metrics.find((m) => m.name === "JSHeapUsedSize").value;
    expect(dom.nodes / count).toBeLessThanOrEqual(120);
    expect(dom.eagerConnectionOptions).toBe(0);
    expect(heapBytes).toBeLessThan(128 * 1024 * 1024);
    const key = `manifold.artifact-experiment.v1.canvas-${new URL(display.url()).searchParams.get("canvas")}`,
      saved = await readWorkspace(display, key);
    expect(saved.recovery.foundation.receipts).toHaveLength(0);
    rendering.push({
      instances: count,
      openToPaintMs,
      ...dom,
      heapBytes,
      receiptsAfterOpen: saved.recovery.foundation.receipts.length,
    });
    await isolated.close();
    fixture.dispose();
  }
  expect(errors).toEqual([]);
  await writeFile(
    new URL(
      "../../../evidence/current/canvas/foundation-models-browser-results.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        sourceDigest: canvasSourceDigest(),
        browser: browser.version(),
        method:
          "Real model workflow plus 1/16/64 model file Open in isolated Chrome contexts at 1600×1100. Open-to-two-frames is one end-to-end diagnostic per row, not a latency distribution. DOM excludes the existing worksheet shell; connection options remain unmounted until requested. Heap is page JS used after forced GC, not process heap or device capacity. Limits: 120 descendant nodes per model, zero eager connection options, 128 MiB page-JS guard, zero execution receipts created on Open. Broader rendering/input and production resource acceptance stay open.",
        rendering,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Canvas model browser: real insertion, move, independent inputs, execution, preview/Keep/Undo, CSV review, recovery and isolated native handoff pass.",
  );
} finally {
  await browser.close();
}
