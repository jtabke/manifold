import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { sceneFixture } from "./scene-fixture.mjs";
import { archive, decodeWorkspace } from "../src/regions/artifacts.ts";
import { initialLayouts } from "../src/regions/areaLayout.ts";
import { readWorkspace, readWorkspaceBytes } from "./browser-workspace.mjs";
const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const { session, input, artifact } = await sceneFixture(1);
session.setScene({ ...session.scene, tools: [] });
session.setArtifacts((items) =>
  items.map((item) => ({ ...item, at: { x: 700, y: 150 } })),
);
const source = archive(session.native());
session.dispose();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1800, height: 1100 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((text) => {
    if (!localStorage.getItem("manifold.artifact-experiment.v1"))
      localStorage.setItem("manifold.artifact-experiment.v1", text);
  }, source);
  await page.goto(base);
  await readWorkspace(page);
  let jobs = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/artifact-sample")) jobs++;
  });
  const command = async (p, name) => {
    await p
      .getByRole("button", { name: "Search objects and commands", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "Search commands", exact: true })
      .fill(name);
    await p.getByRole("button", { name, exact: true }).click();
  };
  const art = page.locator(`[data-view-id="${artifact.id}"]`);
  await art.hover();
  await art
    .getByRole("button", { name: "Inspect Python", exact: true })
    .click();
  const code = art.getByLabel("Artifact Python source", { exact: true });
  const originalCode = await code.inputValue();
  const draft = originalCode + "\n# Unaccepted draft";
  await code.fill(draft);
  const before = await readWorkspaceBytes(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await command(page, "Export workspace");
  await expect(art.getByRole("alert")).toContainText(
    "Run this Python draft or use model code",
  );
  await expect(
    page.getByText("Finish or cancel pending edits before continuing.", {
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(await readWorkspaceBytes(page), before);
  assert.equal(downloads, 0);
  assert.equal(jobs, 0);
  await expect(code).toHaveValue(draft);
  // Oversized explicit submission refuses without losing the input or publishing a root.
  await code.fill("z".repeat(4001));
  await art
    .locator(".er-artifact-code")
    .getByRole("button", { name: "Run Python", exact: true })
    .click();
  await expect(art.getByRole("alert")).toBeVisible();
  assert.equal(await readWorkspaceBytes(page), before);
  assert.equal(jobs, 0);
  await expect(code).toHaveValue("z".repeat(4001));
  await art
    .getByRole("button", { name: "Use model code", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await command(page, "Export workspace");
  const exported = await decodeWorkspace(
    await readFile(await (await downloading).path(), "utf8"),
  );
  assert.equal(exported.artifacts[0].code, undefined);
  assert.equal(jobs, 0);

  const context = await browser.newContext({
    viewport: { width: 1900, height: 1100 },
  });
  const pane = await context.newPage();
  pane.setDefaultTimeout(10000);
  pane.on("pageerror", (e) => errors.push(e.message));
  const layouts = initialLayouts();
  layouts.active = layouts.workspaces.find((w) => w.name === "Model").id;
  await pane.addInitScript(
    ({ source, layouts }) => {
      if (!localStorage.getItem("manifold.artifact-experiment.v1"))
        localStorage.setItem("manifold.artifact-experiment.v1", source);
      localStorage.setItem(
        "manifold.workspace-areas.v1",
        JSON.stringify(layouts),
      );
    },
    { source, layouts },
  );
  await pane.goto(base + "/?editors=1");
  await readWorkspace(pane);
  const delayedOpen = async (edit, dismiss = true) => {
    const url = pane.url(),
      saved = await readWorkspaceBytes(pane);
    await pane.evaluate(() => {
      const original = File.prototype.text;
      window.rendererReadStarted = false;
      File.prototype.text = function () {
        const file = this;
        window.rendererReadStarted = true;
        return new Promise((resolve) => {
          window.releaseRendererRead = async () => {
            File.prototype.text = original;
            resolve(await original.call(file));
          };
        });
      };
    });
    await pane
      .getByLabel("Open workspace file", { exact: true })
      .setInputFiles({
        name: "incoming.manifold",
        mimeType: "application/json",
        buffer: Buffer.from(source),
      });
    await pane.waitForFunction(() => window.rendererReadStarted);
    await edit();
    await pane.evaluate(() => window.releaseRendererRead());
    await expect(
      pane.getByText(/Could not open workspace: Work changed while reading/),
    ).toBeVisible();
    assert.equal(pane.url(), url);
    assert.equal(await readWorkspaceBytes(pane), saved);
    if (dismiss)
      await pane
        .getByRole("button", { name: "Dismiss message", exact: true })
        .click();
  };
  const python = pane.getByLabel("Python editor", { exact: true });
  await python.getByRole("button", { name: "Edit code", exact: true }).click();
  const panelCode = python.getByLabel("Workspace Python source", {
    exact: true,
  });
  await delayedOpen(() =>
    panelCode.fill((originalCode || "# Code") + "\n# pending panel draft"),
  );
  await command(pane, "Export workspace");
  await expect(python.getByRole("alert")).toContainText(
    "Run or cancel this Python draft",
  );
  await python.getByRole("button", { name: "Cancel", exact: true }).click();
  const equation = pane.locator(
    `[data-object-id="${input}"] .mw-equation-line`,
  );
  await equation.getByRole("button", { name: "Edit x", exact: true }).click();
  const text = pane.getByLabel("Edit equation in workspace", { exact: true });
  await expect(text).toBeVisible();
  await delayedOpen(() => text.fill("x := 2 mm"), false);
  await expect(text).toHaveValue("x := 2 mm");
  const saving = pane.waitForEvent("download");
  await command(pane, "Export workspace");
  const accepted = await decodeWorkspace(
    await readFile(await (await saving).path(), "utf8"),
  );
  assert.equal(
    accepted.page.regions.find((r) => r.id === input).text,
    "x := 2 mm",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Renderer buffers Chrome: Python proposals guard Export without implicit execution; refused code stays editable; pane code/text changes reject a slow Open, and valid text finishes through the shared export lifecycle.",
  );
} finally {
  await browser.close();
}
