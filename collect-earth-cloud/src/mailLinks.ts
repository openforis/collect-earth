// The links the mails carry (Task 19): one-click unsubscribing from a digest and confirming an email
// address. Both are signed (HMAC-SHA256) with mailSecret (LINK_SECRET only: never a key worked out
// from DATABASE_URL), each with its own purpose in the signature, so
// a token of one kind is never taken for another.
// - Unsubscribe: tied to the account and the kind of digest; it does not expire (a mail read months
//   later still works) and needs no login. Using it turns that digest off, nothing else. The account's
//   id is in it encrypted (AES-256-GCM, a key of its own from mailSecret), so a forwarded mail or a
//   mail program's log does not show it (Task 22 review, M-4); tokens of the first version, with the
//   id readable, still work.
// - Confirm: tied to the account and the address (its sha256), valid CONFIRM_TTL_MS; an address
//   changed since makes it do nothing.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DIGEST_KINDS, type DigestKind } from './types.js';

/**
 * The key the mails' links are signed with: LINK_SECRET only (required with SMTP_URL), never one worked
 * out from DATABASE_URL, which changes with the database password and would break links already sent.
 * Without it (no SMTP: nothing reaches anyone) a random key per process.
 */
export function mailSecret(config: { linkSecret?: string; databaseUrl?: string }): Buffer {
  if (config.linkSecret) return createHash('sha256').update(`collect-earth-cloud:mail:${config.linkSecret}`).digest();
  return randomBytes(32);
}

/** How long an email confirmation link works. */
export const CONFIRM_TTL_MS = 3 * 86_400_000;

function sign(purpose: string, payload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(`${purpose}:${payload}`).digest('base64url');
}

function write(purpose: string, claims: unknown, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(purpose, payload, secret)}`;
}

function read(purpose: string, token: unknown, secret: Buffer): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 1000) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(purpose, payload, secret), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The key that hides the account's id in an unsubscribe token: its own, from the mails' key. */
const hidingKey = (secret: Buffer) => createHmac('sha256', secret).update('digest-unsubscribe:hide').digest();

/** The account's id encrypted (AES-256-GCM: a random 12-byte nonce, the text, the 16-byte tag), base64url. */
function hide(userId: string, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', hidingKey(secret), iv);
  const text = Buffer.concat([cipher.update(userId, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, text, cipher.getAuthTag()]).toString('base64url');
}

function unhide(hidden: string, secret: Buffer): string | null {
  const bytes = Buffer.from(hidden, 'base64url');
  if (bytes.length < 12 + 16 + 1) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', hidingKey(secret), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    return Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function writeUnsubscribeToken(userId: string, kind: DigestKind, secret: Buffer): string {
  return write('digest-unsubscribe', { h: hide(userId, secret), k: kind }, secret);
}

/** The account and kind of an unsubscribe token (the id hidden, or readable in a first-version token), or null when it is none of ours. */
export function readUnsubscribeToken(token: unknown, secret: Buffer): { userId: string; kind: DigestKind } | null {
  const v = read('digest-unsubscribe', token, secret);
  if (!v || !(DIGEST_KINDS as readonly unknown[]).includes(v.k)) return null;
  const userId = typeof v.h === 'string' ? unhide(v.h, secret) : typeof v.u === 'string' ? v.u : null;
  return userId === null ? null : { userId, kind: v.k as DigestKind };
}

const addressHash = (email: string) => createHash('sha256').update(email).digest('base64url').slice(0, 22);

export function writeConfirmToken(userId: string, email: string, secret: Buffer, now: number): string {
  return write('email-confirm', { u: userId, a: addressHash(email), e: now + CONFIRM_TTL_MS }, secret);
}

/** The account of a confirmation token, 'expired' past its time, or null when it is none of ours; `matches` tells an address apart. */
export function readConfirmToken(token: unknown, secret: Buffer, now: number): { userId: string; matches: (email: string) => boolean } | 'expired' | null {
  const v = read('email-confirm', token, secret);
  if (!v || typeof v.u !== 'string' || typeof v.a !== 'string' || typeof v.e !== 'number') return null;
  if (now >= v.e) return 'expired';
  const a = v.a;
  return { userId: v.u, matches: (email) => addressHash(email) === a };
}
