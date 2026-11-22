import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createApiMiddleware } from "./server/api.mjs";

export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, process.cwd(), "QWEATHER_");
  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] ??= value;
  }
  const api = createApiMiddleware();
  return {
    build: {
      outDir: "dist/client",
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ["echarts/core", "echarts/charts", "echarts/components", "echarts/renderers"],
            maps: ["leaflet"],
          },
        },
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "127.0.0.1",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react(), {
      name: "doumen-data",
      configureServer(server) { server.middlewares.use(api); },
      configurePreviewServer(server) { server.middlewares.use(api); },
    }],
  };
});
