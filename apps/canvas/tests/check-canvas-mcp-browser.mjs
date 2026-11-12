import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browserOptions } from "../../../scripts/browser.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../../assistant/src/mcp-main.mjs", import.meta.url).pathname],
  env: { ...process.env, MANIFOLD_CANVAS_URL: base },
  stderr: "pipe",
});
const client = new Client({ name: "canvas-browser-test", version: "1" });
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const raw = (name, args = {}) => client.callTool({ name, arguments: args });
const call = async (name, args = {}) => {
  const result = await raw(name, args);
  assert(!result.isError, result.content[0]?.text);
  return JSON.parse(result.content[0].text);
};
try {
  await client.connect(transport);
  const { url } = await call("connect_canvas");
  await page.goto(url);
  const enable = page.getByRole("button", {
    name: "Enable full control",
    exact: true,
  });
  await expect(enable).toBeVisible();
  assert(
    !page.url().includes("token"),
    "private fragment is removed from browser address/history",
  );
  assert(
    (await raw("inspect_workspace")).isError,
    "opening the URL grants no authority",
  );
  await enable.click();
  await expect(
    page.getByText("External agent: connected", { exact: true }),
  ).toBeVisible();
  const initial = await call("inspect_workspace");
  await call("edit_canvas", {
    batch: {
      expectedDocumentId: initial.documentId,
      edits: [
        {
          operation: "createEquation",
          text: "x := 2 mm",
          at: { x: 400, y: 150 },
        },
        {
          operation: "createModel",
          family: "spring",
          as: "spring",
        },
        {
          operation: "setModelInput",
          model: "$spring",
          input: "displacement",
          value: 3,
        },
      ],
    },
  });
  await expect(page.getByLabel("Spring model", { exact: true })).toBeVisible();
  const state = await call("inspect_workspace");
  assert.equal(state.models.length, 1);
  const completion = await call("compute", {
    expectedDocumentId: state.documentId,
    target: state.models[0].requests[0].reference,
  });
  assert.equal(completion.completion.status, "retained");
  assert.equal(completion.completion.receipt.outcome.status, "success");
  assert((await call("inspect_canvas")).attention.viewport.width > 0);
  const image = await raw("look_at_canvas");
  assert(!image.isError, image.content[0]?.text);
  assert.equal(image.content[1].type, "image");
  const latest = await call("inspect_workspace");
  await call("undo", { expectedDocumentId: latest.documentId });
  await expect(page.getByLabel("Spring model", { exact: true })).toHaveCount(0);
  const undone = await call("inspect_workspace");
  await call("redo", { expectedDocumentId: undone.documentId });
  await expect(page.getByLabel("Spring model", { exact: true })).toBeVisible();
  // Human drafts must not be overwritten by external control.
  await page.getByLabel("Write equation or note", { exact: true }).click();
  await page
    .getByLabel("Write an engineering region", { exact: true })
    .fill("unaccepted draft");
  const blocked = await raw("edit_canvas", {
    batch: {
      expectedDocumentId: state.documentId,
      edits: [{ operation: "createNote", text: "must be rejected" }],
    },
  });
  assert(blocked.isError);
  assert.match(blocked.content[0].text, /Finish or cancel/);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Disconnect agent", exact: true })
    .click();
  await expect(enable).toBeVisible();
  assert((await raw("inspect_workspace")).isError);
  await expect(page.getByLabel("Spring model", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "canvas MCP browser: real stdio discovery, explicit opt-in, direct edit, computation, image, shared Undo/Redo, draft guards and revocation passed",
  );
} finally {
  await browser.close();
  await client.close();
  await transport.close();
}
