// A new project from a Collect Earth backup (docs/plans/2026-11-11-backup-import.md): the zip Collect Earth's "Export
// data to XML (ZIP)" writes, and the cloud's own Collect backup (collectBackup.ts): `idml.xml`, the survey, then one
// `<step>/<n>.xml` per record. It holds the survey and the records, not the project file nor the plot file, so the
// project file is made from the survey (projectFile.ts), the plots that have records are written from the records
// (their key, their location and the attributes filled from the plot file, collectearth:fromcsv), and each record's
// summary is made as Collect Earth makes it (BalloonInputFieldsUtils.getValuesByHtmlParameters), so that the
// dashboard and the exports read the imported records as they read the ones a desktop sends.
import { CepError, attr, childrenOf, parseSurvey, parser, tagOf, textOf, zipEntryList, type XmlNode, type ZipEntryReader } from './cep.js';
import type { PlotLayout } from './ceo/plots.js';

const MB = 1024 * 1024;

/** How much a backup may hold: read one file at a time, so many files and much XML do not fill the server's memory. */
export const BACKUP_LIMITS = {
  maxEntries: 200_000,
  /** a record's XML compresses about ten times; a backup of 100,000 records unzips to about 2 GB */
  maxTotalBytes: 3 * 1024 * MB,
  maxRatio: 60,
  minAllowanceBytes: 20 * MB,
  maxSurveyBytes: 10 * MB,
  maxRecordBytes: 5 * MB,
};

export const SURVEY_PATH = 'idml.xml';

/** Why a backup cannot be used, in words for the coordinator. */
export class BackupError extends Error {
  constructor(
    public code: 'not_a_backup' | 'too_large',
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The survey, as summarizing a record needs it

/** A node of the survey: an attribute or an entity. */
export interface NodeDef {
  name: string;
  /** the IDML element: text, code, number, boolean, coordinate, date, time, range, taxon, file, entity */
  tag: string;
  /** Collect Earth's prefix of its summary keys ("code_"), null for a node it has no handler for (taxon, file) */
  prefix: string | null;
  /** number and range: integer or real */
  numberType: 'integer' | 'real';
  multiple: boolean;
  key: boolean;
  /** filled from the plot file (collectearth:fromcsv) */
  fromCsv: boolean;
  /** an entity's children, in the survey's order */
  children: NodeDef[];
  /** a multiple entity with a row per item of its key's code list (collect:enumerate) */
  enumerate: boolean;
  /** a code attribute's list */
  list: string | null;
}

export interface BackupSurvey {
  xml: string;
  /** the root entity's name (plot) */
  root: string;
  /** its nodes, in order */
  defs: NodeDef[];
  /** the root's key attributes, in order (id, round) */
  keys: NodeDef[];
  /** the project's name (the survey's <project>, in its default language) */
  title: string;
  uri: string;
  /** the survey's name, as Collect Earth's project file names it: the last part of its address */
  surveyName: string;
  /** collectearth:plotarea, in hectares; null when not given */
  plotAreaHa: number | null;
  /** collectearth:samplepoints; null when not given */
  samplePoints: number | null;
  /** the attributes filled from the plot file, in order: the plot file's extra columns */
  plotColumns: string[];
  /** the codes of the first level of each code list, by list name (an enumerated entity's rows) */
  listCodes: Map<string, string[]>;
}

/** Collect Earth's attribute handlers (BalloonInputFieldsUtils): the summary key's prefix of a node, null when none. */
function prefixOf(tag: string, numberType: 'integer' | 'real'): string | null {
  switch (tag) {
    case 'boolean':
      return 'boolean_';
    case 'code':
      return 'code_';
    case 'coordinate':
      return 'coord_';
    case 'date':
      return 'date_';
    case 'entity':
      return 'entity_';
    case 'number':
      return numberType === 'real' ? 'real_' : 'integer_';
    case 'range':
      return numberType === 'real' ? 'real_range_' : 'integer_range_';
    case 'text':
      return 'text_';
    case 'time':
      return 'time_';
    default:
      return null;
  }
}

const SKIPPED = new Set(['label', 'description', 'prompt', 'check', 'compare', 'distance', 'pattern', 'custom', 'unique', 'default', 'precision', 'unit', 'attributeDefault', '#text', '#comment']);

function defsOf(parent: XmlNode): NodeDef[] {
  const out: NodeDef[] = [];
  for (const n of childrenOf(parent)) {
    const tag = tagOf(n);
    const name = attr(n, 'name');
    if (!tag || SKIPPED.has(tag) || !name) continue;
    const numberType = attr(n, 'type') === 'real' ? 'real' : 'integer';
    out.push({
      name,
      tag,
      prefix: prefixOf(tag, numberType),
      numberType,
      multiple: attr(n, 'multiple') === 'true',
      key: attr(n, 'key') === 'true',
      fromCsv: attr(n, 'collectearth:fromcsv') === 'true',
      children: tag === 'entity' ? defsOf(n) : [],
      enumerate: tag === 'entity' && attr(n, 'collect:enumerate') === 'true',
      list: tag === 'code' ? attr(n, 'list') ?? null : null,
    });
  }
  return out;
}

/** The first level of every code list of the survey, by name. */
function listCodesOf(surveyChildren: XmlNode[]): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  const codeLists = surveyChildren.find((n) => tagOf(n) === 'codeLists');
  for (const list of codeLists ? childrenOf(codeLists) : []) {
    if (tagOf(list) !== 'list') continue;
    const name = attr(list, 'name');
    if (!name) continue;
    const items = childrenOf(list).find((n) => tagOf(n) === 'items');
    lists.set(
      name,
      (items ? childrenOf(items) : [])
        .filter((i) => tagOf(i) === 'item')
        .map((i) => textOf(childrenOf(i).find((c) => tagOf(c) === 'code') ?? {}))
        .filter((c) => c !== ''),
    );
  }
  return lists;
}

/** The survey of a backup (its idml.xml), read for importing its records. Throws CepError (survey_unreadable). */
export function backupSurvey(xml: string): BackupSurvey {
  const { survey, surveyChildren, root, rootEntity, pickLabel } = parseSurvey(xml);
  const defs = defsOf(root);
  const title = textOf(pickLabel(surveyChildren.filter((n) => tagOf(n) === 'project')) ?? {});
  const uri = textOf(surveyChildren.find((n) => tagOf(n) === 'uri') ?? {});
  const number = (name: string) => {
    const v = Number(attr(survey, name));
    return attr(survey, name) !== undefined && Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    xml,
    root: rootEntity,
    defs,
    keys: defs.filter((d) => d.key && d.tag !== 'entity'),
    title,
    uri,
    surveyName: uri.replace(/\/+$/, '').split('/').pop() || rootEntity,
    plotAreaHa: number('collectearth:plotarea'),
    samplePoints: number('collectearth:samplepoints'),
    plotColumns: defs.filter((d) => d.fromCsv && d.tag !== 'entity').map((d) => d.name),
    listCodes: listCodesOf(surveyChildren),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Values, as Collect Earth's handlers write them

/** A double as Java's Double.toString writes it: 27.0, 0.5, 1.0E7, 1.0E-4. */
export function javaDoubleText(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0';
  const abs = Math.abs(n);
  if (abs >= 1e-3 && abs < 1e7) return Number.isInteger(n) ? n.toFixed(1) : String(n);
  const [mantissa, exponent] = n.toExponential().split('e');
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
}

/** A range's bound as RangeAttributeHandler writes it (a real without trailing zeros: BigDecimal.toPlainString). */
function rangeBound(text: string, real: boolean): string | null {
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (!real) return String(Math.trunc(n));
  // toPlainString: no exponent; stripTrailingZeros: 2.0 is "2"
  const plain = Math.abs(n) >= 1e21 || (Math.abs(n) < 1e-6 && n !== 0) ? n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : String(n);
  return plain;
}

const two = (n: number) => String(n).padStart(2, '0');

/** The text of one field of an attribute's element (<value>, <code>, <x>…), '' when absent. */
function field(node: XmlNode, name: string): string {
  const f = childrenOf(node).find((c) => tagOf(c) === name);
  return f ? textOf(f) : '';
}

/** An attribute's value as Collect Earth's handler writes it (getParameterValue), null when it has none. */
export function attributeValue(def: NodeDef, node: XmlNode): string | null {
  switch (def.tag) {
    case 'text': {
      const v = field(node, 'value');
      return v === '' ? null : v;
    }
    case 'boolean': {
      const v = field(node, 'value');
      return v === '' ? null : v;
    }
    case 'code': {
      const code = field(node, 'code');
      if (code === '') return null;
      const qualifier = field(node, 'qualifier');
      return qualifier.trim() === '' ? code : `${code}::${qualifier}`;
    }
    case 'number': {
      const v = field(node, 'value');
      if (v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return def.numberType === 'real' ? javaDoubleText(n) : String(Math.trunc(n));
    }
    case 'range': {
      const from = rangeBound(field(node, 'from'), def.numberType === 'real');
      if (from === null) return null;
      const to = rangeBound(field(node, 'to'), def.numberType === 'real');
      return to === null || to === from ? from : `${from}-${to}`;
    }
    case 'coordinate': {
      // Collect's coordinate always has a value, its parts null when empty: "null,null" (CoordinateAttributeHandler)
      const x = field(node, 'x');
      const y = field(node, 'y');
      const text = (s: string) => (s === '' || !Number.isFinite(Number(s)) ? 'null' : javaDoubleText(Number(s)));
      return `${text(y)},${text(x)}`;
    }
    case 'date': {
      const year = Number(field(node, 'year'));
      const month = Number(field(node, 'month'));
      const day = Number(field(node, 'day'));
      if (!field(node, 'year') || !field(node, 'month') || !field(node, 'day') || ![year, month, day].every(Number.isInteger)) return null;
      return `${two(month)}/${two(day)}/${String(year).padStart(4, '0')}`;
    }
    case 'time': {
      const hour = field(node, 'hour');
      const minute = field(node, 'minute');
      if (hour === '' || minute === '') return null;
      return `${two(Number(hour))}:${two(Number(minute))}`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A record

/** One record of the backup, read. */
export interface BackupRecord {
  /** the file in the zip (1/24971.xml) */
  path: string;
  /** the record's step: 1 entry, 2 cleansing, 3 analysis */
  step: number;
  xml: string;
  /** the root's key values, in the survey's order */
  keyValues: string[];
  /** its plot: the key values without the round */
  plotId: string;
  /** its location (EPSG:4326), null when it has none the plot file can take */
  location: { lat: number; lon: number } | null;
  operator: string;
  activelySaved: boolean;
  /** the record's modified time (created when none), ms; null when it has neither */
  modifiedOn: number | null;
  /** the plot file's columns (BackupSurvey.plotColumns), as written in the record */
  columns: Record<string, string>;
  /** Collect Earth's summary of it, before its operator is changed */
  summary: Record<string, string>;
}

const SEPARATOR = '===';

/** The element children of a node, without text and comments. */
const elementsOf = (node: XmlNode): XmlNode[] => childrenOf(node).filter((c) => {
  const t = tagOf(c);
  return t !== null && !t.startsWith('#');
});

/**
 * The summary of a record's root entity, as BalloonInputFieldsUtils.getValuesByHtmlParameters makes it from the record
 * Collect Earth loads (every single attribute of the root there, empty or not; an enumerated entity with a row per
 * item of its list), with '' for an empty attribute as the server keeps it (records.ts, summaryOf).
 */
export function recordSummary(survey: Pick<BackupSurvey, 'defs' | 'listCodes'>, root: XmlNode): Record<string, string> {
  const out: Record<string, string | null> = {};
  const children = elementsOf(root);
  for (const def of survey.defs) {
    if (def.prefix === null) continue;
    const nodes = children.filter((c) => tagOf(c) === def.name);
    const key = `collect_${def.prefix}${def.name}`;
    if (def.tag !== 'entity') {
      // A single attribute always has its node in a loaded record (RecordUpdater.initializeRecord), even empty
      const values = nodes.length > 0 ? nodes.map((n) => attributeValue(def, n)) : def.multiple ? [] : [attributeValue(def, {})];
      // As getHTMLParameterName, once per node: the first value while there is none, else the next one after the
      // separator ("null" for an empty one; past the last node, nothing)
      for (let i = 0; i < values.length; i++) {
        const current = out[key] ?? null;
        if (current === null) out[key] = values[0];
        else {
          const index = current.split(SEPARATOR).length;
          if (index < values.length) out[key] = `${current}${SEPARATOR}${values[index]}`;
        }
      }
      continue;
    }
    const rows: { name: string; node: XmlNode | null }[] = [];
    if (def.multiple && def.enumerate) {
      // A row per item of the key's list (added when the record is loaded), each named by its key
      const keyDef = def.children.find((c) => c.key && c.tag === 'code');
      const present = new Set<string>();
      for (const n of nodes) {
        const node = keyDef ? childrenOf(n).find((c) => tagOf(c) === keyDef.name) : undefined;
        const code = (keyDef && node ? attributeValue(keyDef, node) : null)?.split('::')[0] ?? '';
        present.add(code);
        rows.push({ name: `${key}[${code}]`, node: n });
      }
      // The rows the record lacks: only their key
      for (const code of keyDef?.list ? survey.listCodes.get(keyDef.list) ?? [] : []) {
        if (!present.has(code)) out[`${key}[${code}].${keyDef!.prefix}${keyDef!.name}`] = code;
      }
    } else if (def.multiple) {
      nodes.forEach((n, i) => rows.push({ name: `${key}[${i + 1}]`, node: n }));
    } else {
      rows.push({ name: key, node: nodes[0] ?? null });
    }
    for (const { name, node } of rows) {
      if (node === null) continue;
      const rowChildren = elementsOf(node);
      for (const child of def.children) {
        // A nested entity has no value Collect Earth can write
        if (child.prefix === null || child.tag === 'entity') continue;
        const parts = rowChildren
          .filter((c) => tagOf(c) === child.name)
          .map((c) => attributeValue(child, c))
          .filter((v): v is string => v !== null && v.trim() !== '');
        if (parts.length > 0) out[`${name}.${child.prefix}${child.name}`] = parts.join(SEPARATOR);
      }
    }
  }
  const summary: Record<string, string> = {};
  for (const [k, v] of Object.entries(out)) summary[k] = v ?? '';
  return summary;
}

/** An instant of Collect's XML (2025-09-24T13:09:19.124+02:00), in ms; null when unreadable. */
const instant = (text: string | undefined): number | null => {
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isFinite(t) ? t : null;
};

/** A record of the backup, read against its survey. Throws BackupError when it is not one of the survey's records. */
export function readRecord(survey: BackupSurvey, path: string, xml: string): BackupRecord {
  const bad = (why: string) => new BackupError('not_a_backup', `The backup's record ${path} cannot be read: ${why}.`);
  if (/<!DOCTYPE/i.test(xml)) throw bad('it has a DOCTYPE');
  let document: XmlNode[];
  try {
    document = parser.parse(xml) as XmlNode[];
  } catch {
    throw bad('it is not valid XML');
  }
  const root = document.find((n) => tagOf(n) === survey.root);
  if (!root) throw bad(`it has no <${survey.root}> element`);
  const children = elementsOf(root);
  const valueOf = (def: NodeDef | undefined): string | null => {
    if (!def) return null;
    const node = children.find((c) => tagOf(c) === def.name);
    return node ? attributeValue(def, node) : null;
  };
  const keyValues = survey.keys.map((k) => valueOf(k)?.split('::')[0] ?? '');
  if (keyValues.some((k) => k === '')) throw bad('it has no value for a key of the survey');
  const plotId = survey.keys
    .map((k, i) => ({ k, v: keyValues[i] }))
    .filter(({ k }) => k.name !== 'round')
    .map(({ v }) => v)
    .join(',');

  // The plot's place: the root's coordinate "location" (as Collect Earth names it), in latitude and longitude
  const locationDef = survey.defs.find((d) => d.tag === 'coordinate' && d.name === 'location') ?? survey.defs.find((d) => d.tag === 'coordinate');
  let location: BackupRecord['location'] = null;
  const locationNode = locationDef ? children.find((c) => tagOf(c) === locationDef.name) : undefined;
  if (locationNode) {
    const x = Number(field(locationNode, 'x'));
    const y = Number(field(locationNode, 'y'));
    const srs = field(locationNode, 'srs');
    if ((srs === '' || /^EPSG:4326$/i.test(srs)) && field(locationNode, 'x') !== '' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= 90 && Math.abs(x) <= 180) {
      location = { lat: y, lon: x };
    }
  }
  const columns: Record<string, string> = {};
  for (const name of survey.plotColumns) {
    const def = survey.defs.find((d) => d.name === name);
    const node = def ? children.find((c) => tagOf(c) === name) : undefined;
    const raw = node ? field(node, def!.tag === 'code' ? 'code' : 'value') : '';
    if (raw !== '') columns[name] = raw;
  }
  const step = Number(attr(root, 'step'));
  return {
    path,
    step: Number.isInteger(step) && step >= 1 && step <= 3 ? step : Number(path.split('/')[0]) || 1,
    xml,
    keyValues,
    plotId,
    location,
    operator: (valueOf(survey.defs.find((d) => d.name === 'operator' && d.tag === 'text')) ?? '').trim(),
    activelySaved: valueOf(survey.defs.find((d) => d.name === 'actively_saved' && d.tag === 'boolean')) === 'true',
    modifiedOn: instant(attr(root, 'modified')) ?? instant(attr(root, 'created')),
    columns,
    summary: recordSummary(survey, root),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The zip

export interface BackupZip {
  survey: BackupSurvey;
  /** the records' files, in the zip's order, each read when asked */
  records: ZipEntryReader[];
}

/** A record's file: <step>/<n>.xml, as Collect writes them. */
const RECORD_PATH = /^[123]\/[^/]+\.xml$/;

/** Opens a backup: its survey read, its records listed. Throws BackupError, or CepError for a survey it cannot read. */
export function openBackup(zip: Buffer): BackupZip {
  let entries: ZipEntryReader[];
  try {
    entries = zipEntryList(
      zip,
      BACKUP_LIMITS.maxEntries,
      Math.min(BACKUP_LIMITS.maxTotalBytes, Math.max(BACKUP_LIMITS.maxRatio * zip.length, BACKUP_LIMITS.minAllowanceBytes)),
      'The backup',
    );
  } catch (e) {
    if (e instanceof CepError) throw new BackupError(e.code === 'too_large' ? 'too_large' : 'not_a_backup', e.message);
    throw e;
  }
  const surveyEntry = entries.find((e) => e.name === SURVEY_PATH);
  if (!surveyEntry) {
    const isProjectFile = entries.some((e) => e.name === 'project_definition.properties' || e.name === 'placemark.idm.xml');
    throw new BackupError(
      'not_a_backup',
      isProjectFile
        ? 'This is a project file (.cep), not a backup of the data: upload it as the project file of a new project instead.'
        : 'This is not a Collect Earth backup: it has no idml.xml. Make one in Collect Earth with "Export data to XML (ZIP)".',
    );
  }
  if (surveyEntry.size > BACKUP_LIMITS.maxSurveyBytes) throw new BackupError('too_large', "The backup's survey is larger than the server reads.");
  const survey = backupSurvey(new TextDecoder().decode(surveyEntry.read()));
  const records = entries.filter((e) => RECORD_PATH.test(e.name));
  const tooLarge = records.find((e) => e.size > BACKUP_LIMITS.maxRecordBytes);
  if (tooLarge) throw new BackupError('too_large', `The backup's record ${tooLarge.name} is larger than the server reads.`);
  return { survey, records };
}

/** A record file of the backup, read. */
export const readBackupRecord = (survey: BackupSurvey, entry: ZipEntryReader): BackupRecord =>
  readRecord(survey, entry.name, new TextDecoder().decode(entry.read()));

// ---------------------------------------------------------------------------------------------------------------
// The plots

/**
 * The plot layout the survey suggests: a square of its plot area with its sample points in a grid (the side split in
 * equal parts, a point in the middle of each), as Collect Earth's square plots are; Collect Earth's demo layout when the
 * survey gives no area.
 */
export function suggestedLayout(survey: Pick<BackupSurvey, 'plotAreaHa' | 'samplePoints'>): PlotLayout {
  const points = survey.samplePoints !== null ? Math.round(survey.samplePoints) : 25;
  const side = survey.plotAreaHa !== null ? Math.sqrt(survey.plotAreaHa * 10_000) : 100;
  const n = Math.max(1, Math.round(Math.sqrt(points)));
  // in centimetres, as a person types them: the spacing, then the margin that keeps the side
  const cm = (m: number) => Math.round(m * 100) / 100;
  const distance = cm(side / n);
  return { shape: 'SQUARE', points: n * n === points ? points : n * n, distance, boundary: cm((side - (n - 1) * distance) / 2), pointSide: 2 };
}

/** The layout asked for, checked; a reason in words when it is not one. */
export function layoutOf(raw: unknown): PlotLayout | string {
  if (raw === null || typeof raw !== 'object') return 'layout must be the plot layout';
  const l = raw as Record<string, unknown>;
  if (l.shape !== 'SQUARE' && l.shape !== 'CIRCLE') return "layout.shape must be 'SQUARE' or 'CIRCLE'";
  const metres = (v: unknown, min: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= 10_000;
  if (!(Number.isInteger(l.points) && (l.points as number) >= 0 && (l.points as number) <= 10_000)) return 'layout.points must be a whole number from 0 to 10,000';
  if (l.shape === 'SQUARE' && (l.points as number) > 1 && !Number.isInteger(Math.sqrt(l.points as number))) return 'a square plot takes a square number of points (4, 9, 25, 49…), or 0 or 1';
  if (!metres(l.distance, 0.1)) return 'layout.distance must be a number of metres from 0.1 to 10,000';
  if (!metres(l.boundary, 0)) return 'layout.boundary must be a number of metres from 0 to 10,000';
  if (!metres(l.pointSide, 0.1)) return 'layout.pointSide must be a number of metres from 0.1 to 10,000';
  return { shape: l.shape, points: l.points as number, distance: l.distance as number, boundary: l.boundary as number, pointSide: l.pointSide as number };
}
