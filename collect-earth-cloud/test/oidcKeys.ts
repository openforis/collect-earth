// A test RSA key standing for Google's, and ID tokens signed with it (Task 19 review).
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { KeySource } from '../src/oidc.js';

export const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

/** A token as Google signs it (RS256). */
export function idToken(claims: Record<string, unknown>, options: { key?: KeyObject; kid?: string; alg?: string } = {}): string {
  const head = b64({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'k1', typ: 'JWT' });
  const body = b64(claims);
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(options.key ?? privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export const testKeys: KeySource = { get: async (kid) => (kid === 'k1' ? publicKey : null) };
