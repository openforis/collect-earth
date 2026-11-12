// The server page's Projects and System sections (stage C): the projects directory searched, filtered, sorted and in
// pages; the Collect Earth versions the accounts use; the server activity log as CSV. Pure: the routes give the rows.
import { parseClientAgent } from './clientVersion.js';
import type { AdminProject, ClientUse, ServerActivityEntry } from './types.js';
import { PROJECT_STATUSES } from './types.js';

const DAY_MS = 24 * 3600 * 1000;
/** A coordinator not active for this many days does not count as active (as accounts: INACTIVE_DAYS). */
export const COORDINATOR_ACTIVE_DAYS = 90;
/** Collect Earth versions: the accounts that synced (or called the server) in this many days. */
export const VERSIONS_DAYS = 30;

// --- Projects directory ---

export const PROJECT_FILTERS = ['all', 'noCoordinator', ...PROJECT_STATUSES] as const;
export type ProjectFilter = (typeof PROJECT_FILTERS)[number];
export const PROJECT_SORTS = ['lastActivity', 'created', 'storage', 'people'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export interface ProjectQuery {
  /** Part of a project id, any case */
  q: string;
  filter: ProjectFilter;
  sort: ProjectSort;
  desc: boolean;
  page: number;
  pageSize: number;
}

const word = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const whole = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function parseProjectQuery(query: unknown): ProjectQuery {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  return {
    q: typeof q.q === 'string' ? q.q.trim().toLowerCase().slice(0, 64) : '',
    filter: word(q.filter, PROJECT_FILTERS, 'all'),
    sort: word(q.sort, PROJECT_SORTS, 'lastActivity'),
    // The most recent, the largest first, unless asked otherwise
    desc: q.desc === undefined ? true : q.desc === 'true' || q.desc === '1',
    page: whole(q.page, 1, 1, 1_000_000),
    pageSize: whole(q.pageSize, 50, 1, 200),
  };
}

/**
 * A project needing a coordinator: not archived (an archived project needs nobody), and no coordinator whose account is
 * enabled and active in COORDINATOR_ACTIVE_DAYS.
 */
export const needsCoordinator = (p: AdminProject) => p.status !== 'archived' && p.activeCoordinators === 0;

function isOf(p: AdminProject, filter: ProjectFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'noCoordinator') return needsCoordinator(p);
  return p.status === filter;
}

/** The projects searched, filtered, sorted (then by id) and in pages, with each filter's count of the search. */
export function queryProjects(projects: readonly AdminProject[], query: ProjectQuery) {
  const searched = query.q === '' ? [...projects] : projects.filter((p) => p.projectId.toLowerCase().includes(query.q));
  const counts = Object.fromEntries(PROJECT_FILTERS.map((f) => [f, searched.filter((p) => isOf(p, f)).length])) as Record<ProjectFilter, number>;
  const kept = searched.filter((p) => isOf(p, query.filter));
  const key = (p: AdminProject): number =>
    query.sort === 'created' ? p.createdAt : query.sort === 'storage' ? p.storageBytes : query.sort === 'people' ? p.people : (p.lastActivityAt ?? -1);
  kept.sort((a, b) => (key(a) - key(b)) * (query.desc ? -1 : 1) || (a.projectId < b.projectId ? -1 : 1));
  const pages = Math.max(1, Math.ceil(kept.length / query.pageSize));
  const page = Math.min(query.page, pages);
  const rows = kept.slice((page - 1) * query.pageSize, page * query.pageSize).map((p) => ({ ...p, needsCoordinator: needsCoordinator(p) }));
  return { projects: rows, total: kept.length, page, pages, pageSize: query.pageSize, counts };
}

// --- Collect Earth versions ---

/** A version's numbers ("1.23.20-SNAPSHOT" → [1, 23, 20]); null when it does not start with one. */
export function versionNumbers(version: string): number[] | null {
  const m = /^(\d+(?:\.\d+)*)/.exec(version);
  return m ? m[1].split('.').map(Number) : null;
}

/** Compares two versions by their numbers (missing parts are 0); a version without numbers comes first. */
export function compareVersions(a: string, b: string): number {
  const x = versionNumbers(a);
  const y = versionNumbers(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface VersionRow {
  /** The version; null for the old releases that sent none, or a Collect Earth that could not read its own. */
  version: string | null;
  /** 'old': a release before Collect Earth sent its version (CollectEarth-cloud-sync). */
  kind: 'version' | 'old' | 'unnamed';
  accounts: number;
  /** Older than the latest: those accounts should update. */
  outdated: boolean;
}

/**
 * The Collect Earth each account used last (its latest call in any project, within `since`), counted by version, newest
 * first. The latest is `configured` (COLLECT_EARTH_LATEST_VERSION) when set, else the newest one in use; a version
 * below it, and the old releases that sent none, are outdated.
 */
export function collectEarthVersions(uses: readonly ClientUse[], configured: string | null) {
  const last = new Map<string, ClientUse>();
  for (const u of uses) {
    const kept = last.get(u.userId);
    if (!kept || u.at > kept.at) last.set(u.userId, u);
  }
  const counts = new Map<string, { version: string | null; kind: VersionRow['kind']; accounts: number }>();
  for (const u of last.values()) {
    const parsed = parseClientAgent(u.agent);
    if (parsed.kind === 'unknown') continue;
    const row = parsed.kind === 'old-collect-earth'
      ? { key: 'old', version: null, kind: 'old' as const }
      : parsed.version === null || versionNumbers(parsed.version) === null
        ? { key: 'unnamed', version: null, kind: 'unnamed' as const }
        : { key: `v ${parsed.version}`, version: parsed.version, kind: 'version' as const };
    const c = counts.get(row.key) ?? { version: row.version, kind: row.kind, accounts: 0 };
    c.accounts += 1;
    counts.set(row.key, c);
  }
  const named = [...counts.values()].filter((c) => c.version !== null).map((c) => c.version!);
  const latest = configured ?? (named.length > 0 ? named.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a)) : null);
  const versions: VersionRow[] = [...counts.values()]
    .map((c) => ({
      ...c,
      outdated: c.kind === 'old' || (c.version !== null && latest !== null && compareVersions(c.version, latest) < 0),
    }))
    .sort((a, b) => (a.version === null ? 1 : 0) - (b.version === null ? 1 : 0) || (a.version && b.version ? compareVersions(b.version, a.version) : a.kind.localeCompare(b.kind)) || b.accounts - a.accounts);
  return {
    days: VERSIONS_DAYS,
    latest,
    latestConfigured: configured !== null,
    versions,
    accounts: last.size,
    outdatedAccounts: versions.filter((v) => v.outdated).reduce((n, v) => n + v.accounts, 0),
  };
}

export const versionsSince = (now: number) => now - VERSIONS_DAYS * DAY_MS;
export const coordinatorsActiveSince = (now: number) => now - COORDINATOR_ACTIVE_DAYS * DAY_MS;

// --- The server activity log as CSV ---

const csvField = (raw: string) => {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/** The log as CSV (UTF-8 with a BOM, CRLF), newest first: the details as `key=value` pairs. */
export function activityCsv(entries: readonly ServerActivityEntry[]): string {
  const header = ['at', 'by', 'action', 'account', 'project_id', 'details'];
  const rows = entries.map((e) => [
    new Date(e.at).toISOString(),
    e.actor ?? '',
    e.action,
    e.target ?? '',
    e.projectId ?? '',
    Object.entries(e.details).map(([k, v]) => `${k}=${String(v)}`).join('; '),
  ]);
  return `﻿${[header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}
