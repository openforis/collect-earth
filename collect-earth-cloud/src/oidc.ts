// Cloud Scheduler's OIDC token (Task 19 review): instead of a shared secret in a header, the weekly
// job may come with `Authorization: Bearer <ID token>` that Google signs for the scheduler's service
// account. The server accepts it only when it is signed by one of Google's keys (RS256), issued by
// accounts.google.com, for this endpoint's audience (DIGEST_OIDC_AUDIENCE), for this service account
// (DIGEST_OIDC_EMAIL, verified), and in its time. Google's public keys are read from their address
// and kept for the time Google says (Cache-Control max-age).
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

/** Where Google publishes the keys its ID tokens are signed with (JWKS). */
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** Clock difference tolerated between Google and this server. */
const SKEW_S = 60;
/** An unknown key id reads the keys again at most this often (Google rotates them). */
const REFRESH_MIN_MS = 60_000;

export interface KeySource {
  get(kid: string): Promise<KeyObject | null>;
}

/** Google's keys, read from GOOGLE_CERTS_URL and kept for their max-age (1 hour when none is given). */
export class GoogleKeys implements KeySource {
  private keys = new Map<string, KeyObject>();
  private until = 0;
  private lastRead = -Infinity;

  constructor(
    private readonly fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
    private readonly now: () => number = Date.now,
  ) {}

  async get(kid: string): Promise<KeyObject | null> {
    const at = this.now();
    const expired = at >= this.until;
    if (expired || (!this.keys.has(kid) && at - this.lastRead >= REFRESH_MIN_MS)) await this.read(at);
    return this.keys.get(kid) ?? null;
  }

  private async read(at: number): Promise<void> {
    this.lastRead = at;
    const res = await this.fetcher(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error(`Google's keys could not be read (HTTP ${res.status})`);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys ?? []) {
      if (typeof jwk.kid === 'string' && jwk.kty === 'RSA') keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
    this.keys = keys;
    this.until = at + (maxAge ? Number(maxAge) * 1000 : 3_600_000);
  }
}

function decode(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether `token` is a Google ID token for `audience` and the service account `email`. Never throws for a bad token. */
export async function verifyGoogleIdToken(token: string, options: { audience: string; email: string; keys: KeySource; now: number }): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => p === '' || !/^[A-Za-z0-9_-]+$/.test(p))) return false;
  const header = decode(parts[0]);
  const claims = decode(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
  const key = await options.keys.get(header.kid);
  if (!key) return false;
  const signed = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!signed) return false;
  const nowS = options.now / 1000;
  return (
    typeof claims.iss === 'string' &&
    ISSUERS.has(claims.iss) &&
    claims.aud === options.audience &&
    claims.email === options.email &&
    claims.email_verified === true &&
    typeof claims.exp === 'number' &&
    claims.exp + SKEW_S > nowS &&
    typeof claims.iat === 'number' &&
    claims.iat - SKEW_S <= nowS
  );
}
