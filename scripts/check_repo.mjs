/** Public repository boundaries, checked independently of builds or local research. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const inside = (path, dir) => path === dir || path.startsWith(dir + "/");

export function dependencyError(
  file,
  specifier,
  exports = [".", "./indexed-db"],
) {
  if (specifier.includes("node_modules/"))
    return "Import tools by package name";
  if (inside(file, "packages/foundation/src")) {
    if (!specifier.startsWith("."))
      return "Foundation runtime must have no external imports";
    const target = relative(root, resolve(root, dirname(file), specifier));
    if (!inside(target, "packages/foundation/src"))
      return "Foundation runtime must stay inside its package source";
  }
  if (inside(file, "apps/canvas")) {
    if (specifier.startsWith(".")) {
      const target = relative(root, resolve(root, dirname(file), specifier));
      if (inside(target, "packages") || inside(target, "experiments"))
        return "Use a declared public workspace package export";
    }
    if (
      specifier === "@manifold/foundation" ||
      specifier.startsWith("@manifold/foundation/")
    ) {
      const key =
        specifier === "@manifold/foundation"
          ? "."
          : "." + specifier.slice("@manifold/foundation".length);
      if (!exports.includes(key)) return "Undeclared foundation package export";
    }
    if (
      inside(file, "apps/canvas/src/regions/renderers") &&
      (specifier === "@manifold/foundation/indexed-db" ||
        /(?:^|\/)(canvasLocalStore|workspaceCodec|canvasBootstrap|canvasStorageBudget)(?:\.|$)/.test(
          specifier,
        ))
    ) {
      return "Renderers must use application ports, not durable storage or admission implementations";
    }
  }
}

export function imports(source, file) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const specs = [];
  function visit(node) {
    let spec;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      spec = node.moduleSpecifier;
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      spec = node.argument.literal;
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    )
      spec = node.arguments[0];
    if (spec && ts.isStringLiteralLike(spec)) specs.push(spec.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return specs;
}

function files(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = dir + "/" + entry.name;
      return entry.isDirectory()
        ? ["node_modules", "dist", "__pycache__"].includes(entry.name)
          ? []
          : files(path)
        : [path];
    });
}

/** Check the index against the actual ignore rules, including force-added private files. */
export function ignoredTrackedFiles(cwd = root) {
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });
  if (tracked.error || tracked.status !== 0)
    throw tracked.error || Error(tracked.stderr);
  if (!tracked.stdout) return [];
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--stdin", "-z"],
    {
      cwd,
      input: tracked.stdout,
      encoding: "utf8",
    },
  );
  if (ignored.error || ![0, 1].includes(ignored.status))
    throw ignored.error || Error(ignored.stderr);
  return ignored.stdout.split("\0").filter(Boolean);
}

function main() {
  const pkg = json("package.json"),
    foundation = json("packages/foundation/package.json"),
    canvas = json("apps/canvas/package.json"),
    lock = json("package-lock.json");
  assert.deepEqual(pkg.workspaces, ["apps/canvas", "packages/foundation"]);
  assert.equal(canvas.dependencies[foundation.name], foundation.version);
  for (const path of pkg.workspaces)
    assert.ok(lock.packages[path], `Missing locked workspace ${path}`);
  assert.equal(
    lock.packages["apps/canvas"].dependencies[foundation.name],
    foundation.version,
  );
  assert.equal(lock.packages["node_modules/@manifold/foundation"].link, true);
  const errors = [];
  let count = 0;
  for (const file of [
    ...files("apps/canvas"),
    ...files("packages/foundation"),
    ...files("scripts"),
  ].filter((p) => /\.(?:mjs|tsx?)$/.test(p))) {
    for (const specifier of imports(
      readFileSync(resolve(root, file), "utf8"),
      file,
    )) {
      count++;
      const reason = dependencyError(
        file,
        specifier,
        Object.keys(foundation.exports),
      );
      if (reason) errors.push(`${file}: ${specifier}: ${reason}`);
    }
  }
  for (const file of ignoredTrackedFiles())
    errors.push(
      `${file}: ignored local/build artifacts must not be published; untrack rather than delete local copies`,
    );
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(
    `Repository boundaries pass for ${count} imports; no ignored local artifacts are tracked.`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
