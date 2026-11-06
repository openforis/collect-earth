// The analysis engine's files in the stand-alone file: gzipped and base64 in the page (window.__CE_ASSETS, written by
// web/standalone.config.ts), as trial S7 found works from a page opened from the disk, with no server:
// - DuckDB's worker from a blob: URL, its wasm from a data: URL (the worker of a file:// page cannot fetch a blob: one);
// - Perspective's wasm as a Response of the bytes.
import type { AnalysisAssets } from "./analysisAssets";

declare global {
  interface Window {
    __CE_ASSETS?: Record<"duckdbWorker" | "duckdbWasm" | "perspectiveServer" | "perspectiveViewer", string>;
  }
}

async function gunzip(name: keyof NonNullable<Window["__CE_ASSETS"]>): Promise<Uint8Array> {
  const base64 = window.__CE_ASSETS?.[name];
  if (!base64) throw new Error(`The stand-alone file lacks ${name}`);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const wasm = (bytes: Uint8Array) => new Response(bytes as BlobPart, { headers: { "content-type": "application/wasm" } });

export const analysisAssets: AnalysisAssets = {
  duckdbWorker: async () => URL.createObjectURL(new Blob([(await gunzip("duckdbWorker")) as BlobPart], { type: "text/javascript" })),
  duckdbWasm: async () => `data:application/wasm;base64,${base64(await gunzip("duckdbWasm"))}`,
  perspectiveServer: async () => wasm(await gunzip("perspectiveServer")),
  perspectiveViewer: async () => wasm(await gunzip("perspectiveViewer")),
};
