import { parsePlotFile, type PlotFile } from './plots.js';

/**
 * Caches of parsed plot files, shared by the routes (division, my-assignment and
 * content, export), keyed by the content's checksum and the key count
 * (fileKeyCount of the project's RoundInfo).
 */

/**
 * Memory a parsed file takes, as a multiple of its size: the content plus the rows,
 * their fields and offsets. Measured at about 9 to 11 for 13-22 MB files of 200k
 * plots (heap and external memory after a full GC); rounded up.
 */
export const PARSED_OVERHEAD = 12;

/**
 * Recently parsed files (least recently used out first), bounded by entries and by
 * their estimated memory (PARSED_OVERHEAD times the content's size). A file estimated
 * over half the bytes is parsed each time rather than pushing everything out.
 */
export class ParsedCache {
  private readonly entries = new Map<string, { parsed: PlotFile; bytes: number }>();
  private total = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  /** The estimated memory of what is cached now. */
  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The cached file, if any, without making it the most recently used. */
  peek(key: string): PlotFile | undefined {
    return this.entries.get(key)?.parsed;
  }

  get(key: string, data: Buffer, parse: () => PlotFile): PlotFile {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.parsed;
    }
    const parsed = parse();
    const bytes = data.length * PARSED_OVERHEAD;
    if (bytes > this.maxBytes / 2) {
      return parsed;
    }
    this.entries.set(key, { parsed, bytes });
    this.total += bytes;
    while (this.entries.size > this.maxEntries || this.total > this.maxBytes) {
      const [oldest, entry] = this.entries.entries().next().value as [string, { bytes: number }];
      this.entries.delete(oldest);
      this.total -= entry.bytes;
    }
    return parsed;
  }
}

// A few recently parsed files: my-assignment and the file page read the same file
// again and again, and a big one takes a moment to parse. At most 8, about 384 MB.
const parsedFiles = new ParsedCache(8, 384 * 1024 * 1024);

const cacheKey = (file: { checksum: string }, keyCount: number) => `${file.checksum}:${keyCount}`;

/** The parsed plot file of stored content (cached). */
export function plotFileOf(file: { checksum: string; data: Buffer }, keyCount: number): PlotFile {
  return parsedFiles.get(cacheKey(file, keyCount), file.data, () => parsePlotFile(file.data, keyCount));
}

// Only the plot ids of files (the export reads every file of a project): small, so
// more of them, and they never push the parsed files above out.
const PLOT_IDS_ENTRIES = 64;
const plotIdsCache = new Map<string, readonly string[]>();

/**
 * The plot ids of stored content. Taken from the parsed-file cache when the file is
 * there; otherwise parsed without being added to it, and only the ids are kept.
 */
export function plotIdsOf(file: { checksum: string; data: Buffer }, keyCount: number): readonly string[] {
  const key = cacheKey(file, keyCount);
  let ids = plotIdsCache.get(key);
  if (ids) {
    plotIdsCache.delete(key);
  } else {
    ids = parsedFiles.peek(key)?.plotIds ?? parsePlotFile(file.data, keyCount).plotIds;
  }
  plotIdsCache.set(key, ids);
  while (plotIdsCache.size > PLOT_IDS_ENTRIES) {
    plotIdsCache.delete(plotIdsCache.keys().next().value as string);
  }
  return ids;
}

/** How many files the parsed-file cache holds now (for tests). */
export function parsedFileCount(): number {
  return parsedFiles.size;
}
