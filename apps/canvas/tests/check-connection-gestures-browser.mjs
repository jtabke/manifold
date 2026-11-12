import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { readWorkspace } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1870, height: 1080 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .getByRole("button", { name: "Write equation or note", exact: true })
    .click();
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  for (const text of ["P = force*speed", "force := 20 N", "speed := 3 m/s"]) {
    await editor.fill(text);
    await editor.press("Enter");
  }
  await editor.press("Escape");
  await page.getByLabel("Import CSV file").setInputFiles({
    name: "measurements.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("force [N],speed [m/s]\n20,3\n24,4"),
  });
  for (const name of ["Select column force [N]", "Select column speed [m/s]"])
    await page.getByRole("button", { name, exact: true }).click();
  const baseline = (await readWorkspace(page)).page;
  const link = page.getByRole("button", { name: "Link force", exact: true });
  const data = page.getByLabel("Drag selected columns to equation");
  const equation = page.locator('[data-kind="equation"] math');
  const center = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  };
  const pointer = (pointerId, at) => ({
    pointerId,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    bubbles: true,
    ...at,
  });
  const event = async (type, pointerId, at) =>
    page.evaluate(
      ({ type, init }) => window.dispatchEvent(new PointerEvent(type, init)),
      {
        type,
        init: pointer(pointerId, at),
      },
    );
  for (const [handle, preview, dialog, competitor] of [
    [data, ".er-data-drag", "Connect dataset to model", link],
    [link, ".er-link-drag", "Review connection", link],
  ]) {
    const from = await center(handle),
      to = await center(equation);
    await handle.dispatchEvent("pointerdown", pointer(41, from));
    await event("pointermove", 42, to);
    await expect(page.locator(preview)).toHaveCount(0);
    await event("pointermove", 41, to);
    await expect(page.locator(preview)).toBeVisible();
    const shown = await page.locator(`${preview} path`).getAttribute("d");
    await event("pointermove", 42, from);
    await expect(page.locator(`${preview} path`)).toHaveAttribute("d", shown);
    await event("pointercancel", 42, to);
    await event("pointerup", 42, to);
    await expect(page.locator(preview)).toBeVisible();
    // A second pointer must not replace this gesture or start the other kind.
    await competitor.dispatchEvent(
      "pointerdown",
      pointer(42, await center(competitor)),
    );
    await event("pointerup", 41, to);
    await expect(page.locator(preview)).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: dialog, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    assert.deepEqual((await readWorkspace(page)).page, baseline);

    // Owner cancellation and window blur are terminal and never publish work.
    for (const reason of ["pointercancel", "blur"]) {
      await handle.dispatchEvent(
        "pointerdown",
        pointer(41, await center(handle)),
      );
      await event("pointermove", 41, to);
      await expect(page.locator(preview)).toBeVisible();
      if (reason === "blur")
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      else await event(reason, 41, to);
      await event("pointerup", 41, to);
      await expect(page.locator(preview)).toHaveCount(0);
      await expect(
        page.getByRole("dialog", { name: dialog, exact: true }),
      ).toHaveCount(0);
      assert.deepEqual((await readWorkspace(page)).page, baseline);
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Connection gestures: pointer ownership, competing starts, cancellation, blur and unchanged authored work pass.",
  );
} finally {
  await browser.close();
}
