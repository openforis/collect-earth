import { describe, expect, it } from 'vitest';
import {
  divide,
  METADATA_KEY_PARTS,
  moveUnfinished,
  overlapPicks,
  overlapReport,
  parseDivisionRequest,
  shareSizes,
  submittedByPlot,
  summarize,
} from '../src/division.js';
import type { PlotAssignment, RecordRow, StoredDistribution } from '../src/types.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
const none = new Map<string, Set<string>>();

/** Each person's plots: primary (not overlap) and copies. */
function byPerson(plots: PlotAssignment[]) {
  const result: Record<string, { own: string[]; copies: string[] }> = {};
  for (const a of plots) {
    const p = (result[a.userId] ??= { own: [], copies: [] });
    (a.overlap ? p.copies : p.own).push(a.plotKey);
  }
  return result;
}

const even = (people: string[], extra: Partial<Extract<StoredDistribution, { mode: 'even' }>> = {}) =>
  ({ mode: 'even', people, order: 'file', overlapPercent: 0, ...extra }) as const;

function record(recordKey: string, operator: string, overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    projectId: 'p',
    recordKey,
    operator,
    modifiedOn: 1,
    receivedAt: 1,
    activelySaved: true,
    step: 1,
    xml: null,
    summary: {},
    deleted: false,
    deletedOn: null,
    ...overrides,
  };
}

describe('shareSizes', () => {
  it('splits evenly, the first people taking the extra one', () => {
    expect(shareSizes([0, 0, 0], 10)).toEqual([4, 3, 3]);
    expect(shareSizes([0, 0], 0)).toEqual([0, 0]);
  });
  it('fills around plots that are already someone`s', () => {
    // 10 plots, a has 6 pinned: b and c share the 4 others.
    expect(shareSizes([6, 0, 0], 4)).toEqual([0, 2, 2]);
    // 9 plots, a has 2 pinned: totals 3/3/3.
    expect(shareSizes([2, 0, 0], 7)).toEqual([1, 3, 3]);
  });
});

describe('divide: evenly', () => {
  it('gives contiguous chunks differing by at most one, in file order', () => {
    const plots = divide(even(['a', 'b', 'c']), ids(10), null, none);
    const p = byPerson(plots);
    expect(p.a.own).toEqual(['1', '2', '3', '4']);
    expect(p.b.own).toEqual(['5', '6', '7']);
    expect(p.c.own).toEqual(['8', '9', '10']);
    expect(plots.every((x) => !x.overlap)).toBe(true);
  });

  it('mixes deterministically with the seed, each list kept in file order', () => {
    const d = even(['a', 'b'], { order: 'mixed', seed: 42 });
    const first = divide(d, ids(20), null, none);
    expect(divide(d, ids(20), null, none)).toEqual(first);
    const p = byPerson(first);
    expect(p.a.own).toHaveLength(10);
    expect(p.a.own).not.toEqual(ids(10));
    expect([...p.a.own].sort((x, y) => Number(x) - Number(y))).toEqual(p.a.own);
    expect(byPerson(divide(even(['a', 'b'], { order: 'mixed', seed: 43 }), ids(20), null, none)).a.own).not.toEqual(p.a.own);
  });

  it('keeps submitted plots with whoever submitted them and evens out the rest', () => {
    // b submitted 1..4; 9 plots between a, b, c: 3 each, b's are 1..4 -> b has 4.
    const submitted = new Map(['1', '2', '3', '4'].map((k) => [k, new Set(['b'])]));
    const p = byPerson(divide(even(['a', 'b', 'c']), ids(9), null, submitted));
    expect(p.b.own).toEqual(['1', '2', '3', '4']);
    expect(p.a.own).toHaveLength(3);
    expect(p.c.own).toHaveLength(2);
    // Someone not among the people does not pin.
    const outsider = new Map([['1', new Set(['z'])]]);
    expect(byPerson(divide(even(['a', 'b']), ids(4), null, outsider)).a.own).toEqual(['1', '2']);
  });

  it('gives overlap copies: ceil(p%) of each list, spread through it, to the next person', () => {
    const plots = divide(even(['a', 'b'], { overlapPercent: 25 }), ids(10), null, none);
    const p = byPerson(plots);
    expect(p.a.own).toEqual(['1', '2', '3', '4', '5']);
    // ceil(25% of 5) = 2 copies of a's plots go to b, and 2 of b's to a.
    expect(p.b.copies).toEqual(['1', '3']);
    expect(p.a.copies).toEqual(['6', '8']);
    expect(overlapPicks(10, 10)).toEqual([0]);
    expect(overlapPicks(30, 10)).toEqual([0, 10, 20]);
    expect(overlapPicks(4, 50)).toEqual([0, 2]);
  });

  it('gives no overlap with one person', () => {
    expect(divide(even(['a'], { overlapPercent: 50 }), ids(4), null, none).every((x) => !x.overlap)).toBe(true);
  });
});

describe('divide: by a column', () => {
  const values = ['LP', 'LP', 'OR', 'LP', 'OR', '', 'PT', 'LP'];
  const column = (groups: { value: string; people: string[] }[], overlapPercent = 0): StoredDistribution & { mode: 'column' } => ({
    mode: 'column',
    column: 3,
    groups,
    order: 'file',
    overlapPercent,
  });

  it('shares each value between its people; values in no group stay unassigned', () => {
    const plots = divide(column([{ value: 'LP', people: ['a', 'b'] }, { value: 'OR', people: ['c'] }]), ids(8), values, none);
    const p = byPerson(plots);
    expect(p.a.own).toEqual(['1', '2']);
    expect(p.b.own).toEqual(['4', '8']);
    expect(p.c.own).toEqual(['3', '5']);
    const s = summarize(null, ids(8), plots, none, new Map([['a', 'ana'], ['b', 'bea'], ['c', 'cai']]));
    expect(s.unassigned).toBe(2); // '' and 'PT'
  });

  it('sends a one-person group`s copies to the next of all the people', () => {
    const plots = divide(column([{ value: 'LP', people: ['a'] }, { value: 'OR', people: ['b'] }], 50), ids(8), values, none);
    const p = byPerson(plots);
    expect(p.b.copies).toEqual(['1', '4']); // ceil(50% of 4) of a's
    expect(p.a.copies).toEqual(['3']); // ceil(50% of 2) of b's
  });
});

describe('moveUnfinished', () => {
  it('moves what `from` has not submitted; `from` loses what `to` already has', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '1', userId: 'a', overlap: false },
      { plotKey: '2', userId: 'a', overlap: false },
      { plotKey: '3', userId: 'a', overlap: true },
      { plotKey: '3', userId: 'b', overlap: false },
      { plotKey: '4', userId: 'c', overlap: false },
    ];
    const { plots, moved } = moveUnfinished(holdings, 'a', 'b', new Map([['1', new Set(['a'])]]));
    expect(moved).toBe(2);
    expect(plots).toEqual([
      { plotKey: '1', userId: 'a', overlap: false },
      { plotKey: '2', userId: 'b', overlap: false },
      { plotKey: '3', userId: 'b', overlap: false },
      { plotKey: '4', userId: 'c', overlap: false },
    ]);
  });
});

describe('submittedByPlot', () => {
  it('counts submitted, non-deleted records by members, matched to their plot', () => {
    const map = submittedByPlot(
      [
        record('1,2020', 'maria'),
        record('2', 'maria', { activelySaved: false }),
        record('3', 'maria', { deleted: true }),
        record('4', 'stranger'),
        record('99', 'maria'),
      ],
      new Set(['1', '2', '3', '4']),
      new Map([['maria', 'u1']]),
    );
    expect([...map.entries()]).toEqual([['1', new Set(['u1'])]]);
  });
});

describe('parseDivisionRequest', () => {
  const members = new Set(['a', 'b']);
  const parse = (body: unknown) => parseDivisionRequest(body, members, 5, () => 7);

  it('refuses unknown people, empty lists and groups, bad columns and overlap', () => {
    expect(parse({ mode: 'even', people: ['a', 'x'] })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: [] })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a'], overlapPercent: 51 })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a'], overlapPercent: -1 })).toHaveProperty('reason');
    expect(parse({ mode: 'column', column: 5, groups: [{ value: 'x', people: ['a'] }] })).toHaveProperty('reason');
    expect(parse({ mode: 'column', column: 1.5, groups: [{ value: 'x', people: ['a'] }] })).toHaveProperty('reason');
    expect(parse({ mode: 'column', column: 1, groups: [{ value: 'x', people: [] }] })).toHaveProperty('reason');
    expect(parse({ mode: 'column', column: 1, groups: [] })).toHaveProperty('reason');
    expect(parse({ mode: 'nope' })).toHaveProperty('reason');
  });

  it('ignores extra fields of a whole-file request, and keeps or picks the seed', () => {
    expect(parse({ mode: 'whole', people: ['zzz'], column: 99 })).toEqual({ mode: 'whole' });
    expect(parse({ mode: 'even', people: ['a', 'b', 'a'], order: 'mixed' })).toEqual({
      mode: 'even', people: ['a', 'b'], order: 'mixed', overlapPercent: 0, seed: 7,
    });
    expect(parse({ mode: 'even', people: ['a'], order: 'mixed', seed: 123 })).toMatchObject({ seed: 123 });
    expect(parse({ mode: 'even', people: ['a'], order: 'mixed', seed: 'x' })).toHaveProperty('reason');
    expect(parse({ mode: 'even', people: ['a'] })).not.toHaveProperty('seed');
  });
});

describe('overlapReport', () => {
  it('lists plots submitted by two or more people where non-metadata answers differ', () => {
    const report = overlapReport([
      record('17', 'maria', { summary: { land_use: 'forest', operator: 'maria', saved_on: '1', canopy: '50' } }),
      record('17', 'jose', { summary: { land_use: 'grassland', operator: 'jose', saved_on: '2', canopy: '50' } }),
      record('2', 'maria', { summary: { land_use: 'forest' } }),
      record('2', 'jose', { summary: { land_use: 'forest', collect_time: 'x' } }),
      record('3', 'maria', { summary: { land_use: 'forest' } }),
      record('3', 'jose', { summary: { land_use: 'crop' }, activelySaved: false }),
    ]);
    expect(report.plots).toBe(2);
    expect(report.differing).toBe(1);
    expect(report.items).toEqual([
      { recordKey: '17', operators: ['jose', 'maria'], fields: [{ key: 'land_use', values: { jose: 'grassland', maria: 'forest' } }] },
    ]);
    expect(METADATA_KEY_PARTS).toContain('_time');
  });
});

describe('performance', () => {
  it('divides 100k plots with overlap quickly', () => {
    const plotIds = ids(100_000);
    const started = Date.now();
    const plots = divide(even(['a', 'b', 'c'], { order: 'mixed', seed: 1, overlapPercent: 10 }), plotIds, null, none);
    summarize(null, plotIds, plots, none, new Map());
    expect(plots.filter((p) => !p.overlap)).toHaveLength(100_000);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
