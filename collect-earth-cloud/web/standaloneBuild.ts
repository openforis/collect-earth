// The stand-alone analysis page (src/standalone.tsx) as one HTML file, web/dist/analysis-standalone.html, built with
// the dashboard (a plugin of vite.config.ts, so `vite build` alone makes it, as Collect Earth's build runs it). The
// server puts a project's data in it when it is downloaded (src/routes/analysis.ts): it then opens from the disk in any
// browser, with no server, no internet and no installation. How, as trial S7 found (trials/s7-pivot/README.md):
// - the page's script and styles inside the page, the fonts as data: URLs;
// - src/analysisAssets.standalone.ts in place of src/analysisAssets.ts: DuckDB's and Perspective's wasm and DuckDB's
//   worker gzipped and base64 in the page (window.__CE_ASSETS), not fetched;
// - every replacement in the page by a function: a replacement string would read the bundle's "$`" or "$&".
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import react from "@vitejs/plugin-react";
import { build } from "vite";

export const STANDALONE_FILE = "analysis-standalone.html";
/** Where the server puts the data (src/routes/analysis.ts STANDALONE_DATA). */
export const STANDALONE_DATA = "<!--CE_ANALYSIS_DATA-->";

const root = import.meta.dirname;
const modules = resolve(root, "node_modules");
const ASSETS = {
  duckdbWorker: "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
  duckdbWasm: "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm",
  perspectiveServer: "@perspective-dev/server/dist/wasm/perspective-server.wasm",
  perspectiveViewer: "@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm",
};

/** Builds the page into a scratch folder, then writes it as one file into outDir. */
export async function buildStandalone(outDir: string): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "ce-standalone-"));
  try {
    await build({
      configFile: false,
      root,
      base: "./",
      logLevel: "warn",
      plugins: [react()],
      resolve: { alias: [{ find: /^\.\/analysisAssets$/, replacement: resolve(root, "src/analysisAssets.standalone.ts") }] },
      build: {
        outDir: scratch,
        emptyOutDir: true,
        // Everything the page refers to inside it: the fonts and images as data: URLs, one script, one stylesheet
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        modulePreload: false,
        chunkSizeWarningLimit: 100_000,
        rolldownOptions: { input: resolve(root, "standalone.html"), output: { codeSplitting: false } },
      },
    });
    const files = readdirSync(join(scratch, "assets"));
    const scripts = files.filter((f) => f.endsWith(".js"));
    const styles = files.filter((f) => f.endsWith(".css"));
    if (scripts.length !== 1) throw new Error(`The stand-alone page has ${scripts.length} scripts, not one: ${scripts.join(", ")}`);
    const script = readFileSync(join(scratch, "assets", scripts[0]), "utf8").replace(/<\/script/gi, "<\\/script");
    const style = styles.map((f) => readFileSync(join(scratch, "assets", f), "utf8")).join("\n").replace(/<\/style/gi, "<\\/style");
    const assets = Object.fromEntries(Object.entries(ASSETS).map(([name, path]) => [name, gzipSync(readFileSync(join(modules, path)), { level: 9 }).toString("base64")]));

    let html = readFileSync(join(scratch, "standalone.html"), "utf8");
    // The built page's own references to its script and stylesheet, replaced by their contents
    html = html.replace(/\s*<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, () => "").replace(/\s*<link rel="stylesheet"[^>]*>/g, () => "");
    const head = `<style>${style}</style>\n<script>window.__CE_ASSETS=${JSON.stringify(assets)}</script>\n${STANDALONE_DATA}`;
    if (!html.includes("</head>") || !html.includes("</body>")) throw new Error("The stand-alone page has no head or body");
    html = html.replace("</head>", () => `${head}\n</head>`).replace("</body>", () => `<script type="module">${script}</script>\n</body>`);
    writeFileSync(join(outDir, STANDALONE_FILE), html);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
