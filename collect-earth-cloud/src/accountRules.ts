import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';

/**
 * Username / password rules for accounts made or changed from the dashboard
 * (setup, signup, password change, reset). NOT applied to /v1/auth/register: the
 * desktop client uses it and must keep accepting what it accepts today.
 */
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;
export const MIN_PASSWORD_LENGTH = 8;

/** Returns the `{error, reason}` body for a rule violation, or null if both are fine. */
export function checkCredentials(username: string | null, password: string): { error: string; reason: string } | null {
  if (username !== null && !isValidUsername(username)) {
    return {
      error: 'bad_username',
      reason: 'username must be 3-64 characters: letters, digits, dot, underscore, hyphen or @',
    };
  }
  return checkPassword(password);
}

/** Whether a username follows the rules of accounts made from the dashboard. */
export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export function checkPassword(password: string): { error: string; reason: string } | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: 'weak_password', reason: `password must be at least ${MIN_PASSWORD_LENGTH} characters` };
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
