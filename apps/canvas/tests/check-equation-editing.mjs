import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence, evidenceEnabled } from "./browser-evidence.mjs";
const baseURL = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
import { REGION_STEP } from "../src/regions/pageLayout.ts";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
let checks = 0;
try {
  for (const width of [1500, 838, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1100 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    const editor = () =>
      page.getByLabel("Write an engineering region", { exact: true });
    const selection = () =>
      editor().evaluate((e) => [e.selectionStart, e.selectionEnd]);
    await page.goto(`${baseURL}/?think=1&artifacts=1`);
    await page
      .getByLabel("Empty engineering page", { exact: true })
      .click({ position: { x: 100, y: 80 } });
    const writing = page.locator(".er-region.is-editing");
    await expect(editor()).toBeFocused();
    if (evidenceEnabled && width === 1500) {
      const box = await editor().boundingBox();
      await captureEvidence(page, {
        path: new URL("../screenshots/compact-writing.png", import.meta.url)
          .pathname,
        caret: "initial",
        clip: {
          x: Math.max(0, box.x - 45),
          y: Math.max(0, box.y - 30),
          width: 650,
          height: 170,
        },
      });
    }
    const compact = await writing.boundingBox();
    expect(compact.width).toBeLessThanOrEqual(260);
    expect(compact.height).toBeLessThanOrEqual(40);
    await expect(writing.locator(".er-grip")).toBeHidden();
    await expect(editor()).toHaveAccessibleDescription(
      /Enter Continue below.*Esc Finish/,
    );
    const appearance = await editor().evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        background: style.backgroundColor,
        border: style.borderBottomWidth,
        outline: style.outlineStyle,
        caret: style.caretColor,
        placeholder: node.getAttribute("placeholder"),
      };
    });
    expect(appearance).toEqual({
      background: "rgba(0, 0, 0, 0)",
      border: "0px",
      outline: "none",
      caret: "rgb(197, 162, 240)",
      placeholder: null,
    });
    await editor().fill(
      "A longer engineering note that should expand naturally while writing",
    );
    const grown = await editor().boundingBox();
    expect(grown.width).toBeGreaterThan(compact.width);
    const viewport = await page.locator(".er-canvas").boundingBox();
    expect(grown.x).toBeGreaterThanOrEqual(viewport.x - 1);
    expect(grown.x + grown.width).toBeLessThanOrEqual(
      viewport.x + viewport.width + 1,
    );
    await editor().fill("First line\nSecond line\nThird line");
    expect((await editor().boundingBox()).height).toBeGreaterThan(
      compact.height + 35,
    );
    const multiline = await editor().evaluate((node) => ({
      client: node.clientHeight,
      scroll: node.scrollHeight,
      caret: node.selectionStart,
    }));
    expect(multiline.scroll).toBeLessThanOrEqual(multiline.client + 2);
    expect(multiline.caret).toBe("First line\nSecond line\nThird line".length);
    await editor().fill("");
    if (width === 390) {
      await editor().fill("A compact note on a small screen");
      await editor().press("Escape");
      await expect(
        page.getByText("A compact note on a small screen", { exact: true }),
      ).toBeVisible();
      await context.close();
      checks++;
      continue;
    }
    for (const text of [
      "T = T_inf + Q/(h*A)",
      "T_inf := 25 °C",
      "Q := 800 W",
      "h := 60 W/(m² K)",
      "A := 0.2 m²",
      "T <= 100 °C",
    ]) {
      const line = await editor().locator("..").boundingBox();
      await editor().fill(text);
      await editor().press("Enter");
      const nextLine = await editor().locator("..").boundingBox();
      expect(nextLine.y - line.y).toBeLessThan(92);
    }
    await editor().press("Escape");
    const equation = page.locator('.er-region[data-kind="equation"]').first();
    const text = "T = T_inf + Q/(h*A)";
    await equation.getByRole("button", { name: "Edit T", exact: true }).click();
    await editor().fill("T = missing + 1 K");
    await editor().press("Escape");
    const issue = equation.locator(".er-region-error");
    await expect(issue.locator("summary")).toHaveAttribute(
      "aria-label",
      /missing/,
    );
    await expect(issue.locator(".er-region-error-details")).toBeHidden();
    const issueHeight = (await equation.boundingBox()).height;
    await issue.locator("summary").click();
    await expect(issue.locator(".er-region-error-details")).toBeVisible();
    expect((await equation.boundingBox()).height).toBe(issueHeight);
    await issue.locator("summary").press("Escape");
    await expect(issue.locator(".er-region-error-details")).toBeHidden();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator('[data-result-for="T"]')).toContainText(
      "91.6667",
    );
    const moveHandle = equation.getByRole("button", {
      name: "Move T",
      exact: true,
    });
    await page.mouse.move(0, 0);
    expect(
      await moveHandle.evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("0");
    await equation.hover({ position: { x: 400, y: 10 } });
    expect(
      await moveHandle.evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("1");
    await page.mouse.move(0, 0);
    await moveHandle.focus();
    expect(
      await moveHandle.evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("1");
    const term = equation.getByRole("button", { name: "Edit Q", exact: true });
    const label = equation.getByRole("button", { name: "Edit T", exact: true });
    const start = await label.boundingBox(),
      end = await term.boundingBox();
    const beforeSelection = await readWorkspace(page);
    await page.mouse.move(start.x + 1, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, {
      steps: 12,
    });
    expect(
      await equation.locator('[data-source-selected="true"]').count(),
    ).toBeGreaterThan(0);
    for (const type of ["pointerup", "pointercancel"])
      await equation
        .locator("math")
        .evaluate(
          (node, type) =>
            node.dispatchEvent(
              new PointerEvent(type, { pointerId: 999, bubbles: true }),
            ),
          type,
        );
    await expect(editor()).toHaveCount(0);
    await page.mouse.up();
    await expect(editor()).toHaveValue(text);
    const selectedText = await editor().evaluate((node) =>
      node.value.slice(node.selectionStart, node.selectionEnd),
    );
    expect(selectedText).toContain("T = T_inf + Q");
    expect((await readWorkspace(page)).document.id).toBe(
      beforeSelection.document.id,
    );
    await page.mouse.click(12, 1030);
    await expect(editor()).toHaveCount(0);
    expect((await readWorkspace(page)).page.regions).toEqual(
      beforeSelection.page.regions,
    );
    await page.mouse.move(start.x + 1, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, {
      steps: 6,
    });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(editor()).toHaveCount(0);
    expect((await readWorkspace(page)).document.id).toBe(
      beforeSelection.document.id,
    );
    const quantity = page.locator('.er-region[data-kind="quantity"]').filter({
      has: page.getByRole("button", { name: "Edit Q", exact: true }),
    });
    const qStart = await quantity
      .getByRole("button", { name: "Edit Q", exact: true })
      .boundingBox();
    const qEnd = await quantity
      .getByRole("button", { name: "Edit value 800", exact: true })
      .boundingBox();
    await page.mouse.move(qStart.x + 1, qStart.y + qStart.height / 2);
    await page.mouse.down();
    await page.mouse.move(qEnd.x + qEnd.width - 1, qEnd.y + qEnd.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(editor()).toHaveValue("Q := 800 W");
    await expect(
      page.getByRole("dialog", { name: "Link actions", exact: true }),
    ).toHaveCount(0);
    await editor().press("Escape");
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
    await revealRegionActions(page);
    await page
      .locator('.er-object-actions [data-command-id="response.plot"]')
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
    expect(below.y).toBeGreaterThanOrEqual(before.y + REGION_STEP - 1);
    await expect(artifact).toHaveAttribute("style", plotPosition);
    if (width === 1500)
      await captureEvidence(page, {
        path: new URL(
          "../screenshots/equation-editing-continue.png",
          import.meta.url,
        ).pathname,
      });
    const beforeContinuation = await readWorkspace(page);
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
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await readWorkspace(page)).page).toEqual(beforeContinuation.page);
    expect(
      (await readWorkspace(page)).artifacts.map(({ receipt: _, ...a }) => a),
    ).toEqual(beforeContinuation.artifacts.map(({ receipt: _, ...a }) => a));
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
    expect(next.y).toBeGreaterThanOrEqual(at.y + REGION_STEP * scale - 1);
    await expect(artifact).toHaveAttribute("style", plotPosition);
    await editor().press("Escape");
    checks++;
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(`${checks} equation editing checks passed.`);
} finally {
  await browser.close();
}
