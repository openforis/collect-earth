// Download links for the Collect Earth backup (Task 17): a coordinator asks for one with their
// session (POST …/exports/collect-backup/link) and the browser then downloads the file by itself
// (GET /v1/collect-backup/<token>), streaming it to disk with its own progress, with no session
// in the URL. The token is signed (HMAC-SHA256), lives 60 seconds, and is used once.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BackupRounds } from './collectBackup.js';

/** How long a link can be used. */
export const LINK_TTL_MS = 60_000;

export interface BackupLinkClaims {
  projectId: string;
  /** The coordinator who asked for it; null for a project admin token (no person). */
  userId: string | null;
  rounds: BackupRounds;
}

export interface BackupLink extends BackupLinkClaims {
  expiresAt: number;
  /** Tells links apart, so each is used once. */
  nonce: string;
}

/** A token `<payload>.<signature>`, both base64url, and when it stops working. */
export function writeBackupLink(claims: BackupLinkClaims, secret: Buffer, now: number): { token: string; expiresAt: number } {
  const expiresAt = now + LINK_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ p: claims.projectId, u: claims.userId, r: claims.rounds, e: expiresAt, n: randomBytes(12).toString('base64url') }),
  ).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

/** What a token says, 'expired' past its time, or null when it is no token of ours (or was changed). */
export function readBackupLink(token: string, secret: Buffer, now: number): BackupLink | 'expired' | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(payload, secret), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const v = raw as { p?: unknown; u?: unknown; r?: unknown; e?: unknown; n?: unknown };
  if (typeof v.p !== 'string' || (v.u !== null && typeof v.u !== 'string') || (v.r !== '1' && v.r !== 'all') || typeof v.e !== 'number' || typeof v.n !== 'string') {
    return null;
  }
  if (now >= v.e) return 'expired';
  return { projectId: v.p, userId: v.u as string | null, rounds: v.r, expiresAt: v.e, nonce: v.n };
}

function sign(payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(`collect-backup:${payload}`).digest('base64url');
}

/**
 * The key the links are signed with. Every instance of a server must have the same one, or a link
 * made on one is refused by another: LINK_SECRET when set; else one worked out from DATABASE_URL
 * (a secret all instances share); else (the memory store: one instance) a random one per process.
 */
export function linkSecret(config: { linkSecret?: string; databaseUrl?: string }): Buffer {
  if (config.linkSecret) return createHash('sha256').update(`collect-earth-cloud:links:${config.linkSecret}`).digest();
  if (config.databaseUrl) return createHash('sha256').update(`collect-earth-cloud:links:${config.databaseUrl}`).digest();
  return randomBytes(32);
}

/** The nonces of links already used, until they expire (per instance). */
export class UsedLinks {
  private readonly used = new Map<string, number>();

  /** True the first time a link is used; false after. */
  use(link: BackupLink, now: number): boolean {
    for (const [nonce, expiresAt] of this.used) {
      if (expiresAt <= now) this.used.delete(nonce);
    }
    if (this.used.has(link.nonce)) return false;
    this.used.set(link.nonce, link.expiresAt);
    return true;
  }
}
