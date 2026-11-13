import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { browserOptions } from "../../../scripts/browser.mjs";
import { RegionSession, project } from "../src/regions/document.ts";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { legacyWorkspace } from "./legacy-workspace-fixture.mjs";
import {
  readWorkspace,
  revealRegionActions,
  startWriting,
} from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1870, height: 1080 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await startWriting(page);
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  for (const text of ["P = power", "P <= 2.5 W"]) {
    await writer.fill(text);
    await writer.press("Enter");
  }
  await writer.press("Escape");
  await page.getByLabel("Import CSV file").setInputFiles({
    name: "electrical.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("power [V*A]\n2\n3"),
  });
  await page
    .getByRole("button", { name: "Select column power [V*A]", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect to equation…", exact: true })
    .click();
  const review = page.getByRole("dialog", { name: "Connect dataset to model" });
  await expect(review).toContainText("2 W");
  await expect(review).toContainText("3 W");
  const before = (await readWorkspace(page)).page;
  const units = review.getByLabel("Units for power [V*A]", { exact: true });
  await units.fill("V*A + 1");
  await expect(review).toContainText("Use supported units");
  await expect(
    review.getByRole("button", { name: "Connect & calculate" }),
  ).toBeDisabled();
  expect((await readWorkspace(page)).page).toEqual(before);
  await units.fill("V*A");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", { name: "Connect & calculate" }).click();
  const table = page.locator("[data-data-relation-id]");
  await expect(table).toContainText("1/2 within limit");

  // Extract the same observation without changing its declared unit or CSV cell.
  await page
    .getByRole("button", { name: "Use row 1, power [V*A]", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reference value", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Define measurement quantity" });
  await form.getByLabel("Measurement quantity name").fill("power");
  await expect(form.getByLabel("Measurement units")).toHaveValue("V*A");
  const beforeExtraction = (await readWorkspace(page)).page;
  await form.getByLabel("Measurement units").fill("2*V*A");
  await form
    .getByRole("button", { name: "Define quantity", exact: true })
    .click();
  await expect(form).toContainText("Use supported units");
  expect((await readWorkspace(page)).page).toEqual(beforeExtraction);
  await form.getByLabel("Measurement units").fill("V*A");
  await form
    .getByRole("button", { name: "Define quantity", exact: true })
    .click();
  await expect(page.locator('[data-result-for="P"]')).toContainText("2 W");
  await expect(page.locator(".er-source-caption")).toContainText(
    "Imported measurement",
  );
  const accepted = await readWorkspace(page);
  const measurement = accepted.page.regions.find((region) => region.source);
  expect(measurement.source.raw).toBe("2");
  expect(measurement.source.unit).toBe("V*A");
  expect(project(accepted.page).solved.values.get("power").value).toBe(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.locator(`[data-region-id="${measurement.id}"]`),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('[data-result-for="P"]')).toContainText("2 W");
  await expect(table).toContainText("1/2 within limit");

  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download file", exact: true })
    .click();
  const bytes = await readFile(await (await downloading).path());
  const decoded = await decodeWorkspace(bytes.toString());
  expect(
    decoded.page.regions.find((region) => region.id === measurement.id).source,
  ).toEqual(measurement.source);
  const fresh = await browser.newPage();
  fresh.on("pageerror", (error) => errors.push(error.message));
  await fresh.goto(base);
  await fresh.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "electrical.manifold",
    mimeType: "application/json",
    buffer: bytes,
  });
  await fresh.waitForURL(/\?canvas=/);
  await expect(fresh.locator('[data-result-for="P"]')).toContainText("2 W");
  await expect(fresh.locator("[data-data-relation-id]")).toContainText(
    "1/2 within limit",
  );
  await fresh.close();
  await page.close();

  // Vary must not reinterpret the ampere in a canonical voltage label as the
  // independently authored area variable A when it writes a new value.
  const voltage = new RegionSession();
  const area = voltage.create();
  voltage.write(area, "A := 50 m^2");
  const output = voltage.create();
  voltage.write(output, "result := measured");
  const voltageData = voltage.importData("voltage.csv", "reading\n2", {
    x: 700,
    y: 100,
  });
  const input = voltage.quantityFromCell(
    voltageData,
    0,
    0,
    "measured",
    "A*ohm",
    {
      x: 100,
      y: 250,
    },
  );
  const dimension = project(voltage.state).solved.values.get(
    "measured",
  ).dimension;
  const voltageFile = archive(voltage.native());
  voltage.dispose();
  const varying = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  varying.on("pageerror", (error) => errors.push(error.message));
  await varying.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    voltageFile,
  );
  await varying.goto(base);
  await readWorkspace(varying);
  const inputRegion = varying.locator(`[data-region-id="${input}"]`);
  await inputRegion.click({ position: { x: 400, y: 25 } });
  await revealRegionActions(varying);
  await varying
    .getByRole("toolbar", { name: "Quantity measured actions", exact: true })
    .locator('[data-command-id="quantity.vary"]')
    .click();
  const control = inputRegion.locator(".er-scrubbable").first();
  await control.focus();
  await control.press("ArrowRight");
  await expect(varying.locator('[data-result-for="result"]')).toContainText(
    "2.02",
  );
  expect(
    project((await readWorkspace(varying)).page).solved.values.get("measured")
      .value,
  ).toBe(2);
  await varying
    .getByLabel("Explore measured", { exact: true })
    .getByRole("button", { name: "Accept value", exact: true })
    .click();
  const changed = await readWorkspace(varying);
  expect(project(changed.page).solved.values.get("result").value).toBeCloseTo(
    2.02,
    12,
  );
  expect(project(changed.page).solved.values.get("result").dimension).toEqual(
    dimension,
  );
  expect(
    changed.page.regions.find((region) => region.id === input).source.unit,
  ).toBe("A*ohm");
  await expect(inputRegion.locator(".er-source-caption")).toContainText(
    "Edited assumption",
  );
  await varying.getByLabel("Undo", { exact: true }).click();
  expect(
    project((await readWorkspace(varying)).page).solved.values.get("result")
      .value,
  ).toBe(2);
  await varying.getByLabel("Redo", { exact: true }).click();
  const redone = project((await readWorkspace(varying)).page).solved.values.get(
    "result",
  );
  expect(redone.value).toBeCloseTo(2.02, 12);
  expect(redone.dimension).toEqual(dimension);
  await varying.close();

  const entries = await browser.newPage();
  entries.on("pageerror", (error) => errors.push(error.message));
  await entries.goto(base);
  await startWriting(entries);
  const entry = entries.getByLabel("Write an engineering region", {
    exact: true,
  });
  for (const text of [
    "duration := 2 min",
    "frequency := 1/min",
    "speed := 2 m/min",
    "earliest := min(2 min, 3 min)",
    "A := 2 m^2",
    "power := 1 W/m^2*A",
  ]) {
    await entry.fill(text);
    await entry.press("Enter");
  }
  await entry.press("Escape");
  const entered = await readWorkspace(entries),
    enteredProjection = project(entered.page);
  expect(enteredProjection.errors.size).toBe(0);
  expect(enteredProjection.solved.values.get("duration").value).toBe(120);
  expect(enteredProjection.solved.values.get("frequency").value).toBeCloseTo(
    1 / 60,
    12,
  );
  expect(enteredProjection.solved.values.get("speed").value).toBeCloseTo(
    2 / 60,
    12,
  );
  expect(enteredProjection.solved.values.get("earliest").value).toBe(120);
  expect(enteredProjection.solved.values.get("power").value).toBe(2);
  await entries.reload();
  expect(
    project((await readWorkspace(entries)).page).solved.values.get("frequency")
      .value,
  ).toBeCloseTo(1 / 60, 12);
  await entries.close();

  // Historical source keeps its original meaning. Invalid old unit metadata is
  // reviewable without throwing from rendering when its region is selected.
  const original = new RegionSession();
  const source = original.importData("legacy.csv", "reading\n2", {
    x: 100,
    y: 100,
  });
  const legacy = structuredClone(original.state);
  original.dispose();
  for (const [id, text, unit, y, mathVersion] of [
    ["region-legacy-rate", "legacy_rate := 2 1/s", "1/s", 350, 3],
    ["region-legacy-length", "legacy_length := 2 m+1m", "m+1m", 460, 3],
    ["region-legacy-time", "legacy_time := 2 min", "min", 570, 2],
  ]) {
    legacy.regions.push({
      id,
      text,
      mathVersion,
      source: { dataset: source, row: 0, column: 0, raw: "2", unit },
    });
    legacy.layout[id] = { x: 100, y };
  }
  const older = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  older.on("pageerror", (error) => errors.push(error.message));
  await older.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    legacyWorkspace(legacy, []),
  );
  await older.goto(base);
  const saved = await readWorkspace(older);
  expect(saved.page.regions).toEqual(legacy.regions);
  const values = project(saved.page).solved.values;
  expect(values.get("legacy_rate").value).toBe(2);
  expect(values.get("legacy_length").value).toBe(3);
  expect(values.get("legacy_time").value).toBe(120);
  for (const [id, caption] of [
    ["region-legacy-rate", "Imported measurement"],
    ["region-legacy-length", "Source units need review"],
    ["region-legacy-time", "Imported measurement"],
  ]) {
    const region = older.locator(`[data-region-id="${id}"]`);
    await region.click({ position: { x: 400, y: 20 } });
    await expect(region.locator(".er-source-caption")).toContainText(caption);
  }
  await older.close();
  expect(errors).toEqual([]);
  console.log(
    "CSV unit browser: compound scalar/vector parity, reviewed rejection, provenance, Undo/Redo, native handoff and safe legacy-source selection pass.",
  );
} finally {
  await browser.close();
}
