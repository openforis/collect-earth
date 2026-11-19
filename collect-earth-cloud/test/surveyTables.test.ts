// The survey designer's stage 4c (docs/plans/2026-11-18-survey-designer.md): tables (one row per answer of a list)
// added and deleted, and sub-lists (a choice offering the answers under another question's answer). The changed
// basic template is written to the desktop's test resources, where DesignedSurveyIdmlTest reads it with Collect.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { surveyDesign } from '../src/survey/design.js';
import { SurveyEdit, SurveyEditError } from '../src/survey/edit.js';
import { surveyImpact } from '../src/survey/impact.js';
import type { DesignItem, DesignQuestion, DesignTable, SurveyOperation } from '../src/wire/survey.js';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const DESIGNER = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/designer/', import.meta.url));
const basic = readFileSync(`${TEMPLATES}collect_earth.idm.xml`);

const items = (survey: Buffer): DesignItem[] => surveyDesign(survey).pages.flatMap((p) => p.items);
const table = (survey: Buffer, name: string) => items(survey).find((i) => i.name === name) as DesignTable;
const question = (survey: Buffer, name: string) =>
  items(survey).flatMap((i) => (i.kind === 'table' ? i.columns : [i])).find((q) => q.name === name) as DesignQuestion;
const apply = (survey: Buffer, ...ops: SurveyOperation[]) => {
  const s = new SurveyEdit(survey);
  for (const op of ops) s.apply(op);
  return s.bytes();
};
const refused = (survey: Buffer, ...ops: SurveyOperation[]) => {
  try {
    apply(survey, ...ops);
  } catch (err) {
    if (err instanceof SurveyEditError) return err.message;
    throw err;
  }
  return 'made';
};

const landUses: SurveyOperation = {
  op: 'addList',
  name: 'land_uses',
  label: { en: 'Land uses', es: 'Usos de la tierra' },
  items: [
    { code: 'F', label: { en: 'Forest' } },
    { code: 'G', label: { en: 'Grassland' } },
  ],
};

describe('tables', () => {
  it('adds a table of one row per answer, with columns and a total, and deletes it', () => {
    const withTable = apply(basic, landUses, { op: 'addTable', label: { en: 'Land use in the plot' }, page: 'plot_tab', rows: 'land_uses' });
    const t = table(withTable, 'land_use_in_the_plot');
    expect(t).toMatchObject({ kind: 'table', rowsList: 'land_uses', layout: 'table' });
    expect(t.columns.map((c) => [c.name, c.key])).toEqual([['land_use_in_the_plot_row', true]]);
    const out = apply(
      withTable,
      { op: 'addQuestion', type: 'integer', label: { en: 'Share (%)' }, table: t.id },
      { op: 'addQuestion', type: 'yesNo', label: { en: 'Burnt' }, table: t.id },
    );
    const share = question(out, 'share');
    const withTotal = apply(out, { op: 'addRule', id: share.id, rule: { flag: 'error', message: { en: 'At most 100' }, when: null, kind: 'total', test: 'atMost', total: 100 } });
    expect(new SurveyEdit(withTotal).problems()).toEqual([]);
    expect(withTotal.toString('latin1')).toMatch(/<entity id="\d+" name="land_use_in_the_plot" multiple="true" ui:tab="plot_tab" ui:layout="table" collect:enumerate="true">/);
    // Deleted with its columns; the plots with answers in it are counted first
    const del: SurveyOperation = { op: 'deleteTable', id: t.id };
    expect(
      surveyImpact(withTotal, [del], [
        { recordKey: '1', summary: { 'collect_entity_land_use_in_the_plot[F].integer_share': '40', 'collect_entity_land_use_in_the_plot[F].code_land_use_in_the_plot_row': 'F' } },
        { recordKey: '2', summary: { 'collect_entity_land_use_in_the_plot[F].code_land_use_in_the_plot_row': 'F' } },
      ]).effects,
    ).toEqual([{ kind: 'tableDeleted', table: 'land_use_in_the_plot', answered: 1 }]);
    const gone = apply(withTotal, del);
    expect(items(gone).some((i) => i.name === 'land_use_in_the_plot')).toBe(false);
    expect(new SurveyEdit(gone).problems()).toEqual([]);
  });

  it('refuses rows from an unknown or empty list, a name taken; a table\'s own condition goes with it', () => {
    expect(refused(basic, { op: 'addTable', label: { en: 'x' }, page: 'plot_tab', rows: 'nothing' })).toBe('No list nothing.');
    // A list of no answers is refused itself (Collect refuses <items/>)
    expect(refused(basic, { op: 'addList', name: 'empty', label: { en: 'Empty' }, items: [] }, { op: 'addTable', label: { en: 'x' }, page: 'plot_tab', rows: 'empty' })).toMatch(/at least one answer/);
    expect(refused(basic, landUses, { op: 'addTable', label: { en: 'x' }, page: 'plot_tab', rows: 'land_uses', name: 'code_demo' })).toBe('There is a question code_demo already.');
    const withTable = apply(basic, landUses, { op: 'addTable', label: { en: 'Cover' }, page: 'plot_tab', rows: 'land_uses' });
    const t = table(withTable, 'cover');
    const used = apply(
      withTable,
      { op: 'addQuestion', type: 'integer', label: { en: 'Share' }, table: t.id },
      { op: 'addQuestion', type: 'integer', label: { en: 'Trees' }, page: 'plot_tab' },
    );
    const withCondition = apply(used, { op: 'setShownWhen', id: t.id, when: { kind: 'all', parts: [{ question: 'trees', test: 'gt', value: 0 }] } });
    // A condition of the table on the plot's question is the table's own: it goes with it
    expect(refused(withCondition, { op: 'deleteTable', id: t.id })).toBe('made');
    expect(refused(basic, { op: 'deleteTable', id: question(basic, 'code_demo').id })).toBe('Not a table.');
  });
});

describe('sub-lists', () => {
  it('adds answers under answers, and a question offering those of another question\'s answer', () => {
    const out = apply(
      basic,
      landUses,
      { op: 'addItem', list: 'land_uses', under: 'F', item: { code: 'F1', label: { en: 'Natural forest' } } },
      { op: 'addItem', list: 'land_uses', under: 'F', item: { code: 'F2', label: { en: 'Plantation' } } },
      { op: 'addItem', list: 'land_uses', under: 'G', item: { code: 'G1', label: { en: 'Pasture' } } },
      { op: 'addItem', list: 'land_uses', under: 'F', before: 'F2', item: { code: 'F3', label: { en: 'Mangrove' } } },
      { op: 'addQuestion', type: 'choice', label: { en: 'Land use' }, page: 'plot_tab', list: 'land_uses' },
      { op: 'addQuestion', type: 'choice', label: { en: 'Subdivision' }, page: 'plot_tab', parent: 'land_use' },
    );
    const list = surveyDesign(out).lists.find((l) => l.name === 'land_uses')!;
    expect(list.items.map((i) => [i.code, i.items.map((s) => s.code)])).toEqual([['F', ['F1', 'F3', 'F2']], ['G', ['G1']]]);
    expect(question(out, 'subdivision')).toMatchObject({ type: 'choice', list: 'land_uses', parentQuestion: 'land_use' });
    expect(out.toString('latin1')).toMatch(/<hierarchy>\s*<level name="level1" \/>\s*<level name="level2" \/>\s*<\/hierarchy>/);
    expect(new SurveyEdit(out).problems()).toEqual([]);
    // A sub-answer moves among its own level and is deleted like any answer
    const moved = apply(out, { op: 'moveItem', list: 'land_uses', code: 'F2', before: 'F1' }, { op: 'deleteItem', list: 'land_uses', code: 'G1' });
    expect(surveyDesign(moved).lists.find((l) => l.name === 'land_uses')!.items.map((i) => i.items.map((s) => s.code))).toEqual([['F2', 'F1', 'F3'], []]);
    expect(refused(out, { op: 'moveItem', list: 'land_uses', code: 'F2', before: 'G' })).toMatch(/among the answers of its level/);
  });

  it('refuses a code the list has at another level, a sub-list of several answers or of nothing', () => {
    expect(refused(basic, landUses, { op: 'addItem', list: 'land_uses', under: 'F', item: { code: 'G', label: { en: 'x' } } })).toBe('The list has a code G already.');
    expect(refused(basic, landUses, { op: 'addQuestion', type: 'choices', label: { en: 'Uses' }, page: 'plot_tab', list: 'land_uses' }, { op: 'addQuestion', type: 'choice', label: { en: 'Sub' }, page: 'plot_tab', parent: 'uses' })).toMatch(/several answers/);
    expect(refused(basic, { op: 'addQuestion', type: 'choice', label: { en: 'Sub' }, page: 'plot_tab', parent: 'short_text_demo' })).toMatch(/is not one/);
  });

  it("writes the trial of stage 4c the desktop's test reads", () => {
    const withTable = apply(
      basic,
      landUses,
      { op: 'addItem', list: 'land_uses', under: 'F', item: { code: 'F1', label: { en: 'Natural forest' } } },
      { op: 'addItem', list: 'land_uses', under: 'G', item: { code: 'G1', label: { en: 'Pasture' } } },
      { op: 'addQuestion', type: 'choice', label: { en: 'Land use' }, page: 'plot_tab', list: 'land_uses' },
      { op: 'addQuestion', type: 'choice', label: { en: 'Subdivision' }, page: 'plot_tab', parent: 'land_use' },
      { op: 'addTable', label: { en: 'Cover' }, page: 'tab_1312', rows: 'land_uses' },
    );
    const t = table(withTable, 'cover');
    const trial = apply(
      withTable,
      { op: 'addQuestion', type: 'integer', label: { en: 'Share' }, table: t.id },
      { op: 'addQuestion', type: 'choice', label: { en: 'Kind' }, table: t.id, list: 'demo_codelist' },
    );
    const withRule = apply(trial, { op: 'addRule', id: question(trial, 'share').id, rule: { flag: 'error', message: {}, when: { kind: 'all', parts: [{ question: 'kind', test: 'is', value: 'A' }] }, kind: 'total', test: 'exactly', total: 100 } });
    expect(new SurveyEdit(withRule).problems()).toEqual([]);
    const path = `${DESIGNER}tables.idm.xml`;
    if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(path)) writeFileSync(path, withRule);
    expect(readFileSync(path, 'latin1').replace(/\r\n/g, '\n')).toBe(withRule.toString('latin1').replace(/\r\n/g, '\n'));
  });
});
