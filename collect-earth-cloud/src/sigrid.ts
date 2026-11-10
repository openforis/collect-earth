// SIGRID (github.com/herrtunante/SIGRID): a global systematic grid of plots 1 km apart, with coarser
// grids nested in it (a plot of the 10 km grid is in the 1 km one, with the same CE_ID). Its country
// packages are zips at openforis.org, one CSV per spacing and a CSV of the plots per district. A
// package can be 130 MB: only the one entry needed is read, as it downloads (an HTTP range from the
// entry when the host serves ranges, else the zip from its start), and the download stops there.
import { Unzip, UnzipInflate } from 'fflate';
import { SIGRID_COUNTRIES } from './sigridCountries.js';

/** The only place packages are fetched from: the allowlisted file names under it. */
export const SIGRID_BASE = 'https://www.openforis.org/fileadmin/SIGRID_1000m_grids/per_country/';
/** The spacings of the packages, in km. */
export const SIGRID_SPACINGS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 25, 30, 50, 100];
const FETCH_TIMEOUT_MS = 180_000;
/** Most bytes read of one package (the largest, China, is 134 MB). */
const MAX_PACKAGE_BYTES = 300 * 1024 * 1024;
const MAX_LINE = 1 << 20;
const TAIL = 65_536;
const COUNTS_KEPT = 20;

export class SigridError extends Error {
  constructor(
    public code: 'unreachable' | 'bad_package',
    message: string,
  ) {
    super(message);
  }
}

export const sigridCountry = (name: unknown) => SIGRID_COUNTRIES.find((c) => c.name === name);

/** The cells of a CSV line (quotes as in RFC 4180; a line holds no line break). */
export function csvCells(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') cells.push(cell), (cell = '');
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

const unreachable = (why: string) => new SigridError('unreachable', `The SIGRID grids at openforis.org could not be read (${why}). Try again later.`);

/** Where the entry `wanted` picks starts in the zip, from its central directory (0 when that cannot be read with a range). */
async function entryOffset(url: string, wanted: (name: string) => boolean, signal: AbortSignal): Promise<number> {
  const res = await fetch(url, { headers: { range: `bytes=-${TAIL}` }, signal });
  const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]);
  if (res.status !== 206 || !Number.isFinite(total)) {
    await res.body?.cancel();
    if (!res.ok) throw unreachable(`HTTP ${res.status}`);
    return 0;
  }
  const tail = Buffer.from(await res.arrayBuffer());
  const start = total - tail.length;
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return 0;
  const count = tail.readUInt16LE(eocd + 10);
  let at = tail.readUInt32LE(eocd + 16) - start;
  // A ZIP64 zip, or a directory before the tail read: read from the start.
  if (at < 0 || count === 0xffff) return 0;
  for (let i = 0; i < count && at + 46 <= tail.length && tail.readUInt32LE(at) === 0x02014b50; i++) {
    const nameLength = tail.readUInt16LE(at + 28);
    const name = tail.toString('utf8', at + 46, at + 46 + nameLength);
    const offset = tail.readUInt32LE(at + 42);
    if (wanted(name)) return offset === 0xffffffff ? 0 : offset;
    at += 46 + nameLength + tail.readUInt16LE(at + 30) + tail.readUInt16LE(at + 32);
  }
  return 0;
}

/**
 * The lines of one entry of a country's package (the first whose name passes `wanted`), each to
 * `onLine` as it is inflated; false when the package has none. Throws SigridError.
 */
export async function readPackageEntry(zip: string, wanted: (name: string) => boolean, onLine: (line: string) => void): Promise<boolean> {
  // Only allowlisted names, under the one host.
  if (!SIGRID_COUNTRIES.some((c) => c.zip === zip)) throw new SigridError('bad_package', 'Not a SIGRID country package.');
  const url = SIGRID_BASE + zip;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error('timeout')), FETCH_TIMEOUT_MS);
  let found = false;
  let done = false;
  let failure: Error | null = null;
  try {
    const offset = await entryOffset(url, wanted, abort.signal);
    const res = await fetch(url, offset > 0 ? { headers: { range: `bytes=${offset}-` }, signal: abort.signal } : { signal: abort.signal });
    if (!res.ok || !res.body) throw unreachable(`HTTP ${res.status}`);
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    const text = new TextDecoder();
    let rest = '';
    unzip.onfile = (file) => {
      if (found || !wanted(file.name)) return;
      found = true;
      file.ondata = (err, chunk, final) => {
        if (err) return void (failure = new SigridError('bad_package', `The SIGRID package cannot be read: ${err.message}.`));
        const lines = (rest + text.decode(chunk, { stream: !final })).split('\n');
        rest = final ? '' : lines.pop()!;
        if (rest.length > MAX_LINE) failure = new SigridError('bad_package', 'The SIGRID package has a line too long to be a plot.');
        for (const line of lines) {
          const l = line.endsWith('\r') ? line.slice(0, -1) : line;
          if (l !== '') onLine(l);
        }
        if (final) done = true;
      };
      file.start();
    };
    const reader = res.body.getReader();
    let bytes = 0;
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (value) {
        bytes += value.length;
        if (bytes > MAX_PACKAGE_BYTES) failure = new SigridError('bad_package', 'The SIGRID package is larger than the server reads.');
        else unzip.push(value, false);
      }
      if (failure) throw failure;
      if (done || ended) break;
    }
    await reader.cancel().catch(() => undefined);
    return found;
  } catch (err) {
    if (err instanceof SigridError) throw err;
    throw unreachable(abort.signal.aborted ? 'it took too long' : (err as Error).message);
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

/** The plots of a package per district and spacing, from its counts CSV. */
export interface SigridCounts {
  /** The spacings the package has (km), in order. */
  spacings: number[];
  /** Per province and district, its plots at each spacing (as `spacings`). */
  rows: { province: string; district: string; plots: number[] }[];
}

const counts = new Map<string, SigridCounts>();

/** The counts CSV of a country's package (kept for the last few countries). */
export async function sigridCounts(zip: string): Promise<SigridCounts> {
  const hit = counts.get(zip);
  if (hit) {
    counts.delete(zip);
    counts.set(zip, hit);
    return hit;
  }
  let header: string[] | null = null;
  const out: SigridCounts = { spacings: [], rows: [] };
  let columns: number[] = [];
  const found = await readPackageEntry(
    zip,
    (n) => n.endsWith('_plot_counts_by_district.csv'),
    (line) => {
      const cells = csvCells(line);
      if (!header) {
        header = cells;
        columns = cells.flatMap((c, i) => (/^plots_(\d+)x\1km$/.test(c) ? [i] : []));
        out.spacings = columns.map((i) => Number(/^plots_(\d+)x/.exec(cells[i])![1]));
        return;
      }
      out.rows.push({ province: cells[0] ?? '', district: cells[1] ?? '', plots: columns.map((i) => Number(cells[i]) || 0) });
    },
  );
  if (!found || out.spacings.length === 0) throw new SigridError('bad_package', 'The SIGRID package has no plot counts.');
  counts.set(zip, out);
  while (counts.size > COUNTS_KEPT) counts.delete(counts.keys().next().value as string);
  return out;
}

/** Which provinces and districts are asked for; none of either: the whole country. */
export interface SigridSelection {
  provinces: readonly string[];
  districts: readonly { province: string; district: string }[];
}

/** Whether a plot of this province and district is in the selection. */
export function selects(selection: SigridSelection): (province: string, district: string) => boolean {
  if (selection.provinces.length === 0 && selection.districts.length === 0) return () => true;
  const provinces = new Set(selection.provinces);
  const districts = new Set(selection.districts.map((d) => `${d.province}\u0000${d.district}`));
  return (p, d) => provinces.has(p) || districts.has(`${p}\u0000${d}`);
}

export interface SigridPlot {
  id: string;
  lat: number;
  lon: number;
  province: string;
  district: string;
}

/**
 * The plots of a country's grid at `spacingKm` in the selection (and in `clip`, when given): every
 * one counted, the first `limit` kept.
 */
export async function sigridPlots(
  zip: string,
  spacingKm: number,
  selection: SigridSelection,
  clip: ((lon: number, lat: number) => boolean) | null,
  limit: number,
): Promise<{ count: number; plots: SigridPlot[] }> {
  const inSelection = selects(selection);
  const plots: SigridPlot[] = [];
  let count = 0;
  let at: number[] | null = null;
  const found = await readPackageEntry(
    zip,
    (n) => n.endsWith(`_${spacingKm}x${spacingKm}km.csv`),
    (line) => {
      const cells = csvCells(line);
      if (!at) {
        const lower = cells.map((c) => c.trim().toLowerCase());
        at = ['ce_id', 'ycoordinate', 'xcoordinate', 'adm1nm', 'adm2nm'].map((c) => lower.indexOf(c));
        if (at.slice(0, 3).some((i) => i < 0)) throw new SigridError('bad_package', 'The SIGRID grid has no CE_ID, yCoordinate or xCoordinate column.');
        return;
      }
      const [id, y, x, p, d] = at.map((i) => (i < 0 ? '' : (cells[i] ?? '')));
      const lat = Number(y);
      const lon = Number(x);
      if (!id || y === '' || x === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (!inSelection(p, d) || (clip && !clip(lon, lat))) return;
      if (++count <= limit) plots.push({ id, lat, lon, province: p, district: d });
    },
  );
  if (!found) throw new SigridError('bad_package', `The SIGRID package has no ${spacingKm} km grid.`);
  return { count, plots };
}
