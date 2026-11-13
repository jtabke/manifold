import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  config,
  root,
  require,
  nodeSupported,
  pythonInfo,
  checkDependencies,
  assertPortFree,
} from "./dev-config.mjs";

let failed = false;
function report(label, action, optional = false) {
  return Promise.resolve()
    .then(action)
    .then(
      (message) => console.log(`OK    ${label}: ${message}`),
      (error) => {
        console.log(
          `${optional ? "INFO" : "FAIL"}  ${label}: ${error.message}`,
        );
        if (!optional) failed = true;
      },
    );
}

console.log(
  "Manifold source-checkout diagnostics (no installs, provider calls, or service changes)\n",
);
await report("Node", () => {
  if (!nodeSupported())
    throw Error(
      `Node ${process.versions.node}; install Node 22.18+ (see .nvmrc).`,
    );
  return `${process.version} (${process.execPath})`;
});
let settings;
await report("Configuration", () => {
  settings = config();
  return `API ${settings.apiPort}, development ${settings.devPort}`;
});
await report("Dependencies", () => {
  checkDependencies();
  return "workspace dependencies found; use npm ci after lockfile changes";
});
if (settings) {
  await report("Python", () => {
    const info = pythonInfo(settings.python);
    return `${info.version.join(".")} (${info.executable})`;
  });
  for (const port of [settings.apiPort, settings.devPort]) {
    await report(`Port ${port}`, async () => {
      await assertPortFree(port);
      return "available";
    });
  }
  await report(
    "Optimizer (optional)",
    () => {
      const result = spawnSync(
        settings.python,
        [
          "-c",
          "from optimizer_transport import OptimizerHost; print(OptimizerHost().capability())",
        ],
        {
          cwd: `${root}/apps/canvas`,
          encoding: "utf8",
          timeout: 10000,
        },
      );
      if (result.error || result.status !== 0)
        throw Error(
          "not available in selected Python; basic canvas works without it. See docs/development/README.md#optional-numerical-runtime.",
        );
      return "available in selected Python";
    },
    true,
  );
}
await report(
  "Browser (optional for development)",
  async () => {
    const { chromium } = require("@playwright/test");
    const executable =
      process.env.MANIFOLD_BROWSER_EXECUTABLE || chromium.executablePath();
    try {
      await access(executable, constants.X_OK);
    } catch {
      throw Error(
        `not executable: ${executable}. Run npm run setup:browser or set MANIFOLD_BROWSER_EXECUTABLE to an absolute Chromium path.`,
      );
    }
    return `${executable} (installation check only; browser launch is verified by browser tests)`;
  },
  true,
);
console.log(
  `\n${failed ? "Resolve FAIL items above, then rerun npm run doctor." : "Base setup ready. Start with npm run dev."}`,
);
if (failed) process.exitCode = 1;
