import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
import { chromium, expect } from "@playwright/test";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await page
    .getByRole("button", { name: "Write equation or note", exact: true })
    .click();
  for (const text of ["P = F*v", "F = 20 N", "v = 3 m/s", "P <= 75 W"]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  const saved = () => readWorkspace(page);
  const initial = (await saved()).page;
  const forceId = initial.regions.find((r) => r.text === "F = 20 N").id;
  const powerId = initial.regions.find((r) => r.text === "P = F*v").id;
  const power = page.locator(`[data-region-id="${powerId}"]`);
  await power.click({ position: { x: 400, y: 25 } });
  await revealRegionActions(page);
  await page
    .getByRole("toolbar", { name: "Equation P actions", exact: true })
    .locator('[data-command-id="response.plot"]')
    .click();
  const artifact = page.getByLabel("Python response artifact", { exact: true });
  await expect(artifact).toHaveAttribute("data-status", "current");
  const baseline = (await saved()).page;
  const baselineComparison = (await saved()).artifacts[0].comparing;
  const open = async () => {
    await page
      .locator(`[data-region-id="${forceId}"]`)
      .click({ position: { x: 400, y: 25 } });
    await revealRegionActions(page);
    await page
      .getByRole("toolbar", { name: "Quantity F actions", exact: true })
      .locator('[data-command-id="quantity.vary"]')
      .click();
    await expect(page.getByLabel("Explore F", { exact: true })).toBeVisible();
  };
  const controls = page.getByLabel("Explore F", { exact: true });
  const value = controls.getByLabel("Exploration value F", { exact: true });
  const change = async (n) => {
    await value.fill(String(n));
    await value.press("Enter");
  };
  await open();
  await controls.getByLabel("Exploration step", { exact: true }).fill("2");
  const slider = controls.getByRole("slider", { name: "Vary F", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(page.locator('[data-result-for="P"]')).toContainText("66 W");
  expect((await saved()).page).toEqual(baseline);
  await change(30);
  await expect(page.locator('[data-result-for="P"]')).toContainText("90 W");
  await expect(controls.getByLabel("Exploration effects")).toContainText(
    "60 W → 90 W",
  );
  await expect(controls.getByLabel("Exploration effects")).toContainText(
    "Pass → Fail",
  );
  await expect(controls.getByLabel("Exploration effects")).toContainText(
    "15 W beyond limit",
  );
  await expect(artifact.locator(".er-artifact-status")).toContainText(
    "Preview",
  );
  expect((await saved()).page).toEqual(baseline);
  await controls.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(controls).toHaveCount(0);
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect((await saved()).page).toEqual(baseline);

  await open();
  await value.fill("30");
  await controls
    .getByRole("button", { name: "Keep as alternative", exact: true })
    .click();
  await expect(controls).toHaveCount(0);
  await expect(page.locator('[data-result-for="P"]')).toContainText("90 W");
  const alternative = await saved();
  expect(alternative.page.contexts).toHaveLength(2);
  expect(alternative.page.active).not.toBe("original");
  expect(alternative.page.regions.find((r) => r.id === forceId).text).toBe(
    "F = 20 N",
  );
  expect(alternative.artifacts[0].compareContext).toBe("original");
  expect(alternative.artifacts[0].comparing).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect((await saved()).page).toEqual(baseline);
  expect((await saved()).artifacts[0].comparing).toBe(baselineComparison);

  await open();
  await controls.getByLabel("Exploration maximum", { exact: true }).fill("25");
  await expect(controls).toBeVisible();
  await change(30);
  await expect(value).toHaveValue("25");
  await expect(page.locator('[data-result-for="P"]')).toContainText("75 W");
  await controls
    .getByRole("button", { name: "Accept value", exact: true })
    .click();
  expect((await saved()).page.contexts).toHaveLength(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect((await saved()).page).toEqual(baseline);

  // Invalid range fields remain a blocker even after another value edit.
  await open();
  await controls.getByLabel("Exploration minimum", { exact: true }).fill("40");
  await change(30);
  await expect(
    controls.getByRole("button", { name: "Accept value", exact: true }),
  ).toBeDisabled();
  await controls.getByLabel("Exploration minimum", { exact: true }).fill("7");
  await expect(
    controls.getByRole("button", { name: "Accept value", exact: true }),
  ).toBeEnabled();
  const speedId = initial.regions.find((r) => r.text === "v = 3 m/s").id;
  await page
    .locator(`[data-region-id="${speedId}"] .er-scrubbable`)
    .first()
    .press("ArrowRight");
  const speedControls = page.getByLabel("Explore v", { exact: true });
  await expect(speedControls).toBeVisible();
  await expect(page.locator('[data-result-for="P"]')).toContainText("60.6 W");
  await speedControls
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect((await saved()).page).toEqual(baseline);

  // The plotted operating point can open the same bound exploration controls.
  await expect(artifact).toHaveAttribute("data-status", "current");
  await artifact
    .getByRole("slider", { name: "Vary artifact input", exact: true })
    .press("Enter");
  await artifact
    .getByRole("button", { name: "Explore value", exact: true })
    .click();
  await expect(controls).toBeVisible();
  await change(28);
  await expect(page.locator('[data-result-for="P"]')).toContainText("84 W");
  await captureEvidence(page, {
    path: new URL("../screenshots/continuous-exploration.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await value.press("Escape");
  await expect(controls).toHaveCount(0);
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect((await saved()).page).toEqual(baseline);

  await open();
  await change(30);
  await page.reload();
  await expect(controls).toHaveCount(0);
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect((await saved()).page).toEqual(baseline);

  // Undefined downstream results cannot be accepted or preserved as alternatives.
  await page
    .getByRole("button", { name: "Write equation or note", exact: true })
    .click();
  await editor.fill("R = 1/F");
  await editor.press("Enter");
  await editor.press("Escape");
  await open();
  await controls.getByLabel("Exploration minimum", { exact: true }).fill("0");
  await change(0);
  await expect(
    controls.getByRole("button", { name: "Accept value", exact: true }),
  ).toBeDisabled();
  await expect(
    controls.getByRole("button", { name: "Keep as alternative", exact: true }),
  ).toBeDisabled();
  await expect(controls).toContainText("undefined");
  await controls.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");
  expect(errors).toEqual([]);
  await context.close();
  console.log(
    "Continuous exploration: live results/requirements/plot, explicit step/bounds, cancel, accept/Undo, atomic alternative, plot entry and undefined-result recovery pass.",
  );
} finally {
  await browser.close();
}
