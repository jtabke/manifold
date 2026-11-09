import assert from "node:assert/strict";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { readWorkspace, revealRegionActions } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const kind of ["number", "artifact"]) {
    await test(`${kind} exploration owns input until completion or cancellation`, async () => {
      const context = await browser.newContext({
        viewport: { width: 1500, height: 1100 },
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(base);
        await page
          .getByRole("button", {
            name: "Write equation or note",
            exact: true,
          })
          .click();
        const editor = page.getByLabel("Write an engineering region", {
          exact: true,
        });
        for (const text of ["P = F*v", "F := 20 N", "v := 3 m/s"]) {
          await editor.fill(text);
          await editor.press("Enter");
        }
        await editor.press("Escape");
        const initial = (await readWorkspace(page)).page;
        const power = initial.regions.find(
          (region) => region.text === "P = F*v",
        );
        const speed = initial.regions.find(
          (region) => region.text === "v := 3 m/s",
        );
        await page
          .locator(`[data-region-id="${power.id}"]`)
          .click({ position: { x: 400, y: 25 } });
        await revealRegionActions(page);
        await page
          .getByRole("toolbar", { name: "Equation P actions", exact: true })
          .locator('[data-command-id="response.plot"]')
          .click();
        const artifact = page.getByLabel("Python response artifact", {
          exact: true,
        });
        await expect(artifact).toHaveAttribute("data-status", "current");
        const control =
          kind === "number"
            ? page
                .locator(`[data-region-id="${speed.id}"] .er-scrubbable`)
                .first()
            : artifact.getByRole("slider", {
                name: "Vary artifact input",
                exact: true,
              });
        const surface =
          kind === "number"
            ? page.locator(`[data-region-id="${speed.id}"] math`)
            : control;
        const result = page.locator('[data-result-for="P"]');
        const baseline = (await readWorkspace(page)).page;
        const unchanged = async () =>
          assert.deepEqual((await readWorkspace(page)).page, baseline);
        const restored = async () => {
          await expect(result).toContainText("60 W");
          await unchanged();
          await expect(editor).toHaveCount(0);
        };
        const ensureNumber = async () => {
          if (
            kind !== "number" ||
            (await page.getByLabel("Explore v", { exact: true }).count())
          )
            return;
          await page
            .locator(`[data-region-id="${speed.id}"]`)
            .click({ position: { x: 400, y: 25 } });
          await revealRegionActions(page);
          await page
            .getByRole("toolbar", { name: "Quantity v actions", exact: true })
            .locator('[data-command-id="quantity.vary"]')
            .click();
        };
        const acceptNumber = async () => {
          if (kind === "number")
            await page
              .getByLabel("Explore v", { exact: true })
              .getByRole("button", { name: "Accept value", exact: true })
              .click();
        };
        const start = async () => {
          await ensureNumber();
          await control.scrollIntoViewIfNeeded();
          await control.focus();
          const box = await (
            kind === "artifact" ? control.locator("circle").first() : control
          ).boundingBox();
          const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          await control.evaluate((node) => {
            node.addEventListener(
              "pointerdown",
              (event) => {
                node.dataset.testPointer = String(event.pointerId);
              },
              { once: true },
            );
          });
          await page.mouse.move(at.x, at.y);
          await page.mouse.down();
          const pointer = Number(
            await control.getAttribute("data-test-pointer"),
          );
          assert.ok(Number.isFinite(pointer));
          return { ...at, pointer };
        };
        const foreign = async (type, at) =>
          control.dispatchEvent(type, {
            pointerId: at.pointer + 100,
            pointerType: "pen",
            button: 0,
            buttons: 1,
            clientX: at.x + 100,
            clientY: at.y,
            bubbles: true,
          });
        const move = async (at) => {
          await page.mouse.move(at.x + 45, at.y, { steps: 5 });
          await expect(result).not.toContainText("60 W");
          await unchanged();
        };
        const undo = async () => {
          await page.getByLabel("Undo", { exact: true }).click();
          await restored();
          await expect(artifact).toHaveAttribute("data-status", "current");
        };

        const at = await start();
        await foreign("pointermove", at);
        await restored();
        await move(at);
        assert.equal(
          await surface.evaluate(
            (node, pointer) => node.hasPointerCapture(pointer),
            at.pointer,
          ),
          true,
        );
        const preview = await result.textContent();
        for (const type of [
          "pointermove",
          "pointerup",
          "pointercancel",
          "lostpointercapture",
          "pointerdown",
        ])
          await foreign(type, at);
        // A key-up without this control's matching key-down cannot accept a pointer preview.
        await control.dispatchEvent("keyup", {
          key: "ArrowRight",
          bubbles: true,
        });
        await expect(result).toHaveText(preview);
        await unchanged();
        await page.mouse.up();
        await acceptNumber();
        await expect
          .poll(async () => (await readWorkspace(page)).page)
          .not.toEqual(baseline);
        await expect(editor).toHaveCount(0);
        await undo();

        for (const reason of [
          "pointercancel",
          "capture-loss",
          "window-blur",
          "page-hidden",
          "element-blur",
          "Escape",
        ]) {
          const at = await start();
          await move(at);
          if (reason === "pointercancel")
            await surface.dispatchEvent("pointercancel", {
              pointerId: at.pointer,
              bubbles: true,
            });
          else if (reason === "capture-loss")
            await surface.evaluate(
              (node, pointer) => node.releasePointerCapture(pointer),
              at.pointer,
            );
          else if (reason === "window-blur")
            await page.evaluate(() => window.dispatchEvent(new Event("blur")));
          else if (reason === "page-hidden")
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
              delete document.hidden;
            });
          else if (reason === "element-blur")
            await surface.evaluate((node) => node.blur());
          else await page.keyboard.press("Escape");
          await page.mouse.up();
          await restored();
        }

        for (const reason of ["element-blur", "Escape"]) {
          await ensureNumber();
          await control.focus();
          await page.keyboard.down("ArrowRight");
          await expect(result).not.toContainText("60 W");
          await unchanged();
          if (reason === "element-blur")
            await surface.evaluate((node) => node.blur());
          else await page.keyboard.press("Escape");
          await surface.dispatchEvent("keyup", {
            key: "ArrowRight",
            bubbles: true,
          });
          await page.keyboard.up("ArrowRight");
          await restored();
        }
        await ensureNumber();
        await control.focus();
        await page.keyboard.down("ArrowRight");
        await control.dispatchEvent("keyup", {
          key: "ArrowLeft",
          bubbles: true,
        });
        await foreign("pointerdown", { pointer: 1, x: 100, y: 100 });
        await unchanged();
        await page.keyboard.up("ArrowRight");
        await acceptNumber();
        await expect
          .poll(async () => (await readWorkspace(page)).page)
          .not.toEqual(baseline);
        await undo();
        if (kind === "number") {
          await ensureNumber();
          await control.focus();
          await page.keyboard.down("ArrowRight");
          await expect(result).toContainText("60.6 W");
          await page.keyboard.press("Tab");
          await surface.dispatchEvent("keyup", {
            key: "ArrowRight",
            bubbles: true,
          });
          await page.keyboard.up("ArrowRight");
          await restored();
          assert.equal(
            await page.evaluate(
              () =>
                document.activeElement !== document.body &&
                document.activeElement?.isConnected,
            ),
            true,
          );

          // Independent key cycles must retain numeric identity even though focus stays on the row.
          await ensureNumber();
          await control.focus();
          await page.keyboard.press("ArrowRight");
          await expect(result).toContainText("60.6 W");
          await page.keyboard.press("ArrowRight");
          await expect(result).toContainText("61.2 W");
          await page.keyboard.press("Enter");
          await expect(editor).toHaveValue("v := 3 m/s");
          await editor.press("Escape");
          await restored();

          const limits = async (step) => {
            await ensureNumber();
            const controls = page.getByLabel("Explore v", { exact: true });
            await controls
              .getByLabel("Exploration minimum", { exact: true })
              .fill("-10");
            await controls
              .getByLabel("Exploration maximum", { exact: true })
              .fill("10");
            await controls
              .getByLabel("Exploration step", { exact: true })
              .fill(String(step));
          };
          await limits(1);
          const signed = await start();
          const leaf = await control.elementHandle();
          for (const [dx, watts] of [
            [5, 160],
            [-8, -100],
            [1, 80],
          ]) {
            await page.mouse.move(signed.x + dx, signed.y, { steps: 4 });
            await expect(result).toContainText(`${watts} W`);
            await expect(surface).toBeFocused();
            assert.equal(
              await surface.evaluate(
                (node, pointer) => node.hasPointerCapture(pointer),
                signed.pointer,
              ),
              true,
            );
            await unchanged();
          }
          assert.equal(
            await leaf.evaluate((node) => node.isConnected),
            false,
            "fixture must replace the original number leaf",
          );
          await page.mouse.up();
          await acceptNumber();
          await expect(result).toContainText("80 W");
          await undo();

          await limits(4);
          await control.focus();
          await page.keyboard.down("ArrowLeft");
          await expect(result).toContainText("-20 W");
          await expect(surface).toBeFocused();
          await page.keyboard.down("ArrowLeft");
          await expect(result).toContainText("-100 W");
          await page.keyboard.down("ArrowRight");
          await expect(result).toContainText("-20 W");
          await page.keyboard.up("ArrowLeft");
          await unchanged();
          await page.keyboard.up("ArrowRight");
          await acceptNumber();
          await undo();

          // An accepted scene edit invalidates held input even though the math row survives.
          const stale = await start();
          await move(stale);
          await artifact
            .getByRole("button", { name: "Remove artifact", exact: true })
            .evaluate((node) => node.click());
          await expect(result).toContainText("60 W");
          assert.equal(
            await surface.evaluate(
              (node, pointer) => node.hasPointerCapture(pointer),
              stale.pointer,
            ),
            false,
          );
          await page.mouse.up();
          await restored();
        }
        if (kind === "artifact") {
          const removedAt = await start();
          await move(removedAt);
          await artifact
            .getByRole("button", { name: "Remove artifact", exact: true })
            .evaluate((node) => node.click());
          await page.mouse.up();
          await expect(artifact).toHaveCount(0);
          await restored();
        }
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    });
  }
} finally {
  await browser.close();
}
