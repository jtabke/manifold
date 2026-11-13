import { access } from "node:fs/promises";
import { localCanvasUrl } from "../../apps/assistant/src/canvas-url.mjs";

export async function doctor(args, version) {
  if (args.length && (args.length !== 2 || args[0] !== "--canvas-url")) {
    process.exitCode = 2;
    console.error(
      JSON.stringify({
        protocolVersion: 1,
        error: {
          code: "INVALID_ARGUMENT",
          message: "Usage: manifold doctor [--canvas-url URL]",
        },
      }),
    );
    return;
  }
  let page;
  try {
    page = localCanvasUrl(
      args[1] ?? process.env.MANIFOLD_CANVAS_URL ?? "http://127.0.0.1:58310/",
    );
  } catch (error) {
    process.exitCode = 2;
    console.error(
      JSON.stringify({
        protocolVersion: 1,
        error: { code: "INVALID_ARGUMENT", message: error.message },
      }),
    );
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  const runtime = major > 22 || (major === 22 && minor >= 18);
  const assets = await Promise.all(
    ["mcp.mjs", "workspace.mjs", "mcp-preview.html"].map(async (name) => {
      try {
        await access(new URL(name, import.meta.url));
        return { name, available: true };
      } catch {
        return { name, available: false };
      }
    }),
  );
  let canvas;
  try {
    const response = await fetch(page, {
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    });
    const reader = response.body?.getReader();
    let prefix = "";
    try {
      while (reader && prefix.length < 16384) {
        const { done, value } = await reader.read();
        if (done) break;
        prefix += new TextDecoder().decode(
          value.subarray(0, 16384 - prefix.length),
        );
      }
    } finally {
      await reader?.cancel();
    }
    const identified = /<title>Manifold(?:\s|—|-|<)/i.test(prefix);
    canvas = { reachable: response.ok, status: response.status, identified };
  } catch {
    canvas = {
      reachable: false,
      reason: "Local HTTP request failed or timed out",
    };
  }
  const ready =
    runtime &&
    assets.every((asset) => asset.available) &&
    canvas.reachable &&
    canvas.identified;
  console.log(
    JSON.stringify({
      protocolVersion: 1,
      version,
      ready,
      runtime: { version: process.versions.node, supported: runtime },
      assets,
      canvas: { origin: page.origin, ...canvas },
      permissions:
        "Not inspected or granted. Connect through MCP and grant permissions in the canvas.",
      recovery: ready
        ? "Use manifold mcp-config to configure your client, then call connect_canvas."
        : "Use Node 22.18+ and a complete package installation. Start the canvas separately (make canvas in a source checkout), or set MANIFOLD_CANVAS_URL to an existing local canvas.",
    }),
  );
  if (!ready) process.exitCode = 1;
}
