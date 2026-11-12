import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";
import { chromium, expect } from "@playwright/test";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
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
    const marking = page.getByRole("menu", {
      name: "Canvas actions",
      exact: true,
    });
    const openPlotCommand = async (enabled = true) => {
      if (surface === "toolbar") {
        const command = toolbar.locator('[data-command-id="response.plot"]');
        if (enabled) {
          await command.focus();
          await expect(command).toBeFocused();
        }
        return command;
      }
      if (surface === "marking") {
        await disclosure.focus();
        await page.keyboard.press("Shift+Space");
        await expect(marking).toBeFocused();
        return marking.getByRole("menuitem", { name: "Explore", exact: true });
      }
      await page.keyboard.press("Control+k");
      await expect(search).toBeFocused();
      await search.fill("Plot response");
      return page.getByRole("button", { name: "Plot response", exact: true });
    };
    const plotCommand = await openPlotCommand();
    await expect(plotCommand).toHaveAttribute(
      "data-command-id",
      "response.plot",
    );
    if (surface === "marking")
      await expect(plotCommand).toHaveAttribute("aria-disabled", "false");
    else await expect(plotCommand).toBeEnabled();
    await plotCommand.click();
    if (surface === "marking") await expect(marking).toHaveCount(0);
    if (surface === "search") await expect(search).toHaveCount(0);
    await expect(
      page.getByLabel("Python response artifact", { exact: true }),
    ).toHaveAttribute("data-status", "current");
    const after = await saved();
    expect(after.artifacts).toHaveLength(1);
    await expect(
      page.getByLabel("Python response artifact", { exact: true }),
    ).toHaveAttribute("data-artifact-id", after.artifacts[0].id);
    expect(after.artifacts[0].output).toBe(named("P"));
    expect(after.artifacts[0].input).toBe(named("F"));
    expect(after.page.regions).toEqual(initial.regions);
    await expect(page.locator('[data-result-for="P"]')).toContainText("60 W");

    // These downstream operations are independent of how the first plot was opened.
    // Each route above still proves command identity and the exact source bindings.
    if (surface === "search") {
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
      await expect(page.locator('[data-result-for="P"]')).toContainText(
        "60.6 W",
      );
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
      await captureEvidence(page, {
        animations: "disabled",
        path: new URL(
          "../screenshots/shared-command-search.png",
          import.meta.url,
        ).pathname,
      });
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
    }

    // Each entry route must reject unresolved bindings without creating a view.
    const force = page.locator(`[data-region-id="${named("F")}"]`);
    await force.getByRole("button", { name: "Edit F", exact: true }).click();
    await editor.fill("F =");
    await editor.press("Escape");
    await selectEquation();
    const artifactCount = surface === "search" ? 2 : 1;
    const blocked = await openPlotCommand(false);
    await expect(blocked).toHaveAttribute("data-command-id", "response.plot");
    if (surface === "marking") {
      await expect(blocked).toHaveAttribute("aria-disabled", "true");
      await expect(blocked).toHaveAttribute("title", /Resolve the calculation/);
      await blocked.focus();
      await expect(blocked).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(marking.getByRole("status")).toContainText(
        "Resolve the calculation",
      );
      await expect(marking).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(disclosure).toBeFocused();
    } else {
      await expect(blocked).toBeDisabled();
      if (surface === "search") {
        await expect(blocked).toContainText("Resolve the calculation");
        // New sampling is blocked, but existing (possibly stale) response views
        // remain navigable. Enter activates the first enabled search result.
        const beforeOpen = (await saved()).artifacts;
        const existing = page
          .getByRole("button", { name: /^Open existing response plot / })
          .first();
        await expect(existing).toHaveAttribute(
          "data-command-id",
          "response.open",
        );
        await expect(existing).toBeEnabled();
        await search.press("Enter");
        await expect(search).toHaveCount(0);
        expect((await saved()).artifacts).toEqual(beforeOpen);
      } else {
        await expect(blocked).toHaveAttribute(
          "title",
          /Resolve the calculation/,
        );
      }
    }
    expect((await saved()).artifacts).toHaveLength(artifactCount);
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Command consistency: toolbar/marking/search produce the same bound plot; contextual equation, quantity, term, result and plot selection, explicit axes, existing views, Vary/Undo and unavailable bindings pass.",
  );
} finally {
  await browser.close();
}
