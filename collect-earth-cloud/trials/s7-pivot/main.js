// Trial S7: the pivot page. DuckDB-WASM holds the tables and builds the "cube" (the plot table with the labels of
// every code attribute and the expansion factors); Perspective shows the pivot. window.trial exposes what the checks
// need (SQL on DuckDB, the pivot's figures for a view, timings).
import * as duckdb from "@duckdb/duckdb-wasm";

const t0 = performance.now();
const marks = {};
const mark = (name) => (marks[name] = Math.round(performance.now() - t0));

/** The assets: served next to the page, or (stand-alone) embedded as data: URLs by window.ASSETS. */
const asset = (name) => (window.ASSETS && window.ASSETS[name]) || name;
const params = new URLSearchParams(location.search);
const N = params.get("rows") || "55";
const lang = params.get("lang") || "en";

async function text(name) {
  if (window.DATA && window.DATA[name]) return window.DATA[name];
  const r = await fetch(asset(name));
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.text();
}

async function main() {
  const status = document.getElementById("status");
  const say = (s) => (status.textContent = s);
  say("Starting DuckDB…");
  const worker = new Worker(asset("duckdb-browser-eh.worker.js"));
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  await db.instantiate(asset("duckdb-eh.wasm"));
  mark("duckdbReady");
  const conn = await db.connect();
  window.__db = db; window.__conn = conn;

  say("Loading the data…");
  const model = JSON.parse(await text("model.json"));
  const tables = { plot: `plot-${N}.csv`, land_cover: `land_cover-${N}.csv`, land_use: `land_use-${N}.csv` };
  for (const [name, file] of Object.entries(tables)) {
    await db.registerFileText(file, await text(file));
    await conn.query(`CREATE TABLE ${name} AS SELECT * FROM read_csv('${file}', header=true, delim=',', quote='"', escape='"', null_padding=true)`);
  }
  for (const [list, def] of Object.entries(model.lists)) {
    if (def.items.length === 0) continue;
    const file = `list-${list}.csv`;
    await db.registerFileText(file, await text(file));
    await conn.query(`CREATE TABLE "list_${list}" AS SELECT * FROM read_csv('${file}', header=true, delim=',', quote='"', escape='"', all_varchar=true)`);
  }
  mark("tablesLoaded");

  // The cube: the plot table with, for each code attribute, its label (and the parent level's code and label for a
  // 2-level list), as Saiku's joins to the code tables give. Generated from the model, for any survey.
  const plot = model.entities.find((e) => e.name === "plot");
  const columnsOf = async (t) => new Set((await conn.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${t}'`)).toArray().map((r) => r.column_name));
  const plotColumns = await columnsOf("plot");
  const cols = ["p.*"];
  const joins = [];
  for (const d of plot.dimensions) {
    if (d.kind !== "code" || !d.list || !plotColumns.has(d.name)) continue;
    const a = `l_${d.name}`;
    joins.push(`LEFT JOIN "list_${d.list}" ${a} ON ${a}.code = CAST(p.${d.name} AS VARCHAR)`);
    cols.push(`COALESCE(${a}.label_${lang}, ${a}.label_en, CAST(p.${d.name} AS VARCHAR)) AS "${d.name}_label"`);
    if (d.levels > 1) {
      const pa = `lp_${d.name}`;
      joins.push(`LEFT JOIN "list_${d.list}" ${pa} ON ${pa}.code = ${a}.parent`);
      cols.push(`${a}.parent AS "${d.name}_parent"`, `COALESCE(${pa}.label_${lang}, ${pa}.label_en, ${a}.parent) AS "${d.name}_parent_label"`);
    }
  }
  const cubeSql = `SELECT ${cols.join(", ")} FROM plot p ${joins.join(" ")}`;
  await conn.query(`CREATE VIEW plot_cube AS ${cubeSql}`);
  // Each nested entity, with the plot's dimensions: one "cube" per entity, as Saiku has one hierarchy per join.
  for (const e of model.entities.filter((e) => e.parent === "plot")) {
    const lcols = ["c.*"];
    const ljoins = [];
    const eColumns = await columnsOf(e.name);
    for (const d of e.dimensions) {
      if (d.kind !== "code" || !d.list || !eColumns.has(d.name)) continue;
      const a = `l_${d.name}`;
      ljoins.push(`LEFT JOIN "list_${d.list}" ${a} ON ${a}.code = CAST(c.${d.name} AS VARCHAR)`);
      lcols.push(`COALESCE(${a}.label_${lang}, ${a}.label_en, CAST(c.${d.name} AS VARCHAR)) AS "${d.name}_label"`);
    }
    await conn.query(`CREATE VIEW ${e.name}_cube AS SELECT ${lcols.join(", ")}, pc.* EXCLUDE (id) FROM ${e.name} c ${ljoins.join(" ")} JOIN plot_cube pc ON pc.id = c.plot_id`);
  }
  mark("cubeReady");

  say("Starting Perspective…");
  // Perspective's CDN layout (@perspective-dev: the client loads the server's wasm from a sibling package folder),
  // served next to the page, not bundled
  const perspective = (await import(asset("./pd/client/dist/cdn/perspective.js"))).default;
  await import(asset("./pd/viewer/dist/cdn/perspective-viewer.js"));
  await import(asset("./pd/viewer-datagrid/dist/cdn/perspective-viewer-datagrid.js"));
  await import(asset("./pd/viewer-charts/dist/cdn/perspective-viewer-charts.js"));
  window.__step = "worker"; const ws = await perspective.worker();
  // The viewer element is made only now: one written in the HTML before the library loaded crashed (a wasm "unreachable")
  // as soon as a plugin other than Debug was chosen (found in this trial; a fresh element works)
  const viewer = document.createElement("perspective-viewer");
  viewer.id = "viewer";
  document.body.appendChild(viewer);
  const entity = params.get("entity") || "plot";
  const arrow = await conn.query(`SELECT * FROM ${entity}_cube`);
  const buffer = arrowToBuffer(arrow);
  mark("cubeQueried");
  window.__step = "table"; const table = await ws.table(buffer);
  mark("perspectiveTable");
  window.__step = "load"; await viewer.load(table);
  // The default view: plot count and area by land use category × province, as a Saiku user would start.
  const defaultView = entity === "plot"
    ? { plugin: "Datagrid", group_by: ["land_use_category_label"], split_by: ["province"], columns: ["plot_count", "area"], aggregates: { plot_count: "count", area: "sum" }, expressions: { plot_count: '"id"', area: '"expansion_factor"' } }
    : { plugin: "Datagrid", group_by: [`${entity === "land_cover" ? "element" : "lu"}_label`], split_by: ["coverage_label"], columns: ["rows"], aggregates: { rows: "count" }, expressions: { rows: '"plot_id"' } };
  window.__step = "restore"; if (!params.get("noview")) await viewer.restore(defaultView);
  window.__step = "done"; mark("firstPivot");
  say(`${(await table.size()).toLocaleString()} rows · DuckDB ${marks.duckdbReady} ms · tables ${marks.tablesLoaded} ms · pivot ${marks.firstPivot} ms`);

  window.__ws = ws; window.__conn = conn; window.__toBuffer = arrowToBuffer;
  window.trial = {
    marks,
    model,
    cubeSql,
    sql: async (q) => { const r = await conn.query(q); return r.toArray().map((row) => Object.fromEntries(Object.entries(row.toJSON()).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))); },
    /** The pivot's figures for a Perspective view, as the person would read them in the grid (row path -> columns). */
    pivot: async (config) => {
      const view = await table.view(config);
      const rows = await view.to_json({ leaves_only: false });
      await view.delete();
      return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    },
    show: async (config) => { await viewer.restore(config); },
    parquetBytes: async () => {
      await conn.query(`COPY (SELECT * FROM plot) TO 'plot.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)`);
      const buf = await db.copyFileToBuffer("plot.parquet");
      return buf.byteLength;
    },
  };
  document.body.dataset.ready = "1";
}

/** An Arrow table (from DuckDB) as the IPC bytes Perspective takes. */
function arrowToBuffer(table) {
  // apache-arrow's RecordBatchStreamWriter, through the table's own toArray would lose types: write IPC instead
  const bytes = window.__arrow.tableToIPC(table, "stream");
  // Perspective takes an ArrayBuffer, not a view on one
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

import * as arrowLib from "apache-arrow";
window.__arrow = arrowLib;

main().catch((e) => {
  document.getElementById("status").textContent = "Failed: " + (e.stack || e);
  document.body.dataset.failed = "1";
});
