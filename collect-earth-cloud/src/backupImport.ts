// A new project from a Collect Earth backup (docs/plans/2026-11-11-backup-import.md): the zip Collect Earth's "Export
// data to XML (ZIP)" writes, and the cloud's own Collect backup (collectBackup.ts): `idml.xml`, the survey, then one
// `<step>/<n>.xml` per record. It holds the survey and the records, not the project file nor the plot file, so the
// project file is made from the survey (projectFile.ts), the plots that have records are written from the records
// (their key, their location and the attributes filled from the plot file, collectearth:fromcsv), and each record is
// read and summarized as the import into an existing project reads it (collectImport.ts backupReader), so that the
// dashboard and the exports read the imported records as they read the ones a desktop sends.
import { csvTextOf } from './analysis.js';
import { CepError, attr, childrenOf, parseSurvey, tagOf, textOf, zipEntryList, type XmlNode, type ZipEntryReader } from './cep.js';
import type { PlotLayout } from './ceo/plots.js';
import { backupReader } from './collectImport.js';

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
// The survey

export interface BackupSurvey {
  xml: string;
  /** the root entity's name (plot) */
  root: string;
  /** the names of the root's key attributes, in order (id, round) */
  keys: string[];
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
  /** the root's coordinate that places a plot: "location", as Collect Earth names it, else the first; null without one */
  location: string | null;
}

/** The survey of a backup (its idml.xml), read for importing its records. Throws CepError (survey_unreadable). */
export function backupSurvey(xml: string): BackupSurvey {
  const { survey, surveyChildren, root, rootEntity, pickLabel } = parseSurvey(xml);
  /** the names of the root's attributes that pass the test */
  const attributes = (test: (n: XmlNode) => boolean) =>
    childrenOf(root).filter((n) => tagOf(n) !== 'entity' && attr(n, 'name') && test(n)).map((n) => attr(n, 'name')!);
  const coordinates = attributes((n) => tagOf(n) === 'coordinate');
  const title = textOf(pickLabel(surveyChildren.filter((n) => tagOf(n) === 'project')) ?? {});
  const uri = textOf(surveyChildren.find((n) => tagOf(n) === 'uri') ?? {});
  const number = (name: string) => {
    const v = Number(attr(survey, name));
    return attr(survey, name) !== undefined && Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    xml,
    root: rootEntity,
    keys: attributes((n) => attr(n, 'key') === 'true'),
    title,
    uri,
    surveyName: uri.replace(/\/+$/, '').split('/').pop() || rootEntity,
    plotAreaHa: number('collectearth:plotarea'),
    samplePoints: number('collectearth:samplepoints'),
    plotColumns: attributes((n) => attr(n, 'collectearth:fromcsv') === 'true'),
    location: coordinates.includes('location') ? 'location' : (coordinates[0] ?? null),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// A record

/** One record of the backup, read: what the preview and the plot files need of it, not its XML. */
export interface BackupRecord {
  /** the file in the zip (1/24971.xml) */
  path: string;
  /** the record's step, its folder: 1 entry, 2 cleansing, 3 analysis */
  step: number;
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
  /** what storing it takes, as the import into a project counts it: its XML and its summary, in bytes */
  bytes: number;
}

/** The text of one field of an attribute's element (<value>, <code>, <x>…), '' when absent. */
function field(node: XmlNode, name: string): string {
  const f = childrenOf(node).find((c) => tagOf(c) === name);
  return f ? textOf(f) : '';
}

/** A record's file: <step>/<n>.xml, as Collect Earth's export writes them, or data/<step>/<n>.xml in Collect's own backup (.collect, SurveyBackupJob). */
const RECORD_PATH = /^(?:data\/)?([123])\/([^/]+\.xml)$/;

/** The step of a record's file: its folder (1/x.xml or data/1/x.xml). */
export const stepOf = (path: string): number => Number(RECORD_PATH.exec(path)?.[1] ?? 1);

/** Reads the backup's records against its survey, one file at a time; the reader throws BackupError for a file that is not a record of it. */
export function recordReader(survey: BackupSurvey): (entry: ZipEntryReader) => BackupRecord {
  const read = backupReader(survey.xml, null);
  const roundIndex = survey.keys.indexOf('round');
  return (entry) => {
    const r = read({ name: entry.name, step: stepOf(entry.name), xml: new TextDecoder().decode(entry.read()) });
    if ('problem' in r) throw new BackupError('not_a_backup', `The backup's record ${r.problem}.`);
    let location: BackupRecord['location'] = null;
    const node = survey.location ? r.children.get(survey.location)?.[0] : undefined;
    if (node) {
      const x = Number(field(node, 'x'));
      const y = Number(field(node, 'y'));
      const srs = field(node, 'srs');
      if ((srs === '' || /^EPSG:4326$/i.test(srs)) && field(node, 'x') !== '' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(y) <= 90 && Math.abs(x) <= 180) {
        location = { lat: y, lon: x };
      }
    }
    const columns: Record<string, string> = {};
    for (const name of survey.plotColumns) {
      const column = r.children.get(name)?.[0];
      const raw = column ? field(column, 'value') || field(column, 'code') : '';
      if (raw !== '') columns[name] = raw;
    }
    return {
      path: entry.name,
      step: r.step,
      keyValues: r.keyValues,
      plotId: r.keyValues.filter((_, i) => i !== roundIndex).join(','),
      location,
      operator: r.operator.trim(),
      activelySaved: r.activelySaved,
      modifiedOn: r.modifiedOn,
      columns,
      bytes: Buffer.byteLength(r.xml) + Buffer.byteLength(JSON.stringify(r.summary)),
    };
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The zip

export interface BackupZip {
  survey: BackupSurvey;
  /** the records' files, one per record, in the zip's order, each read when asked */
  records: ZipEntryReader[];
  /** the area of each stratum (areas_per_attribute.csv), in Collect's own backup (.collect): its files/ce_area file; null without one */
  areas: string | null;
}

/** The survey's areas per attribute in a .collect (Collect's survey file type ce_area), whatever the file's name. */
const AREAS_PATH = /^files\/ce_area\/[^/]+\.csv$/i;

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
  // Collect writes a record once per step folder up to its own (1/, 2/, 3/): the copy of the last step is the record
  const byId = new Map<string, ZipEntryReader>();
  for (const e of entries) {
    const id = RECORD_PATH.exec(e.name)?.[2];
    if (id === undefined) continue;
    const kept = byId.get(id);
    if (!kept || stepOf(e.name) > stepOf(kept.name)) byId.set(id, e);
  }
  const records = [...byId.values()];
  const tooLarge = records.find((e) => e.size > BACKUP_LIMITS.maxRecordBytes);
  if (tooLarge) throw new BackupError('too_large', `The backup's record ${tooLarge.name} is larger than the server reads.`);
  const areasEntry = entries.find((e) => AREAS_PATH.test(e.name));
  if (areasEntry && areasEntry.size > BACKUP_LIMITS.maxSurveyBytes) throw new BackupError('too_large', "The backup's areas file is larger than the server reads.");
  return { survey, records, areas: areasEntry ? csvTextOf(areasEntry.read()) : null };
}

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
