import type { CountersSnapshot } from './serverCounters.js';
import type { DatabaseHealth, PlatformStats } from './types.js';
import type { ServerOverview } from './wire/serverAdmin.js';

export type { ServerOverview } from './wire/serverAdmin.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Days of records received shown, today included. */
export const RECEIVED_DAYS = 30;
/** ISO weeks of sign-ups shown, this one included. */
export const SIGNUP_WEEKS = 12;
/** Projects shown by size. */
export const LARGEST_PROJECTS = 10;
/** "Active": seen or sent records within this many days. */
export const ACTIVE_DAYS = 30;

/** Midnight UTC of the day of `ms`. */
export function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Monday 00:00 UTC of the ISO week of `ms`. */
export function isoWeekStart(ms: number): number {
  const day = utcDay(ms);
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday 0 .. Sunday 6
  return day - weekday * DAY_MS;
}

/** The ISO week of `ms` (UTC), e.g. "2026-W45". */
export function isoWeekLabel(ms: number): string {
  // The ISO year is the year of the week's Thursday.
  const thursday = new Date(isoWeekStart(ms) + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** What the store is asked for, from the time now. */
export function statsWindow(now: number): { activeSince: number; signupsFrom: number; receivedFrom: number } {
  return {
    activeSince: now - ACTIVE_DAYS * DAY_MS,
    signupsFrom: isoWeekStart(now) - (SIGNUP_WEEKS - 1) * WEEK_MS,
    receivedFrom: utcDay(now) - (RECEIVED_DAYS - 1) * DAY_MS,
  };
}

/** Puts the store's figures together for GET /v1/admin/overview. Totals and project ids only. */
export function buildOverview(input: {
  now: number;
  stats: PlatformStats;
  health: DatabaseHealth;
  backend: 'memory' | 'postgres';
  shippedMigrations: string[];
  version: string;
  startedAt: number;
  security: CountersSnapshot;
}): ServerOverview {
  const { now, stats, health } = input;
  const w = statsWindow(now);

  const weeks = new Map<number, number>();
  for (let i = 0; i < SIGNUP_WEEKS; i++) {
    weeks.set(w.signupsFrom + i * WEEK_MS, 0);
  }
  for (const d of stats.signupsByDay) {
    const start = isoWeekStart(d.day);
    if (weeks.has(start)) {
      weeks.set(start, weeks.get(start)! + d.count);
    }
  }

  const days = new Map<number, number>();
  for (let i = 0; i < RECEIVED_DAYS; i++) {
    days.set(w.receivedFrom + i * DAY_MS, 0);
  }
  for (const d of stats.receivedByDay) {
    const day = utcDay(d.day);
    if (days.has(day)) {
      days.set(day, days.get(day)! + d.count);
    }
  }
  const receivedByDay = [...days].map(([day, count]) => ({ day, count }));

  const bySize = [...stats.projects].sort((a, b) => b.storageBytes - a.storageBytes || (a.projectId < b.projectId ? -1 : 1));

  let migrations: ServerOverview['database']['migrations'] = null;
  if (health.migrations !== null) {
    const applied = new Set(health.migrations.map((m) => m.name));
    // When the newest migration first ran (the latest first_applied_at).
    const newest = health.migrations.reduce<number | null>((t, m) => (t === null || m.firstAppliedAt > t ? m.firstAppliedAt : t), null);
    migrations = {
      applied: health.migrations.length,
      shipped: input.shippedMigrations.length,
      latest: health.migrations.length > 0 ? health.migrations[health.migrations.length - 1].name : null,
      newestAppliedAt: newest,
      missing: input.shippedMigrations.filter((f) => !applied.has(f)),
    };
  }

  return {
    asOf: now,
    users: {
      total: stats.users,
      disabled: stats.disabledUsers,
      platformAdmins: stats.platformAdmins,
      active: stats.activeUsers,
      signupsByWeek: [...weeks].map(([start, count]) => ({ week: isoWeekLabel(start), start, count })),
    },
    projects: {
      total: stats.projects.length,
      active: stats.projects.filter((p) => p.active).length,
      storageBytes: stats.projects.reduce((n, p) => n + p.storageBytes, 0),
      largest: bySize.slice(0, LARGEST_PROJECTS).map((p) => ({ projectId: p.projectId, storageBytes: p.storageBytes })),
    },
    records: { received: receivedByDay.reduce((n, d) => n + d.count, 0), receivedByDay },
    database: { backend: input.backend, sizeBytes: health.sizeBytes, version: health.version, migrations },
    server: { version: input.version, startedAt: input.startedAt },
    security: input.security,
  };
}
