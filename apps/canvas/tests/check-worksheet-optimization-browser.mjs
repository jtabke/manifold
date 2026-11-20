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
const native = (limit) => {
  const s = new RegionSession(shelfRail(limit));
  try {
    return archive(s.native());
  } finally {
    s.dispose();
  }
};
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
    const openSheet = async (limit) => {
      await page
        .getByLabel("Open workspace file", { exact: true })
        .setInputFiles({
          name: "Shelf rail.manifold",
          mimeType: "application/json",
          buffer: Buffer.from(native(limit)),
        });
      await expect(page.locator('[data-region-id="mass"]')).toBeVisible();
    };
    await openSheet("2 mm");
    const dialog = page.getByRole("dialog", {
      name: "Optimize mass",
      exact: true,
    });
    const open = async () => {
      await page
        .locator('[data-region-id="mass"]')
        .click({ position: { x: 6, y: 8 } });
      await page
        .getByRole("button", { name: "Open canvas actions", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "Optimize…", exact: true })
        .click();
      await expect(dialog.getByLabel("Optimization goal")).toBeFocused();
      await dialog
        .getByLabel("Input 1", { exact: true })
        .selectOption("thickness");
      await dialog.getByLabel("Minimum for thickness").fill("5 mm");
      await dialog.getByLabel("Maximum for thickness").fill("2 cm");
      await dialog.getByLabel("Add reported quantity").selectOption("cost");
      await expect(dialog.getByLabel("stress <= allowable")).toBeChecked();
    };
    await open();
    assert.equal(
      requests.length,
      0,
      "Opening or configuring must not probe or run",
    );
    const before = await saved();
    await dialog.getByRole("button", { name: "Run", exact: true }).click();
    const capability = await context.request.get(
      base + "/api/optimizer/capability",
    );
    if (capability.status() === 503) {
      assert.notEqual(process.env.MANIFOLD_REQUIRE_OPTIMIZER, "1");
      await expect(dialog.getByRole("alert")).toContainText(
        /runtime unavailable/i,
      );
      await expect(
        dialog.getByRole("button", { name: "Apply", exact: true }),
      ).toHaveCount(0);
      assert.deepEqual(await saved(), before);
    } else {
      assert.equal(capability.status(), 200);
      const preview = dialog.getByRole("table", { name: "Design comparison" });
      const candidate = (name) =>
        preview
          .getByRole("row")
          .filter({
            has: page.getByRole("rowheader", { name, exact: true }),
          })
          .getByRole("cell")
          .last();
      const reviewed = async () => {
        await expect(
          dialog.getByRole("heading", { name: "Candidate preview" }),
        ).toBeVisible({ timeout: 10000 });
        await expect(
          dialog.getByRole("table", { name: "Requirement margins" }),
        ).toContainText("At limit");
      };
      await reviewed();
      assert(
        Math.abs(
          parseFloat(await candidate("thickness").innerText()) -
            sagThickness(40, 2),
        ) < 2e-5,
      );
      await expect(candidate("deflection")).toHaveText(/2 mm/);
      await expect(candidate("stress")).toHaveText(/MPa/);
      const expectedCost = (3 * 0.04 * 7800 * sagThickness(40, 2)) / 1000;
      await expect(candidate("cost")).toHaveText(
        String(Number(expectedCost.toPrecision(6))),
      );
      assert.deepEqual(
        await saved(),
        before,
        "Run must not change the original file",
      );
      assert(
        await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth),
        "No horizontal scrolling, including at 390 px",
      );
      await dialog
        .getByRole("button", { name: "Apply", exact: true })
        .scrollIntoViewIfNeeded();
      await captureEvidence(page, {
        path: new URL(
          `../screenshots/worksheet-design-${width}.png`,
          import.meta.url,
        ).pathname,
        animations: "disabled",
      });
      if (width === 390) {
        await dialog
          .getByRole("button", { name: "Keep as alternative" })
          .click();
        await expect(dialog).toHaveCount(0);
        const kept = await saved();
        assert.notEqual(kept.active, "original");
        assert.equal(
          project(kept, "original").texts.thickness,
          before.regions.find((r) => r.id === "thickness").text,
        );
        assert(
          Math.abs(
            project(kept).solved.values.get("thickness").value * 1000 -
              sagThickness(40, 2),
          ) < 2e-5,
        );
      } else {
        await dialog.getByRole("button", { name: "Add second input" }).click();
        await expect(preview).toHaveCount(
          0,
          "Editing settings invalidates the preview",
        );
        await dialog
          .getByLabel("Input 2", { exact: true })
          .selectOption("width");
        await dialog.getByLabel("Minimum for width").fill("25");
        await dialog.getByLabel("Maximum for width").fill("60");
        await dialog.getByRole("button", { name: "Run", exact: true }).click();
        await reviewed();
        assert(
          Math.abs(parseFloat(await candidate("width").innerText()) - 25) <
            1e-5,
        );
        await dialog
          .getByRole("button", { name: "Apply", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        const applied = await saved();
        assert.equal(applied.active, "original");
        assert(
          Math.abs(
            project(applied).solved.values.get("thickness").value * 1000 -
              sagThickness(25, 2),
          ) < 2e-5,
        );
        assert(
          Math.abs(
            project(applied).solved.values.get("width").value * 1000 - 25,
          ) < 1e-5,
        );
        await page.keyboard.press("Control+z");
        await expect
          .poll(async () => project(await saved()).texts.thickness)
          .toBe("thickness := 15 mm");
        assert.equal(project(await saved()).texts.width, "width := 40 mm");
        // Tighten the permitted range until no design can satisfy the sag limit.
        await open();
        await dialog.getByLabel("Maximum for thickness").fill("8 mm");
        await dialog.getByRole("button", { name: "Run", exact: true }).click();
        await expect(dialog.getByRole("alert")).toContainText(
          "No feasible candidate found",
        );
        await expect(
          dialog.getByRole("button", { name: "Apply", exact: true }),
        ).toHaveCount(0);
        await expect(
          dialog.getByRole("button", { name: "Keep as alternative" }),
        ).toHaveCount(0);
        assert.deepEqual(await saved(), before);
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Worksheet Actions → Optimize, desktop and 390 px: explicit review before adoption.",
  );
} finally {
  await browser.close();
}
