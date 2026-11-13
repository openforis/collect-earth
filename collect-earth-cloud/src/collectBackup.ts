// The Collect Earth backup (Task 17): the project's records as a zip that Collect Earth imports
// with "Data Import/Export > Import data (ZIP or CSV)". The layout is the
// one Collect's XMLDataImportProcess reads and Collect Earth's own export writes (see the plan's
// spike): `idml.xml` (the survey), then one `<step>/<n>.xml` per record, nothing else.
// Or the same records as OpenForis Collect's own backup (.collect-backup, Collect's SurveyBackupJob):
// `info.properties`, `idml.xml`, the survey's files (`files/<type>/<name>`), then `data/<step>/<n>.xml`.
import type { RecordRound } from './rounds.js';
import type { Store } from './store/store.js';
import type { RecordState } from './types.js';
import { zipStream, type ZipEntry } from './zipStream.js';
import type { BackupFormat, BackupRounds } from './wire/data.js';

export type { BackupFormat, BackupRounds } from './wire/data.js';

/** Which records: the first assessments only, or every round. */
export const BACKUP_ROUNDS: readonly BackupRounds[] = ['1', 'all'];

/** Which file: the zip Collect Earth imports, or OpenForis Collect's own backup (.collect-backup). */
export const BACKUP_FORMATS: readonly BackupFormat[] = ['zip', 'collect'];

/** About how many bytes of zip a record takes (17 KB of XML deflates to about 1.8 KB). */
export const BYTES_PER_RECORD = 1800;
/** And the survey (the demo's 378 KB deflate to 45 KB). */
export const SURVEY_BYTES = 50_000;

/** One record of the backup, in its order. */
export interface BackupRecord {
  recordKey: string;
  operator: string;
}

export interface BackupPlan {
  rounds: BackupRounds;
  /** One record per key, in key order (code points). */
  records: BackupRecord[];
  /** Of them, not submitted (Collect Earth asks whether to import those). */
  drafts: number;
  /** Records not in the backup: of another round (checks, with rounds '1'). */
  otherRounds: number;
  /**
   * Records not in the backup: the collectors' measurements of reference plots (their round 2,
   * Decision 8), in every mode. The reference itself (round 1) goes in.
   */
  measurements: number;
  /**
   * Records not in the backup because another record has the same key (Collect Earth keeps one
   * record per key: two first assessments of a plot).
   */
  sameKey: number;
  /** Up to 20 keys that had more than one record. */
  sameKeyExamples: string[];
  /** Records not in the backup because the server has no XML for them. */
  noXml: number;
}

export interface PlanInput {
  /** The project's records (Store.listRecordStates); deleted ones are left out. */
  records: readonly RecordState[];
  /** The round of a record (recordResolver(…).round). */
  roundOf: (r: { recordKey: string; operator: string }) => RecordRound;
  /** Whether a record is of a reference plot. */
  isReference: (r: { recordKey: string; operator: string }) => boolean;
  /** Whether the record's person holds its plot as a main plot now (a divided file). */
  isMainHolder: (r: { recordKey: string; operator: string }) => boolean;
  /** Whether the server has the record's XML (Store.listRecordKeysWithoutXml). */
  hasXml: (r: { recordKey: string; operator: string }) => boolean;
}

const MAX_EXAMPLES = 20;

/**
 * Which records go into the backup. With rounds '1', the first assessments (assessment `main`);
 * with 'all', every record. The collectors' measurements of a reference plot (its records other
 * than first assessments) never go in (Decision 8: measured, not decided; their one key could
 * hold only one of them anyway). A record without XML cannot go in. Collect Earth's import
 * compares no two records of one zip (the second of two with one key overwrites the first, or
 * makes a duplicate that breaks later lookups), so each key keeps one record: the one of the
 * person who holds the plot as main now, then a submitted one before a draft, then the latest
 * (`modifiedOn`), then the first username in code-point order. Whether 'all' is allowed (the
 * survey must have the round key) is the caller's to check.
 */
export function planBackup(input: PlanInput, rounds: BackupRounds): BackupPlan {
  const byKey = new Map<string, { r: RecordState; holder: boolean }[]>();
  let otherRounds = 0;
  let measurements = 0;
  let noXml = 0;
  for (const r of input.records) {
    if (r.deleted) continue;
    const main = input.roundOf(r).assessment === 'main';
    if (!main && input.isReference(r)) {
      measurements += 1;
      continue;
    }
    if (rounds === '1' && !main) {
      otherRounds += 1;
      continue;
    }
    if (!input.hasXml(r)) {
      noXml += 1;
      continue;
    }
    const item = { r, holder: main && input.isMainHolder(r) };
    const list = byKey.get(r.recordKey);
    if (list) list.push(item);
    else byKey.set(r.recordKey, [item]);
  }
  const keys = [...byKey.keys()].sort(compare);
  const records: BackupRecord[] = [];
  let drafts = 0;
  let sameKey = 0;
  const sameKeyExamples: string[] = [];
  for (const key of keys) {
    const list = byKey.get(key)!;
    const kept = list.reduce((best, item) => (better(item, best) ? item : best)).r;
    records.push({ recordKey: kept.recordKey, operator: kept.operator });
    if (!kept.activelySaved) drafts += 1;
    if (list.length > 1) {
      sameKey += list.length - 1;
      if (sameKeyExamples.length < MAX_EXAMPLES) sameKeyExamples.push(key);
    }
  }
  return { rounds, records, drafts, otherRounds, measurements, sameKey, sameKeyExamples, noXml };
}

/** Whether `a` is kept before `b` for one key. */
function better(a: { r: RecordState; holder: boolean }, b: { r: RecordState; holder: boolean }): boolean {
  if (a.holder !== b.holder) return a.holder;
  if (a.r.activelySaved !== b.r.activelySaved) return a.r.activelySaved;
  if (a.r.modifiedOn !== b.r.modifiedOn) return a.r.modifiedOn > b.r.modifiedOn;
  return compare(a.r.operator, b.r.operator) < 0;
}

/** Collect's workflow steps, the entry's folder: 1 entry, 2 cleansing, 3 analysis. Anything else (Collect Earth sends 1) is 1. */
function stepOf(step: number): number {
  return step === 2 || step === 3 ? step : 1;
}

/** Records read from the store at a time. */
export const BACKUP_PAGE = 500;

export interface BackupOutcome {
  /** Records written. */
  written: number;
  /** Records of the plan gone since, or without XML now. */
  missing: number;
  /** Records of the plan deleted since. */
  deleted: number;
}

/**
 * The entries of the backup: `head` (the survey as `idml.xml`; collectHead's files for Collect's
 * format), then each record of the plan as `<step>/<n>.xml` (`data/<step>/<n>.xml` for Collect's
 * format; its stored step; n from 1, in the plan's order), its XML exactly as stored, in
 * UTF-8 (the way Collect reads it), read `BACKUP_PAGE` records at a time. A record deleted since the
 * plan (`outcome.deleted`) or gone or without XML now (`outcome.missing`) is left out and its number
 * is not reused.
 */
export async function* backupEntries(
  store: Store,
  projectId: string,
  head: readonly ZipEntry[],
  plan: Pick<BackupPlan, 'records'>,
  outcome: BackupOutcome = { written: 0, missing: 0, deleted: 0 },
  format: BackupFormat = 'zip',
): AsyncGenerator<ZipEntry> {
  yield* head;
  // One copy per record in its own step's folder, as the zip has it: Collect's restore fills the steps before it
  // with that copy (RecordOperationGenerator.insertRecordDataUntilStep)
  const folder = format === 'collect' ? 'data/' : '';
  for (let start = 0; start < plan.records.length; start += BACKUP_PAGE) {
    const page = plan.records.slice(start, start + BACKUP_PAGE);
    const found = await store.getRecordXml(projectId, page);
    const byId = new Map(found.map((r) => [`${r.recordKey}\u0000${r.operator}`, r]));
    for (let i = 0; i < page.length; i++) {
      const r = page[i];
      const stored = byId.get(`${r.recordKey}\u0000${r.operator}`);
      if (stored?.deleted) {
        outcome.deleted += 1;
        continue;
      }
      const xml = stored?.xml;
      if (!stored || typeof xml !== 'string' || xml.length === 0) {
        outcome.missing += 1;
        continue;
      }
      outcome.written += 1;
      yield { name: `${folder}${stepOf(stored.step)}/${start + i + 1}.xml`, data: Buffer.from(xml, 'utf8') };
    }
  }
}

/** The backup's bytes, as a stream of buffers (zipStream over backupEntries). */
export function collectBackupZip(
  store: Store,
  projectId: string,
  head: readonly ZipEntry[],
  plan: Pick<BackupPlan, 'records'>,
  date: Date,
  outcome?: BackupOutcome,
  format?: BackupFormat,
): AsyncGenerator<Buffer> {
  return zipStream(backupEntries(store, projectId, head, plan, outcome, format), date);
}

/** The Collect that Collect Earth bundles, whose DataMarshaller wrote the records: Collect reads them as written by it. */
const COLLECT_VERSION = '4.0.110';

/** A value as Java's Properties.store writes it: Collect reads info.properties as ISO-8859-1, anything else as \uXXXX. */
const javaProperty = (s: string): string =>
  s
    .replace(/[\\:=#!]/g, '\\$&')
    .replace(/^ /, '\\ ')
    .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * What OpenForis Collect's own backup (SurveyBackupJob) holds before its records: `info.properties`
 * (SurveyBackupInfo: the survey's address and name, when, by which Collect; the time as Collect's
 * Dates.formatDateTime writes it), the survey as `idml.xml`, then the survey's files by type: each plot
 * file as a grid (`files/ce_grid/`, the dashboard's import makes the plot files from them) and the areas
 * per stratum (`files/ce_area/areas_per_attribute.csv`, Collect's fixed name for that type).
 */
export function collectHead(
  o: { survey: Uint8Array; uri: string; name: string; grids: readonly { filename: string; data: Uint8Array }[]; areas: Uint8Array | null },
  date: Date,
): ZipEntry[] {
  const info = [
    `survey_uri=${javaProperty(o.uri)}`,
    `survey_name=${javaProperty(o.name)}`,
    `timestamp=${javaProperty(date.toISOString().replace('Z', '+00:00'))}`,
    `collect_version=${COLLECT_VERSION}`,
    '',
  ].join('\n');
  return [
    { name: 'info.properties', data: Buffer.from(info, 'latin1') },
    { name: 'idml.xml', data: o.survey },
    // the import reads only files/ce_grid/*.csv
    ...o.grids.map((g) => ({ name: `files/ce_grid/${/\.csv$/i.test(g.filename) ? g.filename : `${g.filename}.csv`}`, data: g.data })),
    ...(o.areas ? [{ name: 'files/ce_area/areas_per_attribute.csv', data: o.areas }] : []),
  ];
}

/** Plain code-point order: stable across locales and servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
