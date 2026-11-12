import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence, evidenceEnabled } from "./browser-evidence.mjs";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
const baseURL = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
import { chromium, expect } from "@playwright/test";
import { project } from "../src/regions/document.ts";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 1870, height: 1080 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const model = async () => (await readWorkspace(page)).page;
try {
  await page.goto(`${baseURL}/?think=1&artifacts=1`);
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await page
    .getByLabel("Empty engineering page", { exact: true })
    .click({ position: { x: 100, y: 80 } });
  for (const text of ["P = force*speed", "P <= 80 W"]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  await expect(page.locator(".is-data-connected")).toHaveCount(0);
  await page.getByLabel("Import CSV file").setInputFiles({
    name: "paired-measurements.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("force [N],speed [m/s]\n20,3\n24,4"),
  });
  await page
    .getByRole("button", { name: "Select measurement row 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select column force [N]", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select column speed [m/s]", exact: true })
    .click();
  const handle = page.getByLabel("Drag selected columns to equation"),
    equation = page.locator('[data-kind="equation"] math');
  await handle.dragTo(equation);
  const dialog = page.getByRole("dialog", { name: "Connect dataset to model" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("60 W");
  await expect(dialog).toContainText("96 W");
  await expect(
    dialog.getByRole("button", { name: "Connect & calculate" }),
  ).toBeDisabled();
  checks.push(
    "Columns drag onto an existing unresolved equation and preview all paired records without modifying scalar definitions",
  );
  await dialog.getByRole("radio", { name: "Selected record (scalar)" }).check();
  await expect(dialog).toContainText("1 record → P");
  await expect(dialog).not.toContainText("60 W");
  await dialog.getByRole("radio", { name: "All 2 rows (vector)" }).check();
  const beforeInvalidUnits = await model();
  await dialog.getByLabel("Units for speed [m/s]", { exact: true }).fill("kg");
  await expect(dialog).toContainText(
    /result P has units .+, but its limit has units W/,
  );
  await expect(
    dialog.getByRole("button", { name: "Connect & calculate" }),
  ).toBeDisabled();
  expect(await model()).toEqual(beforeInvalidUnits);
  await dialog.getByLabel("Units for speed [m/s]", { exact: true }).fill("m/s");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Connect & calculate" }).click();
  const result = page.locator("[data-data-relation-id]");
  await expect(result).toBeVisible();
  await expect(result).toContainText("Calculated from measured inputs");
  await expect(result).toContainText("1/2 within limit");
  expect(project(await model()).solved.values.has("P")).toBe(false);
  expect((await model()).regions.length).toBe(3);
  checks.push(
    "Scalar versus whole-column scope is explicit; unit mismatch blocks acceptance; accepted vectors do not create scalar or per-cell objects",
  );
  await result
    .getByRole("button", { name: "Inspect measured row 2: 96 W", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select measurement row 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.locator("[data-relationship-kind]").count(),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole("button", { name: "Trace relationship", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Follow calculation P", exact: true })
    .click();
  await expect(page.locator(".er-data-trace")).toContainText("Row 2");
  await expect(
    page.getByRole("button", { name: "Follow input force", exact: true }),
  ).toContainText("24 N");
  await expect(
    page.getByRole("button", { name: "Follow input speed", exact: true }),
  ).toContainText("4 m/s");
  await expect(page.locator(".er-data-trace .er-record-inputs")).toHaveCount(0);
  await expect(page.locator(".er-data-trace")).toContainText(
    "P = 24 × 4 = 96 W",
  );
  await expect(page.locator(".er-data-trace")).toContainText(
    "Exceeds limit by 16 W",
  );
  await expect(
    page.getByLabel("Selected engineering relationships"),
  ).toBeVisible();
  expect(
    await page.locator('[data-relationship-kind="evidence"]').count(),
  ).toBe(2);
  await expect(result.locator(".er-data-feasibility")).toContainText(
    "80 W limit",
  );
  await result
    .getByRole("button", { name: "Inspect measured row 1: 60 W", exact: true })
    .click({ modifiers: ["Shift"] });
  await page
    .getByRole("button", { name: "Follow calculation P", exact: true })
    .click();
  await expect(page.getByLabel("Selected record comparison")).toContainText(
    "20 W below limit",
  );
  await expect(page.getByLabel("Selected record comparison")).toContainText(
    "Exceeds limit by 16 W",
  );
  await page
    .getByRole("button", { name: "Follow source row 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse dataset", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use row 2, force [N]", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Follow measurement source", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use row 2, force [N]", exact: true }),
  ).toBeVisible();
  checks.push(
    "A record reveals paired inputs, substituted mathematics, requirement margin and temporary paths; Shift-selection compares observations and following evidence expands its source",
  );
  await page
    .getByRole("button", { name: "Clear relationship selection", exact: true })
    .click();
  await expect(
    page.getByLabel("Selected engineering relationships"),
  ).toHaveCount(0);
  await expect(page.locator(".er-data-trace")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select column force [N]", exact: true })
    .click();
  await expect(page.getByLabel("Dataset selection")).toContainText("Series");
  await expect(
    page.locator('[data-kind="equation"] [data-symbol="force"]'),
  ).toHaveClass(/is-linked/);
  await expect(
    page.locator('[data-kind="equation"] [data-symbol="speed"]'),
  ).not.toHaveClass(/is-linked/);
  await page.locator('[data-kind="equation"] [data-symbol="force"]').click();
  await expect(page.getByLabel("Dataset selection")).toContainText("Series");
  await revealRegionActions(page);
  await page
    .locator('.er-object-actions [data-command-id="definition.edit"]')
    .click();
  await expect(editor).toHaveValue("P = force*speed");
  await editor.fill("P = 2*force*speed");
  await editor.press("Escape");
  await expect(
    page.getByRole("button", {
      name: "Inspect measured row 2: 192 W",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Inspect measured row 2: 96 W",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use row 1, force [N]", exact: true })
    .click();
  await expect(page.getByLabel("Dataset selection")).toContainText("Cell");
  await expect(
    page.getByRole("form", { name: "Define measurement quantity" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select measurement row 2", exact: true })
    .click();
  await expect(page.getByLabel("Dataset selection")).toContainText("Record");
  expect(project(await model()).solved.values.has("P")).toBe(false);
  checks.push(
    "Cell, record and series have distinct selection feedback; inspection remains separate from scalar extraction and clearing selection removes causal overlays",
  );
  await expect(
    page.locator('[data-kind="equation"] [data-symbol="speed"]'),
  ).toHaveClass(/is-linked/);
  checks.push(
    "Inspecting a calculated point highlights its paired source row, mathematical input and provenance trace without changing assumptions",
  );
  await result.hover();
  await result.getByRole("button", { name: "Table", exact: true }).click();
  await expect(result).toContainText("96 W");
  await expect(result).toContainText("Outside limit");
  await expect(
    result.locator('[data-calculated-row="1"] [data-derived-value]'),
  ).toContainText("96 W");
  await result.getByRole("button", { name: "Plot", exact: true }).click();
  const pageBeforeFocus = await model();
  await result.hover();
  await result
    .getByRole("button", { name: "Focus calculated dataset", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Return to canvas", exact: true })
    .click();
  expect(await model()).toEqual(pageBeforeFocus);

  if (evidenceEnabled) {
    await page
      .getByRole("button", { name: "Select measurement row 2", exact: true })
      .click();
    await captureEvidence(page, {
      path: "/tmp/manifold-dataset/connected-dataset.png",
    });
  }
  const before = await model();
  await result
    .getByLabel("Move calculated dataset")
    .dragTo(page.locator(".er-paper"), { targetPosition: { x: 1130, y: 630 } });
  const after = await model();
  expect(after.dataRelations).toEqual(before.dataRelations);
  expect(after.layout).not.toEqual(before.layout);
  await page.reload();
  await expect(page.locator("[data-data-relation-id]")).toContainText(
    "1/2 within limit",
  );
  checks.push(
    "Plot and table share the relation; moving it preserves computation and recovery reevaluates from portable source data",
  );
  // Framing this optional capture is unrelated to the recovery assertions above.
  if (evidenceEnabled) {
    await page
      .getByRole("button", { name: "Select measurement row 2", exact: true })
      .click();
    await page.getByRole("button", { name: "Fit page", exact: true }).click();
    await captureEvidence(page, {
      path: "/tmp/manifold-dataset/restored-dataset.png",
    });
  }
  // Large source: new isolated browser context; never touch the user's saved canvas.
  const large = await browser.newPage({
    viewport: { width: 1870, height: 1080 },
  });
  await large.goto(`${baseURL}/?think=1&artifacts=1`);
  await large.getByLabel("Import CSV file").setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "force [N],speed [m/s]\n" +
        Array.from({ length: 10000 }, (_, i) => `${20 + i / 1000},3`).join(
          "\n",
        ),
    ),
  });
  await expect(large.getByLabel("Data source large.csv")).toContainText(
    "10000 measurements",
  );
  expect(await large.locator(".er-data tbody tr").count()).toBe(40);
  await large
    .getByLabel("Empty engineering page", { exact: true })
    .click({ position: { x: 100, y: 620 } });
  const largeEditor = large.getByLabel("Write an engineering region", {
    exact: true,
  });
  await largeEditor.fill("P = force*speed");
  await largeEditor.press("Escape");
  await large
    .getByRole("button", { name: "Select column force [N]", exact: true })
    .click();
  await large
    .getByRole("button", { name: "Select column speed [m/s]", exact: true })
    .click();
  await large
    .getByRole("button", { name: "Connect to equation…", exact: true })
    .click();
  const largeReview = large.getByRole("dialog", {
    name: "Connect dataset to model",
  });
  await expect(largeReview).toContainText("10000 records → P");
  await largeReview.getByRole("checkbox").check();
  await largeReview
    .getByRole("button", { name: "Connect & calculate" })
    .click();
  expect(
    await large
      .locator("[data-data-relation-id] circle[data-measurement-row]")
      .count(),
  ).toBe(1000);
  await large.locator("[data-data-relation-id]").hover();
  await large
    .locator("[data-data-relation-id]")
    .getByRole("button", { name: "Table", exact: true })
    .click();
  expect(await large.locator("[data-data-relation-id] tbody tr").count()).toBe(
    40,
  );
  await large.close();
  checks.push(
    "A 10,000-record CSV evaluates all rows as one dataset; both tables and plot rendering stay bounded",
  );
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
