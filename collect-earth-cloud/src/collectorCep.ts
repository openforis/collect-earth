// The project file as a collector downloads it: with its plot files emptied (only their header
// line kept), so Collect Earth shows a collector no plot but those of the plot files assigned to
// them. Coordinators and reviewers download it whole.
import { createHash } from 'node:crypto';
import { CEP_PROPERTIES_PATH, CepError, DEFAULT_CEP_LIMITS, namedPlotPath, packEntry, writeZip, zipEntryList, type PackedZipEntry } from './cep.js';
import { parsePlotFile } from './plots.js';
import { toDosDateTime } from './zipStream.js';

/**
 * Which files of the project file are plot files: the one its properties name (`csv`, whatever its
 * extension), and every .csv or .ced file at the top of the zip or under grid/ (where Collect Earth
 * and the dashboard keep plot files). Other files (a .csv elsewhere, the survey, balloons, images)
 * are not.
 */
export function isPlotFilePath(path: string, named: string | null): boolean {
  if (path === named) return true;
  const lower = path.toLowerCase();
  if (!lower.endsWith('.csv') && !lower.endsWith('.ced')) return false;
  return !lower.includes('/') || lower.startsWith('grid/');
}

/** How much of a plot file is read to find its header line; a longer header makes it read the whole file. */
const HEADER_PREFIX_BYTES = 1 << 20;

/**
 * A plot file with only its header line (the BOM, the column names and the line ending as they
 * were), or nothing but the BOM when the file has no header (its first row is a plot).
 */
export function headerOnly(data: Buffer): Buffer {
  const prefix = data.length > HEADER_PREFIX_BYTES ? data.subarray(0, HEADER_PREFIX_BYTES) : data;
  let file = parsePlotFile(prefix);
  // The header may run past the prefix (it ended where the prefix did): read the whole file.
  if (prefix !== data && (!file.header || file.header.next >= prefix.length)) file = parsePlotFile(data);
  if (file.header) return Buffer.from(data.subarray(0, file.header.next));
  return file.bom ? Buffer.from(data.subarray(0, 3)) : Buffer.alloc(0);
}

/** A DOS date and time two seconds earlier (their resolution). */
function twoSecondsEarlier(dosTime: number, dosDate: number): { dosTime: number; dosDate: number } {
  const date = new Date(
    Date.UTC(
      ((dosDate >> 9) & 0x7f) + 1980,
      ((dosDate >> 5) & 0x0f) - 1,
      dosDate & 0x1f,
      (dosTime >> 11) & 0x1f,
      (dosTime >> 5) & 0x3f,
      (dosTime & 0x1f) * 2,
    ),
  );
  return Number.isNaN(date.getTime()) ? { dosTime, dosDate } : toDosDateTime(new Date(date.getTime() - 2000));
}

/**
 * The served project file with every plot file (isPlotFilePath) holding only its header line;
 * every other file is copied as it is packed, so its bytes and date stay the same. The emptied
 * files are dated two seconds before their original: Collect Earth caches a plot file by its path
 * and date, so on a computer that opened the whole file the emptied one is not taken for it (or
 * the reverse). Null when the project file has no plot file that holds more than its header.
 */
export function withPlotFilesEmptied(served: Buffer): Buffer | null {
  // The served file is one the server read within the upload's limits, or wrote itself.
  const list = zipEntryList(served, DEFAULT_CEP_LIMITS.maxEntries, DEFAULT_CEP_LIMITS.maxTotalBytes * 2);
  const properties = list.find((e) => e.name === CEP_PROPERTIES_PATH);
  const named = namedPlotPath(properties?.read());
  let changed = false;
  const packed: PackedZipEntry[] = list.map((e) => {
    if (!isPlotFilePath(e.name, named)) return e.packed;
    const data = Buffer.from(e.read());
    const header = headerOnly(data);
    if (header.length === data.length) return e.packed;
    changed = true;
    const { dosTime, dosDate } = twoSecondsEarlier(e.packed.dosTime, e.packed.dosDate);
    return { ...packEntry(e.name, header, dosTime, dosDate), nameBytes: e.packed.nameBytes, flags: e.packed.flags };
  });
  return changed ? writeZip(packed) : null;
}

/** Bounds of the cache of emptied project files. */
const MAX_CACHED = 16;
const MAX_CACHED_BYTES = 256 * 1024 * 1024;

/** Emptied project files by the served file's sha256 (null: nothing to empty), least recently used first. */
const cache = new Map<string, Buffer | null>();
let cachedBytes = 0;

/**
 * The project file a collector downloads (withPlotFilesEmptied), built once per served file and
 * kept by its checksum; the served file itself when it has no plots to remove, or when the
 * server's zip reader cannot open it (`onUnreadable` is told, once per file).
 */
export function cepForCollector(served: Buffer, onUnreadable?: (e: CepError) => void): Buffer {
  const key = createHash('sha256').update(served).digest('hex');
  let emptied = cache.get(key);
  if (emptied !== undefined) {
    cache.delete(key);
  } else {
    try {
      emptied = withPlotFilesEmptied(served);
    } catch (e) {
      // A file the server's reader cannot open (the server keeps such uploads as they came; a
      // damaged or ZIP64 zip, say) is served as it is: there is nothing in it the server can empty.
      if (!(e instanceof CepError) || e.code !== 'not_a_zip') throw e;
      onUnreadable?.(e);
      emptied = null;
    }
    cachedBytes += emptied?.length ?? 0;
  }
  cache.set(key, emptied);
  while (cache.size > MAX_CACHED || cachedBytes > MAX_CACHED_BYTES) {
    const [oldest, value] = cache.entries().next().value as [string, Buffer | null];
    cache.delete(oldest);
    cachedBytes -= value?.length ?? 0;
  }
  return emptied ?? served;
}
