import { describe, expect, it } from 'vitest';
import { hilbertIndex, nearbyAvailability, nearbyOrder, nearbyRanksOf } from '../src/nearby.js';
import { buildPlotFile, parsePlotFile } from '../src/plots.js';

type Places = Map<string, readonly [number, number]>;

describe('hilbertIndex', () => {
  it('visits every cell of a grid once, each step to a neighbouring cell', () => {
    for (const bits of [1, 2, 3, 4]) {
      const n = 2 ** bits;
      const cellAt = new Map<number, [number, number]>();
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          const d = hilbertIndex(x, y, bits);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThan(n * n);
          expect(cellAt.has(d)).toBe(false);
          cellAt.set(d, [x, y]);
        }
      }
      expect(cellAt.size).toBe(n * n);
      for (let d = 1; d < n * n; d++) {
        const [x0, y0] = cellAt.get(d - 1)!;
        const [x1, y1] = cellAt.get(d)!;
        expect(Math.abs(x1 - x0) + Math.abs(y1 - y0)).toBe(1);
      }
      // It starts in one corner and ends in a neighbouring one.
      expect(cellAt.get(0)).toEqual([0, 0]);
      expect(cellAt.get(n * n - 1)).toEqual([n - 1, 0]);
    }
  });

  it('gives the curve of a 4 × 4 grid', () => {
    const order = Array.from({ length: 16 }, (_, d) => d);
    const cells: string[] = [];
    for (const d of order) {
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) if (hilbertIndex(x, y, 2) === d) cells.push(`${x}${y}`);
    }
    expect(cells).toEqual(['00', '10', '11', '01', '02', '03', '13', '12', '22', '23', '33', '32', '31', '21', '20', '30']);
  });

  it('keeps the index exact with 16 bits', () => {
    const n = 2 ** 16;
    expect(hilbertIndex(n - 1, 0)).toBe(n * n - 1);
    expect(hilbertIndex(0, 0)).toBe(0);
  });
});

describe('nearbyOrder', () => {
  /** A grid of plots in rows (lat) and columns (lon), ids in row order. */
  const grid = (side: number, at = (r: number, c: number): [number, number] => [r, c]) => {
    const ids: string[] = [];
    const places: Places = new Map();
    for (let r = 0; r < side; r++) {
      for (let c = 0; c < side; c++) {
        const id = `${r}-${c}`;
        ids.push(id);
        places.set(id, at(r, c));
      }
    }
    return { ids, places };
  };

  it('follows the curve over the plots: each plot next to the one before', () => {
    const { ids, places } = grid(8, (r, c) => [10 + r * 0.01, 20 + c * 0.01]);
    const order = nearbyOrder(ids, places);
    expect([...order].sort()).toEqual([...ids].sort());
    for (let i = 1; i < order.length; i++) {
      const [r0, c0] = order[i - 1].split('-').map(Number);
      const [r1, c1] = order[i].split('-').map(Number);
      expect(Math.abs(r1 - r0) + Math.abs(c1 - c0)).toBe(1);
    }
  });

  it('puts the plots without a place last, in file order; same places keep file order', () => {
    const places: Places = new Map([
      ['a', [1, 1]],
      ['c', [0, 0]],
      ['e', [0, 0]],
    ]);
    expect(nearbyOrder(['a', 'b', 'c', 'd', 'e'], places)).toEqual(['c', 'e', 'a', 'b', 'd']);
    expect(nearbyOrder(['x', 'y'], new Map())).toEqual(['x', 'y']);
    expect(nearbyOrder(['x', 'y'], new Map([['y', [5, 5]], ['x', [5, 5]]]))).toEqual(['x', 'y']);
  });

  it('is the same every time (no seed)', () => {
    const { ids, places } = grid(20, (r, c) => [Math.sin(r * 7 + c) * 30, Math.cos(r + c * 3) * 60]);
    expect(nearbyOrder(ids, places)).toEqual(nearbyOrder(ids, places));
  });

  it('keeps plots on both sides of the antimeridian together', () => {
    // Two clusters of plots around 180°: east (179.9...) and west (-179.9...), and one far away.
    const places: Places = new Map([
      ['e1', [0, 179.9]],
      ['w1', [0, -179.9]],
      ['e2', [0.1, 179.8]],
      ['w2', [0.1, -179.8]],
    ]);
    const order = nearbyOrder(['e1', 'w1', 'e2', 'w2'], places);
    // East and west of the line are the same area: the order goes from one side to the other once.
    const sides = order.map((id) => id[0]).join('');
    expect(['eeww', 'wwee']).toContain(sides);
  });
});

describe('nearbyAvailability', () => {
  it('is offered only for latitude and longitude with places', () => {
    expect(nearbyAvailability('', 10, 10)).toEqual({ available: true, reason: null, withPlace: 10, withoutPlace: 0 });
    expect(nearbyAvailability('EPSG:4326', 8, 10)).toEqual({ available: true, reason: null, withPlace: 8, withoutPlace: 2 });
    expect(nearbyAvailability('EPSG:32633', 10, 10)).toEqual({ available: false, reason: 'other_srs', withPlace: 0, withoutPlace: 10, srid: 'EPSG:32633' });
    expect(nearbyAvailability('', 0, 10)).toEqual({ available: false, reason: 'no_places', withPlace: 0, withoutPlace: 10 });
  });
});

describe('a served file in the order of the curve', () => {
  const csv =
    'id,lat,lon,name\r\n' +
    '1,0,0,"far, south"\r\n' +
    '2,10,10,north\r\n' +
    '3,0,0.001,near 1\r\n' +
    '4,,,no place\r\n' +
    '2,10,10,second row of 2\r\n' +
    '5,10,10.001,near 2';
  const file = { checksum: 'nearby-test', data: Buffer.from(csv) };

  it('ranks the plots along the curve, the plots without a place last', () => {
    const ranks = nearbyRanksOf(file, 1);
    const ordered = [...ranks.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(ordered.slice(-1)).toEqual(['4']);
    // 1 and 3 together, 2 and 5 together.
    expect(Math.abs(ordered.indexOf('1') - ordered.indexOf('3'))).toBe(1);
    expect(Math.abs(ordered.indexOf('2') - ordered.indexOf('5'))).toBe(1);
    expect(nearbyRanksOf(file, 1)).toBe(ranks);
  });

  it('serves the rows in that order, rows of one plot together, every row with its bytes and a line break', () => {
    const parsed = parsePlotFile(file.data, 1);
    const ranks = nearbyRanksOf(file, 1);
    const built = buildPlotFile(parsed, new Set(['1', '2', '4', '5']), undefined, ranks).toString();
    const lines = built.split('\r\n');
    expect(lines[0]).toBe('id,lat,lon,name');
    const ids = lines.slice(1).filter((l) => l !== '').map((l) => l.split(',')[0]);
    const rank = (id: string) => ranks.get(id)!;
    expect(ids).toEqual(['1', '2', '2', '4', '5'].sort((a, b) => rank(a) - rank(b)));
    expect(lines).toContain('1,0,0,"far, south"');
    expect(lines).toContain('5,10,10.001,near 2');
    // Rows of plot 2 in their file order.
    expect(lines.filter((l) => l.startsWith('2,'))).toEqual(['2,10,10,north', '2,10,10,second row of 2']);
    // The last original row (no line break) has one when rows follow it.
    expect(built.includes('near 2\r\n') || built.endsWith('near 2')).toBe(true);
    expect(built.split('\r\n').filter((l) => l === '').length).toBeLessThanOrEqual(1);
  });
});
