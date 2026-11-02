import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { qualityFigures, tableBuffers } from '../src/answerStats.js';
import type { QualityInput, QualityRecord } from '../src/quality.js';
import {
  LOW_AGREEMENT,
  MAX_HEALTH_ROWS,
  looksLikeOther,
  sortRows,
  surveyHealth,
  type HealthRow,
} from '../src/surveyHealth.js';
import { readCep } from '../src/cep.js';
import { surveyOutline, type Question } from '../src/surveyOutline.js';
import { idOnlyCep } from './fixtures/cep.js';

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

const LAND = 'collect_code_land_use';
const COVER = 'collect_code_cover';
const CANOPY = 'collect_real_canopy';
const TREES = 'collect_code_trees';

const outline = new Map<string, Question>(
  [
    question(LAND, 'choice', {
      label: 'Land use',
      required: true,
      options: [
        { code: 'F', label: 'Forest' },
        { code: 'C', label: 'Cropland' },
        // Labelled in Spanish by default, "Other (specify)" in English.
        { code: 'O', label: 'Otro (especificar)' },
      ],
      optionLabels: { O: ['Other (specify)'] },
    }),
    question(COVER, 'choice', {
      label: 'Cover',
      multiple: true,
      options: [
        { code: 'trees', label: 'Trees' },
        { code: 'unknown', label: '' },
        { code: '99', label: 'No data' },
      ],
    }),
    question(CANOPY, 'number', { label: 'Canopy' }),
    question(TREES, 'choice', { label: 'Trees', calculated: true, options: [{ code: 'Y', label: 'Yes' }] }),
  ].map((q) => [q.key, q]),
);

const day = Date.UTC(2026, 9, 28, 12);

function rec(recordKey: string, operator: string, summary: Record<string, string>, extra: Partial<QualityRecord> = {}): QualityRecord {
  return { recordKey, operator, summary, modifiedOn: day, activelySaved: true, deleted: false, ...extra };
}

function input(records: QualityRecord[]): QualityInput {
  const units = new Set<string>();
  for (const r of records) units.add(r.recordKey.split(',')[0]);
  return { records, info: added, units, copyHolders: new Map(), outline, margins: {} };
}

const row = (rows: readonly HealthRow[], key: string) => rows.find((r) => r.key === key)!;

describe('looksLikeOther: labels in 4 languages and codes, conservatively', () => {
  it.each([
    ['O', 'Other'],
    ['O', 'Other (specify)'],
    ['O', 'others: please say which'],
    ['X', 'Unknown / not visible'],
    ['X', 'None of the above'],
    ['X', 'No data'],
    ['X', 'N/A'],
    ['X', "Don't know"],
    ['X', 'Otro'],
    ['X', 'Otra (especifique)'],
    ['X', 'Desconocido'],
    ['X', 'Ninguno'],
    ['X', 'Sin datos'],
    ['X', 'No sé'],
    ['X', 'Autre'],
    ['X', 'Inconnu'],
    ['X', 'Aucune'],
    ['X', 'Pas de données'],
    ['X', 'Outro'],
    ['X', 'Desconhecido'],
    ['X', 'Nenhum'],
    ['X', 'Sem dados'],
    ['X', 'Não sei'],
    ['X', 'OTHER - specify'],
  ])('%s labelled %s: yes', (code, label) => {
    expect(looksLikeOther(code, [label])).toBe(true);
  });

  it.each([
    ['OL', 'Other land'],
    ['OWL', 'Other wooded land'],
    ['X', 'Otherwise forested'],
    ['X', 'Otros bosques'],
    ['X', 'Autres terres boisées'],
    ['X', 'Outras terras'],
    ['X', 'No change'],
    ['X', 'No se observa cambio'],
    ['X', 'Nonetheless forest'],
    ['X', 'Unknown-origin plantation'],
    ['99', 'Forest'],
    ['other', 'Grassland'],
  ])('%s labelled %s: no', (code, label) => {
    expect(looksLikeOther(code, [label])).toBe(false);
  });

  it('matches in any of the labels (other languages), and by the code only when no label is its own', () => {
    expect(looksLikeOther('O', ['Forêt', 'Bosque'])).toBe(false);
    expect(looksLikeOther('O', ['Bosque', 'Autre'])).toBe(true);
    for (const code of ['other', 'Other', 'unknown', 'none', '99', '999', 'no_data', 'NA']) {
      expect(looksLikeOther(code, [''])).toBe(true);
      expect(looksLikeOther(code, [code])).toBe(true);
    }
    for (const code of ['F', '9', '98', '0', 'oth_forest']) expect(looksLikeOther(code, [])).toBe(false);
  });
});

describe('looksLikeOther on the demo survey (labels in en, fr, pt, es)', () => {
  it('finds "Other", "N/A" and "No data", not "Otherland", "Other plantation" or "0 Points – No Coverage"', () => {
    const files = readCep(idOnlyCep());
    const outline = surveyOutline(new TextDecoder().decode(files.entries.get(files.surveyPath)!));
    const found = new Set<string>();
    for (const q of outline.values()) {
      for (const o of q.options ?? []) {
        if (looksLikeOther(o.code, [o.label, ...(q.optionLabels?.[o.code] ?? [])])) found.add(`${o.code}: ${o.label}`);
      }
    }
    expect([...found].sort()).toEqual(['0: No Data', '0: No data', 'na: N/A', 'other_otherland: Other', 'other_wetlands: Other']);
  });
});

describe('survey health', () => {
  /**
   * 40 first assessments (plots 1-40): land use forest, but O on plots 1-6, blank on
   * 7-14, absent (an older record) on 15-20; cover trees or both trees and 99 on 1-3;
   * canopy a number, text on plot 40. Checks of plots 1-30: land use cropland on 1-10.
   */
  function project() {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 40; i++) {
      const s: Record<string, string> = { [CANOPY]: i === 40 ? 'dense' : '50', [COVER]: i <= 3 ? 'trees===99' : 'trees', [TREES]: 'Y' };
      if (i <= 6) s[LAND] = 'O::eucalyptus';
      else if (i <= 14) s[LAND] = '';
      else if (i > 20) s[LAND] = 'F';
      records.push(rec(`${i},1`, i % 2 ? 'ana' : 'ben', s));
    }
    for (let i = 1; i <= 30; i++) {
      const first = records[i - 1].summary;
      records.push(rec(`${i},2`, 'carl', { ...first, [LAND]: i <= 10 ? 'C' : (first[LAND] ?? '') }, { modifiedOn: day + 1000 }));
    }
    return qualityFigures(input(records));
  }

  it('counts empty, not known, other-like answers and agreement per question', () => {
    const figures = project();
    const health = surveyHealth(figures, []);
    expect(health.plots).toBe(40);
    expect(health.plotsChecked).toBe(30);
    const land = row(health.questions, LAND);
    expect(land).toMatchObject({ label: 'Land use', kind: 'choice', required: true, answered: 26, blank: 8, notKnown: 6, nonNumeric: 0 });
    // 8 blank of the 34 plots where it is known.
    expect(land.emptyShare).toBeCloseTo(8 / 34);
    // O ("Otro (especificar)", "Other (specify)") on 6 of the 26 answering.
    expect(land.other).toEqual({ count: 6, share: 6 / 26, answers: [{ code: 'O', label: 'Otro (especificar)', count: 6 }] });
    // Of the 30 checks, plots 11-20 are blank (or absent) on both sides: not compared;
    // 1-10 differ (cropland), 21-30 agree.
    expect(land.agreement).toEqual({ compared: 20, agreeing: 10, rate: 0.5 });
    expect(land.agreement!.rate!).toBeLessThan(LOW_AGREEMENT);
    expect(land.reasons).toEqual(['low_agreement', 'often_other', 'often_empty']);

    const cover = row(health.questions, COVER);
    // A multiple answer: plots 1-3 hold "99" (No data) with trees: each plot once.
    expect(cover.other).toEqual({ count: 3, share: 3 / 40, answers: [{ code: '99', label: 'No data', count: 3 }] });
    expect(cover.reasons).toEqual([]);

    const canopy = row(health.questions, CANOPY);
    expect(canopy).toMatchObject({ answered: 39, nonNumeric: 1, blank: 0, notKnown: 0, emptyShare: 0, other: null });
    expect(row(health.questions, TREES).calculated).toBe(true);
    // Worth rewording first.
    expect(health.questions[0].key).toBe(LAND);
  });

  it('a question every first assessment left blank is still listed', () => {
    const records = Array.from({ length: 25 }, (_, i) => rec(`${i + 1},1`, 'ana', { [LAND]: '', [CANOPY]: '3' }));
    const health = surveyHealth(qualityFigures(input(records)), []);
    expect(row(health.questions, LAND)).toMatchObject({ answered: 0, blank: 25, emptyShare: 1, reasons: ['often_empty'] });
  });

  it('shares need 20 plots: under them they are null and give no reason', () => {
    const records = Array.from({ length: 19 }, (_, i) => rec(`${i + 1},1`, 'ana', { [LAND]: i < 10 ? '' : 'O' }));
    const land = row(surveyHealth(qualityFigures(input(records)), []).questions, LAND);
    expect(land.emptyShare).toBeNull();
    expect(land.other!.share).toBeNull();
    expect(land.reasons).toEqual([]);
  });

  it('counts how often a question changed on plots decided for the check (the latest check), not first or recheck', () => {
    const figures = project();
    const plots = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
    const decisions = [
      ...plots(1, 6).map((plot) => ({ plot, decision: 'check' as const })),
      ...plots(7, 8).map((plot) => ({ plot, decision: 'first' as const })),
      { plot: '9', decision: 'recheck' as const },
      // Agreeing plots decided for the check count as decided, not as changed.
      ...plots(21, 22).map((plot) => ({ plot, decision: 'check' as const })),
      // Not a checked plot.
      { plot: '35', decision: 'check' as const },
    ];
    const health = surveyHealth(figures, decisions);
    expect(health.decidedForCheck).toBe(8);
    const land = row(health.questions, LAND);
    expect(land.decisions).toEqual({ changed: 6, share: 6 / 8 });
    expect(land.reasons).toContain('often_changed');
    expect(row(health.questions, CANOPY).decisions).toEqual({ changed: 0, share: 0 });
    expect(surveyHealth(figures, []).questions.every((r) => r.decisions.share === null)).toBe(true);
  });

  it('takes the latest check of a plot checked twice', () => {
    const records: QualityRecord[] = [];
    for (let i = 1; i <= 5; i++) {
      records.push(rec(`${i},1`, 'ana', { [LAND]: 'F' }));
      records.push(rec(`${i},2`, 'ben', { [LAND]: 'C' }, { modifiedOn: day + 1 }));
      records.push(rec(`${i},2`, 'carl', { [LAND]: 'F' }, { modifiedOn: day + 2 }));
    }
    const decisions = ['1', '2', '3', '4', '5'].map((plot) => ({ plot, decision: 'check' as const }));
    const land = row(surveyHealth(qualityFigures(input(records)), decisions).questions, LAND);
    // carl's latest checks agree: nothing changed.
    expect(land.decisions.changed).toBe(0);
  });

  it('sorts by low agreement (lowest first), then other, then empty, then changed, then the survey order', () => {
    const base = (key: string, reasons: HealthRow['reasons'], over: Partial<HealthRow> = {}): HealthRow => ({
      key, label: key, kind: 'choice', calculated: false, required: false, answered: 100, blank: 0, notKnown: 0, nonNumeric: 0,
      emptyShare: 0, other: { count: 0, share: 0, answers: [] }, agreement: null, decisions: { changed: 0, share: null }, reasons, ...over,
    });
    const rows = [
      base('none', []),
      base('empty', ['often_empty'], { emptyShare: 0.5 }),
      base('other30', ['often_other'], { other: { count: 30, share: 0.3, answers: [] } }),
      base('agree70', ['low_agreement'], { agreement: { compared: 50, agreeing: 35, rate: 0.7 } }),
      base('agree50', ['low_agreement'], { agreement: { compared: 50, agreeing: 25, rate: 0.5 } }),
      base('other60', ['often_other'], { other: { count: 60, share: 0.6, answers: [] } }),
      base('changed', ['often_changed'], { decisions: { changed: 9, share: 0.9 } }),
      base('none2', []),
    ];
    expect(sortRows(rows).map((r) => r.key)).toEqual(['agree50', 'agree70', 'other60', 'other30', 'empty', 'changed', 'none', 'none2']);
  });

  it('caps the rows sent and hands its arrays over between threads', () => {
    const many = new Map<string, Question>();
    const summary: Record<string, string> = {};
    for (let i = 0; i < MAX_HEALTH_ROWS + 5; i++) {
      many.set(`collect_integer_n${i}`, question(`collect_integer_n${i}`, 'number'));
      summary[`collect_integer_n${i}`] = '1';
    }
    const figures = qualityFigures({ ...input([rec('1,1', 'ana', summary), rec('1,2', 'ben', summary)]), outline: many });
    const health = surveyHealth(figures, []);
    expect(health.questions).toHaveLength(MAX_HEALTH_ROWS);
    expect(health.questionsTotal).toBe(MAX_HEALTH_ROWS + 5);
    const buffers = tableBuffers(figures.answers, figures.flags, figures.health);
    expect(buffers).toContain(figures.health.checked.offsets.buffer);
  });
});
