import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { qualityFigures, tableBuffers } from '../src/answerStats.js';
import { DEFAULT_FAST_SECONDS, fastSecondsOf, flagCountsOf, MAX_LISTED_FLAGS, patternFlags, type Flag, type FlagOptions } from '../src/flags.js';
import type { QualityInput, QualityRecord } from '../src/quality.js';
import type { Question } from '../src/surveyOutline.js';
import type { DecisionKind } from '../src/types.js';

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
    question('collect_code_land_use', 'choice', { label: 'Land use', required: true }),
    question('collect_real_canopy', 'number', { label: 'Canopy' }),
    question('collect_text_notes', 'text'),
    question('collect_code_slope', 'choice', { label: 'Slope', required: true }),
    question('collect_code_fromcsv', 'choice', { excluded: true }),
    question('collect_real_area', 'number', { calculated: true }),
  ].map((q) => [q.key, q]),
);

const t0 = Date.UTC(2026, 9, 28, 9);
const s = (n: number) => n * 1000;

function rec(recordKey: string, operator: string, at: number, summary: Record<string, string>, extra: Partial<QualityRecord> = {}): QualityRecord {
  return { recordKey, operator, summary, modifiedOn: at, activelySaved: true, deleted: false, ...extra };
}

/** Three answers that differ from plot to plot (n), so only what a test sets up is "same as before". */
const answers = (n: number): Record<string, string> => ({ collect_code_land_use: n % 2 ? 'F' : 'C', collect_real_canopy: String(n), collect_code_slope: 'flat' });

function figuresOf(records: QualityRecord[], extra: Partial<QualityInput> = {}) {
  const units = new Set<string>();
  for (const r of records) units.add(r.recordKey.split(',')[0]);
  for (const u of ['77']) units.delete(u);
  return qualityFigures({ records, info: added, units, copyHolders: new Map(), outline, margins: {}, ...extra });
}

const flags = (records: QualityRecord[], options: Partial<FlagOptions> = {}, decisions: { plot: string; decision: DecisionKind; decidedAt: number }[] = []) =>
  patternFlags(figuresOf(records), decisions, { fastSeconds: DEFAULT_FAST_SECONDS, ...options });

const of = (list: Flag[], kind: Flag['kind']) => list.filter((f) => f.kind === kind);

describe('pattern flags: very fast', () => {
  it('a first assessment under the threshold after the same person\'s previous one, at the boundary', () => {
    const records = [
      rec('1,1', 'ana', t0, answers(1)),
      rec('2,1', 'ana', t0 + s(14.999), answers(2)), // 14.999 s: flagged
      rec('3,1', 'ana', t0 + s(14.999) + s(15), answers(3)), // exactly 15 s: not
      rec('4,1', 'ben', t0 + s(20), answers(4)), // another person's: no gap with ana
      rec('5,1', 'ben', t0 + s(60), answers(5)),
    ];
    const result = flags(records);
    expect(of(result.flags, 'very_fast')).toEqual([
      { kind: 'very_fast', plot: '2', operator: 'ana', at: t0 + s(14.999), details: { gapMs: 14_999, previousPlot: '1' } },
    ]);
    // The threshold is the project's: at 16 s, plot 3 too.
    expect(of(flags(records, { fastSeconds: 16 }).flags, 'very_fast').map((f) => f.plot)).toEqual(['3', '2']);
  });

  it('in the order the person saved them, whatever the records\' order; checks, drafts and plots in no file are not gaps', () => {
    const records = [
      rec('3,1', 'ana', t0 + s(100), answers(3)),
      rec('1,1', 'ana', t0, answers(1)),
      rec('2,1', 'ana', t0 + s(50), answers(2)),
      // A check (round 2), a draft and a plot in no file between them: not counted.
      rec('9,2', 'ana', t0 + s(55), answers(9)),
      rec('8,1', 'ana', t0 + s(56), answers(8), { activelySaved: false }),
      rec('77,1', 'ana', t0 + s(57), answers(7)),
      rec('4,1', 'ana', t0 + s(105), answers(4)),
    ];
    const units = new Set(['1', '2', '3', '4', '8', '9']);
    const result = patternFlags(figuresOf(records, { units }), [], { fastSeconds: 15 });
    expect(of(result.flags, 'very_fast')).toEqual([{ kind: 'very_fast', plot: '4', operator: 'ana', at: t0 + s(105), details: { gapMs: 5000, previousPlot: '3' } }]);
  });
});

describe('pattern flags: same as before', () => {
  const same = { collect_code_land_use: 'F', collect_real_canopy: '40', collect_code_slope: 'flat', collect_text_notes: 'ok' };

  it('every answer the same as the previous plot, in runs of 3 or more: the plots after the first of the run', () => {
    const records = [
      rec('1,1', 'ana', t0, answers(1)),
      rec('2,1', 'ana', t0 + s(60), same),
      rec('3,1', 'ana', t0 + s(120), same),
      rec('4,1', 'ana', t0 + s(180), { ...same }),
      rec('5,1', 'ana', t0 + s(240), answers(5)),
      // A run of two: not flagged.
      rec('6,1', 'ana', t0 + s(300), same),
      rec('7,1', 'ana', t0 + s(360), same),
    ];
    const result = of(flags(records).flags, 'same_as_before');
    expect(result.map((f) => f.plot)).toEqual(['4', '3']);
    expect(result[1]).toEqual({ kind: 'same_as_before', plot: '3', operator: 'ana', at: t0 + s(120), details: { previousPlot: '2', runLength: 3, firstPlot: '2', answers: 4 } });
  });

  it('a different answer, another person, fewer than 3 answers, or a blank answer breaks or does not make a run; excluded and calculated keys are not compared', () => {
    const two = { collect_code_land_use: 'F', collect_code_slope: 'flat' };
    const base = { ...same, collect_code_fromcsv: 'x' };
    const records = [
      rec('1,1', 'ana', t0, two),
      rec('2,1', 'ana', t0 + s(60), two),
      rec('3,1', 'ana', t0 + s(120), two), // only 2 answers: never "same"
      rec('4,1', 'ben', t0, base),
      rec('5,1', 'ben', t0 + s(60), { ...base, collect_code_fromcsv: 'y', collect_real_area: '9' }), // plot-file and calculated values differ: still the same
      rec('6,1', 'ben', t0 + s(120), { ...base, collect_text_notes: '' }), // a blank note: not the same
      rec('7,1', 'carl', t0, same),
      rec('8,1', 'dora', t0 + s(1), same), // another person
      rec('9,1', 'carl', t0 + s(2), same),
    ];
    const result = of(flags(records).flags, 'same_as_before');
    expect(result).toEqual([]);
    const longer = [...records, rec('10,1', 'ben', t0 + s(30), base)];
    // ben: 4, 10, 5 the same (6 differs): plots 10 and 5.
    expect(of(flags(longer).flags, 'same_as_before').map((f) => f.plot)).toEqual(['5', '10']);
  });
});

describe('pattern flags: required left empty', () => {
  it('a required question blank in the summary; one absent (a survey without it) or answered is not', () => {
    const records = [
      rec('1,1', 'ana', t0, { collect_code_land_use: '', collect_code_slope: 'null', collect_real_canopy: '3' }),
      rec('2,1', 'ana', t0 + s(60), { collect_code_land_use: 'F' }),
      rec('3,1', 'ana', t0 + s(120), { collect_code_land_use: 'F', collect_code_slope: 'flat', collect_real_canopy: '' }), // canopy is not required
      rec('4,2', 'ben', t0 + s(130), { collect_code_land_use: '' }), // a check: never
    ];
    const result = of(flags(records).flags, 'required_empty');
    expect(result).toEqual([
      {
        kind: 'required_empty',
        plot: '1',
        operator: 'ana',
        at: t0,
        details: { questions: [{ key: 'collect_code_land_use', label: 'Land use' }, { key: 'collect_code_slope', label: 'Slope' }] },
      },
    ]);
    expect(flags(records).requiredQuestions).toBe(2);
  });
});

describe('pattern flags: edited after a decision', () => {
  it('a record of the decided plot saved after the decision, each person once (their latest save); drafts and checks too; not after "both need another look"', () => {
    const decidedAt = t0 + s(1000);
    const records = [
      rec('1,1', 'ana', decidedAt + 1, answers(1)),
      rec('1,2', 'ben', decidedAt + 5, answers(2), { activelySaved: false }), // a check, now a draft
      rec('2,1', 'ana', decidedAt, answers(3)), // at the decision: not after
      rec('3,1', 'ana', decidedAt + 10, answers(4)),
      rec('4,1', 'ana', decidedAt + 10, answers(5), { deleted: true }),
    ];
    const decisions = [
      { plot: '1', decision: 'first' as const, decidedAt },
      { plot: '2', decision: 'check' as const, decidedAt },
      { plot: '3', decision: 'recheck' as const, decidedAt },
      { plot: '4', decision: 'first' as const, decidedAt },
    ];
    const result = of(flags(records, {}, decisions).flags, 'edited_after_decision');
    expect(result.sort((a, b) => a.operator.localeCompare(b.operator))).toEqual([
      { kind: 'edited_after_decision', plot: '1', operator: 'ana', at: decidedAt + 1, details: { decision: 'first', decidedAt } },
      { kind: 'edited_after_decision', plot: '1', operator: 'ben', at: decidedAt + 5, details: { decision: 'first', decidedAt } },
    ]);
  });
});

describe('pattern flags: the report\'s data problems', () => {
  it('two first assessments and a plot in no file come from the report, counted per person', () => {
    const records = [rec('1,1', 'ana', t0, answers(1)), rec('1,1', 'carl', t0 + s(100), answers(2)), rec('77,1', 'ana', t0 + s(200), answers(3))];
    const figures = figuresOf(records);
    const result = patternFlags(figures, [], { fastSeconds: 15 });
    const listed = result.flags.filter((f) => f.kind === 'two_main' || f.kind === 'no_plot');
    expect(listed).toEqual([
      { kind: 'no_plot', plot: '77', operator: 'ana', at: t0 + s(200), details: { recordKey: '77,1' } },
      { kind: 'two_main', plot: '1', operator: 'carl', at: t0 + s(100), details: { recordKey: '1,1' } },
      { kind: 'two_main', plot: '1', operator: 'ana', at: t0, details: { recordKey: '1,1' } },
    ]);
    expect(result.counts).toMatchObject({ two_main: 2, no_plot: 1 });
    expect(result.people.find((p) => p.username === 'ana')!.counts).toMatchObject({ two_main: 1, no_plot: 1 });
    expect(figures.report.problemsByPerson).toEqual([
      { operator: 'ana', kind: 'no_plot', count: 1 },
      { operator: 'ana', kind: 'two_main', count: 1 },
      { operator: 'carl', kind: 'two_main', count: 1 },
    ]);
  });
});

describe('pattern flags: filters, counts and what they name', () => {
  const records = [
    rec('1,1', 'ana', t0, answers(1)),
    rec('2,1', 'ana', t0 + s(5), answers(2)),
    rec('3,1', 'ana', t0 + s(10), { ...answers(3), collect_code_slope: '' }),
    rec('4,1', 'ben', t0, answers(4)),
    rec('5,1', 'ben', t0 + s(5), answers(5)),
    rec('1,2', 'ben', t0 + s(100), answers(6)), // ben checks ana's plot 1
  ];

  it('by person and by kind; the counts per kind are the person\'s, those per person everyone\'s', () => {
    const all = flags(records);
    expect(all.counts).toMatchObject({ very_fast: 3, required_empty: 1 });
    expect(all.total).toBe(4);
    expect(all.people).toEqual([
      { username: 'ana', counts: expect.objectContaining({ very_fast: 2, required_empty: 1 }), total: 3 },
      { username: 'ben', counts: expect.objectContaining({ very_fast: 1 }), total: 1 },
    ]);
    const ana = flags(records, { person: 'ana', kind: 'very_fast' });
    expect(ana.flags.map((f) => f.plot)).toEqual(['3', '2']);
    expect(ana.counts).toMatchObject({ very_fast: 2, required_empty: 1 });
    expect(ana.total).toBe(2);
    expect(ana.people).toHaveLength(2);
    expect(flagCountsOf(figuresOf(records), [], 15, 'ben')).toMatchObject({ very_fast: 1, required_empty: 0 });
  });

  it('a flag names only the flagged person: never the checker, nor anyone else', () => {
    const decisions = [{ plot: '1', decision: 'check' as const, decidedAt: t0 - 1 }];
    for (const f of flags(records, {}, decisions).flags) {
      const text = JSON.stringify(f);
      const others = ['ana', 'ben'].filter((n) => n !== f.operator);
      for (const other of others) expect(text).not.toContain(other);
    }
  });

  it('lists at most MAX_LISTED_FLAGS, newest first, and counts them all', () => {
    const many = Array.from({ length: MAX_LISTED_FLAGS + 20 }, (_, i) => rec(`${i + 1},1`, 'ana', t0 + i * 1000, answers(i)));
    const result = flags(many);
    expect(result.total).toBe(MAX_LISTED_FLAGS + 19);
    expect(result.flags).toHaveLength(MAX_LISTED_FLAGS);
    expect(result.flags[0].at).toBeGreaterThan(result.flags[1].at!);
  });

  it('the tables cross between threads with the answer table', () => {
    const figures = figuresOf(records);
    const buffers = tableBuffers(figures.answers, figures.flags);
    expect(buffers).toContain(figures.flags.order.buffer);
    expect(new Set(buffers).size).toBe(buffers.length);
  });

  it('the threshold: the project\'s whole seconds 1-120, else 15', () => {
    expect(fastSecondsOf({})).toBe(15);
    expect(fastSecondsOf({ fastSeconds: 30 })).toBe(30);
    expect(fastSecondsOf({ fastSeconds: 0 })).toBe(15);
    expect(fastSecondsOf({ fastSeconds: 121 })).toBe(15);
    expect(fastSecondsOf({ fastSeconds: 2.5 })).toBe(15);
  });
});
