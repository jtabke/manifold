import { runCanvasMcp } from "./mcp.mjs";

runCanvasMcp().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
