import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openHeadlessWorkspace } from "manifold-canvas/headless";
import { readBoundedText } from "../tools/read-bounded.mjs";
import { MAX_CANVAS_FILE_BYTES } from "../src/regions/app/canvasStorageBudget.ts";

const cli = fileURLToPath(new URL("../tools/manifold.mjs", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "manifold-agent-"));
const file = (name) => join(directory, name);
function run(args, status = 0, nodeArgs = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, cli, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    status,
    `${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  if (status === 0 || status === 3 || status === 4) {
    assert.equal(result.stderr, "");
    const data = JSON.parse(result.stdout);
    assert.equal(data.protocolVersion, 1);
    return data;
  }
  assert.equal(result.stdout, "");
  const data = JSON.parse(result.stderr);
  assert.equal(data.protocolVersion, 1);
  assert(data.error.code);
  return data;
}
function preload(source) {
  return ["--import", `data:text/javascript,${encodeURIComponent(source)}`];
}
// Inject failures at the real filesystem boundary, without production-only test hooks.
function duringPublicationSync(action) {
  const source = `
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { once } from "node:events";
    const originalOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args);
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => { await originalSync(); ${action} };
      return handle;
    };
    syncBuiltinESMExports();
  `;
  return preload(source);
}
async function parallel(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args]);
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
try {
  await writeFile(file("bounded.txt"), "é123");
  assert.equal(await readBoundedText(file("bounded.txt"), 5), "é123");
  await assert.rejects(readBoundedText(file("bounded.txt"), 4), {
    code: "FILE_TOO_LARGE",
  });
  // A lying/stale stat must not allow the actual read to exceed the byte budget.
  const growth = spawnSync(
    process.execPath,
    [
      ...preload(`
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const original = fs.open;
      fs.open = async (...args) => {
        const handle = await original(...args);
        handle.stat = async () => ({ size: 0 });
        return handle;
      };
      syncBuiltinESMExports();
    `),
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { readBoundedText } from ${JSON.stringify(new URL("../tools/read-bounded.mjs", import.meta.url).href)};
      await assert.rejects(readBoundedText(${JSON.stringify(file("bounded.txt"))}, 4), { code: "FILE_TOO_LARGE" });
    `,
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  assert.equal(growth.status, 0, growth.stderr);
  const oversized = await open(file("oversized.manifold"), "w");
  try {
    await oversized.truncate(MAX_CANVAS_FILE_BYTES + 1);
  } finally {
    await oversized.close();
  }
  assert.equal(
    run(["inspect", file("oversized.manifold")], 2).error.code,
    "FILE_TOO_LARGE",
  );
  const help = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.equal(help.stderr, "");
  for (const path of ["docs/guides/agents.md", "docs/reference/cli.md"]) {
    assert(help.stdout.includes(path), `CLI help links to ${path}`);
    await readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
  }
  assert.equal(run(["capabilities", "--json"]).execution.arbitraryCode, false);
  for (const args of [
    ["unknown"],
    ["inspect"],
    ["create", "--output"],
    ["inspect", "x", "--typo"],
    ["validate", "x", "--strict", "--strict"],
    ["compute", "x", "--request", "r", "--output", "out", "--timeout-ms", "0"],
  ])
    run(args, 2);
  const initial = run(["create", "--output", file("initial.json")]);
  const initialBytes = await readFile(file("initial.json"), "utf8");
  assert.equal(
    run(["inspect", file("initial.json")]).documentId,
    initial.documentId,
  );
  assert.equal(run(["validate", file("initial.json"), "--strict"]).clean, true);
  await writeFile(
    file("changes.json"),
    JSON.stringify({
      expectedDocumentId: initial.documentId,
      edits: [
        { operation: "createEquation", text: "x := 2 mm", as: "x" },
        { operation: "createEquation", text: "k := 10 N/mm" },
        { operation: "createEquation", text: "F = k*x", as: "force" },
        { operation: "createEquation", text: "F < 30 N", as: "limit" },
        { operation: "createModel", family: "spring", as: "spring" },
        {
          operation: "setModelInput",
          model: "$spring",
          input: "displacement",
          value: 3,
        },
      ],
    }),
  );
  const edited = run([
    "edit",
    file("initial.json"),
    "--changes",
    file("changes.json"),
    "--output",
    file("edited.json"),
  ]);
  assert.equal(await readFile(file("initial.json"), "utf8"), initialBytes);
  const worksheet = run(["worksheet", file("edited.json")]);
  assert.equal(
    worksheet.regions.find((region) => region.id === edited.aliases.force)
      .quantity.value,
    20,
  );
  const models = run(["models", file("edited.json")]).models;
  const model = run(["model", file("edited.json"), "--model", models[0].id]);
  assert.equal(model.requests[0].result.status, "ready");
  const uncomputed = run(["validate", file("edited.json"), "--strict"], 3);
  assert.equal(uncomputed.admitted, true);
  assert.equal(uncomputed.issues[0].kind, "computation-not-current");
  run(
    [
      "edit",
      file("edited.json"),
      "--changes",
      file("changes.json"),
      "--output",
      file("stale.json"),
    ],
    6,
  );
  assert(!(await readdir(directory)).includes("stale.json"));

  const computed = run([
    "compute",
    file("edited.json"),
    "--request",
    model.requests[0].id,
    "--output",
    file("computed.json"),
    "--timeout-ms",
    "10000",
  ]);
  assert.equal(computed.completion.status, "retained");
  assert.equal(computed.completion.receipt.outcome.status, "success");
  assert.equal(computed.completion.receipt.physicalValidity, "not-assessed");
  assert.equal(
    run(["validate", file("computed.json"), "--strict"]).clean,
    true,
  );
  const computeDiff = run(["diff", file("edited.json"), file("computed.json")]);
  assert.equal(computeDiff.regions.length, 0);
  assert.equal(computeDiff.models[0].before.requests[0].result.status, "ready");
  assert.equal(
    computeDiff.models[0].after.requests[0].result.status,
    "current",
  );
  // Hold the existing scheduler's queued pump so real CLI timers/signals see a pending job.
  // Other microtasks and the CLI are unmodified; there are no production test-mode switches.
  const holdScheduler = `
    const enqueue = globalThis.queueMicrotask;
    globalThis.queueMicrotask = callback => {
      if (callback.name !== "pump") enqueue(callback);
    };
  `;
  const computeArgs = (output) => [
    "compute",
    file("edited.json"),
    "--request",
    model.requests[0].id,
    "--output",
    file(output),
  ];
  assert.equal(
    run(
      [...computeArgs("timeout.json"), "--timeout-ms", "10"],
      124,
      preload(holdScheduler),
    ).error.code,
    "TIMEOUT",
  );
  assert(!(await readdir(directory)).includes("timeout.json"));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const pendingSignal = `
      const enqueue = globalThis.queueMicrotask;
      let sent = false;
      globalThis.queueMicrotask = callback => {
        if (callback.name !== "pump") return enqueue(callback);
        if (!sent) { sent = true; setTimeout(() => process.kill(process.pid, ${JSON.stringify(signal)}), 1); }
      };
    `;
    assert.equal(
      run(computeArgs(`${signal}.json`), 130, preload(pendingSignal)).error
        .code,
      "INTERRUPTED",
    );
    assert(!(await readdir(directory)).includes(`${signal}.json`));
  }
  // Inject an already-cancelled executor signal: the owner retains a failed receipt.
  const failed = run(
    computeArgs("failed.json"),
    4,
    preload(`
    const Controller = globalThis.AbortController;
    globalThis.AbortController = class extends Controller {
      constructor() { super(); this.abort("Injected executor cancellation"); }
    };
  `),
  );
  assert.equal(failed.completion.status, "retained");
  assert.equal(failed.completion.receipt.outcome.status, "failed");
  const failedOwner = await openHeadlessWorkspace(
    await readFile(file("failed.json"), "utf8"),
  );
  try {
    assert.equal(failedOwner.models()[0].requests[0].result.status, "failed");
  } finally {
    failedOwner.dispose();
  }
  const reopened = await openHeadlessWorkspace(
    await readFile(file("computed.json"), "utf8"),
  );
  assert.equal(reopened.models()[0].requests[0].result.status, "current");
  reopened.dispose();

  await writeFile(
    file("update.json"),
    JSON.stringify({
      expectedDocumentId: edited.documentId,
      edits: [
        {
          operation: "updateEquation",
          region: edited.aliases.x,
          text: "x := 4 mm",
        },
      ],
    }),
  );
  run([
    "edit",
    file("computed.json"),
    "--changes",
    file("update.json"),
    "--output",
    file("candidate.json"),
  ]);
  const difference = run([
    "diff",
    file("computed.json"),
    file("candidate.json"),
  ]);
  assert(
    difference.regions.some(
      (change) =>
        change.id === edited.aliases.force &&
        change.after.quantity.value === 40,
    ),
  );
  assert(
    run(["validate", file("candidate.json"), "--strict"], 3).issues.some(
      (issue) => issue.kind === "constraint-failed",
    ),
  );

  await writeFile(
    file("draft.json"),
    JSON.stringify({
      expectedDocumentId: edited.documentId,
      edits: [{ operation: "createEquation", text: "unfinished =" }],
    }),
  );
  run([
    "edit",
    file("edited.json"),
    "--changes",
    file("draft.json"),
    "--output",
    file("draft-workspace.json"),
  ]);
  assert(
    run(["validate", file("draft-workspace.json"), "--strict"], 3).issues.some(
      (issue) => issue.kind === "worksheet-diagnostic",
    ),
  );
  run(["inspect", file("draft-workspace.json")]);
  await writeFile(file("bad.json"), "{");
  assert.equal(
    run(["inspect", file("bad.json")], 2).error.code,
    "INVALID_WORKSPACE",
  );
  assert.equal(
    run(
      [
        "edit",
        file("initial.json"),
        "--changes",
        file("bad.json"),
        "--output",
        file("no-output.json"),
      ],
      2,
    ).error.code,
    "INVALID_JSON",
  );
  assert(!(await readdir(directory)).includes("no-output.json"));
  await writeFile(
    file("rollback.json"),
    JSON.stringify({
      expectedDocumentId: initial.documentId,
      edits: [
        { operation: "createNote", text: "Do not publish" },
        { operation: "updateNote", region: "$missing", text: "Invalid" },
      ],
    }),
  );
  run(
    [
      "edit",
      file("initial.json"),
      "--changes",
      file("rollback.json"),
      "--output",
      file("rollback-output.json"),
    ],
    2,
  );
  assert(!(await readdir(directory)).includes("rollback-output.json"));
  assert.equal(await readFile(file("initial.json"), "utf8"), initialBytes);
  assert.equal(
    run(["create", "--output", file("initial.json")], 5).error.code,
    "OUTPUT_EXISTS",
  );
  await symlink(file("absent.json"), file("link.json"));
  run(["create", "--output", file("link.json")], 5);
  run(["inspect", file("absent.json")], 5);
  run(
    [
      "compute",
      file("edited.json"),
      "--request",
      "missing",
      "--output",
      file("no-request.json"),
    ],
    2,
  );
  assert(!(await readdir(directory)).includes("no-request.json"));
  // A signal during writing must still prevent publication and clean up its temporary.
  assert.equal(
    run(
      ["create", "--output", file("interrupted.json")],
      130,
      duringPublicationSync(
        'const keepAlive = setInterval(() => {}, 1000); try { const signal = once(process, "SIGINT"); process.kill(process.pid, "SIGINT"); await signal; } finally { clearInterval(keepAlive); }',
      ),
    ).error.code,
    "INTERRUPTED",
  );
  assert(!(await readdir(directory)).includes("interrupted.json"));
  assert.equal(
    run(
      [
        "edit",
        file("initial.json"),
        "--changes",
        file("changes.json"),
        "--output",
        file("grown-input.json"),
      ],
      6,
      duringPublicationSync(
        `await fs.truncate(${JSON.stringify(file("initial.json"))}, ${MAX_CANVAS_FILE_BYTES + 1});`,
      ),
    ).error.code,
    "STALE_FILE",
  );
  assert(!(await readdir(directory)).includes("grown-input.json"));
  await writeFile(file("initial.json"), initialBytes);
  const changedInput = initialBytes + "\n";
  assert.equal(
    run(
      [
        "edit",
        file("initial.json"),
        "--changes",
        file("changes.json"),
        "--output",
        file("changed-input.json"),
      ],
      6,
      duringPublicationSync(
        `await fs.writeFile(${JSON.stringify(file("initial.json"))}, ${JSON.stringify(changedInput)});`,
      ),
    ).error.code,
    "STALE_FILE",
  );
  assert(!(await readdir(directory)).includes("changed-input.json"));
  assert.equal(
    await readFile(file("initial.json"), "utf8"),
    changedInput,
    "the CLI never overwrites another writer's input",
  );
  await writeFile(file("initial.json"), initialBytes);
  const racing = await Promise.all([
    parallel(["create", "--output", file("race.json")]),
    parallel(["create", "--output", file("race.json")]),
  ]);
  assert.deepEqual(racing.map((result) => result.status).sort(), [0, 5]);
  assert.equal(racing.filter((result) => result.status === 0).length, 1);
  run(["inspect", file("race.json")]);
  assert(!(await readdir(directory)).some((name) => name.endsWith(".tmp")));
  console.log(
    "Agent CLI: real subprocess workflow, explicit computation, validation, diff, rollback, no-clobber and concurrent publication passed.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
