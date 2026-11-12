import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';

/**
 * Username / password rules for accounts made or changed from the dashboard
 * (setup, signup, password change, reset). /v1/auth/register, which Collect Earth uses too,
 * applies the password rule only: its usernames stay as the desktop client accepts them.
 */
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;
export const MIN_PASSWORD_LENGTH = 8;

/** Returns the `{error, reason}` body for a rule violation, or null if both are fine. */
export function checkCredentials(username: string | null, password: string, minPassword = MIN_PASSWORD_LENGTH): { error: string; reason: string } | null {
  if (username !== null && !isValidUsername(username)) {
    return {
      error: 'bad_username',
      reason: 'username must be 3-64 characters: letters, digits, dot, underscore, hyphen or @',
    };
  }
  return checkPassword(password, minPassword);
}

/** Whether a username follows the rules of accounts made from the dashboard. */
export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/** `min`: the server's minPasswordLength (never below MIN_PASSWORD_LENGTH). */
export function checkPassword(password: string, min = MIN_PASSWORD_LENGTH): { error: string; reason: string } | null {
  const least = Math.max(MIN_PASSWORD_LENGTH, min);
  if (password.length < least) {
    return { error: 'weak_password', reason: `password must be at least ${least} characters`, minLength: least } as { error: string; reason: string };
  }
  return null;
}

// Setup codes avoid look-alike characters (0/O, 1/I/L) so they can be read off a
// log line and typed by hand.
const SETUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A random setup code like `K7QX-M3TB-WN` (10 symbols, ~49 bits). */
export function generateSetupCode(): string {
  let raw = '';
  for (let i = 0; i < 10; i++) {
    raw += SETUP_ALPHABET[randomInt(SETUP_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Case-, space- and hyphen-insensitive, constant-time comparison of two setup codes. */
export function setupCodesMatch(provided: string, expected: string): boolean {
  return secretsEqual(normaliseCode(provided), normaliseCode(expected));
}

function normaliseCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

/** Constant-time string equality (hashing first so lengths never leak). */
export function secretsEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are UUIDs; checking first keeps a malformed path id a 404 instead of a Postgres cast error. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** The longest email address accepted (RFC 5321's path limit). */
export const MAX_EMAIL_LENGTH = 254;
/** One address: no spaces, commas, semicolons, quotes, brackets or backslashes, one @, a dot in the domain. */
const EMAIL_RE = /^[^\s@<>"(),;:\\[\]]+@[^\s@<>"(),;:\\[\]]+\.[^\s@<>"(),;:\\[\]]+$/;

/** Whether `value` is one email address (sign-up, the account page, and again before every mail). */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(value);
}

/**
 * The configured base URL for links (PUBLIC_BASE_URL, else Render's RENDER_EXTERNAL_URL), no
 * trailing slash; null when neither is set. The mails' links use only this (Task 19 review).
 */
export function configuredBaseUrl(config: Pick<Config, 'publicBaseUrl' | 'renderExternalUrl'>): string | null {
  const configured = config.publicBaseUrl ?? config.renderExternalUrl;
  return configured ? configured.replace(/\/+$/, '') : null;
}

/**
 * Base URL for links handed out on screen (join, reset): the configured one, else derived from
 * the request: its protocol (x-forwarded-proto from our own proxies, trustProxy) and its Host. The
 * Host is what Cloud Run (or a reverse proxy passing it on, as Caddy does) routed the request by.
 * X-Forwarded-Host is a header a client can write itself (Cloud Run passes it on as sent), so it
 * counts only with TRUST_FORWARDED_HOST, behind a proxy that sets it. No trailing slash.
 */
export function publicBaseUrl(config: Config, request: FastifyRequest): string {
  const configured = configuredBaseUrl(config);
  if (configured) {
    return configured;
  }
  const forwardedHost = config.trustForwardedHost ? firstHeader(request.headers['x-forwarded-host']) : undefined;
  const host = forwardedHost ?? request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

/** Most email domains sign-up can be limited to. */
export const MAX_SIGNUP_DOMAINS = 20;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * The email domains sign-up is limited to, as typed (commas, spaces or new lines between them, an "@" before one
 * allowed): stored lower case, comma-separated, null for none. Else what is wrong.
 */
export function parseSignupDomains(value: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === null) return { ok: true, value: null };
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : null;
  if (list === null || list.some((d) => typeof d !== 'string')) return { ok: false, reason: 'signupDomains must be a list of domains or null' };
  const domains = [...new Set((list as string[]).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter((d) => d !== ''))];
  if (domains.length === 0) return { ok: true, value: null };
  if (domains.length > MAX_SIGNUP_DOMAINS) return { ok: false, reason: `at most ${MAX_SIGNUP_DOMAINS} domains` };
  const bad = domains.find((d) => d.length > 253 || !DOMAIN_RE.test(d));
  if (bad) return { ok: false, reason: `"${bad}" is not a domain (example.org)` };
  return { ok: true, value: domains.join(',') };
}

/** Whether an address is of one of the domains (a stored signupDomains), its subdomains included; true for no domains. */
export function emailInDomains(email: string, domains: string | null): boolean {
  if (!domains) return true;
  const host = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return domains.split(',').some((d) => host === d || host.endsWith(`.${d}`));
}
