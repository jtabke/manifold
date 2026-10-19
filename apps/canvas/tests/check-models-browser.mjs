const baseURL = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { RegionSession, project } from "../src/regions/document.ts";
import { archive, makeArtifact } from "../src/regions/artifacts.ts";
const s = new RegionSession(),
  add = (text, x, y) => {
    const id = s.create({ x, y });
    s.write(id, text);
    return id;
  };
const loss = add("loss := 800 W", 90, 160),
  heat = add("heat := 600 W", 620, 160),
  area = add("area := 0.2 m^2", 620, 260),
  h = add("convection := 60 W/(m^2*K)", 620, 360),
  ambient = add("ambient := 25 °C", 620, 460),
  temp = add("temperature = ambient+heat/(convection*area)", 620, 560),
  req = add("temperature <= 100 °C", 90, 800),
  note = add("Assumed steady-state cooling.", 90, 660);
const data = s.importData(
  "cooling.csv",
  "area [m^2],temperature [°C]\n0.2,75\n0.25,65",
  { x: 90, y: 310 },
);
const plot = s.addPlot(temp, area);
s.move(plot, { x: 1210, y: 230 });
const artifact = makeArtifact(
  s.state,
  temp,
  "Plot temperature versus area from 0.05 to 0.5 m^2",
);
artifact.at = { x: 1210, y: 650 };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(12000);
await page.addInitScript(
  (text) => {
    if (!localStorage.getItem("manifold.artifact-experiment.v1")) {
      localStorage.setItem("manifold.artifact-experiment.v1", text);
      const a = JSON.parse(text).artifacts[0];
      localStorage.setItem(
        "manifold.canvas-scene.v1",
        JSON.stringify({
          version: 1,
          groups: [],
          viewpoints: [],
          tools: [
            {
              id: "tool-code",
              editor: "python",
              object: a.output,
              artifact: a.id,
              at: { x: 1210, y: 1110 },
              width: 520,
              height: 280,
              collapsed: true,
            },
          ],
        }),
      );
    }
  },
  archive(s.state, [artifact]),
);
const read = () =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("manifold.artifact-experiment.v1")).page,
  );
const camera = () =>
  page.locator(".er-canvas").evaluate((n) => ({
    x: n.scrollLeft - Number(n.dataset.canvasOriginX || 0),
    y: n.scrollTop - Number(n.dataset.canvasOriginY || 0),
    z: document.querySelector(".er-paper").style.transform,
  }));
const checks = [];
const select = async (ids) => {
  for (const id of ids)
    await page
      .locator(
        `[data-region-id="${id}"],[data-plot-id="${id}"],[data-model-id="${id}"],[data-view-id="${id}"]`,
      )
      .click({ modifiers: ["Shift"] });
};
const create = async (name, ids) => {
  await select(ids);
  await page.getByRole("button", { name: "Make model", exact: true }).click();
  await page.getByLabel("Model name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Create model", exact: true }).click();
  const card = page.getByLabel(`Model ${name}`, { exact: true });
  await expect(card).toBeVisible();
  return card;
};
const resultOf = (p) => project(p).solved.values.get("temperature").value;
try {
  await page.goto(`${baseURL}/?think=1&artifacts=1`);
  const initial = await read();
  const source = await create("Heat source", [loss]);
  const thermal = await create("Thermal balance", [
    heat,
    area,
    h,
    ambient,
    temp,
    note,
    data,
    plot,
    artifact.id,
  ]);
  let state = await read();
  const thermalId = state.models.find((m) => m.name === "Thermal balance").id;
  await thermal.hover();
  const grip = await thermal
    .getByRole("button", { name: "Move model Thermal balance", exact: true })
    .boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2 + 75,
    grip.y + grip.height / 2 + 35,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect
    .poll(async () => (await read()).layout[thermalId])
    .not.toEqual(state.layout[thermalId]);
  const { layout: oldLayout, ...oldMeaning } = state,
    { layout: newLayout, ...newMeaning } = await read();
  expect(newMeaning).toEqual(oldMeaning);
  for (const id of [...state.regions.map((r) => r.id), plot])
    expect(newLayout[id]).toEqual(oldLayout[id]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(read).toEqual(state);
  checks.push(
    "Dragging a compact model moves only its parent representation, preserves internal geometry and meaning, and restores through Undo",
  );
  expect(state.regions).toEqual(initial.regions);
  expect(state.plots).toEqual(initial.plots);
  expect(state.links).toEqual(initial.links);
  expect(resultOf(state)).toBe(resultOf(initial));
  await expect(page.locator(`[data-region-id="${temp}"]`)).toBeHidden();
  await expect(thermal).toContainText("75 °C");
  checks.push(
    "Equations, CSV, notes and a plot become a reviewed model without changing definitions, references, results or internal layout",
  );
  await source
    .getByRole("button", { name: "Connect model output loss", exact: true })
    .click();
  await page
    .getByLabel("Destination model input", { exact: true })
    .selectOption(heat);
  await expect(page.getByLabel("Review model connection")).toContainText(
    "instead of 600 W",
  );
  expect(resultOf(await read())).toBe(resultOf(initial));
  await page
    .getByRole("button", { name: "Connect & recalculate", exact: true })
    .click();
  await expect(thermal).toContainText("91.6667 °C");
  expect((await read()).links[heat].loss).toBe(loss);
  checks.push(
    "Independently authored model interfaces connect only after unit-checked review through the existing binding command",
  );
  const parentCamera = await camera();
  await thermal
    .getByRole("button", { name: "Enter model Thermal balance", exact: true })
    .click();
  await expect(page.getByLabel("Model hierarchy")).toContainText(
    "Thermal balance",
  );
  await expect(page.locator(`[data-region-id="${temp}"]`)).toBeVisible();
  await expect(page.getByLabel("Data source cooling.csv")).toBeVisible();
  await page.getByRole("button", { name: "Fit page", exact: true }).click();
  await expect(page.getByLabel("Model hierarchy")).toContainText(
    "Thermal balance",
  );
  await expect(source).toHaveCount(0);
  await expect(page.getByLabel("Canvas implementation")).toBeVisible();
  await page
    .getByRole("button", { name: "Expand implementation", exact: true })
    .click();
  await expect(page.getByLabel("Canvas implementation")).toContainText(
    "linspace",
  );
  await page
    .getByRole("button", { name: "Collapse implementation", exact: true })
    .click();
  await expect(source).toHaveCount(0);
  await page.locator(`[data-region-id="${area}"] math`).dblclick();
  await page.getByLabel("Write an engineering region").fill("area := 0.25 m^2");
  await page.getByLabel("Write an engineering region").press("Escape");
  await page.locator(`[data-region-id="${temp}"] math`).dblclick();
  await page.getByLabel("Write an engineering region").press("Enter");
  const nextId = (await read()).regions.find((r) => r.text === "")?.id;
  await page
    .getByLabel("Write an engineering region")
    .fill("Internal cooling note.");
  await page.getByLabel("Write an engineering region").press("Escape");
  expect(
    (await read()).models.find((m) => m.id === thermalId).members,
  ).toContain(nextId);
  await page
    .getByRole("button", { name: "Back through models", exact: true })
    .click();
  await expect(thermal).toContainText("78.3333 °C");
  await expect.poll(camera).toEqual(parentCamera);
  checks.push(
    "Internal edits and Enter-created content stay in scope, update the parent result, and Back restores the exact parent camera",
  );
  await thermal
    .getByLabel("Detail for Thermal balance")
    .selectOption("compact");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(thermal).toHaveAttribute("data-detail", "compact");
  await thermal.getByLabel("Detail for Thermal balance").selectOption("detail");
  await expect(thermal.getByLabel("Model calculation preview")).toContainText(
    "temperature",
  );
  await thermal.getByLabel("Detail for Thermal balance").selectOption("auto");
  for (let i = 0; i < 7; i++)
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(thermal).toHaveAttribute("data-detail", "compact");
  await expect(page.getByLabel("Model hierarchy")).not.toContainText(
    "Thermal balance",
  );
  checks.push(
    "Automatic detail and manual overrides change only representation; zoom never enters a model",
  );
  await select([
    (await read()).models.find((m) => m.name === "Heat source").id,
    thermalId,
  ]);
  await page.getByRole("button", { name: "Make model", exact: true }).click();
  await page.getByLabel("Model name", { exact: true }).fill("Cooling system");
  await page.getByRole("button", { name: "Create model", exact: true }).click();
  const system = page.getByLabel("Model Cooling system", { exact: true });
  await expect(system).toBeVisible();
  await system
    .getByRole("button", { name: "Enter model Cooling system", exact: true })
    .click();
  await thermal
    .getByRole("button", { name: "Enter model Thermal balance", exact: true })
    .click();
  await expect(page.getByLabel("Model hierarchy")).toContainText(
    "Cooling system",
  );
  await expect(page.getByLabel("Model hierarchy")).toContainText(
    "Thermal balance",
  );
  await page
    .getByRole("button", { name: "Back through models", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back through models", exact: true })
    .click();
  checks.push(
    "The same identities nest several levels and return through history without copying contents",
  );
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("temperature");
  await page
    .getByRole("button")
    .filter({ hasText: "temperature" })
    .filter({ hasText: "ambient+heat" })
    .click();
  await expect(page.locator(`[data-region-id="${temp}"]`)).toBeVisible();
  await expect(page.getByLabel("Model hierarchy")).toContainText(
    "Thermal balance",
  );
  await page
    .getByRole("button", { name: "Back through models", exact: true })
    .click();
  await system
    .getByRole("button", { name: "Enter model Cooling system", exact: true })
    .click();
  await source
    .getByRole("button", { name: "Inspect model output loss", exact: true })
    .click();
  await expect(page.getByLabel("Model quantity trace")).toContainText("heat");
  await page
    .getByLabel("Model quantity trace")
    .getByRole("button")
    .filter({ hasText: "heat" })
    .click();
  await expect(page.locator(`[data-region-id="${heat}"]`)).toBeVisible();
  await page
    .getByRole("button", { name: "Back through models", exact: true })
    .click();
  checks.push(
    "Search and port traces reach hidden definitions and cross-boundary consumers while preserving a return path",
  );
  const persisted = await read();
  await expect(thermal).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("manifold.canvas-attention.v1"))
            ?.scope,
      ),
    )
    .toBe(persisted.models.find((m) => m.name === "Cooling system").id);
  await page.reload();
  await expect(thermal).toBeVisible();
  await expect(page.getByLabel("Model hierarchy")).toContainText(
    "Cooling system",
  );
  expect(await read()).toEqual(persisted);
  await page
    .getByLabel("Model hierarchy")
    .getByRole("button", { name: "Canvas", exact: true })
    .click();
  await expect(system).toBeVisible();
  await system
    .getByRole("button", { name: "Enter model Cooling system", exact: true })
    .click();
  await thermal
    .getByLabel("Detail for Thermal balance")
    .selectOption("interface");
  await mkdir("/tmp/manifold-models", { recursive: true });
  await expect(thermal).toBeInViewport();
  await page.screenshot({ path: "/tmp/manifold-models/system.png" });
  await thermal
    .getByRole("button", { name: "Enter model Thermal balance", exact: true })
    .click();
  await expect(
    page.locator(`[data-region-id="${temp}"] math`),
  ).toBeInViewport();
  await page.screenshot({ path: "/tmp/manifold-models/inside.png" });
  checks.push(
    "Hierarchy and interfaces round-trip through the portable archive; results regenerate from original definitions",
  );
  // A source need not be contained by the model that consumes it.
  const paired = new RegionSession(),
    power = paired.create({ x: 650, y: 200 });
  paired.write(power, "P = force*speed");
  const sourceData = paired.importData(
    "paired.csv",
    "force [N],speed [m/s]\n20,3\n24,4",
    { x: 100, y: 150 },
  );
  const calculated = paired.bindDataset(
    {
      id: "data-test",
      dataset: sourceData,
      output: power,
      bindings: [
        { symbol: "force", column: 0, unit: "N" },
        { symbol: "speed", column: 1, unit: "m/s" },
      ],
      scope: { kind: "all" },
      paired: true,
    },
    { x: 650, y: 370 },
  );
  paired.makeModel(
    {
      id: "model-power",
      name: "Power from measurements",
      members: [power, calculated],
      inputs: [sourceData],
      outputs: [calculated],
    },
    { x: 750, y: 170 },
  );
  const evidence = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  evidence.on("pageerror", (e) => errors.push(e.message));
  const evidenceArchive = archive(paired.state, []);
  await evidence.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    evidenceArchive,
  );
  await evidence.goto(`${baseURL}/?think=1&artifacts=1`);
  await expect(
    evidence.getByLabel("Model Power from measurements", { exact: true }),
  ).toContainText("Evaluated");
  await evidence
    .getByRole("button", {
      name: "Enter model Power from measurements",
      exact: true,
    })
    .click();
  await evidence
    .getByRole("button", { name: "Inspect measured row 2: 96 W", exact: true })
    .click();
  await evidence
    .getByRole("button", { name: "Follow measurement source", exact: true })
    .click();
  await expect(evidence.getByLabel("Data source paired.csv")).toBeVisible();
  await expect(
    evidence.getByRole("button", {
      name: "Select measurement row 2",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await evidence
    .getByRole("button", { name: "Back to previous location", exact: true })
    .click();
  await expect(
    evidence.locator(`[data-data-relation-id="${calculated}"]`),
  ).toBeVisible();
  await expect(evidence.getByLabel("Data source paired.csv")).toBeHidden();
  expect(
    await evidence.evaluate(
      () =>
        JSON.parse(localStorage.getItem("manifold.artifact-experiment.v1"))
          .page,
    ),
  ).toEqual(paired.state);
  await evidence.close();
  checks.push(
    "Dataset provenance crosses a model boundary to the original source record and Back returns to the result without changing evidence or computation",
  );
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally {
  await browser.close();
}
