import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { startWriting } from "./browser-workspace.mjs";

const browser = await chromium.launch({ ...browserOptions(), headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  let downloads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", () => downloads++);
  // Replace only the OS dialog. Successful and failed writes use a real browser file stream.
  await page.addInitScript(() => {
    window.saveRequests = [];
    window.saveMode = "cancel";
    window.chosenFile = async (create) => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle("Chosen project folder", {
        create,
      });
      return folder.getFileHandle("chosen-workspace.manifold", { create });
    };
    window.showSaveFilePicker = async (options) => {
      window.saveRequests.push({
        options,
        gesture: navigator.userActivation.isActive,
      });
      if (window.saveMode === "cancel")
        throw new DOMException("Cancelled", "AbortError");
      const file = await window.chosenFile(true);
      if (window.saveMode !== "fail") return file;
      return {
        name: file.name,
        async createWritable() {
          const writer = await file.createWritable();
          return {
            write: (blob) => writer.write(blob),
            close: async () => {
              throw Error("Injected write failure");
            },
            abort: () => writer.abort(),
          };
        },
      };
    };
  });
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const button = (name) => page.getByRole("button", { name, exact: true });
  const title = page.getByLabel("Document title", { exact: true });
  await title.fill("Spring sizing");
  await title.press("Enter");
  await startWriting(page);
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await editor.fill("span := 2 mm");
  await editor.press("ControlOrMeta+s");
  const requests = () => page.evaluate(() => window.saveRequests);
  await expect.poll(async () => (await requests()).length).toBe(1);
  await expect(editor).toHaveValue("span := 2 mm");
  expect(
    await page.evaluate(async () => {
      try {
        await window.chosenFile(false);
        return true;
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
        return false;
      }
    }),
  ).toBe(false);
  await page.evaluate(() => (window.saveMode = "save"));
  await editor.press("ControlOrMeta+s");
  await expect(
    page.getByText(/Workspace saved to chosen-workspace\.manifold/),
  ).toBeVisible();
  const read = () =>
    page.evaluate(async () =>
      (await (await window.chosenFile(false)).getFile()).text(),
    );
  const original = await read();
  let data = await decodeWorkspace(original);
  expect(data.page.title).toBe("Spring sizing");
  expect(data.page.regions.map(({ text }) => text)).toContain("span := 2 mm");
  expect(await requests()).toEqual(
    Array(2).fill({
      options: {
        suggestedName: "Spring sizing.manifold",
        types: [
          {
            description: "Manifold workspace",
            accept: { "application/json": [".manifold"] },
          },
        ],
        excludeAcceptAllOption: true,
      },
      gesture: true,
    }),
  );

  await title.fill("New canvas title");
  await title.press("Enter");
  await page.evaluate(() => (window.saveMode = "fail"));
  await button("Save file").click();
  await expect(
    page.getByText("Could not save workspace file: Injected write failure"),
  ).toBeVisible();
  expect(await read()).toBe(original);
  await expect(title).toHaveValue("New canvas title");

  await page.evaluate(() => (window.saveMode = "save"));
  await button("Search objects and commands").click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Save workspace file");
  await button("Save workspace file").click();
  await expect(
    page.getByText(/Workspace saved to chosen-workspace\.manifold/),
  ).toBeVisible();
  data = await decodeWorkspace(await read());
  expect(data.page.title).toBe("New canvas title");
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
  console.log(
    "Workspace Save As: gesture-bound picker, chosen destination, cancellation, write failure, and valid native archive pass.",
  );
} finally {
  await browser.close();
}
