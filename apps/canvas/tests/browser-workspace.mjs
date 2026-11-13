import { decodeWorkspace } from "../src/regions/artifacts.ts";
import {
  canvasDatabaseName,
  canvasLocalStore,
} from "../src/regions/app/canvasLocalStore.ts";
import { memoryBackend } from "@manifold/foundation";
/** Inspect the real IndexedDB stores with one coherent transaction, then use the production decoder. */
async function snapshot(page, key) {
  const name = await canvasDatabaseName(key);
  return page.evaluate(async (name) => {
    const names = await indexedDB.databases();
    if (!names.some((d) => d.name === name)) return null;
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name, 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const tx = db.transaction(["head", "packages", "assets"], "readonly");
      const get = (r) =>
        new Promise((resolve, reject) => {
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      const [head, epoch, revision, packageKeys, packages, assetKeys, assets] =
        await Promise.all([
          get(tx.objectStore("head").get("current")),
          get(tx.objectStore("head").get("epoch")),
          get(tx.objectStore("head").get("revision")),
          get(tx.objectStore("packages").getAllKeys()),
          get(tx.objectStore("packages").getAll()),
          get(tx.objectStore("assets").getAllKeys()),
          get(tx.objectStore("assets").getAll()),
        ]);
      return head
        ? {
            head,
            epoch: epoch ?? 0,
            revision: revision ?? 0,
            packages: packageKeys.map((k, i) => [k, packages[i]]),
            assets: assetKeys.map((k, i) => [k, assets[i]]),
          }
        : null;
    } finally {
      db.close();
    }
  }, name);
}
const settled = (page) =>
  page.waitForFunction(() => {
    const status = document.querySelector(
      '[aria-label="Workspace save status"]',
    );
    return (
      status?.textContent === "Saved locally" ||
      !!document.querySelector(".er-storage-error")
    );
  });
export async function readWorkspace(
  page,
  key = "manifold.artifact-experiment.v1",
) {
  await settled(page);
  const captured = await snapshot(page, key);
  if (!captured) {
    const text = await page.evaluate((key) => localStorage.getItem(key), key);
    return text === null ? undefined : decodeWorkspace(text);
  }
  const packages = new Map(captured.packages),
    assets = new Map(captured.assets);
  const read = {
    state: {
      head: captured.head,
      epoch: captured.epoch,
      revision: captured.revision,
    },
    head: async () => captured.head,
    package: async (key) => packages.get(key),
    asset: async (key) => assets.get(key),
    records: function* () {
      for (const [key, value] of packages) yield ["packages", key, value];
      for (const [key, value] of assets) yield ["assets", key, value];
    },
  };
  return canvasLocalStore({
    ...memoryBackend(),
    snapshot: async () => read,
  }).load();
}
/** Includes the durable head and stored bytes; failed transactions must preserve both. */
export async function readWorkspaceBytes(
  page,
  key = "manifold.artifact-experiment.v1",
) {
  const captured = await snapshot(page, key);
  return captured
    ? JSON.stringify(captured)
    : page.evaluate((key) => localStorage.getItem(key), key);
}
/** Choose through the visible primary controls or the labelled secondary pickers. */
export async function chooseDrawingTool(page, name) {
  const toolbar = page.getByRole("toolbar", {
    name: "Drawing and diagram tools",
    exact: true,
  });
  const tool = toolbar.getByRole("button", { name, exact: true });
  if (!(await tool.isVisible())) {
    const shapes = [
      "Line",
      "Arrow",
      "Rectangle",
      "Ellipse",
      "Visual connector",
    ];
    await toolbar
      .getByRole("button", {
        name: shapes.includes(name) ? "Shapes" : "More drawing tools",
        exact: true,
      })
      .click();
  }
  await tool.click();
}

/** Insert through the command palette when a workflow needs an explicit new region. */
export async function startWriting(page) {
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Write");
  await page.locator('[data-command-id="canvas.write"]').click();
}
/** Open the selected region’s actions through the same explicit disclosure as the user. */
export async function revealRegionActions(page) {
  const actions = page.locator(".er-region.is-selected > .er-actions");
  await actions.waitFor({ state: "attached" });
  if ((await actions.getAttribute("open")) === null)
    await actions.locator("summary").click();
}
