import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "./browser-evidence.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive } from "../src/regions/artifacts.ts";
import { readScene } from "../src/regions/sceneRecords.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const { session, input, output, artifact, dataset } = await sceneFixture(1);
const gain = session.state.regions.find((region) => region.source)?.id;
session.arrange({
  [input]: { x: 90, y: 140 },
  [output]: { x: 90, y: 320 },
  [gain]: { x: 90, y: 500 },
  [dataset]: { x: 90, y: 760 },
});
session.setArtifacts((items) =>
  items.map((item) => ({
    ...item,
    at: { x: 900, y: 560 },
    views: [
      {
        id: "view-layout-extra",
        renderer: "table",
        at: { x: 1600, y: 560 },
        width: 500,
        height: 320,
      },
    ],
  })),
);
const plot = session.addPlot(output, input);
session.move(plot, { x: 90, y: 1100 });
const source = archive(session.native());
session.dispose();
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 2200, height: 1500 },
  });
  page.setDefaultTimeout(10000);
  await page.clock.install();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((text) => {
    if (!localStorage.getItem("manifold.artifact-experiment.v1"))
      localStorage.setItem("manifold.artifact-experiment.v1", text);
  }, source);
  await page.goto(base);
  await readWorkspace(page);
  const start = async (handle) => {
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    return at;
  };
  const layoutState = (workspace) => ({
    page: workspace.page,
    scene: readScene(workspace.document),
    artifacts: workspace.artifacts.map(({ receipt, ...item }) => item),
  });
  const undo = async (before) => {
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => layoutState(await readWorkspace(page)))
      .toEqual(layoutState(before));
  };
  const unchangedCancel = async (handle) => {
    const before = await readWorkspaceBytes(page);
    const at = await start(handle);
    await page.mouse.move(at.x + 70, at.y + 55, { steps: 6 });
    assert.equal(
      await readWorkspaceBytes(page),
      before,
      "movement must not publish previews",
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(
      await readWorkspaceBytes(page),
      before,
      "cancellation must preserve exact durable head and bytes",
    );
  };
  const region = page.locator(`[data-region-id="${output}"]`);
  await unchangedCancel(
    region.getByRole("button", { name: "Move F", exact: true }),
  );
  const tool = page.locator('[data-tool-id="tool-scene-0"]');
  const pause = async () =>
    page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const held = async () => {
    await page.clock.runFor(449);
    await expect(page.locator(".cs-dock-object")).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(page.locator(".cs-dock-preview.is-ready")).toBeVisible();
  };
  const preview = () =>
    page.locator(".cs-dock-object").evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.dataset.dockObject,
        x: parseFloat(node.style.left),
        y: parseFloat(node.style.top),
      })),
    );
  const matchesPreview = async (destinations) => {
    const workspace = await readWorkspace(page),
      scene = readScene(workspace.document);
    for (const { id, x, y } of destinations) {
      const point =
        workspace.page.layout[id] ||
        [
          ...scene.tools,
          ...workspace.page.plots,
          ...workspace.artifacts.flatMap((a) => [a, ...(a.views || [])]),
        ].find((v) => v.id === id)?.at;
      assert.ok(point, `accepted placement for ${id}`);
      assert.ok(
        Math.abs(point.x - x) < 0.01 && Math.abs(point.y - y) < 0.01,
        `stored placement matches preview: ${id}`,
      );
      const rendered = await page
        .locator(
          `[data-region-id="${id}"],[data-tool-id="${id}"],[data-view-id="${id}"],[data-plot-id="${id}"]`,
        )
        .evaluate((node) => ({
          x: parseFloat(node.style.left),
          y: parseFloat(node.style.top),
        }));
      assert.ok(
        Math.abs(rendered.x - x) < 0.01 && Math.abs(rendered.y - y) < 0.01,
        `rendered placement matches preview: ${id}`,
      );
    }
    return workspace;
  };
  // A pending edge hover is cancellable and cannot arm after cancellation.
  let before = await readWorkspace(page);
  const originalBytes = await readWorkspaceBytes(page);
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await pause();
  let target = await tool.boundingBox();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await expect(page.locator(".cs-dock-preview.is-pending")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.clock.runFor(1000);
  await page.mouse.up();
  await page.clock.resume();
  await expect(page.locator(".cs-dock-preview")).toHaveCount(0);
  assert.equal(await readWorkspaceBytes(page), originalBytes);
  // Foreign capture loss is ignored; losing the owned capture cancels the pending timer.
  const moveRegion = region.getByRole("button", {
    name: "Move F",
    exact: true,
  });
  await start(moveRegion);
  await pause();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await moveRegion.dispatchEvent("lostpointercapture", { pointerId: 999 });
  await expect(page.locator(".cs-dock-preview.is-pending")).toBeVisible();
  await moveRegion.evaluate((node) => node.releasePointerCapture(1));
  await page.mouse.move(target.x + 6, target.y + 80);
  await page.clock.runFor(1000);
  await expect(page.locator(".cs-dock-preview")).toHaveCount(0);
  await page.mouse.up();
  await page.clock.resume();
  assert.equal(await readWorkspaceBytes(page), originalBytes);
  // An armed full-layout preview is equally cancellable without accepted bytes.
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await pause();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await held();
  await page.keyboard.press("Escape");
  await page.clock.runFor(1000);
  await page.mouse.up();
  await page.clock.resume();
  assert.equal(await readWorkspaceBytes(page), originalBytes);
  // A presentation-only size change cannot accept a different layout than the ghost.
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await pause();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await held();
  const originalWidth = await tool.evaluate((node) => node.style.width);
  await tool.evaluate((node) => {
    node.style.width = `${parseFloat(node.style.width) + 40}px`;
  });
  await page.mouse.up();
  await page.clock.resume();
  await expect(
    page.getByText(
      "The layout changed during the preview. Try the move again.",
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(await readWorkspaceBytes(page), originalBytes);
  await tool.evaluate((node, width) => {
    node.style.width = width;
  }, originalWidth);
  // Releasing just before the dwell boundary accepts free placement, never a late dock.
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await pause();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await page.clock.runFor(449);
  await expect(page.locator(".cs-dock-object")).toHaveCount(0);
  await page.mouse.up();
  await page.clock.runFor(1000);
  await page.clock.resume();
  await expect(page.locator(".cs-dock-preview")).toHaveCount(0);
  assert.equal(
    readScene((await readWorkspace(page)).document).groups.length,
    0,
  );
  await undo(before);
  // Previewing is transient; Alt clears it and starts a fresh dwell on release.
  before = await readWorkspace(page);
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await pause();
  target = await tool.boundingBox();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await held();
  await expect(page.locator(".cs-dock-object")).toHaveCount(2);
  await page.keyboard.down("Alt");
  await expect(page.locator(".cs-dock-preview")).toHaveCount(0);
  await expect(page.locator(".er-alignment-guide")).toHaveCount(0);
  await page.keyboard.up("Alt");
  await expect(page.locator(".cs-dock-preview.is-pending")).toBeVisible();
  await held();
  assert.equal((await readWorkspace(page)).document.id, before.document.id);
  const firstPreview = await preview();
  await captureEvidence(page, { path: "screenshots/deliberate-docking.png" });
  await page.mouse.up();
  await page.clock.resume();
  let accepted = await matchesPreview(firstPreview);
  assert.equal(readScene(accepted.document).groups.length, 1);
  assert.equal(accepted.document.sequence, before.document.sequence + 1);
  // Joining a group previews every member, not just the dragged object.
  const firstDock = accepted;
  const gainRegion = page.locator(`[data-region-id="${gain}"]`);
  await start(gainRegion.getByRole("button", { name: /^Move / }));
  await pause();
  target = await tool.boundingBox();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await held();
  await expect(page.locator(".cs-dock-object")).toHaveCount(3);
  const groupPreview = await preview();
  await page.mouse.up();
  await page.clock.resume();
  accepted = await matchesPreview(groupPreview);
  assert.equal(readScene(accepted.document).groups[0].members.length, 3);
  assert.equal(accepted.document.sequence, firstDock.document.sequence + 1);
  // Detaching into a new group also previews compaction of the old group's peers.
  const threeMembers = accepted;
  const pinch = (deltaY) =>
    page.locator(".er-canvas").evaluate((node, deltaY) => {
      const rect = node.getBoundingClientRect();
      node.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY,
          clientX: rect.left + 200,
          clientY: rect.top + 180,
        }),
      );
    }, deltaY);
  await pinch(20);
  await expect(page.locator(".er-zoom")).toContainText("82%");
  const peerPosition = () =>
    gainRegion.evaluate((node) => ({
      x: parseFloat(node.style.left),
      y: parseFloat(node.style.top),
    }));
  const peerBefore = await peerPosition();
  // Free detachment previews the old group's gap closing too, including at fractional zoom.
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await page.mouse.move(2050, 380, { steps: 12 });
  await expect
    .poll(async () => (await peerPosition()).x)
    .toBeLessThan(peerBefore.x - 50);
  await expect(page.locator(".cs-dock-preview")).toHaveCount(0);
  assert.equal(
    (await readWorkspace(page)).document.id,
    threeMembers.document.id,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(peerPosition).toEqual(peerBefore);
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await page.mouse.move(2050, 380, { steps: 12 });
  await expect
    .poll(async () => (await peerPosition()).x)
    .toBeLessThan(peerBefore.x - 50);
  const freePeer = await peerPosition();
  await page.mouse.up();
  accepted = await matchesPreview([{ id: gain, ...freePeer }]);
  assert.equal(accepted.document.sequence, threeMembers.document.sequence + 1);
  assert.equal(readScene(accepted.document).groups[0].members.length, 2);
  await undo(threeMembers);
  await pinch(-20);
  await expect(page.locator(".er-zoom")).toContainText("100%");
  const splitBaseline = await readWorkspace(page);
  await start(region.getByRole("button", { name: "Move F", exact: true }));
  await pause();
  target = await page.locator(`[data-view-id="${artifact.id}"]`).boundingBox();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await held();
  await expect(page.locator(".cs-dock-object")).toHaveCount(4);
  const splitPreview = await preview();
  await page.mouse.up();
  await page.clock.resume();
  accepted = await matchesPreview(splitPreview);
  assert.equal(readScene(accepted.document).groups.length, 2);
  assert.equal(accepted.document.sequence, splitBaseline.document.sequence + 1);
  await undo(threeMembers);
  await undo(firstDock);
  await undo(before);
  const art = page.locator(`[data-view-id="${artifact.id}"]`);
  for (const view of [
    art,
    page.locator('[data-view-id="view-layout-extra"]'),
  ]) {
    await unchangedCancel(
      view.getByRole("button", { name: "Move artifact", exact: true }),
    );
    await unchangedCancel(
      view.getByRole("button", { name: "Resize artifact", exact: true }),
    );
    before = await readWorkspace(page);
    const at = await start(
      view.getByRole("button", { name: "Resize artifact", exact: true }),
    );
    await page.mouse.move(at.x + 65, at.y + 50, { steps: 6 });
    assert.equal((await readWorkspace(page)).document.id, before.document.id);
    const previewStyle = () =>
      view.evaluate((node) => [
        node.style.left,
        node.style.top,
        node.style.width,
        node.style.height,
      ]);
    const ownedPreview = await previewStyle();
    for (const type of ["pointermove", "pointerup", "pointercancel"]) {
      await view.evaluate(
        (node, type) =>
          node.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 999,
              bubbles: true,
              clientX: 5,
              clientY: 5,
            }),
          ),
        type,
      );
      await expect.poll(previewStyle).toEqual(ownedPreview);
      assert.equal(
        (await readWorkspace(page)).document.id,
        before.document.id,
        `${type} from another pointer cannot disturb or publish the active resize`,
      );
    }
    await page.mouse.up();
    await expect
      .poll(async () => (await readWorkspace(page)).document.id)
      .not.toBe(before.document.id);
    assert.equal(
      (await readWorkspace(page)).document.sequence,
      before.document.sequence + 1,
    );
    if (view === art) {
      const moving = await start(
        tool.getByRole("button", { name: "Move canvas tool", exact: true }),
      );
      await page.mouse.move(moving.x + 60, moving.y + 55, { steps: 6 });
      await undo(before);
      const reverted = await readWorkspaceBytes(page);
      await page.mouse.up();
      await expect(
        page.getByText(
          "This workspace changed during the gesture. Try the move again.",
          { exact: true },
        ),
      ).toBeVisible();
      assert.equal(
        await readWorkspaceBytes(page),
        reverted,
        "a stale pointer-up cannot overwrite Undo",
      );
    } else await undo(before);
  }
  before = await readWorkspace(page);
  await start(art.getByRole("button", { name: "Move artifact", exact: true }));
  target = await tool.boundingBox();
  await page.mouse.move(target.x + 5, target.y + 80, { steps: 12 });
  await expect(page.locator(".cs-dock-preview.is-ready")).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(
      async () => readScene((await readWorkspace(page)).document).groups.length,
    )
    .toBe(1);
  assert.equal(
    (await readWorkspace(page)).document.sequence,
    before.document.sequence + 1,
  );
  await undo(before);
  const curve = page.locator(`[data-plot-id="${plot}"]`);
  await unchangedCancel(
    curve.getByRole("button", { name: "Move response plot", exact: true }),
  );
  await unchangedCancel(
    curve.getByRole("button", { name: "Resize response plot", exact: true }),
  );
  before = await readWorkspace(page);
  const corner = await start(
    curve.getByRole("button", { name: "Resize response plot", exact: true }),
  );
  await page.mouse.move(corner.x + 70, corner.y + 50, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await readWorkspace(page)).document.id)
    .not.toBe(before.document.id);
  assert.equal(
    (await readWorkspace(page)).document.sequence,
    before.document.sequence + 1,
  );
  await undo(before);
  // Losing capture cancels renderer-local geometry rather than committing it later.
  const resize = curve.getByRole("button", {
    name: "Resize response plot",
    exact: true,
  });
  const restoredStyle = () =>
    curve.evaluate((node) => [node.style.width, node.style.height]);
  const priorStyle = await restoredStyle(),
    priorBytes = await readWorkspaceBytes(page);
  const lost = await start(resize);
  await page.mouse.move(lost.x + 50, lost.y + 35, { steps: 4 });
  await resize.evaluate((node) => node.releasePointerCapture(1));
  await page.mouse.move(lost.x + 51, lost.y + 36);
  await expect.poll(restoredStyle).toEqual(priorStyle);
  await page.mouse.up();
  assert.equal(await readWorkspaceBytes(page), priorBytes);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "Layout gestures Chrome: region/artifact docking accepts once; primary/secondary artifact and plot geometry preview/cancel/resize/Undo share one owner and preserve exact saved bytes.",
  );
} finally {
  await browser.close();
}
