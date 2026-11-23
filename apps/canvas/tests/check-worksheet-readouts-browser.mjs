import { chromium, expect } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserOptions } from "../../../scripts/browser.mjs";
import { readWorkspace, startWriting } from "./browser-workspace.mjs";
import { workspaceStorage } from "../src/regions/workspaceStorage.ts";
import { RegionSession } from "../src/regions/document.ts";
import { archive } from "../src/regions/artifacts.ts";
const browser = await chromium.launch({ ...browserOptions(), headless: true }),
  dir = await mkdtemp(join(tmpdir(), "manifold-live-readouts-"));
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1050 },
    }),
    errors = [];
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
  const editor = page.getByLabel("Write an engineering region", {
    exact: true,
  });
  await startWriting(page);
  for (const source of [
    "D_1 := 100 mm",
    "d_t := 50 mm",
    "C_d := 0.98",
    "A_t = pi*d_t^2/4",
    "beta = d_t/D_1",
    "p_drop := 7500 Pa",
    "rho := 1000 kg/m^3",
    "Q = C_d*A_t*sqrt((2*p_drop)/(rho*(1-beta^4)))",
    "Q >= 0.006 m^3/s",
  ]) {
    await editor.fill(source);
    await editor.press("Enter");
  }
  const saved = async () =>
    (
      await readWorkspace(
        page,
        workspaceStorage(
          "manifold.artifact-experiment.v1",
          new URL(page.url()).search,
        ),
      )
    ).page;
  const append = async (str) => editor.fill((await editor.inputValue()) + str);
  await editor.fill("At @d_t");
  await editor.press("Alt+Enter");
  await expect(editor).toHaveValue("At {{d_t}}");
  await editor.fill("At @p_drop");
  await page.getByRole("button", { name: /^Show value of p_drop/ }).click();
  await expect(editor).toHaveValue("At {{p_drop}}");
  await append(", predicted flow is @Q");
  await editor.press("Enter"); // Existing default inserts an identity-bound name, not a value.
  await expect(editor).toHaveValue(/flow is Q$/);
  await editor.press("Alt+Enter");
  await expect(editor).toHaveValue(/flow is \{\{Q\}\}$/);
  await append(". Minimum flow: @requirement");
  await page.getByRole("option", { name: /Q >= 0.006 m\^3\/s/ }).click();
  await append(".");
  await editor.press("Escape");
  const baseline = await saved(),
    noteRecord = baseline.regions.find((r) =>
      r.text.startsWith("At {{p_drop}}"),
    );
  expect(noteRecord.text).toBe(
    "At {{p_drop}}, predicted flow is {{Q}}. Minimum flow: {{?Q_check}}.",
  );
  const ids = baseline.links[noteRecord.id],
    note = page.locator(`[data-region-id="${noteRecord.id}"] .er-note`);
  expect(ids.Q_check).not.toBe(ids.Q);
  expect(Object.keys(ids).sort()).toEqual(["Q", "Q_check", "p_drop"]);
  const trace = page.getByRole("complementary", {
      name: "Trace values",
      exact: true,
    }),
    pins = page.getByRole("region", { name: "Pinned worksheet results" }),
    pinned = (id) => pins.locator(`[data-pinned-result="${id}"]`);
  const flow = note.getByRole("button", { name: /^Trace value of Q:/ }),
    status = note.getByRole("button", { name: /^Trace status of Q:/ });
  await expect(note).toHaveRole("group"); // Exposes the sentence and its buttons, not a button inside another button.
  await note.press("Enter");
  await expect(editor).toHaveValue(noteRecord.text);
  await editor.press("Escape");
  await expect(flow).toHaveText("7.697 L/s");
  await expect(status).toHaveText("Q ≥ 6 L/s · met");
  await status.press("Enter");
  await expect(trace.locator("header")).toContainText("Q");
  await expect(page.locator(`[data-region-id="${ids.Q_check}"]`)).toHaveClass(
    /is-selected/,
  );
  await flow.press("Enter");
  await expect(page.locator(`[data-region-id="${ids.Q}"]`)).toHaveClass(
    /is-selected/,
  );
  await trace
    .getByRole("button", { name: "Pin in Results", exact: true })
    .click();
  await pins.getByLabel("Pin a worksheet result").selectOption(ids.Q_check);
  await trace
    .getByRole("button", { name: "Pin in Results", exact: true })
    .click();
  await expect(pins.locator("li")).toHaveCount(2);
  expect(await saved()).toEqual(baseline);
  await trace
    .getByRole("button", { name: "Trace input p_drop", exact: true })
    .click();
  const drag = async (dx) => {
    const r = await trace
      .getByRole("button", { name: /^Vary p_drop:/ })
      .boundingBox();
    expect(r).toBeTruthy();
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 8 });
  };
  await drag(-135);
  await expect(flow).toHaveText("3.848 L/s");
  await expect(status).toHaveText("Q ≥ 6 L/s · not met");
  await expect(pinned(ids.Q)).toContainText("3.848 L/s");
  await expect(pinned(ids.Q_check)).toContainText("not met");
  await expect(note.locator(".er-readout-preview")).toHaveCount(1);
  await expect(pins.locator(".er-readout-preview")).toHaveCount(2);
  expect(await saved()).toEqual(baseline);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(flow).toHaveText("7.697 L/s");
  await expect(pinned(ids.Q_check).locator("b")).toHaveText("met");
  await expect(note.locator(".er-readout-preview")).toHaveCount(0);
  expect(await saved()).toEqual(baseline);
  // A domain error never falls back to the accepted value in prose or pins.
  await drag(-225);
  await expect(flow).toHaveText(/Unavailable/);
  await expect(pinned(ids.Q).locator("b")).toHaveText("Unavailable");
  await expect(pinned(ids.Q_check).locator("b")).toHaveText("Unavailable");
  await page.mouse.up();
  await expect(flow).toHaveText("7.697 L/s");
  const notice = page
    .getByRole("status")
    .filter({ hasText: "Undefined result. The value was restored." });
  await notice.getByRole("button", { name: "Dismiss message" }).click();
  await drag(-135);
  await page.mouse.up();
  await expect(flow).toHaveText("3.848 L/s");
  await expect(pins.locator(".er-readout-preview")).toHaveCount(0);
  expect(
    (await saved()).regions
      .filter((r, i) => r.text !== baseline.regions[i].text)
      .map((r) => r.id),
  ).toEqual([ids.p_drop]);
  await page.getByLabel("Undo", { exact: true }).click();
  expect(await saved()).toEqual(baseline);
  await page.reload();
  await expect(pins.locator("li")).toHaveCount(2);
  await expect(flow).toHaveText("7.697 L/s");
  await expect(trace).toHaveCount(0);
  const canvas = page.locator(".er-canvas");
  await canvas.evaluate((el) => el.scrollBy(0, 1400));
  await expect(flow).not.toBeInViewport();
  await expect(pinned(ids.Q)).toBeInViewport();
  await pinned(ids.Q)
    .getByRole("button", { name: "Trace Q: 7.697 L/s", exact: true })
    .click();
  await expect(trace).toBeVisible();
  await expect(
    page.locator(`[data-region-id="${ids.Q}"] math`),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Download workspace copy");
  const exporting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download workspace copy", exact: true })
    .click();
  const file = join(dir, "live-notes.manifold");
  await (await exporting).saveAs(file);
  expect(await readFile(file, "utf8")).not.toContain("pinnedResults");
  await pins.getByRole("button", { name: "Unpin Q", exact: true }).click();
  await expect(pins.locator("li")).toHaveCount(1);
  expect(await saved()).toEqual(baseline);
  const oldUrl = page.url();
  await page
    .getByLabel("Open workspace file", { exact: true })
    .setInputFiles(file);
  await page.waitForURL((url) => url.href !== oldUrl);
  await expect(flow).toHaveText("7.697 L/s");
  await expect(status).toHaveText("Q ≥ 6 L/s · met");
  await expect(pins).toBeVisible();
  await expect(pins.locator("li")).toHaveCount(0);
  expect((await saved()).links[noteRecord.id]).toEqual(ids);
  // Following a pin also leaves System overview for the right worksheet scope.
  const grouped = new RegionSession(baseline);
  try {
    grouped.makeModel(
      {
        id: "pressure-group",
        name: "Pressure",
        members: [ids.p_drop],
        inputs: [],
        outputs: [ids.p_drop],
      },
      { x: 100, y: 100 },
    );
    grouped.makeModel(
      {
        id: "note-group",
        name: "Summary",
        members: [noteRecord.id],
        inputs: [],
        outputs: [],
      },
      { x: 380, y: 140 },
    );
    const url = page.url();
    await page
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles({
        name: "grouped.manifold",
        mimeType: "application/json",
        buffer: Buffer.from(archive(grouped.native())),
      });
    await page.waitForURL((u) => u.href !== url);
    for (const id of [ids.Q, ids.p_drop]) {
      await pins.getByLabel("Pin a worksheet result").selectOption(id);
      await page.getByRole("button", { name: "View", exact: true }).click();
      await page
        .getByRole("button", { name: "System overview", exact: true })
        .click();
      await expect(page.locator("[data-system-overview]")).toBeVisible();
      await pinned(id)
        .getByRole("button", { name: /^Trace / })
        .click();
      await expect(trace).toBeVisible();
      await expect(
        page.locator(`[data-region-id="${id}"] math`),
      ).toBeInViewport();
    }
  } finally {
    grouped.dispose();
  }
  expect(errors).toEqual([]);
  console.log(
    "Venturi live notes and pinned readings: keyboard/pointer authoring, exact constraint and result Trace, half-flow scrub, unavailable domain, cancel/Undo, offscreen pins, local resume and portable notes without pins pass.",
  );
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
