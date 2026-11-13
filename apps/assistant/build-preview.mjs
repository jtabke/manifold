import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function buildPreview(
  directory = new URL("./dist/", import.meta.url),
) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("../../", import.meta.url)),
    entryPoints: [
      fileURLToPath(new URL("./src/mcp-preview.mjs", import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    metafile: true,
  });
  const script = result.outputFiles[0].text.replace(
    /<\/script/gi,
    "<\\/script",
  );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Manifold canvas preview</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;color:light-dark(#18232d,#eee);background:light-dark(#fff,#18232d);color-scheme:light dark}img{display:block;max-width:100%;height:auto}img[hidden]{display:none}p{line-height:1.5}</style>
</head><body><h1>Canvas preview</h1><p id="status" role="status">Waiting for a canvas capture.</p>
<img id="preview" alt="Captured Manifold canvas; inspect semantic tools for exact values and evidence." hidden>
<script type="module">${script}</script></body></html>`;
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("mcp-preview.html", directory), html);
  return result.metafile;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildPreview();
