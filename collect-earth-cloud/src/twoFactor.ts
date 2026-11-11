// Two-step sign-in: a code from an authenticator app (Google Authenticator, Microsoft Authenticator, FreeOTP…) after
// the password. Standard time-based codes (RFC 6238: HMAC-SHA1, 30 s, 6 digits), so any such app works, with the
// device's clock allowed one step either way. Each step is used once (the store keeps the last), so a code seen over a
// shoulder cannot be played again. Ten recovery codes, single-use, for a lost phone; they are kept hashed. The secret
// is kept encrypted (AES-256-GCM) with a key of its own, TWO_FACTOR_KEY, which nothing else changes: a copy of the
// database alone does not give anyone the codes, and no change of mail or database locks anyone out (see twoFactorKey).
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

/** A key of the secrets, named by `id`, which is written next to each secret it encrypts and tells nothing of it. */
export interface NamedKey { id: string; key: Buffer }

/** The key new secrets are encrypted with, and the older ones the secrets saved before are still read with. */
export interface TwoFactorKeys { current: NamedKey; older: NamedKey[] }

const named = (base: string): NamedKey => {
  const key = createHash('sha256').update(`collect-earth-cloud:two-factor:${base}`).digest();
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 12), key };
};

/**
 * The keys of the secrets. TWO_FACTOR_KEY, which only this uses, is the key: set once (deploy.sh keeps it in Secret
 * Manager, pinned to its first version) and never changed. A change of mail (LINK_SECRET) or of the database address
 * does not touch it. The keys used before it (from LINK_SECRET, else DATABASE_URL, else the memory store's) are kept as
 * older ones: the secrets saved under them are still read, and saved again under the key at the person's next sign-in
 * (checkSecondStep). Without TWO_FACTOR_KEY, the first of those is the key, as it was.
 */
export function twoFactorKey(config: { twoFactorKey?: string; linkSecret?: string; databaseUrl?: string }): TwoFactorKeys {
  const before = [config.linkSecret, config.databaseUrl].filter((b): b is string => !!b);
  const keys = [config.twoFactorKey, ...(before.length > 0 ? before : ['collect-earth-cloud:memory-store'])]
    .filter((b): b is string => !!b)
    .map(named)
    .filter((k, i, all) => all.findIndex((o) => o.id === k.id) === i);
  return { current: keys[0], older: keys.slice(1) };
}

/** Encrypted with the current key, whose id goes with it: "v2.<key id>.<iv>.<tag>.<data>". */
export function encryptSecret(secret: string, keys: TwoFactorKeys): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys.current.key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v2', keys.current.id, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

function decryptWith(key: Buffer, iv: string, tag: string, data: string): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * The secret, and whether it should be saved again (`stale`: under an older key, or in the format before the keys were
 * named). A "v2" secret is read with the key it names; a "v1" one, saved before, with each key in turn. Null when no key
 * of this server reads it: its key was lost (`missingKey` then says which, for the log and the owner's alert).
 */
export function readSecret(stored: string, keys: TwoFactorKeys): { secret: string; stale: boolean } | { secret: null; missingKey: string } {
  const all = [keys.current, ...keys.older];
  const parts = stored.split('.');
  if (parts[0] === 'v2' && parts.length === 5) {
    const [, id, iv, tag, data] = parts;
    const key = all.find((k) => k.id === id);
    const secret = key ? decryptWith(key.key, iv, tag, data) : null;
    return secret === null ? { secret: null, missingKey: id } : { secret, stale: key !== keys.current };
  }
  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, tag, data] = parts;
    for (const k of all) {
      const secret = decryptWith(k.key, iv, tag, data);
      if (secret !== null) return { secret, stale: true };
    }
  }
  return { secret: null, missingKey: 'unknown (saved before the keys were named)' };
}

/** The secret, or null when no key of this server reads it (see readSecret). */
export function decryptSecret(stored: string, keys: TwoFactorKeys): string | null {
  return readSecret(stored, keys).secret;
}
