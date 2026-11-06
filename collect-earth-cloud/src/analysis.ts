// The analysis of the collected data (docs/plans/2026-11-05-node-and-arena.md, "Presenting the data", stage 6a): what
// replaces Saiku. Everything is generated from the survey, as Collect's cube generator does for Saiku, so any survey works:
// - analysisModel: the tables (the plot and each of its multiple entities), their columns with labels in every language
//   of the survey, and the code lists, from the survey (placemark.idm.xml);
// - analysisTables: the rows of those tables, from the records' summaries (the flat answers Collect Earth sends);
// - expansionFactors: the area each plot stands for, from the project file's region_areas.csv or
//   areas_per_attribute.csv, as Collect Earth's RegionCalculationUtils works it out for Saiku.
// The browser loads the tables into DuckDB and pivots them (web/src/analysis): the server never aggregates.
import { attr, childrenOf, elements, parseSurvey, tagOf, textOf, type XmlNode } from './cep.js';
import { prefixOf, QUALIFIER_SEPARATOR } from './surveyOutline.js';

/** A label per language: the survey's languages, "" for a label without xml:lang. */
export type Labels = Record<string, string>;

export type ColumnType = 'code' | 'boolean' | 'integer' | 'real' | 'text' | 'date' | 'time';

export interface AnalysisColumn {
  /** The column's name in its table (the attribute's name; an attribute of a single entity: entity_attribute). */
  name: string;
  /** The summary key it is read from (for a multiple entity, the part after `[key].`). */
  key: string;
  labels: Labels;
  type: ColumnType;
  /** For a code: its list. */
  list: string | null;
  calculated: boolean;
  /** Several values (the summary joins them with "==="): kept as text. */
  multiple: boolean;
  /** Filled from the plot file (collectearth:fromcsv): province, elevation… */
  fromPlotFile: boolean;
  /** A key attribute of the survey (the plot's id, the assessment round): what identifies a record, not an answer. */
  keyAttr: boolean;
  /** For a code: the column of the code it depends on (`parent` in the survey: a land use's subdivision), else null. */
  parent: string | null;
  /**
   * The yes/no column the question is asked after (its `relevant` expression starts with it: "change2", "change2 and
   * …"), else null: the analysis page counts such answers among the plots where it is yes (the year of a change…).
   */
  relevantIf: string | null;
}

export interface AnalysisTable {
  /** "plot" for the root entity, else the multiple entity's name. */
  name: string;
  labels: Labels;
  /** For a multiple entity: the column holding the entity's key (the code or number in `[…]` of its summary keys). */
  keyColumn: string | null;
  columns: AnalysisColumn[];
}

export interface ListItem {
  code: string;
  labels: Labels;
  /** The code of the item above it in a hierarchical list, else null. */
  parent: string | null;
  level: number;
}

export interface AnalysisModel {
  /** The survey's languages; the first is the default one (labels without xml:lang). */
  languages: string[];
  tables: AnalysisTable[];
  lists: Record<string, ListItem[]>;
}

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

/** A table's rows, as CSV text with a header (RFC 4180), and their count. */
export interface TableData {
  name: string;
  /** Column name → DuckDB type, in order: the browser reads the CSV with these types. */
  columns: [string, string][];
  rows: number;
  csv: string;
}

/** Whether a raw answer is usable for its type: "" is NULL, a number must parse, a boolean be true or false… */
function cell(c: AnalysisColumn, raw: string | undefined): string {
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
      // Collect writes dd/MM/yyyy in summaries; ISO dates kept as they are
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
      if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return /^\d{4}-\d{2}-\d{2}/.test(raw.trim()) ? raw.trim().slice(0, 10) : '';
    }
    default:
      return raw;
  }
}

const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The rows of every table of the model, from the records (deleted ones left out by the caller). `factors` gives each
 * plot's expansion factor and weight (expansionFactors); a record of a plot without one gets none.
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
          const f = r.plot !== null ? factors.get(r.plot) : undefined;
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

/** The value of a plot's answer for matching an areas file: numbers and booleans as Collect's database compares them. */
function comparable(v: string | undefined): string {
  if (v === undefined) return '';
  const t = v.trim();
  if (t === 'true' || t === 'false') return t;
  if (t !== '' && Number.isFinite(Number(t))) return String(Number(t));
  return t;
}

/** A small CSV parser (comma, semicolon or tab, quotes): the areas files are a few hundred lines at most. */
export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const sep = [',', ';', '\t'].map((s) => [s, lines[0].split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
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

export const REGION_AREAS_CSV = 'region_areas.csv';
export const ATTRIBUTE_AREAS_CSV = 'areas_per_attribute.csv';
/** The land use code of plots with no data: they stand for no area (RegionCalculationUtils.NO_DATA_LAND_USE). */
const NO_DATA_LAND_USE = 'noData';

export interface Factors {
  /** Which file gave them. */
  source: typeof REGION_AREAS_CSV | typeof ATTRIBUTE_AREAS_CSV;
  byPlot: Map<string, { factor: number; weight: number }>;
  /** Lines of the file that matched no plot, or could not be read. */
  unmatched: number;
}

/**
 * The expansion factor of each plot (the area in hectares it stands for), as RegionCalculationUtils works it out: from
 * region_areas.csv (region, plot_file, area: the area divided among the plots whose `region` or `plot_file` answer is
 * the line's, plots of land use noData standing for none), else from areas_per_attribute.csv (a header of attribute
 * names then `area` and optionally `weight`: the area divided among the plots whose answers are the line's). The weight
 * is the factor divided by the smallest one above 0. Only the plots' first assessments count; null without either file.
 */
export function expansionFactors(
  files: { regionAreas?: string; attributeAreas?: string },
  plots: ReadonlyMap<string, Record<string, string>>,
  model: AnalysisModel,
): Factors | null {
  const keyOf = (name: string) => model.tables[0].columns.find((c) => c.name === name)?.key ?? `collect_text_${name}`;
  const byPlot = new Map<string, { factor: number; weight: number }>();
  let unmatched = 0;
  let source: Factors['source'] | null = null;
  if (files.regionAreas) {
    source = REGION_AREAS_CSV;
    const region = keyOf('region');
    const plotFile = keyOf('plot_file');
    const landUse = keyOf('land_use_category');
    for (const line of parseCsv(files.regionAreas)) {
      const area = Number(line[2]);
      if (line.length < 3 || !Number.isFinite(area)) { unmatched++; continue; } // the header, or a broken line
      const matching = [...plots].filter(([, s]) => (s[region] === line[0] || s[plotFile] === line[1]) && s[landUse] !== NO_DATA_LAND_USE).map(([p]) => p);
      if (matching.length === 0) { unmatched++; continue; }
      for (const p of matching) byPlot.set(p, { factor: area / matching.length, weight: 1 });
    }
    for (const [p, s] of plots) if (s[landUse] === NO_DATA_LAND_USE) byPlot.set(p, { factor: 0, weight: 0 });
  } else if (files.attributeAreas) {
    source = ATTRIBUTE_AREAS_CSV;
    const [header, ...lines] = parseCsv(files.attributeAreas);
    if (!header || header.length < 2) return null;
    const hasWeight = header[header.length - 1].toLowerCase() === 'weight';
    const attributes = header.slice(0, hasWeight ? -2 : -1).map(keyOf);
    for (const line of lines) {
      const area = Number(line[attributes.length]);
      if (!Number.isFinite(area)) { unmatched++; continue; }
      const values = line.slice(0, attributes.length).map(comparable);
      const matching = [...plots].filter(([, s]) => attributes.every((k, i) => comparable(s[k]) === values[i])).map(([p]) => p);
      if (matching.length === 0) { unmatched++; continue; }
      for (const p of matching) byPlot.set(p, { factor: area / matching.length, weight: 1 });
    }
  }
  if (source === null) return null;
  const positive = [...byPlot.values()].map((f) => f.factor).filter((f) => f > 0);
  const min = positive.length > 0 ? Math.min(...positive) : 0;
  for (const f of byPlot.values()) f.weight = min > 0 ? f.factor / min : 0;
  return { source, byPlot, unmatched };
}
