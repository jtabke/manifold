import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { RegionSession, project } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
import { workspaceStorage } from "../src/regions/workspaceStorage.ts";
import { readWorkspace } from "./browser-workspace.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { shelfRail, sagThickness } from "./shelf-rail.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const native = new RegionSession(shelfRail());
const file = Buffer.from(archive(native.native()));
native.dispose();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
    });
    const page = await context.newPage(),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/optimizer/")) requests.push(r.url());
    });
    await page.goto(base);
    await page
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles({
        name: "Shelf rail.manifold",
        mimeType: "application/json",
        buffer: file,
      });
    const mass = page.locator('[data-region-id="mass"]');
    await expect(mass).toBeVisible();
    const saved = async () =>
      (
        await readWorkspace(
          page,
          workspaceStorage(
            "manifold.artifact-experiment.v1",
            new URL(page.url()).search,
          ),
        )
      ).page;
    const act = async (name) => {
      await mass.click({ position: { x: 6, y: 8 } });
      await page
        .getByRole("button", { name: "Open canvas actions", exact: true })
        .click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    const capture = (name) =>
      captureEvidence(page, {
        path: new URL(`../screenshots/${name}-${width}.png`, import.meta.url)
          .pathname,
        animations: "disabled",
      });
    const before = await saved();
    await act("Optimize…");
    const dialog = page.getByRole("dialog", {
      name: "Optimize mass",
      exact: true,
    });
    await expect(dialog.getByLabel("Optimization goal")).toBeFocused();
    await dialog
      .getByLabel("Input 1", { exact: true })
      .selectOption("thickness");
    await dialog.getByLabel("Minimum for thickness").fill("5 mm");
    await dialog.getByLabel("Maximum for thickness").fill("2 cm");
    const scan = dialog.getByRole("button", { name: "Scan range" });
    const feasibility = dialog.getByRole("region", {
      name: "Sampled feasibility",
    });
    await scan.click();
    await expect(feasibility.getByRole("heading")).toBeFocused();
    await expect(feasibility).toContainText("11.5625 mm and 11.75 mm");
    await expect(
      feasibility.locator("li").filter({ hasText: "stress <= allowable" }),
    ).toContainText("75 of 81 samples pass");
    await dialog.getByLabel("Maximum for thickness").fill("8 mm");
    await expect(feasibility).toHaveCount(0);
    await scan.click();
    await expect(feasibility.locator("li").first()).toContainText(
      "0 of 81 samples pass",
    );
    assert.equal(
      requests.length,
      0,
      "Opening, configuring and scanning must not run optimization",
    );
    assert.deepEqual(await saved(), before);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    if (width === 390) {
      // Two axes entered from Optimize hand off to the same canvas placement, not another modal.
      await act("Optimize…");
      await dialog
        .getByLabel("Input 1", { exact: true })
        .selectOption("thickness");
      await dialog.getByRole("button", { name: "Add second input" }).click();
      await dialog.getByLabel("Input 2", { exact: true }).selectOption("width");
      await dialog.getByRole("button", { name: "Plot on canvas" }).click();
    } else await act("Plot against two inputs");
    const study = page.locator("[data-response-study]");
    const maps = study.getByRole("region", { name: "Response maps" });
    await expect(study).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(maps.getByRole("img", { name: /response map/ })).toHaveCount(
      3,
    );
    const outputs = maps.locator(".design-map-title span");
    await expect(outputs).toHaveText(["4.68 kg", "0.9259 mm", "16.67 MPa"]);
    const canvas = page.locator(".er-canvas");
    const viewport = await canvas.boundingBox(),
      bounds = await study.boundingBox();
    assert(
      bounds.width <= viewport.width,
      `Card ${bounds.width} fits viewport ${viewport.width}`,
    );
    const mapRows = await maps
      .locator(".design-map-card")
      .evaluateAll((cards) => cards.map((card) => card.offsetTop));
    assert.equal(new Set(mapRows).size, width === 390 ? 3 : 1);
    assert.equal(
      requests.length,
      0,
      "Canvas study creation only derives worksheet samples",
    );
    await expect.poll(async () => (await saved()).plots.length).toBe(1);
    const created = (await saved()).plots[0];
    assert.deepEqual((await saved()).regions, before.regions);

    await study.getByRole("button", { name: "Add map", exact: true }).click();
    const setup = study.getByRole("region", { name: "Study setup" });
    await expect(setup.getByLabel("Add reported quantity")).toBeFocused();
    await setup.getByLabel("Input 1", { exact: true }).selectOption("width");
    await expect(setup.getByLabel("Input 2", { exact: true })).toHaveValue(
      "thickness",
    );
    await setup.getByLabel("Minimum for width").fill("25");
    await setup.getByLabel("Maximum for width").fill("6 cm");
    await setup.getByLabel("Minimum for thickness").fill("5 mm");
    await setup.getByLabel("Maximum for thickness").fill("20 mm");
    await setup.getByLabel("Add reported quantity").selectOption("cost");
    await expect(
      study.getByRole("button", { name: "Run", exact: true }),
    ).toBeDisabled();
    await expect(
      maps.getByRole("img", { name: "cost response map" }),
    ).toHaveCount(0);
    assert.deepEqual(
      (await saved()).plots,
      [created],
      "Draft does not change the accepted view",
    );
    await setup
      .getByRole("button", { name: "Update maps", exact: true })
      .click();
    await expect(setup).toHaveCount(0);
    await expect(outputs).toHaveText([
      "4.68 kg",
      "0.9259 mm",
      "16.67 MPa",
      "14.04",
    ]);
    await expect
      .poll(async () => (await saved()).plots[0].study.axes[0].low)
      .toBe("25 mm");
    assert.deepEqual((await saved()).regions, before.regions);

    const deflection = maps.getByRole("img", {
      name: "deflection response map",
    });
    const hit = deflection.locator(".design-map-hit"),
      hitBounds = await hit.boundingBox();
    await hit.click({
      position: { x: 0.15 * hitBounds.width, y: 0.9 * hitBounds.height },
    });
    await expect(maps.getByRole("status")).toContainText(
      "Fails selected requirements",
    );
    await expect(maps.locator(".design-map-sample")).toHaveCount(4);
    const cursors = maps.locator(".design-map-cursor"),
      coordinates = await cursors.first().getAttribute("d");
    await maps
      .getByRole("img", { name: "stress response map" })
      .press("ArrowUp");
    await expect(cursors.first()).not.toHaveAttribute("d", coordinates);
    assert.equal(
      new Set(
        await cursors.evaluateAll((paths) =>
          paths.map((p) => p.getAttribute("d")),
        ),
      ).size,
      1,
    );
    await maps.getByRole("button", { name: "Current", exact: true }).click();
    assert.equal(requests.length, 0, "Inspection is not a solver run");
    const configured = await saved();
    assert.deepEqual(configured.regions, before.regions);
    assert.deepEqual(configured.contexts, before.contexts);

    if (width === 1440) {
      const grip = study.getByRole("button", { name: "Move response study" });
      await grip.scrollIntoViewIfNeeded();
      const g = await grip.boundingBox();
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      await page.mouse.move(g.x + g.width / 2 + 34, g.y + g.height / 2 + 28, {
        steps: 5,
      });
      await page.mouse.up();
      await expect
        .poll(async () => (await saved()).plots[0].at.x)
        .toBeCloseTo(configured.plots[0].at.x + 34, 0);
      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => (await saved()).plots[0].at)
        .toEqual(configured.plots[0].at);
      await study
        .getByRole("button", { name: "Fold source equations" })
        .click();
      await expect(
        page
          .locator("[data-group-id]")
          .filter({ hasText: "mass calculations" }),
      ).toBeVisible();
      await expect(mass).toBeHidden();
      await expect(
        study.getByRole("button", { name: "Fold source equations" }),
      ).toHaveCount(0);
      assert.deepEqual((await saved()).regions, before.regions);
    }
    await page.reload();
    await expect(outputs).toHaveText([
      "4.68 kg",
      "0.9259 mm",
      "16.67 MPa",
      "14.04",
    ]);
    assert.equal(
      requests.length,
      0,
      "Reload derives the study without a solver job",
    );
    await expect(
      maps.getByRole("button", { name: "Candidate", exact: true }),
    ).toHaveCount(0);
    await study
      .getByRole("heading", { name: "mass", exact: true, level: 2 })
      .scrollIntoViewIfNeeded();
    await capture("worksheet-canvas-study");

    const run = study.getByRole("button", { name: "Run", exact: true });
    await run.click();
    const capability = await context.request.get(
      base + "/api/optimizer/capability",
    );
    if (capability.status() === 503) {
      assert.notEqual(process.env.MANIFOLD_REQUIRE_OPTIMIZER, "1");
      await expect(study.getByRole("alert")).toContainText(
        /runtime unavailable/i,
      );
      await expect(
        study.getByRole("button", { name: "Apply", exact: true }),
      ).toHaveCount(0);
    } else {
      assert.equal(capability.status(), 200);
      const review = study.getByRole("region", { name: "Candidate review" });
      await expect(
        review.getByRole("table", { name: "Requirement margins" }),
      ).toContainText("At limit", { timeout: 10000 });
      await expect(
        review.getByRole("heading", { name: "Candidate preview" }),
      ).toBeInViewport();
      const preview = review.getByRole("table", { name: "Design comparison" });
      await expect(
        preview.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: "width", exact: true }),
        }),
      ).toContainText("25 mm");
      await expect(outputs).toHaveText([
        "2.647 kg",
        "2 mm",
        "32.57 MPa",
        "7.94",
      ]);
      await expect(maps.locator(".design-map-candidate")).toHaveCount(4);
      await review.getByRole("button", { name: "Locate on maps" }).click();
      await expect(
        maps.getByRole("heading", { name: "Response maps" }),
      ).toBeFocused();
      await capture("worksheet-canvas-candidate");
      assert.deepEqual(
        await saved(),
        configured,
        "Run does not change worksheet or study settings",
      );
      await review
        .getByRole("button", {
          name: width === 390 ? "Keep as alternative" : "Apply",
          exact: true,
        })
        .click();
      await expect(review).toHaveCount(0);
      await expect(study).toBeVisible();
      await expect
        .poll(async () =>
          Number(
            project(await saved())
              .solved.values.get("width")
              .value.toFixed(5),
          ),
        )
        .toBe(0.025);
      const applied = await saved();
      assert(
        Math.abs(
          project(applied).solved.values.get("thickness").value * 1000 -
            sagThickness(25, 2),
        ) < 2e-5,
      );
      if (width === 390) {
        assert.notEqual(applied.active, "original");
        assert.equal(
          project(applied, "original").texts.thickness,
          "thickness := 15 mm",
        );
      }
      await page.keyboard.press("Control+z");
      await expect
        .poll(async () => project(await saved()).texts.thickness)
        .toBe("thickness := 15 mm");
      const setupButton = study.getByRole("button", {
        name: "Setup",
        exact: true,
      });
      await setupButton.click();
      await setup.getByLabel("Maximum for thickness").fill("8 mm");
      await setup.getByRole("button", { name: "Update maps" }).click();
      await run.click();
      await expect(study.getByRole("alert")).toContainText(
        "No feasible candidate found",
      );
      await expect(
        study.getByRole("button", { name: "Apply", exact: true }),
      ).toHaveCount(0);
      assert.deepEqual((await saved()).regions, before.regions);
    }
    await study.getByRole("button", { name: "Remove study" }).click();
    await expect(study).toHaveCount(0);
    await expect.poll(async () => (await saved()).plots.length).toBe(0);
    await page.keyboard.press("Control+z");
    await expect(study).toHaveCount(1);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Worksheet design at desktop and 390 px: one-input scan, portable linked study, shared probe, folded sources, reviewed Apply/alternative and Undo.",
  );
} finally {
  await browser.close();
}
