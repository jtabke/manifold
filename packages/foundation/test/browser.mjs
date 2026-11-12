import { browserOptions } from "../../../scripts/browser.mjs";
import { captureEvidence } from "../../../apps/canvas/tests/browser-evidence.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { typedBrowserProbe } from "./typed-browser-probe.mjs";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../..", import.meta.url)),
  port = 58318,
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
for (const s of [server.stdout, server.stderr]) s.on("data", (c) => (log += c));
const dir = await mkdtemp(join(tmpdir(), "manifold-foundation-browser-")),
  store = "manifold-foundation-test-" + randomUUID(),
  checks = [],
  errors = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw Error(log);
    try {
      ready = (await fetch(url)).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, log);
  browser = await chromium.launch({ ...browserOptions(), headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true }),
    diag = () => page.evaluate(() => window.foundationDiagnostics());
  await page.goto(url + "/?store=" + store);
  await expect(page.locator("#message")).toContainText("Work is ready");
  await page.getByLabel("Thought or equation").fill("F = still thinking");
  await button("Keep thought").click();
  await page
    .getByLabel("Another note")
    .fill("Check area source before drawing conclusions.");
  await button("Add note").click();
  await expect(page.locator("#notes")).toContainText("Check area source");
  await button("Connect observation").click();
  await expect(page.locator("#connections")).toContainText(
    "remain separate records",
  );
  checks.push(
    "Create incomplete thought, add independent note/view and explicitly connect distinct values",
  );
  await button("Compute baseline").click();
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.04 MPa · current",
  );
  await button("Compute required force").click();
  await expect(page.locator("#inverse-result")).toContainText(
    "200 N · current",
  );
  checks.push(
    "two external method definitions share the same execution lifecycle",
  );
  const initial = await diag();
  await button("Preview").click();
  assert.equal((await diag()).stamp.root, initial.stamp.root);
  await button("Compute preview").click();
  await expect(page.locator("#preview-result")).toHaveText(
    "0.08 MPa · current",
  );
  await button("Cancel preview").click();
  assert.equal((await diag()).stamp.root, initial.stamp.root);
  assert.equal((await diag()).undoSteps, initial.undoSteps);
  assert.equal((await diag()).alternatives, 0);
  checks.push(
    "Preview/Compute/Cancel preserves baseline and authors no alternative or Undo step",
  );
  await button("Preview").click();
  await button("Compute preview").click();
  await expect(page.locator("#preview-result")).toHaveText(
    "0.08 MPa · current",
  );
  await button("Keep alternative").click();
  await expect(page.locator("#alternatives")).toContainText("Higher load");
  await expect(page.locator("#alternatives .result-value")).toHaveText(
    "0.08 MPa · current",
  );
  const kept = await diag();
  assert.equal(kept.alternatives, 1);
  await page
    .getByLabel("Thought or equation")
    .fill("a separate draft still being typed");
  await page.getByLabel("Applied force · N").fill("300");
  await button("Apply force").click();
  await expect(page.getByLabel("Thought or equation")).toHaveValue(
    "a separate draft still being typed",
  );
  await button("Compute baseline").click();
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.12 MPa · current",
  );
  await expect(page.locator("#alternatives .result-value")).toHaveText(
    "0.08 MPa · current",
  );
  checks.push(
    "Keep pins complete input/source selection and comparison; baseline edits preserve alternative and typing",
  );
  await button("Undo").click();
  await expect(page.getByLabel("Applied force · N")).toHaveValue("100");
  await expect(page.getByLabel("Thought or equation")).toHaveValue(
    "a separate draft still being typed",
  );
  await button("Undo").click();
  await expect(page.locator("#alternative-count")).toHaveText("0");
  assert.equal((await diag()).alternatives, 0);
  checks.push(
    "Undo restores baseline and removes alternative/comparison together while preserving unrelated draft buffer",
  );
  // A layout edit may occur while a preview is active; it must not make Keep stale.
  await button("Preview").click();
  await page
    .getByText("Inspect evidence and recovery", { exact: true })
    .click();
  const beforeMove = await diag();
  await button("Move note view").click();
  assert.equal(
    (await diag()).calculationRenders,
    beforeMove.calculationRenders,
  );
  await button("Compute preview").click();
  await expect(page.locator("#preview-result")).toHaveText(
    "0.08 MPa · current",
  );
  await button("Keep alternative").click();
  checks.push(
    "view movement does not invalidate computations or a coherent preview",
  );
  await page.getByLabel("Applied force · N").fill("300");
  await button("Apply force").click();
  const source = join(dir, "area.json");
  await writeFile(source, "[[5000]]");
  await page.getByText("Replace the area source", { exact: true }).click();
  await page.getByLabel("Reimport area and rebind · mm²").setInputFiles(source);
  await expect(page.locator("#message")).toContainText("explicitly rebound");
  await button("Compute baseline").click();
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  await expect(page.locator("#alternatives .result-value")).toHaveText(
    "0.08 MPa · current",
  );
  checks.push(
    "real source-file reimport/rebind updates baseline while alternative retains original source bytes",
  );
  await button("Make source unavailable").click();
  await expect(page.locator("#baseline-result")).toContainText("Unresolved");
  await expect(page.locator("#alternatives .result-value")).toContainText(
    "Unresolved",
  );
  await button("Restore source access").click();
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  checks.push(
    "missing source cannot borrow retained evidence for baseline or alternative",
  );
  // A delayed preview can be kept before completion, then stay independent of later edits.
  await page.getByLabel("Next execution").selectOption("hold");
  await page.getByLabel("Preview force · N").fill("400");
  await button("Preview").click();
  await page.getByLabel("Name this alternative").fill("Another load");
  await button("Compute preview").click();
  await expect(page.locator("#preview-result")).toContainText("Computing");
  await button("Keep alternative").click();
  await page.getByLabel("Applied force · N").fill("500");
  await button("Apply force").click();
  await button("Release held jobs").click();
  await expect(
    page
      .locator("#alternatives")
      .getByText("0.08 MPa · current", { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator("#baseline-result")).toHaveText("Ready to compute");
  checks.push(
    "held preview completion stays current for kept context after baseline changes",
  );
  await page.getByLabel("Next execution").selectOption("normal");
  await page.getByLabel("Applied force · N").fill("300");
  await button("Apply force").click();
  await button("Compute baseline").click();
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  await button("Save locally").click();
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  await button("Move note view").click();
  await button("Save locally").click();
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  const saved = await diag();
  assert.equal(saved.lastSave.mode, "incremental");
  assert(saved.lastSave.writes.chunks <= 5);
  assert.equal(saved.lastSave.writes.assets, 0);
  checks.push(
    "local view Save writes only changed branches and preserves source bytes",
  );
  await button("Save locally").click();
  await expect(page.locator("#message")).toHaveText("Work saved locally.");
  await expect.poll(async () => (await diag()).lastSave.plannedChunks).toBe(1);
  assert.equal((await diag()).lastSave.writes.chunks, 0);
  assert.equal((await diag()).lastSave.writes.assets, 0);
  checks.push(
    "unchanged local Save reuses committed branches and writes no chunks or source bytes",
  );
  await page.reload();
  await expect(page.locator("#message")).toHaveText(
    "Local work restored. No jobs were started.",
  );
  const restored = await diag();
  assert.equal(restored.activeJobs, 0);
  assert.equal(restored.alternatives, saved.alternatives);
  assert.equal(restored.receipts, saved.receipts);
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  await button("Save locally").click();
  await expect(page.locator("#message")).toHaveText("Work saved locally.");
  await expect.poll(async () => (await diag()).lastSave?.plannedChunks).toBe(1);
  assert.equal((await diag()).lastSave.writes.chunks, 0);
  assert.equal((await diag()).lastSave.writes.assets, 0);
  await page
    .getByText("Inspect evidence and recovery", { exact: true })
    .click();
  await button("Move note view").click();
  await button("Save locally").click();
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  const afterResumeView = await diag();
  assert(
    afterResumeView.lastSave.plannedChunks <=
      Math.ceil(2 * Math.log2(afterResumeView.views + 1)) + 2,
  );
  assert.equal(afterResumeView.lastSave.writes.assets, 0);
  checks.push(
    "fresh reload preserves first-save branch reuse and writes only a subsequent view change",
  );
  await page.addInitScript(() => {
    const original = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      if (window.foundationDiagnostics && !window.restoreHeld) {
        window.restoreHeld = true;
        await new Promise((resolve) => (window.releaseRestore = resolve));
      }
      return original(...args);
    };
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.restoreHeld)).toBe(true);
  await page
    .getByLabel("Thought or equation")
    .fill("typing during local restoration");
  await page.evaluate(() => window.releaseRestore());
  await expect(page.locator("#message")).toContainText(
    "Draft changed while opening",
  );
  await expect(page.getByLabel("Thought or equation")).toHaveValue(
    "typing during local restoration",
  );
  await button("Reopen local save").click();
  await expect(page.locator("#message")).toContainText("Local save reopened");
  assert.equal((await diag()).alternatives, saved.alternatives);
  assert.equal((await diag()).receipts, saved.receipts);
  await page
    .getByText("Inspect evidence and recovery", { exact: true })
    .click();
  checks.push(
    "reload restores verified work without jobs; delayed restoration preserves fresh typing",
  );
  await page
    .getByLabel("Thought or equation")
    .fill("accepted after saved snapshot");
  await button("Keep thought").click();
  const unsaved = await diag();
  for (const fault of ["after-assets", "after-package", "before-publish"]) {
    await page.getByLabel("Interrupt next save").selectOption(fault);
    await button("Save locally").click();
    await expect(page.locator("#message")).toContainText(
      fault === "before-publish"
        ? "Aborted head transaction"
        : "Interrupted after",
    );
    assert.deepEqual((await diag()).stamp, unsaved.stamp);
    await expect(page.locator("#saved-state")).toHaveText("Unsaved");
  }
  await page.getByLabel("Interrupt next save").selectOption("none");
  await button("Reopen local save").click();
  await expect(page.locator("#message")).toContainText("No jobs were started");
  assert.equal((await diag()).alternatives, saved.alternatives);
  await expect(page.getByLabel("Thought or equation")).toHaveValue(
    "a separate draft still being typed",
  );
  checks.push(
    "all three real IndexedDB interruptions preserve saved alternatives, views, drafts and sources",
  );
  // Result arrival can make Save stale without changing the authored root.
  await page.getByLabel("Next execution").selectOption("hold");
  await button("Compute baseline").click();
  await page.getByLabel("Hold next save before publication").check();
  await button("Save locally").click();
  await expect(page.locator("#message")).toContainText("Save staged and held");
  const capture = await diag();
  await button("Release held jobs").click();
  await expect.poll(async () => (await diag()).activeJobs).toBe(0);
  const arrived = await diag();
  assert.equal(arrived.stamp.root, capture.stamp.root);
  assert.equal(arrived.stamp.evidence, capture.stamp.evidence + 1);
  await button("Release held save").click();
  await expect(page.locator("#message")).toContainText(
    "Newer changes remain unsaved",
  );
  await expect(page.locator("#saved-state")).toHaveText("Unsaved");
  await button("Save locally").click();
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  checks.push(
    "Save ACK includes evidence version independently of authored root",
  );
  const cited = await page
    .locator("#evidence li")
    .last()
    .getAttribute("data-receipt-id");
  await page
    .getByRole("button", { name: "Keep this result", exact: true })
    .last()
    .click();
  await expect(page.locator("#notes")).toContainText("Recorded");
  await page
    .getByLabel("Recorded attempts to retain")
    .selectOption("reachable");
  const beforeReview = await diag();
  await button("Review cleanup").click();
  await expect(page.locator("#cleanup-review")).toContainText("Before:");
  assert.deepEqual((await diag()).stamp, beforeReview.stamp);
  await page.getByLabel("Applied force · N").fill("300");
  await button("Apply force").click();
  await expect(button("Apply reviewed cleanup")).toBeDisabled();
  await page.getByLabel("Next execution").selectOption("normal");
  await button("Compute baseline").click();
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  await button("Review cleanup").click();
  const beforeCleanup = await diag();
  await button("Apply reviewed cleanup").click();
  await expect(page.locator("#message")).toContainText(
    "Reviewed cleanup applied",
  );
  const afterCleanup = await diag();
  assert.ok(afterCleanup.receipts < beforeCleanup.receipts);
  assert.equal(afterCleanup.undoSteps, beforeCleanup.undoSteps);
  assert.equal(afterCleanup.stamp.evidence, beforeCleanup.stamp.evidence + 1);
  await expect(page.locator(`li[data-receipt-id="${cited}"]`)).toHaveCount(1);
  await expect(page.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  await expect(page.locator("#alternatives .result-value")).toHaveText([
    "0.08 MPa · current",
    "0.08 MPa · current",
  ]);
  await expect(page.locator("#saved-state")).toHaveText("Unsaved");
  await button("Save locally").click();
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  checks.push(
    "reviewed compaction preserves cited results, current comparisons and Undo while removing obsolete attempts",
  );
  await button("Review saved storage").click();
  await expect(page.locator("#storage-review")).toContainText("Saved storage:");
  await button("Move note view").click();
  await button("Save locally").click();
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  await expect(button("Reclaim obsolete saved data")).toBeDisabled();
  await button("Review saved storage").click();
  await expect(button("Reclaim obsolete saved data")).toBeEnabled();
  const beforeStorage = await diag();
  await button("Reclaim obsolete saved data").click();
  await expect(page.locator("#message")).toContainText(
    "Saved storage reclaimed",
  );
  const afterStorage = await diag();
  assert(afterStorage.lastReclamation.reclaimedBytes > 0);
  assert.deepEqual(afterStorage.stamp, beforeStorage.stamp);
  assert.equal(afterStorage.undoSteps, beforeStorage.undoSteps);
  assert.deepEqual(afterStorage.comparison, beforeStorage.comparison);
  await expect(page.locator("#saved-state")).toHaveText("Saved locally");
  await button("Save locally").click();
  await expect(page.locator("#message")).toHaveText("Work saved locally.");
  assert.equal((await diag()).lastSave.writes.chunks, 0);
  assert.equal((await diag()).lastSave.writes.assets, 0);
  checks.push(
    "reviewed saved-storage reclamation preserves current work, Undo, comparisons and the saved root; Save invalidates stale reviews",
  );
  const downloadEvent = page.waitForEvent("download");
  await button("Download work").click();
  const download = await downloadEvent,
    path = join(dir, "work.manifold");
  await download.saveAs(path);
  const native = await readFile(path, "utf8");
  assert.equal(Object.keys(JSON.parse(native).assets).length, 2);
  const fresh = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    recipient = await fresh.newPage();
  recipient.on("pageerror", (e) => errors.push(e.message));
  await recipient.goto(
    url + "/?store=manifold-foundation-recipient-" + randomUUID(),
  );
  await expect(recipient.locator("#message")).toContainText("Work is ready");
  await recipient.locator("#open").setInputFiles(path);
  await expect(recipient.locator("#message")).toContainText(
    "No jobs were started",
  );
  const imported = await recipient.evaluate(() =>
    window.foundationDiagnostics(),
  );
  assert.equal(imported.activeJobs, 0);
  assert.equal(imported.alternatives, 2);
  assert.equal(imported.receipts, (await diag()).receipts);
  await expect(recipient.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  await expect(recipient.locator("#alternatives .result-value")).toHaveText([
    "0.08 MPa · current",
    "0.08 MPa · current",
  ]);
  checks.push(
    "download and fresh-browser file upload preserve complete alternative/source/evidence closure without execution",
  );
  const bad = JSON.parse(native);
  bad.document.alternatives[
    Object.keys(bad.document.alternatives)[0]
  ].context.heads.force = "missing";
  const badPath = join(dir, "corrupt.manifold");
  await writeFile(badPath, JSON.stringify(bad));
  const beforeBad = await recipient.evaluate(() =>
    window.foundationDiagnostics(),
  );
  await recipient.locator("#open").setInputFiles(badPath);
  await expect(recipient.locator("#message")).toContainText(
    "Invalid frozen head",
  );
  assert.deepEqual(
    (await recipient.evaluate(() => window.foundationDiagnostics())).stamp,
    beforeBad.stamp,
  );
  checks.push("invalid alternative selection rejects before adoption");
  const holdFile = () =>
    recipient.evaluate(() => {
      const original = File.prototype.text;
      window.fileHeld = false;
      File.prototype.text = async function () {
        File.prototype.text = original;
        window.fileHeld = true;
        await new Promise((resolve) => (window.releaseFile = resolve));
        return original.call(this);
      };
    });
  await holdFile();
  await recipient.locator("#open").setInputFiles(path);
  await expect.poll(() => recipient.evaluate(() => window.fileHeld)).toBe(true);
  await recipient.getByLabel("Thought or equation").fill("typing during Open");
  await recipient.evaluate(() => window.releaseFile());
  await expect(recipient.locator("#message")).toContainText(
    "Draft changed while opening",
  );
  await expect(recipient.getByLabel("Thought or equation")).toHaveValue(
    "typing during Open",
  );
  assert.deepEqual(
    (await recipient.evaluate(() => window.foundationDiagnostics())).stamp,
    beforeBad.stamp,
  );
  checks.push("late Open cannot discard unaccepted typing");
  // Independent database connections must not overwrite an intervening durable generation.
  const race = await page.evaluate(
    async ({ root, store, native }) => {
      const { indexedBackend } = await import(
          "/@fs" + root + "/packages/foundation/src/indexed-db.ts"
        ),
        { incrementalStorage, decode, createWorkspace } = await import(
          "/@fs" + root + "/packages/foundation/src/index.ts"
        ),
        { webHash } = await import(
          "/@fs" + root + "/packages/foundation/src/resources.ts"
        ),
        { schemas, methods } = await import("/demo.ts");
      const a = await indexedBackend(store),
        b = await indexedBackend(store),
        head = await a.head(),
        env = JSON.parse(native),
        stamp = {
          root: env.document.id,
          evidence:
            env.document.evidenceSequence ??
            Math.max(0, ...env.receipts.map((r) => r.order)),
          binding: 0,
        },
        ticket = {
          request: "race-a",
          stamp,
          document: env.document.document,
          expectedGeneration: head.generation,
          capture: createWorkspace(
            await decode(native, schemas, methods, webHash),
            { schemas, methods, namespace: "race" },
          ).reader.capture(),
        };
      try {
        return (
          await Promise.allSettled([
            incrementalStorage(a, schemas, methods, webHash).save(ticket),
            incrementalStorage(b, schemas, methods, webHash).save({
              ...ticket,
              request: "race-b",
            }),
          ])
        ).map((r) => r.status);
      } finally {
        a.close();
        b.close();
      }
    },
    { root: root.replace(/\/$/, ""), store, native },
  );
  assert.equal(race.filter((x) => x === "fulfilled").length, 1);
  checks.push("two real IndexedDB connections yield one CAS winner");
  await page.evaluate(
    async ({ root, store, digest }) => {
      const { indexedBackend } = await import(
        "/@fs" + root + "/packages/foundation/src/indexed-db.ts"
      );
      const b = await indexedBackend(store);
      try {
        await b.loseAsset(digest);
      } finally {
        b.close();
      }
    },
    {
      root: root.replace(/\/$/, ""),
      store,
      digest: Object.keys(JSON.parse(native).assets)[0],
    },
  );
  const beforeMissing = await diag();
  await button("Reopen local save").click();
  await expect(page.locator("#message")).toContainText("Missing saved asset");
  assert.deepEqual((await diag()).stamp, beforeMissing.stamp);
  checks.push("missing durable bytes cannot replace accepted work");
  await recipient
    .getByRole("button", { name: "Compute baseline", exact: true })
    .focus();
  await recipient.keyboard.press("Enter");
  await expect(recipient.locator("#baseline-result")).toHaveText(
    "0.06 MPa · current",
  );
  const reclamationProbe = await page.evaluate(
    async ({ root, store }) => {
      const f = await import(
          "/@fs" + root + "/packages/foundation/src/index.ts"
        ),
        { indexedBackend } = await import(
          "/@fs" + root + "/packages/foundation/src/indexed-db.ts"
        ),
        d = await import("/demo.ts");
      const a = await indexedBackend(store),
        b = await indexedBackend(store);
      try {
        const w = f.createWorkspace(await d.demo(f.webHash), {
            schemas: d.schemas,
            methods: d.methods,
            namespace: "gc-browser",
            historyLimit: 0,
          }),
          writer = f.incrementalStorage(a, d.schemas, d.methods, f.webHash),
          other = f.incrementalStorage(b, d.schemas, d.methods, f.webHash);
        const ticket = (g) => ({
          request: crypto.randomUUID(),
          stamp: w.reader.stamp(),
          document: w.reader.read().document,
          expectedGeneration: g,
          capture: w.reader.capture(),
        });
        const edit = (value) => {
          const result = w.owner.apply(w.reader.stamp(), crypto.randomUUID(), [
            {
              kind: "revise",
              item: "force",
              revision: d.revision(crypto.randomUUID(), "force", "scalar@1", {
                value,
                unit: "N",
                ...d.meta,
              }),
            },
          ]);
          if (!result.ok) throw Error(result.error);
        };
        await writer.save(ticket(0));
        const first = await a.head();
        let releaseRead,
          readStarted,
          hold = true;
        const readyRead = new Promise((r) => (readStarted = r)),
          reader = f.incrementalStorage(
            b,
            d.schemas,
            d.methods,
            async (text) => {
              if (hold) {
                hold = false;
                readStarted();
                await new Promise((r) => (releaseRead = r));
              }
              return f.webHash(text);
            },
          );
        const pendingRead = reader.reopen();
        await readyRead;
        edit(200);
        const review = w.reader.reviewCompaction({ evidence: "reachable" });
        const compacted = w.owner.compact(
          w.reader.stamp(),
          crypto.randomUUID(),
          review,
        );
        if (!compacted.ok) throw Error(compacted.error);
        await writer.save(ticket(1));
        const inspection = await other.reviewReclamation(),
          beforeAbort = await b.state();
        let aborted = false;
        try {
          await other.reclaim(inspection, true);
        } catch (error) {
          aborted = String(error).includes("Aborted storage cleanup");
        }
        const unchangedAfterAbort =
            JSON.stringify(await b.state()) === JSON.stringify(beforeAbort),
          removed = await other.reclaim(inspection);
        releaseRead();
        const old = await pendingRead;
        edit(300);
        let saveStarted, releaseSave;
        const readySave = new Promise((r) => (saveStarted = r)),
          pendingSave = writer.save(ticket(2), "none", async () => {
            saveStarted();
            await new Promise((r) => (releaseSave = r));
          });
        await readySave;
        const orphan = "deliberate unreferenced staged record";
        await b.putPackage(await f.webHash(orphan), orphan);
        await other.reclaim(await other.reviewReclamation());
        releaseSave();
        const saved = await pendingSave;
        return {
          aborted,
          unchangedAfterAbort,
          removedBytes: removed.reclaimedBytes,
          readOldRoot: old.head.root === first.root,
          readForce: f.current(old.loaded.document, "force").body.value,
          epochRetries: saved.epochRetries,
          currentForce: f.current(
            (await writer.reopen()).loaded.document,
            "force",
          ).body.value,
        };
      } finally {
        a.close();
        b.close();
      }
    },
    {
      root: root.replace(/\/$/, ""),
      store: "manifold-foundation-gc-test-" + randomUUID(),
    },
  );
  assert(
    reclamationProbe.aborted &&
      reclamationProbe.unchangedAfterAbort &&
      reclamationProbe.readOldRoot,
  );
  assert(reclamationProbe.removedBytes > 0);
  assert.equal(reclamationProbe.readForce, 100);
  assert.equal(reclamationProbe.epochRetries, 1);
  assert.equal(reclamationProbe.currentForce, 300);
  checks.push(
    "two real connections preserve a held read across reclamation, roll back cleanup faults and retry an in-flight Save once after an epoch change",
  );
  const upgradeProbe = await page.evaluate(
    async ({ root, store }) => {
      const f = await import(
          "/@fs" + root + "/packages/foundation/src/index.ts"
        ),
        { indexedBackend } = await import(
          "/@fs" + root + "/packages/foundation/src/indexed-db.ts"
        ),
        d = await import("/demo.ts"),
        seed = await d.demo(f.webHash),
        memory = f.memoryBackend(),
        w = f.createWorkspace(seed, {
          schemas: d.schemas,
          methods: d.methods,
          namespace: "upgrade",
        });
      await f.storage(memory, d.schemas, d.methods, f.webHash).save({
        request: "legacy",
        stamp: w.reader.stamp(),
        document: w.reader.read().document,
        expectedGeneration: 0,
        native: f.encode(w.reader.read(), [], seed.resources, d.schemas),
      });
      const head = await memory.head(),
        metadata = await memory.package(head.package);
      const old = await new Promise((resolve, reject) => {
        const request = indexedDB.open(store, 1);
        request.onupgradeneeded = () => {
          for (const name of ["assets", "packages", "head"])
            request.result.createObjectStore(name);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = old.transaction(["assets", "packages", "head"], "readwrite"),
        done = new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
      for (const [key, text] of seed.resources.entries())
        tx.objectStore("assets").put(text, key);
      tx.objectStore("packages").put(metadata, head.package);
      tx.objectStore("head").put(head, "current");
      await done;
      let blockedUpgrade = false;
      try {
        await indexedBackend(store);
      } catch (error) {
        blockedUpgrade = String(error).includes("Close older foundation tabs");
      }
      old.close();
      const backend = await indexedBackend(store);
      try {
        const loaded = await f
          .incrementalStorage(backend, d.schemas, d.methods, f.webHash)
          .reopen();
        const versionError = await new Promise((resolve) => {
          const request = indexedDB.open(store, 1);
          request.onerror = () => resolve(request.error?.name);
          request.onsuccess = () => {
            request.result.close();
            resolve("unexpected success");
          };
        });
        return {
          versionError,
          blockedUpgrade,
          force: f.current(loaded.loaded.document, "force").body.value,
          generation: loaded.head.generation,
        };
      } finally {
        backend.close();
      }
    },
    {
      root: root.replace(/\/$/, ""),
      store: "manifold-foundation-upgrade-test-" + randomUUID(),
    },
  );
  assert.equal(upgradeProbe.versionError, "VersionError");
  assert.equal(upgradeProbe.blockedUpgrade, true);
  assert.equal(upgradeProbe.force, 100);
  assert.equal(upgradeProbe.generation, 1);
  checks.push(
    "IndexedDB v1 upgrade preserves the saved envelope and rejects older uncoordinated clients",
  );
  const typedProbe = await page.evaluate(typedBrowserProbe, {
    root: root.replace(/\/$/, ""),
    store: "manifold-foundation-typed-browser-" + randomUUID(),
  });
  assert.equal(typedProbe.nativeVersion, 4);
  assert.equal(typedProbe.calls, 1);
  assert.equal(typedProbe.result, "current");
  checks.push(
    "typed geometry shares checked evidence, native v4 and IndexedDB recovery with no recipient executor or unchanged writes",
  );
  const qa = join(root, ".manifold/foundation-qa");
  await captureEvidence(page, {
    path: join(qa, "desktop.png"),
    fullPage: true,
  });
  await captureEvidence(recipient, {
    path: join(qa, "mobile.png"),
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
  checks.push("keyboard Compute and no horizontal overflow at 320/390/1440 px");
  assert.deepEqual(errors, []);
  const result = {
    date: new Date().toISOString(),
    sourceDigest: execFileSync(
      process.execPath,
      ["packages/foundation/test/source-digest.mjs"],
      { cwd: root, encoding: "utf8" },
    ).trim(),
    browser: await browser.version(),
    reclamationProbe,
    upgradeProbe,
    typedProbe,
    checks,
    pageErrors: errors,
  };
  await mkdir(
    new URL("../../../evidence/current/foundation/", import.meta.url),
    { recursive: true },
  );
  await writeFile(
    new URL(
      "../../../evidence/current/foundation/browser-results.json",
      import.meta.url,
    ),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await rm(dir, { recursive: true, force: true });
}
