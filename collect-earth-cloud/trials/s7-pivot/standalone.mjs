// Trial S7: the stand-alone tool, one HTML file: the page, DuckDB-WASM (its wasm gzipped and base64), Perspective
// (its JS and wasm inlined), and the data (gzipped and base64), opened from the disk with no server and no install.
// node standalone.mjs <rows>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { execSync } from "node:child_process";

const rows = process.argv[2] ?? "55";
const site = "../site", out = "../out";
mkdirSync(`${out}/standalone`, { recursive: true });
const b64gz = (buf) => gzipSync(buf, { level: 9 }).toString("base64");

// 1. A bundle variant: Perspective's ESM builds with their wasm as bytes, DuckDB's worker and wasm from Blob URLs.
const prelude = `
import perspective, { init_server, init_client } from "@perspective-dev/client";
import SERVER_WASM from "@perspective-dev/server/dist/wasm/perspective-server.wasm";
import CLIENT_WASM from "@perspective-dev/client/dist/wasm/perspective-js.wasm";
import { init_client as initViewer } from "@perspective-dev/viewer";
import VIEWER_WASM from "@perspective-dev/viewer/dist/wasm/perspective-viewer.wasm";
import "@perspective-dev/viewer-datagrid";
import "@perspective-dev/viewer-charts";
import DUCKDB_WORKER from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js";
const gunzip = async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const ds = new DecompressionStream("gzip"); const stream = new Blob([bytes]).stream().pipeThrough(ds); return new Uint8Array(await new Response(stream).arrayBuffer()); };
window.STANDALONE = {
  // As the CDN builds call them: with a Response of the wasm (bytes alone leave the glue uninitialised)
  async perspective() { const resp = (b) => new Response(b, { headers: { "content-type": "application/wasm" } }); await init_server(resp(SERVER_WASM)); await init_client(resp(CLIENT_WASM)); await initViewer(resp(VIEWER_WASM)); return perspective; },
  duckdbWorker: () => URL.createObjectURL(new Blob([DUCKDB_WORKER], { type: "text/javascript" })),
  // A data: URL, not a blob: one: from a page opened from the disk (file://, an opaque origin) the worker cannot fetch a blob URL
  async duckdbWasm() { const bytes = await gunzip(window.DUCKDB_WASM_GZ); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return "data:application/wasm;base64," + btoa(bin); },
  async text(name) { return new TextDecoder().decode(await gunzip(window.DATA_GZ[name])); },
};
`;
writeFileSync("standalone-prelude.js", prelude);
let main = readFileSync("main.js", "utf8");
main = main
  .replace(`const worker = new Worker(asset("duckdb-browser-eh.worker.js"));`, `const worker = new Worker(window.STANDALONE.duckdbWorker());`)
  .replace(`await db.instantiate(asset("duckdb-eh.wasm"));`, `await db.instantiate(await window.STANDALONE.duckdbWasm());`)
  .replace(`  if (window.DATA && window.DATA[name]) return window.DATA[name];`, `  if (window.DATA_GZ && window.DATA_GZ[name]) return window.STANDALONE.text(name);`)
  .replace(/  \/\/ Perspective's CDN layout[\s\S]*?window\.__step = "worker"; const ws = await perspective\.worker\(\);/, `  const perspective = await window.STANDALONE.perspective();\n  const ws = await perspective.worker();`);
writeFileSync("standalone-main.js", `import "./standalone-prelude.js";\n` + main);
execSync(`npx esbuild standalone-main.js --bundle --format=esm --minify --loader:.wasm=binary --loader:.worker.js=text --outfile=${out}/standalone/bundle.js`, { stdio: "inherit" });
const bundle = readFileSync(`${out}/standalone/bundle.js`, "utf8");

// 2. The data: the model, the tables of this size, the code lists
const data = {};
const names = ["model.json", `plot-${rows}.csv`, `land_cover-${rows}.csv`, `land_use-${rows}.csv`, ...readFileSync("../out/model.json", "utf8").match(/"lists": \{[\s\S]*/)[0].match(/"([a-z_]+)": \{\n\s+"items": \[\n\s+\{/g).map((m) => `list-${m.match(/"([a-z_]+)"/)[1]}.csv`)];
let raw = 0;
for (const n of names) { try { const b = readFileSync(`${out}/${n}`); raw += b.length; data[n] = b64gz(b); } catch {} }
const duck = readFileSync(`${site}/duckdb-eh.wasm`);

// 3. The page
// String.replace with a function: a replacement string would read the bundle's "$`" and "$&" as patterns
const html = readFileSync("index.html", "utf8")
  .replace(`<script type="module" src="main.bundle.js"></script>`, () => `<script>window.DUCKDB_WASM_GZ=${JSON.stringify(b64gz(duck))};window.DATA_GZ=${JSON.stringify(data)};</script>\n<script type="module">${bundle.replace(/<\/script>/g, "<\\/script>")}</script>`)
  .replace("<title>Trial S7: the pivot table of the demo survey</title>", () => `<title>Collect Earth analysis · ${rows} plots (stand-alone)</title>`)
  .replace(`<link rel="stylesheet" href="pd/viewer/dist/css/pro.css">`, () => `<style>${readFileSync("node_modules/@perspective-dev/viewer/dist/css/pro.css", "utf8")}</style>`);
const file = `${out}/standalone/collect-earth-analysis-${rows}.html`;
writeFileSync(file, html);
console.log(JSON.stringify({ file, htmlMB: +(html.length / 1e6).toFixed(1), bundleMB: +(bundle.length / 1e6).toFixed(1), duckdbWasmGzMB: +(gzipSync(duck).length / 1e6).toFixed(1), dataRawMB: +(raw / 1e6).toFixed(1), dataGzMB: +(Object.values(data).reduce((s, v) => s + v.length * 0.75, 0) / 1e6).toFixed(1) }));
