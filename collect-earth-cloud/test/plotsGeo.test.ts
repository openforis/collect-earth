import { describe, expect, it } from 'vitest';
import { GEO_PAGE_SIZE, GEO_STATUSES, geoPage, geoStatus, plotsGeo, type GeoInput } from '../src/plotsGeo.js';
import type { OperatorWork } from '../src/progress.js';
import type { DecisionKind } from '../src/types.js';

const S = Object.fromEntries(GEO_STATUSES.map((s, i) => [s, i])) as Record<(typeof GEO_STATUSES)[number], number>;

function work(main: string[] = [], drafts: string[] = []): OperatorWork {
  return {
    mainSubmitted: new Map(main.map((u) => [u, 1])),
    mainDrafts: new Set(drafts),
    checkSubmitted: new Map(),
    checkDrafts: new Set(),
    submissionTimes: [],
    mainSubmissionTimes: [],
    mainGroups: new Set(),
  };
}

const places = (entries: [string, number, number][]) => new Map(entries.map(([u, lat, lon]) => [u, [lat, lon] as const]));

function input(over: Partial<GeoInput> = {}): GeoInput {
  return {
    files: [
      { id: 'f1', filename: 'north.csv', units: ['1', '2', '3', '4', '5', '6', '7'], places: places([['1', 1, 10], ['2', 2, 20], ['3', 3, 30], ['4', 4, 40], ['5', 5, 50], ['6', 6, 60]]) },
      // Plot 1 again (its place in the first file wins), and plot 8 only here.
      { id: 'f2', filename: 'south.csv', units: ['1', '8'], places: places([['1', -1, -10], ['8', 8.1234567, 80.7654321]]) },
    ],
    isPlot: () => true,
    progress: {
      firstSubmitted: new Map([['2', 1], ['3', 1], ['4', 1], ['5', 1]]),
      started: new Set(['6']),
      held: new Map([['maria', ['1', '2', '3']], ['ana', ['3', '4']]]),
      byOperator: new Map([['maria', work(['2', '3'])], ['ben', work(['5'], ['6'])], ['ana', work(['4'])]]),
    },
    decisions: new Map<string, DecisionKind>([['3', 'first'], ['4', 'recheck']]),
    differing: new Set(['3', '5']),
    people: true,
    ...over,
  };
}

describe('plotsGeo: the map of progress', () => {
  it('gives each plot a status: not started, started, submitted, then from the decisions and the figures', () => {
    const progress = input().progress;
    const decisions = new Map<string, DecisionKind>([['a', 'first'], ['b', 'check'], ['c', 'recheck']]);
    const p = { ...progress, firstSubmitted: new Map(['a', 'b', 'c', 'd', 'e'].map((u) => [u, 1])), started: new Set(['s']) };
    const differing = new Set(['a', 'd']);
    expect(geoStatus('x', p, decisions, differing)).toBe(S.notStarted);
    expect(geoStatus('s', p, decisions, differing)).toBe(S.started);
    expect(geoStatus('e', p, decisions, differing)).toBe(S.submitted);
    // Decided "first" or "check": accepted, even when it differs.
    expect(geoStatus('a', p, decisions, differing)).toBe(S.accepted);
    expect(geoStatus('b', p, decisions, differing)).toBe(S.accepted);
    expect(geoStatus('c', p, decisions, differing)).toBe(S.recheck);
    expect(geoStatus('d', p, decisions, differing)).toBe(S.differs);
    // Without figures, no "differs"; decisions still count (they are kept by the server).
    expect(geoStatus('d', p, decisions, null)).toBe(S.submitted);
    expect(geoStatus('c', p, decisions, null)).toBe(S.recheck);
    // A decision on a plot whose first assessment is no longer submitted (taken back to edit): its own state.
    expect(geoStatus('s', p, new Map([['s', 'recheck']]), differing)).toBe(S.started);
  });

  it('lists every plot once, in the files order, with its place, status and people; counts every status', () => {
    const map = plotsGeo(input());
    expect(map.plots).toEqual(['1', '2', '3', '4', '5', '6', '8']);
    expect(map.lat).toEqual([1, 2, 3, 4, 5, 6, 8.123457]);
    expect(map.lon).toEqual([10, 20, 30, 40, 50, 60, 80.765432]);
    expect(map.status).toEqual([S.notStarted, S.submitted, S.accepted, S.recheck, S.differs, S.started, S.notStarted]);
    expect(map.people).toEqual(['ana', 'ben', 'maria']);
    // Holder groups: maria; ana and maria; ana; nobody (-1).
    expect(map.holders).toEqual([['maria'], ['ana', 'maria'], ['ana']]);
    expect(map.holder).toEqual([0, 0, 1, 2, -1, -1, -1]);
    // Plot 7 has no place: counted, not on the map.
    expect(map.counts).toEqual([3, 1, 1, 1, 1, 1]);
    expect(map.notOnMap).toBe(1);
    expect(map.files).toEqual([
      { id: 'f1', filename: 'north.csv', plots: 7, onMap: 6 },
      { id: 'f2', filename: 'south.csv', plots: 2, onMap: 2 },
    ]);
  });

  it('filters by plot file (its own places) and by person (plots they hold or assessed first)', () => {
    const south = plotsGeo(input({ file: 'f2' }));
    expect(south.plots).toEqual(['1', '8']);
    expect(south.lat).toEqual([-1, 8.123457]);
    expect(south.counts).toEqual([2, 0, 0, 0, 0, 0]);
    // The files list and the person menu stay whole.
    expect(south.files).toHaveLength(2);
    expect(south.people).toEqual(['ana', 'ben', 'maria']);

    // ben holds nothing but assessed 5 and has a draft of 6.
    expect(plotsGeo(input({ person: 'ben' })).plots).toEqual(['5', '6']);
    expect(plotsGeo(input({ person: 'ana' })).plots).toEqual(['3', '4']);
    expect(plotsGeo(input({ person: 'maria', file: 'f2' })).plots).toEqual(['1']);
    expect(plotsGeo(input({ person: 'nobody' })).plots).toEqual([]);
  });

  it('names nobody for a reviewer', () => {
    const map = plotsGeo(input({ people: false }));
    expect(map.people).toBeNull();
    expect(map.holders).toBeNull();
    expect(map.holder.every((h) => h === -1)).toBe(true);
    expect(map.status).toEqual(plotsGeo(input()).status);
  });

  it('leaves out units that are checks, and puts files without places (other coordinate systems) off the map', () => {
    const own = plotsGeo(input({ isPlot: (u) => u !== '2' }));
    expect(own.plots).not.toContain('2');
    expect(own.files[0].plots).toBe(6);

    const other = plotsGeo(input({ files: input().files.map((f) => ({ ...f, places: null })) }));
    expect(other.plots).toEqual([]);
    expect(other.notOnMap).toBe(8);
    expect(other.counts.reduce((a, b) => a + b, 0)).toBe(8);
    expect(other.files.map((f) => f.onMap)).toEqual([0, 0]);
  });

  it('pages by GEO_PAGE_SIZE as compact [lat, lon, status, holder] arrays with their plot ids', () => {
    expect(GEO_PAGE_SIZE).toBe(20_000);
    const map = plotsGeo(input());
    const first = geoPage(map, 0, 3);
    expect(first).toEqual({
      points: [
        [1, 10, S.notStarted, 0],
        [2, 20, S.submitted, 0],
        [3, 30, S.accepted, 1],
      ],
      plots: ['1', '2', '3'],
      next: 3,
    });
    const last = geoPage(map, 6, 3);
    expect(last).toEqual({ points: [[8.123457, 80.765432, S.notStarted, -1]], plots: ['8'], next: null });
    expect(geoPage(map, 7, 3)).toEqual({ points: [], plots: [], next: null });
  });

  it('builds 100,000 plots quickly', () => {
    const units = Array.from({ length: 100_000 }, (_, i) => String(i + 1));
    const big = input({
      files: [{ id: 'f', filename: 'big.csv', units, places: places(units.map((u, i) => [u, (i % 180) - 90, (i % 360) - 180])) }],
      progress: { firstSubmitted: new Map(units.slice(0, 50_000).map((u) => [u, 1])), started: new Set(units.slice(50_000, 60_000)), held: new Map([['maria', units]]), byOperator: new Map() },
    });
    const t = performance.now();
    const map = plotsGeo(big);
    const pages = [];
    for (let offset: number | null = 0; offset !== null; ) {
      const page = geoPage(map, offset);
      pages.push(page);
      offset = page.next;
    }
    const ms = performance.now() - t;
    expect(pages).toHaveLength(5);
    expect(map.counts).toEqual([40_000, 10_000, 49_997, 1, 1, 1]);
    expect(ms).toBeLessThan(1500);
  });
});
