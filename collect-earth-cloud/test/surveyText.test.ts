// The survey designer's stage 7 (docs/plans/2026-11-18-survey-designer.md): formulas, conditions and rules written as
// expressions of Collect's language, each checked as Collect checks it before it is written. The changed basic template
// is written to the desktop's test resources, where DesignedSurveyIdmlTest reads it with Collect.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipCep } from '../src/cep.js';
import { surveyDesign } from '../src/survey/design.js';
import { SurveyEdit, SurveyEditError } from '../src/survey/edit.js';
import type { DesignQuestion, SurveyOperation } from '../src/wire/survey.js';
import { FIXTURE_DATE, realDemoCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const DESIGNER = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/designer/', import.meta.url));
const basic = readFileSync(fileURLToPath(new URL('../templates/collect_earth.idm.xml', import.meta.url)));
const all = (survey: Buffer) => {
  const d = surveyDesign(survey);
  return [...d.pages.flatMap((p) => p.items), ...d.calculated, ...d.fromPlotFile, ...d.hidden] as DesignQuestion[];
};
const find = (survey: Buffer, name: string) => all(survey).find((q) => q.name === name)!;
const id = (name: string) => find(basic, name).id;
const apply = (survey: Buffer, ...ops: SurveyOperation[]) => {
  const s = new SurveyEdit(survey);
  for (const op of ops) s.apply(op);
  return s.bytes();
};
const refused = (op: SurveyOperation) => {
  try {
    apply(basic, op);
  } catch (err) {
    if (err instanceof SurveyEditError) return err.message;
    throw err;
  }
  return 'made';
};

describe('formulas, conditions and rules as text', () => {
  it("replaces a calculated value's formulas, values and expressions with their conditions", () => {
    const out = apply(basic, {
      op: 'setFormulas',
      id: id('calculated_elevation_range'),
      formulas: [
        { value: '1', when: 'elevation < 100' },
        { value: '2', when: 'elevation >= 100 and elevation < 200' },
        { expression: "'3'" },
      ],
    });
    expect(find(out, 'calculated_elevation_range').formulas).toEqual([
      { value: '1', expression: null, when: 'elevation < 100' },
      { value: '2', expression: null, when: 'elevation >= 100 and elevation < 200' },
      { value: null, expression: "'3'", when: null },
    ]);
    expect(new SurveyEdit(out).problems()).toEqual([]);
  });

  it('refuses what Collect would refuse, saying why', () => {
    const elevationRange = id('calculated_elevation_range');
    expect(refused({ op: 'setFormulas', id: elevationRange, formulas: [{ value: '1', when: 'nothing_here < 3' }] })).toMatch(/There is no question nothing_here/);
    expect(refused({ op: 'setFormulas', id: elevationRange, formulas: [{ value: '999' }] })).toBe('Formula 1: the list has no code 999.');
    expect(refused({ op: 'setFormulas', id: elevationRange, formulas: [{ value: '1', expression: "'1'" }] })).toBe('Formula 1 gives a value or an expression.');
    expect(refused({ op: 'setFormulas', id: elevationRange, formulas: [] })).toMatch(/1 to 100 formulas/);
    expect(refused({ op: 'setFormulas', id: id('integer_demo'), formulas: [{ value: '1' }] })).toBe('Only a calculated value has formulas.');
    expect(refused({ op: 'setExpression', id: id('integer_demo'), part: 'shownWhen', text: 'concat(' })).toMatch(/cannot be read/);
  });

  it('writes a show-when and a required-when as expressions, and takes them away', () => {
    const out = apply(
      basic,
      { op: 'setExpression', id: id('integer_demo'), part: 'shownWhen', text: "starts-with(short_text_demo, 'P')" },
      { op: 'setExpression', id: id('short_text_demo'), part: 'required', text: 'elevation > 1000' },
    );
    expect(find(out, 'integer_demo').shownWhen).toEqual({ kind: 'advanced', text: "starts-with(short_text_demo, 'P')" });
    expect(find(out, 'short_text_demo').required).toEqual({ when: { kind: 'all', parts: [{ question: 'elevation', test: 'gt', value: 1000 }] } });
    expect(new SurveyEdit(out).problems()).toEqual([]);
    const back = apply(out, { op: 'setExpression', id: id('integer_demo'), part: 'shownWhen', text: null }, { op: 'setExpression', id: id('short_text_demo'), part: 'required', text: null });
    expect(find(back, 'integer_demo').shownWhen).toBeNull();
    expect(find(back, 'short_text_demo').required).toBe('never');
  });

  it("writes a rule as an expression, and the trial of stage 7 the desktop's test reads", () => {
    const out = apply(
      basic,
      { op: 'addRule', id: id('integer_demo'), rule: { flag: 'warning', message: { en: 'Not 13' }, when: null, kind: 'expression', text: '$this != 13', whenText: "idm:blank(short_text_demo) or short_text_demo != 'x'" } },
      { op: 'setFormulas', id: id('calculated_slope_class'), formulas: [{ value: 'FLAT', when: 'slope <= 5' }, { value: 'STEEP' }] },
      { op: 'setExpression', id: id('memo_text_demo'), part: 'shownWhen', text: 'yes_no_demo = true() and integer_demo > 6' },
    );
    expect(find(out, 'integer_demo').rules[1]).toEqual({
      flag: 'warning',
      message: { en: 'Not 13' },
      // Written as text, read back as rows where the rows say it exactly
      when: { kind: 'any', parts: [{ question: 'short_text_demo', test: 'notAnswered', value: null }, { question: 'short_text_demo', test: 'isNot', value: 'x' }] },
      kind: 'advanced',
      text: '$this != 13',
      expression: true,
    });
    expect(new SurveyEdit(out).problems()).toEqual([]);
    const path = `${DESIGNER}text.idm.xml`;
    if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(path)) writeFileSync(path, out);
    expect(readFileSync(path, 'latin1').replace(/\r\n/g, '\n')).toBe(out.toString('latin1').replace(/\r\n/g, '\n'));
  });
});

describe('POST /survey/check', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('checks a typed expression from the place of its question, writing nothing', async () => {
    const files = unzipSync(realDemoCep());
    delete files['survey_guide.pdf'];
    const entries = new Map(Object.entries(files));
    entries.set('placemark.idm.xml', basic);
    const p = await createProject(ctx.app);
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    const check = (payload: object) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/check`, headers: bearer(p.adminToken), payload });
    expect((await check({ id: id('integer_demo'), kind: 'boolean', text: 'elevation > 100' })).json()).toEqual({ ok: true });
    expect((await check({ id: id('integer_demo'), kind: 'boolean', text: 'elevashun > 100' })).json()).toEqual({
      ok: false,
      code: 'unknownQuestion',
      values: { name: 'elevashun', in: 'plot' },
      beyondCollect: false,
    });
    expect((await check({ id: id('integer_demo'), kind: 'value', text: 'idm:nothing()' })).json()).toMatchObject({ ok: false, code: 'unknownFunction' });
    expect((await check({ id: 999999, kind: 'boolean', text: 'true()' })).statusCode).toBe(400);
  });
});
