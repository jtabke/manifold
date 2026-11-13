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
} from "../src/regions/modelCommands.ts";
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
      { id: "y", text: "y = (x - 2)^2", mathVersion: 3 },
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
  await expect(editor.getByLabel("Lower bound", { exact: true })).toBeFocused();
  await editor.getByLabel("Lower bound", { exact: true }).fill("-3");
  await editor.getByLabel("Upper bound", { exact: true }).fill("5");
  await open(page);
  await expect(editor.getByRole("alert")).toContainText(
    "Create, save or cancel",
  );
  await editor
    .getByRole("button", { name: "Create optimization", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const card = page.getByLabel("Model optimization", { exact: true }).first();
  await expect(card).toBeVisible();
  assert.equal(requests.length, 0, "Creation/render must not execute");
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
      "Undo restores the exact prior connection",
    );
    const apply = card.getByRole("button", {
      name: "Replace source with candidate",
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
    ).toContainText("noncurrent");
    const applied = f.current((await readWorkspace(page)).document, instance);
    assert.equal(applied.body.inputs.x.kind, "value");
    assert(Math.abs(applied.body.inputs.x.value - 2) < 1e-7);
    await expect(
      card.getByRole("button", { name: "Apply candidate", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    assert.deepEqual(
      f.current((await readWorkspace(page)).document, instance),
      before,
    );
    await expect(apply).toBeEnabled();
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
      .getByRole("button", { name: "Keep optimization", exact: true })
      .click();
    const cards = page.getByLabel("Model optimization", { exact: true });
    await expect(cards).toHaveCount(2);
    await expect(
      cards
        .filter({ hasText: "Kept optimization" })
        .getByRole("button", { name: "Apply candidate", exact: true }),
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
    // Cancellation reaches the explicit host control route, not only browser fetch abort.
    await baseline
      .getByRole("button", { name: "Edit optimization settings", exact: true })
      .click();
    const settings = page.getByRole("dialog", {
      name: "Edit optimization",
      exact: true,
    });
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
          name: "Edit optimization settings",
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
      else
        await expect(
          baseline.getByRole("button", {
            name: "Replace source with candidate",
            exact: true,
          }),
        ).toBeDisabled();
    }
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
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
