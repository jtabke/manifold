import { readFile, mkdir, mkdtemp, rm, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createConnection } from "node:net";

const root = fileURLToPath(new URL("../", import.meta.url));
const names = [
  "check-test-runner.mjs",
  "check-headless.mjs",
  "check-headless-discovery.mjs",
  "check-headless-authoring.mjs",
  "check-agent.mjs",
  "check-canvas-assistant.mjs",
  "check-canvas-mcp.mjs",
  "check-agent-cli.mjs",
  "check-agent-skill.mjs",
  "check-agent-compact.mjs",
  "check-agent-conduction.mjs",
  "check-agent-recovery.mjs",
  "check-drawing.mjs",
  "check-drawing-regularization.mjs",
  "check-drawing-browser.mjs",
  "check-drawing-scene-browser.mjs",
  "check-drawing-regularization-browser.mjs",
  "check-drawing-performance-browser.mjs",
  "check-drawing-publication-profile.mjs",
  "check-areas.mjs",
  "check-artifacts.mjs",
  "check-artifact-computations.mjs",
  "check-sampling-plans.mjs",
  "check-shared-sampling.mjs",
  "check-bare-expressions.mjs",
  "check-canvas-scene.mjs",
  "check-portable-scene.mjs",
  "check-canvas-document.mjs",
  "check-targeted-authoring.mjs",
  "check-foundation-models.mjs",
  "check-authored-models.mjs",
  "check-model-analyses.mjs",
  "check-canvas-storage.mjs",
  "check-canvas-capacity.mjs",
  "check-capacity-fixture.mjs",
  "check-storage-budget.mjs",
  "check-save-yielding.mjs",
  "check-canvas-retention.mjs",
  "check-result-snapshots.mjs",
  "check-calculation-history.mjs",
  "check-workspace-owner.mjs",
  "check-workspace-lifecycle.mjs",
  "check-commands.mjs",
  "check-shortcut-bindings.mjs",
  "check-exploration.mjs",
  "check-data-feedback.mjs",
  "check-data-sources.mjs",
  "check-dataset-model.mjs",
  "check-infinite-viewport.mjs",
  "check-linking.mjs",
  "check-math.mjs",
  "check-scientific-math.mjs",
  "check-scientific-math-browser.mjs",
  "check-math-typesetting-browser.mjs",
  "check-incremental-worksheet.mjs",
  "check-models.mjs",
  "check-progressive-links.mjs",
  "check-regions.mjs",
  "check-relationship-navigation.mjs",
  "check-workspace-polish.mjs",
  "check-blank-canvas-browser.mjs",
  "check-native-workspace-browser.mjs",
  "check-agent-handoff-browser.mjs",
  "check-canvas-assistant-browser.mjs",
  "check-canvas-mcp-browser.mjs",
  "check-portable-scene-browser.mjs",
  "check-layout-gestures-browser.mjs",
  "check-overlap-browser.mjs",
  "check-shortcut-help-browser.mjs",
  "check-shortcut-config-browser.mjs",
  "check-renderer-buffers-browser.mjs",
  "check-canvas-scene-performance-browser.mjs",
  "check-foundation-models-browser.mjs",
  "check-authored-models-browser.mjs",
  "check-model-analyses-browser.mjs",
  "check-canvas-storage-browser.mjs",
  "check-canvas-capacity-browser.mjs",
  "check-canvas-retention-browser.mjs",
  "check-calculation-history-browser.mjs",
  "check-workspace-owner-browser.mjs",
  "check-authoring-recovery-browser.mjs",
  "check-canvas-actions-browser.mjs",
  "check-selection-png-browser.mjs",
  "check-canvas-navigation-browser.mjs",
  "check-command-consistency-browser.mjs",
  "check-exploration-browser.mjs",
  "check-exploration-input-browser.mjs",
  "check-incremental-worksheet-browser.mjs",
  "check-equation-editing.mjs",
  "check-linking-browser.mjs",
  "check-connection-gestures-browser.mjs",
  "check-dataset-browser.mjs",
  "check-models-browser.mjs",
];
export const checks = names.map((name) => {
  const mode =
    name.endsWith("-browser.mjs") || name === "check-equation-editing.mjs"
      ? "browser"
      : "local";
  const diagnostic = name === "check-drawing-performance-browser.mjs";
  return {
    name,
    mode,
    diagnostic,
    timeoutMs: diagnostic ? 900000 : mode === "browser" ? 300000 : 60000,
  };
});

export function selectChecks(
  manifest,
  { mode = "local", diagnostic = false, requested = [] } = {},
) {
  const selected = requested.map((name) =>
    name.endsWith(".mjs") ? name : `${name}.mjs`,
  );
  if (new Set(selected).size !== selected.length)
    throw Error("Duplicate requested check");
  for (const name of selected) {
    const check = manifest.find((check) => check.name === name);
    if (!check) throw Error(`Unknown check: ${name}`);
    if (check.mode !== mode)
      throw Error(
        `${name} requires ${check.mode === "browser" ? "--browser" : "local mode (omit --browser)"}`,
      );
    if (check.diagnostic !== diagnostic)
      throw Error(
        `${name} ${check.diagnostic ? "requires" : "does not use"} --diagnostic`,
      );
  }
  const files = manifest.filter(
    (check) =>
      check.mode === mode &&
      check.diagnostic === diagnostic &&
      (!selected.length || selected.includes(check.name)),
  );
  if (!files.length) throw Error("No matching checks");
  return files;
}

function terminate(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

/** One isolated child; timeout/interruption reaps its POSIX process group as well. */
async function execute(
  check,
  { cwd, env, log, signal, timeoutMs, killGraceMs },
) {
  const started = performance.now();
  const handle = await open(log, "w");
  let child, timer, reason;
  let escalate;
  const stop = (why) => {
    reason ??= why;
    terminate(child, "SIGTERM");
    escalate ??= setTimeout(() => terminate(child, "SIGKILL"), killGraceMs);
  };
  const interrupt = () => stop("interrupted");
  try {
    const [command, ...args] = check.command ?? [
      process.execPath,
      `tests/${check.name}`,
    ];
    child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", handle.fd, handle.fd],
    });
    const ended = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error: error.message }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    signal?.addEventListener("abort", interrupt, { once: true });
    if (signal?.aborted) interrupt();
    timer = setTimeout(() => stop("timeout"), timeoutMs ?? check.timeoutMs);
    const result = await ended;
    // A failed or successful leader must not leave daemon descendants behind.
    terminate(child, "SIGKILL");
    return {
      name: check.name,
      ...result,
      ...(reason ? { reason } : {}),
      passed: !reason && !result.error && result.code === 0,
      ms: Math.round(performance.now() - started),
      log,
    };
  } finally {
    clearTimeout(timer);
    clearTimeout(escalate);
    signal?.removeEventListener("abort", interrupt);
    await handle.close();
  }
}

/** Bounded local parallelism retains process isolation and non-interleaved, durable failure logs. */
export async function runChecks(
  files,
  {
    cwd = root,
    env = process.env,
    jobs = 1,
    timeoutMs,
    killGraceMs = 1000,
    signal,
    report = console.log,
  } = {},
) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4)
    throw Error("--jobs must be an integer from 1 to 4");
  if (
    jobs !== 1 &&
    files.some((check) => check.mode !== "local" || check.diagnostic)
  )
    throw Error("Browser and diagnostic workloads must run serially");
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
  )
    throw Error(
      "MANIFOLD_CHECK_TIMEOUT_MS must be an integer from 1 to 2147483647",
    );
  if (!Number.isInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > 1000)
    throw Error("killGraceMs must be an integer from 1 to 1000");
  const logDir = await mkdtemp(join(tmpdir(), "manifold-checks-"));
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const results = [],
    workerErrors = [];
  let index = 0,
    failed = false;
  try {
    await Promise.all(
      Array.from({ length: Math.min(jobs, files.length) }, async () => {
        try {
          while (!controller.signal.aborted && index < files.length) {
            const check = files[index++];
            const result = await execute(check, {
              cwd,
              env,
              log: join(logDir, check.name + ".log"),
              signal: controller.signal,
              timeoutMs,
              killGraceMs,
            });
            results.push(result);
            if (!result.passed) {
              failed = true;
              controller.abort();
            }
            report(
              `\n${result.name} (${result.ms} ms)\n${await readFile(result.log, "utf8")}`,
            );
          }
        } catch (error) {
          workerErrors.push(error.message);
          failed = true;
          controller.abort();
        }
      }),
    );
    if (failed || controller.signal.aborted) {
      const failures = results
        .filter((result) => !result.passed)
        .map(
          (result) =>
            `${result.name}: ${result.reason ?? result.error ?? result.signal ?? `exit ${result.code}`}`,
        )
        .join(", ");
      const error = Error(
        `Checks failed or interrupted (${[failures, ...workerErrors].filter(Boolean).join("; ") || "cancelled before launch"}); logs retained at ${logDir}`,
      );
      error.results = results;
      error.logDir = logDir;
      throw error;
    }
    await rm(logDir, { recursive: true, force: true });
    return results;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function occupied(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      resolve(error.code !== "ECONNREFUSED");
    });
  });
}

async function main() {
  const requested = [];
  let mode = "local",
    diagnostic = false,
    jobs = 1,
    list = false;
  const seen = new Set();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      requested.push(arg);
      continue;
    }
    if (seen.has(arg)) throw Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === "--browser") mode = "browser";
    else if (arg === "--diagnostic") diagnostic = true;
    else if (arg === "--list") list = true;
    else if (arg === "--jobs") jobs = Number(args[++i]);
    else throw Error(`Unknown option: ${arg}`);
  }
  const files = selectChecks(checks, { mode, diagnostic, requested });
  if (
    !Number.isInteger(jobs) ||
    jobs < 1 ||
    jobs > 4 ||
    (mode === "browser" && jobs !== 1)
  )
    throw Error("Use --jobs 1..4 locally; browser workloads must run serially");
  if (list) {
    console.log(JSON.stringify(files, null, 2));
    return;
  }
  const timeoutMs =
    process.env.MANIFOLD_CHECK_TIMEOUT_MS === undefined
      ? undefined
      : Number(process.env.MANIFOLD_CHECK_TIMEOUT_MS);
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647)
  )
    throw Error(
      "MANIFOLD_CHECK_TIMEOUT_MS must be an integer from 1 to 2147483647",
    );
  let server, serverEnded;
  const controller = new AbortController();
  let interrupted;
  const onSignal = (signal) => {
    interrupted = signal;
    controller.abort();
  };
  const onInt = () => onSignal("SIGINT"),
    onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    let baseURL = process.env.MANIFOLD_BASE_URL;
    if (mode === "browser")
      await mkdir(
        new URL("../../../evidence/current/canvas/", import.meta.url),
        { recursive: true },
      );
    if (mode === "browser" && !baseURL) {
      if (await occupied(58312))
        throw Error(
          "Port 58312 is already owned; use an explicit MANIFOLD_BASE_URL for a server you own",
        );
      baseURL = "http://127.0.0.1:58312";
      server = spawn(
        process.env.PYTHON || "python3",
        ["server.py", "--port", "58312"],
        {
          cwd: root,
          detached: process.platform !== "win32",
          stdio: ["ignore", "inherit", "inherit"],
        },
      );
      let startupError;
      serverEnded = new Promise((resolve) => {
        server.once("error", (error) => {
          startupError = error;
          resolve();
        });
        server.once("close", resolve);
      });
      let ready = false;
      const startupDeadline = performance.now() + 10000;
      while (
        performance.now() < startupDeadline &&
        !controller.signal.aborted
      ) {
        if (startupError) throw startupError;
        if (server.exitCode !== null)
          throw Error("Canvas server exited before becoming ready");
        try {
          ready = (
            await fetch(`${baseURL}/api/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok;
        } catch {
          /* Starting. */
        }
        if (ready) break;
        await delay(100);
      }
      if (!ready)
        throw Error("Canvas server did not become ready or was interrupted");
    }
    const results = await runChecks(files, {
      jobs,
      signal: controller.signal,
      timeoutMs,
      env: {
        ...process.env,
        ...(baseURL ? { MANIFOLD_BASE_URL: baseURL } : {}),
      },
    });
    console.log(
      `\n${results.length} ${diagnostic ? "diagnostic" : mode} checks passed.`,
    );
  } finally {
    if (server) {
      terminate(server, "SIGTERM");
      const timer = setTimeout(() => terminate(server, "SIGKILL"), 1000);
      await serverEnded;
      terminate(server, "SIGKILL");
      clearTimeout(timer);
    }
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
    if (interrupted) process.exitCode = interrupted === "SIGINT" ? 130 : 143;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode ||= 1;
  });
}
