import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { browserOptions } from "../../../scripts/browser.mjs";

const base = new URL(process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310");
const browser = await chromium.launch({ ...browserOptions(), headless: true });
const client = new Client({ name: "unlisted-mcp-client", version: "1" });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const response = await page.request.get(
    new URL("/api/agent-setup", base).href,
  );
  assert(response.ok());
  const realSetup = await response.json();
  assert(
    realSetup.mcp.command,
    "The browser suite runs with a local Node executable",
  );
  let lookups = 0;
  let piRequests = 0;
  let discovery = {
    shell: "posix",
    agents: { claude: "/tools/claude", codex: null },
    mcp: {
      command: "/tools/node",
      args: ["/source/manifold/apps/assistant/src/mcp-main.mjs"],
    },
  };
  await page.route("**/api/agent-setup", (route) => {
    lookups++;
    return discovery
      ? route.fulfill({ json: discovery })
      : route.fulfill({ status: 503 });
  });
  await page.route("**/api/assistant/**", (route) => {
    piRequests++;
    return route.abort();
  });
  const canvas = new URL("/?agent-setup-test=1", base);
  await page.goto(canvas.href);
  const askAgent = page.getByRole("button", { name: "Ask agent", exact: true });
  const external = page.getByRole("button", {
    name: "Connect an external agent",
    exact: true,
  });
  const setup = page.getByRole("dialog", {
    name: "Connect an external agent",
    exact: true,
  });
  const openSetup = async () => {
    await askAgent.click();
    await external.click();
    await expect(setup).toBeFocused();
  };
  await askAgent.press("Enter");
  await expect(
    page.getByRole("button", { name: "Use built-in Pi", exact: true }),
  ).toBeVisible();
  assert.equal(
    lookups,
    0,
    "Discovery must not run before the external setup opens",
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(external).toBeFocused();
  await external.press("Enter");
  await expect(setup).toBeFocused();
  const picker = setup.getByLabel("External agent", { exact: true });
  const command = page.getByRole("textbox", { name: "Setup command" });
  const indicator = page.getByRole("button", {
    name: "External agent connection",
    exact: true,
  });
  await expect(picker).toHaveValue("claude");
  await expect(
    setup.getByText(
      "Claude Code detected on PATH. Sign-in has not been checked.",
    ),
  ).toBeVisible();
  await expect(command).toHaveValue(
    /^'\/tools\/claude' mcp add --env '.+' --transport stdio --scope local manifold -- /,
  );
  assert.equal(lookups, 1);
  await setup.getByRole("button", { name: "Copy setup command" }).click();
  await expect(
    setup.getByText("Setup instructions copied. Finish setup in your client."),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    await command.inputValue(),
  );
  await expect(indicator).toHaveCount(0);

  await picker.selectOption("codex");
  await expect(
    setup.getByText("Setup instructions copied.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Codex was not found on the local server’s PATH/),
  ).toBeVisible();
  await expect(command).toHaveCount(0);
  await page
    .getByLabel("Executable path", { exact: true })
    .fill("relative/path");
  await expect(
    page.getByText(/Enter an absolute executable path/),
  ).toBeVisible();
  await page
    .getByLabel("Executable path", { exact: true })
    .fill("/other dir/Codex's CLI");
  await expect(command).toHaveValue(
    new RegExp(String.raw`^'/other dir/Codex'\\''s CLI' mcp add --env `),
  );
  await page.getByLabel("Executable path", { exact: true }).clear();

  const refresh = page.getByRole("button", {
    name: "Refresh installed agents",
  });
  discovery.agents.codex = "/new/path/codex";
  await refresh.click();
  await expect(
    setup.getByText("Codex detected on PATH. Sign-in has not been checked."),
  ).toBeVisible();
  assert.equal(lookups, 2);
  await picker.selectOption("other");
  discovery = null;
  await refresh.click();
  await expect(page.getByText(/Local discovery is unavailable/)).toBeVisible();
  await expect(
    page.getByText("manifold mcp-config", { exact: true }),
  ).toBeVisible();

  discovery = realSetup;
  await refresh.click();
  const generic = page.getByRole("textbox", { name: "MCP configuration" });
  await expect(generic).toBeVisible();
  const {
    command: node,
    args,
    env,
  } = JSON.parse(await generic.inputValue()).mcpServers.manifold;
  assert.equal(node, realSetup.mcp.command);
  assert.deepEqual(args, realSetup.mcp.args);
  assert.deepEqual(env, { MANIFOLD_CANVAS_URL: `${base.origin}/` });
  const transport = new StdioClientTransport({
    command: node,
    args,
    env: { ...process.env, ...env },
    stderr: "pipe",
  });
  await client.connect(transport);
  const call = (name) => client.callTool({ name, arguments: {} });
  const link = JSON.parse((await call("connect_canvas")).content[0].text).url;
  const linkInput = setup.getByLabel("Private canvas connection link");
  const permissionPanel = page.getByRole("region", {
    name: "External agent control",
  });
  const grant = permissionPanel.getByRole("button", {
    name: "Enable read-only access",
    exact: true,
  });
  const review = setup.getByRole("button", {
    name: "Review agent permissions",
  });
  const historyLength = await page.evaluate(() => history.length);
  await linkInput.fill("not a connection link");
  await review.click();
  await expect(setup.getByRole("alert")).toHaveText(
    "Paste the full private link returned by connect_canvas.",
  );
  await expect(linkInput).toBeFocused();
  const wrongOrigin = new URL(link);
  wrongOrigin.hostname =
    wrongOrigin.hostname === "localhost" ? "127.0.0.1" : "localhost";
  await linkInput.fill(wrongOrigin.href);
  await review.click();
  await expect(setup.getByRole("alert")).toContainText(
    "a different Manifold address",
  );
  await expect(setup.getByRole("alert")).toContainText(`to ${base.origin}/`);
  await expect(indicator).toHaveCount(0);

  // A syntactically valid request is not proof the client will accept the connection.
  const invalid = new URL(link);
  const fragment = new URLSearchParams(invalid.hash.slice(1));
  const endpoint = new URL(fragment.get("mcp"));
  endpoint.searchParams.set("token", "0".repeat(64));
  fragment.set("mcp", endpoint.href);
  invalid.hash = fragment.toString();
  await linkInput.fill(invalid.href);
  await review.click();
  await expect(
    permissionPanel.getByText("Connection requested", { exact: true }),
  ).toBeVisible();
  await grant.click();
  await expect(permissionPanel.getByRole("alert")).toContainText(
    "call connect_canvas again",
  );
  await expect(indicator).toHaveAttribute("data-status", "connection failed");

  await openSetup();
  await linkInput.fill(link);
  await linkInput.press("Enter");
  await expect(setup).toHaveCount(0);
  await expect(permissionPanel).toBeFocused();
  await expect(
    permissionPanel.getByText("Connection requested", { exact: true }),
  ).toBeVisible();
  await expect(
    permissionPanel.getByText(/No access until you enable it/),
  ).toBeVisible();
  await expect(
    permissionPanel.getByLabel("Agent permissions", { exact: true }),
  ).toHaveValue("read-only");
  await expect(page).toHaveURL(canvas.href);
  assert.equal(
    await page.evaluate(() => history.length),
    historyLength,
    "Pasted token must not create a history entry",
  );
  const before = await call("inspect_workspace");
  assert(before.isError);
  assert.equal(
    JSON.parse(before.content[0].text).error.code,
    "NO_CANVAS_CONNECTED",
  );
  await grant.click();
  await expect(indicator).toHaveAttribute("data-status", "connected");
  await expect(indicator.locator(".er-mcp-indicator-label")).toHaveText(
    "Connected · Read-only access",
  );
  assert.equal(
    JSON.parse((await call("connect_canvas")).content[0].text).scope,
    "read-only",
  );
  assert(!(await call("inspect_workspace")).isError);
  await page.setViewportSize({ width: 390, height: 700 });
  await openSetup();
  const bounds = await setup.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert(bounds.y >= 0 && bounds.y + bounds.height <= 700);
  await page.keyboard.press("Escape");
  await expect(setup).toHaveCount(0);
  await expect(askAgent).toBeFocused();
  assert(!(await call("inspect_workspace")).isError);
  assert.equal(piRequests, 0, "External setup must not mount or configure Pi");
  console.log(
    "External agent setup: independent keyboard entry, detection, copy, override, generic stdio, handoff recovery, and read-only scope confirmation pass.",
  );
} finally {
  await client.close();
  await browser.close();
}
