import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generates a URL-safe opaque token (the plaintext handed to a client once). */
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Deterministic hash stored at rest; the plaintext token is never persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
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
