// Trial S7: synthetic records for the demo survey, as the RDB export lays them out (one table per entity), with the
// expansion factors of region_areas.csv (area of a region / plots in it) and plot_weight = factor / min factor.
// node data.mjs <cep folder> <out folder> <plots>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [cepDir, outDir, nArg] = process.argv.slice(2);
const N = Number(nArg);
const model = JSON.parse(readFileSync(join(outDir, "model.json"), "utf8"));
const grid = readFileSync(join(cepDir, "grid/showcase_plots.csv"), "utf8").replace(/\r/g, "").trim().split("\n").slice(1).map((l) => l.split(","));
// id,round,YCoordinate,XCoordinate,elevation,slope,aspect,climate,soil,gez,country,province,district

// A fixed-seed generator, so the data is the same at every run (and in the Python check).
let seed = 20261105;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => { let r = rnd() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs[0][0]; };

const L = model.lists;
const categories = L.land_uses.items.filter((i) => i.level === 0).map((i) => i.code);
const subdivisionsOf = (c) => L.land_uses.items.filter((i) => i.parent === c).map((i) => i.code);
const conversions = L.land_use_conversions.items.filter((i) => i.level === 1);
const years = L.years.items.map((i) => i.code);
const coverage = L.plot_coverage.items.map((i) => i.code); // na, 2, 4 ... points
const elements = L.land_cover_elements.items.map((i) => i.code);
const operators = ["ana", "bruno", "carla", "diego"];
const pointsOf = (cov) => (cov === "na" ? 0 : Number(cov) === 2 ? 1 : Number(cov) - 1); // as the labels say: "1 Points", then n-1

const plots = [], covers = [], uses = [];
for (let i = 0; i < N; i++) {
  const g = grid[i % grid.length];
  const id = N <= grid.length ? g[0] : `${g[0]}_${Math.floor(i / grid.length)}`;
  const category = weighted([["F", 40], ["C", 20], ["G", 18], ["S", 8], ["W", 6], ["O", 8]]);
  const changed = rnd() < 0.15;
  const conv = changed ? pick(conversions.filter((c) => c.code.endsWith(category) && c.code[0] !== category)) : { code: category + category };
  const subdivision = pick(subdivisionsOf(category) || [category]);
  const saved = rnd() < 0.93;
  // land cover: 2 to 4 elements whose points sum to 49 at most
  const n = 2 + Math.floor(rnd() * 3);
  const els = [...elements].sort(() => rnd() - 0.5).slice(0, n);
  let left = 49;
  const lc = {};
  for (const el of els) { const pts = Math.min(left, Math.floor(rnd() * 25)); left -= pts; lc[el] = pts; }
  const pct = (el) => Math.round(((lc[el] ?? 0) / 49) * 100);
  const forest = pct("trees") + pct("tof"), crop = pct("crops"), grass = pct("grass") + pct("shrubs"), settle = pct("housing") + pct("infrastucture"), wet = pct("water_body"), other = pct("bareSoil");
  plots.push({
    id, round: "1", location_y: Number(g[2]) + (rnd() - 0.5) * 0.01, location_x: Number(g[3]) + (rnd() - 0.5) * 0.01, operator: pick(operators),
    settlement_percentage: settle, cropland_percentage: crop, forest_percentage: forest, grassland_percentage: grass, wetland_percentage: wet, otherland_percentage: other,
    land_use_category: category, land_use_subcategory: conv.code, land_use_category_has_changed: changed, land_use_subcategory_year_of_change: changed ? pick(years) : "",
    land_use_subdivision: subdivision, land_use_subdivision_change: changed && rnd() < 0.5, land_use_assessment_confidence: rnd() < 0.8,
    actively_saved: saved, actively_saved_on: `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`, plot_file: "showcase_plots.csv",
    elevation: Number(g[4]) + Math.floor(rnd() * 40), slope: Number(g[5]), aspect: Number(g[6]), climate: g[7], soil: g[8], gez: g[9], country: g[10], province: g[11], district: g[12],
    plot_distribution: "single", comments: "",
  });
  for (const el of els) { const cov = lc[el] === 0 ? "na" : String(lc[el] + 1); covers.push({ plot_id: id, element: el, coverage: cov, percentage: pct(el) }); }
  uses.push({ plot_id: id, lu: category, coverage: "50", percentage: 100 });
}

// region_areas.csv: the area each province represents, in hectares (invented), then the expansion factor per plot
const provinces = [...new Set(plots.map((p) => p.province))];
const areas = Object.fromEntries(provinces.map((p, i) => [p, 100_000 + i * 37_500]));
const perProvince = {};
for (const p of plots) perProvince[p.province] = (perProvince[p.province] ?? 0) + 1;
for (const p of plots) p.expansion_factor = areas[p.province] / perProvince[p.province];
const minFactor = Math.min(...plots.map((p) => p.expansion_factor));
for (const p of plots) p.plot_weight = p.expansion_factor / minFactor;

const csv = (rows) => { const cols = Object.keys(rows[0]); return [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c]; return typeof v === "string" && /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v); }).join(","))].join("\n") + "\n"; };
writeFileSync(join(outDir, `plot-${N}.csv`), csv(plots));
writeFileSync(join(outDir, `land_cover-${N}.csv`), csv(covers));
writeFileSync(join(outDir, `land_use-${N}.csv`), csv(uses));
writeFileSync(join(outDir, "region_areas.csv"), "province,area_ha\n" + provinces.map((p) => `${p},${areas[p]}`).join("\n") + "\n");
// the code tables, as the RDB export's: code, label per language, parent
for (const [name, list] of Object.entries(L)) {
  if (list.items.length === 0) continue;
  writeFileSync(join(outDir, `list-${name}.csv`), csv(list.items.map((i) => ({ code: i.code ?? "", label_en: i.label.en ?? i.code ?? "", label_es: i.label.es ?? "", label_fr: i.label.fr ?? "", label_pt: i.label.pt ?? "", parent: i.parent ?? "", level: i.level }))));
}
console.log(`${plots.length} plots, ${covers.length} land cover rows, ${uses.length} land use rows, ${provinces.length} provinces`);
