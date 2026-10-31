import { readFile, mkdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const browser = process.argv.includes("--browser");
const requested = process.argv.slice(2).filter((name) => name !== "--browser");
const files = [];
const checks = [
  "check-drawing.mjs",
  "check-drawing-regularization.mjs",
  "check-drawing-browser.mjs",
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
  "check-incremental-worksheet.mjs",
  "check-models.mjs",
  "check-progressive-links.mjs",
  "check-regions.mjs",
  "check-relationship-navigation.mjs",
  "check-workspace-polish.mjs",
  "check-blank-canvas-browser.mjs",
  "check-native-workspace-browser.mjs",
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
  "check-canvas-navigation-browser.mjs",
  "check-command-consistency-browser.mjs",
  "check-exploration-browser.mjs",
  "check-incremental-worksheet-browser.mjs",
  "check-equation-editing.mjs",
  "check-linking-browser.mjs",
  "check-dataset-browser.mjs",
  "check-models-browser.mjs",
];
for (const name of checks) {
  const source = await readFile(
    new URL(`../tests/${name}`, import.meta.url),
    "utf8",
  );
  if (source.includes("@playwright/test") !== browser) continue;
  if (
    requested.length &&
    !requested.some((item) => name === `${item}.mjs` || name === item)
  )
    continue;
  files.push(name);
}
if (!files.length)
  throw new Error(
    "No matching checks. Use check filenames, with or without .mjs.",
  );

let server;
try {
  if (browser)
    await mkdir(new URL("../../../evidence/current/canvas/", import.meta.url), {
      recursive: true,
    });
  let baseURL = process.env.MANIFOLD_BASE_URL;
  if (browser && !baseURL) {
    baseURL = "http://127.0.0.1:58312";
    // A private port leaves the engineer's normal app and saved canvas alone.
    server = spawn(
      process.env.PYTHON || "python3",
      ["server.py", "--port", "58312"],
      {
        cwd: root,
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    let startupError;
    server.on("error", (error) => {
      startupError = error;
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null)
        throw new Error("Canvas server exited before becoming ready.");
      try {
        ready = (await fetch(`${baseURL}/api/health`)).ok;
      } catch {
        /* Server is starting. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready)
      throw new Error("Canvas server did not become ready within 10 seconds.");
  }
  for (const name of files) {
    console.log(`\n${name}`);
    const result = spawnSync(process.execPath, [`tests/${name}`], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(baseURL ? { MANIFOLD_BASE_URL: baseURL } : {}),
      },
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${name} failed (${result.status ?? result.signal}).`);
  }
  console.log(
    `\n${files.length} ${browser ? "browser" : "local"} checks passed.`,
  );
} finally {
  server?.kill();
}
