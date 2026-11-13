import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { config } from "../../scripts/dev-config.mjs";

const { apiPort, devPort } = config();

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: devPort,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
