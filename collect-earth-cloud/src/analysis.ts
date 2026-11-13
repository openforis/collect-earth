// The analysis of the collected data (docs/plans/2026-11-05-node-and-arena.md, "Presenting the data", stage 6a): what
// replaces Saiku. Everything is generated from the survey, as Collect's cube generator does for Saiku, so any survey works:
// - analysisModel: the tables (the plot and each of its multiple entities), their columns with labels in every language
//   of the survey, and the code lists, from the survey (placemark.idm.xml);
// - analysisTables: the rows of those tables, from the records' summaries (the flat answers Collect Earth sends);
// - expansionFactors: the area each plot stands for, from the project file's region_areas.csv, as Collect Earth's
//   RegionCalculationUtils works it out for Saiku (strata and areas_per_attribute.csv: src/areas.ts).
// The browser loads the tables into DuckDB and pivots them (web/src/analysis): the server never aggregates.
import { attr, childrenOf, elements, parseSurvey, tagOf, textOf, type XmlNode } from './cep.js';
import { withWeights } from './areas.js';
import { prefixOf, QUALIFIER_SEPARATOR } from './surveyOutline.js';
import type { AnalysisColumn, AnalysisModel, AnalysisTable, ColumnType, Labels, ListItem, TableData } from './wire/analysis.js';

export type { AnalysisColumn, AnalysisModel, AnalysisTable, ColumnType, Labels, ListItem, TableData } from './wire/analysis.js';

/** The fixed columns of every row, before the survey's (and their DuckDB types). */
export const ROW_COLUMNS = [
  ['_record', 'VARCHAR'],
  ['_plot', 'VARCHAR'],
  ['_round', 'VARCHAR'],
  ['_assessment', 'VARCHAR'],
  ['_operator', 'VARCHAR'],
  ['_submitted', 'BOOLEAN'],
  ['_saved_on', 'DATE'],
] as const;
/** The plot table's columns after the survey's: the area each plot stands for, and its weight. */
export const AREA_COLUMNS = [
  ['expansion_factor', 'DOUBLE'],
  ['plot_weight', 'DOUBLE'],
] as const;

/** The yes/no attribute a `relevant` expression starts with: "change2", "change2 and …", "change2 = true()". */
const RELEVANT_IF = /^\s*([A-Za-z_][\w]*)\s*(?:=\s*true\(\)\s*)?(?:$|\sand\s)/;

const TYPE_OF_PREFIX: Record<string, ColumnType> = {
  code_: 'code',
  boolean_: 'boolean',
  integer_: 'integer',
  real_: 'real',
  text_: 'text',
  date_: 'date',
  time_: 'time',
};

/** The DuckDB type of a column, as the browser declares it to read the CSV (no guessing). */
export function duckdbType(c: AnalysisColumn): string {
  if (c.multiple) return 'VARCHAR';
  switch (c.type) {
    case 'boolean':
      return 'BOOLEAN';
    case 'integer':
      return 'BIGINT';
    case 'real':
      return 'DOUBLE';
    case 'date':
      return 'DATE';
    default:
      return 'VARCHAR';
  }
}

/** The tables, columns and lists of a survey. Throws CepError when the survey cannot be read. */
export function analysisModel(idmXml: string): AnalysisModel {
  const { surveyChildren, root, languages } = parseSurvey(idmXml);
  const defaultLanguage = languages[0] ?? '';
  const labelsOf = (node: XmlNode, tag = 'label'): Labels => {
    const out: Labels = {};
    const all = elements(childrenOf(node), tag);
    // instance labels first, then reporting ones, for a language that has no instance label
    const ordered = [...all.filter((l) => (attr(l, 'type') ?? 'instance') === 'instance'), ...all.filter((l) => attr(l, 'type') === 'reporting'), ...all.filter((l) => !['instance', 'reporting', undefined].includes(attr(l, 'type')))];
    for (const l of ordered) {
      const lang = attr(l, 'xml:lang') ?? defaultLanguage;
      const text = textOf(l).trim();
      if (text !== '' && !(lang in out)) out[lang] = text;
    }
    return out;
  };

  // The code lists, every level, with each item's parent
  const lists: Record<string, ListItem[]> = {};
  for (const codeListsNode of elements(surveyChildren, 'codeLists')) {
    for (const list of elements(childrenOf(codeListsNode), 'list')) {
      const name = attr(list, 'name');
      if (!name) continue;
      const items: ListItem[] = [];
      const seen = new Set<string>();
      const walk = (nodes: XmlNode[], parent: string | null, level: number) => {
        for (const item of nodes) {
          const code = elements(childrenOf(item), 'code')[0];
          if (!code) continue;
          const value = textOf(code);
          if (!seen.has(value)) {
            seen.add(value);
            items.push({ code: value, labels: labelsOf(item), parent, level });
          }
          walk(elements(childrenOf(item), 'item'), value, level + 1);
        }
      };
      for (const itemsNode of elements(childrenOf(list), 'items')) walk(elements(childrenOf(itemsNode), 'item'), null, 0);
      lists[name] = items;
    }
  }

  const exported = (node: XmlNode) => attr(node, 'collect:includeInDataExport') !== 'false';
  const columnOf = (node: XmlNode, name: string, key: string): AnalysisColumn | null => {
    const prefix = prefixOf(node);
    const type = prefix ? TYPE_OF_PREFIX[prefix] : undefined;
    if (!type || !exported(node)) return null;
    return {
      name,
      key,
      labels: labelsOf(node),
      type,
      list: type === 'code' ? (attr(node, 'list') ?? null) : null,
      calculated: attr(node, 'calculated') === 'true',
      multiple: attr(node, 'multiple') === 'true',
      fromPlotFile: attr(node, 'collectearth:fromcsv') === 'true',
      keyAttr: attr(node, 'key') === 'true',
      // resolved to column names once the entity's columns are known (resolveLinks)
      parent: type === 'code' ? (attr(node, 'parent')?.trim() || null) : null,
      relevantIf: RELEVANT_IF.exec(attr(node, 'relevant') ?? '')?.[1] ?? null,
    };
  };
  /** The attribute names of a container's columns, to resolve `parent` and `relevantIf` (written with them) to columns. */
  const attrNames = new Map<AnalysisColumn, string>();
  const resolveLinks = (columns: AnalysisColumn[]) => {
    const byAttr = new Map<string, AnalysisColumn>();
    for (const c of columns) if (attrNames.has(c)) byAttr.set(attrNames.get(c)!, c);
    for (const c of columns) {
      const parent = c.parent ? byAttr.get(c.parent) : undefined;
      c.parent = parent && parent.type === 'code' && parent !== c ? parent.name : null;
      const gate = c.relevantIf ? byAttr.get(c.relevantIf) : undefined;
      c.relevantIf = gate && gate.type === 'boolean' && gate !== c ? gate.name : null;
    }
  };

  const plot: AnalysisTable = { name: 'plot', labels: labelsOf(root), keyColumn: null, columns: [] };
  const tables: AnalysisTable[] = [plot];
  const used = new Set<string>(ROW_COLUMNS.map(([n]) => n));
  const unique = (name: string) => {
    let out = name;
    for (let i = 2; used.has(out); i++) out = `${name}_${i}`;
    used.add(out);
    return out;
  };
  for (const node of childrenOf(root)) {
    const name = attr(node, 'name');
    if (!name || !tagOf(node) || tagOf(node)!.startsWith('#')) continue;
    if (tagOf(node) !== 'entity') {
      const prefix = prefixOf(node);
      if (!prefix) continue;
      const c = columnOf(node, unique(name), `collect_${prefix}${name}`);
      if (c) {
        plot.columns.push(c);
        attrNames.set(c, name);
      }
      continue;
    }
    if (!exported(node)) continue;
    const children = childrenOf(node).filter((c) => attr(c, 'name') !== undefined && tagOf(c) !== 'entity');
    if (attr(node, 'multiple') !== 'true') {
      // A single entity: its attributes are columns of the plot
      const own: AnalysisColumn[] = [];
      for (const child of children) {
        const prefix = prefixOf(child);
        if (!prefix) continue;
        const c = columnOf(child, unique(`${name}_${attr(child, 'name')}`), `collect_entity_${name}.${prefix}${attr(child, 'name')}`);
        if (c) {
          plot.columns.push(c);
          own.push(c);
          attrNames.set(c, attr(child, 'name')!);
        }
      }
      resolveLinks(own);
      continue;
    }
    // A multiple entity: a table of its own, one row per entity, its key in the summary keys' […]
    const table: AnalysisTable = { name, labels: labelsOf(node), keyColumn: null, columns: [] };
    const tableUsed = new Set<string>(ROW_COLUMNS.map(([n]) => n));
    for (const child of children) {
      const prefix = prefixOf(child);
      if (!prefix) continue;
      const childName = attr(child, 'name')!;
      let colName = childName;
      for (let i = 2; tableUsed.has(colName); i++) colName = `${childName}_${i}`;
      tableUsed.add(colName);
      const c = columnOf(child, colName, `${prefix}${childName}`);
      if (!c) continue;
      table.columns.push(c);
      attrNames.set(c, childName);
      if (table.keyColumn === null && attr(child, 'key') === 'true') table.keyColumn = c.name;
    }
    if (table.keyColumn === null) {
      // No key attribute: the entity's number, as the summary keys have it
      table.columns.unshift({ name: '_n', key: '', labels: { [defaultLanguage]: '#' }, type: 'integer', list: null, calculated: false, multiple: false, fromPlotFile: false, keyAttr: true, parent: null, relevantIf: null });
      table.keyColumn = '_n';
    }
    resolveLinks(table.columns);
    tables.push(table);
  }
  // the plot's own attributes (those of its single entities were resolved with their entity)
  resolveLinks(plot.columns.filter((c) => !c.key.startsWith('collect_entity_')));
  return { languages: languages.length > 0 ? languages : [defaultLanguage], tables, lists };
}

/** One record, as the analysis reads it. */
export interface AnalysisRecord {
  recordKey: string;
  operator: string;
  /** The plot (unit) it is of, or null for a plot in no plot file. */
  plot: string | null;
  round: string;
  assessment: 'main' | 'check' | 'other';
  submitted: boolean;
  modifiedOn: number;
  summary: Record<string, string>;
}

/** Whether a raw answer is usable for its type: "" is NULL, a number must parse, a boolean be true or false… */
export function cell(c: AnalysisColumn, raw: string | undefined): string {
  if (raw === undefined || raw === '') return '';
  if (c.multiple) return raw;
  switch (c.type) {
    case 'code': {
      const i = raw.indexOf(QUALIFIER_SEPARATOR);
      return i >= 0 ? raw.slice(0, i) : raw;
    }
    case 'boolean':
      return raw === 'true' || raw === 'false' ? raw : '';
    case 'integer':
      return /^-?\d+$/.test(raw.trim()) ? raw.trim() : '';
    case 'real':
      return Number.isFinite(Number(raw)) && raw.trim() !== '' ? raw.trim() : '';
    case 'date': {
      // Collect Earth writes MM/dd/yyyy in summaries (DateAttributeHandler); ISO dates kept as they are. A day that
      // does not exist is empty: one such value in a DATE column failed the whole table in the browser
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
      const iso = m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : raw.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
      const day = new Date(`${iso}T00:00:00Z`);
      return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === iso ? iso : '';
    }
    default:
      return raw;
  }
}

const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A record's identity: its key and its collector (the key of `analysisTables`' factors). */
export const recordId = (recordKey: string, operator: string) => `${recordKey}\u0000${operator}`;

/**
 * The rows of every table of the model, from the records (deleted ones left out by the caller). `factors` gives the
 * expansion factor and weight of the record that counts for its plot, by recordId: its first submitted assessment, the
 * one the factors are divided among (routes/analysis.ts). Every other record of the plot (a check, a draft, a second
 * person's) gets none, so a sum of the areas is right whatever the filter.
 */
export function analysisTables(
  model: AnalysisModel,
  records: readonly AnalysisRecord[],
  factors: ReadonlyMap<string, { factor: number; weight: number }> | null,
  options: { hideRounds?: boolean } = {},
): TableData[] {
  const out: TableData[] = [];
  const fixed = (r: AnalysisRecord): string[] => [
    r.recordKey,
    r.plot ?? '',
    options.hideRounds ? '' : r.round,
    options.hideRounds ? '' : r.assessment,
    r.operator,
    String(r.submitted),
    isoDay(r.modifiedOn),
  ];
  const fixedColumns = ROW_COLUMNS.map(([n, t]) => [n, t] as [string, string]);
  for (const table of model.tables) {
    const columns: [string, string][] = [...fixedColumns, ...table.columns.map((c) => [c.name, duckdbType(c)] as [string, string])];
    if (table.name === 'plot' && factors) columns.push(...AREA_COLUMNS.map(([n, t]) => [n, t] as [string, string]));
    const lines: string[] = [columns.map(([n]) => csvField(n)).join(',')];
    let rows = 0;
    if (table.name === 'plot') {
      for (const r of records) {
        const cells = [...fixed(r), ...table.columns.map((c) => cell(c, r.summary[c.key]))];
        if (factors) {
          const f = factors.get(recordId(r.recordKey, r.operator));
          cells.push(f ? String(f.factor) : '', f ? String(f.weight) : '');
        }
        lines.push(cells.map(csvField).join(','));
        rows++;
      }
    } else {
      const prefix = `collect_entity_${table.name}[`;
      for (const r of records) {
        // The entities of this record: the keys between [ and ], in the order the summary has them
        const byKey = new Map<string, Record<string, string>>();
        for (const [k, v] of Object.entries(r.summary)) {
          if (!k.startsWith(prefix)) continue;
          const close = k.indexOf('].', prefix.length);
          if (close < 0) continue;
          const entityKey = k.slice(prefix.length, close);
          let values = byKey.get(entityKey);
          if (!values) byKey.set(entityKey, (values = {}));
          values[k.slice(close + 2)] = v;
        }
        for (const [entityKey, values] of byKey) {
          // An enumerated entity with nothing answered is in no summary; one with only blanks is skipped too
          if (!table.columns.some((c) => c.name !== table.keyColumn && cell(c, values[c.key]) !== '')) continue;
          const cells = [
            ...fixed(r),
            ...table.columns.map((c) => (c.name === table.keyColumn ? (c.name === '_n' ? entityKey : cell(c, entityKey)) : cell(c, values[c.key]))),
          ];
          lines.push(cells.map(csvField).join(','));
          rows++;
        }
      }
    }
    out.push({ name: table.name, columns, rows, csv: lines.join('\n') + '\n' });
  }
  // The code lists, one table: list, code, parent, level, then a label column per language
  const langs = model.languages;
  const listColumns: [string, string][] = [['list', 'VARCHAR'], ['code', 'VARCHAR'], ['parent', 'VARCHAR'], ['level', 'INTEGER'], ...langs.map((l) => [`label_${l || 'default'}`, 'VARCHAR'] as [string, string])];
  const listLines = [listColumns.map(([n]) => n).join(',')];
  let listRows = 0;
  for (const [list, items] of Object.entries(model.lists)) {
    for (const i of items) {
      const fallback = i.labels[langs[0]] ?? Object.values(i.labels)[0] ?? i.code;
      listLines.push([list, i.code, i.parent ?? '', String(i.level), ...langs.map((l) => i.labels[l] ?? fallback)].map(csvField).join(','));
      listRows++;
    }
  }
  out.push({ name: '_lists', columns: listColumns, rows: listRows, csv: listLines.join('\n') + '\n' });
  return out;
}

/** A CSV's separator: comma, semicolon or tab, whichever splits its first line most. */
export function csvSeparatorOf(text: string): string {
  const first = text.replace(/^﻿/, '').split(/\r\n?|\n/).find((l) => l.trim() !== '') ?? '';
  return [',', ';', '\t'].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
}

/** A small CSV parser (comma, semicolon or tab, quotes): the areas files are a few hundred lines at most. */
export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = csvSeparatorOf(text);
  return lines.map((line) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
}

/** A CSV file's text: UTF-8, else Windows-1252 (a file saved by Excel), so accented strata keep their letters. */
export function csvTextOf(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * An area as written: spaces are thousands; in a `;` or tab file (Excel in French, Spanish, Portuguese) a comma is the
 * decimal mark and dots are thousands, in a comma file a (quoted) comma is thousands. NaN when not a number.
 */
export function areaOf(text: string | undefined, separator: string): number {
  let t = (text ?? '').replace(/[\s\u00a0\u202f]/g, '');
  if (separator !== ',' && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (separator === ',') t = t.replace(/,/g, '');
  return t === '' ? Number.NaN : Number(t);
}

export const REGION_AREAS_CSV = 'region_areas.csv';
export const ATTRIBUTE_AREAS_CSV = 'areas_per_attribute.csv';

export interface Factors {
  /** Which file gave them, or the project's setting (areas.ts): its strata, or one total area. */
  source: typeof REGION_AREAS_CSV | typeof ATTRIBUTE_AREAS_CSV | 'strata' | 'total';
  /** `stratum`: the areas file's line the plot stands in, for the uncertainty's strata. */
  byPlot: Map<string, { factor: number; weight: number; stratum: string }>;
  /** Lines of the file that matched no plot, or whose area could not be read. */
  unmatched: number;
  /** The file's columns that are not questions of the survey: they match no plot. */
  unknownColumns: string[];
  /** The plots with a first assessment in no line of the file: they stand for no area. Their values, most plots first. */
  noStratum: { plots: number; examples: { stratum: string; plots: number }[] };
}

/**
 * The expansion factor of each plot (the area in hectares it stands for) from region_areas.csv, as
 * RegionCalculationUtils works it out: region, plot_file, area, the area divided among the plots whose `region` or
 * `plot_file` answer is the line's. Every plot keeps its share, whatever its answers: a plot that could not be assessed
 * (noData) stands for its share as its own class, so each region's plots add up to its area
 * (docs/plans/2026-11-11-strata-areas.md, decision 1). The weight is the factor divided by the smallest one above 0.
 * Only the plots' first assessments count. (areas_per_attribute.csv: src/areas.ts strataFactors, as the dashboard's.)
 */
export function expansionFactors(regionAreas: string, plots: ReadonlyMap<string, Record<string, string>>, model: AnalysisModel): Factors {
  const columnKey = (name: string) => model.tables[0].columns.find((c) => c.name === name)?.key ?? null;
  const unknownColumns: string[] = [];
  // A column not in the survey may still be in the plots' answers (a plot file's column Collect Earth sent as text)
  const keyOf = (name: string) => {
    const key = columnKey(name) ?? `collect_text_${name}`;
    if (columnKey(name) === null && ![...plots.values()].some((s) => key in s) && !unknownColumns.includes(name)) unknownColumns.push(name);
    return key;
  };
  const byPlot = new Map<string, { factor: number; weight: number; stratum: string }>();
  let unmatched = 0;
  const separator = csvSeparatorOf(regionAreas);
  const region = keyOf('region');
  const plotFile = keyOf('plot_file');
  /** The region a plot would be in, as the file writes it: for the plots of no line. */
  const valuesOf = (s: Record<string, string>) => [s[region] ?? '', s[plotFile] ?? ''].filter((x) => x !== '').join(' / ');
  parseCsv(regionAreas).forEach((line, i) => {
    const area = areaOf(line[2], separator);
    if (line.length < 3 || !Number.isFinite(area)) {
      if (i > 0) unmatched++; // a first line that is not a number is the header
      return;
    }
    const matching = [...plots].filter(([, s]) => s[region] === line[0] || s[plotFile] === line[1]).map(([p]) => p);
    if (matching.length === 0) { unmatched++; return; }
    const stratum = [line[0], line[1]].filter((x) => x !== '').join(' / ');
    for (const p of matching) byPlot.set(p, { factor: area / matching.length, weight: 1, stratum });
  });
  withWeights(byPlot);
  const outside = new Map<string, number>();
  for (const [p, s] of plots) if (!byPlot.has(p)) outside.set(valuesOf(s), (outside.get(valuesOf(s)) ?? 0) + 1);
  const examples = [...outside].map(([stratum, n]) => ({ stratum, plots: n })).sort((a, b) => b.plots - a.plots || a.stratum.localeCompare(b.stratum)).slice(0, 5);
  return { source: REGION_AREAS_CSV, byPlot, unmatched, unknownColumns, noStratum: { plots: plots.size - byPlot.size, examples } };
}
