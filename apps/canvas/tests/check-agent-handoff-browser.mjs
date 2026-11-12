import { browserOptions } from "../../../scripts/browser.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import { decodeWorkspace } from "../src/regions/artifacts.ts";
import { readWorkspace } from "./browser-workspace.mjs";

const base = process.env.MANIFOLD_BASE_URL || "http://127.0.0.1:58310";
const cli = fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url));
const baseline = fileURLToPath(
  new URL("./fixtures/agent-spring/baseline.manifold", import.meta.url),
);
const directory = await mkdtemp(join(tmpdir(), "manifold-agent-handoff-"));
const file = (name) => join(directory, name);
const errors = [],
  executions = [];
let browser;
const byId = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

function run(args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    status,
    `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  assert.equal(result.stderr, "");
  const data = JSON.parse(result.stdout);
  assert.equal(data.protocolVersion, 1);
  return data;
}

function evidence(document, receipts) {
  return {
    sequence: document.evidenceSequence,
    allocated: [...document.allocated.receipts.entries()]
      .map(([id]) => id)
      .sort(),
    receipts: [...receipts]
      .map((receipt) => ({
        ...receipt,
        context: {
          ...receipt.context,
          heads: [...receipt.context.heads.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          ),
          revisions: [...receipt.context.revisions.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        },
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function inspect(path) {
  const bytes = await readFile(path, "utf8");
  const owner = await openHeadlessWorkspace(bytes);
  try {
    const document = owner.read();
    return {
      root: document.id,
      document: document.document,
      items: [...document.items.entries()].map(([id]) => id).sort(),
      worksheet: owner.worksheet(),
      models: byId(owner.models()).map((model) => ({
        ...model,
        inputs: byId(model.inputs),
        outputs: byId(model.outputs),
        requests: byId(model.requests),
      })),
      evidence: evidence(
        document,
        (await decodeWorkspace(bytes)).recovery.foundation.receipts,
      ),
    };
  } finally {
    owner.dispose();
  }
}

function authoredFacts(snapshot) {
  const { root: _, worksheet, models, ...rest } = snapshot;
  const { documentId: __, ...rows } = worksheet;
  return {
    ...rest,
    worksheet: rows,
    models: models.map(({ documentId: _, ...model }) => model),
  };
}

async function uncoverWorksheet(page) {
  // The spring fixture's two cards share (100, 100) with worksheet rows.
  // Arrange through actual move handles, preserving all source and evidence.
  for (const [label, dx] of [
    ["Spring", 600],
    ["Force scale", 1050],
  ]) {
    const card = page.getByLabel(`${label} model`, { exact: true });
    const before = await card.boundingBox();
    const box = await card.getByLabel(`Move ${label} model`).boundingBox();
    assert(before && box);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => (await card.boundingBox()).x)
      .toBeGreaterThan(before.x + dx / 2);
  }
}

async function newPage() {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
  });
  // Scalar models execute in process. Also intercept unexpected HTTP executions
  // before they can reach a shared service; receipt checks below cover both paths.
  await context.route("**/api/**", async (route) => {
    if (route.request().method() === "POST") {
      executions.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await expect(page.locator(".er-canvas")).toBeVisible();
  return page;
}

async function open(page, path) {
  await page
    .getByLabel("Open workspace file", { exact: true })
    .setInputFiles(path);
  await page.waitForURL(/\?canvas=/);
  await expect(page.getByLabel("Workspace save status")).toHaveText(
    "Saved locally",
  );
}

async function save(page, name) {
  await page
    .getByRole("button", { name: "Search objects and commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("Save workspace file");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save workspace file", exact: true })
    .click();
  const download = await event;
  expect(download.suggestedFilename()).toBe("manifold-workspace.manifold");
  await download.saveAs(file(name));
  return inspect(file(name));
}

async function durableEvidence(page, expected) {
  const key = `manifold.artifact-experiment.v1.canvas-${new URL(page.url()).searchParams.get("canvas")}`;
  const saved = await readWorkspace(page, key);
  assert(saved?.document, "Open must persist the selected native workspace");
  assert.equal(saved.document.document, expected.document);
  assert.equal(saved.document.id, expected.root);
  assert.deepEqual(
    evidence(saved.document, saved.recovery.foundation.receipts),
    expected.evidence,
    "durable Open/edit/reopen must preserve every receipt and evidence identity",
  );
  assert.deepEqual(
    saved.page.regions.map(({ id, text }) => ({ id, text })),
    expected.worksheet.regions.map(({ id, text }) => ({ id, text })),
  );
}

try {
  const baselineBytes = await readFile(baseline, "utf8");
  const source = run(["inspect", baseline, "--compact"]);
  const x = source.worksheet.regions.find((row) => row.name === "x");
  const force = source.worksheet.regions.find((row) => row.kind === "equation");
  const limit = source.worksheet.regions.find(
    (row) => row.kind === "constraint",
  );
  const spring = source.models.find((model) =>
    model.inputs.some((input) => input.id === "displacement"),
  );
  assert(x && force && limit && spring);
  assert(source.models.length > 1, "Preserve unrelated model evidence too");
  await writeFile(
    file("edits.json"),
    JSON.stringify({
      expectedDocumentId: source.documentId,
      edits: [
        { operation: "updateEquation", region: x.id, text: "x := 4 mm" },
        {
          operation: "setModelInput",
          model: spring.id,
          input: "displacement",
          value: 4,
        },
      ],
    }),
  );
  run([
    "edit",
    baseline,
    "--changes",
    file("edits.json"),
    "--output",
    file("ready.manifold"),
  ]);
  const pending = run(["model", file("ready.manifold"), "--model", spring.id]);
  assert.equal(pending.requests[0].result.status, "ready");
  const completion = run([
    "compute",
    file("ready.manifold"),
    "--request",
    pending.requests[0].id,
    "--output",
    file("computed.manifold"),
    "--timeout-ms",
    "10000",
  ]).completion;
  assert.equal(completion.status, "retained");
  assert.equal(completion.receipt.outcome.status, "success");
  assert.equal(
    run(["validate", file("computed.manifold"), "--strict"], 3).issues.length,
    1,
  );

  browser = await chromium.launch({
    ...browserOptions(),
    headless: true,
  });
  const row = (page, id) => page.locator(`[data-region-id="${id}"]`);
  const model = (page) =>
    page.locator(`[data-independent-model="${spring.id}"]`);
  const displayed = async (page, mm, status) => {
    await expect(page.locator('[data-result-for="F"]')).toContainText(
      `${10 * mm} N`,
    );
    await expect(row(page, x.id)).toContainText("mm");
    await expect(row(page, limit.id).getByRole("status")).toHaveText(
      mm < 3 ? "Satisfied" : "Not satisfied",
    );
    await expect(model(page).getByLabel("Spring Displacement")).toHaveValue(
      "4",
    );
    await expect(model(page)).toContainText("mm");
    await expect(model(page).getByLabel("Model force")).toHaveText("40 N");
    await expect(model(page).locator(".im-status")).toContainText(status);
  };
  const sourceInEditor = async (page, id, text) => {
    await row(page, id).locator(".er-math-line").dblclick();
    const editor = page.getByLabel("Write an engineering region", {
      exact: true,
    });
    await expect(editor).toHaveValue(text);
    await editor.press("Escape");
  };

  // A ready request must stay ready, even though it has a valid 40 N projection
  // and older checked receipts. Test a second isolated Open of its native export.
  for (const stage of ["ready", "computed"]) {
    const candidate = await inspect(file(`${stage}.manifold`));
    assert(candidate.evidence.receipts.length > 0);
    const status = stage === "ready" ? "ready" : "current";
    const request = candidate.models
      .find((model) => model.id === spring.id)
      .requests.find((request) => request.id === pending.requests[0].id);
    assert.equal(request.result.status, status);
    assert.equal(
      candidate.evidence.receipts.some((r) => r.id === completion.receipt.id),
      stage === "computed",
      "Only explicit CLI compute contributes the new receipt",
    );
    if (stage === "computed")
      assert.equal(request.result.receipt.id, completion.receipt.id);
    const page = await newPage();
    await open(page, file(`${stage}.manifold`));
    await displayed(page, 4, status);
    await durableEvidence(page, candidate);
    assert.deepEqual(await save(page, `${stage}-imported.manifold`), candidate);
    await uncoverWorksheet(page);
    await sourceInEditor(page, force.id, "F = k*x");
    await sourceInEditor(page, limit.id, "F < 30 N");
    const expected = await save(page, `${stage}-arranged.manifold`);
    assert.deepEqual(authoredFacts(expected), authoredFacts(candidate));
    await durableEvidence(page, expected);

    let exported = expected;
    if (stage === "computed") {
      await row(page, x.id)
        .getByRole("button", { name: "Edit value 4", exact: true })
        .click();
      const editor = page.getByLabel("Write an engineering region", {
        exact: true,
      });
      await expect(editor).toHaveValue("x := 4 mm");
      await editor.fill("x := 2 mm");
      await editor.press("Escape");
      await displayed(page, 2, status);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await displayed(page, 4, status);
      await sourceInEditor(page, x.id, "x := 4 mm");
      const undone = await save(page, "undone.manifold");
      assert.deepEqual(authoredFacts(undone), authoredFacts(expected));
      await durableEvidence(page, undone);
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await displayed(page, 2, status);
      await sourceInEditor(page, x.id, "x := 2 mm");
      exported = await save(page, `${stage}-saved.manifold`);
      assert.notEqual(exported.root, expected.root);
      assert.equal(exported.document, expected.document);
      assert.deepEqual(exported.items, expected.items);
      assert.deepEqual(exported.evidence, expected.evidence);
      assert.deepEqual(
        exported.models.map(({ documentId: _, ...model }) => model),
        expected.models.map(({ documentId: _, ...model }) => model),
        "worksheet edits must preserve independent model source, units and receipts",
      );
      for (const before of expected.worksheet.regions) {
        const after = exported.worksheet.regions.find(
          (r) => r.id === before.id,
        );
        assert(after, "Every original worksheet identity survives");
        assert.equal(
          after.text,
          before.id === x.id ? "x := 2 mm" : before.text,
        );
        assert.deepEqual(after.position, before.position);
        assert.equal(after.diagnostic, null);
        if (![x.id, force.id, limit.id].includes(before.id))
          assert.deepEqual(after, before);
      }
      const rows = exported.worksheet.regions;
      assert.equal(rows.length, expected.worksheet.regions.length);
      assert.equal(rows.find((r) => r.id === x.id).quantity.value, 0.002);
      assert.equal(rows.find((r) => r.id === x.id).quantity.unit, "m");
      assert.equal(rows.find((r) => r.id === force.id).quantity.value, 20);
      assert.equal(rows.find((r) => r.id === force.id).quantity.unit, "N");
      assert.equal(rows.find((r) => r.id === limit.id).constraint.pass, true);
      await durableEvidence(page, exported);
    }
    await page.context().close();

    const receiver = await newPage();
    await open(
      receiver,
      file(`${stage}-${stage === "ready" ? "arranged" : "saved"}.manifold`),
    );
    await displayed(receiver, stage === "ready" ? 4 : 2, status);
    await sourceInEditor(
      receiver,
      x.id,
      stage === "ready" ? "x := 4 mm" : "x := 2 mm",
    );
    await sourceInEditor(receiver, force.id, "F = k*x");
    await durableEvidence(receiver, exported);
    assert.deepEqual(
      await save(receiver, `${stage}-reopened.manifold`),
      exported,
    );
    await receiver.context().close();
    assert.deepEqual(
      executions,
      [],
      "Native Open/reopen must not call executors",
    );
  }
  assert.equal(await readFile(baseline, "utf8"), baselineBytes);
  assert.deepEqual(errors, []);
  console.log(
    `Agent handoff browser (${await browser.version()}): public CLI edit/compute, native Open, source/units/results/failed constraint, UI edit/Undo/Redo, export and fresh-context reopen pass; ready/current model evidence and durable receipt identities remain unchanged without execution.`,
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
