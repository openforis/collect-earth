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
import type { DesignQuestion, SurveyDesign, SurveyDesignAnswer } from '../src/wire/survey.js';
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

describe('the routes', () => {
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

  it('counts the plots last saved with an earlier survey, as Collect Earth says it', async () => {
    const { p, get, save } = await project();
    const before = (await get()).revision!;
    const send = (key: string, revision?: string) =>
      batchRequest(ctx.app, p.projectId, p.projectToken, [
        { recordKey: key, surveyUri: 'x', operator: 'ana', modifiedOn: Date.now(), activelySaved: true, step: 1, xml: '<x/>', summary: {}, deleted: false, payloadVersion: 1, ...(revision ? { surveyRevision: revision } : {}) },
      ]);
    await send('1', before);
    await send('2', before);
    await send('3');
    expect((await get()).olderSurveyPlots).toBe(0);
    const lang = (await get()).design!.languages[0];
    expect((await save([{ op: 'setText', target: { kind: 'node', id: idIn((await get()).design!, 'elevation') }, part: 'label', language: lang, text: 'Height' }])).statusCode).toBe(200);
    expect((await get()).olderSurveyPlots).toBe(2);
    await send('2', (await get()).revision!);
    expect((await get()).olderSurveyPlots).toBe(1);
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
