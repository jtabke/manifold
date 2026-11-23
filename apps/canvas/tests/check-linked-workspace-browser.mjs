import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const cli = fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "manifold-file-link-"));
const run = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      cwd: dir,
      encoding: "utf8",
    }),
  );
let browser;
try {
  const empty = run("create", "--output", "empty.manifold");
  const edit = async (file, output, expectedDocumentId, operation) => {
    await writeFile(
      join(dir, "edits.json"),
      JSON.stringify({
        expectedDocumentId,
        edits: [operation],
      }),
    );
    return run("edit", file, "--changes", "edits.json", "--output", output);
  };
  const created = await edit(
    "empty.manifold",
    "baseline.manifold",
    empty.documentId,
    {
      operation: "createEquation",
      text: "span := 2 mm",
    },
  );
  const row = run("worksheet", "baseline.manifold", "--compact").regions[0].id;
  const update = (file, output, before, text) =>
    edit(file, output, before.documentId, {
      operation: "updateEquation",
      region: row,
      text,
    });
  const first = await update(
    "baseline.manifold",
    "first.manifold",
    created,
    "span := 40 mm",
  );
  const second = await update(
    "first.manifold",
    "second.manifold",
    first,
    "span := 600 mm",
  );
  await update("second.manifold", "third.manifold", second, "span := 8000 mm");
  run("create", "--output", "unrelated.manifold");

  browser = await chromium.launch({ ...browserOptions(), headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Supply a real IndexedDB-cloneable browser file handle instead of using an OS dialog.
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => [
      await (
        await navigator.storage.getDirectory()
      ).getFileHandle("Study.manifold"),
    ];
  });
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const write = (text) =>
    page.evaluate(async (bytes) => {
      const file = await (
        await navigator.storage.getDirectory()
      ).getFileHandle("Study.manifold", { create: true });
      const writer = await file.createWritable();
      await writer.write(bytes);
      await writer.close();
    }, text);
  const replace = async (name) =>
    write(await readFile(join(dir, name), "utf8"));
  await replace("baseline.manifold");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await page.waitForURL(/\?canvas=/);
  const equation = page.locator(`[data-region-id="${row}"]`);
  await expect(equation).toContainText("2");
  const title = page.getByRole("textbox", { name: "Document title" });
  await expect(title).toHaveValue("Study");
  const location = page.url();
  await page.evaluate(() => {
    window.liveFileMarker = true;
  });
  await replace("first.manifold");
  await expect(equation).toContainText("40");
  assert.equal(
    await page.evaluate(() => window.liveFileMarker),
    true,
    "file updates must not reload the page",
  );
  assert.equal(page.url(), location);
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );

  // Reopening the tab restores the file link. A broken or unrelated write leaves it intact.
  await page.reload();
  await expect(equation).toContainText("40");
  await write("not a workspace");
  await expect(
    page.getByRole("status").filter({ hasText: "could not be opened" }),
  ).toBeVisible();
  await expect(equation).toContainText("40");
  await page.getByRole("button", { name: "Dismiss message" }).click();
  await replace("unrelated.manifold");
  await expect(
    page.getByRole("status").filter({ hasText: "different workspace" }),
  ).toBeVisible();
  await expect(equation).toContainText("40");
  await page.getByRole("button", { name: "Dismiss message" }).click();

  // While a user is typing, don't adopt the incoming revision or commit the draft.
  await title.fill("Uncommitted title");
  await replace("second.manifold");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Waiting for the current canvas activity" }),
  ).toBeVisible();
  await expect(title).toHaveValue("Uncommitted title");
  await expect(equation).toContainText("40");
  await title.press("Escape");
  await expect(equation).toContainText("600");

  await title.fill("My saved changes");
  await title.press("Enter");
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
  await replace("third.manifold");
  await expect(
    page.getByRole("status").filter({ hasText: "canvas has local changes" }),
  ).toBeVisible();
  await expect(title).toHaveValue("My saved changes");
  await expect(equation).toContainText("600");
  assert.deepEqual(errors, []);
  console.log(
    "linked workspaces follow CLI revisions without reopening or overwriting local work",
  );
} finally {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
}
