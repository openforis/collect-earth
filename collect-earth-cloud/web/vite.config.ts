import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The production build goes to web/dist, which the cloud server serves at "/" (and
// returns index.html for app routes such as /join/<token>, /projects/..., /setup).
//
// `npm run dev` serves the dashboard at http://localhost:5173/ and proxies the API
// to a cloud server running on localhost:8080 (`npm run dev` in collect-earth-cloud);
// set API_TARGET to use another one.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8080";

/**
 * A .gz beside each large file of the build, which the server sends to browsers that take gzip (@fastify/static's
 * preCompressed): the analysis page's DuckDB wasm is 36 MB, 8 MB gzipped. Only where gzip saves a tenth or more.
 */
function gzipAssets(outDir: string) {
  return {
    name: "gzip-assets",
    apply: "build" as const,
    closeBundle() {
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
      for (const file of walk(outDir)) {
        if (!/\.(js|css|wasm|svg|json|html)$/.test(file) || statSync(file).size < 10_000) continue;
        const raw = readFileSync(file);
        const gz = gzipSync(raw, { level: 9 });
        if (gz.length < raw.length * 0.9) writeFileSync(`${file}.gz`, gz);
      }
    },
  };
}

const outDir = resolve(import.meta.dirname, "dist");

export default defineConfig({
  plugins: [react(), gzipAssets(outDir)],
  base: "/",
  build: {
    outDir,
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
