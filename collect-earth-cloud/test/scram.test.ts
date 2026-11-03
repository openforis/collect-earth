import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { scramSha256Verifier } from '../src/store/scram.js';

// RFC 7677, section 3: user "user", password "pencil", salt and nonces as below.
const SALT = 'W22ZaJ0SNY7soEsUEjb6gQ==';
const AUTH_MESSAGE = [
  'n=user,r=rOprNGfwEbeRWgbNEkqO',
  'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0',
].join(',');
const CLIENT_PROOF = 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=';
const SERVER_SIGNATURE = '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';

function parse(verifier: string) {
  const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  if (!m) throw new Error(`not a verifier: ${verifier}`);
  return { iterations: Number(m[1]), salt: m[2], storedKey: Buffer.from(m[3], 'base64'), serverKey: Buffer.from(m[4], 'base64') };
}

describe('scramSha256Verifier', () => {
  it('gives the keys of the RFC 7677 example: the server signature and the client proof check out', () => {
    const v = parse(scramSha256Verifier('pencil', Buffer.from(SALT, 'base64')));
    expect(v.iterations).toBe(4096);
    expect(v.salt).toBe(SALT);
    // The server proves it knows ServerKey...
    expect(createHmac('sha256', v.serverKey).update(AUTH_MESSAGE).digest('base64')).toBe(SERVER_SIGNATURE);
    // ...and checks the client's proof against StoredKey: H(proof XOR HMAC(StoredKey, AuthMessage)) = StoredKey.
    const signature = createHmac('sha256', v.storedKey).update(AUTH_MESSAGE).digest();
    const proof = Buffer.from(CLIENT_PROOF, 'base64');
    const clientKey = Buffer.from(proof.map((b, i) => b ^ signature[i]));
    expect(createHash('sha256').update(clientKey).digest().equals(v.storedKey)).toBe(true);
  });

  it('uses a new random 16-byte salt each time, and never holds the password', () => {
    const a = scramSha256Verifier('s3cr3t-Password');
    const b = scramSha256Verifier('s3cr3t-Password');
    expect(a).not.toBe(b);
    expect(Buffer.from(parse(a).salt, 'base64')).toHaveLength(16);
    expect(a).not.toContain('s3cr3t');
  });

  it('refuses a password that is not ASCII (Postgres would SASLprep it)', () => {
    expect(() => scramSha256Verifier('pässwörd')).toThrow(/ASCII/);
    expect(() => scramSha256Verifier('')).toThrow(/empty/);
  });
});
