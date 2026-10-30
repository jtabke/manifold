import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  for (const surface of ["toolbar", "marking", "search"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    const search = page.getByRole("textbox", {
      name: "Search commands",
      exact: true,
    });
    const saved = () => readWorkspace(page);
    await page.goto(base);
    await page
      .getByRole("button", { name: "Write equation or note", exact: true })
      .click();
    for (const text of ["P = F*v", "F = 20 N", "v = 3 m/s"]) {
      await editor.fill(text);
      await editor.press("Enter");
    }
    await editor.press("Escape");
    const power = page.locator('.er-region[data-kind="equation"]').first();
    const selectEquation = async () => {
      await power.click({ position: { x: 400, y: 25 } });
      await revealRegionActions(page);
    };
    await power.click({ position: { x: 400, y: 25 } });
    await expect(
      page.getByRole("toolbar", { name: "Equation P actions", exact: true }),
    ).toBeHidden();
    const beforeActions = (await saved()).document.id;
    const disclosure = page.locator(
      ".er-region.is-selected > .er-actions > summary",
    );
    await disclosure.focus();
    await disclosure.press("Enter");
    expect((await saved()).document.id).toBe(beforeActions);
    const toolbar = page.getByRole("toolbar", {
      name: "Equation P actions",
      exact: true,
    });
    await expect(toolbar.getByRole("button")).toHaveText([
      "Edit",
      "Plot",
      "Connect",
      "",
    ]);
    const initial = (await saved()).page;
    const named = (name) =>
      initial.regions.find((r) => r.text.startsWith(`${name} =`)).id;
    let plotCommand;
    if (surface === "toolbar")
      plotCommand = toolbar.locator('[data-command-id="response.plot"]');
    if (surface === "marking") {
      await page.keyboard.press("Shift+Space");
      plotCommand = page.getByRole("menuitem", {
        name: "Explore",
        exact: true,
      });
    }
    if (surface === "search") {
      await page.keyboard.press("Control+k");
      await search.fill("Plot response");
      plotCommand = page.getByRole("button", {
        name: "Plot response",
        exact: true,
      });
    }
    await expect(plotCommand).toHaveAttribute(
      "data-command-id",
      "response.plot",
    );
    await plotCommand.click();
    await expect(
      page.getByLabel("Python response artifact", { exact: true }),
    ).toHaveAttribute("data-status", "current");
    const after = await saved();
    expect(after.artifacts).toHaveLength(1);
    expect(after.artifacts[0].output).toBe(named("P"));
    expect(after.artifacts[0].input).toBe(named("F"));
    expect(after.page.regions).toEqual(initial.regions);
    await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");

    // Selecting a result and a term identifies each explicitly before acting.
    await page
      .getByRole("button", { name: "Inspect result P", exact: true })
      .click();
    await revealRegionActions(page);
    const resultToolbar = page.getByRole("toolbar", {
      name: "Result P actions",
      exact: true,
    });
    await expect(resultToolbar.getByRole("button")).toHaveText([
      "Inspect source",
      "Explore",
      "Compare",
      "",
    ]);
    await power
      .getByRole("button", { name: "Edit v", exact: true })
      .click({ modifiers: ["Alt"] });
    await revealRegionActions(page);
    const termToolbar = page.getByRole("toolbar", {
      name: "Term v in P actions",
      exact: true,
    });
    await expect(termToolbar).toBeVisible();
    await expect(
      termToolbar.locator('[data-command-id="definition.edit"]'),
    ).toContainText("Edit definition");
    await termToolbar.locator('[data-command-id="quantity.vary"]').click();
    const value = page
      .locator(`[data-region-id="${named("v")}"] .er-scrubbable`)
      .first();
    await expect(value).toBeFocused();
    await value.press("ArrowRight");
    await expect(page.locator('[data-result-for="P"]')).toContainText("60.6 W");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");

    // Explicit plot choices and existing views use supported identity bindings.
    await selectEquation();
    await page.keyboard.press("Control+k");
    await search.fill("plot");
    await expect(
      page.getByLabel("Command context", { exact: true }),
    ).toContainText("Equation P · Canvas · Original");
    await expect(
      page.getByRole("button", { name: "Plot against F", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Plot against v", exact: true }),
    ).toBeVisible();
    const existing = page.getByRole("button", {
      name: "Open existing response plot (P / F)",
      exact: true,
    });
    await expect(existing).toBeVisible();
    if (surface === "search") {
      await mkdir(new URL("../screenshots/", import.meta.url), {
        recursive: true,
      });
      await page.screenshot({
        animations: "disabled",
        path: new URL(
          "../screenshots/shared-command-search.png",
          import.meta.url,
        ).pathname,
      });
    }
    await existing.click();
    expect((await saved()).artifacts).toHaveLength(1);

    await selectEquation();
    await page.keyboard.press("Control+k");
    await search.fill("plot");
    await page
      .getByRole("button", { name: "Plot against v", exact: true })
      .click();
    await expect.poll(async () => (await saved()).artifacts.length).toBe(2);
    expect((await saved()).artifacts[1].input).toBe(named("v"));
    expect((await saved()).artifacts[1].output).toBe(named("P"));

    // Plot selections expose source operations; term gestures retain their intent.
    await page
      .locator("[data-view-id]")
      .first()
      .click({ button: "right", position: { x: 350, y: 40 } });
    await expect(
      page.getByRole("menu", { name: "Context actions", exact: true }),
    ).toHaveAttribute("aria-description", "Plot P against F");
    await page.keyboard.press("Escape");
    const force = page.locator(`[data-region-id="${named("F")}"]`);
    await force.click({ position: { x: 400, y: 25 } });
    await revealRegionActions(page);
    const quantityToolbar = page.getByRole("toolbar", {
      name: "Quantity F actions",
      exact: true,
    });
    await expect(quantityToolbar.getByRole("button")).toHaveText([
      "Edit value",
      "Vary",
      "Find uses",
      "",
    ]);
    await page.keyboard.press("Shift+Space");
    await expect(
      page.getByRole("menuitem", { name: "Explore", exact: true }),
    ).toHaveAttribute("data-command-id", "quantity.vary");
    await expect(
      page.getByRole("menuitem", { name: "Connect", exact: true }),
    ).toHaveAttribute("data-command-id", "quantity.connect");
    await expect(
      page.getByRole("menuitem", { name: "Inspect", exact: true }),
    ).toHaveAttribute("data-command-id", "quantity.trace");
    await page.keyboard.press("Escape");

    // A missing evaluation binding disables every creation route with an explanation.
    await force.getByRole("button", { name: "Edit F", exact: true }).click();
    await editor.fill("F =");
    await editor.press("Escape");
    await selectEquation();
    await expect(
      toolbar.locator('[data-command-id="response.plot"]'),
    ).toBeDisabled();
    await page.keyboard.press("Control+k");
    await search.fill("plot");
    const blocked = page.getByRole("button", {
      name: "Plot response",
      exact: true,
    });
    await expect(blocked).toBeDisabled();
    await expect(blocked).toContainText("Resolve the calculation");
    expect((await saved()).artifacts).toHaveLength(2);
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Command consistency: toolbar/marking/search produce the same bound plot; contextual equation, quantity, term, result and plot selection, explicit axes, existing views, Vary/Undo and unavailable bindings pass.",
  );
} finally {
  await browser.close();
}
