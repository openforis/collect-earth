import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The production build goes to web/dist, which the cloud server serves at "/" (and
// returns index.html for app routes such as /join/<token>, /projects/..., /setup).
//
// `npm run dev` serves the dashboard at http://localhost:5173/ and proxies the API
// to a cloud server running on localhost:8080 (`npm run dev` in collect-earth-cloud);
// set API_TARGET to use another one.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // changeOrigin false: the server sees this page's host, so the join and reset
    // links it makes point at the dev server.
    proxy: {
      "/v1": { target: apiTarget, changeOrigin: false },
      "/health": { target: apiTarget, changeOrigin: false },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
