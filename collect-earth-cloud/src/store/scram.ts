import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** Postgres's own iteration count for SCRAM-SHA-256 (scram_iterations' default). */
export const SCRAM_ITERATIONS = 4096;

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802 / 7677), in the
 * form `CREATE ROLE ... PASSWORD` takes as it is:
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, all base64.
 *
 * So the plaintext password never reaches Postgres, nor its log when a statement fails.
 * A login with the password works as with `PASSWORD 'plaintext'` (Postgres would hash
 * it the same way). Only ASCII passwords: for other ones Postgres first applies SASLprep
 * (RFC 4013), which this does not do, so it refuses them instead of storing a verifier
 * that might not match.
 */
export function scramSha256Verifier(password: string, salt: Buffer = randomBytes(16), iterations = SCRAM_ITERATIONS): string {
  if (password === '') {
    throw new Error('The database password is empty');
  }
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7F]*$/.test(password)) {
    throw new Error('The database password must be ASCII (letters, digits and ASCII punctuation)');
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
