// The Collect Earth backup (Task 17): the project's records as a zip that Collect Earth imports
// with "Data Import/Export > Import new data from ZIP (compressed XML)". The layout is the one
// Collect's XMLDataImportProcess reads and Collect Earth's own export writes (see the plan's
// spike): `idml.xml` (the survey), then one `<step>/<n>.xml` per record, nothing else.
import type { RecordRound } from './rounds.js';
import type { Store } from './store/store.js';
import type { RecordState } from './types.js';
import { zipStream, type ZipEntry } from './zipStream.js';

/** Which records: the first assessments only (round 1), or every round. */
export type BackupRounds = '1' | 'all';
export const BACKUP_ROUNDS: readonly BackupRounds[] = ['1', 'all'];

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
  /** Of them, records of reference plots (Task 14): their round 2 is measurement, kept as stored. */
  reference: number;
  /** Records not in the backup: of another round (checks, with rounds '1'). */
  otherRounds: number;
  /**
   * Records not in the backup because another record has the same key (Collect Earth keeps one
   * record per key: two first assessments of a plot, the collectors' measurements of a reference
   * plot). `sameKeyReference` counts those of reference plots among them.
   */
  sameKey: number;
  sameKeyReference: number;
  /** Up to 20 keys that had more than one record. */
  sameKeyExamples: string[];
}

export interface PlanInput {
  /** The project's records, deleted ones left out (Store.listRecordStates). */
  records: readonly RecordState[];
  /** The round of a record (recordResolver(…).round). */
  roundOf: (r: { recordKey: string; operator: string }) => RecordRound;
  /** Whether a record is of a reference plot. */
  isReference: (r: { recordKey: string; operator: string }) => boolean;
}

const MAX_EXAMPLES = 20;

/**
 * Which records go into the backup. With rounds '1', the first assessments (assessment
 * `main`); with 'all', every record. Collect Earth's import compares no two records of one zip
 * (the second of two with one key overwrites the first, or makes a duplicate that breaks later
 * lookups), so each key keeps one record: a submitted one before a draft, then the latest
 * (`modifiedOn`), then the first username in code-point order. Whether 'all' is allowed (the
 * survey must have the round key) is the caller's to check.
 */
export function planBackup(input: PlanInput, rounds: BackupRounds): BackupPlan {
  const byKey = new Map<string, RecordState[]>();
  let otherRounds = 0;
  for (const r of input.records) {
    if (r.deleted) continue;
    if (rounds === '1' && input.roundOf(r).assessment !== 'main') {
      otherRounds += 1;
      continue;
    }
    const list = byKey.get(r.recordKey);
    if (list) list.push(r);
    else byKey.set(r.recordKey, [r]);
  }
  const keys = [...byKey.keys()].sort(compare);
  const records: BackupRecord[] = [];
  let drafts = 0;
  let reference = 0;
  let sameKey = 0;
  let sameKeyReference = 0;
  const sameKeyExamples: string[] = [];
  for (const key of keys) {
    const list = byKey.get(key)!;
    const kept = list.reduce((best, r) => (better(r, best) ? r : best));
    records.push({ recordKey: kept.recordKey, operator: kept.operator });
    if (!kept.activelySaved) drafts += 1;
    if (input.isReference(kept)) reference += 1;
    if (list.length > 1) {
      sameKey += list.length - 1;
      if (input.isReference(kept)) sameKeyReference += list.length - 1;
      if (sameKeyExamples.length < MAX_EXAMPLES) sameKeyExamples.push(key);
    }
  }
  return { rounds, records, drafts, reference, otherRounds, sameKey, sameKeyReference, sameKeyExamples };
}

/** Whether `a` is kept before `b` for one key. */
function better(a: RecordState, b: RecordState): boolean {
  if (a.activelySaved !== b.activelySaved) return a.activelySaved;
  if (a.modifiedOn !== b.modifiedOn) return a.modifiedOn > b.modifiedOn;
  return compare(a.operator, b.operator) < 0;
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
  /** Records of the plan whose XML was gone (deleted or changed to none since the plan). */
  missing: number;
}

/**
 * The entries of the backup: the survey as `idml.xml`, then each record of the plan as
 * `<step>/<n>.xml` (its stored step; n from 1, in the plan's order), its XML exactly as stored, in UTF-8 (the way
 * Collect reads it), read `BACKUP_PAGE` records at a time. A record whose XML is gone is left
 * out (`outcome.missing`) and its number is not reused.
 */
export async function* backupEntries(
  store: Store,
  projectId: string,
  survey: Uint8Array,
  plan: BackupPlan,
  outcome: BackupOutcome = { written: 0, missing: 0 },
): AsyncGenerator<ZipEntry> {
  yield { name: 'idml.xml', data: survey };
  for (let start = 0; start < plan.records.length; start += BACKUP_PAGE) {
    const page = plan.records.slice(start, start + BACKUP_PAGE);
    const found = await store.getRecordXml(projectId, page);
    const byId = new Map(found.map((r) => [`${r.recordKey}\u0000${r.operator}`, r]));
    for (let i = 0; i < page.length; i++) {
      const r = page[i];
      const stored = byId.get(`${r.recordKey}\u0000${r.operator}`);
      const xml = stored?.xml;
      if (!stored || typeof xml !== 'string' || xml.length === 0) {
        outcome.missing += 1;
        continue;
      }
      outcome.written += 1;
      yield { name: `${stepOf(stored.step)}/${start + i + 1}.xml`, data: Buffer.from(xml, 'utf8') };
    }
  }
}

/** The backup's bytes, as a stream of buffers (zipStream over backupEntries). */
export function collectBackupZip(
  store: Store,
  projectId: string,
  survey: Uint8Array,
  plan: BackupPlan,
  date: Date,
  outcome?: BackupOutcome,
): AsyncGenerator<Buffer> {
  return zipStream(backupEntries(store, projectId, survey, plan, outcome), date);
}

/** Plain code-point order: stable across locales and servers. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
