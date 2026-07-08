import { createHash } from 'node:crypto';

/** sha256 hex of file bytes; the client verifies downloads against this. */
export function checksumOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Best-effort plot count: non-empty lines minus one header row. Good enough for
 * dashboards; the authoritative parsing still happens client-side in Collect Earth.
 */
export function plotCountOf(data: Buffer): number {
  const lines = data
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}
