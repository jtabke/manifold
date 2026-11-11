import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { checks, selectChecks, runChecks } from "../tools/run-checks.mjs";

const directory = await mkdtemp(join(tmpdir(), "manifold-runner-contract-"));
const logs = [];
const manifest = [
  { name: "unit.mjs", mode: "local", diagnostic: false },
  { name: "ui.mjs", mode: "browser", diagnostic: false },
  { name: "profile.mjs", mode: "browser", diagnostic: true },
];
const fake = (name, source, timeoutMs = 10000) => ({
  name: `${name}.mjs`,
  mode: "local",
  diagnostic: false,
  timeoutMs,
  command: [process.execPath, "-e", source],
});
const lifetime = new AbortController();
let interrupted;
const onInt = () => {
  interrupted = 130;
  lifetime.abort();
};
const onTerm = () => {
  interrupted = 143;
  lifetime.abort();
};
process.on("SIGINT", onInt);
process.on("SIGTERM", onTerm);
const options = {
  cwd: directory,
  report: () => {},
  signal: lifetime.signal,
  killGraceMs: 50,
};
async function fails(files, opts = {}) {
  let failure;
  try {
    await runChecks(files, {
      ...options,
      ...opts,
      signal: opts.signal
        ? AbortSignal.any([lifetime.signal, opts.signal])
        : lifetime.signal,
    });
  } catch (error) {
    failure = error;
  }
  assert(failure, "Must reject a failed run");
  if (failure.logDir) logs.push(failure.logDir);
  return failure;
}
async function waitForFile(path) {
  for (let i = 0; i < 200; i++) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await delay(10);
    }
  }
  throw Error(`Fixture did not become ready: ${path}`);
}
async function assertDead(pid) {
  let dead = false;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        dead = /^\d+ \(.+\) [ZX] /.test(
          await readFile(`/proc/${pid}/stat`, "utf8"),
        );
      } catch (error) {
        if (error.code === "ENOENT") dead = true;
        else throw error;
      }
      if (dead) break;
      await delay(10);
    }
    assert(dead, "Owned descendant must die after its check finishes");
  } finally {
    if (!dead) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
}
try {
  if (process.env.MANIFOLD_RUNNER_CANCEL_PROBE) {
    const pidFile = process.env.MANIFOLD_RUNNER_CANCEL_PROBE;
    await runChecks(
      [
        fake(
          "nested-cancellation-probe",
          `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 10)`,
        ),
      ],
      options,
    );
  } else {
    assert.deepEqual(
      selectChecks(manifest).map((check) => check.name),
      ["unit.mjs"],
    );
    assert.deepEqual(selectChecks(manifest, { requested: ["unit"] }), [
      manifest[0],
    ]);
    assert.deepEqual(selectChecks(manifest, { mode: "browser" }), [
      manifest[1],
    ]);
    assert.deepEqual(
      selectChecks(manifest, { mode: "browser", diagnostic: true }),
      [manifest[2]],
    );
    for (const options of [
      { requested: ["unit", "missing"] },
      { requested: ["ui"] },
      { mode: "browser", requested: ["unit"] },
      { mode: "browser", requested: ["profile"] },
      { mode: "browser", diagnostic: true, requested: ["ui"] },
      { requested: ["unit", "unit.mjs"] },
    ])
      assert.throws(() => selectChecks(manifest, options));
    const names = checks.map((check) => check.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(
      [...names].sort(),
      (await readdir(new URL("./", import.meta.url)))
        .filter((name) => /^check-.*\.mjs$/.test(name))
        .sort(),
      "Every check must be registered, including opt-in diagnostics",
    );
    assert.equal(
      checks.find((check) => check.name === "check-equation-editing.mjs").mode,
      "browser",
    );
    assert(
      !selectChecks(checks, { mode: "browser" }).some(
        (check) => check.diagnostic,
      ),
    );
    for (const check of checks)
      assert(Number.isInteger(check.timeoutMs) && check.timeoutMs > 0);

    const runner = fileURLToPath(
      new URL("../tools/run-checks.mjs", import.meta.url),
    );
    for (const args of [
      ["check-math", "check-nonexistent"],
      ["check-drawing-browser"],
      ["--browser", "check-math"],
      ["--browser", "check-drawing-performance-browser"],
      ["--jobs", "0"],
      ["--browser", "--jobs", "2"],
      ["--unknown"],
    ]) {
      const child = spawnSync(process.execPath, [runner, ...args], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(child.status, 1, `${args}: ${child.stdout} ${child.stderr}`);
      assert.equal(
        child.stdout,
        "",
        "Invalid selections/options fail before tests or a server start",
      );
    }
    const list = spawnSync(
      process.execPath,
      [runner, "--browser", "--diagnostic", "--list"],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(list.status, 0);
    assert.deepEqual(
      JSON.parse(list.stdout).map((check) => check.name),
      ["check-drawing-performance-browser.mjs"],
    );

    const evidenceHelper = new URL("./browser-evidence.mjs", import.meta.url)
      .href;
    for (const enabled of [false, true]) {
      const path = join(directory, `evidence-${enabled}`, "capture.png");
      const source = `import {captureEvidence} from ${JSON.stringify(evidenceHelper)}; const result = await captureEvidence({screenshot: async options => {if (options.path !== ${JSON.stringify(path)}) throw Error("Wrong options"); return "captured";}}, {path: ${JSON.stringify(path)}}); console.log(result ?? "disabled");`;
      const child = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", source],
        {
          encoding: "utf8",
          timeout: 10000,
          env: { ...process.env, MANIFOLD_TEST_EVIDENCE: enabled ? "1" : "0" },
        },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stdout.trim(), enabled ? "captured" : "disabled");
      if (enabled) await access(join(directory, `evidence-${enabled}`));
      else await assert.rejects(access(join(directory, `evidence-${enabled}`)));
    }
    const output = [];
    const passed = await runChecks(
      [
        fake("first", 'console.log("first-out"); console.error("first-err");'),
        fake("second", 'console.log("second-out")'),
      ],
      { ...options, jobs: 2, report: (text) => output.push(text) },
    );
    assert.equal(passed.length, 2);
    assert(passed.every((result) => result.passed));
    assert(
      output.some(
        (text) =>
          text.includes("first-out") &&
          text.includes("first-err") &&
          !text.includes("second-out"),
      ),
      "Parallel logs stay grouped by child",
    );
    await assert.rejects(
      access(passed[0].log),
      "Successful runs remove temporary logs",
    );
    const failed = await fails([
      fake("failure", 'console.error("retained-diagnostic"); process.exit(7)'),
    ]);
    assert.equal(failed.results[0].code, 7);
    assert.match(failed.message, /failure.mjs: exit 7/);
    assert.match(
      await readFile(failed.results[0].log, "utf8"),
      /retained-diagnostic/,
    );
    const spawnFailure = await fails([
      {
        ...fake("missing", ""),
        command: [join(directory, "nonexistent-executable")],
      },
    ]);
    assert.match(spawnFailure.results[0].error, /ENOENT/);

    const timeout = await fails([
      fake(
        "hang",
        'process.on("SIGTERM", () => {}); console.log("started"); setInterval(() => {}, 10)',
        500,
      ),
    ]);
    assert.equal(timeout.results[0].reason, "timeout");
    assert.equal(timeout.results[0].passed, false);
    assert.match(await readFile(timeout.results[0].log, "utf8"), /started/);

    const ready = join(directory, "peer-ready"),
      third = join(directory, "third-started");
    const peer = fake(
      "peer",
      `require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready"); setInterval(() => {}, 10)`,
    );
    const failure = fake(
      "failure-after-peer",
      `setInterval(() => {if (require("node:fs").existsSync(${JSON.stringify(ready)})) process.exit(9)}, 5)`,
    );
    const cancelled = await fails(
      [
        peer,
        failure,
        fake(
          "must-not-run",
          `require("node:fs").writeFileSync(${JSON.stringify(third)}, "bad")`,
        ),
      ],
      { jobs: 2 },
    );
    assert.equal(cancelled.results.length, 2);
    assert(
      cancelled.results.some(
        (result) =>
          result.name === peer.name && result.reason === "interrupted",
      ),
    );
    await assert.rejects(access(third));
    const started = join(directory, "interrupt-ready");
    const activeController = new AbortController();
    const active = fails(
      [
        fake(
          "active",
          `require("node:fs").writeFileSync(${JSON.stringify(started)}, "ready"); setInterval(() => {}, 10)`,
        ),
      ],
      { signal: activeController.signal },
    );
    let readyForInterrupt = false;
    for (let i = 0; i < 200; i++) {
      try {
        await access(started);
        readyForInterrupt = true;
        break;
      } catch {
        await delay(10);
      }
    }
    activeController.abort();
    const activeFailure = await active;
    assert(readyForInterrupt, "Child must be running before interrupting it");
    assert.equal(activeFailure.results[0].reason, "interrupted");
    const reportFailure = await fails(
      [
        fake("report-error", ""),
        fake("report-peer", "setInterval(() => {}, 10)"),
      ],
      {
        jobs: 2,
        report: () => {
          throw Error("injected reporter failure");
        },
      },
    );
    assert.match(reportFailure.message, /injected reporter failure/);
    assert(
      reportFailure.results.every(
        (result) => result.passed || result.reason === "interrupted",
      ),
    );
    if (process.platform === "linux") {
      const pidFile = join(directory, "grandchild-pid");
      const grandchild = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 10)`;
      const tree = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], {stdio: "ignore"}); setInterval(() => {}, 10)`;
      const stopped = await fails([fake("process-tree", tree, 500)]);
      assert.equal(stopped.results[0].reason, "timeout");
      const pid = (await readFile(pidFile, "utf8")).trim();
      await assertDead(pid);
      // An ordinary nonzero leader must not strand a daemon either.
      const failedPid = join(directory, "failed-grandchild-pid");
      const daemon = `require("node:fs").writeFileSync(${JSON.stringify(failedPid)}, String(process.pid)); setInterval(() => {}, 10)`;
      const failingTree = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(daemon)}], {stdio: "ignore"}); setInterval(() => {if (require("node:fs").existsSync(${JSON.stringify(failedPid)})) process.exit(7)}, 5)`;
      const orphan = await fails([fake("failed-tree", failingTree)]);
      assert.equal(orphan.results[0].code, 7);
      await assertDead((await readFile(failedPid, "utf8")).trim());

      for (const signal of ["SIGINT", "SIGTERM"]) {
        const nestedPid = join(directory, `nested-${signal}-pid`);
        const child = spawn(process.execPath, [runner, "check-test-runner"], {
          env: { ...process.env, MANIFOLD_RUNNER_CANCEL_PROBE: nestedPid },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (data) => {
          output += data;
        });
        child.stderr.on("data", (data) => {
          output += data;
        });
        const closed = new Promise((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code) => resolve(code));
        });
        let leaf;
        try {
          leaf = (await waitForFile(nestedPid)).trim();
          child.kill(signal);
          const code = await closed;
          assert.equal(code, signal === "SIGINT" ? 130 : 143, output);
          await assertDead(leaf);
        } finally {
          if (child.exitCode === null) {
            child.kill("SIGKILL");
            await closed;
          }
          for (const match of output.matchAll(/logs retained at (\/[^\r\n]+)/g))
            logs.push(match[1]);
          if (leaf) await assertDead(leaf);
        }
      }
    }
    const controller = new AbortController();
    controller.abort();
    const interrupted = await fails([fake("never", "process.exit(0)")], {
      signal: controller.signal,
    });
    assert.equal(interrupted.results.length, 0);
    for (const jobs of [0, 5, 1.5])
      await assert.rejects(runChecks([fake("x", "")], { ...options, jobs }));
    await assert.rejects(
      runChecks([{ ...fake("ui", ""), mode: "browser" }], {
        ...options,
        jobs: 2,
      }),
    );
    for (const timeoutMs of [0, Infinity, 1.2])
      await assert.rejects(
        runChecks([fake("x", "")], { ...options, timeoutMs }),
      );
    console.log(
      "Test runner: complete selection, mode/diagnostic gates, bounded isolated workers, grouped logs, failure propagation, hard timeout, sibling cancellation and cleanup passed.",
    );
  }
} catch (error) {
  if (error.logDir) logs.push(error.logDir);
  if (!lifetime.signal.aborted) throw error;
} finally {
  process.removeListener("SIGINT", onInt);
  process.removeListener("SIGTERM", onTerm);
  if (interrupted) process.exitCode = interrupted;
  await rm(directory, { recursive: true, force: true });
  await Promise.all(
    logs.map((path) => rm(path, { recursive: true, force: true })),
  );
}
