import { describe, expect, it } from 'vitest';
import { calibrationFigures, fleissKappa, goldenFromConsensus, latestAnswers, learningScore, openAttempt, type Answered } from '../src/training.js';
import type { RecordRow, TrainingGolden } from '../src/types.js';

const record = (recordKey: string, operator: string, summary: Record<string, string>, modifiedOn = 1000, extra: Partial<RecordRow> = {}): RecordRow => ({
  projectId: 'p',
  recordKey,
  operator,
  modifiedOn,
  receivedAt: modifiedOn,
  activelySaved: true,
  step: 1,
  xml: null,
  summary,
  deleted: false,
  deletedOn: null,
  ...extra,
});

const answers = (rows: [string, string, Record<string, string>][]) => {
  const out = new Map<string, Map<string, Answered>>();
  for (const [plot, operator, summary] of rows) {
    if (!out.has(plot)) out.set(plot, new Map());
    out.get(plot)!.set(operator, { operator, modifiedOn: 1, summary });
  }
  return out;
};

describe('training figures', () => {
  it('takes each person\'s latest submitted record of each plot, from a time on', () => {
    const rows = [
      record('1', 'ana', { collect_code_lu: 'F' }, 1000),
      record('1', 'ana', { collect_code_lu: 'C' }, 500),
      record('2', 'ana', { collect_code_lu: 'F' }, 1000, { activelySaved: false }),
      record('3', 'ana', { collect_code_lu: 'F' }, 1000, { deleted: true }),
      record('1', 'bo', { collect_code_lu: 'G' }, 100),
      record('9', 'bo', { collect_code_lu: 'G' }, 2000),
    ];
    const latest = latestAnswers(rows, ['1', '2', '3'], null, (op) => (op === 'bo' ? 200 : 0));
    expect([...latest.keys()]).toEqual(['1']);
    expect([...latest.get('1')!.keys()]).toEqual(['ana']);
  });

  it('Fleiss\' kappa: 1 when all agree on different answers, null when all give one answer, below 0 when they always split', () => {
    expect(fleissKappa([['a', 'a'], ['b', 'b']])).toBeCloseTo(1);
    expect(fleissKappa([['a', 'a'], ['a', 'a']])).toBeNull();
    expect(fleissKappa([['a', 'b'], ['a', 'b']])).toBeLessThan(0);
    expect(fleissKappa([['a']])).toBeNull();
    // The textbook example's shape: varying agreement gives a value between.
    const k = fleissKappa([['a', 'a', 'a'], ['a', 'a', 'b'], ['b', 'b', 'b'], ['a', 'b', 'b']])!;
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(1);
  });

  it('calibration: answers per plot and question, pairs that agree, the proposed agreed answer, each person against it', () => {
    const figures = calibrationFigures({
      plots: ['1', '2'],
      participants: ['ana', 'bo', 'cy'],
      answers: answers([
        ['1', 'ana', { collect_code_lu: 'F', collect_real_cover: '50' }],
        ['1', 'bo', { collect_code_lu: 'F', collect_real_cover: '54' }],
        ['1', 'cy', { collect_code_lu: 'C', collect_real_cover: '90' }],
        ['2', 'ana', { collect_code_lu: 'G' }],
        ['2', 'bo', { collect_code_lu: 'C' }],
      ]),
      outline: null,
      margins: {},
    });
    const lu = figures.plots[0].questions.find((q) => q.key === 'collect_code_lu')!;
    expect(lu.answers).toEqual([
      { value: 'F', count: 2, people: ['ana', 'bo'] },
      { value: 'C', count: 1, people: ['cy'] },
    ]);
    expect(lu.pairs).toEqual({ compared: 3, agreeing: 1, rate: 1 / 3 });
    expect(lu.consensus).toBe('F');
    const cover = figures.plots[0].questions.find((q) => q.key === 'collect_real_cover')!;
    // 50 and 54 agree within the 10% margin; the median is proposed.
    expect(cover.pairs.agreeing).toBe(1);
    expect(cover.consensus).toBe('54');
    // A tie proposes nothing.
    expect(figures.plots[1].questions[0].consensus).toBeNull();
    const cy = figures.people.find((p) => p.username === 'cy')!;
    expect(cy.withConsensus).toEqual({ compared: 2, agreeing: 0, rate: 0 });
    expect(figures.questions.map((q) => q.key)).toEqual(['collect_code_lu', 'collect_real_cover']);
    expect(figures.questions[1].kappa).toBeNull();
    expect(goldenFromConsensus(figures)).toEqual([{ plotKey: '1', answers: { collect_code_lu: 'F', collect_real_cover: '54' } }]);
  });

  it('learning: answers against the golden ones, only its questions, with the pass mark at the end only', () => {
    const golden = new Map<string, TrainingGolden>([
      ['1', { plotKey: '1', answers: { collect_code_lu: 'F', collect_real_cover: '50' }, note: 'Look at the canopy', updatedAt: 1, updatedBy: null }],
      ['2', { plotKey: '2', answers: { collect_code_lu: 'G' }, note: null, updatedAt: 1, updatedBy: null }],
    ]);
    const mine = new Map<string, Answered>([['1', { operator: 'ana', modifiedOn: 5, summary: { collect_code_lu: 'F', collect_real_cover: '80', collect_code_extra: 'x' } }]]);
    const half = learningScore({ plots: ['1', '2', '3'], golden, answers: mine, outline: null, margins: {}, passMark: 50 });
    expect(half.plots).toBe(2);
    expect(half.submitted).toBe(1);
    expect(half.answers).toEqual({ compared: 2, agreeing: 1, rate: 0.5 });
    expect(half.passed).toBeNull();
    expect(half.byPlot[0].questions.map((q) => [q.key, q.golden, q.given, q.right])).toEqual([
      ['collect_code_lu', 'F', 'F', true],
      ['collect_real_cover', '50', '80', false],
    ]);
    mine.set('2', { operator: 'ana', modifiedOn: 6, summary: { collect_code_lu: 'G' } });
    const done = learningScore({ plots: ['1', '2', '3'], golden, answers: mine, outline: null, margins: {}, passMark: 60 });
    expect(done.answers.rate).toBeCloseTo(2 / 3);
    expect(done.plotsRight).toBe(1);
    expect(done.passed).toBe(true);
    expect(learningScore({ plots: ['1', '2'], golden, answers: mine, outline: null, margins: {}, passMark: 70 }).passed).toBe(false);
  });

  it('the open attempt: the highest without results, attempt 1 from the start when none is stored', () => {
    expect(openAttempt([], 'u')).toEqual({ number: 1, startedAt: 0 });
    expect(
      openAttempt(
        [
          { userId: 'u', number: 1, startedAt: 10, results: { x: 1 } },
          { userId: 'u', number: 2, startedAt: 20, results: null },
          { userId: 'v', number: 5, startedAt: 30, results: null },
        ],
        'u',
      ),
    ).toEqual({ number: 2, startedAt: 20 });
  });
});
