import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Production build goes straight into the collect-earth-app classpath, where
// LeafletMapController serves it: /earth/map -> leafletmap/map.html and
// /earth/map/assets/<file> -> leafletmap/<file>. All assets (JS, CSS, fonts) are
// bundled locally - Collect Earth must not depend on a CDN.
//
// `npm run dev` serves the page at http://localhost:5173/ and proxies the data
// endpoints to a running Collect Earth (localhost:8028).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/earth/map/assets/" : "/",
  build: {
    outDir: resolve(import.meta.dirname, "../../../target/classes/leafletmap"),
    emptyOutDir: true,
    assetsDir: "",
    // one ~700 kB bundle (React + MUI + Leaflet) loaded from localhost: splitting buys nothing
    chunkSizeWarningLimit: 1000,
    rollupOptions: { input: resolve(import.meta.dirname, "map.html") },
  },
  server: {
    proxy: { "/earth": "http://localhost:8028" },
  },
  test: { include: ["src/**/*.test.ts"] },
}));
