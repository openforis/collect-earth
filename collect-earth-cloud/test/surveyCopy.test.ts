// The survey designer's copy of a question (copyQuestion): right below itself, or before another question of its page
// or table, with everything it has (its list, texts, conditions, rules and formulas) under a name of its own.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCep, zipCep } from '../src/cep.js';
import { surveyDesign } from '../src/survey/design.js';
import { SurveyEdit, SurveyEditError } from '../src/survey/edit.js';
import { surveyImpact } from '../src/survey/impact.js';
import type { DesignQuestion, SurveyChangeRefusal, SurveyDesignAnswer, SurveyOperation } from '../src/wire/survey.js';
import { FIXTURE_DATE, realDemoCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const basic = readFileSync(`${TEMPLATES}collect_earth.idm.xml`);

const questions = (survey: Buffer): DesignQuestion[] => {
  const d = surveyDesign(survey);
  return [...d.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === 'table' ? [i, ...i.columns] : [i]))), ...d.hidden, ...d.fromPlotFile, ...d.calculated] as DesignQuestion[];
};
const question = (survey: Buffer, name: string) => questions(survey).find((q) => q.name === name)!;
const id = (name: string) => question(basic, name).id;
const apply = (survey: Buffer, ...ops: SurveyOperation[]) => {
  const s = new SurveyEdit(survey);
  for (const op of ops) s.apply(op);
  return s.bytes();
};
const refusal = (survey: Buffer, op: SurveyOperation) => {
  try {
    apply(survey, op);
  } catch (err) {
    if (err instanceof SurveyEditError) return { message: err.message, code: err.code, values: err.values };
    throw err;
  }
  return 'made';
};
const firstPage = (survey: Buffer) => surveyDesign(survey).pages[0].items.map((i) => i.name);
/** A question as the designer shows it, but what tells it apart from its copy */
const shape = (q: DesignQuestion) => ({ ...q, id: 0, name: '' });

describe('copying a question', () => {
  it('copies a choice right below itself, with its list, texts, shown-when, required and rules', () => {
    const prepared = apply(
      basic,
      { op: 'setShownWhen', id: id('code_demo'), when: { kind: 'all', parts: [{ question: 'short_text_demo', test: 'answered', value: null }] } },
      { op: 'addRule', id: id('code_demo'), rule: { kind: 'expression', flag: 'warning', text: "code_demo != 'B'", message: { en: 'Rarely B', es: 'Rara vez B' }, when: null } },
    );
    const out = apply(prepared, { op: 'copyQuestion', id: id('code_demo') });
    expect(firstPage(out)).toEqual(['short_text_demo', 'code_demo', 'code_demo_b', 'yes_no_demo', 'memo_text_demo', 'integer_demo']);
    const original = question(out, 'code_demo');
    const copy = question(out, 'code_demo_b');
    // The same list (not a copy of it), labels and help in every language, required, shown-when, the rule's messages
    expect(shape(copy)).toEqual({ ...shape(original), rules: [{ ...original.rules[0], text: "code_demo_b != 'B'" }] });
    expect(copy).toMatchObject({ list: 'demo_codelist', required: 'always', key: false, shownWhen: { kind: 'all', parts: [{ question: 'short_text_demo', test: 'answered' }] } });
    expect(Object.keys(copy.label).length).toBeGreaterThan(1);
    // The original's rule still checks the original
    expect(original.rules[0]).toMatchObject({ text: "code_demo != 'B'", message: { en: 'Rarely B', es: 'Rara vez B' } });
    expect(surveyDesign(out).lists.filter((l) => l.name.startsWith('demo_codelist'))).toHaveLength(1);
    // A new id, the survey's last one
    const ids = questions(out).map((q) => q.id);
    expect(copy.id).toBe(Math.max(...ids));
    expect(out.toString('latin1')).toContain(`lastId="${copy.id}"`);
    expect(new SurveyEdit(out).problems()).toEqual([]);
  });

  it('copies a column of a table, its total then adding up the copy', () => {
    const withTable = apply(
      basic,
      { op: 'addList', name: 'land_uses', label: { en: 'Land uses' }, items: [{ code: 'F', label: { en: 'Forest' } }, { code: 'G', label: { en: 'Grassland' } }] },
      { op: 'addTable', label: { en: 'Cover' }, page: 'plot_tab', rows: 'land_uses' },
    );
    const table = question(withTable, 'cover').id;
    const withColumns = apply(
      withTable,
      { op: 'addQuestion', type: 'integer', label: { en: 'Share' }, table },
      { op: 'addQuestion', type: 'yesNo', label: { en: 'Burnt' }, table },
    );
    const share = question(withColumns, 'share').id;
    const withTotal = apply(withColumns, { op: 'addRule', id: share, rule: { flag: 'error', message: { en: 'At most 100' }, when: null, kind: 'total', test: 'atMost', total: 100 } });
    const out = apply(withTotal, { op: 'copyQuestion', id: share });
    const columns = (s: Buffer) => surveyDesign(s).pages[0].items.flatMap((i) => (i.kind === 'table' ? i.columns.map((c) => c.name) : []));
    expect(columns(out)).toEqual(['cover_row', 'share', 'share_b', 'burnt']);
    expect(question(out, 'share_b').rules).toEqual([{ flag: 'error', message: { en: 'At most 100' }, when: null, kind: 'total', test: 'atMost', total: 100 }]);
    expect(out.toString('latin1')).toContain('sum(parent()/cover/share_b) &lt;= 100');
    expect(out.toString('latin1')).toContain('sum(parent()/cover/share) &lt;= 100');
    expect(new SurveyEdit(out).problems()).toEqual([]);
    // Before another column of the table only; the table itself and its rows' key are not copied
    expect(columns(apply(withTotal, { op: 'copyQuestion', id: question(withTotal, 'burnt').id, before: share }))).toEqual(['cover_row', 'burnt_b', 'share', 'burnt']);
    expect(refusal(withTotal, { op: 'copyQuestion', id: share, before: id('code_demo') })).toMatchObject({ message: /same page or table/ });
    expect(refusal(withTotal, { op: 'copyQuestion', id: table })).toMatchObject({ message: /table is not copied/ });
    expect(refusal(withTotal, { op: 'copyQuestion', id: question(withTotal, 'cover_row').id })).toMatchObject({ code: 'fixedField', values: { name: 'cover_row' } });
  });

  it('copies a calculated value with its formulas', () => {
    const out = apply(basic, { op: 'copyQuestion', id: id('calculated_slope_class') });
    const original = question(out, 'calculated_slope_class');
    const copy = question(out, 'calculated_slope_class_b');
    expect(shape(copy)).toEqual(shape(original));
    expect(copy.formulas).toHaveLength(7);
    expect(new SurveyEdit(out).problems()).toEqual([]);
  });

  it("refuses a field Collect Earth fills, a key and a value of the plot file, with a code the dashboard words", () => {
    for (const name of ['operator', 'id', 'elevation', 'actively_saved']) {
      expect(refusal(basic, { op: 'copyQuestion', id: id(name) })).toEqual({ message: `${name} is filled by Collect Earth: it is not copied.`, code: 'fixedField', values: { name } });
    }
    expect(refusal(basic, { op: 'copyQuestion', id: 999999 })).toMatchObject({ code: 'gone' });
  });

  it('names each copy apart, and puts it before another question of the page when asked', () => {
    const twice = apply(basic, { op: 'copyQuestion', id: id('integer_demo') }, { op: 'copyQuestion', id: id('integer_demo') });
    expect(firstPage(twice).slice(-3)).toEqual(['integer_demo', 'integer_demo_c', 'integer_demo_b']);
    // Its range rule names no question: kept as it is
    expect(question(twice, 'integer_demo_c').rules).toEqual(question(twice, 'integer_demo').rules);
    expect(new SurveyEdit(twice).problems()).toEqual([]);
    const first = apply(basic, { op: 'copyQuestion', id: id('integer_demo'), before: id('short_text_demo') });
    expect(firstPage(first)).toEqual(['integer_demo_b', 'short_text_demo', 'code_demo', 'yes_no_demo', 'memo_text_demo', 'integer_demo']);
    // demo_date is on the other page
    expect(refusal(basic, { op: 'copyQuestion', id: id('integer_demo'), before: id('demo_date') })).toMatchObject({ message: /same page or table/ });
  });

  it('adds a question the plots collected have no answer to', () => {
    const records = [{ recordKey: '1', summary: { collect_code_code_demo: 'A' } }];
    expect(surveyImpact(basic, [{ op: 'copyQuestion', id: id('code_demo') }], records)).toEqual({ plots: 1, effects: [{ kind: 'newQuestions', count: 1 }] });
  });
});

describe('the copy through the routes', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('saves a copy in the served project file and the uploaded one; refuses a fixed field with its code', async () => {
    const files = unzipSync(realDemoCep());
    delete files['survey_guide.pdf'];
    const entries = new Map(Object.entries(files));
    entries.set('placemark.idm.xml', basic);
    const p = await createProject(ctx.app);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(up.statusCode, up.body).toBeLessThan(300);
    const first = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const named = (name: string) => first.design!.pages.flatMap((pg) => pg.items).concat(first.design!.hidden).find((q) => q.name === name)!.id;
    const save = (operations: unknown[]) =>
      ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken), payload: { revision: first.revision, operations } });
    const fixed = await save([{ op: 'copyQuestion', id: named('operator') }]);
    expect(fixed.statusCode).toBe(400);
    expect(fixed.json()).toMatchObject({ code: 'fixedField', values: { name: 'operator' } } satisfies Partial<SurveyChangeRefusal>);
    expect((await save([{ op: 'copyQuestion', id: 'x' }])).statusCode).toBe(400);
    const saved = await save([{ op: 'copyQuestion', id: named('yes_no_demo'), before: named('short_text_demo') }]);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as SurveyDesignAnswer).design!.pages[0].items[0].name).toBe('yes_no_demo_b');
    const original = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep/original`, headers: bearer(p.adminToken) });
    const uploaded = readCep(original.rawPayload);
    expect(surveyDesign(Buffer.from(uploaded.entries.get(uploaded.surveyPath)!)).pages[0].items[0].name).toBe('yes_no_demo_b');
  });
});
