import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { qualityFigures } from '../src/answerStats.js';
import { MIN_PLOTS, qualityReport, type QualityInput, type QualityRecord } from '../src/quality.js';
import {
  checkMark,
  MAX_REFERENCE_PLOTS,
  NO_REFERENCE,
  parsePlotList,
  judgedReference,
  personAccuracy,
  pickReference,
  splitListedPlots,
  referenceCopyPlan,
  referenceFigures,
} from '../src/reference.js';
import type { Question } from '../src/surveyOutline.js';
import type { Member, PlotAssignment, ReferencePlot } from '../src/types.js';

const added: RoundInfo = {
  state: 'added',
  refusal: null,
  keyCount: 2,
  roundIndex: 1,
  roundCodes: [
    { code: '1', label: 'First assessment' },
    { code: '2', label: 'Re-assessment' },
  ],
  reassessmentCode: '2',
};
const none: RoundInfo = { state: 'none', refusal: 'several_keys', keyCount: 1, roundIndex: null, roundCodes: [], reassessmentCode: null };

function question(key: string, kind: Question['kind'], extra: Partial<Question> = {}): Question {
  return { key, label: key, kind, options: kind === 'choice' ? [] : null, help: null, excluded: false, multiple: false, calculated: false, ...extra };
}

const outline = new Map<string, Question>(
  [question('collect_code_land_use', 'choice', { label: 'Land use' }), question('collect_real_canopy', 'number', { label: 'Canopy' }), question('collect_text_notes', 'text')].map(
    (q) => [q.key, q],
  ),
);

const day = Date.UTC(2026, 10, 2, 12);

function rec(recordKey: string, operator: string, summary: Record<string, string>, extra: Partial<QualityRecord> = {}): QualityRecord {
  return { recordKey, operator, summary, modifiedOn: day, activelySaved: true, deleted: false, ...extra };
}

/**
 * `n` reference plots r1..rn assessed by coord (round 1), each checked by ana (round 2) agreeing
 * on land use for the first `agree`; plus `ordinary` plots p1.. assessed by ana and checked by ben,
 * all differing.
 */
function project(n: number, agree: number, ordinary = 0): QualityInput {
  const records: QualityRecord[] = [];
  const units = new Set<string>();
  const reference = new Map<string, string>();
  for (let i = 1; i <= n; i++) {
    units.add(`r${i}`);
    reference.set(`r${i}`, 'coord');
    records.push(rec(`r${i},1`, 'coord', { collect_code_land_use: 'forest', collect_real_canopy: '50', collect_text_notes: 'mine' }));
    records.push(rec(`r${i},2`, 'ana', { collect_code_land_use: i <= agree ? 'forest' : 'grassland', collect_real_canopy: '54', collect_text_notes: 'other' }));
  }
  for (let i = 1; i <= ordinary; i++) {
    units.add(`p${i}`);
    records.push(rec(`p${i},1`, 'ana', { collect_code_land_use: 'forest' }));
    records.push(rec(`p${i},2`, 'ben', { collect_code_land_use: 'cropland' }));
  }
  return { records, info: added, units, copyHolders: new Map(), outline, margins: {}, reference };
}

describe('referenceFigures: accuracy against the reference', () => {
  it('measures each check of a reference plot against the reference, per person and per question', () => {
    const figures = referenceFigures(project(MIN_PLOTS, 15));
    expect(figures).toMatchObject({ plots: 20, assessed: 20, checks: 20 });
    expect(figures.questions.map((q) => q.key)).toEqual(['collect_code_land_use', 'collect_real_canopy']);
    expect(figures.questions[0]).toMatchObject({ label: 'Land use', kind: 'choice', compared: 20, agreeing: 15, rate: 0.75 });
    // 54 against 50 is within the default 10 % margin.
    expect(figures.questions[1]).toMatchObject({ kind: 'number', compared: 20, agreeing: 20, rate: 1 });
    expect(figures.people).toEqual([
      {
        username: 'ana',
        plots: { compared: 20, agreeing: 15, rate: 0.75 },
        // Their answers, not their plots: two questions on each of 20 plots, five land uses wrong.
        answers: { compared: 40, agreeing: 35 },
        // All submitted at the same time: the order of the records, so the last ten are r11..r20.
        recent: { compared: 20, agreeing: 15 },
        earlier: { compared: 20, agreeing: 20 },
        questions: [
          { key: 'collect_code_land_use', label: 'Land use', compared: 20, agreeing: 15, rate: 0.75 },
          { key: 'collect_real_canopy', label: 'Canopy', compared: 20, agreeing: 20, rate: 1 },
        ],
      },
    ]);
    expect(personAccuracy(figures, 'ana')?.plots.rate).toBe(0.75);
    expect(personAccuracy(figures, 'ben')).toBeNull();
  });

  it('uses the margins: a number outside the margin does not match', () => {
    const figures = referenceFigures({ ...project(MIN_PLOTS, MIN_PLOTS), margins: { collect_real_canopy: 5 } });
    expect(figures.questions[1]).toMatchObject({ compared: 20, agreeing: 0, rate: 0 });
    expect(figures.people[0].plots).toEqual({ compared: 20, agreeing: 0, rate: 0 });
  });

  it('gives no rate under MIN_PLOTS plots ("too few plots to judge")', () => {
    const figures = referenceFigures(project(MIN_PLOTS - 1, MIN_PLOTS - 1));
    expect(figures.people[0].plots).toEqual({ compared: 19, agreeing: 19, rate: null });
    expect(figures.questions[0].rate).toBeNull();
  });

  it('measures only plots whose reference is submitted; drafts and deleted records do not count', () => {
    const input = project(3, 3);
    const records = input.records.map((r) => {
      if (r.recordKey === 'r1,1') return { ...r, activelySaved: false };
      if (r.recordKey === 'r2,2') return { ...r, deleted: true };
      return r;
    });
    const figures = referenceFigures({ ...input, records });
    expect(figures).toMatchObject({ plots: 3, assessed: 2, checks: 1 });
    expect(figures.byPlot).toEqual([
      { plot: 'r1', assessor: 'coord', assessed: false, checks: 1, agreeing: 0 },
      { plot: 'r2', assessor: 'coord', assessed: true, checks: 0, agreeing: 0 },
      { plot: 'r3', assessor: 'coord', assessed: true, checks: 1, agreeing: 1 },
    ]);
  });

  it('takes each person\'s check once, and never against a first assessment by someone else', () => {
    const input = project(1, 0);
    const records = [
      ...input.records,
      rec('r1,2', 'ben', { collect_code_land_use: 'forest', collect_real_canopy: '50' }, { modifiedOn: day - 1000 }),
      // A main record by someone other than the assessor is no reference.
      rec('r1,1', 'eve', { collect_code_land_use: 'grassland' }, { modifiedOn: day + 5000 }),
    ];
    const figures = referenceFigures({ ...input, records });
    expect(figures.checks).toBe(2);
    expect(personAccuracy(figures, 'ben')?.plots).toEqual({ compared: 1, agreeing: 1, rate: null });
    expect(personAccuracy(figures, 'ana')?.plots).toEqual({ compared: 1, agreeing: 0, rate: null });
  });

  it('reads checks by their copy without a round (copyHolders), as the agreement figures do', () => {
    const records = [rec('7', 'coord', { collect_code_land_use: 'forest' }), rec('7', 'ana', { collect_code_land_use: 'forest' })];
    const figures = referenceFigures({
      records,
      info: none,
      units: new Set(['7']),
      copyHolders: new Map([['7', new Set(['ana'])]]),
      outline,
      reference: new Map([['7', 'coord']]),
    });
    expect(figures).toMatchObject({ plots: 1, assessed: 1, checks: 1 });
    expect(figures.people[0]).toMatchObject({ username: 'ana', plots: { compared: 1, agreeing: 1 } });
  });

  it('a check with no compared question (blank where the reference is blank) is not counted, least of all as agreeing', () => {
    const records = [
      rec('r1,1', 'coord', { collect_code_land_use: 'forest' }),
      rec('r1,2', 'ana', { collect_code_land_use: 'forest' }),
      rec('r2,1', 'coord', { collect_code_land_use: '' }),
      rec('r2,2', 'ana', { collect_code_land_use: '', collect_text_notes: 'only text' }),
    ];
    const figures = referenceFigures({ records, info: added, units: new Set(['r1', 'r2']), copyHolders: new Map(), outline, reference: new Map([['r1', 'coord'], ['r2', 'coord']]) });
    expect(figures.checks).toBe(1);
    expect(figures.people[0].plots).toEqual({ compared: 1, agreeing: 1, rate: null });
    expect(figures.byPlot.map((p) => p.checks)).toEqual([1, 1]);
  });

  it('an own round with a reassessment code: the check under the code is measured, and left out of the agreement', () => {
    const own: RoundInfo = { state: 'own', refusal: null, keyCount: 2, roundIndex: 1, roundCodes: [{ code: '2025', label: '2025' }, { code: 'R', label: 'R' }], reassessmentCode: 'R' };
    const records = [
      rec('17,2025', 'coord', { collect_code_land_use: 'forest' }),
      rec('17,R', 'ana', { collect_code_land_use: 'grassland' }),
      rec('18,2025', 'maria', { collect_code_land_use: 'forest' }),
      rec('18,R', 'ben', { collect_code_land_use: 'grassland' }),
    ];
    const input: QualityInput = {
      records,
      info: own,
      units: new Set(['17,2025', '18,2025']),
      copyHolders: new Map([['17,2025', new Set(['ana'])], ['18,2025', new Set(['ben'])]]),
      outline,
      reference: new Map([['17,2025', 'coord']]),
    };
    const figures = referenceFigures(input);
    expect(figures).toMatchObject({ plots: 1, assessed: 1, checks: 1 });
    expect(figures.people).toEqual([expect.objectContaining({ username: 'ana', plots: { compared: 1, agreeing: 0, rate: null } })]);
    const report = qualityReport(input);
    expect(report.plotsChecked).toBe(1);
    expect(report.differences.map((d) => d.plot)).toEqual(['18,2025']);
  });

  it('is empty without reference plots', () => {
    expect(referenceFigures(project(0, 0, 3))).toEqual(NO_REFERENCE);
  });
});

/**
 * Reference plots r1..rn assessed by coord as forest, canopy 50, each checked by every collector of `answers`:
 * `answers[name](i)` is that collector's land use on plot i (1-based), or null for no check of it.
 */
function shared(n: number, answers: Record<string, (i: number) => string | null>, reference: (i: number) => string | null = () => 'forest'): QualityInput {
  const records: QualityRecord[] = [];
  const units = new Set<string>();
  const marked = new Map<string, string>();
  for (let i = 1; i <= n; i++) {
    units.add(`r${i}`);
    marked.set(`r${i}`, 'coord');
    const ref = reference(i);
    if (ref !== null) records.push(rec(`r${i},1`, 'coord', { collect_code_land_use: ref, collect_real_canopy: '50' }));
    for (const [name, answer] of Object.entries(answers)) {
      const value = answer(i);
      // Submitted one minute after the other, plot after plot: the order of "their latest checks".
      if (value !== null) records.push(rec(`r${i},2`, name, { collect_code_land_use: value, collect_real_canopy: '50' }, { firstSubmittedOn: day + i * 60_000 }));
    }
  }
  return { records, info: added, units, copyHolders: new Map(), outline, margins: {}, reference: marked };
}

describe('referenceFigures: the collectors among themselves on the reference plots', () => {
  it('counts the pairs of collectors giving the same answer, per choice question, with Fleiss\' kappa', () => {
    // Four plots, three collectors: all the same on r1 and r2, two against one on r3, all different on r4.
    const figures = referenceFigures(
      shared(4, {
        ana: (i) => (i === 4 ? 'cropland' : 'forest'),
        ben: (i) => (i === 4 ? 'wetland' : 'forest'),
        cleo: (i) => (i <= 2 ? 'forest' : 'grassland'),
      }),
    );
    // Numbers are not answers one can agree on by naming them: only the choice question is there.
    expect(figures.among.map((a) => a.key)).toEqual(['collect_code_land_use']);
    // 3 pairs a plot: 3 + 3 same, 1 of 3, 0 of 3.
    expect(figures.among[0]).toMatchObject({ label: 'Land use', plots: 4, compared: 12, agreeing: 7 });
    expect(figures.among[0].kappa).not.toBeNull();
    expect(figures.among[0].kappa!).toBeGreaterThan(0);
    expect(figures.among[0].kappa!).toBeLessThan(7 / 12);
  });

  it('is measured before the reference is assessed, and not with a single collector on a plot', () => {
    const figures = referenceFigures(shared(3, { ana: () => 'forest', ben: (i) => (i === 3 ? null : 'forest') }, () => null));
    expect(figures.assessed).toBe(0);
    expect(figures.people).toEqual([]);
    // r3 has ana alone: no pair
    expect(figures.among[0]).toMatchObject({ plots: 2, compared: 2, agreeing: 2 });
    expect(figures.doubtful).toEqual([]);
  });

  it('puts a reference answer in doubt when more than half of at least three collectors give one other answer', () => {
    const figures = referenceFigures(
      shared(5, {
        // r1: all three say grassland against forest. r2: two of three. r3: one of three (the reference stands).
        // r4: a tie of two answers among four (no majority). r5: two collectors only (too few).
        ana: (i) => (i === 5 ? 'grassland' : i === 3 ? 'forest' : 'grassland'),
        ben: (i) => (i === 1 || i === 2 || i === 5 ? 'grassland' : i === 4 ? 'grassland' : 'forest'),
        cleo: (i) => (i === 5 ? null : i === 1 ? 'grassland' : i === 4 ? 'cropland' : i === 3 ? 'grassland' : 'forest'),
        dan: (i) => (i === 4 ? 'cropland' : null),
      }),
    );
    expect(figures.doubtful).toEqual([
      { plot: 'r1', assessor: 'coord', key: 'collect_code_land_use', label: 'Land use', reference: 'forest', majority: 'grassland', count: 3, of: 3 },
      { plot: 'r2', assessor: 'coord', key: 'collect_code_land_use', label: 'Land use', reference: 'forest', majority: 'grassland', count: 2, of: 3 },
    ]);
    expect(figures.doubtfulTotal).toBe(2);
    // How many checks of each plot agree with the reference on everything.
    expect(figures.byPlot.map((p) => [p.plot, p.checks, p.agreeing])).toEqual([
      ['r1', 3, 0],
      ['r2', 3, 1],
      ['r3', 3, 2],
      ['r4', 4, 0],
      ['r5', 2, 0],
    ]);
  });

  it('a majority agreeing with the reference is no doubt, nor one the reference left blank where they all agree on it', () => {
    const agreed = referenceFigures(shared(1, { ana: () => 'forest', ben: () => 'forest', cleo: () => 'cropland' }));
    expect(agreed.doubtful).toEqual([]);
    const blank = referenceFigures(shared(1, { ana: () => 'forest', ben: () => 'forest', cleo: () => 'forest' }, () => ''));
    expect(blank.doubtful).toEqual([expect.objectContaining({ plot: 'r1', reference: '', majority: 'forest', count: 3, of: 3 })]);
  });
});

describe('referenceFigures: each person over time, and judgedReference', () => {
  it('splits each person\'s answers into their latest ten checks and the ones before', () => {
    // ana: wrong on the first 15, right on the last 10. ben: 8 checks only.
    const figures = referenceFigures(shared(25, { ana: (i) => (i <= 15 ? 'cropland' : 'forest'), ben: (i) => (i <= 8 ? 'forest' : null) }));
    const ana = personAccuracy(figures, 'ana')!;
    expect(ana.answers).toEqual({ compared: 50, agreeing: 35 });
    expect(ana.recent).toEqual({ compared: 20, agreeing: 20 });
    expect(ana.earlier).toEqual({ compared: 30, agreeing: 15 });
    const ben = personAccuracy(figures, 'ben')!;
    expect(ben.recent).toEqual({ compared: 16, agreeing: 16 });
    expect(ben.earlier).toBeNull();
  });

  it('judges each question and each person against the target, with the margin, under MIN_PLOTS too', () => {
    const figures = referenceFigures(shared(25, { ana: (i) => (i <= 15 ? 'cropland' : 'forest'), ben: (i) => (i <= 8 ? 'forest' : null), cleo: (i) => (i <= 3 ? 'forest' : null) }));
    const judged = judgedReference(figures, 80);
    const [ana, ben, cleo] = judged.people;
    // 10 of 25 land uses right: 23% to 59%, all under 80%. Her canopy is fine: the worst of the two counts.
    expect(ana.questions[0]).toMatchObject({ key: 'collect_code_land_use', compared: 25, agreeing: 10, verdict: 'below' });
    expect(ana.questions[0].high!).toBeLessThan(0.8);
    expect(ana.questions[1].verdict).toBe('ok');
    expect(ana.verdict).toBe('below');
    // All her answers together: 35 of 50, whose margin (56% to 81%) reaches the target.
    expect(ana.answers).toMatchObject({ compared: 50, agreeing: 35, verdict: 'watch' });
    expect(ana.trend).toBe('better');
    // 8 plots is under MIN_PLOTS (no rate shown), yet enough for a verdict with its margin.
    expect(ben.plots.rate).toBeNull();
    expect(ben).toMatchObject({ verdict: 'ok', trend: null });
    expect(ben.questions[0].low!).toBeCloseTo(0.676, 3);
    // 3 right of 3: too few to say.
    expect(cleo.verdict).toBe('early');
    // The questions over everyone: 21 of 36 land uses
    expect(judged.questions[0]).toMatchObject({ compared: 36, agreeing: 21, verdict: 'below' });
    expect(judged.questions[1]).toMatchObject({ compared: 36, agreeing: 36, verdict: 'ok', high: 1 });
    // A stricter target changes the verdicts, not the figures.
    expect(judgedReference(figures, 50).people[0].verdict).toBe('watch');
  });
});

describe('reference plots are left out of the agreement figures', () => {
  it('qualityReport pairs only the other plots: no agreement, difference nor pair of a reference plot', () => {
    const input = project(MIN_PLOTS, 0, 3);
    const report = qualityReport(input);
    expect(report.plotsChecked).toBe(3);
    expect(report.plotsDiffering).toBe(3);
    expect(report.differences.map((d) => d.plot)).toEqual(['p1', 'p2', 'p3']);
    expect(report.pairs.plot).toEqual(['p1', 'p2', 'p3']);
    expect(report.people.find((p) => p.username === 'coord')).toBeUndefined();
    expect(report.people.find((p) => p.username === 'ana')!.asChecker.compared).toBe(0);
    // Without the reference set, the same records are ordinary checks.
    const plain = qualityReport({ ...input, reference: undefined });
    expect(plain.plotsChecked).toBe(23);
  });

  it('qualityFigures: survey health compares no reference plot; the answers keep the reference assessments', () => {
    const figures = qualityFigures(project(MIN_PLOTS, 0, 3));
    expect(figures.reference.checks).toBe(20);
    expect(figures.health.checked.groups).toEqual(['p1', 'p2', 'p3']);
    // The reference assessments are first assessments of the project's data: in the answer table.
    expect(figures.answers.size).toBe(23);
    expect(figures.answers.operators.sort()).toEqual(['ana', 'coord']);
  });
});

describe('referenceCopyPlan', () => {
  const members: Member[] = [
    { userId: 'u-coord', username: 'coord', role: 'admin' },
    { userId: 'u-ana', username: 'ana', role: 'operator' },
    { userId: 'u-ben', username: 'ben', role: 'operator' },
    { userId: 'u-off', username: 'off', role: 'operator', disabled: true },
    { userId: 'u-rev', username: 'rev', role: 'reviewer' },
  ];
  const ref: ReferencePlot = { csvFileId: 'f', plotKey: '9', assessorUserId: 'u-coord', assessor: 'coord', addedAt: 1, addedBy: 'u-coord' };

  it('adds a copy for every collector not holding the plot, never the assessor, a disabled account nor a reviewer', () => {
    const holdings = new Map<string, PlotAssignment[]>([
      ['f', [{ plotKey: '9', userId: 'u-coord', overlap: false }, { plotKey: '9', userId: 'u-ben', overlap: true }]],
    ]);
    const plan = referenceCopyPlan({ references: [ref], members, holdings, hasRecord: () => false });
    expect(plan.add).toEqual([{ csvFileId: 'f', plotKey: '9', userId: 'u-ana' }]);
    expect(plan.drop).toEqual([]);
  });

  it('drops the copy of someone no longer a collector (or disabled) who has no record of it, keeps one with a record', () => {
    const holdings = new Map<string, PlotAssignment[]>([
      [
        'f',
        [
          { plotKey: '9', userId: 'u-coord', overlap: false },
          { plotKey: '9', userId: 'u-ana', overlap: true },
          { plotKey: '9', userId: 'u-ben', overlap: true },
          { plotKey: '9', userId: 'u-off', overlap: true },
          { plotKey: '9', userId: 'u-rev', overlap: true },
        ],
      ],
    ]);
    const plan = referenceCopyPlan({ references: [ref], members, holdings, hasRecord: (u) => u === 'rev' });
    expect(plan.add).toEqual([]);
    expect(plan.drop).toEqual([{ csvFileId: 'f', plotKey: '9', userId: 'u-off' }]);
  });

  it('for one person only (their plot list): adds theirs, drops nothing', () => {
    const holdings = new Map<string, PlotAssignment[]>([['f', [{ plotKey: '9', userId: 'u-off', overlap: true }]]]);
    const plan = referenceCopyPlan({ references: [ref], members, holdings, hasRecord: () => false, only: 'u-ben' });
    expect(plan).toEqual({ add: [{ csvFileId: 'f', plotKey: '9', userId: 'u-ben' }], drop: [] });
    expect(referenceCopyPlan({ references: [ref], members, holdings, hasRecord: () => false, only: 'u-rev' })).toEqual({ add: [], drop: [] });
  });

  it('a reference plot of a file no longer divided gets nothing', () => {
    expect(referenceCopyPlan({ references: [ref], members, holdings: new Map(), hasRecord: () => false })).toEqual({ add: [], drop: [] });
  });
});

describe('checkMark, pickReference, parsePlotList', () => {
  const base = { units: ['1', '2', '3'], plots: ['1', '2'], info: none, inOtherFile: () => false, assessedByOthers: new Set<string>(), existing: 0, already: 0 };

  it('accepts plots of the divided file nobody else assessed first', () => {
    expect(checkMark(base)).toBeNull();
  });

  it('refuses a whole file, unknown plots, plots in another file, assessed by someone else, and over the cap', () => {
    expect(checkMark({ ...base, units: null })).toEqual({ code: 'whole_file' });
    expect(checkMark({ ...base, plots: ['1', 'x'] })).toEqual({ code: 'unknown_plots', plots: ['x'] });
    expect(checkMark({ ...base, inOtherFile: (u) => u === '2' })).toEqual({ code: 'in_other_file', plots: ['2'] });
    expect(checkMark({ ...base, assessedByOthers: new Set(['1']) })).toEqual({ code: 'assessed_by_others', plots: ['1'] });
    expect(checkMark({ ...base, existing: MAX_REFERENCE_PLOTS - 1 })).toEqual({ code: 'too_many' });
    // Plots already marked do not count twice.
    expect(checkMark({ ...base, existing: MAX_REFERENCE_PLOTS, already: 2 })).toBeNull();
  });

  it('refuses an own round\'s check unit (its round is the reassessment code)', () => {
    const own: RoundInfo = { state: 'own', refusal: null, keyCount: 2, roundIndex: 1, roundCodes: [{ code: '1', label: '1' }, { code: 'R', label: 'R' }], reassessmentCode: 'R' };
    expect(checkMark({ ...base, info: own, units: ['1,1', '1,R'], plots: ['1,1', '1,R'] })).toEqual({ code: 'not_a_plot', plots: ['1,R'] });
  });

  it('picks the same plots for the same seed, in file order, only free ones', () => {
    const units = Array.from({ length: 100 }, (_, i) => String(i + 1));
    const a = pickReference(units, (u) => u !== '5', 10, 42);
    expect(a).toHaveLength(10);
    expect(a).toEqual(pickReference(units, (u) => u !== '5', 10, 42));
    expect(a).not.toContain('5');
    expect([...a].sort((x, y) => Number(x) - Number(y))).toEqual(a);
    expect(pickReference(units, () => true, 10, 43)).not.toEqual(a);
    expect(pickReference(['1', '2'], () => true, 10, 1)).toEqual(['1', '2']);
  });

  it('splits a typed list of plots on commas, unless the id with commas is a plot', () => {
    expect(splitListedPlots(['5, 6,7', '8'], ['5', '6', '7', '8'])).toEqual(['5', '6', '7', '8']);
    expect(splitListedPlots(['12,3'], ['12,3', '12', '3'])).toEqual(['12,3']);
    expect(splitListedPlots(['abc, 5'], ['5'])).toEqual(['abc, 5']);
  });

  it('takes the id as in the CSV for the one plot of several keys it starts', () => {
    expect(splitListedPlots(['lagoon', ' river '], ['lagoon,1', 'river,2', 'delta,1'])).toEqual(['lagoon,1', 'river,2']);
    // Several plots share the id: it stays as typed (refused as unknown).
    expect(splitListedPlots(['18'], ['18,1', '18,3'])).toEqual(['18']);
    // A plot of one key is not taken for another's first key.
    expect(splitListedPlots(['12'], ['12', '12,3'])).toEqual(['12']);
  });

  it('spreads the picks over the file, not a run of neighbours', () => {
    const units = Array.from({ length: 300 }, (_, i) => String(i + 1));
    const preferred = (u: string) => Number(u) > 240;
    const three = pickReference(units, () => true, 3, 11, preferred).map(Number);
    expect(three.every((n) => n > 240)).toBe(true);
    expect(three[0]).toBeLessThanOrEqual(260);
    expect(three[2]).toBeGreaterThan(280);
    const four = pickReference(units, () => true, 4, 11).map(Number);
    expect(four.map((n) => Math.floor((n - 1) / 75))).toEqual([0, 1, 2, 3]);
  });

  it('picks the preferred plots first (their collector has not downloaded plots), the rest only to make up the count', () => {
    const units = Array.from({ length: 100 }, (_, i) => String(i + 1));
    const preferred = (u: string) => Number(u) > 90;
    expect(pickReference(units, () => true, 5, 7, preferred).every(preferred)).toBe(true);
    const twelve = pickReference(units, () => true, 12, 7, preferred);
    expect(twelve.filter(preferred)).toHaveLength(10);
    expect(twelve).toHaveLength(12);
  });

  it('parsePlotList: distinct non-empty strings, at most 500', () => {
    expect(parsePlotList(['1', '1', '2'])).toEqual(['1', '2']);
    expect(parsePlotList(['1', ''])).toBeNull();
    expect(parsePlotList('1')).toBeNull();
    expect(parsePlotList(Array.from({ length: 501 }, (_, i) => String(i)))).toBeNull();
  });
});

describe('migration 020', () => {
  const sql = readFileSync(new URL('../migrations/020_reference.sql', import.meta.url), 'utf8');

  it('fences reference_plots on app.current_project, as records is, and bumps the figures\' version', () => {
    expect(sql).toContain('ALTER TABLE reference_plots ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'CREATE POLICY reference_plots_isolation ON reference_plots\n' +
        "  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)\n" +
        "  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);",
    );
    expect(sql).toContain('EXECUTE FUNCTION bump_records_version_new()');
    expect(sql).toContain('EXECUTE FUNCTION bump_records_version_old()');
    expect(sql).toContain('PRIMARY KEY (project_id, csv_file_id, plot_key)');
  });
});
