import { describe, expect, it } from 'vitest';
import { buildPlotIndex, filesOfUnit, MAX_SEARCH_RESULTS, searchPlots, unitIndex, unitsOfPlot } from '../src/plotSearch.js';

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

describe('plot search', () => {
  it('by prefix, the shortest ids first, at most 20, saying when there are more', () => {
    const index = buildPlotIndex([{ id: 'f1', filename: 'a.csv', units: ids(250) }], null);
    const ones = searchPlots(index, '1');
    expect(ones.plots).toHaveLength(MAX_SEARCH_RESULTS);
    expect(ones.plots.map((p) => p.plot)).toEqual(['1', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '100', '101', '102', '103', '104', '105', '106', '107', '108']);
    expect(ones.more).toBe(true);
    const few = searchPlots(index, '24');
    expect(few.plots.map((p) => p.plot)).toEqual(['24', '240', '241', '242', '243', '244', '245', '246', '247', '248', '249']);
    expect(few.more).toBe(false);
    expect(searchPlots(index, '250').plots.map((p) => p.plot)).toEqual(['250']);
    expect(searchPlots(index, '251').plots).toEqual([]);
    expect(searchPlots(index, '  ').plots).toEqual([]);
    expect(searchPlots(index, '1', 3).plots.map((p) => p.plot)).toEqual(['1', '10', '11']);
  });

  it('ignores case and the spaces around; ids with letters and commas', () => {
    const index = buildPlotIndex([{ id: 'f1', filename: 'a.csv', units: ['Plot-A', 'plot-b', 'X,1', 'x,2'] }], null);
    expect(searchPlots(index, ' PLOT').plots.map((p) => p.plot)).toEqual(['Plot-A', 'plot-b']);
    expect(searchPlots(index, 'x,').plots.map((p) => p.plot)).toEqual(['X,1', 'x,2']);
    expect(unitIndex(index, 'X,1')).toBeGreaterThanOrEqual(0);
    expect(unitIndex(index, 'x,1')).toBe(-1);
  });

  it('by the id the collector sees (the keys hidden from the record list left out) and by the unit, each plot once', () => {
    // An own round hidden from the record list: the unit "17,2025" is "17" for the collector.
    const index = buildPlotIndex([{ id: 'f1', filename: 'a.csv', units: ['17,2025', '17,2026', '170,2025', '7,2025'] }], [false, true]);
    const found = searchPlots(index, '17');
    expect(found.plots).toEqual([
      { plot: '17,2025', name: '17', files: [{ id: 'f1', filename: 'a.csv' }] },
      { plot: '17,2026', name: '17', files: [{ id: 'f1', filename: 'a.csv' }] },
      { plot: '170,2025', name: '170', files: [{ id: 'f1', filename: 'a.csv' }] },
    ]);
    expect(found.more).toBe(false);
    // The unit with its round too.
    expect(searchPlots(index, '17,2026').plots.map((p) => p.plot)).toEqual(['17,2026']);
    // Each plot once even when only two fit.
    expect(searchPlots(index, '1', 2).plots.map((p) => p.plot)).toEqual(['17,2025', '17,2026']);
    expect(searchPlots(index, '1', 2).more).toBe(true);
  });

  it('every file holding a plot, in the files\' order', () => {
    const index = buildPlotIndex(
      [
        { id: 'f1', filename: 'north.csv', units: ['1', '2', '2'] },
        { id: 'f2', filename: 'south.csv', units: ['3', '1'] },
        { id: 'f3', filename: 'checks.csv', units: ['1'] },
      ],
      null,
    );
    expect(searchPlots(index, '1').plots).toEqual([
      {
        plot: '1',
        name: '1',
        files: [
          { id: 'f1', filename: 'north.csv' },
          { id: 'f2', filename: 'south.csv' },
          { id: 'f3', filename: 'checks.csv' },
        ],
      },
    ]);
    expect(filesOfUnit(index, unitIndex(index, '2'))).toEqual([{ id: 'f1', filename: 'north.csv' }]);
    expect(index.units).toEqual(['1', '2', '3']);
  });

  it('an own round: the units of each plot kept with the index (its other rounds)', () => {
    const files = [{ id: 'f1', filename: 'a.csv', units: ['17,2025', '170,2025', '17,2026'] }, { id: 'f2', filename: 'b.csv', units: ['17,2027'] }];
    const own = buildPlotIndex(files, null, { count: 2, roundIndex: 1 });
    expect(unitsOfPlot(own, '17,2026')).toEqual(['17,2025', '17,2026', '17,2027']);
    expect(unitsOfPlot(own, '170,2025')).toEqual(['170,2025']);
    // No round in the units: each unit alone.
    expect(unitsOfPlot(buildPlotIndex(files, null), '17,2026')).toEqual(['17,2026']);
  });

  it('a search over 200,000 plots takes a few milliseconds once the index is built', () => {
    const index = buildPlotIndex([{ id: 'f1', filename: 'big.csv', units: ids(200_000) }], null);
    const started = performance.now();
    for (let i = 0; i < 10; i++) searchPlots(index, '1');
    const each = (performance.now() - started) / 10;
    expect(searchPlots(index, '1').plots[0].plot).toBe('1');
    expect(each).toBeLessThan(100);
  });
});
