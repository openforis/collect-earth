import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generates a URL-safe opaque token (the plaintext handed to a client once). */
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/** A progress link's token (Task 18): 32 random bytes, 43 URL-safe characters; it lives for months. */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Whether a string can be a progress link's token (anything else is not looked up). */
export function isShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Deterministic hash stored at rest; the plaintext token is never persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * A sign-in (session token) unused for this long stops working (recommendation 1 of the data review): a forgotten
 * laptop, or a token copied from one, loses access by itself. Each use keeps it alive, so someone who syncs or opens
 * the dashboard now and then never notices. SESSION_IDLE_DAYS changes it (default 90).
 */
export const SESSION_IDLE_MS = sessionIdleDays(process.env.SESSION_IDLE_DAYS) * 24 * 3_600_000;
/** How often a session's last use is written down: not at every request. */
export const SESSION_TOUCH_MS = 3_600_000;

export function sessionIdleDays(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 90;
}

/** Constant-time comparison of two hex hashes of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Extracts the bearer token from an Authorization header, or null if absent/malformed. */
export function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : null;
}
