import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive } from "../src/regions/artifacts.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
import { readScene } from "../src/regions/sceneRecords.ts";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const { session, input, output, artifact, dataset } = await sceneFixture(1);
const gain = session.state.regions.find((r) => r.source).id;
session.arrange({
  [input]: { x: 90, y: 140 },
  [output]: { x: 320, y: 280 },
  [gain]: { x: 90, y: 520 },
  [dataset]: { x: 90, y: 800 },
});
session.setScene((s) => ({
  ...s,
  tools: s.tools.map((t) => ({ ...t, at: { x: 320, y: 280 } })),
}));
session.setArtifacts((items) =>
  items.map((a) => ({
    ...a,
    at: { x: 320, y: 280 },
    views: [
      {
        id: "overlap-table",
        renderer: "table",
        at: { x: 320, y: 280 },
        width: 500,
        height: 320,
      },
    ],
  })),
);
const source = archive(session.native());
session.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    hasTouch: true,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    (text) => localStorage.setItem("manifold.artifact-experiment.v1", text),
    source,
  );
  await page.goto(base);
  const before = await readWorkspace(page),
    bytes = await readWorkspaceBytes(page);
  const region = page.locator(`[data-region-id="${output}"]`),
    box = await region.boundingBox();
  const point = { x: box.x + 70, y: box.y + 45 };
  const menu = () =>
    page.getByRole("menu", { name: "Context actions", exact: true });
  const chooser = () =>
    page.getByRole("menu", { name: "Overlapping objects", exact: true });
  const picked = () =>
    page
      .locator("[data-overlap-picked]")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            node.dataset.regionId ||
            node.dataset.toolId ||
            node.dataset.viewId ||
            node.dataset.plotId ||
            node.dataset.modelId,
        ),
      );
  await expect(chooser()).toHaveCount(0);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await menu()
    .getByRole("menuitem", { name: "Choose overlapping item…", exact: true })
    .click();
  await expect(chooser().getByRole("menuitem")).toHaveCount(4);
  await chooser().locator(`[data-command-id="overlap.pick:${output}"]`).click();
  await expect.poll(picked).toEqual([output]);
  const grip = region.getByRole("button", { name: "Move F", exact: true });
  await expect(grip).toBeFocused();
  const visibleAtPoint = () =>
    page.evaluate(({ x, y }) => {
      const node = document
        .elementFromPoint(x, y)
        ?.closest("[data-region-id],[data-tool-id],[data-view-id]");
      return (
        node?.getAttribute("data-region-id") ||
        node?.getAttribute("data-tool-id") ||
        node?.getAttribute("data-view-id")
      );
    }, point);
  assert.equal(
    await visibleAtPoint(),
    output,
    "covered equation is temporarily accessible",
  );
  const visited = new Set([output]);
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Shift+F10");
    await expect(
      menu().getByRole("menuitem", { name: "Select underneath", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("1");
    await expect.poll(async () => (await picked()).length).toBe(1);
    const [id] = await picked();
    visited.add(id);
  }
  assert.equal(
    visited.size,
    4,
    "cycling traverses every representation, not just two alternately raised items",
  );
  // Navigating is not a different selection: keep covered work exposed while panning.
  await page.keyboard.down("Space");
  await page.mouse.move(1100, 900);
  await page.mouse.down();
  await page.mouse.move(1140, 930, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(picked).toEqual([output]);
  await page.keyboard.down("Space");
  await page.mouse.move(1140, 930);
  await page.mouse.down();
  await page.mouse.move(1100, 900, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(picked).toEqual([output]);
  assert.equal(
    await readWorkspaceBytes(page),
    bytes,
    "selection/navigation must not write geometry, layers or history",
  );
  await page.keyboard.press("Escape");
  await expect.poll(picked).toEqual([]);
  assert.notEqual(
    await visibleAtPoint(),
    output,
    "Escape restores normal paint order",
  );
  await grip.focus();
  await page.keyboard.press("Shift+F10");
  await menu()
    .getByRole("menuitem", { name: "Choose overlapping item…", exact: true })
    .click();
  await expect(chooser()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser()).toHaveCount(0);
  await expect(grip).toBeFocused();
  // Header actions provide the same chooser after a touch, without right-click.
  await page.touchscreen.tap(point.x, box.y + 45);
  await page
    .getByRole("button", { name: "Open canvas actions", exact: true })
    .click();
  await menu()
    .getByRole("menuitem", { name: "Choose overlapping item…", exact: true })
    .click();
  await expect(chooser().getByRole("menuitem")).toHaveCount(4);
  await chooser()
    .locator('[data-command-id="overlap.pick:overlap-table"]')
    .click();
  await expect.poll(picked).toEqual(["overlap-table"]);
  assert.equal(await readWorkspaceBytes(page), bytes);
  await page.keyboard.press("Escape");
  const lone = await page.locator(`[data-region-id="${input}"]`).boundingBox();
  await page.mouse.click(lone.x + 35, lone.y + 20, { button: "right" });
  await expect(
    menu().getByRole("menuitem", { name: "Select underneath", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Merely hovering a different object must not retarget header actions.
  await page.mouse.move(point.x, point.y);
  await page
    .getByRole("button", { name: "Open canvas actions", exact: true })
    .click();
  await expect(
    menu().getByRole("menuitem", { name: "Select underneath", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Choosing hidden work must make its existing move handle usable, not create a new edit path.
  await page.mouse.click(point.x, point.y, { button: "right" });
  await menu()
    .getByRole("menuitem", { name: "Choose overlapping item…", exact: true })
    .click();
  await chooser().locator(`[data-command-id="overlap.pick:${output}"]`).click();
  await captureEvidence(page, { path: "screenshots/overlap-selection.png" });
  const handle = await grip.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 600,
    handle.y + handle.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await readWorkspace(page)).page.layout[output].x)
    .toBeGreaterThan(800);
  const after = await readWorkspace(page);
  assert.equal(after.document.sequence, before.document.sequence + 1);
  assert.equal(readScene(after.document).groups.length, 0);
  await expect.poll(picked).toEqual([]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => (await readWorkspace(page)).page.layout[output])
    .toEqual(before.page.layout[output]);
  assert.deepEqual(errors, []);
  console.log(
    "Overlap chooser: four-way pointer/keyboard cycling, touch access, focus restoration, temporary reveal, exact-byte isolation, move and Undo passed.",
  );
} finally {
  await browser.close();
}
