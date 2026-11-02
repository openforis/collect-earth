import { plotFileOf } from './plotFileCache.js';
import { isWgs84 } from './routes/plotPlaces.js';
import type { StoredDistribution } from './types.js';

/**
 * Division order 'nearby' (Task 15): a plot file's plots along a Hilbert curve over
 * their latitude and longitude, so that consecutive plots are close on the map and a
 * contiguous chunk of them (one person's share) is a compact area. Pure and repeatable
 * (no seed); the served files of a 'nearby' division list their rows in this order too.
 */

/** Cells per side of the curve's grid: 2^16 (about 0.6 m per cell over a 40 km wide file). */
export const HILBERT_BITS = 16;

/**
 * The position of cell (x, y) along the Hilbert curve over a 2^bits × 2^bits grid (the
 * classic xy2d): it starts at (0, 0) and ends at (2^bits - 1, 0), each step to a
 * neighbouring cell. x and y are whole numbers in 0..2^bits - 1; the result is exact
 * (below 2^32 with 16 bits).
 */
export function hilbertIndex(x: number, y: number, bits = HILBERT_BITS): number {
  const n = 2 ** bits;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x;
        y = n - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

/**
 * The longitude from which the places are counted, so that a file across the antimeridian
 * (plots at 179.9 and -179.9) is one area, not two ends of the world: when the widest gap
 * between the file's longitudes is not the one around the back of the globe, the plots west
 * of it are taken 360° further east. Null when nothing is to be shifted.
 */
function antimeridianShift(lons: Float64Array): number | null {
  const sorted = Float64Array.from(lons).sort();
  if (sorted.length < 2) {
    return null;
  }
  let gap = 360 - (sorted[sorted.length - 1] - sorted[0]);
  let east: number | null = null;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] > gap) {
      gap = sorted[i] - sorted[i - 1];
      east = sorted[i];
    }
  }
  return east;
}

/**
 * The plots in the order of the curve. `places` gives [lat, lon] of the plots that have
 * one. The curve covers the file's bounding box with one scale for both axes (a square
 * stays a square), the longitudes narrowed by the cosine of the box's middle latitude so
 * distances are about right; plots at the same cell keep their file order. Plots without
 * a place come last, in file order.
 */
export function nearbyOrder(plotIds: readonly string[], places: ReadonlyMap<string, readonly [number, number]>): string[] {
  const placed: number[] = [];
  const missing: string[] = [];
  plotIds.forEach((id, i) => (places.has(id) ? placed.push(i) : missing.push(id)));
  if (placed.length === 0) {
    return [...plotIds];
  }
  const lats = new Float64Array(placed.length);
  const lons = new Float64Array(placed.length);
  placed.forEach((at, k) => {
    const [lat, lon] = places.get(plotIds[at])!;
    lats[k] = lat;
    lons[k] = lon;
  });
  const east = antimeridianShift(lons);
  if (east !== null) {
    for (let k = 0; k < lons.length; k += 1) {
      if (lons[k] < east) {
        lons[k] += 360;
      }
    }
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (let k = 0; k < placed.length; k += 1) {
    minLat = Math.min(minLat, lats[k]);
    maxLat = Math.max(maxLat, lats[k]);
    minLon = Math.min(minLon, lons[k]);
    maxLon = Math.max(maxLon, lons[k]);
  }
  const narrow = Math.max(0.01, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
  const span = Math.max((maxLon - minLon) * narrow, maxLat - minLat);
  const cells = 2 ** HILBERT_BITS - 1;
  const scale = span > 0 ? cells / span : 0;
  const keys = new Float64Array(placed.length);
  for (let k = 0; k < placed.length; k += 1) {
    const x = Math.min(cells, Math.round((lons[k] - minLon) * narrow * scale));
    const y = Math.min(cells, Math.round((lats[k] - minLat) * scale));
    keys[k] = hilbertIndex(x, y);
  }
  const byCurve = Array.from(placed.keys()).sort((a, b) => keys[a] - keys[b] || a - b);
  return [...byCurve.map((k) => plotIds[placed[k]]), ...missing];
}

/**
 * Whether a divided file's served files list their rows along the curve: a division in
 * order 'nearby', or one changed by hand (a move) after it.
 */
export function servedNearby(distribution: StoredDistribution | null | undefined): boolean {
  return distribution !== null && distribution !== undefined && 'order' in distribution && distribution.order === 'nearby';
}

/** Whether order 'nearby' can be offered, and why not. */
export type NearbyAvailability =
  | { available: true; reason: null; withPlace: number; withoutPlace: number }
  | { available: false; reason: 'other_srs'; withPlace: 0; withoutPlace: number; srid: string }
  | { available: false; reason: 'no_places'; withPlace: 0; withoutPlace: number };

/**
 * Order 'nearby' needs latitude and longitude: the survey's first spatial reference system
 * must be one Collect Earth takes as it is (isWgs84; others it transforms, this server does
 * not), and at least one plot must have a place. The plots without one go last.
 */
export function nearbyAvailability(srid: string, withPlace: number, plotCount: number): NearbyAvailability {
  if (!isWgs84(srid)) {
    return { available: false, reason: 'other_srs', withPlace: 0, withoutPlace: plotCount, srid };
  }
  if (withPlace === 0) {
    return { available: false, reason: 'no_places', withPlace: 0, withoutPlace: plotCount };
  }
  return { available: true, reason: null, withPlace, withoutPlace: plotCount - withPlace };
}

/** Each plot's position in the order of the curve (nearbyOrder). */
export function nearbyRanks(plotIds: readonly string[], places: ReadonlyMap<string, readonly [number, number]>): Map<string, number> {
  return new Map(nearbyOrder(plotIds, places).map((id, i) => [id, i]));
}

/**
 * The plots in the order of their rank (nearbyRanks of the whole file): a part of a file (its
 * plots less the reference plots, Task 14) follows the same curve as the whole file, so the
 * division and the served rows agree. Plots without a rank last, in their order.
 */
export function inRankOrder(plotIds: readonly string[], rank: ReadonlyMap<string, number>): string[] {
  const of = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...plotIds].sort((x, y) => of(x) - of(y));
}

/** Recent rank maps, by content and key count (least recently used out first). */
const MAX_RANKS = 4;
const ranks = new Map<string, ReadonlyMap<string, number>>();

/**
 * Each plot's position in the file's 'nearby' order, the curve over all of its plots (cached by
 * content and key count: every person's served file of one division reads the same, and the
 * division deals along it). `places` are the file's places (PlotPlaceReader.placesOfFile, kept
 * per checksum), read only when the ranks are not cached.
 */
export async function nearbyRanksOf(
  file: { checksum: string; data: Buffer },
  keyCount: number,
  places: () => Promise<ReadonlyMap<string, readonly [number, number]>>,
): Promise<ReadonlyMap<string, number>> {
  const key = `${file.checksum}:${keyCount}`;
  const hit = ranks.get(key);
  if (hit) {
    ranks.delete(key);
    ranks.set(key, hit);
    return hit;
  }
  const result = nearbyRanks(plotFileOf(file, keyCount).plotIds, await places());
  ranks.set(key, result);
  while (ranks.size > MAX_RANKS) {
    ranks.delete(ranks.keys().next().value as string);
  }
  return result;
}
