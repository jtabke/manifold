import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import * as f from "@manifold/foundation";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import {
  publishModel,
  instantiateModel,
  modelReference,
  reviewModelCsv,
  applyModelConnection,
  reviewInstanceUpdate,
  applyInstanceUpdate,
} from "../src/regions/modelCommands.ts";
import { createModelOptimization } from "../src/regions/modelOptimizationCommands.ts";
import { readWorkspace as readStoredWorkspace } from "./browser-workspace.mjs";
import { workspaceStorage } from "../src/regions/workspaceStorage.ts";
const readWorkspace = (page) =>
  readStoredWorkspace(
    page,
    workspaceStorage(
      "manifold.artifact-experiment.v1",
      new URL(page.url()).search,
    ),
  );
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const s = new RegionSession(),
  def = publishModel(s, "Quadratic", {
    rows: [
      { id: "x", text: "x = 1", mathVersion: 3 },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `q${i}`,
        text: i === 0 ? "q0 = (x - 2)^2" : `q${i} = q${i - 1} * 1 + 0`,
        mathVersion: 3,
      })),
      { id: "y", text: "y = q11", mathVersion: 3 },
    ],
    inputs: ["x"],
    outputs: ["y"],
  }),
  instance = instantiateModel(s, modelReference(s.document, def), {
    x: 0,
    y: 0,
  });
const data = s.importData("x.csv", "x\n1\n", { x: 0, y: 700 });
applyModelConnection(s, reviewModelCsv(s, instance, "x", data, 0, 0, "1"));
const native = archive(s.native());
s.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const open = (page, text = native) =>
  page.getByLabel("Open workspace file", { exact: true }).setInputFiles({
    name: "optimization.manifold",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
try {
  const context = await browser.newContext({
      viewport: { width: 1800, height: 1200 },
    }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/optimizer/")) requests.push(r.url());
  });
  await page.goto(base);
  await open(page);
  const model = page.getByLabel("Quadratic model", { exact: true });
  await expect(model).toBeVisible();
  assert.equal(requests.length, 0, "Open must not probe or run numerical work");
  await model
    .getByRole("button", { name: "Optimize model", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", {
    name: "Optimize model",
    exact: true,
  });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByLabel("Optimization goal", { exact: true }),
  ).toBeFocused();
  await editor
    .getByLabel("Optimization goal", { exact: true })
    .selectOption("minimize");
  await editor.getByLabel("Lower bound", { exact: true }).fill("-3");
  await editor.getByLabel("Upper bound", { exact: true }).fill("5");
  await open(page);
  await expect(editor.getByRole("alert")).toContainText("Save or cancel");
  await editor
    .getByRole("button", { name: "Create optimization", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const card = page.getByLabel("Model optimization", { exact: true }).first();
  await expect(card).toBeVisible();
  assert.equal(requests.length, 0, "Creation/render must not execute");
  await card.getByText("Settings and actions", { exact: true }).click();
  const numerical = await context.request.get(
    base + "/api/optimizer/capability",
  );
  if (numerical.status() === 503) {
    await card
      .getByRole("button", { name: "Run optimization", exact: true })
      .click();
    await expect(card.getByRole("alert")).toBeVisible();
    console.log(
      "SKIP numerical browser Run/Apply: supported environment unavailable; offline authoring, modal keyboard/buffer and clear missing-runtime UI passed.",
    );
  } else {
    assert.equal(numerical.status(), 200);
    const backend = (await numerical.json()).backend;
    assert.equal(backend.scipy, "1.15.3");
    const before = f.current((await readWorkspace(page)).document, instance);
    await card
      .getByRole("button", { name: "Run optimization", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      card.getByLabel("Optimization termination", { exact: true }),
    ).toContainText("Converged and independently checked");
    await expect(
      card.getByLabel("Optimization candidate", { exact: true }),
    ).toContainText("x = 2 1; y = 0 1");
    assert.deepEqual(
      f.current((await readWorkspace(page)).document, instance),
      before,
      "Run preserves source binding",
    );
    await expect(card.getByRole("note")).toContainText(
      "Undo restores that exact connection",
    );
    const apply = card.getByRole("button", {
      name: "Apply change",
      exact: true,
    });
    await expect(apply).toBeEnabled();
    // An invalid pending model buffer must refuse Apply, not be silently discarded.
    const field = model.getByRole("spinbutton", {
      name: "Quadratic x",
      exact: true,
    });
    await field.fill("");
    await apply.click();
    assert.equal(
      f.current((await readWorkspace(page)).document, instance).body.inputs.x
        .kind,
      "reference",
    );
    await field.press("Escape");
    await apply.focus();
    await page.keyboard.press("Enter");
    await expect(
      card.getByLabel("Optimization status", { exact: true }),
    ).toContainText("Result from before this change");
    const applied = f.current((await readWorkspace(page)).document, instance);
    assert.equal(applied.body.inputs.x.kind, "value");
    assert(Math.abs(applied.body.inputs.x.value - 2) < 1e-7);
    await expect(
      card.getByRole("button", { name: "Apply change", exact: true }),
    ).toBeDisabled();
    await card
      .getByRole("button", { name: "Undo this change", exact: true })
      .click();
    assert.deepEqual(
      f.current((await readWorkspace(page)).document, instance),
      before,
    );
    await expect(apply).toBeEnabled();
    await card
      .getByRole("button", { name: "Compute response plot", exact: true })
      .click();
    const table = card.getByRole("table", {
      name: "Analysis result table",
      exact: true,
    });
    await expect(table).toBeVisible();
    await expect(
      card.getByRole("img", { name: "y versus x", exact: true }),
    ).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(25);
    await expect(card).toContainText("1–25 of 41");
    await card
      .getByRole("button", { name: "Check endpoint outputs", exact: true })
      .click();
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await card
      .getByRole("button", { name: "Compute response plot", exact: true })
      .click();
    await expect(table.locator("tbody tr")).toHaveCount(25);
    await expect(card).toContainText("1–25 of 41");
    const jobsBeforeInspect = requests.length;
    await card
      .getByRole("button", { name: "Inspect point 2", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      card.getByLabel("Selected analysis point", { exact: true }),
    ).toContainText("x = -2.8");
    assert.equal(
      requests.length,
      jobsBeforeInspect,
      "Point inspection does not execute",
    );
    // Finishing a valid but changed buffer authors the change, then exact-document guard refuses stale Apply.
    await field.fill("3");
    await apply.click();
    await expect(card.getByRole("alert")).toContainText(
      "exact reviewed baseline",
    );
    assert.equal(
      f.current((await readWorkspace(page)).document, instance).body.inputs.x
        .value,
      3,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(apply).toBeEnabled();
    await card
      .getByRole("button", { name: "Keep result", exact: true })
      .click();
    const cards = page.getByLabel("Model optimization", { exact: true });
    await expect(cards).toHaveCount(2);
    await cards
      .filter({ hasText: "Kept optimization" })
      .getByText("Settings and actions", { exact: true })
      .click();
    await expect(
      cards
        .filter({ hasText: "Kept optimization" })
        .getByRole("button", { name: "Apply change", exact: true }),
    ).toBeDisabled();
    const saved = await readWorkspace(page),
      requestsBefore = requests.length;
    await page.reload();
    await expect(
      page.getByLabel("Optimization termination", { exact: true }).first(),
    ).toContainText("Converged");
    assert.equal(
      requests.length,
      requestsBefore,
      "Reload must not launch optimizer jobs",
    );
    // Busy capability is actionable and cannot retarget the retained receipt.
    const baseline = page.locator('[data-optimization-comparison="false"]');
    await baseline.getByText("Settings and actions", { exact: true }).click();
    await page.route("**/api/optimizer/capability", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Numerical workers are busy; try Run again later",
        }),
      }),
    );
    await baseline
      .getByRole("button", { name: "Run optimization", exact: true })
      .click();
    await expect(baseline.getByRole("alert")).toContainText("busy");
    await page.unroute("**/api/optimizer/capability");
    assert.equal((await readWorkspace(page)).document.id, saved.document.id);
    await expect(
      baseline.getByRole("table", {
        name: "Analysis result table",
        exact: true,
      }),
    ).toBeVisible();
    // Cancellation reaches the explicit host control route, not only browser fetch abort.
    await baseline
      .getByRole("button", {
        name: "Edit settings / Adjust range",
        exact: true,
      })
      .click();
    const settings = page.getByRole("dialog", {
      name: "Edit optimization",
      exact: true,
    });
    await settings
      .getByText("Advanced: units, numerical tolerances and work limits", {
        exact: true,
      })
      .click();
    await settings
      .getByLabel("Input tolerance", { exact: true })
      .fill("0.0000001");
    await settings
      .getByRole("button", { name: "Save optimization settings", exact: true })
      .click();
    const posted = page.waitForRequest((r) =>
      r.url().endsWith("/api/optimizer/optimize"),
    );
    await baseline
      .getByRole("button", { name: "Run optimization", exact: true })
      .click();
    await posted;
    const cancelled = page.waitForRequest((r) =>
      r.url().endsWith("/api/optimizer/cancel"),
    );
    await baseline
      .getByRole("button", { name: "Cancel optimization", exact: true })
      .click();
    await cancelled;
    await expect(
      baseline.getByLabel("Optimization status", { exact: true }),
    ).not.toContainText("pending");
    assert.deepEqual(
      f.current((await readWorkspace(page)).document, instance),
      before,
    );
    // Goal controls use output-unit target/residual semantics, including exact endpoints and unreachable targets.
    for (const [targetValue, code] of [
      ["9", "converged"],
      ["99", "no_bracket"],
    ]) {
      await baseline
        .getByRole("button", {
          name: "Edit settings / Adjust range",
          exact: true,
        })
        .click();
      const goal = page.getByRole("dialog", {
        name: "Edit optimization",
        exact: true,
      });
      await goal
        .getByLabel("Optimization goal", { exact: true })
        .selectOption("target");
      await goal.getByLabel("Target output", { exact: true }).fill(targetValue);
      await goal
        .getByText("Advanced: units, numerical tolerances and work limits", {
          exact: true,
        })
        .click();
      await goal
        .getByLabel("Residual tolerance", { exact: true })
        .fill("0.00000001");
      await goal
        .getByRole("button", {
          name: "Save optimization settings",
          exact: true,
        })
        .click();
      await baseline
        .getByRole("button", { name: "Run optimization", exact: true })
        .click();
      await expect(
        baseline.getByLabel("Optimization termination", { exact: true }),
      ).toContainText(code);
      if (code === "converged")
        await expect(
          baseline.getByLabel("Optimization candidate", { exact: true }),
        ).toContainText("x = 5 1; y = 9 1; residual = 0 1");
      else {
        await expect(
          baseline.getByRole("button", { name: "Apply change", exact: true }),
        ).toBeDisabled();
        await expect(baseline).toContainText(
          "does not prove no solution exists",
        );
        await baseline
          .getByRole("button", { name: "Check endpoint outputs", exact: true })
          .click();
        const endpoints = baseline.getByRole("table", {
          name: "Analysis result table",
          exact: true,
        });
        await expect(endpoints.locator("tbody tr")).toHaveCount(2);
        await expect(endpoints.locator("tbody tr").nth(0)).toContainText("25");
        await expect(endpoints.locator("tbody tr").nth(1)).toContainText("9");
      }
    }
    // Controlled admitted work-limit response: independently checked candidate remains unconfirmed.
    await page.route("**/api/optimizer/optimize", async (route) => {
      const actual = await route.fetch();
      const output = await actual.json();
      output.success = false;
      output.code = "evaluation_limit";
      output.evaluations = output.limits.evaluations;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(output),
      });
    });
    await baseline
      .getByRole("button", { name: "Run optimization", exact: true })
      .click();
    await expect(
      baseline.getByLabel("Optimization termination", { exact: true }),
    ).toContainText("evaluation_limit");
    await expect(baseline).toContainText("Unconfirmed candidate");
    await expect(
      baseline.getByRole("button", { name: "Apply change", exact: true }),
    ).toBeDisabled();
    await page.unroute("**/api/optimizer/optimize");
    // A late Run setup from a prior Open cannot mutate the replacement workspace.
    let release, arrived, finish;
    const handled = new Promise((r) => {
      finish = r;
    });
    const waiting = new Promise((r) => {
        arrived = r;
      }),
      gate = new Promise((r) => {
        release = r;
      });
    await page.route("**/api/optimizer/capability", async (route) => {
      arrived();
      await gate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ backend }),
        });
      } catch (error) {
        // Full Open navigation may already have aborted its old page's request.
        assert.match(error.message, /already handled|Target.*closed/);
      } finally {
        finish();
      }
    });
    await baseline
      .getByRole("button", { name: "Run optimization", exact: true })
      .click();
    await waiting;
    await open(page);
    await expect(
      page.getByLabel("Model optimization", { exact: true }),
    ).toHaveCount(0);
    release();
    await handled;
    await page.unroute("**/api/optimizer/capability");
    assert.equal(
      f.current((await readWorkspace(page)).document, instance).body.inputs.x
        .kind,
      "reference",
    );
    console.log(
      "Optimization browser: actual SciPy Run, captured result/provenance, keyboard/modal/pending-buffer flows, explicit Apply once, source-binding Undo, kept/reload evidence without jobs, busy and late-Open refusal pass.",
    );
  }
  // Unit-aware setup with long exposed labels at multiple viewport widths and canvas zooms.
  const units = new RegionSession();
  const unitDef = publishModel(
    units,
    "Long beam response with dimensional equations",
    {
      rows: [
        { id: "length", text: "length = 10 mm", mathVersion: 3 },
        { id: "duration", text: "duration = 2 s", mathVersion: 3 },
        { id: "square", text: "square = length^2", mathVersion: 3 },
        { id: "area", text: "area = square * 1", mathVersion: 3 },
      ],
      inputs: ["length", "duration"],
      outputs: ["area"],
    },
  );
  const unitInstance = instantiateModel(
    units,
    modelReference(units.document, unitDef),
    { x: 0, y: 0 },
  );
  const unitNative = archive(units.native());
  units.dispose();
  for (const width of [1366, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, unitNative);
    const unitModel = page.getByLabel(
      "Long beam response with dimensional equations model",
      { exact: true },
    );
    // Scale canvas to leave room at narrow widths; no computation is authorized by zoom.
    if (width < 1000) {
      for (let i = 0; i < (width < 500 ? 4 : 2); i++)
        await page
          .getByRole("button", { name: "Zoom out", exact: true })
          .click();
    }
    await unitModel
      .getByRole("button", { name: "Optimize model", exact: true })
      .click();
    const setup = page.getByRole("dialog", {
      name: "Optimize model",
      exact: true,
    });
    await expect(
      setup.getByLabel("Optimization goal", { exact: true }),
    ).toBeFocused();
    await expect(setup).toContainText("Suggested—review before running");
    await setup
      .getByLabel("Optimization input", { exact: true })
      .selectOption("length");
    await setup.getByLabel("Lower bound", { exact: true }).fill("10 mm");
    await setup.getByLabel("Upper bound", { exact: true }).fill("5 cm");
    await setup.getByLabel("Target output", { exact: true }).fill("400 mm^2");
    await setup
      .getByText("Advanced: units, numerical tolerances and work limits", {
        exact: true,
      })
      .click();
    await setup.getByLabel("Input tolerance", { exact: true }).fill("0.001 mm");
    await setup
      .getByLabel("Residual tolerance", { exact: true })
      .fill("0.01 mm^2");
    await setup.getByLabel("Lower bound", { exact: true }).fill("2 s");
    await expect(
      setup.getByLabel("Lower bound", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await setup
      .getByRole("button", { name: "Create optimization", exact: true })
      .click();
    await expect(
      setup.getByLabel("Lower bound", { exact: true }),
    ).toBeFocused();
    await setup.getByLabel("Lower bound", { exact: true }).fill("10 mm");
    await setup.getByLabel("Input display unit", { exact: true }).fill("s");
    await setup.getByLabel("Input display unit", { exact: true }).press("Tab");
    await expect(
      setup.getByLabel("Input display unit", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await setup
      .getByRole("button", { name: "Create optimization", exact: true })
      .click();
    await expect(setup).toBeVisible();
    await setup.getByLabel("Input display unit", { exact: true }).fill("cm");
    await setup.getByLabel("Input display unit", { exact: true }).press("Tab");
    await expect(setup.getByLabel("Lower bound", { exact: true })).toHaveValue(
      "1",
    );
    await expect(setup.getByLabel("Upper bound", { exact: true })).toHaveValue(
      "5",
    );
    await setup.getByLabel("Output display unit", { exact: true }).fill("mm^2");
    await setup.getByLabel("Output display unit", { exact: true }).press("Tab");
    await setup.getByLabel("Input display unit", { exact: true }).fill("mm");
    await setup.getByLabel("Input display unit", { exact: true }).press("Tab");
    await setup.getByLabel("Input display unit", { exact: true }).fill("cm");
    await setup.getByLabel("Input display unit", { exact: true }).press("Tab");
    // Changing dimensions must not reinterpret the prior scaled text as seconds.
    await setup
      .getByLabel("Optimization input", { exact: true })
      .selectOption("duration");
    await expect(setup.getByLabel("Lower bound", { exact: true })).toHaveValue(
      "0",
    );
    await expect(setup.getByLabel("Upper bound", { exact: true })).toHaveValue(
      "10",
    );
    await expect(
      setup.getByLabel("Input tolerance", { exact: true }),
    ).toHaveValue("1e-8");
    await expect(
      setup.getByLabel("Input display unit", { exact: true }),
    ).toHaveValue("s");
    await expect(setup.getByRole("checkbox")).not.toBeChecked();
    await setup
      .getByLabel("Optimization input", { exact: true })
      .selectOption("length");
    await expect(setup.getByLabel("Upper bound", { exact: true })).toHaveValue(
      "10",
    );
    await expect(
      setup.getByLabel("Input display unit", { exact: true }),
    ).toHaveValue("m");
    await expect(setup.getByRole("checkbox")).not.toBeChecked();
    await setup.getByLabel("Lower bound", { exact: true }).fill("10 mm");
    await setup.getByLabel("Upper bound", { exact: true }).fill("5 cm");
    await setup.getByLabel("Input tolerance", { exact: true }).fill("0.001 mm");
    await setup.getByLabel("Input display unit", { exact: true }).fill("cm");
    await setup.getByLabel("Input display unit", { exact: true }).press("Tab");
    const bounds = await setup.boundingBox();
    assert(
      bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
      "Dialog fits viewport without clipped unit fields",
    );
    const priorJobs = requests.length;
    await setup
      .getByRole("button", { name: "Create optimization", exact: true })
      .click();
    await expect(setup).toHaveCount(0);
    const workspace = await readWorkspace(page);
    const unitRequest = [...workspace.document.items.entries()]
      .map(([id]) => f.current(workspace.document, id))
      .find((r) => r?.schema === "canvas-model-optimization@2");
    assert.equal(unitRequest.body.low, 0.01);
    assert.equal(unitRequest.body.high, 0.05);
    assert(Math.abs(unitRequest.body.target - 0.0004) < 1e-18);
    assert.equal(unitRequest.body.xTolerance, 0.000001);
    assert.deepEqual(unitRequest.body.displayUnits, {
      input: "cm",
      output: "mm^2",
    });
    assert.equal(
      f.current(workspace.document, unitInstance).body.inputs.length?.kind,
      undefined,
    );
    assert.equal(
      requests.length,
      priorJobs,
      "Setup, unit conversion and zoom never execute",
    );
  }
  // Saved optimization settings survive a definition update removing both selected ports.
  const changed = new RegionSession();
  const changedDef = publishModel(changed, "Changed ports", {
    rows: [
      { id: "x", text: "x = 1 m", mathVersion: 3 },
      { id: "y", text: "y = x * 2", mathVersion: 3 },
    ],
    inputs: ["x"],
    outputs: ["y"],
  });
  const changedInstance = instantiateModel(
    changed,
    modelReference(changed.document, changedDef),
    { x: 0, y: 0 },
  );
  createModelOptimization(
    changed,
    changedInstance,
    {
      input: "x",
      output: "y",
      mode: "target",
      low: 1,
      high: 2,
      target: 4,
      xTolerance: 1e-8,
      residualTolerance: 1e-8,
      displayUnits: { input: "cm", output: "cm" },
    },
    { x: 0, y: 500 },
  );
  publishModel(
    changed,
    "Changed ports",
    {
      rows: [
        { id: "time", text: "time = 1 s", mathVersion: 3 },
        { id: "result", text: "result = time * 2", mathVersion: 3 },
      ],
      inputs: ["time"],
      outputs: ["result"],
    },
    changedDef,
  );
  applyInstanceUpdate(changed, reviewInstanceUpdate(changed, changedInstance));
  await page.setViewportSize({ width: 1366, height: 1000 });
  await open(page, archive(changed.native()));
  changed.dispose();
  await expect(
    page.getByLabel("Changed ports model", { exact: true }),
  ).toBeVisible();
  const changedCard = page.getByLabel("Model optimization", { exact: true });
  await changedCard.getByText("Settings and actions", { exact: true }).click();
  await changedCard
    .getByRole("button", { name: "Edit settings / Adjust range", exact: true })
    .click();
  const changedEditor = page.getByRole("dialog", {
    name: "Edit optimization",
    exact: true,
  });
  await expect(changedEditor).toBeVisible();
  await expect(changedEditor.getByRole("alert")).toContainText(
    "Model ports or units changed",
  );
  await expect(
    changedEditor.getByLabel("Optimization input", { exact: true }),
  ).toHaveValue("time");
  await expect(
    changedEditor.getByLabel("Optimization output", { exact: true }),
  ).toHaveValue("result");
  await expect(
    changedEditor.getByLabel("Lower bound", { exact: true }),
  ).toHaveValue("0");
  await expect(
    changedEditor.getByLabel("Upper bound", { exact: true }),
  ).toHaveValue("10");
  await expect(
    changedEditor.getByLabel("Target output", { exact: true }),
  ).toHaveValue("0");
  await expect(changedEditor.getByRole("checkbox")).not.toBeChecked();
  await changedEditor.getByRole("checkbox").check();
  await changedEditor
    .getByRole("button", { name: "Save optimization settings", exact: true })
    .click();
  await expect(changedEditor).toHaveCount(0);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
