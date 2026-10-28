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
  if (username !== null && !USERNAME_RE.test(username)) {
    return {
      error: 'bad_username',
      reason: 'username must be 3-64 characters: letters, digits, dot, underscore, hyphen or @',
    };
  }
  return checkPassword(password);
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

/**
 * Base URL for links handed out (join, reset): PUBLIC_BASE_URL, else Render's
 * RENDER_EXTERNAL_URL, else derived from the request (x-forwarded-proto/host are
 * honoured because the server runs with trustProxy). No trailing slash.
 */
export function publicBaseUrl(config: Config, request: FastifyRequest): string {
  const configured = config.publicBaseUrl ?? config.renderExternalUrl;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = forwardedHost ?? request.headers.host ?? 'localhost';
  return `${request.protocol}://${host}`;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}
