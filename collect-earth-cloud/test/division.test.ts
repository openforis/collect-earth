import { describe, expect, it } from 'vitest';
import {
  copiesSubmittedAsMain,
  copyHoldersOf,
  divide,
  keptBy,
  METADATA_KEY_PARTS,
  moveUnfinished,
  overlapPicks,
  parseDivisionRequest,
  shareSizes,
  shuffled,
  submittedByPlot,
  summarize,
  type SubmittedBy,
  type Submitters,
} from '../src/division.js';
import { nearbyOrder, nearbyRanks } from '../src/nearby.js';
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
    // a did the check of 2 (a main plot): not done. a did the main of 1 (a copy, e.g.
    // both had it on a whole file before it was divided): that is done, a second main
    // assessment, not a check to do again.
    const submitted: SubmittedBy = new Map([
      ['1', { main: new Set(['a']), check: new Set<string>() }],
      ['2', { main: new Set<string>(), check: new Set(['a']) }],
      ['3', { main: new Set(['a']), check: new Set<string>() }],
      ['4', { main: new Set<string>(), check: new Set(['a']) }],
    ]);
    const { plots, moved } = moveUnfinished(holdings, 'a', 'b', submitted);
    expect(moved).toBe(1);
    expect(plots.filter((x) => x.userId === 'a').map((x) => x.plotKey)).toEqual(['1', '3', '4']);
    const s = summarize(null, ids(4), holdings, submitted, new Map([['a', 'ana']]));
    expect(s.people[0]).toMatchObject({ plots: 4, overlap: 2, submitted: 3 });
  });

  it('keeps with `from` a main plot `to` already checked, though `to` no longer holds it', () => {
    // From the property test: b checked p7 (then lost the copy); a holds it as main.
    const holdings: PlotAssignment[] = [
      { plotKey: 'p2', userId: 'a', overlap: false },
      { plotKey: 'p3', userId: 'b', overlap: false },
      { plotKey: 'p7', userId: 'a', overlap: false },
    ];
    const submitted: SubmittedBy = new Map([
      ['p3', { main: new Set(['b']), check: new Set<string>() }],
      ['p7', { main: new Set<string>(), check: new Set(['b']) }],
    ]);
    const result = moveUnfinished(holdings, 'a', 'b', submitted);
    expect(result).toEqual({
      plots: [
        { plotKey: 'p2', userId: 'b', overlap: false },
        { plotKey: 'p3', userId: 'b', overlap: false },
        { plotKey: 'p7', userId: 'a', overlap: false },
      ],
      moved: 1,
      notMoved: 1,
      droppedChecks: 0,
    });
  });

  it('never gives `to` a copy of a plot whose main assessment `to` did', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '1', userId: 'a', overlap: true },
      { plotKey: '1', userId: 'c', overlap: false },
    ];
    const submitted: SubmittedBy = new Map([['1', { main: new Set(['b']), check: new Set<string>() }]]);
    const result = moveUnfinished(holdings, 'a', 'b', submitted);
    expect(result).toEqual({ plots: holdings, moved: 0, notMoved: 1, droppedChecks: 0 });
  });

  it('never moves the copy of someone who did its main assessment', () => {
    // From the property test: c and d both did p8's main assessment; c holds a copy.
    const holdings: PlotAssignment[] = [
      { plotKey: 'p6', userId: 'c', overlap: false },
      { plotKey: 'p8', userId: 'c', overlap: true },
      { plotKey: 'p8', userId: 'd', overlap: false },
    ];
    const submitted = mainBy([['p8', ['c', 'd']]]);
    const result = moveUnfinished(holdings, 'c', 'a', submitted);
    expect(result.plots).toEqual([
      { plotKey: 'p6', userId: 'a', overlap: false },
      { plotKey: 'p8', userId: 'c', overlap: true },
      { plotKey: 'p8', userId: 'd', overlap: false },
    ]);
    expect(result).toMatchObject({ moved: 1, notMoved: 0, droppedChecks: 0 });
    // Moved to d, its main holder, it is not dropped either.
    expect(moveUnfinished(holdings, 'c', 'd', submitted).plots).toContainEqual({ plotKey: 'p8', userId: 'c', overlap: true });
  });

  it('never gives `to` copies of two units of one plot (own round)', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '18,1', userId: 'b', overlap: true },
      { plotKey: '18,1', userId: 'c', overlap: false },
      { plotKey: '18,3', userId: 'a', overlap: true },
      { plotKey: '18,3', userId: 'c', overlap: false },
      { plotKey: '19,1', userId: 'a', overlap: true },
      { plotKey: '19,1', userId: 'c', overlap: false },
    ];
    const plotOf = (unit: string) => unit.split(',')[0];
    const result = moveUnfinished(holdings, 'a', 'b', none, plotOf);
    expect(result.plots).toEqual([
      { plotKey: '18,1', userId: 'b', overlap: true },
      { plotKey: '18,1', userId: 'c', overlap: false },
      { plotKey: '18,3', userId: 'a', overlap: true },
      { plotKey: '18,3', userId: 'c', overlap: false },
      { plotKey: '19,1', userId: 'b', overlap: true },
      { plotKey: '19,1', userId: 'c', overlap: false },
    ]);
    expect(result).toMatchObject({ moved: 1, notMoved: 1, droppedChecks: 0 });
    // Without plotOf every unit is its own plot.
    expect(moveUnfinished(holdings, 'a', 'b', none).moved).toBe(2);
  });
});

describe('divide: copies kept for what people submitted', () => {
  const plotOf = (unit: string) => unit.split(',')[0];

  it('keeps a checker`s copy though they hold a copy of another unit of the plot (own round)', () => {
    // From the property test: b did the main of 5,1 with c (c keeps it), and checked 5,3.
    const submitted: SubmittedBy = new Map([
      ['5,1', { main: new Set(['b', 'c']), check: new Set<string>() }],
      ['5,3', { main: new Set(['c']), check: new Set(['b']) }],
    ]);
    const p = byPerson(divide(even(['c', 'b'], { overlapPercent: 10 }), ['5,1', '5,3'], null, submitted, plotOf));
    expect(p.c.own).toEqual(['5,1', '5,3']);
    expect(p.b.copies).toEqual(['5,1', '5,3']);
  });

  it('picks the overlap copies among units of different plots, so the share is met (own round)', () => {
    const units = ['1,1', '1,2', '1,3', '2,1'];
    const submitted = mainBy(units.map((u) => [u, ['a']]));
    const p = byPerson(divide(even(['a', 'b'], { overlapPercent: 50 }), units, null, submitted, plotOf));
    expect(p.a.own).toEqual(units);
    expect(p.b.copies).toEqual(['1,1', '2,1']);
  });

  it('keeps a second main submitter`s copy of each unit they assessed (own round)', () => {
    // From the property test: e did the main of 2,1 (with c) and of 2,2 (with d).
    const submitted = mainBy([
      ['2,1', ['c', 'e']],
      ['2,2', ['d', 'e']],
    ]);
    const p = byPerson(divide(even(['c', 'd', 'a', 'e']), ['2,1', '2,2'], null, submitted, plotOf));
    expect(p.e.copies).toEqual(['2,1', '2,2']);
  });

  it('gives no new copy of a unit to someone who keeps a copy of another unit of the plot, in any group', () => {
    // x checked 18,3 (group y): that copy stays, and the overlap of group x, where x is
    // the next person after a, gets no copy of 18,1.
    const d = {
      mode: 'column',
      column: 0,
      groups: [
        { value: 'x', people: ['a', 'x'] },
        { value: 'y', people: ['c', 'x'] },
      ],
      order: 'file',
      overlapPercent: 50,
    } satisfies StoredDistribution;
    const submitted: SubmittedBy = new Map([['18,3', { main: new Set<string>(), check: new Set(['x']) }]]);
    const p = byPerson(divide(d, ['18,1', '18,3'], ['x', 'y'], submitted, plotOf));
    expect(p.a.own).toEqual(['18,1']);
    expect(p.c.own).toEqual(['18,3']);
    expect(p.x.copies).toEqual(['18,3']);
  });
});

describe('copies drawn for checks (Task 13) through a new division and a move', () => {
  it('a new division keeps the drawn copies (counted towards the overlap share), unless their holder now holds the plot as main', () => {
    const drawn: PlotAssignment[] = [
      { plotKey: '2', userId: 'cai', overlap: true, sampledAt: 5 },
      { plotKey: '7', userId: 'ana', overlap: true, sampledAt: 5 },
    ];
    // ana and ben share 10 plots: plot 7 becomes ben's (ana's copy stays), plot 2 ana's
    // (cai is not in the division: the copy stays all the same).
    const plots = divide(even(['ana', 'ben'], { overlapPercent: 20 }), ids(10), null, none, undefined, drawn);
    expect(plots.filter((a) => a.sampledAt !== undefined)).toEqual(drawn.slice().sort((x, y) => Number(x.plotKey) - Number(y.plotKey)));
    // The plots with a drawn copy get no other, and count: each list of 5 needs one copy, and has it.
    expect(plots.filter((a) => a.overlap)).toEqual(plots.filter((a) => a.sampledAt !== undefined));
    // A drawn copy whose holder is now dealt the plot as main goes.
    const mine = divide(even(['cai', 'ben']), ids(4), null, none, undefined, drawn);
    expect(mine.filter((a) => a.plotKey === '2')).toEqual([{ plotKey: '2', userId: 'cai', overlap: false }]);
    // A copy kept for a check its holder submitted remembers it was drawn.
    const checked = new Map([['7', { main: new Set<string>(), check: new Set(['ana']) }]]);
    const kept = divide(even(['ana', 'ben']), ids(10), null, checked, undefined, drawn);
    expect(kept.filter((a) => a.plotKey === '7')).toEqual([
      { plotKey: '7', userId: 'ana', overlap: true, sampledAt: 5 },
      { plotKey: '7', userId: 'ben', overlap: false },
    ]);
  });

  it('a move keeps a drawn copy drawn; the summary counts them apart', () => {
    const holdings: PlotAssignment[] = [
      { plotKey: '1', userId: 'ana', overlap: false },
      { plotKey: '2', userId: 'ben', overlap: false },
      { plotKey: '2', userId: 'ana', overlap: true, sampledAt: 9 },
      { plotKey: '1', userId: 'ben', overlap: true },
    ];
    const { plots } = moveUnfinished(holdings, 'ana', 'cai', none);
    expect(plots).toContainEqual({ plotKey: '2', userId: 'cai', overlap: true, sampledAt: 9 });
    const summary = summarize({ mode: 'manual' }, ids(2), holdings, none, new Map([['ana', 'ana'], ['ben', 'ben']]));
    expect(summary.people.map((p) => [p.username, p.plots, p.overlap, p.sampled])).toEqual([
      ['ana', 2, 1, 1],
      ['ben', 2, 1, 0],
    ]);
  });
});

describe('divide: plots close on the map together (order nearby, Task 15)', () => {
  type Places = Map<string, readonly [number, number]>;
  /** A side × side grid of plots 0.001° apart near the equator; ids 1.. in a seeded order of the file. */
  const grid = (side: number, fileSeed: number | null = null) => {
    const cells: { id: string; place: [number, number] }[] = [];
    for (let r = 0; r < side; r++) for (let c = 0; c < side; c++) cells.push({ id: `${r}:${c}`, place: [r * 0.001, c * 0.001] });
    const inFile = fileSeed === null ? cells : shuffled(cells, fileSeed);
    return { plotIds: inFile.map((c) => c.id), places: new Map(inFile.map((c) => [c.id, c.place])) as Places };
  };
  /** The area of each person's bounding box (main plots), in grid cells. */
  const boxes = (plots: PlotAssignment[]) => {
    const extent = new Map<string, [number, number, number, number]>();
    for (const a of plots.filter((p) => !p.overlap)) {
      const [r, c] = a.plotKey.split(':').map(Number);
      const e = extent.get(a.userId) ?? [r, r, c, c];
      extent.set(a.userId, [Math.min(e[0], r), Math.max(e[1], r), Math.min(e[2], c), Math.max(e[3], c)]);
    }
    return new Map([...extent].map(([u, [r0, r1, c0, c1]]) => [u, (r1 - r0 + 1) * (c1 - c0 + 1)]));
  };
  const total = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

  it('gives each of four people one quarter of a square grid', () => {
    const { plotIds, places } = grid(32, 7);
    const plots = divide(even(['a', 'b', 'c', 'd'], { order: 'nearby' }), plotIds, null, none, undefined, [], nearbyRanks(plotIds, places));
    const own = byPerson(plots);
    expect(Object.values(own).map((p) => p.own.length)).toEqual([256, 256, 256, 256]);
    // A quarter of the curve is a quadrant: 16 × 16 cells each.
    expect([...boxes(plots).values()]).toEqual([256, 256, 256, 256]);
  });

  it('each share`s bounding box is smaller than with mixed (and than file order of a file not sorted by place)', () => {
    const { plotIds, places } = grid(30, 3);
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const nearby = boxes(divide(even(people, { order: 'nearby' }), plotIds, null, none, undefined, [], nearbyRanks(plotIds, places)));
    const mixed = boxes(divide(even(people, { order: 'mixed', seed: 11 }), plotIds, null, none));
    const file = boxes(divide(even(people), plotIds, null, none));
    for (const p of people) {
      expect(nearby.get(p)!).toBeLessThan(mixed.get(p)!);
      expect(nearby.get(p)!).toBeLessThan(file.get(p)!);
    }
    // Together they cover the grid about once (900 cells), the mixed shares the whole grid each.
    expect(total(nearby)).toBeLessThan(900 * 1.6);
    expect(total(mixed)).toBeGreaterThan(900 * 6);
  });

  it('is the same every time; plots without a place go last, after the curve', () => {
    const { plotIds, places } = grid(10, 5);
    places.delete(plotIds[0]);
    places.delete(plotIds[1]);
    const d = even(['a', 'b'], { order: 'nearby' });
    const first = divide(d, plotIds, null, none, undefined, [], nearbyRanks(plotIds, places));
    expect(divide(d, plotIds, null, none, undefined, [], nearbyRanks(plotIds, places))).toEqual(first);
    // The last person's share ends with the two plots without a place.
    expect(byPerson(first).b.own).toEqual(expect.arrayContaining([plotIds[0], plotIds[1]]));
  });

  it('follows the curve within each group of a column division', () => {
    const { plotIds, places } = grid(16, 9);
    // Column values: the left half "W", the right half "E".
    const values = plotIds.map((id) => (Number(id.split(':')[1]) < 8 ? 'W' : 'E'));
    const d: StoredDistribution & { mode: 'column' } = {
      mode: 'column',
      column: 1,
      groups: [{ value: 'W', people: ['a', 'b'] }, { value: 'E', people: ['c', 'd'] }],
      order: 'nearby',
      overlapPercent: 0,
    };
    const plots = divide(d, plotIds, values, none, undefined, [], nearbyRanks(plotIds, places));
    const area = boxes(plots);
    // Each half (8 × 16) is split in two compact areas of 64 plots: 8 × 8.
    expect([...area.values()]).toEqual([64, 64, 64, 64]);
    const own = byPerson(plots);
    expect(own.a.own.every((id) => Number(id.split(':')[1]) < 8)).toBe(true);
    expect(own.c.own.every((id) => Number(id.split(':')[1]) >= 8)).toBe(true);
  });

  it('keeps the drawn copies; the overlap copies are spread through each share along the curve', () => {
    const { plotIds, places } = grid(8, 2);
    const curve = nearbyOrder(plotIds, places);
    const drawn: PlotAssignment[] = [{ plotKey: curve[40], userId: 'c', overlap: true, sampledAt: 4 }];
    const plots = divide(even(['a', 'b'], { order: 'nearby', overlapPercent: 10 }), plotIds, null, none, undefined, drawn, nearbyRanks(plotIds, places));
    expect(plots).toContainEqual({ plotKey: curve[40], userId: 'c', overlap: true, sampledAt: 4 });
    // a holds the first half of the curve, b the second.
    expect(byPerson(plots).a.own.sort()).toEqual(curve.slice(0, 32).sort());
    // Each share of 32 needs ceil(3.2) = 4 copies. a's go to b, every 8th plot along the curve.
    expect(byPerson(plots).b.copies.map((id) => curve.indexOf(id)).sort((x, y) => x - y)).toEqual([0, 8, 16, 24]);
    // b's share has the drawn copy, which counts: 3 more go to a, spread over the other 31.
    expect(byPerson(plots).a.copies).toHaveLength(3);
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

describe('copiesSubmittedAsMain', () => {
  it('lists the copies whose main assessment the person submitted (own round with a code)', () => {
    const own: RoundInfo = {
      state: 'own', refusal: null, keyCount: 2, roundIndex: 1,
      roundCodes: [{ code: '1', label: 'One' }, { code: '2', label: 'Two' }, { code: '3', label: 'Three' }],
      reassessmentCode: '2',
    };
    const plots = { plotKeys: ['17,1', '18,1', '18,3', '19,1'], copyKeys: ['18,1', '18,3', '19,1'] };
    const records = [
      record('18,1', 'jose'), // main of a copy
      record('18,2', 'jose'), // a check: goes to one of the copies of plot 18
      record('19,1', 'ana'), // someone else's
      record('17,1', 'jose'), // main of a main plot
      record('19,1', 'jose', { activelySaved: false }), // not submitted
    ];
    expect(copiesSubmittedAsMain(records, 'u2', 'jose', plots, own)).toEqual(new Set(['18,1']));
    expect(copiesSubmittedAsMain(records, 'u2', 'jose', { ...plots, copyKeys: [] }, own)).toEqual(new Set());
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

  it('accepts order nearby, without a seed (the curve needs none)', () => {
    expect(parse({ mode: 'even', people: ['a'], order: 'nearby', seed: 5 })).toEqual({ mode: 'even', people: ['a'], order: 'nearby', overlapPercent: 0 });
    expect(parse({ mode: 'column', column: 1, groups: [{ value: 'x', people: ['b'] }], order: 'nearby' })).toMatchObject({ order: 'nearby' });
    expect(parse({ mode: 'even', people: ['a'], order: 'map' })).toEqual({ reason: "order must be 'file', 'mixed' or 'nearby'" });
  });
});

describe('METADATA_KEY_PARTS', () => {
  it('names the bookkeeping parts a key unknown to the outline is never compared on', () => {
    expect(METADATA_KEY_PARTS).toEqual(expect.arrayContaining(['operator', 'saved_on', '_time']));
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

  it('divides 100k plots in order nearby quickly', () => {
    const plotIds = ids(100_000);
    // Plots over Ghana in a seeded order of the file.
    const random = shuffled(plotIds, 4);
    const places = new Map(random.map((id, i) => [id, [5 + (i % 316) * 0.01, -2 + Math.floor(i / 316) * 0.01] as const]));
    const started = performance.now();
    const plots = divide(even(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], { order: 'nearby', overlapPercent: 10 }), plotIds, null, none, undefined, [], nearbyRanks(plotIds, places));
    const took = performance.now() - started;
    expect(plots.filter((p) => !p.overlap)).toHaveLength(100_000);
    console.log(`divide nearby, 100,000 plots, 8 people, 10 % overlap: ${took.toFixed(0)} ms`);
    expect(took).toBeLessThan(3000);
  });
});

describe('keptBy: a check begun stays with its copy when checks have no key of their own (B3)', () => {
  const row = (recordKey: string, operator: string, activelySaved: boolean, deleted = false): RecordRow =>
    ({ projectId: 'p', recordKey, operator, modifiedOn: 1, receivedAt: 1, activelySaved, step: 1, xml: null, summary: {}, deleted, deletedOn: null }) as RecordRow;
  const holdings: PlotAssignment[] = [
    { plotKey: '1', userId: 'u-ana', overlap: false },
    { plotKey: '2', userId: 'u-ana', overlap: false },
    { plotKey: '1', userId: 'u-ben', overlap: true },
    { plotKey: '2', userId: 'u-ben', overlap: true },
  ];
  const users = new Map([['ana', 'u-ana'], ['ben', 'u-ben']]);
  const copyHolders = copyHoldersOf(holdings, new Map([['u-ana', 'ana'], ['u-ben', 'ben']]));
  const plots = new Set(['1', '2']);
  // ben began the check of plot 1 (a draft "1"); plot 2's draft was deleted.
  const records = [row('1', 'ana', true), row('2', 'ana', true), row('1', 'ben', false), row('2', 'ben', false, true)];

  it('no round in the keys: the draft keeps the copy with its holder in a move; the summary counts stay those submitted', () => {
    const submitted = submittedByPlot(records, plots, users, null, copyHolders);
    const kept = keptBy(submitted, records, plots, users, null, copyHolders);
    expect([...(kept.get('1')?.check ?? [])]).toEqual(['u-ben']);
    expect(kept.get('2')?.check.size ?? 0).toBe(0);
    expect(submitted.get('1')?.check.size ?? 0).toBe(0);
    const moved = moveUnfinished(holdings, 'u-ben', 'u-cai', kept);
    expect(moved.plots.filter((a) => a.overlap).map((a) => `${a.plotKey}:${a.userId}`).sort()).toEqual(['1:u-ben', '2:u-cai']);
  });

  it('a round the server added (checks keyed "1,2"): nothing more is kept', () => {
    const added: RoundInfo = { state: 'added', refusal: null, keyCount: 2, roundIndex: 1, roundCodes: [{ code: '1', label: '1' }, { code: '2', label: '2' }], reassessmentCode: '2' };
    const withRound = [row('1,1', 'ana', true), row('1,2', 'ben', false)];
    const submitted = submittedByPlot(withRound, plots, users, added, copyHolders);
    expect(keptBy(submitted, withRound, plots, users, added, copyHolders)).toBe(submitted);
  });
});
