import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  config,
  nodeSupported,
  pythonInfo,
  checkDependencies,
  assertPortFree,
  root,
} from "./dev-config.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(predicate, detail, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw Error(`Timed out: ${detail}`);
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "manifold-dev-"));
  const sourceDir = join(directory, "source");
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, "server.py"), "# version one\n");
  const apiPort = await freePort(),
    devPort = await freePort();
  const pidLog = join(directory, "pids");
  const service = join(directory, "service.mjs");
  await writeFile(
    service,
    `
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const port = Number(process.argv[2]);
appendFileSync(${JSON.stringify(pidLog)}, process.pid + '\\n');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
appendFileSync(${JSON.stringify(pidLog)}, descendant.pid + '\\n');
createServer((req,res) => { res.end('ready'); }).listen(port, '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
${options.crash ? `if (process.argv[3] ${options.backendCrash ? "!==" : "==="} 'frontend') setTimeout(() => process.exit(7), 700);` : ""}
`,
  );
  const backendCommand = [process.execPath, service, String(apiPort)];
  const frontendCommand = options.missingFrontend
    ? [join(directory, "missing-executable")]
    : [process.execPath, service, String(devPort), "frontend"];
  const runner = join(directory, "runner.mjs");
  await writeFile(
    runner,
    `
import { runDev } from ${JSON.stringify(new URL("./dev.mjs", import.meta.url).href)};
try {
  await runDev(${JSON.stringify({ settings: { apiPort, devPort, python: "unused" }, sourceDir, backendCommand, frontendCommand, pollMs: 50 })});
} catch (error) { console.error(error.message); process.exitCode = 1; }
`,
  );
  const child = spawn(process.execPath, [runner], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const done = new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await done;
    await rm(directory, { recursive: true, force: true });
  });
  return {
    child,
    done,
    sourceDir,
    apiPort,
    devPort,
    pidLog,
    output: () => output,
  };
}

async function processesStopped(log) {
  const pids = (await readFile(log, "utf8")).trim().split("\n").map(Number);
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      // Linux can briefly retain a killed orphan as a zombie until init reaps it.
      if (process.platform === "linux") {
        const status = await readFile(`/proc/${pid}/stat`, "utf8").catch(
          () => "",
        );
        if (!status || /^\d+ \(.*\) Z /.test(status)) continue;
      }
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  return true;
}

test("configuration validates ports and supported Node versions", () => {
  assert.deepEqual(config({}), {
    apiPort: 58310,
    devPort: 58311,
    python: "python3",
  });
  assert.equal(
    config({ PYTHON: "/custom/python", MANIFOLD_API_PORT: "58410" }).python,
    "/custom/python",
  );
  for (const value of ["0", "65536", "12.5", "NaN", "", "-1"])
    assert.throws(() => config({ MANIFOLD_DEV_PORT: value }), /integer/);
  assert.throws(() => config({ MANIFOLD_DEV_PORT: "58310" }), /must differ/);
  for (const version of ["20.19.0", "22.17.0"])
    assert.equal(nodeSupported(version), false);
  for (const version of ["22.18.0", "24.0.0"])
    assert.equal(nodeSupported(version), true);
  assert.throws(() => pythonInfo("/no/such/python"), /Install Python/);
  assert.doesNotThrow(
    checkDependencies,
    "installed ESM-only dependencies must resolve",
  );
});

test("port conflicts are rejected without stopping their owner", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(assertPortFree(server.address().port), /Cannot bind/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test(
  "combined session becomes ready, restarts Python only, and cleans up on SIGINT",
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    await until(() => f.output().includes("Manifold development:"), f.output);
    assert.equal((f.output().match(/http:\/\//g) || []).length, 1);
    const before = (await readFile(f.pidLog, "utf8")).trim().split("\n");
    assert.equal(before.length, 4);
    await writeFile(join(f.sourceDir, "ignored.txt"), "not Python");
    await delay(150);
    assert.ok(!f.output().includes("restarting backend"));
    await writeFile(
      join(f.sourceDir, "server.py"),
      "# version two, with changes\n",
    );
    await until(() => f.output().includes("Backend ready."), "backend restart");
    const after = (await readFile(f.pidLog, "utf8")).trim().split("\n");
    assert.equal(after.length, 6, "only backend and its descendant restarted");
    f.child.kill("SIGINT");
    assert.equal((await f.done).code, 0, f.output());
    await until(() => processesStopped(f.pidLog), "owned process cleanup");
    await assertPortFree(f.apiPort);
    await assertPortFree(f.devPort);
  },
);

for (const [name, options] of [
  ["frontend crash", { crash: true }],
  ["backend crash", { crash: true, backendCrash: true }],
  ["frontend launch failure", { missingFrontend: true }],
]) {
  test(
    `${name} fails the session and cleans up the backend`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, options);
      assert.equal((await f.done).code, 1, f.output());
      assert.match(f.output(), /(?:vite|python) (exited|failed to start)/);
      await until(() => processesStopped(f.pidLog), "failure cleanup");
      await assertPortFree(f.apiPort);
      await assertPortFree(f.devPort);
    },
  );
}

test("root command aliases forward focused check arguments", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.test, "npm --workspace manifold-canvas test --");
  assert.equal(
    pkg.scripts["test:browser"],
    "npm --workspace manifold-canvas run test:all-browser --",
  );
  assert.equal(pkg.scripts["setup:browser"], "playwright install chromium");
});
