import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { browserOptions } from "../../../scripts/browser.mjs";
import {
  chooseDrawingTool,
  readWorkspace,
  readWorkspaceBytes,
} from "./browser-workspace.mjs";
import { DRAWING_WHEEL_STORAGE } from "../src/regions/interaction/drawingWheel.ts";
import { drawings } from "../src/regions/drawing.ts";
import { captureEvidence } from "./browser-evidence.mjs";
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const canvas = page.locator(".er-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  const click = (x, y) => page.mouse.click(box.x + x, box.y + y);
  const marks = async () => drawings((await readWorkspace(page)).document);
  await chooseDrawingTool(page, "Curve");
  await click(150, 150);
  await click(250, 350);
  assert.equal((await marks()).length, 0, "unfinished curve is not persisted");
  await page.mouse.move(box.x + 350, box.y + 150);
  await expect(
    page.locator('.drawing-surface > g[pointer-events="none"] path'),
  ).toHaveAttribute("d", / C/);
  await click(350, 150);
  await expect.poll(async () => (await marks()).length).toBe(1);
  const original = (await marks())[0];
  await expect(
    page.locator('[data-drawing-kind="curve"] path'),
  ).toHaveAttribute("d", / C/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await marks()).length).toBe(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(marks).toEqual([original]);
  await chooseDrawingTool(page, "Select / Edit");
  const control = page.locator('[data-curve-point="1"]');
  await expect(control).toBeVisible();
  const handle = await control.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 30,
    handle.y + handle.height / 2 - 40,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await marks())[0].mark.points[1].x)
    .toBe(original.mark.points[1].x + 30);
  await control.focus();
  await expect(control).toBeFocused();
  await control.press("ArrowRight");
  await expect
    .poll(async () => (await marks())[0].mark.points[1].x)
    .toBe(original.mark.points[1].x + 35);
  await page.keyboard.press("Escape");
  await chooseDrawingTool(page, "Spline");
  await click(500, 200);
  await click(600, 350);
  await click(700, 200);
  await page.keyboard.press("Backspace");
  await click(720, 250);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await marks()).length).toBe(2);
  assert.equal((await marks())[1].mark.points.length, 3);
  await click(500, 450);
  await click(600, 550);
  await page.mouse.dblclick(box.x + 700, box.y + 450);
  await expect.poll(async () => (await marks()).length).toBe(3);
  assert.equal(
    (await marks())[2].mark.points.length,
    3,
    "double-click adds no duplicate knot",
  );
  await click(800, 450);
  await click(900, 550);
  await page.keyboard.press("Escape");
  assert.equal((await marks()).length, 3, "Escape discards the draft");
  const pen = page.getByRole("button", { name: "Pen", exact: true });
  await pen.focus();
  await page.keyboard.press("p");
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(box.x + 600, box.y + 450);
  await page.keyboard.down("Shift");
  await page.keyboard.down("Space");
  const wheel = page.getByRole("menu", { name: "Drawing tools", exact: true });
  await expect(wheel).toBeVisible();
  await expect(wheel).toHaveAttribute("data-revealed", "true");
  await captureEvidence(page, {
    path: new URL("../screenshots/drawing-tool-wheel.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await page.mouse.move(box.x + 668, box.y + 518);
  await page.keyboard.up("Space");
  await page.keyboard.up("Shift");
  await expect(wheel).toHaveCount(0);
  const arcTool = page.getByRole("button", {
    name: "Shapes: Arc",
    exact: true,
  });
  await expect(arcTool).toHaveText("Arc");
  await click(450, 620);
  await click(500, 620);
  await click(560, 620);
  assert.equal(
    (await marks()).length,
    3,
    "collinear arc points do not persist",
  );
  await page.mouse.move(box.x + 550, box.y + 670);
  await expect(page.locator("[data-arc-preview] path")).toHaveAttribute(
    "d",
    / A/,
  );
  await captureEvidence(page, {
    path: new URL("../screenshots/three-point-arc-preview.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await click(550, 670);
  await expect.poll(async () => (await marks()).length).toBe(4);
  const arc = (await marks()).find((e) => e.mark.kind === "arc");
  assert.equal(arc.mark.points.length, 3);
  await expect(page.locator('[data-drawing-kind="arc"] path')).toHaveAttribute(
    "d",
    / A/,
  );
  await page.keyboard.press("v");
  await expect(
    page.getByRole("button", { name: "Select / Edit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: /Arc through point/ }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await marks()).length).toBe(3);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => (await marks()).length).toBe(4);
  await page.reload();
  await expect(page.locator('[data-drawing-kind="arc"] path')).toHaveAttribute(
    "d",
    / A/,
  );
  // Default Select types a worksheet; a drawing shortcut never consumes text.
  await canvas.focus();
  await page.keyboard.press("a");
  const writer = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await expect(writer).toHaveValue("a");
  await writer.press("p");
  await expect(writer).toHaveValue("ap");
  await writer.press("Escape");
  await pen.focus();
  await page.keyboard.press("Shift+Space");
  await expect(wheel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pen).toBeFocused();
  await page.keyboard.press("Shift+Space");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", {
      name: "More drawing tools: Eraser",
      exact: true,
    }),
  ).toHaveAttribute("data-active", "true");

  const editWheel = (tab) =>
    tab.getByRole("dialog", { name: "Edit tool wheel", exact: true });
  const moreTools = (tab) =>
    tab.getByRole("button", { name: /^More drawing tools(?:$|:)/ });
  const editWheelButton = (tab) =>
    tab.getByRole("button", { name: "Edit tool wheel…", exact: true });
  const openEditor = async () => {
    await moreTools(page).click();
    await editWheelButton(page).click();
    await expect(editWheel(page)).toBeVisible();
  };
  const editor = editWheel(page);
  const slot = (name) => editor.getByRole("combobox", { name, exact: true });
  const saveWheel = editor.getByRole("button", {
    name: "Save wheel",
    exact: true,
  });
  const savedWorksheet = await readWorkspaceBytes(page);
  await openEditor();
  await expect(editor.getByRole("combobox")).toHaveCount(8);
  await expect(slot("Top").locator("option")).toHaveCount(16);
  await expect(slot("Top").locator('option[value="polyline"]')).toHaveText(
    "Polyline / Polygon",
  );
  await slot("Top").selectOption("connector");
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(moreTools(page)).toBeFocused();
  await openEditor();
  await expect(slot("Top")).toHaveValue("select");
  await slot("Top").selectOption("connector");
  await slot("Top right").selectOption("line");
  await expect(slot("Right")).toHaveValue("pen");
  await captureEvidence(page, {
    path: new URL("../screenshots/edit-tool-wheel-desktop.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await saveWheel.click();
  await expect(editor).toHaveCount(0);
  assert.equal(await readWorkspaceBytes(page), savedWorksheet);
  await page.reload();
  await pen.focus();
  const wheelCenter = await canvas.boundingBox();
  await page.mouse.move(wheelCenter.x + 600, wheelCenter.y + 450);
  await page.keyboard.down("Shift");
  await page.keyboard.down("Space");
  await expect(wheel.getByRole("menuitem").first()).toHaveText("Connector");
  await page.mouse.move(wheelCenter.x + 600, wheelCenter.y + 365);
  await page.keyboard.up("Space");
  await page.keyboard.up("Shift");
  await expect(
    page.getByRole("button", { name: "Shapes: Connector", exact: true }),
  ).toBeVisible();
  await openEditor();
  await editor
    .getByRole("button", { name: "Restore defaults", exact: true })
    .click();
  await expect(slot("Top")).toHaveValue("select");
  await saveWheel.click();
  await openEditor();
  await expect(slot("Top")).toHaveValue("select");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  // Unknown IDs or repeated slots must not leave unusable wedges on reload.
  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify(Array(8).fill("arrow"))),
    DRAWING_WHEEL_STORAGE,
  );
  await page.reload();
  await openEditor();
  await expect(slot("Top")).toHaveValue("select");
  await expect(slot("Top right")).toHaveValue("pen");

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  await phone
    .getByRole("button", { name: "More drawing tools", exact: true })
    .tap();
  await phone.getByRole("button", { name: "Tool wheel", exact: true }).tap();
  const phoneWheel = phone.getByRole("menu", {
    name: "Drawing tools",
    exact: true,
  });
  await expect(phoneWheel).toBeVisible();
  await captureEvidence(phone, {
    path: new URL("../screenshots/drawing-tool-wheel-390.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await phoneWheel.getByRole("menuitem", { name: "Arc", exact: true }).tap();
  const phoneArc = phone.getByRole("button", {
    name: "Shapes: Arc",
    exact: true,
  });
  await expect(phoneArc).toBeVisible();
  await phoneArc.tap();
  await expect(
    phone.getByRole("group", { name: "Shapes commands", exact: true }),
  ).toBeVisible();
  await captureEvidence(phone, {
    path: new URL("../screenshots/drawing-tools-390.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await moreTools(phone).tap();
  await editWheelButton(phone).tap();
  const phoneEditor = editWheel(phone);
  await phoneEditor
    .getByRole("combobox", { name: "Top right", exact: true })
    .selectOption("highlighter");
  const editorBounds = await phoneEditor.boundingBox();
  assert.ok(editorBounds.x >= 0 && editorBounds.x + editorBounds.width <= 390);
  await captureEvidence(phone, {
    path: new URL("../screenshots/edit-tool-wheel-390.png", import.meta.url)
      .pathname,
    animations: "disabled",
  });
  await phoneEditor
    .getByRole("button", { name: "Save wheel", exact: true })
    .tap();
  await moreTools(phone).tap();
  await phone.getByRole("button", { name: "Tool wheel", exact: true }).tap();
  await phoneWheel
    .getByRole("menuitem", { name: "Highlighter", exact: true })
    .tap();
  await expect(moreTools(phone)).toHaveAttribute(
    "aria-label",
    "More drawing tools: Highlighter",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Drawing paths and editable tool wheel: previews, history, custom directions, swaps, persistence, resets, and 390 px touch selection passed.",
  );
} finally {
  await browser.close();
}
