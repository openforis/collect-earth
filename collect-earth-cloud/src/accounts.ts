// The accounts on the server page (GET /v1/admin/users, routes/admin.ts): searched, filtered, sorted and in pages, the
// same list as a CSV, and the accounts a server administrator makes. Pure: the route gives every account (listUsers).
import { isEmailAddress, isValidUsername } from './accountRules.js';
import type { UserSummary } from './types.js';

/** An account not active for this many days counts as inactive. */
export const INACTIVE_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;
export const ACCOUNT_FILTERS = ['all', 'admins', 'disabled', 'locked', 'twoFactor', 'noTwoFactor', 'inactive', 'noEmail'] as const;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];
export const ACCOUNT_SORTS = ['name', 'created', 'lastActive', 'projects'] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];
export const MAX_PAGE_SIZE = 200;
/** Most accounts made in one request. */
export const MAX_NEW_ACCOUNTS = 100;

export interface AccountQuery {
  /** Searched in the name and the address, any case */
  q: string;
  filter: AccountFilter;
  sort: AccountSort;
  desc: boolean;
  /** From 1 */
  page: number;
  pageSize: number;
}

const word = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const whole = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** The query string read, each part its default when missing or not one of its values. */
export function parseAccountQuery(query: unknown): AccountQuery {
  const q = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;
  return {
    q: typeof q.q === 'string' ? q.q.trim().slice(0, 200) : '',
    filter: word(q.filter, ACCOUNT_FILTERS, 'all'),
    sort: word(q.sort, ACCOUNT_SORTS, 'name'),
    desc: q.desc === 'true' || q.desc === '1',
    page: whole(q.page, 1, 1, 1_000_000),
    pageSize: whole(q.pageSize, 50, 1, MAX_PAGE_SIZE),
  };
}

/** Whether an account is of a filter; inactive: not signed in nor using a session for INACTIVE_DAYS (or never since kept). */
export function isOfFilter(u: UserSummary, filter: AccountFilter, now: number): boolean {
  switch (filter) {
    case 'admins':
      return u.isPlatformAdmin;
    case 'disabled':
      return u.disabledAt !== null;
    case 'locked':
      return u.lockedUntil !== null && u.lockedUntil > now;
    case 'twoFactor':
      return u.twoFactor;
    case 'noTwoFactor':
      return !u.twoFactor;
    case 'inactive':
      return (u.lastActiveAt ?? u.createdAt) < now - INACTIVE_DAYS * DAY_MS;
    case 'noEmail':
      return u.email === null || u.email === '';
    default:
      return true;
  }
}

const plain = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/** The accounts searched, filtered, sorted (then by name) and cut into the page asked; with each filter's count of the search. */
export function queryAccounts(users: readonly UserSummary[], query: AccountQuery, now: number) {
  const needle = query.q.toLowerCase();
  const searched = needle === '' ? [...users] : users.filter((u) => u.username.toLowerCase().includes(needle) || (u.email ?? '').toLowerCase().includes(needle));
  const counts = Object.fromEntries(ACCOUNT_FILTERS.map((f) => [f, searched.filter((u) => isOfFilter(u, f, now)).length])) as Record<AccountFilter, number>;
  const kept = searched.filter((u) => isOfFilter(u, query.filter, now));
  const key = (u: UserSummary): number =>
    query.sort === 'created' ? u.createdAt : query.sort === 'lastActive' ? (u.lastActiveAt ?? -1) : query.sort === 'projects' ? u.projects : 0;
  kept.sort((a, b) => (query.sort === 'name' ? 0 : (key(a) - key(b)) * (query.desc ? -1 : 1)) || plain(a.username, b.username) * (query.sort === 'name' && query.desc ? -1 : 1));
  const pages = Math.max(1, Math.ceil(kept.length / query.pageSize));
  const page = Math.min(query.page, pages);
  return { users: kept.slice((page - 1) * query.pageSize, page * query.pageSize), total: kept.length, page, pages, pageSize: query.pageSize, counts };
}

const csvField = (raw: string) => {
  const formula = /^[=+\-@\t\r]/.test(raw);
  const value = formula ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};
const iso = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());

/** The accounts as CSV (UTF-8 with a BOM, CRLF): no project names, as on the page. */
export function accountsCsv(users: readonly UserSummary[]): string {
  const header = ['username', 'email', 'email_confirmed', 'server_admin', 'two_step_sign_in', 'disabled_on', 'projects', 'coordinator_of', 'created_on', 'last_active_on'];
  const rows = users.map((u) => [
    u.username, u.email ?? '', String(u.emailConfirmed), String(u.isPlatformAdmin), String(u.twoFactor), iso(u.disabledAt),
    String(u.projects), String(u.coordinatedProjects), iso(u.createdAt), iso(u.lastActiveAt),
  ]);
  return `﻿${[header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** One account to make, as a server administrator lists it. */
export interface NewAccount {
  username: string;
  email: string | null;
}

/**
 * The accounts to make, checked: at most MAX_NEW_ACCOUNTS, each a valid username (not twice in the list) and an
 * optional email address. Else, what is wrong, with the line (from 1) of the first account at fault.
 */
export function parseNewAccounts(body: unknown): NewAccount[] | { reason: string; line: number | null } {
  const list = body && typeof body === 'object' ? (body as { accounts?: unknown }).accounts : undefined;
  if (!Array.isArray(list) || list.length === 0) return { reason: 'Give at least one account.', line: null };
  if (list.length > MAX_NEW_ACCOUNTS) return { reason: `At most ${MAX_NEW_ACCOUNTS} accounts at a time.`, line: null };
  const seen = new Set<string>();
  const out: NewAccount[] = [];
  for (const [i, item] of list.entries()) {
    const a = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const username = typeof a.username === 'string' ? a.username.trim() : '';
    if (!isValidUsername(username)) return { reason: `“${username}” is not a valid username.`, line: i + 1 };
    if (seen.has(username.toLowerCase())) return { reason: `${username} is in the list twice.`, line: i + 1 };
    seen.add(username.toLowerCase());
    const email = typeof a.email === 'string' && a.email.trim() !== '' ? a.email.trim() : null;
    if (email !== null && !isEmailAddress(email)) return { reason: `“${email}” is not an email address.`, line: i + 1 };
    out.push({ username, email });
  }
  return out;
}
