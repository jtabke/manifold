import { spawn, spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  root,
  require,
  config,
  nodeSupported,
  pythonInfo,
  checkDependencies,
  assertPortFree,
} from "./dev-config.mjs";

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") {
      // Windows has no POSIX process groups; terminate the owned child tree.
      if (!child.ended)
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
    } else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop(child) {
  if (!child) return;
  signalChild(child, "SIGTERM");
  const timer = setTimeout(() => signalChild(child, "SIGKILL"), 6000);
  try {
    await child.done;
  } finally {
    clearTimeout(timer);
    // Also remove descendants if a crashed child left them running.
    signalChild(child, "SIGKILL");
  }
}

async function snapshot(directory) {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".py"))
    .sort();
  return JSON.stringify(
    await Promise.all(
      names.map(async (name) => {
        try {
          const info = await stat(join(directory, name));
          return [name, info.mtimeMs, info.size];
        } catch (error) {
          if (error.code === "ENOENT") return [name, null];
          throw error;
        }
      }),
    ),
  );
}

async function ready(url, child, cancelled, deadlineMs = 20000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline && !cancelled()) {
    if (child.ended) throw Error("Service exited before becoming ready");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      /* The owned service is still starting. */
    }
    await delay(100);
  }
  if (!cancelled()) throw Error(`Timed out waiting for ${url}`);
}

/** Options allow lifecycle tests to use isolated source directories and child services. */
export async function runDev({
  settings = config(),
  sourceDir = join(root, "apps/canvas"),
  backendCommand = [
    settings.python,
    join(root, "apps/canvas/server.py"),
    "--port",
    String(settings.apiPort),
    "--dev-port",
    String(settings.devPort),
  ],
  frontendCommand = [
    process.execPath,
    join(require.resolve("vite/package.json"), "../bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(settings.devPort),
    "--strictPort",
  ],
  pollMs = 500,
} = {}) {
  let closing = false,
    failure,
    backend,
    frontend;
  const children = new Set();
  const cancelled = () => closing;
  const shutdown = () => {
    closing = true;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  function launch(label, command, cwd) {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: {
        ...process.env,
        MANIFOLD_API_PORT: String(settings.apiPort),
        MANIFOLD_DEV_PORT: String(settings.devPort),
        PYTHONUNBUFFERED: "1",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", (line) => {
        // The supervisor prints the only browser URL after both services are ready.
        if (!/Manifold canvas:|➜\s+(?:Local|Network):/.test(line))
          console.log(`[${label}] ${line}`);
      });
    }
    child.done = new Promise((resolve) => {
      child.once("error", (error) => {
        failure ??= Error(`${label} failed to start: ${error.message}`);
        closing = true;
      });
      child.once("close", (code, signal) => {
        child.ended = true;
        if (!child.expectedStop && !closing) {
          failure = Error(`${label} exited (${signal || code})`);
          closing = true;
        }
        resolve();
      });
    });
    return child;
  }
  const apiUrl = `http://127.0.0.1:${settings.apiPort}/api/health`;
  const devUrl = `http://127.0.0.1:${settings.devPort}/`;
  try {
    await assertPortFree(settings.apiPort);
    await assertPortFree(settings.devPort);
    let previous = await snapshot(sourceDir);
    if (closing) return;
    backend = launch("python", backendCommand, root);
    await ready(apiUrl, backend, cancelled);
    if (closing) return;
    frontend = launch("vite", frontendCommand, join(root, "apps/canvas"));
    await ready(devUrl, frontend, cancelled);
    if (closing) return;
    console.log(`\nManifold development: ${devUrl}`);
    console.log(
      "Frontend hot updates enabled; Python changes restart the backend. Ctrl-C stops both.",
    );
    console.log(
      "Backend restarts interrupt active computations and assistant sessions.\n",
    );
    while (!closing) {
      await delay(pollMs);
      if (closing) break;
      const current = await snapshot(sourceDir);
      if (current !== previous) {
        previous = current;
        console.log("[dev] Python source changed; restarting backend…");
        backend.expectedStop = true;
        await stop(backend);
        children.delete(backend);
        if (closing) break;
        backend = launch("python", backendCommand, root);
        await ready(apiUrl, backend, cancelled);
        if (!closing) console.log("[dev] Backend ready.");
      }
    }
  } finally {
    closing = true;
    await Promise.all([...children].map(stop));
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    if (failure) throw failure;
  }
}

async function main() {
  try {
    if (!nodeSupported()) throw Error("Node 22.18+ is required.");
    const settings = config();
    pythonInfo(settings.python);
    checkDependencies();
    await runDev({ settings });
  } catch (error) {
    console.error(
      `[dev] ${error.message}\nRun npm run doctor for setup diagnostics.`,
    );
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
