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
      hasTouch: width === 390,
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
      await page.getByRole("button", { name: /^Open actions: / }).click();
      if (name === "Map mass across two inputs")
        await page.getByRole("menuitem", { name: "Plot", exact: true }).click();
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
    } else await act("Map mass across two inputs");
    const study = page.locator("[data-response-study]");
    const maps = study.getByRole("region", { name: "Response maps" });
    await expect(study).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(maps.getByRole("img", { name: /response map/ })).toHaveCount(
      3,
    );
    const outputs = maps.locator(".design-map-title span");
    await expect(outputs).toHaveText(["4.68 kg", "0.9259 mm", "16.67 MPa"]);
    const margins = maps.getByRole("list", { name: "Requirement margins" });
    const sag = margins.getByRole("button", {
      name: "Highlight boundary for deflection <= 2 mm",
    });
    const strength = margins.getByRole("button", {
      name: "Highlight boundary for stress <= allowable",
    });
    const highlighted = maps.locator(
      '.design-map-boundary[data-highlighted="true"]',
    );
    const comparisons = maps.getByRole("table", {
      name: "Pinned design comparison",
    });
    const pin = maps.getByRole("button", { name: "Pin sample", exact: true });
    await expect(margins).toContainText("Passes · +1.074 mm");
    await expect(margins).toContainText("Passes · +83.33 MPa");
    await expect(pin).toBeDisabled();
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
    await setup.getByLabel("X axis", { exact: true }).selectOption("width");
    await expect(setup.getByLabel("Y axis", { exact: true })).toHaveValue(
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
    const scenario = study.locator(".study-header .study-scenario");
    await expect(scenario).toHaveText("Scenario: Original");
    assert(
      await scenario.evaluate((el) => {
        const name = getComputedStyle(el.querySelector("strong"));
        const objective = getComputedStyle(
          el.closest(".study-title").querySelector("h2"),
        );
        return (
          name.fontSize === objective.fontSize &&
          name.fontWeight === objective.fontWeight
        );
      }),
    );
    const chartRhythm = await maps
      .locator(".design-map-card")
      .evaluateAll((cards) => {
        const rows = new Map();
        for (const card of cards) {
          const gradient = card
            .querySelector(".design-map-scale i")
            .getBoundingClientRect();
          const bars = rows.get(card.offsetTop) ?? [];
          bars.push(gradient.top);
          rows.set(card.offsetTop, bars);
        }
        return [...rows.values()].map((bars) => ({
          count: bars.length,
          aligned: Math.max(...bars) - Math.min(...bars) < 1,
        }));
      });
    assert.deepEqual(
      chartRhythm,
      (width === 390 ? [1, 1, 1, 1] : [2, 2]).map((count) => ({
        count,
        aligned: true,
      })),
    );
    const globalKey = maps.locator(".design-map-reading .design-map-key");
    const localKeys = maps.locator(
      ".design-map-card .design-map-key.is-local:visible",
    );
    if (width === 390) await expect(globalKey).toBeHidden();
    else await expect(globalKey).toBeVisible();
    await expect(localKeys).toHaveCount(width === 390 ? 4 : 0);
    const run = study.getByRole("button", { name: "Run", exact: true });
    const footerIsClear = (key) =>
      key.evaluate((legend) => {
        const card = legend.closest(".design-map-card");
        const canvas = card.closest(".er-canvas").getBoundingClientRect();
        const footer = [card.querySelector(".design-map-scale"), legend];
        return footer.every((node) => {
          const { left, right, top, bottom } = node.getBoundingClientRect();
          const x = (left + right) / 2;
          return (
            top >= canvas.top &&
            bottom <= canvas.bottom &&
            [top + 1, bottom - 1].every((y) =>
              node.contains(document.elementFromPoint(x, y)),
            )
          );
        });
      });
    const checkMobileFooters = async () => {
      for (const key of await localKeys.all()) {
        const output = await key.evaluate(async (legend) => {
          // Let any deferred comparison reveal settle before we move the camera.
          await new Promise(requestAnimationFrame);
          const canvas = legend.closest(".er-canvas");
          const { top, height } = canvas.getBoundingClientRect();
          canvas.scrollTop +=
            legend.getBoundingClientRect().top - top - height / 2;
          return legend.closest(".design-map-card").querySelector("h4")
            .textContent;
        });
        await expect(maps.locator("[data-probe-stuck]")).toHaveCount(1);
        await expect
          .poll(() => footerIsClear(key), {
            message: `${output} footer clears the sticky probe`,
          })
          .toBe(true);
      }
    };
    const inputs = study.getByRole("region", { name: "Study inputs" });
    const varied = inputs.getByLabel("Varied inputs", { exact: true });
    await expect(varied.locator("dt")).toHaveText(["X axis", "Y axis"]);
    await expect(varied.getByRole("button")).toHaveText(["width", "thickness"]);
    await expect(varied.locator("strong")).toHaveText(["40 mm", "15 mm"]);
    await expect(inputs).not.toContainText("Scenario");
    const quickMargins = maps.locator(".design-map-quick-margins");
    await expect(quickMargins).toBeHidden();
    const fixedToggle = inputs.getByText("Fixed inputs (5)", { exact: true });
    const fixed = study.getByLabel("Fixed inputs", { exact: true });
    await expect(fixed).toBeHidden();
    if (width === 390) {
      const title = await scenario.boundingBox();
      const action = await run.boundingBox();
      assert(
        title.y < action.y + action.height && title.y + title.height > action.y,
        "Run shares the study identity row",
      );
      await expect(maps.locator(".design-map-guide-compact")).toBeVisible();
      await expect(maps.locator(".design-map-guide-compact")).toContainText(
        "Tap to inspect",
      );
      await expect.poll(() => footerIsClear(localKeys.first())).toBe(true);
    }
    await capture("worksheet-study-compact");
    const massMap = maps.getByRole("img", { name: "mass response map" });
    await expect(massMap).toHaveAccessibleDescription(
      /use arrow keys to inspect/,
    );
    if (width === 390) {
      const massHit = massMap.locator(".design-map-hit");
      await massHit.tap();
      await expect(maps.getByRole("status")).toContainText("Sampled design");
      await expect(pin).toBeEnabled();
      await maps.getByRole("button", { name: "Current", exact: true }).tap();
      const top = await canvas.evaluate((el) => el.scrollTop);
      const { x, y, width: w, height: h } = await massHit.boundingBox();
      const center = { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [center],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...center, y: center.y - 50 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
      await expect
        .poll(() => canvas.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(top + 30);
      await expect(maps.getByRole("status")).toContainText("Current design");
      await canvas.evaluate((el, top) => {
        el.scrollTop = top;
      }, top);
    }
    await fixedToggle.click();
    await expect(fixed).toContainText("span1 m");
    await expect(fixed).toContainText("force100 N");
    await expect(fixed).toContainText("modulus200000 MPa");
    await expect(
      fixed.getByRole("button", { name: /width|thickness/ }),
    ).toHaveCount(0);
    const fixedLayout = await fixed.evaluate((list) => {
      const rect = list.getBoundingClientRect();
      const entries = [...list.children].map((entry) =>
        entry.getBoundingClientRect(),
      );
      return {
        rows: new Set(entries.map((entry) => entry.top)).size,
        compact: entries.every((entry) => entry.height <= 32),
        fits: entries.every(
          (entry) => entry.left >= rect.left && entry.right <= rect.right,
        ),
      };
    });
    assert.deepEqual(fixedLayout, {
      rows: width === 390 ? 2 : 1,
      compact: true,
      fits: true,
    });
    await capture("worksheet-fixed-inputs");
    await fixed
      .getByRole("button", { name: "Edit fixed input force", exact: true })
      .click();
    await expect(
      page.locator('[data-region-id="force"].is-editing'),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await fixedToggle.click();
    assert.deepEqual((await saved()).regions, before.regions);

    const deflection = maps.getByRole("img", {
      name: "deflection response map",
    });
    const hit = deflection.locator(".design-map-hit"),
      hitBounds = await hit.boundingBox();
    await hit.click({
      // Pick the center of a grid cell rather than a fractional pixel near a snap boundary.
      position: {
        x: (4 / 24) * hitBounds.width,
        y: (21 / 24) * hitBounds.height,
      },
    });
    await expect(maps.getByRole("status")).toContainText(
      "Fails selected requirements",
    );
    await expect(maps.locator(".design-map-sample")).toHaveCount(4);
    await expect(sag).toContainText("Fails · −");
    await expect(strength).toContainText("Fails · −");
    await expect(highlighted).toHaveCount(8);
    await strength.click();
    await expect(strength).toHaveAttribute("aria-pressed", "true");
    await expect(highlighted).toHaveCount(4);
    await expect(highlighted.first()).toHaveAttribute(
      "data-requirement",
      "strength",
    );
    await strength.click();
    await expect(highlighted).toHaveCount(8);
    if (width === 390) {
      const stressMap = maps.getByRole("img", { name: "stress response map" });
      await stressMap.evaluate((target) => {
        const canvas = target.closest(".er-canvas");
        const root = canvas.getBoundingClientRect();
        const card = target
          .closest(".er-response-study")
          .getBoundingClientRect();
        canvas.scrollLeft +=
          card.left - root.left - (root.width - card.width) / 2;
        canvas.scrollTop += target.getBoundingClientRect().top - root.top - 170;
      });
      await expect(stressMap).toBeInViewport();
      await expect(pin).toBeInViewport();
      await expect(quickMargins).toBeInViewport();
      await expect(
        quickMargins.locator(".design-map-quick-margin strong"),
      ).toHaveText([/−[\d.]+ mm/, /−[\d.]+ MPa/]);
      await expect
        .poll(async () => {
          const sticky = await maps
            .locator(".design-map-inspect")
            .boundingBox();
          return Math.abs(sticky.y - viewport.y);
        })
        .toBeLessThan(2);
      await capture("worksheet-sticky-probe");
      await checkMobileFooters();
    }
    await pin.press("Enter");
    await expect(
      maps.getByRole("button", { name: "Sample A pinned" }),
    ).toBeFocused();
    await expect(maps.locator(".design-map-pin")).toHaveCount(4);
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
    await hit.click({
      position: {
        x: (4 / 24) * hitBounds.width,
        y: (11 / 24) * hitBounds.height,
      },
    });
    await expect(maps.getByRole("status")).toContainText(
      "Passes selected requirements",
    );
    await pin.click();
    await expect(maps.locator(".design-map-pin")).toHaveCount(8);
    const compareTwo = maps.getByRole("button", {
      name: "Compare (2)",
      exact: true,
    });
    await compareTwo.click();
    await expect(comparisons.getByRole("columnheader")).toHaveText([
      "Quantity",
      "Current",
      "Sample A",
      "Sample B",
    ]);
    const inspectA = comparisons.getByRole("button", {
      name: "Inspect sample A",
      exact: true,
    });
    const inspectB = comparisons.getByRole("button", {
      name: "Inspect sample B",
      exact: true,
    });
    const sampleBCoordinates = await cursors.first().getAttribute("d");
    await expect(inspectB).toHaveAttribute("aria-pressed", "true");
    if (width === 390) await inspectA.tap();
    else await inspectA.press("Enter");
    await expect(inspectA).toHaveAttribute("aria-pressed", "true");
    await expect(inspectB).toHaveAttribute("aria-pressed", "false");
    await expect(maps.locator(".design-map-probe")).toContainText("Sample A");
    await expect(cursors.first()).toHaveAttribute("d", coordinates);
    if (width === 390) await inspectB.tap();
    else await inspectB.press("Enter");
    await expect(inspectB).toHaveAttribute("aria-pressed", "true");
    await expect(maps.locator(".design-map-probe")).toContainText("Sample B");
    await expect(cursors.first()).toHaveAttribute("d", sampleBCoordinates);
    const massComparison = comparisons.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: "mass", exact: true }),
    });
    await expect(massComparison.getByRole("cell")).toHaveText([
      "4.68 kg",
      "1.653 kgΔ −3.027",
      "3.157 kgΔ −1.523",
    ]);
    const sagComparison = comparisons.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: /deflection <= 2 mm/ }),
    });
    await expect(sagComparison.getByRole("cell")).toHaveText([
      /Passes\+1.074 mm/,
      /Fails−[\d.]+ mm/,
      /Passes\+[\d.]+ mm/,
    ]);
    assert(
      await comparisons.evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
    await expect(massComparison.getByRole("cell").last()).toHaveAttribute(
      "data-inspected",
      "true",
    );
    await capture("worksheet-map-comparison");
    const swapAxes = study.getByRole("button", {
      name: "Swap axes",
      exact: true,
    });
    const beforeSwap = await saved();
    const studyAxisLabels = study.locator(".study-axes dd button");
    const probeCoords = maps.locator(".design-probe-coordinates > span");
    const axisOrder = await studyAxisLabels.allTextContents();
    const sampleB = await probeCoords.allTextContents();
    const mapLabels = deflection.locator(".design-map-axis");
    const mapAxisOrder = await mapLabels.allTextContents();
    await swapAxes.click();
    await expect(swapAxes).toHaveAttribute("aria-pressed", "true");
    await expect(studyAxisLabels).toHaveText(axisOrder.toReversed());
    await expect(mapLabels).toHaveText(mapAxisOrder.toReversed());
    await expect(probeCoords).toHaveText(sampleB.toReversed());
    await expect(inspectB).toHaveAttribute("aria-pressed", "true");
    await expect(maps.locator(".design-map-pin")).toHaveCount(8);
    await expect(cursors.first()).not.toHaveAttribute("d", sampleBCoordinates);
    await inspectA.click();
    const transposedHit = await hit.boundingBox();
    await hit.click({
      position: {
        x: (13 / 24) * transposedHit.width,
        y: (20 / 24) * transposedHit.height,
      },
    });
    await expect(inspectB).toHaveAttribute("aria-pressed", "true");
    await expect(probeCoords).toHaveText(sampleB.toReversed());
    assert.deepEqual(await saved(), beforeSwap);
    assert.equal(requests.length, 0);
    await swapAxes.click();
    await expect(cursors.first()).toHaveAttribute("d", sampleBCoordinates);
    const beforeTrial = await saved();
    const preview = maps
      .getByRole("region", { name: "Requirement margins", exact: true })
      .getByRole("button", {
        name: "Preview limit",
        exact: true,
      });
    const previewForm = maps.getByRole("form", {
      name: "Preview a fixed requirement",
    });
    const previewValue = previewForm.getByLabel("Preview value");
    const resetLimit = maps.getByRole("button", {
      name: "Reset limit",
      exact: true,
    });
    const hatch = deflection.locator('path[fill$="-fail)"]');
    const originalHatch = await hatch.getAttribute("d");
    await preview.click();
    await expect(previewValue).toHaveValue("2 mm");
    await previewValue.fill("1 N");
    await previewForm.getByRole("button", { name: "Show preview" }).click();
    await expect(previewForm.getByRole("alert")).toContainText(
      "compatible with mm",
    );
    await expect(hatch).toHaveAttribute("d", originalHatch);
    await previewValue.fill("1 mm");
    await previewForm.getByRole("button", { name: "Show preview" }).click();
    const previewStrip = maps.locator(".design-limit-actions.is-previewing");
    await expect(
      previewStrip.getByText("Map preview · deflection ≤ 1 mm", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(previewStrip).toContainText("Worksheet unchanged");
    await expect(
      previewStrip.getByRole("button", { name: "Reset limit", exact: true }),
    ).toBeVisible();
    await expect(
      study.getByRole("button", { name: "Run", exact: true }),
    ).toBeDisabled();
    await expect(hatch).not.toHaveAttribute("d", originalHatch);
    await expect(maps.locator(".design-map-pin")).toHaveCount(8);
    await expect(maps.locator(".design-map-probe")).toContainText("Sample B");
    const previewSag = comparisons.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: /deflection <= 1 mm/ }),
    });
    await expect(previewSag.getByRole("cell").last()).toHaveText(
      /Fails−0\.793\d* mm/,
    );
    assert.deepEqual(
      await saved(),
      beforeTrial,
      "Preview has no accepted edit",
    );
    if (process.env.MANIFOLD_TEST_EVIDENCE === "1") {
      await compareTwo.click();
      const anchor =
        width === 390
          ? deflection
          : maps.getByRole("heading", { name: "Response maps" });
      await anchor.evaluate(
        (target, inset) => {
          const c = target.closest(".er-canvas");
          c.scrollTop +=
            target.getBoundingClientRect().top -
            c.getBoundingClientRect().top -
            inset;
        },
        width === 390 ? 170 : 8,
      );
      await expect(deflection).toBeInViewport();
      await capture("worksheet-limit-preview");
      await compareTwo.click();
    }
    if (width === 390) await checkMobileFooters();
    await resetLimit.click();
    await expect(sagComparison.getByRole("cell").last()).toHaveText(
      /Passes\+0.207 mm/,
    );
    await expect(hatch).toHaveAttribute("d", originalHatch);
    await expect(run).toBeEnabled();
    await inspectA.click();
    await expect(maps.getByRole("status")).toContainText("Sample A");
    await expect(cursors.first()).toHaveAttribute("d", coordinates);
    await maps.getByRole("button", { name: "Remove sample A" }).click();
    await expect(maps.locator(".design-map-pin")).toHaveCount(4);
    await expect(
      comparisons.getByRole("columnheader", { name: "Sample A" }),
    ).toHaveCount(0);
    await maps
      .getByRole("button", { name: "Compare (1)", exact: true })
      .click();
    await expect(comparisons).toHaveCount(0);
    await maps.getByRole("button", { name: "Current", exact: true }).click();
    assert.equal(
      requests.length,
      0,
      "Inspection and comparison are not solver runs",
    );
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
    await expect(
      maps.getByRole("button", { name: /Compare \(\d\)/ }),
    ).toHaveCount(0);
    await expect(maps.locator(".design-map-pin")).toHaveCount(0);
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

    await deflection.press("ArrowDown");
    await pin.click();
    await deflection.press("ArrowRight");
    await pin.click();
    await deflection.press("ArrowRight");
    await expect(
      maps.getByRole("button", { name: "2 samples pinned" }),
    ).toBeDisabled();
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
      const savedCandidate = await saved();
      const completedRuns = requests.length;
      await swapAxes.click();
      await expect(review).toBeVisible();
      await expect(maps.locator(".design-map-candidate")).toHaveCount(4);
      assert.deepEqual(await saved(), savedCandidate);
      assert.equal(requests.length, completedRuns);
      await swapAxes.click();
      const candidateComparison = review.getByRole("table", {
        name: "Design comparison",
      });
      await expect(
        candidateComparison.getByRole("row").filter({
          has: page.getByRole("rowheader", { name: "width", exact: true }),
        }),
      ).toContainText("25 mm");
      const tradeoff = review.getByRole("region", {
        name: "Candidate trade-off",
      });
      await expect(tradeoff.getByRole("listitem")).toHaveText([
        /mass: 4\.68 kg → 2\.6465\d kg/,
        "width at minimum · 25 mm",
        "deflection ≤ 2 mm · ≈0 mm margin",
      ]);
      const apply = review.getByRole("button", { name: "Apply", exact: true });
      await apply.scrollIntoViewIfNeeded();
      await expect(tradeoff).toBeInViewport();
      await capture("worksheet-candidate-tradeoff");
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
      await expect(sag).toContainText("At limit ·");
      await expect(strength).toContainText("Passes · +67.43 MPa");
      await expect(highlighted).toHaveCount(4);
      await expect(highlighted.first()).toHaveAttribute(
        "data-requirement",
        "sag",
      );
      await capture("worksheet-canvas-candidate");
      await maps
        .getByRole("button", { name: "Compare (2)", exact: true })
        .click();
      await expect(comparisons.getByRole("columnheader")).toHaveText([
        "Quantity",
        "Current",
        "Checked candidate",
        "Sample A",
        "Sample B",
      ]);
      assert(
        await comparisons.evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      assert.deepEqual(
        await saved(),
        configured,
        "Run does not change worksheet or study settings",
      );
      const jobs = requests.length;
      await preview.click();
      await previewValue.fill("1");
      await previewForm.getByRole("button", { name: "Show preview" }).click();
      await expect(review).toHaveCount(0);
      await expect(
        maps.getByRole("button", { name: "Candidate", exact: true }),
      ).toHaveCount(0);
      await expect(
        comparisons.getByRole("columnheader", {
          name: "Checked candidate",
          exact: true,
        }),
      ).toHaveCount(0);
      await resetLimit.click();
      await expect(
        review.getByRole("button", { name: "Apply", exact: true }),
      ).toBeVisible();
      assert.equal(
        requests.length,
        jobs,
        "Limit preview did not run the solver",
      );
      await review
        .getByRole("button", {
          name: width === 390 ? "Keep as alternative" : "Apply",
          exact: true,
        })
        .click();
      await expect(review).toHaveCount(0);
      await expect(comparisons).toHaveCount(0);
      await expect(maps.locator(".design-map-pin")).toHaveCount(0);
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
        await expect(scenario).toHaveText(
          `Scenario: ${applied.contexts.find((c) => c.id === applied.active).label}`,
        );
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
    "Worksheet design at desktop and 390 px: sticky probe, fixed inputs and source links, map-only limit preview, pinned comparison, candidate review and Undo.",
  );
} finally {
  await browser.close();
}
