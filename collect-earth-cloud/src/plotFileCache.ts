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
    private maxBytes: number,
  ) {}

  /** A new bound on the estimated memory (the server's PARSED_FILES_CACHE_MB); what is over it goes at once. */
  setMaxBytes(bytes: number): void {
    this.maxBytes = bytes;
    this.trim();
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries || this.total > this.maxBytes) {
      const [oldest, entry] = this.entries.entries().next().value as [string, { bytes: number }];
      this.entries.delete(oldest);
      this.total -= entry.bytes;
    }
  }

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
    this.trim();
    return parsed;
  }
}

/**
 * The parsed files' memory bound by default, in MB: room for a 512 MiB instance (Task 22 review,
 * B6; was 384). A file over half of it (about 4 MB of CSV at 96) is parsed each time: raise it
 * with the instance's memory (PARSED_FILES_CACHE_MB; DEPLOY.md, "Memory").
 */
export const DEFAULT_PARSED_CACHE_MB = 96;

// A few recently parsed files: my-assignment and the file page read the same file
// again and again, and a big one takes a moment to parse. At most 8.
const parsedFiles = new ParsedCache(8, DEFAULT_PARSED_CACHE_MB * 1024 * 1024);

/** Sets the parsed files' memory bound (the server's config, PARSED_FILES_CACHE_MB). */
export function setParsedCacheMb(mb: number): void {
  parsedFiles.setMaxBytes(mb * 1024 * 1024);
}

const cacheKey = (file: { checksum: string }, keyCount: number) => `${file.checksum}:${keyCount}`;

/** The parsed plot file of stored content (cached). */
export function plotFileOf(file: { checksum: string; data: Buffer }, keyCount: number): PlotFile {
  return parsedFiles.get(cacheKey(file, keyCount), file.data, () => parsePlotFile(file.data, keyCount));
}

/**
 * Recently used plot id lists (least recently used out first), bounded by entries and
 * by the number of ids they hold together. A list over half the ids is not kept.
 */
export class IdsCache {
  private readonly entries = new Map<string, readonly string[]>();
  private total = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxIds: number,
  ) {}

  /** How many ids are cached now. */
  get ids(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string, load: () => readonly string[]): readonly string[] {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const ids = load();
    if (ids.length > this.maxIds / 2) {
      return ids;
    }
    this.entries.set(key, ids);
    this.total += ids.length;
    while (this.entries.size > this.maxEntries || this.total > this.maxIds) {
      const [oldest, list] = this.entries.entries().next().value as [string, readonly string[]];
      this.entries.delete(oldest);
      this.total -= list.length;
    }
    return ids;
  }
}

// Only the plot ids of files (the export reads every file of a project): small, so
// more of them, and they never push the parsed files above out. At most 64 files and
// 2M ids (some 100-150 MB of short strings).
const plotIdsCache = new IdsCache(64, 2_000_000);

/**
 * The plot ids of stored content. Taken from the parsed-file cache when the file is
 * there; otherwise parsed without being added to it, and only the ids are kept.
 */
export function plotIdsOf(file: { checksum: string; data: Buffer }, keyCount: number): readonly string[] {
  const key = cacheKey(file, keyCount);
  return plotIdsCache.get(key, () => parsedFiles.peek(key)?.plotIds ?? parsePlotFile(file.data, keyCount).plotIds);
}

/** How many files the parsed-file cache holds now (for tests). */
export function parsedFileCount(): number {
  return parsedFiles.size;
}
