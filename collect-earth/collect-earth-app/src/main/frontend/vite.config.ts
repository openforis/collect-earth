import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Production build goes straight into the collect-earth-app classpath, where
// LeafletMapController serves it: /earth/map -> leafletmap/map.html, /earth/form ->
// leafletmap/form.html (the data entry form) and /earth/map/assets/<file> -> leafletmap/<file>. All assets (JS, CSS, fonts) are
// bundled locally - Collect Earth must not depend on a CDN.
//
// `npm run dev` serves the page at http://localhost:5173/ and proxies the data
// endpoints to a running Collect Earth (localhost:8028).
// The look Collect Earth shares with the dashboard (its theme and logo), in collect-earth-cloud, whose Docker build
// sees only that folder: imported here as @shared.
const shared = resolve(import.meta.dirname, "../../../../../collect-earth-cloud/web/src/shared");

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: { alias: { "@shared": shared } },
  base: command === "build" ? "/earth/map/assets/" : "/",
  build: {
    outDir: resolve(import.meta.dirname, "../../../target/classes/leafletmap"),
    emptyOutDir: true,
    assetsDir: "",
    // build-manifest.json: the files of the build, which LeafletMapController lets the browser keep a year (HttpCaching);
    // not in .vite/, as a jar may leave out a folder whose name starts with a dot
    manifest: "build-manifest.json",
    // React + MUI (+ Leaflet for the plot preview of the settings) loaded from localhost: the two pages share a chunk
    chunkSizeWarningLimit: 1000,
    rollupOptions: { input: { map: resolve(import.meta.dirname, "map.html"), form: resolve(import.meta.dirname, "form.html") } },
  },
  server: {
    proxy: { "/earth": "http://localhost:8028" },
    // the dev server serves files outside this folder only when allowed
    fs: { allow: [import.meta.dirname, shared] },
  },
  test: { include: ["src/**/*.test.ts"] },
}));
