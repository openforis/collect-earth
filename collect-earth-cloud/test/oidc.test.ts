import { describe, expect, it } from 'vitest';
import { GoogleKeys, verifyGoogleIdToken } from '../src/oidc.js';
import { idToken, otherKey, publicKey, testKeys as keys } from './oidcKeys.js';

const now = 1_800_000_000_000;
const settings = { audience: 'https://ce.example.org/v1/internal/digest', email: 'scheduler@p.iam.gserviceaccount.com' };
const good = {
  iss: 'https://accounts.google.com',
  aud: settings.audience,
  email: settings.email,
  email_verified: true,
  iat: now / 1000 - 10,
  exp: now / 1000 + 3000,
};

describe("Cloud Scheduler's OIDC token (Task 19 review)", () => {
  it('accepts a token Google signed for this audience and service account, nothing else', async () => {
    const check = (token: string) => verifyGoogleIdToken(token, { ...settings, keys, now });
    expect(await check(idToken(good))).toBe(true);
    expect(await check(idToken({ ...good, iss: 'accounts.google.com' }))).toBe(true);
    expect(await check(idToken({ ...good, aud: 'https://other.example.org/v1/internal/digest' }))).toBe(false);
    expect(await check(idToken({ ...good, email: 'someone@p.iam.gserviceaccount.com' }))).toBe(false);
    expect(await check(idToken({ ...good, email_verified: false }))).toBe(false);
    expect(await check(idToken({ ...good, iss: 'https://evil.example.org' }))).toBe(false);
    expect(await check(idToken({ ...good, exp: now / 1000 - 120 }))).toBe(false);
    expect(await check(idToken({ ...good, iat: now / 1000 + 3600 }))).toBe(false);
    expect(await check(idToken(good, { key: otherKey.privateKey }))).toBe(false);
    expect(await check(idToken(good, { kid: 'unknown' }))).toBe(false);
    expect(await check(idToken(good, { alg: 'none' }))).toBe(false);
    expect(await check(idToken(good, { alg: 'HS256' }))).toBe(false);
    expect(await check('not.a.token')).toBe(false);
    expect(await check('')).toBe(false);
  });

  it("Google's keys are read once and kept for their max-age", async () => {
    let calls = 0;
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
    let clock = now;
    const source = new GoogleKeys(async () => {
      calls += 1;
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=600' } });
    }, () => clock);
    expect(await source.get('k1')).not.toBeNull();
    expect(await source.get('k1')).not.toBeNull();
    expect(calls).toBe(1);
    // An unknown kid reads them again (Google rotates keys), at most once a minute.
    expect(await source.get('nope')).toBeNull();
    expect(calls).toBe(1);
    clock += 61_000;
    expect(await source.get('nope')).toBeNull();
    expect(calls).toBe(2);
    expect(await source.get('nope')).toBeNull();
    expect(calls).toBe(2);
    clock += 601_000;
    await source.get('k1');
    expect(calls).toBe(3);
  });
});
