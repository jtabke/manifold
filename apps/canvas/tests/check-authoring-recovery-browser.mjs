import { chromium, expect } from "@playwright/test";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  for (const width of [1440, 838]) {
    const context = await browser.newContext({
      viewport: { width, height: 960 },
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    const write = page.getByRole("button", {
      name: "Write equation or note",
      exact: true,
    });
    await page.goto(base);
    await write.click();
    await editor.fill("F = 20 N");
    await editor.press("Escape");

    // A search with no results must not trap continuation or invent a binding.
    for (const key of ["Enter", "Tab"]) {
      await write.click();
      await editor.fill(`unfinished_${key} = @missing`);
      await expect(page.getByRole("status")).toContainText(
        "No matching resolved quantities",
      );
      await editor.press(key);
      await expect(editor).toHaveValue("");
      await editor.press("Escape");
      await expect(
        page.getByRole("button", {
          name: `Edit thought: unfinished_${key} = @missing`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.locator(`[data-result-for="unfinished_${key}"]`),
      ).toHaveCount(0);
    }

    // Shift+Enter is a newline even when autocomplete has a valid candidate.
    await write.click();
    await editor.fill("Consider @F");
    await expect(page.getByRole("option")).toHaveCount(1);
    await editor.press("Shift+Enter");
    await expect(editor).toHaveValue("Consider @F\n");
    await editor.press("Escape");

    // Ordinary selection still inserts the reference, then continues below.
    await write.click();
    await editor.fill("R = @F");
    await editor.press("Enter");
    await expect(editor).toHaveValue("R = F");
    await editor.press("Enter");
    await expect(editor).toHaveValue("");
    await editor.press("Escape");
    await expect(page.locator('[data-result-for="R"]')).toContainText("20 N");

    // Input-method confirmation keys must not commit the canvas region.
    await write.click();
    await editor.fill("A note in progress");
    for (const event of [
      { key: "Enter", isComposing: true },
      { key: "Escape", isComposing: true },
      { key: "Enter", keyCode: 229 },
    ]) {
      await editor.dispatchEvent("keydown", event);
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue("A note in progress");
    }
    await editor.press("Escape");
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Edit thought: unfinished_Enter = @missing",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('[data-result-for="R"]')).toContainText("20 N");
    await context.close();
  }
  expect(errors).toEqual([]);
  console.log(
    "Authoring recovery: unmatched references, multiline notes, bound references, composition keys and retained drafts pass at two viewport sizes.",
  );
} finally {
  await browser.close();
}
