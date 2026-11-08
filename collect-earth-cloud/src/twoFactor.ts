// Two-step sign-in: a code from an authenticator app (Google Authenticator, Microsoft Authenticator, FreeOTP…) after
// the password. Standard time-based codes (RFC 6238: HMAC-SHA1, 30 s, 6 digits), so any such app works, with the
// device's clock allowed one step either way. Each step is used once (the store keeps the last), so a code seen over a
// shoulder cannot be played again. Ten recovery codes, single-use, for a lost phone; they are kept hashed. The secret
// is kept encrypted (AES-256-GCM) with a key from LINK_SECRET, or else from DATABASE_URL as the server's other links
// are: a copy of the database alone does not give anyone the codes.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_S = 30;
export const TOTP_DIGITS = 6;
export const RECOVERY_CODES = 10;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32 as the apps take it. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code of a time step (RFC 4226's HOTP over the step number). */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(n).padStart(TOTP_DIGITS, '0');
}

export const stepOf = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

/**
 * The step a code matches (now, or one step before or after, for a clock a little off), or null. The caller then
 * claims the step so it is not used twice.
 */
export function matchStep(secret: string, code: string, nowMs: number): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const now = stepOf(nowMs);
  for (const step of [now, now - 1, now + 1]) {
    const expected = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

/** The address an authenticator app reads from the QR code. */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_S) });
  return `otpauth://totp/${label}?${params}`;
}

// --- recovery codes ------------------------------------------------------------------------------------------------

/** Ten codes like "K7QD-2MXP-9TVA": 60 random bits each, in letters and digits that are not read for one another. */
export function newRecoveryCodes(): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: RECOVERY_CODES }, () => {
    const bytes = randomBytes(12);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

/** A recovery code as it is kept: hashed, its dashes, spaces and case left out (random enough not to need a slow hash). */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(`collect-earth-cloud:recovery:${code.toUpperCase().replace(/[\s-]/g, '')}`).digest('hex');
}

/** Whether what was typed looks like a recovery code rather than an app's code. */
export const looksLikeRecoveryCode = (code: string) => /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code.trim()) && !/^\d+$/.test(code.replace(/-/g, ''));

// --- the secret, encrypted -----------------------------------------------------------------------------------------

/** The key the secrets are encrypted with: from LINK_SECRET, or from DATABASE_URL (as the links' keys are). */
export function twoFactorKey(config: { linkSecret?: string; databaseUrl?: string }): Buffer {
  const base = config.linkSecret ?? config.databaseUrl ?? 'collect-earth-cloud:memory-store';
  return createHash('sha256').update(`collect-earth-cloud:two-factor:${base}`).digest();
}

export function encryptSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** The secret, or null when it cannot be read (the key changed: LINK_SECRET or the database address). */
export function decryptSecret(stored: string, key: Buffer): string | null {
  const [v, iv, tag, data] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
