import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("workbench", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 58317,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        workbench: fileURLToPath(
          new URL("workbench/index.html", import.meta.url),
        ),
        composition: fileURLToPath(
          new URL("workbench/composition.html", import.meta.url),
        ),
      },
    },
  },
});
