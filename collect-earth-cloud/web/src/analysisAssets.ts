// Where the analysis engine takes DuckDB's and Perspective's files from: the dashboard's own build (web/dist/assets),
// served by the server it runs on. The stand-alone file has them inside it instead (analysisAssets.standalone.ts, put
// in place of this one by its build: web/standalone.config.ts).
import duckdbWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import serverWasm from "@perspective-dev/server/dist/wasm/perspective-server.wasm?url";
import viewerWasm from "@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm?url";

export interface AnalysisAssets {
  /** The URL of DuckDB's worker script. */
  duckdbWorker(): Promise<string>;
  /** The URL of DuckDB's wasm, which its worker fetches. */
  duckdbWasm(): Promise<string>;
  /** Perspective's server and viewer wasm, as responses (its loaders take a Response, not bytes alone). */
  perspectiveServer(): Promise<Response>;
  perspectiveViewer(): Promise<Response>;
}

export const analysisAssets: AnalysisAssets = {
  duckdbWorker: async () => duckdbWorker,
  duckdbWasm: async () => duckdbWasm,
  perspectiveServer: () => fetch(serverWasm),
  perspectiveViewer: () => fetch(viewerWasm),
};
