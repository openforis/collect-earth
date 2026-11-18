// The survey designer's stage 4 (docs/plans/2026-11-18-survey-designer.md): when a question is shown or required,
// and its rules, made from rows; the server writes Collect's expressions from them and they read back as the same
// rows. Rules are tried on the plots already collected before they are saved. The changed multipurpose template is
// written to the desktop's test resources, where DesignedSurveyIdmlTest reads it with Collect.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipCep } from '../src/cep.js';
import { readCondition } from '../src/survey/condition.js';
import { surveyDesign } from '../src/survey/design.js';
import { SurveyEdit, SurveyEditError } from '../src/survey/edit.js';
import { surveyImpact, type ImpactRecord } from '../src/survey/impact.js';
import { attrValue, descendants, readXml } from '../src/survey/xmlTree.js';
import type { ConditionRows, DesignItem, DesignQuestion, NewRule, SurveyDesign, SurveyDesignAnswer, SurveyOperation } from '../src/wire/survey.js';
import { FIXTURE_DATE, realDemoCep } from './fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, type TestContext } from './helpers.js';

const TEMPLATES = fileURLToPath(new URL('./fixtures/templates/', import.meta.url));
const DESIGNER = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/designer/', import.meta.url));
const basic = readFileSync(`${TEMPLATES}collect_earth.idm.xml`);
const multipurpose = readFileSync(`${TEMPLATES}collect_earth_multipurpose.idm.xml`);

const questions = (d: SurveyDesign) => {
  const out: DesignQuestion[] = [];
  const walk = (items: DesignItem[]) => {
    for (const i of items) {
      if (i.kind === 'question') out.push(i);
      else out.push(...i.columns);
    }
  };
  for (const p of d.pages) walk(p.items);
  return [...out, ...d.hidden, ...d.fromPlotFile, ...d.calculated];
};
const find = (survey: Buffer, name: string) => questions(surveyDesign(survey)).find((q) => q.name === name)!;
const id = (survey: Buffer, name: string) => find(survey, name).id;
const apply = (survey: Buffer, ...ops: SurveyOperation[]) => {
  const s = new SurveyEdit(survey);
  for (const op of ops) s.apply(op);
  return s.bytes();
};
/** An attribute of a node of the survey, as written */
const written = (survey: Buffer, name: string, attr: string) => {
  const doc = readXml(survey);
  for (const e of descendants(doc.root)) if (attrValue(doc, e, 'name') === name) return attrValue(doc, e, attr);
  return undefined;
};
const refused = (survey: Buffer, op: SurveyOperation) => {
  try {
    apply(survey, op);
  } catch (err) {
    if (err instanceof SurveyEditError) return err.message;
    throw err;
  }
  return 'made';
};
const all = (...parts: ConditionRows['parts']): ConditionRows => ({ kind: 'all', parts });

describe('conditions from rows', () => {
  it('writes each test as Collect expressions read, and reads it back as the same rows', () => {
    const when = all(
      { question: 'code_demo', test: 'is', value: 'A' },
      { question: 'yes_no_demo', test: 'is', value: true },
      { question: 'short_text_demo', test: 'answered', value: null },
      { question: 'memo_text_demo', test: 'notAnswered', value: null },
      { question: 'elevation', test: 'gte', value: 200.5 },
      { question: 'short_text_demo', test: 'isNot', value: "it's" },
    );
    const out = apply(basic, { op: 'setShownWhen', id: id(basic, 'integer_demo'), when });
    expect(written(out, 'integer_demo', 'relevant')).toBe(
      `code_demo = 'A' and yes_no_demo = true() and not(idm:blank(short_text_demo)) and idm:blank(memo_text_demo) and elevation >= 200.5 and short_text_demo != "it's"`,
    );
    expect(written(out, 'integer_demo', 'ui:hideWhenNotRelevant')).toBe('true');
    expect(find(out, 'integer_demo').shownWhen).toEqual(when);
    expect(new SurveyEdit(out).problems()).toEqual([]);
    // Any of, and "is not" on several answers: none of them is the code
    const choices = apply(
      out,
      { op: 'addQuestion', type: 'choices', label: { en: 'Seen' }, page: 'plot_tab', list: 'demo_codelist' },
      { op: 'setShownWhen', id: id(basic, 'integer_demo'), when: { kind: 'any', parts: [{ question: 'seen', test: 'isNot', value: 'B' }, { question: 'yes_no_demo', test: 'is', value: false }] } },
    );
    expect(written(choices, 'integer_demo', 'relevant')).toBe(`not(seen = 'B') or yes_no_demo = false()`);
    expect(find(choices, 'integer_demo').shownWhen).toEqual({ kind: 'any', parts: [{ question: 'seen', test: 'isNot', value: 'B' }, { question: 'yes_no_demo', test: 'is', value: false }] });
    // Always shown again
    expect(written(apply(out, { op: 'setShownWhen', id: id(basic, 'integer_demo'), when: null }), 'integer_demo', 'relevant')).toBeUndefined();
  });

  it('reads the forms of answered the templates use', () => {
    const lookup = (n: string) => (n === 'b' ? { yesNo: true } : { yesNo: false });
    expect(readCondition('not(idm:blank(visible_strata))', lookup)).toEqual(all({ question: 'visible_strata', test: 'answered', value: null }));
    expect(readCondition("idm:blank(coverage) or coverage='na'", lookup)).toEqual({ kind: 'any', parts: [{ question: 'coverage', test: 'notAnswered', value: null }, { question: 'coverage', test: 'is', value: 'na' }] });
    expect(readCondition('not(idm:blank(x)', lookup).kind).toBe('advanced');
  });

  it('refuses a row Collect would refuse, or the form could not keep to', () => {
    const integer = id(basic, 'integer_demo');
    const shown = (...parts: ConditionRows['parts']): SurveyOperation => ({ op: 'setShownWhen', id: integer, when: all(...parts) });
    expect(refused(basic, shown({ question: 'nothing', test: 'answered', value: null }))).toBe('There is no question nothing.');
    expect(refused(basic, shown({ question: 'code_demo', test: 'is', value: 'Z' }))).toBe('The list of code_demo has no code Z.');
    expect(refused(basic, shown({ question: 'code_demo', test: 'lt', value: 3 }))).toBe('code_demo cannot be tested that way.');
    expect(refused(basic, shown({ question: 'yes_no_demo', test: 'is', value: 'yes' }))).toBe('yes_no_demo is answered yes or no.');
    expect(refused(basic, shown({ question: 'elevation', test: 'gt', value: 1e21 }))).toMatch(/not a number/);
    expect(refused(basic, shown({ question: 'integer_demo', test: 'answered', value: null }))).toMatch(/its own answer/);
    expect(refused(basic, { op: 'setShownWhen', id: integer, when: all() })).toBe('A condition needs a row.');
    expect(refused(basic, { op: 'setShownWhen', id: id(basic, 'operator'), when: null })).toMatch(/fields Collect Earth needs/);
    expect(refused(basic, { op: 'setShownWhen', id: id(basic, 'calculated_slope_class'), when: null })).toMatch(/calculated/);
    // memo_text_demo is shown when yes_no_demo is yes: yes_no_demo cannot be shown when memo_text_demo is answered
    expect(refused(basic, { op: 'setShownWhen', id: id(basic, 'yes_no_demo'), when: all({ question: 'memo_text_demo', test: 'answered', value: null }) })).toBe(
      'Shown when would go round in a circle: yes_no_demo → memo_text_demo → yes_no_demo.',
    );
  });

  it('makes a question required when the rows hold', () => {
    const when = all({ question: 'code_demo', test: 'is', value: 'B' });
    const out = apply(basic, { op: 'setRequired', id: id(basic, 'short_text_demo'), required: when });
    expect(written(out, 'short_text_demo', 'requiredIf')).toBe("code_demo = 'B'");
    expect(written(out, 'short_text_demo', 'required')).toBeUndefined();
    expect(find(out, 'short_text_demo').required).toEqual({ when });
    expect(find(apply(out, { op: 'setRequired', id: id(basic, 'short_text_demo'), required: true }), 'short_text_demo').required).toBe('always');
  });
});

describe('rules from the builder', () => {
  const range = (min: number | null, max: number | null, more: Partial<NewRule> = {}): NewRule =>
    ({
      flag: 'error',
      message: {},
      when: null,
      kind: 'range',
      min: min === null ? null : { bound: { number: min }, inclusive: true },
      max: max === null ? null : { bound: { number: max }, inclusive: true },
      ...more,
    }) as NewRule;

  it('adds, changes and deletes a range, a warning with its message, kept in the other languages', () => {
    const integer = id(basic, 'integer_demo');
    const out = apply(basic, { op: 'addRule', id: integer, rule: range(0, 100, { flag: 'warning', message: { en: 'Between 0 and 100', es: 'Entre 0 y 100' }, when: all({ question: 'code_demo', test: 'is', value: 'A' }) }) });
    const rules = find(out, 'integer_demo').rules;
    expect(rules).toHaveLength(2);
    expect(rules[1]).toEqual({
      flag: 'warning',
      message: { en: 'Between 0 and 100', es: 'Entre 0 y 100' },
      when: all({ question: 'code_demo', test: 'is', value: 'A' }),
      kind: 'range',
      min: { bound: { number: 0 }, inclusive: true },
      max: { bound: { number: 100 }, inclusive: true },
    });
    expect(out.toString('latin1')).toContain(`<compare flag="warn" if="code_demo = 'A'" gte="0" lte="100">`);
    expect(new SurveyEdit(out).problems()).toEqual([]);
    // Changed in English only: the Spanish message stays
    const changed = apply(out, { op: 'setRule', id: integer, index: 1, rule: range(1, null, { message: { en: 'At least 1' } }) });
    expect(find(changed, 'integer_demo').rules[1]).toMatchObject({ flag: 'error', message: { es: 'Entre 0 y 100', en: 'At least 1' }, when: null, min: { bound: { number: 1 } }, max: null });
    const deleted = apply(changed, { op: 'deleteRule', id: integer, index: 0 });
    expect(find(deleted, 'integer_demo').rules.map((r) => r.kind === 'range' && r.min)).toEqual([{ bound: { number: 1 }, inclusive: true }]);
  });

  it('compares a number with another question, and a text with its length', () => {
    const out = apply(
      basic,
      { op: 'addQuestion', type: 'integer', label: { en: 'Most trees' }, page: 'plot_tab' },
      { op: 'addRule', id: id(basic, 'integer_demo'), rule: { flag: 'error', message: {}, when: null, kind: 'range', min: null, max: { bound: { question: 'most_trees' }, inclusive: false } } },
      { op: 'addRule', id: id(basic, 'short_text_demo'), rule: { flag: 'error', message: { en: 'Two to ten' }, when: null, kind: 'length', min: 2, max: 10 } },
    );
    expect(find(out, 'integer_demo').rules[1]).toMatchObject({ kind: 'range', min: null, max: { bound: { question: 'most_trees' }, inclusive: false } });
    expect(find(out, 'short_text_demo').rules[1]).toMatchObject({ kind: 'length', min: 2, max: 10 });
    expect(written(out, 'short_text_demo', 'name')).toBe('short_text_demo');
    expect(out.toString('latin1')).toContain('expr="string-length($this) &gt;= 2 and string-length($this) &lt;= 10"');
    expect(new SurveyEdit(out).problems()).toEqual([]);
  });

  it('refuses a rule that does not suit its question, or that no answer passes', () => {
    const integer = id(basic, 'integer_demo');
    expect(refused(basic, { op: 'addRule', id: id(basic, 'short_text_demo'), rule: range(0, 1) })).toBe('A range is for a number.');
    expect(refused(basic, { op: 'addRule', id: integer, rule: range(10, 5) })).toMatch(/No answer fits/);
    expect(refused(basic, { op: 'addRule', id: integer, rule: range(null, null) })).toMatch(/lowest or a highest/);
    expect(refused(basic, { op: 'addRule', id: integer, rule: { flag: 'error', message: {}, when: null, kind: 'length', min: 1, max: null } })).toBe('A length is for a text.');
    expect(refused(basic, { op: 'addRule', id: integer, rule: { flag: 'error', message: {}, when: null, kind: 'total', test: 'atMost', total: 100 } })).toBe('A total is for a number column of a table.');
    expect(refused(basic, { op: 'addRule', id: integer, rule: { flag: 'error', message: {}, when: null, kind: 'range', min: { bound: { question: 'code_demo' }, inclusive: true }, max: null } })).toBe('code_demo is not a number.');
    expect(refused(basic, { op: 'setRule', id: integer, index: 5, rule: range(0, 1) })).toBe('The question has no rule 6.');
    expect(refused(basic, { op: 'addRule', id: id(basic, 'elevation'), rule: range(0, 1) })).toBe('elevation comes from the plot file: nobody answers it.');
    expect(refused(basic, { op: 'addRule', id: integer, rule: range(0, 1, { message: { de: 'x' } }) })).toMatch(/no language de/);
  });

  it("writes the trial of stage 4 the desktop's test reads: a table's total, conditions in a row and on the plot", () => {
    const landUse = surveyDesign(multipurpose).pages.flatMap((p) => p.items).find((i) => i.name === 'land_use')!;
    const withColumn = apply(multipurpose, { op: 'addQuestion', type: 'integer', label: { en: 'Percentage' }, table: landUse.id });
    const percentage = id(withColumn, 'percentage');
    const trial = apply(
      withColumn,
      { op: 'addRule', id: percentage, rule: { flag: 'error', message: { en: 'The land uses add up to 100 at most' }, when: null, kind: 'total', test: 'atMost', total: 100 } },
      // In a row: its own question and the plot's
      { op: 'addRule', id: percentage, rule: { flag: 'warning', message: {}, when: all({ question: 'lu', test: 'is', value: 'F' }, { question: 'grassland_management', test: 'is', value: false }), kind: 'range', min: { bound: { number: 10 }, inclusive: true }, max: null } },
      { op: 'setShownWhen', id: percentage, when: all({ question: 'lu_t2', test: 'answered', value: null }) },
      { op: 'setRequired', id: id(withColumn, 'grassland_management'), required: all({ question: 'lu_t2', test: 'is', value: 'G' }) },
    );
    const rules = find(trial, 'percentage').rules;
    expect(rules[0]).toMatchObject({ kind: 'total', test: 'atMost', total: 100 });
    expect(rules[1]).toMatchObject({ kind: 'range', flag: 'warning', when: all({ question: 'lu', test: 'is', value: 'F' }, { question: 'grassland_management', test: 'is', value: false }) });
    expect(trial.toString('latin1')).toContain('expr="sum(parent()/land_use/percentage) &lt;= 100"');
    expect(written(trial, 'percentage', 'relevant')).toBe('not(idm:blank(parent()/lu_t2))');
    expect(find(trial, 'percentage').shownWhen).toEqual(all({ question: 'lu_t2', test: 'answered', value: null }));
    expect(new SurveyEdit(trial).problems()).toEqual([]);
    // A question of a table cannot be named from the plot
    expect(refused(trial, { op: 'setShownWhen', id: id(trial, 'lu_t2'), when: all({ question: 'lu', test: 'answered', value: null }) })).toMatch(/lu is in a table/);
    const path = `${DESIGNER}logic.idm.xml`;
    if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(path)) writeFileSync(path, trial);
    expect(readFileSync(path, 'latin1').replace(/\r\n/g, '\n')).toBe(trial.toString('latin1').replace(/\r\n/g, '\n'));
  });
});

describe('rules and conditions tried on the plots collected', () => {
  const records: ImpactRecord[] = [
    { recordKey: '1', summary: { collect_integer_integer_demo: '150', collect_code_code_demo: 'A', collect_boolean_yes_no_demo: 'true', collect_text_memo_text_demo: 'note' } },
    { recordKey: '2', summary: { collect_integer_integer_demo: '50', collect_code_code_demo: 'B', collect_boolean_yes_no_demo: 'false' } },
    { recordKey: '3', summary: { collect_integer_integer_demo: '500', collect_code_code_demo: 'B', collect_text_short_text_demo: 'x' } },
    { recordKey: '4', summary: { collect_code_code_demo: 'A' } },
  ];
  const integer = id(basic, 'integer_demo');

  it('counts the plots a new rule flags, where it applies', () => {
    const rule: NewRule = { flag: 'error', message: {}, when: null, kind: 'range', min: null, max: { bound: { number: 100 }, inclusive: true } };
    expect(surveyImpact(basic, [{ op: 'addRule', id: integer, rule }], records, apply(basic, { op: 'addRule', id: integer, rule })).effects).toEqual([
      { kind: 'ruleFlags', question: 'integer_demo', flagged: 2, checked: 3, examples: ['1', '3'] },
    ]);
    const onlyB: NewRule = { ...rule, when: all({ question: 'code_demo', test: 'is', value: 'B' }) };
    expect(surveyImpact(basic, [{ op: 'addRule', id: integer, rule: onlyB }], records).effects).toEqual([{ kind: 'ruleFlags', question: 'integer_demo', flagged: 1, checked: 2, examples: ['3'] }]);
    const length: NewRule = { flag: 'error', message: {}, when: null, kind: 'length', min: 2, max: null };
    expect(surveyImpact(basic, [{ op: 'addRule', id: id(basic, 'short_text_demo'), rule: length }], records).effects).toEqual([{ kind: 'ruleFlags', question: 'short_text_demo', flagged: 1, checked: 1, examples: ['3'] }]);
    // A question hidden by its condition is not checked: memo_text_demo shows when yes_no_demo is yes
    expect(surveyImpact(basic, [{ op: 'addRule', id: id(basic, 'memo_text_demo'), rule: length }], [...records, { recordKey: '5', summary: { collect_boolean_yes_no_demo: 'false', collect_text_memo_text_demo: 'y' } }]).effects).toEqual([
      { kind: 'ruleFlags', question: 'memo_text_demo', flagged: 0, checked: 1, examples: [] },
    ]);
  });

  it('counts the answers a new condition would hide, and the plots a conditional required flags', () => {
    expect(surveyImpact(basic, [{ op: 'setShownWhen', id: integer, when: all({ question: 'code_demo', test: 'is', value: 'A' }) }], records).effects).toEqual([
      { kind: 'hiddenAnswers', question: 'integer_demo', answered: 2 },
    ]);
    expect(surveyImpact(basic, [{ op: 'setRequired', id: id(basic, 'short_text_demo'), required: all({ question: 'code_demo', test: 'is', value: 'B' }) }], records).effects).toEqual([
      { kind: 'nowRequired', question: 'short_text_demo', unanswered: 1 },
    ]);
  });

  it("adds a table's rows for a total", () => {
    const landUse = surveyDesign(multipurpose).pages.flatMap((p) => p.items).find((i) => i.name === 'land_use')!;
    const withColumn = apply(multipurpose, { op: 'addQuestion', type: 'integer', label: { en: 'Percentage' }, table: landUse.id });
    const rule: NewRule = { flag: 'error', message: {}, when: null, kind: 'total', test: 'exactly', total: 100 };
    const ops: SurveyOperation[] = [{ op: 'addRule', id: id(withColumn, 'percentage'), rule }];
    const rows = (a: string, b: string) => ({ 'collect_entity_land_use[F].integer_percentage': a, 'collect_entity_land_use[C].integer_percentage': b });
    const impact = surveyImpact(withColumn, ops, [
      { recordKey: 'a', summary: rows('60', '40') },
      { recordKey: 'b', summary: rows('60', '30') },
      { recordKey: 'c', summary: {} },
    ]);
    expect(impact).toEqual({ plots: 3, effects: [{ kind: 'ruleFlags', question: 'percentage', flagged: 1, checked: 2, examples: ['b'] }] });
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

  it('tries a rule on the plots collected, then saves it', async () => {
    const files = unzipSync(realDemoCep());
    delete files['survey_guide.pdf'];
    const entries = new Map(Object.entries(files));
    entries.set('placemark.idm.xml', basic);
    const p = await createProject(ctx.app);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(up.statusCode, up.body).toBeLessThan(300);
    const sync = await batchRequest(ctx.app, p.projectId, p.projectToken, [
      envelope({ recordKey: '7', operator: 'ana', summary: { collect_integer_integer_demo: '250', collect_text_id: '7' } }),
      envelope({ recordKey: '8', operator: 'ana', summary: { collect_integer_integer_demo: '25', collect_text_id: '8' } }),
    ]);
    expect(sync.statusCode, sync.body).toBe(200);
    const first = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const integer = questions(first.design!).find((q) => q.name === 'integer_demo')!;
    const ops = [{ op: 'addRule', id: integer.id, rule: { flag: 'warning', message: { en: 'Below 100?' }, when: null, kind: 'range', min: null, max: { bound: { number: 100 }, inclusive: true } } }];
    const impact = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design/impact`, headers: bearer(p.adminToken), payload: { operations: ops } });
    expect(impact.json()).toEqual({ plots: 2, effects: [{ kind: 'ruleFlags', question: 'integer_demo', flagged: 1, checked: 2, examples: ['7'] }] });
    const bad = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design/impact`, headers: bearer(p.adminToken), payload: { operations: [{ op: 'addRule', id: integer.id, rule: { flag: 'loud', kind: 'range' } }] } });
    expect(bad.statusCode).toBe(400);
    const saved = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken), payload: { revision: first.revision, operations: ops } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(questions((saved.json() as SurveyDesignAnswer).design!).find((q) => q.name === 'integer_demo')!.rules[1]).toMatchObject({ flag: 'warning', message: { en: 'Below 100?' } });
  });
});
