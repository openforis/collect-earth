import { createHash } from 'node:crypto';
import type { AttentionItem } from './progress.js';
import { isStoredTime } from './store/store.js';
import { AUDIT_ACTIONS, type AuditAction, type AuditEntry, type EventCursor, type RecordChange, type RecordEvent } from './types.js';

/**
 * The activity log (Task 10, monitoring Phase 6): the coordinators' actions (audit_log) and what
 * Collect Earth stored (record_events) in one list, newest first, paged by a cursor that holds
 * where each of the two lists is, so that rows at the same time are neither lost nor repeated.
 * Pure: the route reads the two lists through the store.
 */

/** Rows a page gives by default, and at most. */
export const LOG_PAGE_SIZE = 50;
export const MAX_LOG_PAGE_SIZE = 200;

/** The record changes a "kind" of the log stands for. "draft" is a save not submitted (first or again). */
const RECORD_KINDS: Record<string, readonly RecordChange[]> = {
  submitted: ['submitted'],
  resubmitted: ['resubmitted'],
  draft: ['created', 'updated'],
  unsubmitted: ['unsubmitted'],
  deleted: ['deleted'],
};

/** The coordinators' actions a "kind" of the log stands for. */
const AUDIT_KINDS: Record<string, readonly AuditAction[]> = {
  decisions: ['decision.set', 'decision.deleted', 'decision.bulk'],
  people: ['invite.created', 'invite.revoked', 'member.removed', 'member.anonymized', 'member.signed_out', 'member.role', 'member.excluded'],
  files: ['cep.replaced', 'survey.replaced', 'csv.uploaded', 'assignments.set', 'division.applied', 'plots.moved', 'sampling.drawn', 'reference.changed', 'training.changed', 'training.synced'],
  settings: ['settings.changed', 'link.created', 'link.revoked'],
  downloads: ['export.downloaded'],
};

/** Every kind the log can be filtered by: all, Collect Earth's saves, the coordinators' actions, or one group of them. */
export const LOG_KINDS = ['all', 'records', ...Object.keys(RECORD_KINDS), 'coordinators', ...Object.keys(AUDIT_KINDS)] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export function isLogKind(kind: unknown): kind is LogKind {
  return typeof kind === 'string' && (LOG_KINDS as readonly string[]).includes(kind);
}

/** Which rows of each list a kind takes: undefined = all of them, false = none. */
export interface KindFilter {
  changes: readonly RecordChange[] | undefined | false;
  actions: readonly AuditAction[] | undefined | false;
}

export function kindFilter(kind: LogKind): KindFilter {
  if (kind === 'all') return { changes: undefined, actions: undefined };
  if (kind === 'records') return { changes: undefined, actions: false };
  if (kind === 'coordinators') return { changes: false, actions: undefined };
  if (kind in RECORD_KINDS) return { changes: RECORD_KINDS[kind], actions: false };
  return { changes: false, actions: AUDIT_KINDS[kind] };
}

/** Where one list is: not started (its newest row comes next), after a row, or read to its end. */
export type ListPosition = 'start' | 'end' | EventCursor;

export interface LogCursor {
  events: ListPosition;
  audit: ListPosition;
}

export const LOG_START: LogCursor = { events: 'start', audit: 'start' };

/** The largest id a cursor holds (18 digits): "after every row at this time". */
const MAX_ID = '999999999999999999';

const part = (p: ListPosition) => (p === 'start' ? 's' : p === 'end' ? 'e' : `${p.at}.${p.id}`);

/** "s_1793600000000.42": the events' position, then the audit log's. */
export function encodeLogCursor(c: LogCursor): string {
  return `${part(c.events)}_${part(c.audit)}`;
}

/** The cursor of a page, or null when the text is not one. */
export function decodeLogCursor(text: unknown): LogCursor | null {
  if (typeof text !== 'string' || text.length > 80) return null;
  const parts = text.split('_');
  if (parts.length !== 2) return null;
  const read = (p: string): ListPosition | null => {
    if (p === 's') return 'start';
    if (p === 'e') return 'end';
    const m = /^(-?\d{1,16})\.(\d{1,18})$/.exec(p);
    return m && isStoredTime(Number(m[1])) ? { at: Number(m[1]), id: m[2] } : null;
  };
  const events = read(parts[0]);
  const audit = read(parts[1]);
  return events && audit ? { events, audit } : null;
}

/** One row of the log, before names are put to it. */
export type LogRow = { source: 'event'; at: number; event: RecordEvent } | { source: 'audit'; at: number; entry: AuditEntry };

/** How a page is read: each list after its position, newest first, at most `limit` rows. */
export interface LogSources {
  events(before: EventCursor | undefined, limit: number): Promise<RecordEvent[]>;
  audit(before: EventCursor | undefined, limit: number): Promise<AuditEntry[]>;
}

/**
 * One page of the merged log: up to `limit` rows from both lists, newest first (at the same
 * time, coordinators' actions first, then by id, newest first), and the cursor of the next page
 * (null when both lists are read to their end). Each list is read from its own position, so its
 * rows are never lost nor repeated whatever the other list holds at the same time.
 */
export async function logPage(sources: LogSources, cursor: LogCursor, limit: number, use: { events: boolean; audit: boolean }): Promise<{ rows: LogRow[]; next: LogCursor | null }> {
  const pos = (p: ListPosition) => (p === 'start' ? undefined : p === 'end' ? null : p);
  const evPos = use.events ? pos(cursor.events) : null;
  const auPos = use.audit ? pos(cursor.audit) : null;
  const [events, audit] = await Promise.all([
    evPos === null ? Promise.resolve([] as RecordEvent[]) : sources.events(evPos, limit),
    auPos === null ? Promise.resolve([] as AuditEntry[]) : sources.audit(auPos, limit),
  ]);
  const rows: LogRow[] = [];
  let i = 0;
  let j = 0;
  while (rows.length < limit && (i < events.length || j < audit.length)) {
    const e = events[i];
    const a = audit[j];
    // The newer first; at the same time the coordinator's action (then each list's own order).
    const takeAudit = a !== undefined && (e === undefined || a.at >= e.modifiedOn);
    if (takeAudit) {
      rows.push({ source: 'audit', at: a.at, entry: a });
      j += 1;
    } else {
      rows.push({ source: 'event', at: e.modifiedOn, event: e });
      i += 1;
    }
  }
  // A list read to its end: it gave fewer rows than asked for and all of them were taken.
  const nextPos = <T extends { id: string }>(list: T[], taken: number, at: (x: T) => number, was: EventCursor | undefined | null): ListPosition => {
    if (was === null) return 'end';
    if (taken === list.length && list.length < limit) return 'end';
    if (taken === 0) {
      // None of its rows shown: it resumes below what was shown (not from its top, where a row
      // may have arrived meanwhile), or where it was when that is further down.
      if (rows.length === 0) return was ?? 'start';
      const below: EventCursor = { at: rows[rows.length - 1].at, id: MAX_ID };
      if (was === undefined) return below;
      return was.at < below.at || (was.at === below.at && BigInt(was.id) < BigInt(below.id)) ? was : below;
    }
    const last = list[taken - 1];
    return { at: at(last), id: last.id };
  };
  const next: LogCursor = {
    events: nextPos(events, i, (x) => x.modifiedOn, evPos),
    audit: nextPos(audit, j, (x) => x.at, auPos),
  };
  return { rows, next: next.events === 'end' && next.audit === 'end' ? null : next };
}

/** Detail keys of audit entries that hold a person's user id, and a plot file's id. */
export const PERSON_DETAILS = ['userId', 'fromUserId', 'toUserId', 'forUserId'] as const;
export const FILE_DETAILS = ['csvFileId'] as const;

/** The user ids and plot file ids an audit entry names (its actor apart). */
export function idsOfEntry(entry: AuditEntry): { people: string[]; files: string[] } {
  const d = entry.details ?? {};
  const people = PERSON_DETAILS.map((k) => d[k]).filter((v): v is string => typeof v === 'string');
  const files = FILE_DETAILS.map((k) => d[k]).filter((v): v is string => typeof v === 'string');
  return { people, files };
}

export { AUDIT_ACTIONS };

/**
 * The bell's key for a "needs attention" item: its kind and a hash of what it says (how many,
 * who, the level), so an item read stays read until what it says changes. Times (a last sync)
 * and byte counts are left out: they change on their own without the item saying anything new.
 */
export function attentionKey(item: AttentionItem): string {
  const people = 'people' in item ? item.people.map((p) => p.username).sort() : [];
  const content = {
    count: item.count,
    people,
    level: item.kind === 'storage' ? item.level : null,
    quietDays: item.kind === 'quiet' ? item.quietDays : null,
    unknownVersion: item.kind === 'oldCollectEarth' ? item.unknownVersion : null,
    // A new attempt finished, or a pass, is a new card.
    finished: item.kind === 'trainingFinished' ? item.people.map((p) => `${p.username}|${p.set}|${p.passed}`).sort() : null,
  };
  return `${item.kind}:${createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16)}`;
}
