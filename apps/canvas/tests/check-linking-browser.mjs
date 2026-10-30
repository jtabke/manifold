import { readWorkspace } from "./browser-workspace.mjs";
const baseURL = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.setDefaultTimeout(8000);
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const editor = () =>
  page.getByLabel("Write an engineering region", { exact: true });
const widget = () =>
  page.getByLabel("Python response artifact", { exact: true });
const review = () =>
  page.getByRole("dialog", { name: "Review connection", exact: true });
const result = () => page.locator('[data-result-for="T"]');
async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function drag(from, to, release = true) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 15 });
  if (release) await page.mouse.up();
}
async function add(text, at = [115, 850]) {
  await page.mouse.click(...at);
  await editor().fill(text);
  await editor().press("Escape");
}
async function ready() {
  await expect(widget()).toHaveAttribute("data-status", "current");
}
async function close() {
  await page.keyboard.press("Escape");
}
try {
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
  const source = page.getByRole("button", { name: "Link A", exact: true });
  await drag(await center(source), [730, 165]);
  await expect(
    page.getByRole("dialog", { name: "Link actions", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Plot T vs A", exact: true }).click();
  await ready();
  await expect(result()).toContainText("91.6667");
  checks.push(
    "Drag the explicit link handle into open space to plot the existing quantity without taking over text selection",
  );
  await page.mouse.click(115, 760);
  await editor().fill("R = @cooling area");
  await expect(
    page.getByRole("listbox", { name: "Reference an object" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listbox", { name: "Reference an object", exact: true })
      .getByRole("option"),
  ).toHaveCount(1);
  await editor().press("Enter");
  await expect(editor()).toHaveValue("R = A");
  await editor().press("Enter");
  await editor().press("Escape");
  await expect(page.locator('[data-result-for="R"]')).toContainText("0.2 m²");
  checks.push(
    "@ autocomplete inserts an identity-bound reference; Enter continues below after selection",
  );
  // Move a stricter, initially unresolved requirement directly onto the plot.
  await add("T_other <= 90 °C", [115, 885]);
  await drag(
    await center(
      page.getByRole("button", {
        name: "Link requirement T_other",
        exact: true,
      }),
    ),
    [1020, 370],
  );
  await expect(review()).toContainText("Apply this requirement to T");
  await page
    .getByRole("button", { name: "Apply connection", exact: true })
    .click();
  await ready();
  await expect(
    widget().getByRole("button", {
      name: "Inspect plotted requirement",
      exact: true,
    }),
  ).toContainText("90");
  await page.getByLabel("Undo", { exact: true }).click();
  await ready();
  await expect(
    widget().getByRole("button", {
      name: "Inspect plotted requirement",
      exact: true,
    }),
  ).toContainText("100");
  checks.push(
    "Constraint-to-plot review applies its boundary; one Undo restores both the requirement and plot binding",
  );
  // Reapply for persistence below.
  await drag(
    await center(
      page.getByRole("button", {
        name: "Link requirement T_other",
        exact: true,
      }),
    ),
    [1020, 370],
  );
  await page
    .getByRole("button", { name: "Apply connection", exact: true })
    .click();
  await ready();
  // Construct a small model output below the existing worksheet.
  await add("P_in := 1000 W", [115, 980]);
  // Enter creates flow below; scroll-aware positions come from the rendered source.
  await page.getByRole("button", { name: "Edit P_in", exact: true }).click();
  await editor().press("Enter");
  await editor().fill("eta := .8");
  await editor().press("Enter");
  await editor().fill("Q_loss = P_in*(1-eta)");
  await editor().press("Escape");
  const loss = page.getByRole("button", { name: "Link Q_loss", exact: true });
  // Bring both ends into view by using canvas zoom.
  for (let i = 0; i < 3; i++)
    await page.getByLabel("Zoom out", { exact: true }).click();
  await page
    .locator(".er-canvas")
    .evaluate((el) =>
      el.scrollTo(
        0 + Number(el.dataset.canvasOriginX || 0),
        0 + Number(el.dataset.canvasOriginY || 0),
      ),
    );
  const heat = page.getByRole("button", { name: "Link Q", exact: true });
  await drag(await center(loss), await center(heat));
  await expect(review()).toContainText("Q := Q_loss");
  await expect(review()).toContainText("800 W");
  await page
    .getByRole("button", { name: "Apply connection", exact: true })
    .click();
  await ready();
  await expect(result()).toContainText("41.6667");
  await page.getByLabel("Undo", { exact: true }).click();
  await ready();
  await expect(result()).toContainText("91.6667");
  checks.push(
    "A model output replaces an assumption after review and updates dependent Python results; Undo restores the original",
  );
  await drag(
    await center(page.getByRole("button", { name: "Link A", exact: true })),
    await center(heat),
  );
  await expect(review()).toContainText("incompatible units");
  await expect(
    review().getByRole("button", { name: "Apply connection", exact: true }),
  ).toHaveCount(0);
  await close();
  await expect(result()).toContainText("91.6667");
  checks.push(
    "An incompatible area-to-heat link is explained without mutating the model",
  );
  await drag(await center(loss), await center(heat));
  await page
    .getByRole("button", { name: "Apply connection", exact: true })
    .click();
  await ready();
  await loss.click();
  const connections = page.getByRole("dialog", {
    name: "Connections",
    exact: true,
  });
  await expect(connections).toContainText("P_in");
  await expect(connections).toContainText("eta");
  await expect(connections).toContainText("Q := Q_loss");
  await expect(page.locator(".er-region.is-connected")).toHaveCount(4);
  checks.push(
    "The same link handle reveals producers and consumers with coordinated highlighting",
  );
  await close();
  expect((await readWorkspace(page)).page.links).toBeTruthy();
  await page.reload();
  await ready();
  await expect(result()).toContainText("41.6667");
  await page
    .getByRole("button", { name: "Link A", exact: true })
    .locator("..")
    .getByRole("button", { name: "Edit A", exact: true })
    .click();
  await editor().fill("A_cool := 0.2 m²");
  await editor().press("Escape");
  await expect(widget()).toHaveAttribute("data-status", "ready");
  await widget()
    .getByRole("button", { name: "Run Python", exact: true })
    .click();
  await ready();
  await expect(page.locator('[data-result-for="R"]')).toContainText("0.2 m²");
  await expect(
    page.getByRole("button", { name: "Edit A_cool", exact: true }),
  ).toHaveCount(3);
  checks.push(
    "Bindings and the chosen requirement survive reload and a source rename",
  );
  // Cancel a connection without producing an editor, an empty region, or a dangling line.
  const count = await page.locator(".er-region").count();
  await drag(
    await center(
      page.getByRole("button", { name: "Link A_cool", exact: true }),
    ),
    [560, 600],
    false,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".er-link-drag")).toHaveCount(0);
  await expect(editor()).toHaveCount(0);
  await expect(page.locator(".er-region")).toHaveCount(count);
  checks.push(
    "Escape cancels linking without leaving empty writing regions or accidental edits",
  );
  await widget().hover();
  await widget()
    .getByRole("button", { name: "Artifact actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Trace connections", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Connections", exact: true }),
  ).toContainText("Input");
  await close();
  checks.push(
    "A plot traces the same connected definitions through its contextual actions",
  );
  await page.getByRole("button", { name: "Link Q", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Connections", exact: true }),
  ).toContainText("Q_loss");
  await mkdir("/tmp/manifold-linking", { recursive: true });
  await page.screenshot({
    path: "/tmp/manifold-linking/connected-workspace.png",
    clip: { x: 0, y: 0, width: 1500, height: 840 },
  });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (e) {
  console.error({ pageErrors: errors });
  await mkdir("/tmp/manifold-linking", { recursive: true });
  await page.screenshot({ path: "/tmp/manifold-linking/failure.png" });
  console.error(await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
}
