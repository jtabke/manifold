/** Real development-session acceptance: proxy, frontend HMR, Python reload, cleanup. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { browserOptions } from "./browser.mjs";
import { root, assertPortFree } from "./dev-config.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(predicate, detail) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw Error(`Timed out waiting for ${detail}`);
}
const apiPort = await freePort(),
  devPort = await freePort();
const id = randomUUID().replaceAll("-", "");
const modulePath = join(root, `apps/canvas/src/dx_probe_${id}.ts`);
const pythonPath = join(root, `apps/canvas/dx_probe_${id}.py`);
const moduleSource = (value) => `
export const value = ${value};
window.__dxValue = value;
if (import.meta.hot) import.meta.hot.accept((next) => { if (next) window.__dxValue = next.value; });
`;
let browser,
  output = "",
  result;
await writeFile(modulePath, moduleSource(1));
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    MANIFOLD_API_PORT: String(apiPort),
    MANIFOLD_DEV_PORT: String(devPort),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => {
  output += data;
});
child.stderr.on("data", (data) => {
  output += data;
});
const done = new Promise((resolve) =>
  child.once("close", (code, signal) => {
    result = { code, signal };
    resolve(result);
  }),
);
try {
  await until(
    () => output.includes("Manifold development:") || result,
    "development startup",
  );
  assert.equal(result, undefined, output);
  browser = await chromium.launch({ ...browserOptions(), headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${devPort}/`);
  assert.match(await page.title(), /^Manifold(?:\s|$)/);
  const health = await page.evaluate(() =>
    fetch("/api/health").then((response) => response.json()),
  );
  assert.equal(
    health.status,
    "ready",
    "Vite proxies to the selected backend port",
  );
  await page.evaluate((path) => import(path), `/src/dx_probe_${id}.ts`);
  await page.waitForFunction(() => window.__dxValue === 1);
  await page.evaluate(() => {
    window.__dxNavigationMarker = "retained";
  });
  await writeFile(modulePath, moduleSource(2));
  await page.waitForFunction(() => window.__dxValue === 2);
  assert.equal(
    await page.evaluate(() => window.__dxNavigationMarker),
    "retained",
    "HMR does not reload the page",
  );
  await writeFile(pythonPath, "# Owned development reload acceptance probe.\n");
  await until(
    () => output.includes("Backend ready.") || result,
    "Python restart",
  );
  assert.equal(result, undefined, output);
  const after = await page.evaluate(() =>
    fetch("/api/health").then((response) => response.json()),
  );
  assert.equal(after.status, "ready");
  assert.equal(
    await page.evaluate(() => window.__dxNavigationMarker),
    "retained",
    "Python restart leaves frontend running",
  );
  console.log(
    "Development browser acceptance passed: real HMR, API proxy and Python restart.",
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  const deadline = setTimeout(() => child.kill("SIGKILL"), 12000);
  await done;
  clearTimeout(deadline);
  await Promise.all([
    rm(modulePath, { force: true }),
    rm(pythonPath, { force: true }),
  ]);
}
assert.equal(result.code, 0, output);
await assertPortFree(apiPort);
await assertPortFree(devPort);
console.log("Development session stopped cleanly; both ports released.");
