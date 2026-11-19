// The survey designer's stage 3 (docs/plans/2026-11-18-survey-designer.md): pages, questions and answer lists added,
// moved and deleted, questions made required; what that does to the plots already collected, counted before saving.
// The changed basic template is written to the desktop's test resources, where DesignedSurveyIdmlTest reads it with
// Collect and checks it as Collect's designer and Collect Earth would.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipCep } from '../src/cep.js';
import { surveyDesign } from '../src/survey/design.js';
import { slugName, SurveyEdit, SurveyEditError, uniqueName } from '../src/survey/edit.js';
import { surveyImpact, type ImpactRecord } from '../src/survey/impact.js';
import type { DesignQuestion, SurveyDesignAnswer, SurveyImpactAnswer, SurveyOperation } from '../src/wire/survey.js';
import { FIXTURE_DATE, realDemoCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const DESIGNER = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/designer/', import.meta.url));
const basic = readFileSync(`${TEMPLATES}collect_earth.idm.xml`);
const design = surveyDesign(basic);
const all = (d = design) => [...d.pages.flatMap((p) => p.items), ...d.hidden, ...d.fromPlotFile, ...d.calculated] as DesignQuestion[];
const id = (name: string) => all().find((q) => q.name === name)!.id;
const apply = (survey: Buffer, ...ops: SurveyOperation[]) => {
  const s = new SurveyEdit(survey);
  for (const op of ops) s.apply(op);
  return s.bytes();
};
const pageNames = (survey: Buffer) => surveyDesign(survey).pages.map((p) => p.items.map((i) => i.name));

describe('names made from labels', () => {
  it('as Collect and Collect Earth take them', () => {
    expect(slugName('Tree cover (%)', 'question')).toBe('tree_cover');
    expect(slugName('Año de cambio', 'question')).toBe('ano_de_cambio');
    expect(slugName('Land use 2020', 'question')).toBe('land_use2020');
    expect(slugName('2nd visit', 'question')).toBe('question_2nd_visit');
    expect(slugName('¿?', 'list')).toBe('list');
    expect(slugName('x'.repeat(80), 'q')).toHaveLength(40);
    expect(uniqueName('water', new Set(['water', 'water_b']))).toBe('water_c');
  });
});

describe("the designer's operations on pages, questions and lists", () => {
  it('adds a question of each kind at the end of a page, named from its label', () => {
    const out = apply(
      basic,
      { op: 'addList', label: { en: 'Water bodies' }, items: [{ code: 'river', label: { en: 'River' } }, { code: 'lake', label: { en: 'Lake', es: 'Lago' } }] },
      { op: 'addQuestion', type: 'choice', label: { en: 'Kind of water' }, page: 'plot_tab', list: 'water_bodies', required: true },
      { op: 'addQuestion', type: 'choices', label: { en: 'Kinds of water' }, page: 'plot_tab', list: 'water_bodies' },
      { op: 'addQuestion', type: 'yesNo', label: { en: 'Burnt?' }, page: 'plot_tab' },
      { op: 'addQuestion', type: 'integer', label: { en: 'Trees' }, page: 'tab_1312' },
      { op: 'addQuestion', type: 'decimal', label: { en: 'Tree height' }, page: 'tab_1312' },
      { op: 'addQuestion', type: 'text', label: { en: 'Note' }, page: 'tab_1312' },
      { op: 'addQuestion', type: 'memo', label: { en: 'Long note' }, page: 'tab_1312' },
      { op: 'addQuestion', type: 'date', label: { en: 'Visit date' }, page: 'tab_1312', name: 'visit_on' },
    );
    const d = surveyDesign(out);
    expect(d.pages[0].items.slice(-3).map((q) => [q.name, q.kind === 'question' && q.type])).toEqual([
      ['kind_of_water', 'choice'],
      ['kinds_of_water', 'choices'],
      ['burnt', 'yesNo'],
    ]);
    expect(d.pages[1].items.map((q) => q.name)).toEqual(['demo_date', 'trees', 'tree_height', 'note', 'long_note', 'visit_on']);
    const water = d.pages[0].items.find((q) => q.name === 'kind_of_water') as DesignQuestion;
    expect(water).toMatchObject({ list: 'water_bodies', required: 'always', label: { en: 'Kind of water' } });
    expect(d.lists.find((l) => l.name === 'water_bodies')).toMatchObject({ label: { en: 'Water bodies' }, items: [{ code: 'river' }, { code: 'lake', label: { es: 'Lago' } }] });
    expect(new SurveyEdit(out).problems()).toEqual([]);
  });

  it('refuses a question without a page, a choice without its list, a name taken, a label in no language', () => {
    expect(() => apply(basic, { op: 'addQuestion', type: 'text', label: { en: 'x' } })).toThrow(/on a page/);
    expect(() => apply(basic, { op: 'addQuestion', type: 'choice', label: { en: 'x' }, page: 'plot_tab' })).toThrow(/answer list/);
    expect(() => apply(basic, { op: 'addQuestion', type: 'text', label: { en: 'x' }, page: 'plot_tab', name: 'code_demo' })).toThrow(/already/);
    expect(() => apply(basic, { op: 'addQuestion', type: 'text', label: { en: ' ' }, page: 'plot_tab' })).toThrow(/at least one language/);
    expect(() => apply(basic, { op: 'addQuestion', type: 'text', label: { sw: 'x' }, page: 'plot_tab' })).toThrow(/add it first/);
    // A second question of the same label gets another name
    const twice = apply(basic, { op: 'addQuestion', type: 'text', label: { en: 'Note' }, page: 'plot_tab' }, { op: 'addQuestion', type: 'text', label: { en: 'Note' }, page: 'plot_tab' });
    expect(pageNames(twice)[0].slice(-2)).toEqual(['note', 'note_b']);
  });

  it('moves a question before another, to the end of its page, to another page', () => {
    const before = pageNames(basic)[0];
    expect(before).toEqual(['short_text_demo', 'code_demo', 'yes_no_demo', 'memo_text_demo', 'integer_demo']);
    const up = apply(basic, { op: 'moveQuestion', id: id('integer_demo'), before: id('code_demo') });
    expect(pageNames(up)[0]).toEqual(['short_text_demo', 'integer_demo', 'code_demo', 'yes_no_demo', 'memo_text_demo']);
    const last = apply(basic, { op: 'moveQuestion', id: id('short_text_demo') });
    expect(pageNames(last)[0]).toEqual(['code_demo', 'yes_no_demo', 'memo_text_demo', 'integer_demo', 'short_text_demo']);
    const moved = apply(basic, { op: 'moveQuestion', id: id('integer_demo'), page: 'tab_1312' });
    expect(pageNames(moved)).toEqual([['short_text_demo', 'code_demo', 'yes_no_demo', 'memo_text_demo'], ['demo_date', 'integer_demo']]);
  });

  it("deletes a question nothing uses, and refuses one something uses, or one of Collect Earth's fields", () => {
    expect(() => apply(basic, { op: 'deleteQuestion', id: id('yes_no_demo') })).toThrow(/memo_text_demo/);
    expect(() => apply(basic, { op: 'deleteQuestion', id: id('operator') })).toThrow(SurveyEditError);
    expect(() => apply(basic, { op: 'deleteQuestion', id: id('id') })).toThrow(SurveyEditError);
    const out = apply(basic, { op: 'deleteQuestion', id: id('memo_text_demo') }, { op: 'deleteQuestion', id: id('yes_no_demo') });
    expect(pageNames(out)[0]).toEqual(['short_text_demo', 'code_demo', 'integer_demo']);
  });

  it('makes a question required or not, never a fixed or calculated one', () => {
    const out = apply(basic, { op: 'setRequired', id: id('short_text_demo'), required: true }, { op: 'setRequired', id: id('code_demo'), required: false });
    const items = surveyDesign(out).pages[0].items as DesignQuestion[];
    expect(items.find((q) => q.name === 'short_text_demo')!.required).toBe('always');
    expect(items.find((q) => q.name === 'code_demo')!.required).toBe('never');
    expect(() => apply(basic, { op: 'setRequired', id: id('plot_file'), required: true })).toThrow(SurveyEditError);
    expect(() => apply(basic, { op: 'setRequired', id: design.calculated[0].id, required: true })).toThrow(/calculated/);
  });

  it("adds, moves and deletes answers; refuses deleting one a condition compares with, or a list in use", () => {
    const out = apply(
      basic,
      { op: 'addItem', list: 'demo_codelist', item: { code: 'C', label: { en: 'Third' } } },
      { op: 'addItem', list: 'demo_codelist', item: { code: 'Z', label: { en: 'First of all' } }, before: 'A' },
      { op: 'moveItem', list: 'demo_codelist', code: 'C', before: 'A' },
      { op: 'deleteItem', list: 'demo_codelist', code: 'A' },
    );
    expect(surveyDesign(out).lists.find((l) => l.name === 'demo_codelist')!.items.map((i) => i.code)).toEqual(['Z', 'C', 'B']);
    expect(() => apply(basic, { op: 'deleteItem', list: 'demo_codelist', code: 'B' })).toThrow(/demo_date/);
    expect(() => apply(basic, { op: 'addItem', list: 'demo_codelist', item: { code: 'A', label: { en: 'Again' } } })).toThrow(/already/);
    expect(() => apply(basic, { op: 'deleteList', name: 'demo_codelist' })).toThrow(/code_demo/);
    const spare = { op: 'addList', label: { en: 'Spare' }, items: [{ code: 'x', label: { en: 'X' } }] } as const;
    const unused = apply(basic, spare, { op: 'deleteList', name: 'spare' });
    expect(unused.equals(apply(basic, spare))).toBe(false);
    expect(surveyDesign(unused).lists.some((l) => l.name === 'spare')).toBe(false);
  });

  it('adds, moves and deletes pages; a page with questions is not deleted', () => {
    const out = apply(basic, { op: 'addPage', label: { en: 'Soil', es: 'Suelo' }, before: 'tab_1312' });
    const d = surveyDesign(out);
    const soil = d.emptyPages[0];
    expect(soil.label).toEqual({ en: 'Soil', es: 'Suelo' });
    expect(d.pageOrder).toEqual(['plot_tab', soil.name, 'tab_1312']);
    const withQuestion = apply(out, { op: 'addQuestion', type: 'integer', label: { en: 'Stones' }, page: soil.name });
    expect(surveyDesign(withQuestion).pages.map((p) => p.name)).toEqual(['plot_tab', soil.name, 'tab_1312']);
    expect(() => apply(withQuestion, { op: 'deletePage', name: soil.name })).toThrow(/move its questions/);
    const moved = apply(out, { op: 'movePage', name: soil.name });
    expect(surveyDesign(moved).pageOrder).toEqual(['plot_tab', 'tab_1312', soil.name]);
    expect(surveyDesign(apply(out, { op: 'deletePage', name: soil.name })).pageOrder).toEqual(['plot_tab', 'tab_1312']);
    expect(() => apply(basic, { op: 'deletePage', name: 'plot_tab' })).toThrow(SurveyEditError);
  });

  // The survey DesignedSurveyIdmlTest reads with Collect: kept equal to what these changes write
  it("writes the trial of stage 3 the desktop's test reads", () => {
    const out = apply(
      basic,
      { op: 'addPage', label: { en: 'Water', es: 'Agua' } },
      { op: 'addList', label: { en: 'Water bodies' }, items: [{ code: 'river', label: { en: 'River' } }, { code: 'lake', label: { en: 'Lake' } }] },
      { op: 'addQuestion', type: 'yesNo', label: { en: 'Is there water?' }, page: 'plot_tab', before: id('integer_demo') },
      { op: 'addQuestion', type: 'choices', label: { en: 'Which water?' }, page: 'plot_tab', list: 'water_bodies', required: true },
      { op: 'addQuestion', type: 'decimal', label: { en: 'Depth' }, page: 'tab_1312' },
      { op: 'moveQuestion', id: id('integer_demo'), page: 'tab_1312' },
      { op: 'setRequired', id: id('short_text_demo'), required: true },
      { op: 'deleteQuestion', id: id('memo_text_demo') },
      { op: 'addItem', list: 'demo_codelist', item: { code: 'C', label: { en: 'Third' } } },
      { op: 'deleteItem', list: 'demo_codelist', code: 'A' },
    );
    expect(new SurveyEdit(out).problems()).toEqual([]);
    const path = `${DESIGNER}structure.idm.xml`;
    if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(path)) writeFileSync(path, out);
    expect(readFileSync(path, 'latin1').replace(/\r\n/g, '\n')).toBe(out.toString('latin1').replace(/\r\n/g, '\n'));
  });
});

describe('what a change does to the plots collected', () => {
  const records: ImpactRecord[] = [
    { recordKey: '1', summary: { collect_code_code_demo: 'A', collect_text_short_text_demo: 'hello', collect_text_memo_text_demo: '' } },
    { recordKey: '2', summary: { collect_code_code_demo: 'B', collect_text_short_text_demo: '', collect_text_memo_text_demo: 'a long note' } },
    { recordKey: '2', summary: { collect_code_code_demo: 'A', collect_text_short_text_demo: '' } }, // the plot again, by another person
    { recordKey: '3', summary: { collect_code_code_demo: 'null' } },
  ];

  it('counts the plots that answered a question deleted, chose an answer deleted, lack an answer now required', () => {
    const impact = surveyImpact(
      basic,
      [
        { op: 'deleteQuestion', id: id('memo_text_demo') },
        { op: 'deleteItem', list: 'demo_codelist', code: 'A' },
        { op: 'setRequired', id: id('short_text_demo'), required: true },
        { op: 'addQuestion', type: 'text', label: { en: 'x' }, page: 'plot_tab' },
      ],
      records,
    );
    expect(impact).toEqual({
      plots: 3,
      effects: [
        { kind: 'newQuestions', count: 1 },
        { kind: 'questionDeleted', question: 'memo_text_demo', answered: 1 },
        { kind: 'itemDeleted', list: 'demo_codelist', code: 'A', chosen: 2 },
        { kind: 'nowRequired', question: 'short_text_demo', unanswered: 2 },
      ],
    } satisfies SurveyImpactAnswer);
  });

  it('says nothing for words, moves and what no plot has', () => {
    expect(surveyImpact(basic, [{ op: 'moveQuestion', id: id('code_demo') }, { op: 'deleteItem', list: 'demo_codelist', code: 'B' }], records.slice(0, 1)).effects).toEqual([]);
    expect(surveyImpact(basic, [{ op: 'addQuestion', type: 'text', label: { en: 'x' }, page: 'plot_tab' }], []).effects).toEqual([]);
  });
});

describe('the routes, with records collected', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('answers the impact without writing, then saves the change', async () => {
    const files = unzipSync(realDemoCep());
    delete files['survey_guide.pdf'];
    const entries = new Map(Object.entries(files));
    entries.set('placemark.idm.xml', basic);
    const p = await createProject(ctx.app);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(up.statusCode, up.body).toBeLessThan(300);
    const sync = await batchRequest(ctx.app, p.projectId, p.projectToken, [envelope({ recordKey: '7', operator: 'ana', summary: { collect_text_memo_text_demo: 'seen', collect_text_id: '7' } })]);
    expect(sync.statusCode, sync.body).toBe(200);
    const get = async () => (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const first = await get();
    const memo = all(first.design!).find((q) => q.name === 'memo_text_demo')!;
    const ops = [{ op: 'deleteQuestion', id: memo.id }];
    const impact = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design/impact`, headers: bearer(p.adminToken), payload: { operations: ops } });
    expect(impact.json()).toEqual({ plots: 1, effects: [{ kind: 'questionDeleted', question: 'memo_text_demo', answered: 1 }] });
    expect((await get()).revision).toBe(first.revision);
    // An operation that cannot be made is refused by the impact too
    const refused = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design/impact`, headers: bearer(p.adminToken), payload: { operations: [{ op: 'deleteQuestion', id: 999999 }] } });
    expect(refused.statusCode).toBe(400);
    const saved = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken), payload: { revision: first.revision, operations: ops } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(all((saved.json() as SurveyDesignAnswer).design!).some((q) => q.name === 'memo_text_demo')).toBe(false);
  });
});
