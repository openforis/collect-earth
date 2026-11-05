// Trial S7: opens the stand-alone HTML from the disk (file://), with no server, as a person would double-click it.
// node standalone-check.mjs <rows>
import { resolve } from "node:path";
import { chromium } from "playwright";

const rows = process.argv[2] ?? "55";
const file = resolve(`../out/standalone/collect-earth-analysis-${rows}.html`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
const t0 = Date.now();
await page.goto(`file://${file}?rows=${rows}`);
await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.failed, null, { timeout: 180_000 });
const out = { file, rows: Number(rows), wallMs: Date.now() - t0, failed: !!(await page.evaluate(() => document.body.dataset.failed)), status: await page.textContent("#status"), errors };
if (!out.failed) {
  out.marks = await page.evaluate(() => window.trial.marks);
  const a = await page.evaluate(() => window.trial.pivot({ group_by: ["land_use_category_label"], columns: ["plot_count"], aggregates: { plot_count: "count" }, expressions: { plot_count: '"id"' } }));
  out.forestPlots = a.find((r) => r.__ROW_PATH__[0] === "Forest")?.plot_count;
  await page.screenshot({ path: `../out/shot-standalone-${rows}-grid.png` });
  out.chart = await page.evaluate(() => window.trial.show({ plugin: "Y Bar", group_by: ["climate_label"], split_by: ["land_use_category_label"], columns: ["area"], aggregates: { area: "sum" }, expressions: { area: '"expansion_factor"' } }).then(() => "ok")).catch((e) => "failed: " + String(e).split("\n")[0].slice(0, 100));
  await page.waitForTimeout(800);
}
await page.screenshot({ path: `../out/shot-standalone-${rows}.png` });
console.log(JSON.stringify(out, null, 1));
await browser.close();
