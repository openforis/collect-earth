// The survey designer's stage 1 (docs/plans/2026-11-18-survey-designer.md): the survey read as the designer shows it,
// on Collect's three Collect Earth templates, and GET /v1/projects/:pid/survey/design.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { namesUsed, readCondition } from '../src/survey/condition.js';
import { pageQuestions, surveyDesign } from '../src/survey/design.js';
import type { DesignQuestion, DesignTable, SurveyDesign, SurveyDesignAnswer } from '../src/wire/survey.js';
import { demoCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const design = (name: string) => surveyDesign(readFileSync(`${TEMPLATES}collect_earth${name}.idm.xml`));

const questions = new Map([
  ['code_demo', { yesNo: false }],
  ['yes_no_demo', { yesNo: true }],
  ['year', { yesNo: false }],
]);
const lookup = (name: string) => questions.get(name);

function everything(d: SurveyDesign): Array<DesignQuestion | DesignTable> {
  return [...d.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === 'table' ? [i, ...i.columns] : [i]))), ...d.fromPlotFile, ...d.calculated, ...d.hidden];
}

describe('reading a condition', () => {
  it('reads the rows the designer shows', () => {
    expect(readCondition("code_demo = 'B'", lookup)).toEqual({ kind: 'all', parts: [{ question: 'code_demo', test: 'is', value: 'B' }] });
    expect(readCondition('code_demo != "B"', lookup)).toEqual({ kind: 'all', parts: [{ question: 'code_demo', test: 'isNot', value: 'B' }] });
    expect(readCondition('yes_no_demo = true()', lookup)).toEqual({ kind: 'all', parts: [{ question: 'yes_no_demo', test: 'is', value: true }] });
    expect(readCondition('yes_no_demo', lookup)).toEqual({ kind: 'all', parts: [{ question: 'yes_no_demo', test: 'is', value: true }] });
    expect(readCondition('code_demo', lookup)).toEqual({ kind: 'all', parts: [{ question: 'code_demo', test: 'answered', value: null }] });
    expect(readCondition('boolean(code_demo)', lookup)).toEqual({ kind: 'all', parts: [{ question: 'code_demo', test: 'answered', value: null }] });
    expect(readCondition('not(code_demo)', lookup)).toEqual({ kind: 'all', parts: [{ question: 'code_demo', test: 'notAnswered', value: null }] });
    expect(readCondition('year > 2007', lookup)).toEqual({ kind: 'all', parts: [{ question: 'year', test: 'gt', value: 2007 }] });
    expect(readCondition("parent()/code_demo = 'A'", lookup)).toEqual({ kind: 'all', parts: [{ question: 'code_demo', test: 'is', value: 'A' }] });
    expect(readCondition('false()', lookup)).toEqual({ kind: 'never' });
  });

  it('joins rows by all or any, brackets around the whole taken off', () => {
    expect(readCondition("(code_demo = 'A' or code_demo= 'B')", lookup)).toEqual({
      kind: 'any',
      parts: [
        { question: 'code_demo', test: 'is', value: 'A' },
        { question: 'code_demo', test: 'is', value: 'B' },
      ],
    });
    expect(readCondition("yes_no_demo=true()\nand\ncode_demo = 'a and b'", lookup)).toEqual({
      kind: 'all',
      parts: [
        { question: 'yes_no_demo', test: 'is', value: true },
        { question: 'code_demo', test: 'is', value: 'a and b' },
      ],
    });
  });

  it('keeps as written what rows cannot say exactly', () => {
    for (const text of [
      "yes_no_demo and (code_demo = 'A' or code_demo = 'B')", // nested
      "code_demo = 'A' and yes_no_demo or year > 1", // mixed
      "starts-with(code_demo, 'Pl')", // a function
      "unknown = 'A'", // a question the survey does not have
      "land_cover[element='trees']/percentage > 0", // a path into a table
      "code_demo < 'A'", // a code compared as a number
      'year = true()', // yes on a number
    ]) {
      expect(readCondition(text, lookup), text).toEqual({ kind: 'advanced', text });
    }
  });

  it('finds the questions an expression uses, not words in quotes or functions', () => {
    const names = new Set(['lu', 'year', 'not']);
    expect(namesUsed("concat(lu, 'year') and not(year > 2007)", names).sort()).toEqual(['lu', 'year']);
  });
});

describe('the designer model of the templates', () => {
  it('basic: its pages and questions as the interpreter meets them, the rest kept apart', () => {
    const d = design('');
    expect(d.languages).toEqual(['en', 'es', 'fr', 'pt']);
    expect(d.pages.map((p) => p.label.en)).toEqual(['First tab with questions CHANGE!', 'Second tab (CHANGE!)']);
    expect(d.pages[0].label.es).toBe('Primera pestaña con preguntas CAMBIALO!');
    expect(pageQuestions(d.pages[0].items).map((q) => q.name)).toEqual(['short_text_demo', 'code_demo', 'yes_no_demo', 'memo_text_demo', 'integer_demo']);
    expect(d.fromPlotFile.map((q) => q.name)).toEqual(['elevation', 'slope', 'aspect']);
    expect(d.hidden.map((q) => q.name)).toEqual(['id', 'location', 'operator', 'actively_saved', 'actively_saved_on', 'plot_file']);
    expect(d.hidden.find((q) => q.name === 'id')?.key).toBe(true);
    expect(d.calculated.length).toBe(3);

    const [shortText, code, yesNo, memo, integer] = pageQuestions(d.pages[0].items);
    expect(shortText.rules).toEqual([{ flag: 'error', message: { en: 'You must fill at least 5 characters', es: expect.any(String), fr: expect.any(String), pt: expect.any(String) }, when: null, kind: 'length', min: 6, max: null }]);
    expect(code).toMatchObject({ type: 'choice', list: 'demo_codelist', required: 'always' });
    expect(yesNo.type).toBe('yesNo');
    expect(memo).toMatchObject({ type: 'memo', shownWhen: { kind: 'all', parts: [{ question: 'yes_no_demo', test: 'is', value: true }] } });
    expect(integer.rules[0]).toMatchObject({ kind: 'range', min: { bound: { number: 5 }, inclusive: false }, max: { bound: { number: 20 }, inclusive: false } });
    const date = pageQuestions(d.pages[1].items)[0];
    expect(date).toMatchObject({ name: 'demo_date', required: { when: { kind: 'all', parts: [{ question: 'code_demo', test: 'is', value: 'B' }] } } });

    const list = d.lists.find((l) => l.name === 'demo_codelist')!;
    expect(list.items.map((i) => i.code)).toEqual(['A', 'B']);
    expect(list.items[0].label.fr).toBe('Première Option A');
    expect(list.usedBy).toEqual(['code_demo']);
    expect(d.lists.find((l) => l.name === 'sampling_design')?.external).toBe(true);
  });

  it('IPCC: its tables, its sub-lists, its 105 calculated values and what they use', () => {
    const d = design('_ipcc');
    const landCover = d.pages[0].items[0] as DesignTable;
    expect(landCover).toMatchObject({ kind: 'table', name: 'land_cover', layout: 'table', rowsList: 'land_cover_elements' });
    const landUse = d.pages[1].items.find((i) => i.name === 'land_use') as DesignTable;
    expect(landUse.shownWhen).toEqual({ kind: 'all', parts: [{ question: 'plot_distribution', test: 'is', value: 'multiple' }] });
    const sub = pageQuestions(d.pages.flatMap((p) => p.items)).find((q) => q.name === 'land_use_subcategory')!;
    expect(sub).toMatchObject({ list: 'land_use_conversions', parentQuestion: 'land_use_category_alias', layout: 'buttons' });
    expect(d.calculated.length).toBe(105);
    const current = d.calculated.find((q) => q.name === 'ipcc_current_category');
    expect(current).toMatchObject({ formulas: [{ value: null, expression: 'substring( land_use_subcategory, 2, 1)', when: null }], uses: ['land_use_subcategory'], hidden: true, notExported: true });
    const year2000 = d.calculated.find((q) => q.name === 'ipcc_2000_subdivision')!;
    expect(year2000.formulas).toHaveLength(11);
    expect(year2000.formulas!.some((f) => f.when !== null)).toBe(true);
    const year = pageQuestions(d.pages.flatMap((p) => p.items)).find((q) => q.name === 'second_lu_conversion_year')!;
    // A year after 1980 and before the first change's: a limit can be another question
    expect(year.rules[0]).toMatchObject({
      kind: 'range',
      min: { bound: { number: 1980 }, inclusive: false },
      max: { bound: { question: 'land_use_subcategory_year_of_change' }, inclusive: false },
      when: { kind: 'all', parts: [{ question: 'land_use_category_has_changed', test: 'is', value: true }] },
    });
    expect(d.counts).toEqual({ formulas: 561 });
  });

  it('keeps a hidden table off its page, as the desktop form does; required if true() is required', () => {
    const text = (name: string) => readFileSync(`${TEMPLATES}collect_earth${name}.idm.xml`, 'latin1');
    const changed = (name: string, from: string, to: string) => {
      expect(text(name)).toContain(from);
      return surveyDesign(Buffer.from(text(name).replace(from, to), 'latin1'));
    };
    for (const hide of ['ui:hide="true" ', 'relevant="false()" ']) {
      const d = changed('_ipcc', '<entity id="15" name="land_cover" ', `<entity id="15" name="land_cover" ${hide}`);
      expect(d.pages.flatMap((p) => p.items).some((i) => i.name === 'land_cover')).toBe(false);
      expect(d.hidden.map((q) => q.name)).toEqual(expect.arrayContaining(['element', 'coverage', 'percentage']));
    }
    const d = changed('', 'name="code_demo" required="true"', 'name="code_demo" requiredIf=" true() "');
    expect(pageQuestions(d.pages[0].items).find((q) => q.name === 'code_demo')?.required).toBe('always');
  });

  it('every condition of the three templates reads as rows but the two starts-with and one nested group', () => {
    const advanced: string[] = [];
    let conditions = 0;
    for (const name of ['', '_ipcc', '_multipurpose']) {
      const d = design(name);
      for (const q of everything(d)) {
        const all = [q.shownWhen, ...(q.kind === 'question' ? [typeof q.required === 'object' ? q.required.when : null, ...q.rules.map((r) => r.when)] : [])];
        for (const c of all) {
          if (!c) continue;
          conditions++;
          if (c.kind === 'advanced') advanced.push(c.text);
        }
      }
    }
    expect(conditions).toBeGreaterThan(60);
    expect(advanced.filter((t) => t.startsWith('starts-with'))).toHaveLength(2);
    // The rules' conditions that look into tables ("land_cover[element='grass']/percentage"), and one nested group
    expect(advanced.filter((t) => !t.startsWith('starts-with') && !t.includes('['))).toHaveLength(1);
  });

  it('multipurpose (tabs, a label with no language): read the same way', () => {
    const d = design('_multipurpose');
    expect(d.title.en).toBe('Template - ART-TREES + UNFCCC RL + IPCC AFOLU');
    expect(d.lists.find((l) => l.name === 'five')?.label.en).toBe('Five-year threshold');
    expect(d.pages.map((p) => p.name)).toEqual(['tab_63365', 'tab_2066549', 'tab_2065254']);
    const change = d.pages[1].items[0] as DesignTable;
    expect(change).toMatchObject({ kind: 'table', name: 'change', layout: 'block', rowsList: null });
    expect(change.columns.find((c) => c.name === 'from_sub_actual')).toBeDefined();
  });
});

describe('GET /v1/projects/:pid/survey/design', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('answers no design before a project file, the design after, and only to coordinators', async () => {
    const p = await createProject(ctx.app);
    const get = (token: string) => ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(token) });
    const before = await get(p.adminToken);
    expect(before.statusCode).toBe(200);
    expect(before.json()).toEqual({ design: null, unreadable: false, revision: null, editable: true, peopleWithFile: 0, olderSurveyPlots: 0, problems: [] } satisfies SurveyDesignAnswer);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: demoCep() });
    expect(up.statusCode, up.body).toBeLessThan(300);
    const after = (await get(p.adminToken)).json() as SurveyDesignAnswer;
    expect(after.unreadable).toBe(false);
    expect(after.problems).toEqual([]);
    expect(after.design?.pages.length).toBeGreaterThan(0);
    expect(after.design?.hidden.map((q) => q.name)).toEqual(expect.arrayContaining(['id', 'round', 'operator']));
    expect((await get(p.projectToken)).statusCode).toBe(403);
  });
});
