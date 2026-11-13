#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import packageJson from "./package.json" with { type: "json" };
const { version } = packageJson;

const args = process.argv.slice(2);
if (args[0] === "--version" || args[0] === "-v") {
  if (args.length !== 1) invalid("Version takes no options");
  else console.log(version);
} else if (args[0] === "mcp") {
  if (args.length !== 1)
    invalid(
      "Use manifold mcp with no arguments; set MANIFOLD_CANVAS_URL in the environment",
    );
  else await import("./mcp.mjs");
} else if (args[0] === "mcp-config") {
  if (args.length !== 1) invalid("mcp-config takes no options");
  else
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            manifold: {
              command: process.execPath,
              args: [fileURLToPath(new URL("./mcp.mjs", import.meta.url))],
            },
          },
        },
        null,
        2,
      ),
    );
} else if (args[0] === "doctor") {
  const { doctor } = await import("./doctor.mjs");
  await doctor(args.slice(1), version);
} else {
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(`Manifold installed tools ${version}
  manifold doctor [--canvas-url URL]   Check runtime and local canvas, without granting access
  manifold mcp-config                  Print MCP client configuration for this installation
  manifold mcp                         Run the stdio MCP server (no startup chatter)
  manifold --version                   Print the package version
File workflow: create → inspect → edit → validate → diff → explicit compute.
Save a separate candidate, then open it in the canvas for human review.
`);
  }
  await import("./workspace.mjs");
}
function invalid(message) {
  process.exitCode = 2;
  console.error(
    JSON.stringify({
      protocolVersion: 1,
      error: { code: "INVALID_ARGUMENT", message },
    }),
  );
}
