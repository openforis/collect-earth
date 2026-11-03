import { createHash } from 'node:crypto';
import { parsePlotFile } from './plots.js';

/** sha256 hex of file bytes; the client verifies downloads against this. */
export function checksumOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Plot count: the unique plot ids, read the way Collect Earth reads the file
 * (quoted polygon columns can span lines), with `keyCount` key columns. Falls back to
 * non-empty lines minus a header row for a file the parser cannot read.
 */
export function plotCountOf(data: Buffer, keyCount = 1): number {
  try {
    return parsePlotFile(data, keyCount).plotIds.length;
  } catch {
    const lines = data
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    return Math.max(0, lines.length - 1);
  }
}
