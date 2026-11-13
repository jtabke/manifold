import { build } from "esbuild";
import {
  cp,
  mkdir,
  rm,
  chmod,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { dirname, resolve, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreview } from "../../apps/assistant/build-preview.mjs";

const root = new URL("../../", import.meta.url);
const out = new URL("./dist/", import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const result = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: {
    main: "packages/cli/main.mjs",
    workspace: "apps/canvas/tools/manifold.mjs",
    mcp: "apps/assistant/src/mcp-main.mjs",
    doctor: "packages/cli/doctor.mjs",
  },
  outdir: fileURLToPath(out),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["ws"],
  plugins: [
    {
      name: "installed-entrypoints",
      setup(build) {
        build.onResolve(
          { filter: /^\.\/(workspace|mcp|doctor)\.mjs$/ },
          (args) =>
            args.importer.endsWith("/packages/cli/main.mjs")
              ? { path: args.path, external: true }
              : undefined,
        );
      },
    },
  ],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  metafile: true,
});
if (
  Object.keys(result.metafile.inputs).some((path) =>
    path.includes("pi-coding-agent"),
  )
)
  throw Error("Standalone tools must not include the Pi assistant runtime");
const preview = await buildPreview(out);
await writeFile(
  new URL("mcp.mjs", out),
  "#!/usr/bin/env node\n" + (await readFile(new URL("mcp.mjs", out), "utf8")),
);
for (const name of ["main.mjs", "mcp.mjs"])
  await chmod(new URL(name, out), 0o755);
await cp(new URL("LICENSE", root), new URL("LICENSE", out));
// Bundled dependencies need their full licenses/notices, not only retained code comments.
const packages = new Map();
for (const input of new Set([
  ...Object.keys(result.metafile.inputs),
  ...Object.keys(preview.inputs),
])) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(fileURLToPath(root), input));
  while (directory !== parse(directory).root) {
    try {
      const metadata = JSON.parse(
        await readFile(resolve(directory, "package.json"), "utf8"),
      );
      if (metadata.name && metadata.version) {
        packages.set(directory, metadata);
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
}
const notices = ["Third-party software bundled in Manifold agent tools.\n"];
for (const [directory, metadata] of [...packages].sort((a, b) =>
  a[1].name.localeCompare(b[1].name),
)) {
  notices.push("\n## " + metadata.name + " " + metadata.version + "\n");
  const files = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) =>
      entry.isFile() &&
      /^(license|licence|notice|copying)([.-]|$)/i.test(entry.name),
  );
  if (!files.length) {
    // Some upstream packages keep licensing in their README or source header.
    const readme = await readFile(
      resolve(directory, "README.md"),
      "utf8",
    ).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return "";
    });
    const source = await readFile(
      resolve(directory, metadata.main ?? "index.js"),
      "utf8",
    );
    const header = /^\s*\/\*[\s\S]*?\*\//.exec(source)?.[0] ?? "";
    const notice = /license|copyright/i.test(readme) ? readme : header;
    if (!/license|copyright/i.test(notice))
      throw Error("Missing distribution license for " + metadata.name);
    notices.push("Upstream declares " + metadata.license + ":\n" + notice);
  }
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    notices.push(
      "\n### " +
        file.name +
        "\n" +
        (await readFile(resolve(directory, file.name), "utf8")),
    );
  }
}
await writeFile(new URL("THIRD_PARTY_NOTICES.txt", out), notices.join("\n"));
const skill = await readFile(
  new URL(".agents/skills/manifold/SKILL.md", root),
  "utf8",
);
await writeFile(
  new URL("SKILL.md", out),
  skill.replace(
    /\]\(\.\.\/\.\.\/\.\.\//g,
    "](https://github.com/jtabke/manifold/blob/main/",
  ),
);
