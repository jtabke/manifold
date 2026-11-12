import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "../../../apps/canvas/tests/browser-evidence.mjs";
/** Repository Chrome workflow: exercise real controls, native files and IndexedDB; no debug globals. */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as f from "../src/index.ts";
import * as d from "../workbench/composition-demo.ts";
const root = fileURLToPath(new URL("../../..", import.meta.url)),
  port = 58319,
  url = "http://127.0.0.1:" + port;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "packages/foundation/vite.config.mjs",
    "--port",
    String(port),
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "",
  browser;
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (c) => (log += c));
const dir = await mkdtemp(join(tmpdir(), "manifold-models-browser-")),
  store = "manifold-foundation-composition-test-" + randomUUID(),
  checks = [],
  errors = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch(url + "/composition.html")).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, log);
  browser = await chromium.launch({ ...browserOptions(), headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => {
    errors.push(e.message);
    process.stderr.write(e.stack + "\n");
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(url + "/composition.html?store=" + store);
  await expect(page.locator("#message")).toHaveText(
    "Independent models ready.",
  );
  await expect(page.locator("#force-A")).toHaveText("10 N");
  await expect(page.locator("#force-B")).toHaveText("20 N");
  await expect(page.locator("#force-C")).toContainText("missing");
  await expect(page.locator("#nested")).toHaveText(
    "left / k = 10 N/mm · right / k = 20 N/mm",
  );
  await expect(page.locator("#force-pair")).toHaveText("30 N");
  checks.push(
    "shared and nested definitions resolve independent full-path local values without expanded item copies",
  );
  await button("Publish spring revision").click();
  await expect(page.locator("#message")).toContainText(
    "Existing instances keep",
  );
  await expect(page.locator("#force-A")).toHaveText("10 N");
  await button("Review A model update").click();
  await expect(page.locator("#review-detail")).toContainText(
    "A force: 10 N → 20 N",
  );
  await button("Apply reviewed change").click();
  await expect(page.locator("#force-A")).toHaveText("20 N");
  await expect(page.locator("#revision-B")).toHaveText(
    "Definition · spring-v1",
  );
  await button("Undo").click();
  await expect(page.locator("#revision-A")).toHaveText(
    "Definition · spring-v1",
  );
  await expect(page.locator("#force-A")).toHaveText("10 N");
  checks.push(
    "template publication preserves pins; reviewed single-instance update previews numerical change; Undo restores selection",
  );
  await page.getByLabel("A displacement · mm", { exact: true }).fill("3");
  await button("Apply A input").click();
  await expect(page.locator("#force-A")).toHaveText("30 N");
  await expect(page.locator("#force-B")).toHaveText("20 N");
  await button("Compute A pressure").click();
  await expect(page.locator("#result-A")).toHaveText("0.012 MPa · current");
  await button("Review connection").click();
  await expect(page.locator("#review-detail")).toContainText(
    "A / force → C / load",
  );
  await expect(page.locator("#review-detail")).toContainText('"unit":"N"');
  await button("Apply reviewed change").click();
  await expect(page.locator("#force-C")).toHaveText("60 N");
  await button("Compute C pressure").click();
  await expect(page.locator("#result-C")).toHaveText("0.024 MPa · current");
  checks.push(
    "independent accepted instance input propagates only through explicit public-port binding and explicit computations",
  );
  await page.getByLabel("C load source").selectOption("B");
  await button("Review connection").click();
  await button("Accept source revision").click();
  await expect(page.locator("#result-A")).toHaveText("Ready to compute");
  await expect(page.locator("#force-A")).toHaveText("30 N");
  await button("Apply reviewed change").click();
  await expect(page.locator("#message")).toContainText("Stale");
  await expect(page.locator("#force-C")).toHaveText("60 N");
  await button("Cancel review").click();
  await button("Compute A pressure").click();
  await expect(page.locator("#result-A")).toHaveText("0.012 MPa · current");
  checks.push(
    "same-valued source revisions invalidate current receipts through provenance; stale connection reviews reject atomically",
  );
  await button("Preview A input").click();
  await button("Compute alternative").click();
  await expect(page.locator("#preview-result")).toHaveText(
    "0.008 MPa · current",
  );
  await button("Keep alternative").click();
  await page.getByLabel("A source stiffness · N/mm").fill("12");
  await button("Accept source revision").click();
  await button("Compute A pressure").click();
  await expect(page.locator("#result-A")).toHaveText("0.0144 MPa · current");
  await expect(page.locator("#alternatives")).toContainText(
    "0.008 MPa · current",
  );
  await expect(page.locator("#force-B")).toHaveText("20 N");
  checks.push(
    "kept alternative retains exact model/input/transitive source selection while baseline changes independently",
  );
  const source = join(dir, "new-source.json");
  await writeFile(source, "[[40],[25]]");
  await page
    .getByLabel("Replace B table · JSON numeric rows")
    .setInputFiles(source);
  await expect(page.locator("#force-B")).toContainText("ambiguous");
  await button("Review B source rebind").click();
  await expect(page.locator("#review-detail")).toContainText('"value":40');
  await button("Apply reviewed change").click();
  await expect(page.locator("#force-B")).toHaveText("40 N");
  await button("Compute B pressure").click();
  await expect(page.locator("#result-B")).toHaveText("0.016 MPa · current");
  checks.push(
    "actual table import rejects implicit selector continuity; reviewed row rebind updates only B",
  );
  await button("Compute C pressure").click();
  await expect(page.locator("#result-C")).toHaveText("0.0288 MPa · current");
  await button("Review unused history").click();
  await button("Apply history cleanup").click();
  await expect(page.locator("#alternatives")).toContainText(
    "0.008 MPa · current",
  );
  await button("Save locally").click();
  await expect(page.locator("#saved")).toHaveText("Saved locally");
  await page.reload();
  await expect(page.locator("#message")).toContainText(
    "Verified local save reopened",
  );
  await expect(page.locator("#result-A")).toHaveText("0.0144 MPa · current");
  await expect(page.locator("#result-C")).toHaveText("0.0288 MPa · current");
  await expect(page.locator("#alternatives")).toContainText(
    "0.008 MPa · current",
  );
  await expect(page.locator("#counters")).toContainText(
    "0 external executions",
  );
  checks.push(
    "reviewed cleanup and IndexedDB save/reload preserve composed receipts and frozen alternatives without jobs",
  );
  const downloadPromise = page.waitForEvent("download");
  await button("Download work").click();
  const download = await downloadPromise,
    path = join(dir, "models.manifold");
  await download.saveAs(path);
  const text = await readFile(path, "utf8");
  assert.equal(JSON.parse(text).version, 3);
  const loaded = await f.decode(text, d.schemas, d.methods, f.webHash);
  assert(
    loaded.receipts.some(
      (r) => r.snapshot.inputs.force.dependencies?.length > 0,
    ),
  );
  const recipientContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    recipient = await recipientContext.newPage();
  recipient.on("pageerror", (e) => errors.push(e.message));
  await recipient.goto(url + "/composition.html?store=" + store + "-recipient");
  await expect(recipient.locator("#message")).toHaveText(
    "Independent models ready.",
  );
  await recipient.getByLabel("Open work", { exact: true }).setInputFiles(path);
  await expect(recipient.locator("#message")).toContainText(
    "Portable work opened",
  );
  await expect(recipient.locator("#result-A")).toHaveText(
    "0.0144 MPa · current",
  );
  await expect(recipient.locator("#force-B")).toHaveText("40 N");
  await expect(recipient.locator("#alternatives")).toContainText(
    "0.008 MPa · current",
  );
  await expect(recipient.locator("#counters")).toContainText(
    "0 external executions",
  );
  checks.push(
    "native v3 download decodes independently and opens in a fresh browser context with all values/provenance and no jobs",
  );
  const qa = join(root, ".manifold/foundation-qa");
  await captureEvidence(page, {
    path: join(qa, "composition-desktop.png"),
    fullPage: true,
  });
  await captureEvidence(recipient, {
    path: join(qa, "composition-mobile.png"),
    fullPage: true,
  });
  for (const width of [320, 390, 1440]) {
    await recipient.setViewportSize({ width, height: 900 });
    assert.equal(
      await recipient.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await recipient
    .getByRole("button", { name: "Compute A pressure", exact: true })
    .focus();
  await recipient.keyboard.press("Enter");
  await expect(recipient.locator("#counters")).toContainText(
    "1 external executions",
  );
  checks.push(
    "real keyboard computation and no horizontal overflow at 320/390/1440 px",
  );
  assert.deepEqual(errors, []);
  const report = {
    date: new Date().toISOString(),
    sourceDigest: execFileSync(
      process.execPath,
      ["packages/foundation/test/source-digest.mjs"],
      { cwd: root, encoding: "utf8" },
    ).trim(),
    browser: await browser.version(),
    checks,
    pageErrors: errors,
  };
  await mkdir(
    new URL("../../../evidence/current/foundation/", import.meta.url),
    { recursive: true },
  );
  await writeFile(
    new URL(
      "../../../evidence/current/foundation/composition-browser-results.json",
      import.meta.url,
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await rm(dir, { recursive: true, force: true });
}
