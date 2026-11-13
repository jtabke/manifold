import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const require = createRequire(
  new URL("../package.json", import.meta.url),
);

export function config(env = process.env) {
  const port = (name, fallback) => {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw Error(`${name} must be an integer from 1 to 65535`);
    return Number(value);
  };
  const apiPort = port("MANIFOLD_API_PORT", 58310);
  const devPort = port("MANIFOLD_DEV_PORT", 58311);
  if (apiPort === devPort) throw Error("API and development ports must differ");
  return { apiPort, devPort, python: env.PYTHON || "python3" };
}

export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
}

export function pythonInfo(python) {
  const result = spawnSync(
    python,
    [
      "-c",
      "import json,sys; print(json.dumps({'executable':sys.executable,'version':list(sys.version_info[:3])}))",
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  if (result.error || result.status !== 0)
    throw Error(
      `Cannot run ${python}. Install Python 3.11+ or set PYTHON to its executable.`,
    );
  const info = JSON.parse(result.stdout);
  if (info.version[0] !== 3 || info.version[1] < 11)
    throw Error(
      `${info.executable} is Python ${info.version.join(".")}; Python 3.11+ is required.`,
    );
  return info;
}

export function checkDependencies() {
  try {
    for (const name of [
      "vite/package.json",
      "typescript/package.json",
      "react/package.json",
      "@earendil-works/pi-coding-agent",
      "ws",
    ])
      accessSync(fileURLToPath(import.meta.resolve(name)));
  } catch {
    throw Error(
      "Missing workspace dependencies. Run npm ci from the repository root.",
    );
  }
}

/** Probe by binding, never by adopting or stopping an existing service. */
export async function assertPortFree(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        Error(
          `Cannot bind 127.0.0.1:${port} (${error.code}). Stop the service you own or choose MANIFOLD_API_PORT and MANIFOLD_DEV_PORT explicitly.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
