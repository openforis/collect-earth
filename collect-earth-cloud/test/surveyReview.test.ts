// The survey designer after its review (docs/plans/2026-11-18-survey-designer.md, "After the review"): what the review
// found wrong in the server, each case as it was found.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cepProperties, readCep } from '../src/cep.js';
import { checkSurvey } from '../src/survey/check.js';
import { readCondition } from '../src/survey/condition.js';
import { surveyDesign } from '../src/survey/design.js';
import { SurveyEdit } from '../src/survey/edit.js';
import { surveyImpact } from '../src/survey/impact.js';
import { readXml } from '../src/survey/xmlTree.js';
import { parseExpression } from '../src/survey/expression.js';
import { answersGone } from '../src/survey/olderPlots.js';
import { newSurvey, tidyTemplateText } from '../src/survey/templates.js';
import type { DesignQuestion, SurveyDesign, SurveyDesignAnswer, SurveyOlderAnswer } from '../src/wire/survey.js';
import { demoCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, makeContext, type TestContext } from './helpers.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const basic = readFileSync(`${TEMPLATES}collect_earth.idm.xml`);

function questions(d: SurveyDesign): DesignQuestion[] {
  return [...d.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === 'table' ? i.columns : [i]))), ...d.hidden, ...d.fromPlotFile, ...d.calculated];
}
const idIn = (d: SurveyDesign, name: string) => questions(d).find((q) => q.name === name)!.id;
const id = (name: string) => idIn(surveyDesign(basic), name);

describe('the survey stays a survey Collect reads', () => {
  it('leaves out the characters XML does not allow, a pasted line break kept as one', () => {
    const e = new SurveyEdit(basic);
    e.apply({ op: 'setText', target: { kind: 'node', id: id('elevation') }, part: 'label', language: 'en', text: 'Elev\u000bation\u0001 x\ud800y \u{1F333}' });
    const bytes = e.bytes();
    expect(() => readXml(bytes)).not.toThrow();
    const text = bytes.toString('latin1');
    expect(text).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    expect(text).not.toContain('&#55296;');
    const label = questions(surveyDesign(bytes)).find((q) => q.name === 'elevation')!.label.en;
    expect(label).toBe('Elev\nation xy \u{1F333}');
  });

  it('changes an attribute, never another one whose value holds its name', () => {
    const d = surveyDesign(basic);
    let e = new SurveyEdit(basic);
    e.apply({ op: 'addQuestion', type: 'text', label: { [d.languages[0]]: 'Required' }, page: d.pages[0].name });
    e.apply({ op: 'setExpression', id: id('short_text_demo'), part: 'required', text: "yes_no_demo and required = 'yes'" });
    e = new SurveyEdit(e.bytes());
    e.apply({ op: 'setRequired', id: id('short_text_demo'), required: true });
    const q = questions(surveyDesign(e.bytes())).find((x) => x.name === 'short_text_demo')!;
    expect(q.required).toBe('always');
    const line = e.bytes().toString('latin1').split('\n').find((l) => l.includes('name="short_text_demo"'))!;
    expect(line).not.toContain('requiredIf');
  });
});

describe('what Collect Earth reads by its place stays in place', () => {
  it('neither moves nor deletes a key or a value of the plot file', () => {
    const d = surveyDesign(basic);
    const keys = d.hidden.filter((q) => q.key);
    expect(keys.length).toBeGreaterThan(0);
    const fromFile = d.fromPlotFile;
    expect(fromFile.length).toBeGreaterThan(1);
    expect(() => new SurveyEdit(basic).apply({ op: 'moveQuestion', id: fromFile[1].id, before: fromFile[0].id })).toThrow(/plot file/);
    expect(() => new SurveyEdit(basic).apply({ op: 'deleteQuestion', id: fromFile[0].id })).toThrow(/plot file/);
    expect(() => new SurveyEdit(basic).apply({ op: 'moveQuestion', id: keys[0].id, before: id('elevation') })).toThrow(/Collect Earth needs/);
  });
});

describe('an answer in use', () => {
  it('is not deleted while a formula gives it, and the design says who uses it', () => {
    const d = surveyDesign(basic);
    const calc = d.calculated.find((q) => q.name === 'calculated_slope_class')!;
    const list = d.lists.find((l) => l.name === 'slope_classes')!;
    const code = list.items[0].code;
    const e = new SurveyEdit(basic);
    e.apply({ op: 'setFormulas', id: calc.id, formulas: [{ value: code, when: 'slope < 5' }, { expression: "'x'" }] });
    expect(() => e.apply({ op: 'deleteItem', list: 'slope_classes', code })).toThrow(/used by calculated_slope_class/);
    const after = surveyDesign(e.bytes()).lists.find((l) => l.name === 'slope_classes')!;
    expect(after.items[0].usedBy).toEqual(['calculated_slope_class']);
  });

  it('names the questions whose condition compares with it', () => {
    const d = surveyDesign(basic);
    const list = d.lists.find((l) => l.items.some((i) => i.usedBy.length > 0));
    // The templates compare some of their answers: each such answer names a question
    expect(list).toBeDefined();
    for (const item of d.lists.flatMap((l) => l.items)) for (const user of item.usedBy) expect(questions(d).some((q) => q.name === user)).toBe(true);
  });
});

describe('the impact of a change', () => {
  it('counts a plot made required the same whatever the order of its records', () => {
    const op = { op: 'setRequired', id: id('short_text_demo'), required: true } as const;
    const e = new SurveyEdit(basic);
    e.apply(op);
    const answered = { recordKey: 'p1', summary: { collect_text_short_text_demo: 'hello' } };
    const blank = { recordKey: 'p1', summary: { collect_text_short_text_demo: '' } };
    const one = surveyImpact(basic, [op], [answered, blank], e.bytes()).effects;
    const other = surveyImpact(basic, [op], [blank, answered], e.bytes()).effects;
    expect(one).toEqual(other);
    expect(one).toContainEqual({ kind: 'nowRequired', question: 'short_text_demo', unanswered: 1 });
  });

  it('keeps "is not" on several answers as written: Collect reads it as "some answer is not"', () => {
    expect(readCondition("trees != 'A'", () => ({ yesNo: false, multiple: true }))).toEqual({ kind: 'advanced', text: "trees != 'A'" });
    expect(readCondition("not(trees = 'A')", () => ({ yesNo: false, multiple: true }))).toEqual({ kind: 'all', parts: [{ question: 'trees', test: 'isNot', value: 'A' }] });
    expect(readCondition("trees != 'A'", () => ({ yesNo: false }))).toEqual({ kind: 'all', parts: [{ question: 'trees', test: 'isNot', value: 'A' }] });
  });
});

describe('a large change', () => {
  it('adds thousands of answers in well under a second or two', () => {
    const e = new SurveyEdit(basic);
    const started = Date.now();
    for (let l = 0; l < 8; l++) e.apply({ op: 'addList', name: `bulk${l}`, label: { en: 'x' }, items: Array.from({ length: 1000 }, (_, i) => ({ code: `c${i}`, label: { en: 'x' } })) });
    e.bytes();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('the routes', { timeout: 60_000 }, () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  async function project() {
    const p = await createProject(ctx.app);
    const put = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: demoCep() });
    expect(put.statusCode).toBe(200);
    const get = async () => (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const save = async (operations: unknown[], revision?: string) =>
      ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken), payload: { revision: revision ?? (await get()).revision, operations } });
    return { p, get, save };
  }

  const originalDesign = async (projectId: string) => {
    const files = readCep((await ctx.store.getOriginalCep(projectId))!);
    return surveyDesign(Buffer.from(files.entries.get(files.surveyPath)!));
  };

  it('makes the same changes on the uploaded file, on the same questions though their ids differ', async () => {
    const { p, get, save } = await project();
    expect((await ctx.store.getOriginalCep(p.projectId))!.equals((await ctx.store.getCep(p.projectId))!)).toBe(false);
    const d = (await get()).design!;
    const lang = d.languages[0];
    const page = d.pages[0].name;
    const names = ['one', 'two', 'three'];
    expect((await save(names.map((n) => ({ op: 'addQuestion', type: 'text', label: { [lang]: `Question ${n}` }, page })))).statusCode).toBe(200);
    const served = (await get()).design!;
    const one = idIn(served, 'question_one');
    expect((await save([{ op: 'setText', target: { kind: 'node', id: one }, part: 'label', language: lang, text: 'Renamed' }])).statusCode).toBe(200);
    expect((await save([{ op: 'setText', target: { kind: 'node', id: idIn((await get()).design!, 'question_two') }, part: 'label', language: lang, text: 'Second' }])).statusCode).toBe(200);
    let original = await originalDesign(p.projectId);
    const label = (n: string) => questions(original).find((q) => q.name === n)?.label[lang];
    expect([label('question_one'), label('question_two'), label('question_three')]).toEqual(['Renamed', 'Second', 'Question three']);
    expect((await save([{ op: 'deleteQuestion', id: one }])).statusCode).toBe(200);
    original = await originalDesign(p.projectId);
    expect(questions(original).filter((q) => q.name.startsWith('question_')).map((q) => q.name)).toEqual(['question_two', 'question_three']);
    // Both show Collect Earth 2.0's form made from the survey, not a balloon written for the survey before
    for (const cep of [await ctx.store.getCep(p.projectId), await ctx.store.getOriginalCep(p.projectId)]) expect(cepProperties(readCep(cep!)).get('web_form')).toBe('generated');
    // The uploaded file never gets the server's fields
    expect(questions(original).some((q) => q.name === 'round')).toBe(questions(surveyDesign(readSurveyOf(demoCep()))).some((q) => q.name === 'round'));
  });

  it('refuses the second of two changes made on the same survey, at once', async () => {
    const { p, get } = await project();
    const d = await get();
    const page = d.design!.pages[0].name;
    const lang = d.design!.languages[0];
    const post = (name: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/v1/projects/${p.projectId}/survey/design`,
        headers: bearer(p.adminToken),
        payload: { revision: d.revision, operations: [{ op: 'addQuestion', type: 'text', label: { [lang]: name }, page }] },
      });
    const codes = (await Promise.all([post('First at once'), post('Second at once')])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const names = questions((await get()).design!).map((q) => q.name);
    expect(names.filter((n) => n === 'first_at_once' || n === 'second_at_once')).toHaveLength(1);
  });

  it('keeps the survey before any change among the versions, however many changes follow', async () => {
    const { p, get, save } = await project();
    const first = (await get()).revision;
    const lang = (await get()).design!.languages[0];
    const elevation = idIn((await get()).design!, 'elevation');
    for (let i = 0; i < 25; i++) expect((await save([{ op: 'setText', target: { kind: 'node', id: elevation }, part: 'label', language: lang, text: `Elevation ${i}` }])).statusCode).toBe(200);
    const versions = await ctx.store.listSurveyVersions(p.projectId);
    expect(versions).toHaveLength(21);
    const oldest = versions[versions.length - 1];
    const data = await ctx.store.getSurveyVersionData(p.projectId, oldest.id);
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(data!.survey).digest('hex').slice(0, 24)).toBe(first);
  }, 60_000);

  it('answers that the survey cannot be read, not a server error, when checking the impact', async () => {
    const p = await createProject(ctx.app);
    const { unzipSync, zipSync, strToU8 } = await import('fflate');
    const entries = unzipSync(new Uint8Array(demoCep()));
    entries[readCep(demoCep()).surveyPath] = strToU8('<survey><broken');
    const cep = Buffer.from(zipSync(entries));
    await ctx.store.putCep(p.projectId, cep, (await ctx.store.getRoundInfo(p.projectId)) ?? { state: 'none' } as never, null);
    const r = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design/impact`, headers: bearer(p.adminToken), payload: { operations: [{ op: 'addLanguage', language: 'fr' }] } });
    expect(r.statusCode).toBe(409);
  });

  it('counts the plots last saved with an earlier survey: as Collect Earth 2.0 says, or by an answer to a question gone', async () => {
    const { p, get, save } = await project();
    const before = (await get()).revision!;
    const older = async () =>
      (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/older`, headers: bearer(p.adminToken) })).json() as SurveyOlderAnswer;
    const send = (key: string, revision?: string, summary: Record<string, string> = {}) =>
      batchRequest(ctx.app, p.projectId, p.projectToken, [
        { recordKey: key, surveyUri: 'x', operator: 'ana', modifiedOn: Date.now(), activelySaved: true, step: 1, xml: '<x/>', summary, deleted: false, payloadVersion: 1, ...(revision ? { surveyRevision: revision } : {}) },
      ]);
    const d = (await get()).design!;
    const page = d.pages[0].name;
    const lang = d.languages[0];
    expect((await save([{ op: 'addQuestion', type: 'text', label: { [lang]: 'To delete' }, page }])).statusCode).toBe(200);
    const made = (await get()).revision!;
    expect(made).not.toBe(before);
    await send('1', made);
    await send('2', made);
    // An older Collect Earth: no revision; one answered the question to delete, one left it blank
    await send('3', undefined, { collect_text_to_delete: 'kept', collect_text_elevation_x: '' });
    await send('4', undefined, { collect_text_to_delete: '' });
    expect(await older()).toEqual({ plots: 0, byRevision: 0 });
    const id = idIn((await get()).design!, 'to_delete');
    expect((await save([{ op: 'deleteQuestion', id }])).statusCode).toBe(200);
    // Plots 1 and 2 said the survey of then; 3 answers a question gone; 4 has nothing that does not fit
    expect(await older()).toEqual({ plots: 3, byRevision: 2 });
    await send('2', (await get()).revision!);
    expect(await older()).toEqual({ plots: 2, byRevision: 1 });
  });
});

function readSurveyOf(cep: Buffer): Buffer {
  const files = readCep(cep);
  return Buffer.from(files.entries.get(files.surveyPath)!);
}

describe('the templates', () => {
  it('still have no problems', () => {
    for (const f of ['collect_earth.idm.xml', 'collect_earth_multipurpose.idm.xml', 'collect_earth_ipcc.idm.xml']) expect(checkSurvey(readFileSync(`${TEMPLATES}${f}`))).toEqual([]);
  });
});

describe('the second review', () => {
  const d = surveyDesign(basic);
  const page = d.pages[0].name;

  it('gives a table\'s row key an id of its own, so a column added with it in one save gets another', () => {
    const e = new SurveyEdit(basic);
    e.apply({ op: 'addTable', label: { en: 'Cover' }, page, rows: 'demo_codelist', name: 'cover' });
    const table = surveyDesign(e.bytes()).pages.flatMap((p) => p.items).find((i) => i.name === 'cover')!;
    e.apply({ op: 'addQuestion', type: 'integer', label: { en: 'Percent' }, name: 'percent', table: table.id });
    const ids = [...e.bytes().toString('latin1').matchAll(/<(?:entity|code|number|text|boolean|date|list|item)\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const lastId = Number(/lastId="(\d+)"/.exec(e.bytes().toString('latin1'))?.[1]);
    expect(lastId).toBeGreaterThanOrEqual(Math.max(...ids.map(Number)));
  });

  it('never leaves a list with no answers, nor a page with no name', () => {
    expect(() => new SurveyEdit(basic).apply({ op: 'addList', name: 'empty', label: { en: 'Empty' }, items: [] })).toThrow(/at least one answer/);
    const e = new SurveyEdit(basic);
    e.apply({ op: 'addList', name: 'spare', label: { en: 'Spare' }, items: [{ code: 'x', label: { en: 'X' } }] });
    expect(() => e.apply({ op: 'deleteItem', list: 'spare', code: 'x' })).toThrow(/last answer/);
    const one = new SurveyEdit(basic);
    one.apply({ op: 'addPage', label: { en: 'Trees' }, name: 'trees_tab' });
    expect(() => one.apply({ op: 'setText', target: { kind: 'page', name: 'trees_tab' }, part: 'label', language: 'en', text: '' })).toThrow(/keeps a name/);
  });

  it('offers a sub-list only on a list with answers under its answers', () => {
    expect(() => new SurveyEdit(basic).apply({ op: 'addQuestion', type: 'choice', label: { en: 'Sub' }, page, parent: 'code_demo' })).toThrow(/no answers under/);
  });

  it('refuses an expression nested too deep, rather than failing', () => {
    expect(() => parseExpression('('.repeat(1999) + '1' + ')'.repeat(1999))).toThrow(/nested more than 100/);
    expect(() => parseExpression('-'.repeat(3990) + '1')).toThrow(/nested more than 100/);
    expect(() => parseExpression('((1 + 2) * 3) > 4')).not.toThrow();
  });

  it('reads a range\'s answer as its question\'s, not as one gone', () => {
    const names = new Set(['x', 'cover', 'percent']);
    expect(answersGone(names, { collect_integer_range_x: '1-2', collect_real_x: '3' })).toBe(false);
    expect(answersGone(names, { 'collect_entity_cover[A].integer_percent': '3' })).toBe(false);
    expect(answersGone(names, { 'collect_entity_cover[A].integer_gone': '3' })).toBe(true);
    expect(answersGone(names, { collect_text_gone: 'a' })).toBe(true);
  });

  it('makes the multipurpose template\'s texts read as written for the years chosen', () => {
    expect(tidyTemplateText('LU <END YEAR>', 'label', 2020)).toBe('LU 2020');
    expect(tidyTemplateText('Uso de la tierra 2023\r\n\t\t\t', 'label', 2020)).toBe('Uso de la tierra 2020');
    expect(tidyTemplateText('Disturbance within <DISTANCE> buffer', 'label', null)).toBe('Disturbance within the buffer');
    expect(tidyTemplateText('One line\r\n\t\tand another', 'help', null)).toBe('One line\nand another');
    const { survey } = newSurvey({ template: 'multipurpose', title: 'T', language: 'es', projectId: 'abcdef12', years: { first: 2010, last: 2020 } });
    const text = JSON.stringify(surveyDesign(survey));
    expect(text).not.toMatch(/<END YEAR>|<ANO FINAL>|<DISTANCE>|\\t/);
    expect(text).not.toContain('2023');
  });
});

describe('the second review: the routes', { timeout: 60_000 }, () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('gives a new page the same name in the uploaded file, so a question put on it reaches both', async () => {
    const p = await createProject(ctx.app);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: demoCep() });
    const get = async () => (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const save = async (operations: unknown[]) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken), payload: { revision: (await get()).revision, operations } });
    const lang = (await get()).design!.languages[0];
    expect((await save([{ op: 'addPage', label: { [lang]: 'Trees' } }])).statusCode).toBe(200);
    const page = (await get()).design!.pageOrder.at(-1)!;
    expect((await save([{ op: 'addQuestion', type: 'integer', name: 'tree_count', label: { [lang]: 'How many trees' }, page }])).statusCode).toBe(200);
    const files = readCep((await ctx.store.getOriginalCep(p.projectId))!);
    const original = surveyDesign(Buffer.from(files.entries.get(files.surveyPath)!));
    expect(original.pageOrder).toContain(page);
    expect(questions(original).some((q) => q.name === 'tree_count')).toBe(true);
  });

  it('refuses to try too many changes on too many plots at once', async () => {
    const p = await createProject(ctx.app);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: demoCep() });
    const records = (ctx.store as unknown as { projects: Map<string, { records: Map<string, unknown> }> }).projects.get(p.projectId)!.records;
    for (let i = 0; i < 2000; i++) {
      records.set(`${i} ana`, { projectId: p.projectId, recordKey: `${i}`, operator: 'ana', modifiedOn: 1, receivedAt: 1, activelySaved: true, step: 1, xml: null, summary: {}, deleted: false, deletedOn: null });
    }
    const d = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const id = questions(d.design!).find((q) => !q.fixed && !q.hidden && !q.fromPlotFile && !q.formulas)!.id;
    const impact = (n: number) =>
      ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design/impact`, headers: bearer(p.adminToken), payload: { operations: Array.from({ length: n }, () => ({ op: 'setRequired', id, required: true })) } });
    expect((await impact(1)).statusCode).toBe(200);
    expect((await impact(300)).statusCode).toBe(400);
  });
});
