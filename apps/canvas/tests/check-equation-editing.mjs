const baseURL = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
let checks = 0;
try {
  for (const width of [1500, 838]) {
    const context = await browser.newContext({
      viewport: { width, height: 1100 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const editor = () =>
      page.getByLabel("Write an engineering region", { exact: true });
    const selection = () =>
      editor().evaluate((e) => [e.selectionStart, e.selectionEnd]);
    await page.goto(`${baseURL}/?think=1&artifacts=1`);
    await page
      .getByLabel("Empty engineering page", { exact: true })
      .click({ position: { x: 100, y: 80 } });
    for (const text of [
      "T = T_inf + Q/(h*A)",
      "T_inf := 25 °C",
      "Q := 800 W",
      "h := 60 W/(m² K)",
      "A := 0.2 m²",
      "T <= 100 °C",
    ]) {
      await editor().fill(text);
      await editor().press("Enter");
    }
    await editor().press("Escape");
    const equation = page.locator('.er-region[data-kind="equation"]').first();
    const text = "T = T_inf + Q/(h*A)";
    const term = equation.getByRole("button", { name: "Edit Q", exact: true });
    await term.click({ position: { x: 1, y: 8 } });
    expect(await selection()).toEqual([text.indexOf("Q"), text.indexOf("Q")]);
    await editor().pressSequentially("2*");
    await editor().press("Escape");
    await expect(page.locator('[data-result-for="T"]')).toContainText(
      "158.333",
    );
    await page.getByLabel("Undo", { exact: true }).click();
    await expect(page.locator('[data-result-for="T"]')).toContainText(
      "91.6667",
    );
    const plus = equation.locator("mo").filter({ hasText: "+" });
    await plus.click({ position: { x: 1, y: 5 } });
    expect(await selection()).toEqual([text.indexOf("+"), text.indexOf("+")]);
    await editor().press("/");
    await expect(
      page.getByLabel("Engineering region concepts", { exact: true }),
    ).toHaveCount(0);
    await editor().fill(text);
    await editor().press("Escape");
    // Repeated symbols must resolve to their own occurrence, not the first one.
    await term.click();
    await editor().fill("T = T_inf + Q/(h*A) + Q/(h*A)");
    await editor().press("Escape");
    const repeated = equation
      .getByRole("button", { name: "Edit Q", exact: true })
      .last();
    await repeated.click({ position: { x: 1, y: 8 } });
    expect((await selection())[0]).toBe(
      "T = T_inf + Q/(h*A) + Q/(h*A)".lastIndexOf("Q"),
    );
    await editor().fill(text);
    await editor().press("Escape");
    checks++;
    // Results still inspect; authoring beside a plot does not re-run Python.
    await page
      .getByRole("button", { name: "Inspect result T", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Plot response", exact: true })
      .click();
    const artifact = page.getByLabel("Python response artifact", {
      exact: true,
    });
    await expect(artifact).toHaveAttribute("data-status", "current");
    const execution = await artifact.getAttribute("data-execution-key");
    const plotPosition = await artifact.getAttribute("style");
    await term.click();
    await editor().press("Enter");
    await editor().press("Escape");
    await expect(artifact).toHaveAttribute("style", plotPosition);
    await term.click();
    const before = await editor().locator("..").boundingBox();
    await editor().press("Enter");
    const below = await editor().locator("..").boundingBox();
    expect(below.x).toBeCloseTo(before.x, 0);
    expect(below.y).toBeCloseTo(before.y + 92, 0);
    if (width === 1500)
      await page.screenshot({
        path: new URL(
          "../screenshots/equation-editing-continue.png",
          import.meta.url,
        ).pathname,
      });
    await editor().fill("Check the cooling assumption");
    await editor().press("Enter");
    await editor().press("Escape");
    await expect(
      page.getByRole("button", { name: "Write here", exact: true }),
    ).toHaveCount(0);
    await expect(artifact).toHaveAttribute("data-execution-key", execution);
    await expect(page.locator('[data-result-for="T"]')).toContainText(
      "91.6667",
    );
    checks++;
    // A click on a superscript places the caret at its original Unicode source.
    const h = page.locator('.er-region[data-kind="quantity"]').filter({
      has: page.getByRole("button", { name: "Edit h", exact: true }),
    });
    await h.getByRole("button", { name: "Edit value 2", exact: true }).click();
    const caret = (await selection())[0];
    expect([
      "h := 60 W/(m² K)".indexOf("²"),
      "h := 60 W/(m² K)".indexOf("²") + 1,
    ]).toContain(caret);
    await editor().press("Escape");
    checks++;
    // Independently placed equations continue from their own position, at zoom.
    await page.getByLabel("Zoom out", { exact: true }).click();
    await page.mouse.click(20, 950);
    await editor().fill("x := 3");
    await editor().press("Escape");
    const x = page.getByRole("button", { name: "Edit x", exact: true });
    await x.click();
    const at = await editor().locator("..").boundingBox();
    const scale = await page
      .locator(".er-paper")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    await editor().press("Enter");
    const next = await editor().locator("..").boundingBox();
    expect(next.x).toBeCloseTo(at.x, 0);
    expect(next.y).toBeCloseTo(at.y + 92 * scale, 0);
    await editor().press("Escape");
    checks++;
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(`${checks} equation editing checks passed.`);
} finally {
  await browser.close();
}
