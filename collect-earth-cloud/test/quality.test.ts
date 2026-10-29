import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { aiSafeValue, checkMargins, finalAnswers, marginKey, isoWeek, MIN_PLOTS, qualityReport, type QualityInput, type QualityRecord } from '../src/quality.js';
import type { Question } from '../src/surveyOutline.js';

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
const ownYears: RoundInfo = {
  state: 'own',
  refusal: null,
  keyCount: 2,
  roundIndex: 1,
  roundCodes: [{ code: '2025', label: '2025' }],
  reassessmentCode: null,
};

function question(key: string, kind: Question['kind'], extra: Partial<Question> = {}): Question {
  return { key, label: key, kind, options: kind === 'choice' ? [] : null, help: null, excluded: false, multiple: false, calculated: false, ...extra };
}

const outline = new Map<string, Question>(
  [
    question('collect_code_land_use', 'choice', { label: 'Land use' }),
    question('collect_real_canopy', 'number', { label: 'Canopy' }),
    question('collect_text_notes', 'text'),
    question('collect_text_id', 'text', { excluded: true }),
    question('collect_code_species', 'choice', { multiple: true }),
    question('collect_code_fromcsv', 'choice', { excluded: true }),
    question('collect_entity_tree[1].real_height', 'number'),
    question('collect_entity_tree[10].real_height', 'number'),
  ].map((q) => [q.key, q]),
);

const day = Date.UTC(2026, 9, 28, 12);

function rec(recordKey: string, operator: string, summary: Record<string, string>, extra: Partial<QualityRecord> = {}): QualityRecord {
  return { recordKey, operator, summary, modifiedOn: day, activelySaved: true, deleted: false, ...extra };
}

function input(records: QualityRecord[], extra: Partial<QualityInput> = {}): QualityInput {
  const units = new Set<string>();
  for (const r of records) {
    units.add(r.recordKey.split(',')[0]);
  }
  return { records, info: added, units, copyHolders: new Map(), outline, margins: {}, ...extra };
}

/** n checked plots of the added round, agreeing on land use for the first `agree`. */
function plots(n: number, agree: number): QualityRecord[] {
  const out: QualityRecord[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(rec(`${i},1`, 'ana', { collect_code_land_use: 'forest' }));
    out.push(rec(`${i},2`, 'ben', { collect_code_land_use: i <= agree ? 'forest' : 'grassland' }));
  }
  return out;
}

describe('qualityReport: agreement by question', () => {
  it('pairs the main record with the check of each plot and gives a rate from MIN_PLOTS plots', () => {
    const report = qualityReport(input(plots(MIN_PLOTS, 15)));
    expect(report.plotsChecked).toBe(20);
    expect(report.plotsDiffering).toBe(5);
    const landUse = report.questions.find((q) => q.key === 'collect_code_land_use')!;
    expect(landUse).toMatchObject({ label: 'Land use', kind: 'choice', compared: 20, agreeing: 15, rate: 0.75 });
    expect(landUse.margin).toBeUndefined();
  });

  it('gives no rate below MIN_PLOTS checked plots', () => {
    const report = qualityReport(input(plots(MIN_PLOTS - 1, 19)));
    expect(report.questions[0]).toMatchObject({ compared: 19, agreeing: 19, rate: null });
  });

  it('compares only choice and number questions that are not excluded', () => {
    const report = qualityReport(
      input([
        rec('1,1', 'ana', { collect_text_notes: 'a', collect_text_id: '1', collect_code_fromcsv: 'x', collect_code_land_use: 'forest' }),
        rec('1,2', 'ben', { collect_text_notes: 'b', collect_text_id: '1', collect_code_fromcsv: 'y', collect_code_land_use: 'forest' }),
      ]),
    );
    expect(report.questions.map((q) => q.key)).toEqual(['collect_code_land_use']);
    expect(report.plotsDiffering).toBe(0);
  });

  it('counts a missing value as blank, two blanks agree, and a question on neither record is not compared', () => {
    const report = qualityReport(
      input([
        rec('1,1', 'ana', { collect_code_land_use: '' }),
        rec('1,2', 'ben', {}),
        rec('2,1', 'ana', { collect_code_land_use: 'forest' }),
        rec('2,2', 'ben', {}),
      ]),
    );
    expect(report.questions).toHaveLength(1);
    expect(report.questions[0]).toMatchObject({ compared: 2, agreeing: 1 });
    expect(report.differences[0].fields).toEqual([{ key: 'collect_code_land_use', first: 'forest', check: '' }]);
  });

  it('compares codes without their qualifier', () => {
    const report = qualityReport(
      input([rec('1,1', 'ana', { collect_code_land_use: 'other::Eucalyptus' }), rec('1,2', 'ben', { collect_code_land_use: 'other::Pine' })]),
    );
    expect(report.questions[0]).toMatchObject({ compared: 1, agreeing: 1 });
  });

  it('compares multiple values as sets, with null parts blank, and counts one confusion for the two sets', () => {
    const report = qualityReport(
      input([
        rec('1,1', 'ana', { collect_code_species: 'b===a===null' }),
        rec('1,2', 'ben', { collect_code_species: 'a===b' }),
        rec('2,1', 'ana', { collect_code_species: 'c===a' }),
        rec('2,2', 'ben', { collect_code_species: 'a===null' }),
      ]),
    );
    expect(report.questions[0]).toMatchObject({ key: 'collect_code_species', compared: 2, agreeing: 1 });
    expect(report.confusions).toEqual([{ key: 'collect_code_species', first: 'a, c', check: 'a', count: 1, plots: ['2'] }]);
  });
});

describe('qualityReport: numbers', () => {
  const canopy = (a: string, b: string, margins: Record<string, number> = {}) =>
    qualityReport(input([rec('1,1', 'ana', { collect_real_canopy: a }), rec('1,2', 'ben', { collect_real_canopy: b })], { margins })).questions[0];

  it('agree within the margin, 10 % by default', () => {
    expect(canopy('100', '110')).toMatchObject({ agreeing: 1, margin: 10 });
    expect(canopy('100', '90')).toMatchObject({ agreeing: 1 });
    expect(canopy('100', '89')).toMatchObject({ agreeing: 0 });
    expect(canopy('0', '0')).toMatchObject({ agreeing: 1 });
    expect(canopy('-5', '5')).toMatchObject({ agreeing: 0 });
  });

  it('use the margin set for the question', () => {
    expect(canopy('100', '89', { collect_real_canopy: 20 })).toMatchObject({ agreeing: 1, margin: 20 });
    expect(canopy('100', '100.5', { collect_real_canopy: 0 })).toMatchObject({ agreeing: 0, margin: 0 });
    expect(canopy('1.0', '1', { collect_real_canopy: 0 })).toMatchObject({ agreeing: 1 });
  });

  it('blank against a number disagrees; texts that are no number agree only when equal', () => {
    expect(canopy('', '5')).toMatchObject({ agreeing: 0 });
    expect(canopy('', 'null')).toMatchObject({ agreeing: 1 });
    expect(canopy('abc', 'abc')).toMatchObject({ agreeing: 1 });
    expect(canopy('abc', 'abd')).toMatchObject({ agreeing: 0 });
  });
});

describe('qualityReport: confusions', () => {
  it('counts a→b apart from b→a, most frequent first, with up to 20 plots', () => {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 25; i++) {
      records.push(rec(`${i},1`, 'ana', { collect_code_land_use: 'grassland' }), rec(`${i},2`, 'ben', { collect_code_land_use: 'shrubland' }));
    }
    records.push(rec('99,1', 'ana', { collect_code_land_use: 'shrubland' }), rec('99,2', 'ben', { collect_code_land_use: 'grassland' }));
    const { confusions } = qualityReport(input(records));
    expect(confusions.map((c) => [c.first, c.check, c.count])).toEqual([
      ['grassland', 'shrubland', 25],
      ['shrubland', 'grassland', 1],
    ]);
    expect(confusions[0].plots).toHaveLength(20);
    expect(confusions[0].plots.slice(0, 3)).toEqual(['1', '2', '3']);
  });

  it('are not counted for numbers', () => {
    const report = qualityReport(input([rec('1,1', 'ana', { collect_real_canopy: '1' }), rec('1,2', 'ben', { collect_real_canopy: '50' })]));
    expect(report.confusions).toEqual([]);
    expect(report.plotsDiffering).toBe(1);
  });
});

describe('qualityReport: people', () => {
  it('gives each person figures as first assessor and as checker, and their weakest questions', () => {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 4; i++) {
      // ana first, ben checks: land use differs on plots 1 and 2, canopy on plot 1.
      records.push(rec(`${i},1`, 'ana', { collect_code_land_use: 'forest', collect_real_canopy: '50' }));
      records.push(rec(`${i},2`, 'ben', { collect_code_land_use: i <= 2 ? 'crop' : 'forest', collect_real_canopy: i === 1 ? '10' : '50' }));
    }
    // ben first, ana checks: agree.
    records.push(rec('5,1', 'ben', { collect_code_land_use: 'forest' }), rec('5,2', 'ana', { collect_code_land_use: 'forest' }));
    const { people } = qualityReport(input(records));
    expect(people.map((p) => p.username)).toEqual(['ana', 'ben']);
    const [ana, ben] = people;
    expect(ana.asFirst).toEqual({ compared: 4, agreeing: 2, rate: null });
    expect(ana.asChecker).toEqual({ compared: 1, agreeing: 1, rate: null });
    expect(ben.asFirst).toEqual({ compared: 1, agreeing: 1, rate: null });
    expect(ben.asChecker).toEqual({ compared: 4, agreeing: 2, rate: null });
    expect(ana.weakest).toEqual([
      { key: 'collect_code_land_use', rate: null, compared: 5, differing: 2 },
      { key: 'collect_real_canopy', rate: null, compared: 4, differing: 1 },
    ]);
  });
});

describe('qualityReport: weeks', () => {
  it('buckets by the ISO week of the check, in UTC, right at year ends', () => {
    expect(isoWeek(Date.UTC(2026, 0, 1))).toBe('2026-W01');
    expect(isoWeek(Date.UTC(2027, 0, 1))).toBe('2026-W53');
    expect(isoWeek(Date.UTC(2024, 11, 30))).toBe('2025-W01');
    expect(isoWeek(Date.UTC(2021, 0, 3, 23, 59))).toBe('2020-W53');
    expect(isoWeek(Date.UTC(2021, 0, 4))).toBe('2021-W01');
    const report = qualityReport(
      input([
        rec('1,1', 'ana', { collect_code_land_use: 'a' }, { modifiedOn: Date.UTC(2020, 0, 1) }),
        rec('1,2', 'ben', { collect_code_land_use: 'a' }, { modifiedOn: Date.UTC(2024, 11, 31) }),
        rec('2,1', 'ana', { collect_code_land_use: 'a' }),
        rec('2,2', 'ben', { collect_code_land_use: 'b' }, { modifiedOn: Date.UTC(2024, 11, 29) }),
      ]),
    );
    expect(report.weeks).toEqual([
      { week: '2024-W52', compared: 1, agreeing: 0 },
      { week: '2025-W01', compared: 1, agreeing: 1 },
    ]);
  });
});

describe('qualityReport: data problems', () => {
  it('lists records of no plot, of an unknown round, with extra key parts, and plots with two main assessments', () => {
    const report = qualityReport(
      input(
        [
          rec('1,1', 'ana', { collect_code_land_use: 'forest' }, { modifiedOn: day - 1000 }),
          rec('1,1', 'carl', { collect_code_land_use: 'crop' }),
          rec('1,2', 'ben', { collect_code_land_use: 'crop' }),
          rec('2,3', 'ana', {}),
          rec('3,1,9', 'ana', {}),
          rec('77,1', 'ana', {}),
        ],
        { units: new Set(['1', '2', '3']) },
      ),
    );
    expect(report.problems).toEqual([
      { kind: 'two_main', plot: '1', recordKey: '1,1', operator: 'ana' },
      { kind: 'two_main', plot: '1', recordKey: '1,1', operator: 'carl' },
      { kind: 'unknown_round', plot: '2', recordKey: '2,3', operator: 'ana' },
      { kind: 'extra_key_parts', plot: '3', recordKey: '3,1,9', operator: 'ana' },
      { kind: 'no_plot', plot: '77', recordKey: '77,1', operator: 'ana' },
    ]);
    expect(report.problemsTotal).toBe(5);
    // The latest main record is the one compared: carl's crop agrees with the check.
    expect(report.plotsDiffering).toBe(0);
    expect(report.differences).toEqual([]);
  });

  it('leaves out drafts and deleted records', () => {
    const report = qualityReport(
      input([
        rec('1,1', 'ana', { collect_code_land_use: 'forest' }),
        rec('1,2', 'ben', { collect_code_land_use: 'crop' }, { activelySaved: false }),
        rec('1,2', 'carl', { collect_code_land_use: 'crop' }, { deleted: true }),
      ]),
    );
    expect(report.plotsChecked).toBe(0);
  });
});

describe('qualityReport: rounds and keys', () => {
  it('tells main and check apart by who holds the copy when the survey has no round', () => {
    const report = qualityReport(
      input([rec('1', 'ana', { collect_code_land_use: 'forest' }), rec('1', 'ben', { collect_code_land_use: 'crop' })], {
        info: none,
        units: new Set(['1']),
        copyHolders: new Map([['1', new Set(['ben'])]]),
      }),
    );
    expect(report.differences).toEqual([
      {
        plot: '1',
        first: { operator: 'ana', recordKey: '1' },
        check: { operator: 'ben', recordKey: '1' },
        fields: [{ key: 'collect_code_land_use', first: 'forest', check: 'crop' }],
      },
    ]);
  });

  it('pairs by plot unit, so the years of an own round are separate plots', () => {
    const report = qualityReport(
      input(
        [
          rec('18,2020', 'ana', { collect_code_land_use: 'forest' }),
          rec('18,2020', 'ben', { collect_code_land_use: 'crop' }),
          rec('18,2021', 'carl', { collect_code_land_use: 'forest' }),
        ],
        { info: ownYears, units: new Set(['18,2020', '18,2021']), copyHolders: new Map([['18,2020', new Set(['ben'])]]) },
      ),
    );
    expect(report.problems).toEqual([]);
    expect(report.plotsChecked).toBe(1);
    expect(report.differences[0].plot).toBe('18,2020');
  });

  it('ignores answers beyond the outline with a count, and falls back on the key for questions it does not know', () => {
    const report = qualityReport(
      input([
        rec('1,1', 'ana', {
          'collect_entity_tree[11].real_height': '5',
          'collect_entity_tree[1].real_height': '5',
          collect_code_new: 'a',
          collect_text_free: 'x',
          collect_text_operator_x: 'ana',
          collect_integer_range_r: '1-2',
        }),
        rec('1,2', 'ben', {
          'collect_entity_tree[11].real_height': '50',
          'collect_entity_tree[12].real_height': '50',
          'collect_entity_tree[1].real_height': '5',
          collect_code_new: 'b',
          collect_text_free: 'y',
          collect_text_operator_x: 'ben',
          collect_integer_range_r: '3-4',
        }),
      ]),
    );
    expect(report.questions.map((q) => [q.key, q.kind, q.agreeing])).toEqual([
      ['collect_entity_tree[1].real_height', 'number', 1],
      ['collect_code_new', 'choice', 0],
    ]);
    expect(report.beyondOutline).toEqual({ count: 2, keys: ['collect_entity_tree[11].real_height', 'collect_entity_tree[12].real_height'] });
  });

  it('without an outline compares by the key alone and leaves bookkeeping out', () => {
    const report = qualityReport(
      input([rec('1,1', 'ana', { collect_code_land_use: 'a', collect_date_modified_x: '1' }), rec('1,2', 'ben', { collect_code_land_use: 'b', collect_date_modified_x: '2' })], {
        outline: null,
      }),
    );
    expect(report.questions.map((q) => q.key)).toEqual(['collect_code_land_use']);
  });
});

describe('qualityReport: caps', () => {
  it('lists at most 500 differences and 500 problems', () => {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 600; i++) {
      records.push(rec(`${i},1`, 'ana', { collect_code_land_use: 'a' }), rec(`${i},2`, 'ben', { collect_code_land_use: 'b' }));
      records.push(rec(`x${i},1`, 'ana', {}));
    }
    const units = new Set(Array.from({ length: 600 }, (_, i) => String(i + 1)));
    const report = qualityReport(input(records, { units }));
    expect(report.plotsDiffering).toBe(600);
    expect(report.differences).toHaveLength(500);
    expect(report.differences[0].plot).toBe('1');
    expect(report.differences[499].plot).toBe('500');
    expect(report.problems).toHaveLength(500);
    expect(report.problemsTotal).toBe(600);
  });
});

describe('qualityReport: speed', () => {
  it('handles 50k checked plots of 60 answers in well under 5 s', () => {
    const big = new Map<string, Question>();
    const keys: string[] = [];
    for (let i = 0; i < 60; i++) {
      const key = i % 3 === 0 ? `collect_code_q${i}` : i % 3 === 1 ? `collect_real_q${i}` : `collect_text_q${i}`;
      big.set(key, question(key, i % 3 === 0 ? 'choice' : i % 3 === 1 ? 'number' : 'text'));
      keys.push(key);
    }
    const records: QualityRecord[] = [];
    const units = new Set<string>();
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let p = 0; p < 50_000; p++) {
      units.add(String(p));
      for (const round of ['1', '2']) {
        const summary: Record<string, string> = {};
        for (const key of keys) {
          summary[key] = key.includes('code') ? (rnd() < 0.9 ? 'a' : 'b') : key.includes('real') ? String(Math.floor(rnd() * 100)) : `t${p}`;
        }
        records.push(rec(`${p},${round}`, `u${p % 30}${round === '2' ? 'c' : ''}`, summary, { modifiedOn: day + p * 60_000 }));
      }
    }
    const started = performance.now();
    const report = qualityReport({ records, info: added, units, copyHolders: new Map(), outline: big, margins: {} });
    const took = performance.now() - started;
    expect(report.plotsChecked).toBe(50_000);
    expect(took).toBeLessThan(5_000);
  }, 60_000);
});

describe('qualityReport: after the review', () => {
  it('pairs one main record with each of several checks: counts are checks, not plots', () => {
    const report = qualityReport(
      input(
        [
          rec('1', 'ana', { collect_code_land_use: 'forest' }),
          rec('1', 'ben', { collect_code_land_use: 'forest' }),
          rec('1', 'carl', { collect_code_land_use: 'crop' }),
        ],
        { info: none, units: new Set(['1']), copyHolders: new Map([['1', new Set(['ben', 'carl'])]]) },
      ),
    );
    expect(report.plotsChecked).toBe(1);
    expect(report.plotsDiffering).toBe(1);
    expect(report.questions[0]).toMatchObject({ compared: 2, agreeing: 1 });
    expect(report.people.find((p) => p.username === 'ana')!.asFirst).toEqual({ compared: 2, agreeing: 1, rate: null });
    expect(report.differences.map((d) => d.check.operator)).toEqual(['carl']);
  });

  it('does not pair a check without a main record, nor list it as a problem', () => {
    const report = qualityReport(input([rec('1,2', 'ben', { collect_code_land_use: 'forest' })]));
    expect(report.plotsChecked).toBe(0);
    expect(report.people).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('compares an answer only one record gives against blank', () => {
    const report = qualityReport(input([rec('1,1', 'ana', {}), rec('1,2', 'ben', { collect_real_canopy: '5' })]));
    expect(report.differences[0].fields).toEqual([{ key: 'collect_real_canopy', first: '', check: '5' }]);
  });

  it('never compares round or bookkeeping answers, with or without an outline that knows them', () => {
    for (const o of [null, new Map<string, Question>()]) {
      const report = qualityReport(
        input(
          [
            rec('1,1', 'ana', { collect_code_round: '1', collect_integer_round: '1', collect_text_plot_file: 'a.csv', collect_coord_location: '1,2', collect_code_lu: 'a' }),
            rec('1,2', 'ben', { collect_code_round: '2', collect_integer_round: '2', collect_text_plot_file: 'b.csv', collect_coord_location: '1,3', collect_code_lu: 'a' }),
          ],
          { outline: o },
        ),
      );
      expect(report.questions.map((q) => q.key)).toEqual(['collect_code_lu']);
      expect(report.plotsDiffering).toBe(0);
    }
  });

  it('a margin of an indexed entity question, keyed [*], applies to every index of it', () => {
    const tree = (i: number) => `collect_entity_tree[${i}].real_height`;
    const report = qualityReport(
      input([rec('1,1', 'ana', { [tree(1)]: '100', [tree(10)]: '100' }), rec('1,2', 'ben', { [tree(1)]: '75', [tree(10)]: '75' })], {
        margins: { 'collect_entity_tree[*].real_height': 30 },
      }),
    );
    expect(report.questions.map((q) => [q.key, q.agreeing, q.margin])).toEqual([
      [tree(1), 1, 30],
      [tree(10), 1, 30],
    ]);
    expect(marginKey(tree(1))).toBe('collect_entity_tree[*].real_height');
    expect(marginKey(tree(11))).toBe('collect_entity_tree[*].real_height');
    // A keyed entity (by code) is a question of its own; a root question is its own key.
    expect(marginKey('collect_entity_land_use[F].real_coverage')).toBe('collect_entity_land_use[F].real_coverage');
    expect(marginKey('collect_real_canopy')).toBe('collect_real_canopy');
  });

  it('checkMargins: number questions of the outline, an indexed one by its [*] form, 0-100', () => {
    const tree1 = 'collect_entity_tree[1].real_height';
    expect(checkMargins({ collect_real_canopy: 5, 'collect_entity_tree[*].real_height': 0 }, outline)).toEqual({
      margins: { collect_real_canopy: 5, 'collect_entity_tree[*].real_height': 0 },
    });
    // An index is stored as the [*] form.
    expect(checkMargins({ [tree1]: 12 }, outline)).toEqual({ margins: { 'collect_entity_tree[*].real_height': 12 } });
    for (const bad of [
      null,
      [],
      5,
      { collect_code_land_use: 5 },
      { collect_text_notes: 5 },
      { 'collect_entity_tree[*].real_width': 5 },
      { collect_real_canopy: 101 },
      { collect_real_canopy: -1 },
      { collect_real_canopy: '5' },
      { collect_real_canopy: Number.NaN },
    ]) {
      expect(checkMargins(bad, outline), JSON.stringify(bad)).toHaveProperty('reason');
    }
    expect(checkMargins({ collect_real_canopy: 5 }, null)).toHaveProperty('reason');
  });

  it('uses the default margin for a margin that is no number >= 0', () => {
    for (const bad of [NaN, -5, Infinity, '20' as unknown as number]) {
      const q = qualityReport(
        input([rec('1,1', 'ana', { collect_real_canopy: '100' }), rec('1,2', 'ben', { collect_real_canopy: '109' })], { margins: { collect_real_canopy: bad } }),
      ).questions[0];
      expect(q).toMatchObject({ agreeing: 1, margin: 10 });
    }
  });

  it('agrees right at the margin despite rounding', () => {
    const q = qualityReport(
      input([rec('1,1', 'ana', { collect_real_canopy: '0.063' }), rec('1,2', 'ben', { collect_real_canopy: '0.07' })], { margins: { collect_real_canopy: 10 } }),
    ).questions[0];
    expect(q.agreeing).toBe(1);
  });

  it('takes the same main record whatever the order, when two have the same modifiedOn', () => {
    const records = [
      rec('1,1', 'carl', { collect_code_land_use: 'crop' }),
      rec('1,1', 'ana', { collect_code_land_use: 'forest' }),
      rec('1,2', 'ben', { collect_code_land_use: 'forest' }),
    ];
    const a = qualityReport(input(records));
    const b = qualityReport(input([...records].reverse()));
    expect(a.plotsDiffering).toBe(0);
    expect(b).toEqual(a);
  });

  it('ranks the weakest questions with enough checks first, then by how often they differ', () => {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 25; i++) {
      // land use: 25 checks, 5 differ; canopy: only on 2 plots, both differ.
      records.push(rec(`${i},1`, 'ana', { collect_code_land_use: 'forest', ...(i <= 2 ? { collect_real_canopy: '1' } : {}) }));
      records.push(rec(`${i},2`, 'ben', { collect_code_land_use: i <= 5 ? 'crop' : 'forest', ...(i <= 2 ? { collect_real_canopy: '50' } : {}) }));
    }
    const ana = qualityReport(input(records)).people.find((p) => p.username === 'ana')!;
    expect(ana.weakest).toEqual([
      { key: 'collect_code_land_use', rate: 0.8, compared: 25, differing: 5 },
      { key: 'collect_real_canopy', rate: null, compared: 2, differing: 2 },
    ]);
  });

  it('with an own round, keeps records in no file apart by their whole key', () => {
    const report = qualityReport(
      input([rec('18,2020', 'ana', {}), rec('18,2021', 'ben', {})], { info: ownYears, units: new Set(), copyHolders: new Map() }),
    );
    expect(report.problems.map((p) => [p.kind, p.plot])).toEqual([
      ['no_plot', '18,2020'],
      ['no_plot', '18,2021'],
    ]);
  });
});

describe('aiSafeValue', () => {
  it('gives codes without qualifiers, numbers only when numeric, and never text', () => {
    expect(aiSafeValue('choice', 'other::Juan Perez===a')).toBe('a, other');
    expect(aiSafeValue('number', '5===null=== 7')).toBe('5, 7');
    expect(aiSafeValue('number', 'call 555-1234')).toBeNull();
    expect(aiSafeValue('text', 'anything')).toBeNull();
    expect(aiSafeValue('other', '2026-01-01')).toBeNull();
  });
});

describe('finalAnswers: the final column of the export', () => {
  const later = day + 60_000;
  const records = [
    rec('1,1', 'ana', {}),
    rec('1,2', 'ben', {}),
    rec('2,1', 'ana', {}),
    rec('2,2', 'ben', {}),
    rec('2,2', 'carl', {}, { modifiedOn: later }),
    rec('3,1', 'ana', {}),
    rec('3,2', 'ben', {}),
    rec('4,1', 'ana', {}),
    rec('4,2', 'ben', {}, { activelySaved: false }),
    rec('5,1', 'ana', {}),
  ];
  const units = new Set(['1', '2', '3', '4', '5']);

  it('yes for the answer taken, no for the other, recheck for both, blank without a decision', () => {
    const final = finalAnswers(
      { records, info: added, units, copyHolders: new Map() },
      new Map([
        ['1', 'first'],
        ['2', 'check'],
        ['3', 'recheck'],
        ['4', 'first'],
      ] as const),
    );
    const of = (recordKey: string, operator: string) => final({ recordKey, operator });
    expect([of('1,1', 'ana'), of('1,2', 'ben')]).toEqual(['yes', 'no']);
    // Several checks: the latest is the one taken.
    expect([of('2,1', 'ana'), of('2,2', 'ben'), of('2,2', 'carl')]).toEqual(['no', 'no', 'yes']);
    expect([of('3,1', 'ana'), of('3,2', 'ben')]).toEqual(['recheck', 'recheck']);
    // A draft has no final answer; nor has a plot without a decision.
    expect([of('4,1', 'ana'), of('4,2', 'ben')]).toEqual(['yes', '']);
    expect(of('5,1', 'ana')).toBe('');
    expect(of('9,1', 'nobody')).toBe('');
  });

  it('keys decisions by the plot unit, as the figures pair records (a virtual round, by copy holders)', () => {
    const final = finalAnswers(
      { records: [rec('7', 'ana', {}), rec('7', 'ben', {})], info: none, units: new Set(['7']), copyHolders: new Map([['7', new Set(['ben'])]]) },
      new Map([['7', 'check']] as const),
    );
    expect(final({ recordKey: '7', operator: 'ana' })).toBe('no');
    expect(final({ recordKey: '7', operator: 'ben' })).toBe('yes');
  });
});
