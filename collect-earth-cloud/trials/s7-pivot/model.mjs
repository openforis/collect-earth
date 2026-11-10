// Trial S7: the view model of a survey, generated from its IDML, and compared with the cube of the .cep.
// node model.mjs <cep folder> <out folder>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [cepDir, outDir] = process.argv.slice(2);
const idm = readFileSync(join(cepDir, "placemark.idm.xml"), "utf8");
const cube = readFileSync(join(cepDir, "collectEarthCubes.xml.fmt"), "utf8");
mkdirSync(outDir, { recursive: true });

const attr = (s, name) => (s.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1];
const unescape = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#13;|\r/g, "");

// ---- code lists: name -> { items: [{code, label: {en, es, fr, pt}, parent}], levels }
const lists = {};
for (const m of idm.matchAll(/<list ([^>]*)>([\s\S]*?)<\/list>/g)) {
  const name = attr(m[1], "name");
  const items = [];
  const stack = [];
  // walk <item ...> ... </item>, nested for hierarchical lists
  const re = /<item id="(\d+)">|<\/item>|<code>([^<]*)<\/code>|<label( xml:lang="(\w+)")?>([^<]*)<\/label>/g;
  let it;
  for (const t of m[2].matchAll(re)) {
    if (t[1]) { it = { id: t[1], code: null, label: {}, parent: stack.at(-1)?.code ?? null, level: stack.length }; items.push(it); stack.push(it); }
    else if (t[0] === "</item>") stack.pop();
    else if (t[2] !== undefined && stack.length) { if (!stack.at(-1).code) stack.at(-1).code = t[2]; }
    else if (t[5] !== undefined && stack.length) { const lang = t[4] ?? "en"; if (!(lang in stack.at(-1).label)) stack.at(-1).label[lang] = unescape(t[5]); }
  }
  lists[name] = { items, levels: Math.max(0, ...items.map((i) => i.level)) + 1 };
}

// ---- entities and attributes (the schema)
const schema = idm.slice(idm.indexOf("<schema"));
const entities = [];
const path = [];
const labelOf = (s) => {
  const out = {};
  for (const l of s.matchAll(/<label( xml:lang="(\w+)")?[^>]*>([^<]*)<\/label>/g)) { const lang = l[2] ?? "en"; if (!(lang in out)) out[lang] = unescape(l[3]); }
  return out;
};
const tags = "entity|code|number|boolean|text|date|time|coordinate|range|taxon|file|integer|real";
const tokens = [...schema.matchAll(new RegExp(`<(/?)(${tags})\\b([^>]*?)(/?)>`, "g"))];
for (let i = 0; i < tokens.length; i++) {
  const [, close, tag, attrs, selfClose] = tokens[i];
  if (tag === "entity") {
    if (close) { path.pop(); continue; }
    const e = { name: attr(attrs, "name"), multiple: attrs.includes('multiple="true"'), parent: path.at(-1)?.name ?? null, attributes: [] };
    entities.push(e);
    if (!selfClose) path.push(e);
    continue;
  }
  if (close) continue;
  // the labels are inside the element, up to its closing tag
  const start = tokens[i].index;
  const end = schema.indexOf(`</${tag}>`, start);
  const body = selfClose ? "" : schema.slice(start, end);
  const a = {
    name: attr(attrs, "name"), type: tag, key: attrs.includes('key="true"'), calculated: attrs.includes('calculated="true"'),
    multiple: attrs.includes('multiple="true"'), list: attr(attrs, "list") ?? null, label: labelOf(body.split(/<(?:code|number|boolean|text|date)\b/)[0]),
    exported: !attrs.includes('collect:includeInDataExport="false"'),
  };
  path.at(-1).attributes.push(a);
}

// ---- the view model: as Saiku's cube is generated (Collect's CollectEarthCubeGenerator), from the survey alone.
// Dimensions: every attribute the survey exports (not collect:includeInDataExport="false") except coordinates; code
// attributes carry their labels and, for a 2-level list, the parent level as a column of its own. (Found in this trial:
// that export flag is exactly what the cube generator skips; the bookkeeping attributes are in the cube too.)
// Measures: plot count, area (the expansion factor), plot weight, and min/max/avg of every number attribute.
const model = { entities: [], lists };
for (const e of entities) {
  const dims = [], measures = [];
  if (e.name === "plot") measures.push({ name: "plot_count", label: "Plot Count", agg: "count distinct", column: "id" }, { name: "area", label: "Area (HA)", agg: "sum", column: "expansion_factor" }, { name: "plot_weight", label: "Plot Weight", agg: "sum", column: "plot_weight" });
  for (const a of e.attributes) {
    if (!a.exported || a.type === "coordinate") continue;
    const label = a.label.en ?? a.name;
    if (a.type === "code") {
      const list = lists[a.list];
      dims.push({ name: a.name, label, kind: "code", list: a.list, levels: list?.levels ?? 1, labels: Object.keys(list?.items[0]?.label ?? { en: 1 }) });
    } else if (a.type === "number" || a.type === "integer" || a.type === "real") {
      dims.push({ name: a.name, label, kind: "number" });
      for (const agg of ["min", "max", "avg"]) measures.push({ name: `${a.name}_${agg}`, label: `${label} ${agg}`, agg, column: a.name });
    } else dims.push({ name: a.name, label, kind: a.type });
  }
  model.entities.push({ name: e.name, multiple: e.multiple, parent: e.parent, dimensions: dims, measures });
}
writeFileSync(join(outDir, "model.json"), JSON.stringify(model, null, 1));

// ---- compared with the cube the .cep carries
const cubeDims = [...cube.matchAll(/<Dimension name="([^"]+)"/g)].map((m) => m[1]);
const cubeMeasures = [...cube.matchAll(/<Measure name="([^"]+)"/g)].map((m) => m[1]);
const cubeColumns = new Set([...cube.matchAll(/<Level [^>]*\bcolumn="([^"]+)"/g)].map((m) => m[1].replace(/_code_id$/, "")));
const cubeForeign = new Set([...cube.matchAll(/foreignKey="([^"]+)_code_id"/g)].map((m) => m[1]));
const ours = new Set(model.entities.flatMap((e) => e.dimensions.map((d) => d.name)));
const listNames = new Set(Object.keys(lists));
const inCubeNotOurs = [...new Set([...cubeColumns, ...cubeForeign])].filter((c) => !ours.has(c) && !listNames.has(c) && !["_plot_id", "location_x", "location_y", "_plot_round", "land_uses_use", "land_uses_subdivision", "land_use_conversions_conversion", "forest_dynamics_dinamica", "forest_dynamics_categoria"].includes(c) && !c.endsWith("_label_en") && !c.endsWith("_code") && !/^actively_saved_on_(year|month|day)$/.test(c));
const oursNotInCube = [...ours].filter((d) => !cubeColumns.has(d) && !cubeForeign.has(d));
const report = {
  cube: { dimensions: cubeDims.length, measures: new Set(cubeMeasures).size },
  generated: { dimensions: ours.size, measures: model.entities.reduce((n, e) => n + e.measures.length, 0) },
  inCubeNotGenerated: inCubeNotOurs, generatedNotInCube: oursNotInCube,
  measuresInCube: [...new Set(cubeMeasures)], measuresGenerated: model.entities.flatMap((e) => e.measures.map((m) => m.name)),
};
writeFileSync(join(outDir, "model-vs-cube.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ entities: model.entities.map((e) => `${e.name}: ${e.dimensions.length} dims, ${e.measures.length} measures`), ...report }, null, 1));
