// The survey designer's stage 5 (docs/plans/2026-11-18-survey-designer.md): a project without a project file starts
// from one of Collect's templates or a blank survey, with its title, its own identifier, its language and its years.
// The blank survey and the multipurpose one with other years are written to the desktop's test resources, where
// DesignedSurveyIdmlTest reads them with Collect.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cepProperties, readCep } from '../src/cep.js';
import { surveyDesign } from '../src/survey/design.js';
import { SurveyEdit } from '../src/survey/edit.js';
import { newProjectFile, newSurvey } from '../src/survey/templates.js';
import type { SurveyDesignAnswer, SurveyTemplate } from '../src/wire/survey.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const DESIGNER = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/designer/', import.meta.url));
const projectId = '3f2a9c1e-0000-4000-8000-000000000000';
const keep = (name: string, bytes: Buffer) => {
  const path = `${DESIGNER}${name}`;
  if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(path)) writeFileSync(path, bytes);
  expect(readFileSync(path, 'latin1').replace(/\r\n/g, '\n')).toBe(bytes.toString('latin1').replace(/\r\n/g, '\n'));
};

describe('a new survey', () => {
  it.each(['blank', 'basic', 'multipurpose', 'ipcc'] as SurveyTemplate[])('%s: titled, its own, without a problem', (template) => {
    const { survey, surveyName } = newSurvey({ template, title: 'Forêt du Nord 2026', language: 'fr', projectId });
    expect(surveyName).toBe('foret_du_nord_2026_3f2a9c1e');
    const d = surveyDesign(survey);
    expect(d.title).toMatchObject({ en: 'Forêt du Nord 2026', fr: 'Forêt du Nord 2026' });
    expect(survey.toString('utf8')).toContain('<uri>http://www.openforis.org/idm/foret_du_nord_2026_3f2a9c1e</uri>');
    expect(new SurveyEdit(survey).problems()).toEqual([]);
  });

  it('blank: only what Collect Earth needs, one page, the land use to start from', () => {
    const { survey } = newSurvey({ template: 'blank', title: 'Blank', language: 'en', projectId });
    const d = surveyDesign(survey);
    expect(d.pages.map((p) => [p.name, p.label.es, p.items.map((i) => i.name)])).toEqual([['plot_tab', 'Parcela', ['land_use']]]);
    expect(d.emptyPages).toEqual([]);
    expect(d.fromPlotFile.map((q) => q.name)).toEqual(['elevation', 'slope', 'aspect']);
    expect(d.lists.map((l) => l.name).sort()).toEqual(['elevation_ranges', 'land_use_categories', 'orientation', 'slope_classes']);
    expect(d.lists.find((l) => l.name === 'land_use_categories')!.items.map((i) => [i.code, i.label.fr])).toContainEqual(['W', 'Terres humides']);
    keep('new-blank.idm.xml', survey);
  });

  it('adds the language written in, and sets the years of a template with years', () => {
    const { survey } = newSurvey({ template: 'multipurpose', title: 'Multi', language: 'tr', projectId, years: { first: 2010, last: 2024 } });
    const d = surveyDesign(survey);
    expect(d.languages.at(-1)).toBe('tr');
    expect(d.lists.find((l) => l.name === 'years')!.items.map((i) => i.code)).toEqual(Array.from({ length: 15 }, (_, i) => String(2024 - i)));
    expect(survey.toString('utf8')).toMatch(/name="base_year"[\s\S]*?<default value="2024" \/>/);
    keep('new-multipurpose.idm.xml', survey);
    expect(() => newSurvey({ template: 'basic', title: 'x', language: 'en', projectId, years: { first: 2000, last: 2020 } })).toThrow(/no list of years/);
    expect(() => newSurvey({ template: 'ipcc', title: 'x', language: 'en', projectId, years: { first: 2020, last: 2000 } })).toThrow(/first year/);
  });

  it('becomes a project file Collect Earth opens: survey, properties, plot layout', () => {
    const files = readCep(newProjectFile({ template: 'basic', title: 'Basic', language: 'en', projectId }, new Date(Date.UTC(2026, 10, 18))));
    const properties = cepProperties(files);
    expect(properties.get('survey_name')).toBe('basic_3f2a9c1e');
    expect(properties.get('sample_shape')).toBe('SQUARE');
    expect(properties.get('number_of_sampling_points_in_plot')).toBe('25');
    expect([...files.entries.keys()]).toEqual(expect.arrayContaining(['placemark.idm.xml', 'project_definition.properties', 'kml_template.fmt']));
    // No balloon: Collect Earth 2 makes the form from the survey
    expect([...files.entries.keys()].filter((name) => name.includes('balloon'))).toEqual([]);
    expect(properties.has('balloon')).toBe(false);
  });
});

describe('POST /survey/new', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('starts a project without a project file from a template, once', async () => {
    const p = await createProject(ctx.app);
    const make = (payload: object) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/new`, headers: bearer(p.adminToken), payload });
    expect((await make({ template: 'basic', title: 'x', language: 'en', years: { first: 2000, last: 2020 } })).statusCode).toBe(400);
    expect((await make({ template: 'other', title: 'x', language: 'en' })).statusCode).toBe(400);
    const res = await make({ template: 'ipcc', title: 'Inventory 2026', language: 'es', years: { first: 2000, last: 2026 } });
    expect(res.statusCode, res.body).toBe(200);
    const answer = res.json() as SurveyDesignAnswer;
    expect(answer.design?.title.es).toBe('Inventory 2026');
    expect(answer.problems).toEqual([]);
    expect(answer.editable).toBe(true);
    const cep = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/cep`, headers: bearer(p.adminToken) });
    expect(cep.statusCode).toBe(200);
    expect((await make({ template: 'blank', title: 'Again', language: 'en' })).json().error).toBe('has_project_file');
    // Every member reads the survey's revision (Collect Earth compares it with the survey it opened)
    const revision = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/revision`, headers: bearer(p.projectToken) });
    expect(revision.json()).toEqual({ revision: answer.revision });
    const changed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${p.projectId}/survey/design`,
      headers: bearer(p.adminToken),
      payload: { revision: answer.revision, operations: [{ op: 'setText', target: { kind: 'title' }, part: 'label', language: 'es', text: 'Inventario' }] },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    const after = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/revision`, headers: bearer(p.projectToken) })).json();
    expect(after.revision).not.toBe(answer.revision);
    expect(after.revision).toBe((changed.json() as SurveyDesignAnswer).revision);
  });
});
