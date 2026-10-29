import { describe, expect, it } from 'vitest';
import {
  copyHoldersOf,
  divide,
  METADATA_KEY_PARTS,
  moveUnfinished,
  overlapPicks,
  overlapReport,
  parseDivisionRequest,
  shareSizes,
  submittedByPlot,
  summarize,
  type SubmittedBy,
  type Submitters,
} from '../src/division.js';
import type { RoundInfo } from '../src/cep.js';
import type { PlotAssignment, RecordRow, StoredDistribution } from '../src/types.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
const none: SubmittedBy = new Map();
/** Plots whose main assessment these people submitted. */
const mainBy = (entries: [string, string[]][]): SubmittedBy =>
  new Map(entries.map(([plot, users]) => [plot, { main: new Set(users), check: new Set<string>() }]));

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
    const submitted = mainBy(['1', '2', '3', '4'].map((k) => [k, ['b']]));
    const p = byPerson(divide(even(['a', 'b', 'c']), ids(9), null, submitted));
    expect(p.b.own).toEqual(['1', '2', '3', '4']);
    expect(p.a.own).toHaveLength(3);
    expect(p.c.own).toHaveLength(2);
  });

  it('keeps a plot done by someone not among the people with them, and deals the rest', () => {
    const outsider = mainBy([['1', ['z']]]);
    const plots = divide(even(['a', 'b']), ids(4), null, outsider);
    const p = byPerson(plots);
    expect(p.z).toEqual({ own: ['1'], copies: [] });
    expect(p.a.own).toEqual(['2', '3']);
    expect(p.b.own).toEqual(['4']);
    const s = summarize(null, ids(4), plots, outsider, new Map([['a', 'ana'], ['b', 'bea'], ['z', 'zoe']]));
    expect(s.unassigned).toBe(0);
    expect(s.people.find((x) => x.userId === 'z')).toMatchObject({ plots: 1, submitted: 1 });
    // Two people outside did it: the first keeps it, the other a copy.
    const two = byPerson(divide(even(['a']), ids(2), null, mainBy([['1', ['z', 'y']]])));
    expect(two.y).toEqual({ own: ['1'], copies: [] });
    expect(two.z).toEqual({ own: [], copies: ['1'] });
  });

  it('keeps a plot with whoever did its main assessment; the checker keeps a copy', () => {
    // jose did plot 1's main assessment and maria its check: dividing again between
    // [maria, jose] must not make maria the main holder.
    const submitted: SubmittedBy = new Map([['1', { main: new Set(['jose']), check: new Set(['maria']) }]]);
    const p = byPerson(divide(even(['maria', 'jose']), ids(4), null, submitted));
    expect(p.jose.own).toContain('1');
    expect(p.maria.own).not.toContain('1');
    expect(p.maria.copies).toEqual(['1']);
  });

  it('never makes a checker the main holder: the plot goes to someone who did not check it', () => {
    const checked = (plot: string, users: string[]): [string, Submitters] => [plot, { main: new Set<string>(), check: new Set(users) }];
    // Jose, first in turn, checked plot 1: maria gets it; jose keeps his copy.
    const p = byPerson(divide(even(['jose', 'maria']), ids(4), null, new Map([checked('1', ['jose'])])));
    expect(p.maria.own).toEqual(['1', '4']);
    expect(p.jose.own).toEqual(['2', '3']);
    expect(p.jose.copies).toEqual(['1']);
    // Everyone with room checked it: the one who did not, even over their share.
    const full: SubmittedBy = new Map([['1', { main: new Set(['a']), check: new Set<string>() }], checked('2', ['b'])]);
    const f = byPerson(divide(even(['a', 'b']), ids(2), null, full));
    expect(f.a.own).toEqual(['1', '2']);
    expect(f.b).toEqual({ own: [], copies: ['2'] });
    // Everyone checked it: nobody gets it as main, and it counts as unassigned.
    const all = new Map([checked('1', ['a', 'b'])]);
    const plots = divide(even(['a', 'b']), ids(3), null, all);
    const q = byPerson(plots);
    expect([...q.a.own, ...q.b.own].sort()).toEqual(['2', '3']);
    expect(q.a.copies).toEqual(['1']);
    expect(q.b.copies).toEqual(['1']);
    expect(summarize(null, ids(3), plots, all, new Map([['a', 'ana'], ['b', 'bea']])).unassigned).toBe(1);
  });

  it('gives nobody copies of two units of the same plot (a survey with its own round)', () => {
    const units = ['18,1', '18,3', '17,1', '17,3'];
    const d = even(['a', 'b'], { overlapPercent: 100 });
    const plotOf = (unit: string) => unit.split(',')[0];
    const p = byPerson(divide(d, units, null, none, plotOf));
    expect(p.b.copies).toEqual(['18,1']);
    expect(p.a.copies).toEqual(['17,1']);
    // Without plotOf every unit is its own plot.
    expect(byPerson(divide(d, units, null, none)).b.copies).toEqual(['18,1', '18,3']);
  });

  it('adds no second copy to a plot that already has its checker`s copy', () => {
    // a did plot 1's main assessment, c its check; a's quality-check share is that copy.
    const submitted: SubmittedBy = new Map([['1', { main: new Set(['a']), check: new Set(['c']) }]]);
    const p = byPerson(divide(even(['a', 'b', 'c'], { overlapPercent: 50 }), ids(6), null, submitted));
    expect(p.a.own).toEqual(['1', '2']);
    expect(p.c.copies).toContain('1');
    expect(p.b.copies).toEqual([]);
    // Without the check, b gets a copy of one of a's plots.
    expect(byPerson(divide(even(['a', 'b', 'c'], { overlapPercent: 50 }), ids(6), null, none)).b.copies).toEqual(['1']);
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
    const { plots, moved, notMoved, droppedChecks } = moveUnfinished(holdings, 'a', 'b', mainBy([['1', ['a']]]));
    // a's copy of 3 goes: b, its main holder, does not check their own plot.
    expect({ moved, notMoved, droppedChecks }).toEqual({ moved: 1, notMoved: 0, droppedChecks: 1 });
    expect(plots).toEqual([
      { plotKey: '1', userId: 'a', overlap: false },
      { plotKey: '2', userId: 'b', overlap: false },
      { plotKey: '3', userId: 'b', overlap: false },
      { plotKey: '4', userId: 'c', overlap: false },
    ]);
  });

  it('makes `to`s copy the main holding, unless `to` already did the check', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '1', userId: 'a', overlap: false },
      { plotKey: '1', userId: 'b', overlap: true },
      { plotKey: '2', userId: 'a', overlap: false },
      { plotKey: '2', userId: 'b', overlap: true },
    ];
    const submitted: SubmittedBy = new Map([['2', { main: new Set<string>(), check: new Set(['b']) }]]);
    const result = moveUnfinished(holdings, 'a', 'b', submitted);
    expect(result).toEqual({
      plots: [
        { plotKey: '1', userId: 'b', overlap: false },
        { plotKey: '2', userId: 'a', overlap: false },
        { plotKey: '2', userId: 'b', overlap: true },
      ],
      moved: 1,
      notMoved: 1,
      droppedChecks: 0,
    });
    // The input is not changed.
    expect(holdings[1]).toEqual({ plotKey: '1', userId: 'b', overlap: true });
  });

  it('counts a holding done only by what it asks for: the main assessment, or the check of a copy', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '1', userId: 'a', overlap: true },
      { plotKey: '2', userId: 'a', overlap: false },
      { plotKey: '3', userId: 'a', overlap: false },
      { plotKey: '4', userId: 'a', overlap: true },
    ];
    // a did the main of 1 (a copy) and the check of 2 (a main plot): neither is done.
    const submitted: SubmittedBy = new Map([
      ['1', { main: new Set(['a']), check: new Set<string>() }],
      ['2', { main: new Set<string>(), check: new Set(['a']) }],
      ['3', { main: new Set(['a']), check: new Set<string>() }],
      ['4', { main: new Set<string>(), check: new Set(['a']) }],
    ]);
    const { plots, moved } = moveUnfinished(holdings, 'a', 'b', submitted);
    expect(moved).toBe(2);
    expect(plots.filter((x) => x.userId === 'a').map((x) => x.plotKey)).toEqual(['3', '4']);
    const s = summarize(null, ids(4), holdings, submitted, new Map([['a', 'ana']]));
    expect(s.people[0]).toMatchObject({ plots: 4, overlap: 2, submitted: 2 });
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
      null,
    );
    expect([...map.entries()]).toEqual([['1', { main: new Set(['u1']), check: new Set() }]]);
  });

  it('with the round the server added, the main record and the check record both belong to the plot', () => {
    const added: RoundInfo = {
      state: 'added', refusal: null, keyCount: 2, roundIndex: 1,
      roundCodes: [{ code: '1', label: 'First' }, { code: '2', label: 'Again' }], reassessmentCode: '2',
    };
    const map = submittedByPlot(
      [record('17,1', 'maria'), record('17,2', 'jose'), record('170,1', 'maria'), record('17x,1', 'jose')],
      new Set(['17']),
      new Map([['maria', 'u1'], ['jose', 'u2']]),
      added,
    );
    expect([...map.entries()]).toEqual([['17', { main: new Set(['u1']), check: new Set(['u2']) }]]);
  });

  it('without round in the key, the person holding a copy did the check', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '17', userId: 'u1', overlap: false },
      { plotKey: '17', userId: 'u2', overlap: true },
      // Holding a plot both ways is not a copy only.
      { plotKey: '18', userId: 'u1', overlap: false },
      { plotKey: '18', userId: 'u1', overlap: true },
    ];
    const copies = copyHoldersOf(holdings, new Map([['u1', 'maria'], ['u2', 'jose']]));
    expect([...copies.entries()]).toEqual([['17', new Set(['jose'])]]);
    const map = submittedByPlot(
      [record('17', 'maria'), record('17', 'jose'), record('18', 'maria')],
      new Set(['17', '18']),
      new Map([['maria', 'u1'], ['jose', 'u2']]),
      null,
      copies,
    );
    expect(map.get('17')).toEqual({ main: new Set(['u1']), check: new Set(['u2']) });
    expect(map.get('18')).toEqual({ main: new Set(['u1']), check: new Set() });
  });

  it('own round with a reassessment code: a check record goes to the round the checker holds as a copy', () => {
    const own: RoundInfo = {
      state: 'own', refusal: null, keyCount: 2, roundIndex: 1,
      roundCodes: [{ code: '1', label: 'One' }, { code: '2', label: 'Two' }, { code: '3', label: 'Three' }],
      reassessmentCode: '2',
    };
    const copies = copyHoldersOf([{ plotKey: '18,3', userId: 'u2', overlap: true }], new Map([['u2', 'jose']]));
    const map = submittedByPlot(
      [record('18,2', 'jose'), record('18,2', 'ana')],
      new Set(['18,1', '18,3']),
      new Map([['jose', 'u2'], ['ana', 'u3']]),
      own,
      copies,
    );
    expect(map.get('18,3')).toEqual({ main: new Set(), check: new Set(['u2']) });
    // Someone holding no copy of the plot: the first round in the file.
    expect(map.get('18,1')).toEqual({ main: new Set(), check: new Set(['u3']) });
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
