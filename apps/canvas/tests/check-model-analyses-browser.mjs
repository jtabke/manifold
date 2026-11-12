import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { stageWorkspaceFile } from "../src/regions/app/workspaceFiles.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  reviewModelCsv,
  applyModelConnection,
} from "../src/regions/modelCommands.ts";
import { createModelAnalysis } from "../src/regions/modelAnalysisCommands.ts";
import { canvasSourceDigest } from "../tools/canvas-source-digest.mjs";
import { readWorkspace } from "./browser-workspace.mjs";
const source = {
  rows: [
    { id: "force", text: "F = 20 N" },
    { id: "speed", text: "v = 3 m/s" },
    { id: "power", text: "P = F*v" },
  ],
  inputs: ["force", "speed"],
  outputs: ["power"],
};
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const open = (page, text) =>
  page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "analysis.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
try {
  const s = new RegionSession(),
    def = publishModel(s, "Drive", source),
    instance = instantiateModel(s, modelReference(s.document, def), {
      x: 0,
      y: 0,
    });
  const csv = s.importData("force.csv", "F\n30\n", { x: 0, y: 900 });
  applyModelConnection(s, reviewModelCsv(s, instance, "force", csv, 0, 0, "N"));
  const native = archive(s.native());
  s.dispose();
  const context = await browser.newContext({
      viewport: { width: 1800, height: 1100 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(base);
  await open(page, native);
  const card = page.getByLabel("Drive model", { exact: true });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Analyze model", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Analyze model",
    exact: true,
  });
  await editor
    .getByLabel("Swept model input", { exact: true })
    .selectOption("speed");
  await editor.getByLabel("Range start", { exact: true }).fill("0");
  await editor.getByLabel("Range end", { exact: true }).fill("10");
  await editor.getByLabel("Sweep points", { exact: true }).fill("51");
  const before = (await readWorkspace(page)).document.id;
  await open(page, native);
  await expect(editor.getByRole("alert")).toContainText(
    "Apply, preview or cancel",
  );
  assert.equal((await readWorkspace(page)).document.id, before);
  await editor
    .getByRole("button", { name: "Create analysis", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const analysis = page.locator(
    '[data-model-analysis][data-analysis-comparison="false"]',
  );
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("ready");
  await analysis
    .getByRole("button", { name: "Compute analysis", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("current");
  await expect(
    analysis.getByRole("img", { name: "P versus v", exact: true }),
  ).toHaveCount(1);
  await expect(analysis.locator("tbody tr")).toHaveCount(25);
  await analysis
    .getByRole("button", { name: "Next points", exact: true })
    .click();
  await analysis
    .getByRole("button", { name: "Next points", exact: true })
    .click();
  await analysis
    .getByRole("button", { name: "Inspect point 51", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Selected analysis point", { exact: true }),
  ).toContainText("P = 300 W");
  await expect(card.getByLabel("Model P", { exact: true })).toContainText(
    "90 W",
  );
  await analysis
    .getByRole("button", { name: "Edit analysis settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Edit model analysis",
    exact: true,
  });
  await settings.getByLabel("Range end", { exact: true }).fill("5");
  await settings.getByLabel("Sweep points", { exact: true }).fill("11");
  await settings
    .getByRole("button", { name: "Preview analysis settings", exact: true })
    .click();
  await expect(
    analysis.getByText("Analysis preview", { exact: true }),
  ).toBeVisible();
  await analysis
    .getByRole("button", { name: "Compute analysis", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("current");
  await analysis
    .getByRole("button", { name: "Inspect point 11", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Selected analysis point", { exact: true }),
  ).toContainText("P = 150 W");
  await analysis
    .getByRole("button", { name: "Keep analysis", exact: true })
    .click();
  const kept = page.locator(
    '[data-model-analysis][data-analysis-comparison="true"]',
  );
  await expect(kept).toHaveCount(1);
  await kept.getByText("Captured model and sources", { exact: true }).click();
  await expect(
    kept.getByLabel("Captured analysis inputs", { exact: true }),
  ).toContainText("F = 30 N");
  await expect(
    kept.getByLabel("Captured model equations", { exact: true }),
  ).toContainText("P = F*v");
  await kept
    .getByRole("button", { name: "Inspect point 11", exact: true })
    .click();
  await expect(
    kept.getByLabel("Selected analysis point", { exact: true }),
  ).toContainText("P = 150 W");
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("51 points");
  await card
    .getByRole("button", { name: "Edit model definition", exact: true })
    .click();
  const revision = page.getByRole("dialog", {
    name: "Revise model definition",
    exact: true,
  });
  await revision
    .getByLabel("Model equation 3", { exact: true })
    .fill("P = 2*F*v");
  await revision
    .getByRole("button", { name: "Publish model revision", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Review definition update", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Accept definition update", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("ready");
  await expect(analysis.locator("table")).toHaveCount(0);
  await expect(
    kept.getByLabel("Captured model equations", { exact: true }),
  ).toContainText("P = F*v");
  await expect(
    kept.getByLabel("Captured model equations", { exact: true }),
  ).not.toContainText("P = 2*F*v");
  await analysis
    .getByRole("button", { name: "Compute analysis", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("current");
  await analysis
    .getByRole("button", { name: "Next points", exact: true })
    .click();
  await analysis
    .getByRole("button", { name: "Next points", exact: true })
    .click();
  await expect(
    analysis.getByLabel("Selected analysis point", { exact: true }),
  ).toContainText("P = 600 W");
  await expect(
    kept.getByLabel("Selected analysis point", { exact: true }),
  ).toContainText("P = 150 W");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    analysis.getByLabel("Analysis status", { exact: true }),
  ).toContainText("current");
  await expect(
    analysis.getByLabel("Selected analysis point", { exact: true }),
  ).toContainText("P = 0 W");
  await analysis
    .getByRole("button", { name: "Edit analysis settings", exact: true })
    .click();
  const accepted = (await readWorkspace(page)).document.id;
  await settings.getByLabel("Range end", { exact: true }).fill("-1");
  await settings
    .getByRole("button", { name: "Apply analysis settings", exact: true })
    .click();
  await expect(settings.getByRole("alert")).toContainText(
    "increasing finite range",
  );
  assert.equal((await readWorkspace(page)).document.id, accepted);
  await settings
    .getByRole("button", { name: "Cancel analysis editing", exact: true })
    .click();
  await analysis
    .getByRole("button", { name: "Remove analysis", exact: true })
    .click();
  await expect(analysis).toHaveCount(0);
  await expect(kept).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(analysis).toHaveCount(1);
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByLabel("Search commands", { exact: true })
    .fill("Export workspace");
  const pendingDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export workspace", exact: true })
    .click();
  const saved = await readFile(await (await pendingDownload).path(), "utf8"),
    verified = await stageWorkspaceFile(saved);
  assert.equal(verified.executionDiagnostics.running, 0);
  verified.dispose();
  const recipient = await browser.newContext({
      viewport: { width: 1800, height: 1100 },
    }),
    fresh = await recipient.newPage();
  await fresh.goto(base);
  await open(fresh, saved);
  await expect(fresh.locator("[data-model-analysis]")).toHaveCount(2);
  await expect(
    fresh
      .locator('[data-analysis-comparison="true"]')
      .getByLabel("Analysis status", { exact: true }),
  ).toContainText("current");
  await fresh.reload();
  await expect(fresh.locator("[data-model-analysis]")).toHaveCount(2);
  await expect(
    fresh
      .locator('[data-analysis-comparison="true"]')
      .getByLabel("Analysis status", { exact: true }),
  ).toContainText("current");
  assert.deepEqual(errors, []);
  await recipient.close();
  await context.close();
  const rows = [];
  for (const count of [1, 8, 16]) {
    const fixture = new RegionSession(),
      definition = publishModel(fixture, "Drive", source),
      model = instantiateModel(
        fixture,
        modelReference(fixture.document, definition),
        { x: 0, y: 0 },
      );
    for (let i = 0; i < count; i++) {
      const id = createModelAnalysis(
        fixture,
        model,
        { input: "speed", output: "power", low: 0, high: 10, points: 201 },
        { x: 430 + i * 560, y: 0 },
      );
      await fixture.compute(modelReference(fixture.document, id)).completion;
    }
    const context = await browser.newContext({
        viewport: { width: 1800, height: 1100 },
      }),
      page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await open(page, archive(fixture.native()));
    fixture.dispose();
    await expect(page.locator("[data-model-analysis]")).toHaveCount(count);
    await expect(page.locator("[data-model-analysis] table")).toHaveCount(
      count,
    );
    const sizes = await page
      .locator("[data-model-analysis]")
      .evaluateAll((cards) =>
        cards.map((c) => ({
          descendants: c.querySelectorAll("*").length,
          rows: c.querySelectorAll("tbody tr").length,
          points: c
            .querySelector("polyline")
            ?.getAttribute("points")
            ?.split(" ").length,
        })),
      );
    assert.ok(
      sizes.every(
        (s) => s.descendants <= 400 && s.rows === 25 && s.points === 201,
      ),
    );
    assert.deepEqual(errors, []);
    rows.push({
      analyses: count,
      maxDescendants: Math.max(...sizes.map((s) => s.descendants)),
      maxTableRows: Math.max(...sizes.map((s) => s.rows)),
      maxCurvePoints: Math.max(...sizes.map((s) => s.points)),
    });
    await context.close();
  }
  await writeFile(
    new URL(
      "../../../evidence/current/canvas/model-analyses-browser-results.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        sourceDigest: canvasSourceDigest(),
        browser: await browser.version(),
        method:
          "Fresh contexts at 1/8/16 checked analyses with 201 points. Actual shared receipt table/curve DOM; 25-row pagination. Functional source-backed author/settings/preview/Keep/revision/Undo/native/fresh/local workflows. No interactive latency or heap capacity claim.",
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Model analysis browser: source-backed sweep, shared table/curve, pagination/selection, preview/Keep, pinned revision/Undo, refused drafts and fresh native/local continuation; 1/8/16 view DOM limits pass.",
  );
} finally {
  await browser.close();
}
