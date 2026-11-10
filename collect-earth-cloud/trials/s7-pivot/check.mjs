// Trial S7: serves ../site, opens the page in Chromium, reads the pivot's figures and DuckDB's for the same
// questions, measures load times and memory, and takes screenshots.  node check.mjs <rows> [entity]
import { createServer } from "node:http";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const site = resolve("../site");
const [rows = "55", entity = "plot"] = process.argv.slice(2);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".csv": "text/csv" };
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
  try {
    statSync(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
    res.end(readFileSync(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
const t0 = Date.now();
await page.goto(`${base}/index.html?rows=${rows}&entity=${entity}`);
await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.failed, null, { timeout: 180_000 });
const wall = Date.now() - t0;
if (await page.evaluate(() => document.body.dataset.failed)) { console.log("FAILED", await page.textContent("#status"), errors); process.exit(1); }
const marks = await page.evaluate(() => window.trial.marks);

const out = { rows: Number(rows), entity, wallMs: wall, marks, errors };
const pivot = (config) => page.evaluate((c) => window.trial.pivot(c), config);
const sql = (q) => page.evaluate((q) => window.trial.sql(q), q);

if (entity === "plot") {
  // A: plot count and area by land use category
  const a = await pivot({ group_by: ["land_use_category_label"], columns: ["plot_count", "area"], aggregates: { plot_count: "count", area: "sum" }, expressions: { plot_count: '"id"', area: '"expansion_factor"' } });
  const aSql = await sql(`SELECT land_use_category_label AS k, count(DISTINCT id) AS plot_count, sum(expansion_factor)::DOUBLE AS area FROM plot_cube GROUP BY 1 ORDER BY 1`);
  out.A = { pivot: a.filter((r) => r.__ROW_PATH__.length).map((r) => ({ k: r.__ROW_PATH__[0], plot_count: r.plot_count, area: r.area })).sort((x, y) => x.k.localeCompare(y.k)), sql: aSql, total: a.find((r) => !r.__ROW_PATH__.length) };
  // B: mean forest percentage by climate, and the confidence share
  const b = await pivot({ group_by: ["climate_label"], columns: ["forest_percentage", "confident"], aggregates: { forest_percentage: "avg", confident: "avg" }, expressions: { confident: '"land_use_assessment_confidence" ? 1 : 0' } });
  const bSql = await sql(`SELECT climate_label AS k, avg(forest_percentage) AS forest_percentage, avg(CASE WHEN land_use_assessment_confidence THEN 1 ELSE 0 END) AS confident FROM plot_cube GROUP BY 1 ORDER BY 1`);
  out.B = { pivot: b.filter((r) => r.__ROW_PATH__.length).map((r) => ({ k: r.__ROW_PATH__[0], forest_percentage: r.forest_percentage, confident: r.confident })).sort((x, y) => x.k.localeCompare(y.k)), sql: bSql };
  // C: a two-level code list: subdivision under its category (drill-down), area
  const c = await pivot({ group_by: ["land_use_subdivision_parent_label", "land_use_subdivision_label"], columns: ["area"], aggregates: { area: "sum" }, expressions: { area: '"expansion_factor"' } });
  out.C = { levels: c.filter((r) => r.__ROW_PATH__.length === 2).length, parents: c.filter((r) => r.__ROW_PATH__.length === 1).map((r) => [r.__ROW_PATH__[0], r.area]) };
  // D: split by province (columns) × category (rows): the Saiku starting view; count of cells
  const d = await pivot({ group_by: ["land_use_category_label"], split_by: ["province"], columns: ["plot_count"], aggregates: { plot_count: "count" }, expressions: { plot_count: '"id"' } });
  out.D = { cells: Object.keys(d[0] ?? {}).length - 1, rows: d.length - 1 };
  // the time of a pivot change as the person would feel it
  const tp = Date.now();
  await page.evaluate(() => window.trial.show({ plugin: "Datagrid", group_by: ["province"], split_by: ["land_use_category_label"], columns: ["area"], aggregates: { area: "sum" }, expressions: { area: '"expansion_factor"' } }));
  await page.waitForTimeout(100);
  out.repivotMs = Date.now() - tp;
  await page.screenshot({ path: `../out/shot-${entity}-${rows}-province.png` });
  // a chart of the same figures
  await page.evaluate(() => window.trial.show({ plugin: "Y Bar", group_by: ["climate_label"], split_by: ["land_use_category_label"], columns: ["area"], aggregates: { area: "sum" }, expressions: { area: '"expansion_factor"' } }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `../out/shot-${entity}-${rows}-chart.png` });
  await page.evaluate(() => window.trial.show({ plugin: "Datagrid", group_by: ["land_use_category_label"], split_by: ["province"], columns: ["plot_count", "area"], aggregates: { plot_count: "count", area: "sum" }, expressions: { plot_count: '"id"', area: '"expansion_factor"' } }));
  await page.waitForTimeout(300);
  out.parquetBytes = await page.evaluate(() => window.trial.parquetBytes()).catch((e) => "unavailable: " + String(e).split("\n")[0].slice(0, 120));
} else {
  // the nested entity: land cover rows by element and coverage, and by the plot's province (joined dimension)
  const e = await pivot({ group_by: ["element_label"], columns: ["rows", "pct"], aggregates: { rows: "count", pct: "avg" }, expressions: { rows: '"plot_id"', pct: '"percentage"' } });
  const eSql = await sql(`SELECT element_label AS k, count(*) AS rows, avg(percentage) AS pct FROM land_cover_cube GROUP BY 1 ORDER BY 1`);
  out.E = { pivot: e.filter((r) => r.__ROW_PATH__.length).map((r) => ({ k: r.__ROW_PATH__[0], rows: r.rows, pct: r.pct })).sort((x, y) => x.k.localeCompare(y.k)), sql: eSql };
  const f = await pivot({ group_by: ["province"], columns: ["rows"], aggregates: { rows: "count" }, expressions: { rows: '"plot_id"' } });
  out.F = { provinces: f.length - 1 };
}
const metrics = (await cdp.send("Performance.getMetrics")).metrics;
out.jsHeapMB = Math.round(metrics.find((m) => m.name === "JSHeapUsedSize").value / 1e6);
// DuckDB's own memory (its worker's wasm heap is outside the JS heap), and the resident memory of the browser's
// processes (every renderer and worker of this headless Chromium: an upper bound for the page)
out.duckdbMemoryMB = await page.evaluate(() => window.trial.sql("SELECT * FROM pragma_database_size()").then((r) => JSON.stringify(r[0]))).catch((e) => String(e).slice(0, 100));
const { execSync } = await import("node:child_process");
out.chromiumRssMB = Math.round(Number(execSync("ps -eo rss,comm | grep -Ei 'chrom|headless' | awk '{s+=$1} END {print s/1024}'").toString().trim()) || 0);
await page.screenshot({ path: `../out/shot-${entity}-${rows}.png` });
writeFileSync(`../out/check-${entity}-${rows}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
