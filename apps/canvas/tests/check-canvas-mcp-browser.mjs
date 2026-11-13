import { startWriting } from "./browser-workspace.mjs";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browserOptions } from "../../../scripts/browser.mjs";
import { MCP_MUTATIONS } from "../src/regions/mcpProtocol.ts";
import { openHeadlessWorkspace } from "../src/headless.ts";

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
let sessionId;
let replacementClient, replacementTransport;
page.on("pageerror", (error) => errors.push(error.message));
const raw = (name, args = {}) =>
  client.callTool({
    name,
    arguments: {
      ...(MCP_MUTATIONS.includes(name)
        ? { operationId: crypto.randomUUID(), expectedSessionId: sessionId }
        : {}),
      ...args,
    },
  });
const call = async (name, args = {}) => {
  const result = await raw(name, args);
  assert(!result.isError, result.content[0]?.text);
  return JSON.parse(result.content[0].text);
};
const errorCode = (result) => {
  assert(result.isError);
  const { error } = JSON.parse(result.content[0].text);
  assert(error.recovery);
  return error.code;
};
const connectionIndicator = page.getByRole("button", {
  name: "External agent connection",
  exact: true,
});
const connectionPanel = page.getByRole("region", {
  name: "External agent control",
  exact: true,
});
const openDetails = async () => {
  if ((await connectionIndicator.getAttribute("aria-expanded")) !== "true")
    await connectionIndicator.click();
  await expect(connectionPanel).toBeVisible();
};
const disconnect = async () => {
  await openDetails();
  await page
    .getByRole("button", { name: "Disconnect agent", exact: true })
    .click();
  await expect(connectionPanel).toHaveCount(0);
  await expect(connectionIndicator).toHaveAttribute(
    "data-status",
    "disconnected",
  );
  await openDetails();
  await expect(
    page.getByLabel("Agent permissions", { exact: true }),
  ).toBeEnabled();
};
const connect = async (scope) => {
  await page
    .getByLabel("Agent permissions", { exact: true })
    .selectOption(scope);
  const labels = {
    "read-only": "Enable read-only access",
    "proposal-only": "Enable proposals only",
    edit: "Enable edit without compute",
    "full-control": "Enable full control",
  };
  await page.getByRole("button", { name: labels[scope], exact: true }).click();
  await expect(connectionIndicator).toHaveAttribute("data-status", "connected");
  await expect(connectionPanel).toHaveCount(0);
  await expect(connectionIndicator).toHaveAttribute("aria-expanded", "false");
  await expect(connectionIndicator).toBeFocused();
  const connection = await call("connect_canvas");
  sessionId = connection.sessionId;
  assert.equal(connection.scope, scope);
  await openDetails();
  await expect(
    page.getByText(/Client-reported name:.*canvas-browser-test/),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Close agent connection details",
      exact: true,
    })
    .click();
  await expect(connectionPanel).toHaveCount(0);
  assert.equal(
    (await call("connect_canvas")).sessionId,
    sessionId,
    "Closing connection details must not revoke the active grant",
  );
};
try {
  await client.connect(transport);
  const { url } = await call("connect_canvas");
  await page.goto(url);
  await expect(
    page.getByRole("button", { name: "Enable read-only access", exact: true }),
  ).toBeVisible();
  assert(!page.url().includes("token"));
  assert.equal(
    errorCode(await raw("inspect_workspace")),
    "NO_CANVAS_CONNECTED",
  );
  // Dismissing or declining a request never grants authority or leaves a blocking banner.
  await page
    .getByRole("button", {
      name: "Close agent connection details",
      exact: true,
    })
    .click();
  await expect(connectionPanel).toHaveCount(0);
  assert.equal(
    errorCode(await raw("inspect_workspace")),
    "NO_CANVAS_CONNECTED",
  );
  await openDetails();
  await expect(
    page.getByLabel("Agent permissions", { exact: true }),
  ).toHaveValue("read-only");
  await page
    .getByRole("button", { name: "Decline connection", exact: true })
    .click();
  await expect(connectionIndicator).toHaveCount(0);
  assert.equal(
    errorCode(await raw("inspect_workspace")),
    "NO_CANVAS_CONNECTED",
  );
  await page.goto(url);
  await expect(
    page.getByLabel("Agent permissions", { exact: true }),
  ).toHaveValue("read-only");
  await connect("read-only");
  const initial = await call("inspect_workspace");
  // The compact connection controls remain usable on phones without covering the canvas.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await connectionIndicator.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await openDetails();
    const details = await connectionPanel.boundingBox();
    assert(details.x >= 0 && details.x + details.width <= width);
    await connectionPanel.focus();
    await page.keyboard.press("Escape");
    await expect(connectionIndicator).toBeFocused();
    await expect(connectionPanel).toHaveCount(0);
    assert.equal(
      (await call("inspect_workspace")).documentId,
      initial.documentId,
    );
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await openDetails();
  await page.getByLabel("Document title", { exact: true }).click();
  await expect(connectionPanel).toHaveCount(0);
  assert.equal(
    (await call("inspect_workspace")).documentId,
    initial.documentId,
  );
  assert.equal(
    errorCode(await raw("edit_canvas", { batch: {} })),
    "PERMISSION_DENIED",
  );
  assert.equal(
    errorCode(
      await raw("prepare_edit", {
        explanation: "Not allowed",
        batch: {
          expectedDocumentId: initial.documentId,
          edits: [{ operation: "createNote", text: "no" }],
        },
      }),
    ),
    "PERMISSION_DENIED",
  );
  await disconnect();
  await connect("proposal-only");
  const proposed = await call("prepare_edit", {
    explanation: "A note for human review",
    batch: {
      expectedDocumentId: initial.documentId,
      edits: [{ operation: "createNote", text: "Human-approved assumption" }],
    },
  });
  assert.equal(
    errorCode(
      await raw("apply_proposal", {
        id: proposed.id,
        expectedDocumentId: initial.documentId,
      }),
    ),
    "PERMISSION_DENIED",
  );
  assert.equal(
    (await call("inspect_workspace")).documentId,
    initial.documentId,
  );
  await expect(
    page.getByLabel("1 pending agent proposal", { exact: true }),
  ).toBeVisible();
  await expect(connectionPanel).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  const reviewBadgeBounds = await connectionIndicator.boundingBox();
  assert(
    reviewBadgeBounds.x >= 0 &&
      reviewBadgeBounds.x + reviewBadgeBounds.width <= 320,
  );
  await page.setViewportSize({ width: 1440, height: 960 });
  await openDetails();
  const review = page.getByRole("article", {
    name: "External agent proposal",
    exact: true,
  });
  await expect(review).toContainText("A note for human review");
  await review
    .getByText("Review changes and diagnostics", { exact: true })
    .click();
  await expect(review.locator("pre")).toContainText(
    "Human-approved assumption",
  );
  await review
    .getByRole("button", { name: "Apply agent proposal", exact: true })
    .click();
  assert.equal(
    (await call("proposal_status", { id: proposed.id })).status,
    "applied",
  );
  await expect(
    page.getByLabel("1 pending agent proposal", { exact: true }),
  ).toHaveCount(0);
  await disconnect();
  await connect("edit");
  const baseline = await call("inspect_workspace");
  const args = {
    operationId: crypto.randomUUID(),
    expectedSessionId: sessionId,
    batch: {
      expectedDocumentId: baseline.documentId,
      edits: [
        {
          operation: "createEquation",
          text: "x := 2 mm",
          as: "input",
          at: { x: 400, y: 150 },
        },
        {
          operation: "createEquation",
          text: "F = (10 N/mm)*x",
          as: "force",
          at: { x: 400, y: 220 },
        },
        { operation: "createModel", family: "spring", as: "spring" },
        {
          operation: "setModelInput",
          model: "$spring",
          input: "displacement",
          value: 3,
        },
      ],
    },
  };
  const accepted = await call("edit_canvas", args);
  await expect(page.getByLabel("Spring model", { exact: true })).toBeVisible();
  const model = (
    await call("inspect_model", { id: accepted.result.aliases.spring })
  ).model;
  assert.equal(
    errorCode(
      await raw("start_compute", {
        expectedDocumentId: accepted.documentId,
        target: model.requests[0].reference,
      }),
    ),
    "PERMISSION_DENIED",
  );
  assert(
    (
      await call("inspect_dependencies", { id: accepted.result.aliases.force })
    ).nodes.some((node) => node.id === accepted.result.aliases.input),
  );
  assert.equal(
    (await call("inspect_selection", { ids: [accepted.result.aliases.input] }))
      .objects[0].region.text,
    "x := 2 mm",
  );
  assert.equal(
    errorCode(await raw("inspect_equation", { id: "missing" })),
    "ITEM_NOT_FOUND",
  );
  await disconnect();
  await connect("full-control");
  assert.equal(sessionId, args.expectedSessionId);
  assert.deepEqual(
    await call("edit_canvas", args),
    accepted,
    "reconnection does not duplicate accepted work",
  );
  assert.equal(
    (await call("operation_status", { operationId: args.operationId })).status,
    "accepted",
  );
  assert.equal(
    (await call("inspect_workspace", { compact: true })).models.length,
    1,
  );
  assert.equal(
    errorCode(
      await raw("edit_canvas", { ...args, expectedSessionId: "another-tab" }),
    ),
    "RECOVERY_SESSION_CHANGED",
  );
  const started = await call("start_compute", {
    expectedDocumentId: accepted.documentId,
    target: model.requests[0].reference,
  });
  await call("inspect_equation", { id: accepted.result.aliases.input });
  await expect
    .poll(
      async () => (await call("job_status", { jobId: started.jobId })).state,
    )
    .toBe("completed");
  const completion = await call("job_result", { jobId: started.jobId });
  assert.equal(completion.completion.status, "retained");
  assert.equal(completion.completion.receipt.outcome.status, "success");
  await call("cancel_compute", { jobId: started.jobId }); // Already completed is a safe no-op.
  assert((await call("inspect_canvas")).attention.viewport.width > 0);
  const image = await raw("look_at_canvas");
  assert(!image.isError, image.content[0]?.text);
  assert.equal(image.content[1].type, "image");
  const latest = await call("inspect_workspace");
  await call("undo", { expectedDocumentId: latest.documentId });
  await expect(page.getByLabel("Spring model", { exact: true })).toHaveCount(0);
  await call("redo", {
    expectedDocumentId: (await call("inspect_workspace")).documentId,
  });
  await expect(page.getByLabel("Spring model", { exact: true })).toBeVisible();
  await startWriting(page);
  await page
    .getByLabel("Write an engineering region", { exact: true })
    .fill("unaccepted draft");
  assert.equal(
    errorCode(
      await raw("edit_canvas", {
        batch: {
          expectedDocumentId: latest.documentId,
          edits: [{ operation: "createNote", text: "must be rejected" }],
        },
      }),
    ),
    "HUMAN_DRAFT_ACTIVE",
  );
  assert.equal(
    (await call("operation_status", { operationId: args.operationId })).status,
    "accepted",
  );
  await page.keyboard.press("Escape");
  const snapshot = await call("export_workspace", {
    expectedDocumentId: (await call("inspect_workspace")).documentId,
  });
  const chunks = [];
  for (let index = 0; index < snapshot.chunkCount; index++)
    chunks.push(
      (await call("read_export", { snapshotId: snapshot.snapshotId, index }))
        .text,
    );
  const native = chunks.join("");
  assert.equal(new Blob([native]).size, snapshot.byteLength);
  const restored = await openHeadlessWorkspace(native);
  try {
    assert.equal(restored.models().length, 1);
    assert(
      restored
        .worksheet()
        .regions.some((region) => region.text === "Human-approved assumption"),
    );
  } finally {
    restored.dispose();
  }
  await openDetails();
  await page.getByText(/^Agent activity \(/).click();
  await expect(
    page.getByRole("region", { name: "External agent control", exact: true }),
  ).toContainText("canvas-browser-test · edit_canvas · accepted");
  assert(
    (await call("agent_activity")).activity.some(
      (entry) => entry.agent === "canvas-browser-test",
    ),
  );
  await disconnect();
  assert.equal(
    errorCode(await raw("inspect_workspace")),
    "NO_CANVAS_CONNECTED",
  );
  await expect(page.getByLabel("Spring model", { exact: true })).toBeVisible();
  // A replacement MCP process can attach to the same still-open tab without losing recovery.
  replacementTransport = new StdioClientTransport({
    command: process.execPath,
    args: [
      new URL("../../assistant/src/mcp-main.mjs", import.meta.url).pathname,
    ],
    env: { ...process.env, MANIFOLD_CANVAS_URL: base },
    stderr: "pipe",
  });
  replacementClient = new Client({ name: "replacement-agent", version: "1" });
  await replacementClient.connect(replacementTransport);
  const replacementCall = async (name, args = {}) => {
    const result = await replacementClient.callTool({ name, arguments: args });
    assert(!result.isError, result.content[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const replacementUrl = (await replacementCall("connect_canvas")).url;
  await page.goto(replacementUrl);
  await expect(
    page.getByRole("button", { name: "Enable read-only access", exact: true }),
  ).toBeVisible();
  assert(!page.url().includes("token"));
  await page
    .getByRole("button", { name: "Enable read-only access", exact: true })
    .click();
  await expect(connectionIndicator).toHaveAttribute("data-status", "connected");
  await expect(connectionPanel).toHaveCount(0);
  assert.equal((await replacementCall("connect_canvas")).sessionId, sessionId);
  assert.equal(
    (
      await replacementCall("operation_status", {
        operationId: args.operationId,
      })
    ).status,
    "accepted",
  );
  // Reload starts a new recovery lifetime; old mutation guards must mechanically reject replay.
  await page.reload();
  await page.goto(replacementUrl);
  await expect(
    page.getByLabel("Agent permissions", { exact: true }),
  ).toHaveValue("read-only");
  await page
    .getByLabel("Agent permissions", { exact: true })
    .selectOption("full-control");
  await page
    .getByRole("button", { name: "Enable full control", exact: true })
    .click();
  await expect(connectionIndicator).toHaveAttribute("data-status", "connected");
  await expect(connectionPanel).toHaveCount(0);
  assert.notEqual(
    (await replacementCall("connect_canvas")).sessionId,
    sessionId,
  );
  assert.equal(
    (
      await replacementCall("operation_status", {
        operationId: args.operationId,
      })
    ).status,
    "unknown",
  );
  assert.equal(
    errorCode(
      await replacementClient.callTool({
        name: "edit_canvas",
        arguments: args,
      }),
    ),
    "RECOVERY_SESSION_CHANGED",
  );
  assert.deepEqual(errors, []);
  console.log(
    "canvas MCP browser: four scopes, human approval, focused reads, stable recovery across reconnect, async jobs, activity, native export, shared history and draft/revocation guards passed",
  );
} finally {
  await browser.close();
  await client.close();
  await transport.close();
  await replacementClient?.close();
  await replacementTransport?.close();
}
