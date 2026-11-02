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
  personAccuracy,
  pickReference,
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
      { plot: 'r1', assessor: 'coord', assessed: false, checks: 1 },
      { plot: 'r2', assessor: 'coord', assessed: true, checks: 0 },
      { plot: 'r3', assessor: 'coord', assessed: true, checks: 1 },
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

  it('is empty without reference plots', () => {
    expect(referenceFigures(project(0, 0, 3))).toEqual(NO_REFERENCE);
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
