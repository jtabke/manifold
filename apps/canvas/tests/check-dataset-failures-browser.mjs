import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
async function openFixture(count, force) {
  // A legitimate imported region ID may be "all"; filter modes must never
  // collide with a requirement's durable identity.
  const session = new RegionSession({
    regions: [
      { id: "all", text: "P <= 10 W", mathVersion: 3 },
      { id: "lower-bound", text: "P >= 0 W", mathVersion: 3 },
    ],
    contexts: [{ id: "original", label: "Original", base: {}, overrides: {} }],
    active: "original",
    layout: { all: { x: 100, y: 210 }, "lower-bound": { x: 100, y: 320 } },
    plots: [],
    origin: { x: 100, y: 100 },
  });
  const add = (text, y) => {
    const id = session.create({ x: 100, y });
    session.write(id, text);
    return id;
  };
  const output = add("P = force*speed", 100);
  const dataset = session.importData(
    "observations.csv",
    "force [N],speed [m/s]\n" +
      Array.from({ length: count }, (_, row) => `${force(row)},1`).join("\n"),
    { x: 100, y: 650 },
  );
  const relation = session.bindDataset(
    {
      id: "data-relation-preview",
      dataset,
      output,
      bindings: [
        { symbol: "force", column: 0, unit: "N" },
        { symbol: "speed", column: 1, unit: "m/s" },
      ],
      scope: { kind: "all" },
      paired: true,
    },
    { x: 720, y: 100 },
  );
  const source = archive(session.native());
  session.dispose();
  const page = await browser.newPage({
    viewport: { width: 1900, height: 1100 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    source,
  );
  await page.goto(base);
  await readWorkspace(page);
  return {
    page,
    dataset,
    plot: page.locator(`[data-data-relation-id="${relation}"]`),
  };
}

try {
  const { page, dataset, plot } = await openFixture(10000, (row) =>
    row === 173 ? -5 : row === 5001 ? 1000 : row === 9007 ? 25 : 1,
  );
  const unchanged = await readWorkspaceBytes(page);
  await expect(plot.locator("circle[data-measurement-row]")).toHaveCount(1000);
  for (const row of [173, 5001, 9007]) {
    await expect(
      plot.locator(`circle[data-measurement-row="${row}"]`),
    ).toHaveCount(1);
  }
  await plot
    .getByRole("button", { name: "Show failing records (3)", exact: true })
    .click();
  await expect(plot.locator("tbody tr")).toHaveCount(3);
  expect(
    await plot
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) => Number(row.dataset.calculatedRow)),
      ),
  ).toEqual([173, 5001, 9007]);
  await expect(
    plot.getByRole("status").filter({ hasText: "Failure 1 of 3" }),
  ).toContainText("Row 174");
  await plot
    .getByRole("button", { name: "Next failing record", exact: true })
    .press("Enter");
  await expect(
    plot.getByRole("status").filter({ hasText: "Failure 2 of 3" }),
  ).toContainText("Row 5002");
  await plot
    .getByRole("button", { name: "Show source row 5002", exact: true })
    .click();
  const sourceRow = page.locator(
    `[data-region-id="${dataset}"] [data-source-row="5001"]`,
  );
  await expect(sourceRow).toBeInViewport();
  await expect(sourceRow).toHaveClass(/is-record-selected/);
  await expect(sourceRow).toContainText("1000");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(plot).toBeInViewport();
  await expect(
    plot.getByRole("status").filter({ hasText: "Failure 2 of 3" }),
  ).toContainText("Row 5002");
  await plot
    .getByRole("button", { name: "Previous failing record", exact: true })
    .click();
  await plot
    .getByRole("button", { name: "Previous failing record", exact: true })
    .click();
  await expect(
    plot.getByRole("status").filter({ hasText: "Failure 3 of 3" }),
  ).toContainText("Row 9008");
  await plot
    .getByRole("button", {
      name: "Show failing records for P <= 10 W",
      exact: true,
    })
    .click();
  expect(
    await plot
      .locator("tbody tr")
      .evaluateAll((rows) =>
        rows.map((row) => Number(row.dataset.calculatedRow)),
      ),
  ).toEqual([5001, 9007]);
  await plot
    .getByRole("button", {
      name: "Show failing records for P >= 0 W",
      exact: true,
    })
    .click();
  await expect(plot.locator("tbody tr")).toHaveCount(1);
  await expect(
    plot.getByRole("button", {
      name: "Inspect calculated row 174",
      exact: true,
    }),
  ).toBeVisible();
  await plot
    .getByRole("button", { name: "Show all records", exact: true })
    .click();
  await expect(plot.locator("tbody tr")).toHaveCount(40);
  await plot.getByRole("button", { name: "Plot", exact: true }).click();
  await expect(plot.locator("circle[data-measurement-row]")).toHaveCount(1000);
  expect(await readWorkspaceBytes(page)).toBe(unchanged);
  await page.close();

  const many = await openFixture(2500, (row) => 20 + row / 1000);
  const manyBefore = await readWorkspaceBytes(many.page);
  await expect(many.plot.locator("circle[data-measurement-row]")).toHaveCount(
    1000,
  );
  await expect(
    many.plot
      .getByRole("status")
      .filter({ hasText: "1500 failing records are not shown individually" }),
  ).toBeVisible();
  await many.plot
    .getByRole("button", { name: "Show failing records (2500)", exact: true })
    .click();
  await expect(many.plot.locator("tbody tr")).toHaveCount(40);
  await expect(many.plot).toContainText("1–40 of 2500");
  await many.plot
    .getByRole("button", { name: "Previous failing record", exact: true })
    .click();
  await expect(
    many.plot.getByRole("status").filter({ hasText: "Failure 2500 of 2500" }),
  ).toContainText("Row 2500");
  await expect(
    many.plot.getByRole("button", {
      name: "Inspect calculated row 2500",
      exact: true,
    }),
  ).toBeVisible();
  await many.plot
    .getByRole("button", { name: "Show source row 2500", exact: true })
    .click();
  await expect(
    many.page.locator(
      `[data-region-id="${many.dataset}"] [data-source-row="2499"]`,
    ),
  ).toBeInViewport();
  expect(await readWorkspaceBytes(many.page)).toBe(manyBefore);
  await many.page.close();
  expect(errors).toEqual([]);
  console.log(
    "Dataset failures: bounded extrema/failure-preserving plots, explicit overflow notices, all/requirement filters, keyboard next/previous wrap, distant original-source rows, Back and zero authored/storage changes pass.",
  );
} finally {
  await browser.close();
}
