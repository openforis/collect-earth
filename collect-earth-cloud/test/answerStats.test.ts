import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { answerStats, answerTable, FLAG_MIN_PLOTS, FLAG_Z, quartiles, twoProportionZ, type AnswerTable } from '../src/answerStats.js';
import type { QualityInput, QualityRecord } from '../src/quality.js';
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

function question(key: string, kind: Question['kind'], extra: Partial<Question> = {}): Question {
  return { key, label: key, kind, options: kind === 'choice' ? [] : null, help: null, excluded: false, multiple: false, calculated: false, ...extra };
}

const outline = new Map<string, Question>(
  [
    question('collect_code_land_use', 'choice', {
      label: 'Land use',
      options: [
        { code: 'forest', label: 'Forest' },
        { code: 'crop', label: 'Cropland' },
        { code: 'grass', label: 'Grassland' },
      ],
    }),
    question('collect_real_canopy', 'number', { label: 'Canopy' }),
    question('collect_text_notes', 'text'),
    question('collect_code_species', 'choice', { label: 'Species', multiple: true }),
    question('collect_code_fromcsv', 'choice', { excluded: true }),
  ].map((q) => [q.key, q]),
);

const day = Date.UTC(2026, 9, 28, 12);

function rec(recordKey: string, operator: string, summary: Record<string, string>, extra: Partial<QualityRecord> = {}): QualityRecord {
  return { recordKey, operator, summary, modifiedOn: day, activelySaved: true, deleted: false, ...extra };
}

function input(records: QualityRecord[], extra: Partial<QualityInput> = {}): QualityInput {
  const units = new Set<string>();
  for (const r of records) units.add(r.recordKey.split(',')[0]);
  return { records, info: added, units, copyHolders: new Map(), outline, margins: {}, ...extra };
}

/** `n` plots of one person, the first `crop` of them cropland, the rest forest; ids from `start`. */
function plotsOf(operator: string, start: number, n: number, crop: number, extra: Partial<QualityRecord> = {}): QualityRecord[] {
  return Array.from({ length: n }, (_, i) => rec(`${start + i},1`, operator, { collect_code_land_use: i < crop ? 'crop' : 'forest' }, extra));
}

const choice = (table: AnswerTable, key = 'collect_code_land_use', filter = {}) => answerStats(table, filter).choices.find((c) => c.key === key)!;

describe('answerTable and answerStats: distributions', () => {
  it('counts first assessments only: checks, drafts, deleted records and plots in no file are left out', () => {
    const records = [
      rec('1,1', 'ana', { collect_code_land_use: 'forest' }),
      rec('2,1', 'ana', { collect_code_land_use: 'crop' }),
      rec('3,1', 'ben', { collect_code_land_use: 'crop' }),
      // A check of plot 1 (round 2), a draft, a deleted record, a plot in no file.
      rec('1,2', 'ben', { collect_code_land_use: 'grass' }),
      rec('4,1', 'ben', { collect_code_land_use: 'grass' }, { activelySaved: false }),
      rec('5,1', 'ben', { collect_code_land_use: 'grass' }, { deleted: true }),
    ];
    const i = input(records);
    const table = answerTable({ ...i, records: [...records, rec('99,1', 'ben', { collect_code_land_use: 'grass' })] });
    const stats = answerStats(table);
    expect(stats.plots).toBe(3);
    const land = stats.choices.find((c) => c.key === 'collect_code_land_use')!;
    expect(land.label).toBe('Land use');
    expect(land.answered).toBe(3);
    // In the survey's order, with their labels; answers nobody gave are left out.
    expect(land.codes).toEqual([
      { code: 'forest', label: 'Forest', count: 1 },
      { code: 'crop', label: 'Cropland', count: 2 },
    ]);
    expect(land.people).toEqual([
      { username: 'ana', answered: 2, counts: [1, 1] },
      { username: 'ben', answered: 1, counts: [0, 1] },
    ]);
    expect(stats.people).toEqual([
      { username: 'ana', plots: 2 },
      { username: 'ben', plots: 1 },
    ]);
  });

  it('blank answers, qualifiers, several codes, text and excluded questions', () => {
    const records = [
      rec('1,1', 'ana', { collect_code_land_use: 'null', collect_code_species: 'pine===oak::red', collect_text_notes: 'x', collect_code_fromcsv: 'a' }),
      rec('2,1', 'ana', { collect_code_land_use: ' crop ', collect_code_species: 'pine' }),
      rec('3,1', 'ana', { collect_code_land_use: '', collect_code_species: 'oak===oak' }),
    ];
    const stats = answerStats(answerTable(input(records)));
    expect(stats.choices.map((c) => c.key)).toEqual(['collect_code_land_use', 'collect_code_species']);
    const land = stats.choices[0];
    expect(land.answered).toBe(1);
    expect(land.blank).toBe(2);
    const species = stats.choices[1];
    expect(species.multiple).toBe(true);
    expect(species.answered).toBe(3);
    // A plot counts once per code it holds: shares can add up to more than 100 %.
    expect(species.codes).toEqual([
      { code: 'oak', label: 'oak', count: 2 },
      { code: 'pine', label: 'pine', count: 2 },
    ]);
  });

  it('a big, mostly blank question is stored sparse and counts the same', () => {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 300; i++) {
      records.push(rec(`${i},1`, i % 2 ? 'ana' : 'ben', i % 50 === 0 ? { collect_code_species: i % 100 === 0 ? 'oak===pine' : 'pine' } : { collect_code_land_use: 'forest' }));
    }
    const table = answerTable(input(records));
    const species = table.choices.find((c) => c.key === 'collect_code_species')!;
    expect(species.rows).not.toBeNull();
    const land = table.choices.find((c) => c.key === 'collect_code_land_use')!;
    expect(land.rows).toBeNull();
    const s = choice(table, 'collect_code_species');
    expect(s.answered).toBe(6);
    expect(s.codes).toEqual([
      { code: 'oak', label: 'oak', count: 3 },
      { code: 'pine', label: 'pine', count: 6 },
    ]);
    expect(s.people.find((p) => p.username === 'ben')).toEqual({ username: 'ben', answered: 6, counts: [3, 6] });
  });

  it('without an outline, keys are judged by their name', () => {
    const records = [rec('1,1', 'ana', { collect_code_x: 'a', collect_integer_n: '4', collect_text_t: 'free', collect_text_operator: 'ana' })];
    const stats = answerStats(answerTable(input(records, { outline: null })));
    expect(stats.choices.map((c) => c.key)).toEqual(['collect_code_x']);
    expect(stats.numbers.map((c) => c.key)).toEqual(['collect_integer_n']);
  });
});

describe('answerStats: filters', () => {
  const records = [
    rec('1,1', 'ana', { collect_code_land_use: 'forest' }, { modifiedOn: Date.UTC(2026, 9, 1, 12) }),
    rec('2,1', 'ana', { collect_code_land_use: 'crop' }, { modifiedOn: Date.UTC(2026, 9, 2, 23, 30) }),
    rec('3,1', 'ben', { collect_code_land_use: 'crop' }, { modifiedOn: Date.UTC(2026, 9, 3, 12) }),
  ];
  const table = answerTable(input(records));

  it('by plots (a plot file, or the plots with a value in one of its columns)', () => {
    const stats = answerStats(table, { units: new Set(['2', '3']) });
    expect(stats.plots).toBe(2);
    expect(stats.choices[0].codes).toEqual([{ code: 'crop', label: 'Cropland', count: 2 }]);
  });

  it('by days, in the viewer\'s time zone', () => {
    // 23:30 UTC on the 2nd is the 3rd in Rome.
    const rome = answerStats(table, { from: '2026-10-03', to: '2026-10-03', timeZone: 'Europe/Rome' });
    expect(rome.plots).toBe(2);
    const utc = answerStats(table, { from: '2026-10-01', to: '2026-10-02', timeZone: 'UTC' });
    expect(utc.plots).toBe(2);
    expect(answerStats(table, { from: '2026-10-02' }).plots).toBe(2);
  });

  it('by person: their row and flags only, the team still everyone', () => {
    const stats = answerStats(table, { person: 'ben' });
    expect(stats.person).toBe('ben');
    expect(stats.plots).toBe(3);
    expect(stats.choices[0].answered).toBe(3);
    expect(stats.choices[0].people.map((p) => p.username)).toEqual(['ben']);
  });
});

describe('the flag: a two-proportion z-test against the rest of the team', () => {
  it('z of two shares, null when it cannot be worked out', () => {
    // 26 of 64 against 200 of 900: pooled p = 226/964.
    const p = 226 / 964;
    const expected = (26 / 64 - 200 / 900) / Math.sqrt(p * (1 - p) * (1 / 64 + 1 / 900));
    expect(twoProportionZ(26, 64, 200, 900)).toBeCloseTo(expected, 10);
    expect(twoProportionZ(0, 30, 0, 30)).toBeNull();
    expect(twoProportionZ(30, 30, 30, 30)).toBeNull();
    expect(twoProportionZ(1, 0, 1, 30)).toBeNull();
  });

  it('flags a share far from the rest of the team, at |z| >= 3, with the figures for the text', () => {
    // Ana: 26 of 64 cropland (41 %); the others: 198 of 900 (22 %).
    const records = [...plotsOf('ana', 1, 64, 26), ...plotsOf('ben', 1001, 450, 99), ...plotsOf('carl', 2001, 450, 99)];
    const stats = answerStats(answerTable(input(records)));
    const z = twoProportionZ(26, 64, 198, 900)!;
    expect(Math.abs(z)).toBeGreaterThanOrEqual(FLAG_Z);
    const flag = stats.flags.find((f) => f.username === 'ana' && f.code === 'crop')!;
    expect(flag).toMatchObject({
      key: 'collect_code_land_use',
      label: 'Land use',
      codeLabel: 'Cropland',
      plots: 64,
      count: 26,
      others: { plots: 900, count: 198 },
    });
    expect(flag.share).toBeCloseTo(26 / 64);
    expect(flag.others.share).toBeCloseTo(0.22);
    expect(flag.z).toBeCloseTo(z, 10);
    // Ben and Carl are like the rest; forest is ana's other side of the same difference.
    expect(stats.flags.filter((f) => f.username !== 'ana')).toEqual([]);
    expect(stats.flags.map((f) => f.code).sort()).toEqual(['crop', 'forest']);
  });

  it('just under |z| 3 is not flagged', () => {
    // The most cropland Ana can have, above the others' 22 %, with z under 3.
    let crop = 14;
    while (Math.abs(twoProportionZ(crop + 1, 64, 44, 200)!) < FLAG_Z) crop++;
    expect(Math.abs(twoProportionZ(crop, 64, 44, 200)!)).toBeLessThan(FLAG_Z);
    expect(Math.abs(twoProportionZ(crop + 1, 64, 44, 200)!)).toBeGreaterThanOrEqual(FLAG_Z);
    const under = answerStats(answerTable(input([...plotsOf('ana', 1, 64, crop), ...plotsOf('ben', 1001, 100, 22), ...plotsOf('carl', 2001, 100, 22)])));
    expect(under.flags.filter((f) => f.code === 'crop')).toEqual([]);
    const over = answerStats(answerTable(input([...plotsOf('ana', 1, 64, crop + 1), ...plotsOf('ben', 1001, 100, 22), ...plotsOf('carl', 2001, 100, 22)])));
    expect(over.flags.filter((f) => f.code === 'crop').map((f) => f.username)).toEqual(['ana']);
  });

  it(`needs at least ${FLAG_MIN_PLOTS} plots of the person with an answer`, () => {
    const few = FLAG_MIN_PLOTS - 1;
    const under = answerStats(answerTable(input([...plotsOf('ana', 1, few, few), ...plotsOf('ben', 1001, 200, 0)])));
    expect(under.flags).toEqual([]);
    const enough = answerStats(answerTable(input([...plotsOf('ana', 1, FLAG_MIN_PLOTS, FLAG_MIN_PLOTS), ...plotsOf('ben', 1001, 200, 0)])));
    expect(enough.flags.map((f) => [f.username, f.code]).sort()).toEqual([
      ['ana', 'crop'],
      ['ana', 'forest'],
      ['ben', 'crop'],
      ['ben', 'forest'],
    ]);
  });

  it('a person alone in the filter is compared with no one', () => {
    const stats = answerStats(answerTable(input(plotsOf('ana', 1, 100, 50))));
    expect(stats.flags).toEqual([]);
  });
});

describe('numbers', () => {
  it('quartiles by linear interpolation between the sorted values', () => {
    expect(quartiles(Float64Array.from([1, 2, 3, 4]))).toEqual({ q1: 1.75, median: 2.5, q3: 3.25 });
    expect(quartiles(Float64Array.from([7]))).toEqual({ q1: 7, median: 7, q3: 7 });
    expect(quartiles(Float64Array.from([1, 2, 3, 4, 5]))).toEqual({ q1: 2, median: 3, q3: 4 });
  });

  it('each person\'s median and IQR against the team\'s; values that are not one number are counted, not used', () => {
    const records = [
      rec('1,1', 'ana', { collect_real_canopy: '10' }),
      rec('2,1', 'ana', { collect_real_canopy: '20' }),
      rec('3,1', 'ana', { collect_real_canopy: 'n/a' }),
      rec('4,1', 'ben', { collect_real_canopy: '30' }),
      rec('5,1', 'ben', { collect_real_canopy: '40' }),
      rec('6,1', 'ben', { collect_real_canopy: '1===2' }),
      rec('7,1', 'ben', { collect_real_canopy: '' }),
    ];
    const canopy = answerStats(answerTable(input(records))).numbers[0];
    expect(canopy.key).toBe('collect_real_canopy');
    expect(canopy.label).toBe('Canopy');
    expect(canopy.team).toEqual({ values: 4, nonNumeric: 2, median: 25, q1: 17.5, q3: 32.5 });
    expect(canopy.people).toEqual([
      { username: 'ana', values: 2, nonNumeric: 1, median: 15, q1: 12.5, q3: 17.5 },
      { username: 'ben', values: 2, nonNumeric: 1, median: 35, q1: 32.5, q3: 37.5 },
    ]);
  });
});
