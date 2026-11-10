// The import of Collect Earth Online surveys (src/ceo, plan docs/plans/2026-11-09-ceo-bridge.md, B1 and B2), on real
// public CEO projects (test/fixtures/ceo, their README says why each is there) and on small made-up ones for the cases
// no public project has. The surveys written for the fixtures are kept in the desktop's test resources, where
// CeoSurveyIdmlTest reads them with Collect itself: UPDATE_CEO_IDML=1 writes them again after a change.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ceoSurvey, CeoImportError, readCeoProject } from '../src/ceo/index.js';
import { DEFAULT_SIDE_M, layoutProperties } from '../src/ceo/plots.js';
import { slug } from '../src/ceo/survey.js';
import { plotFileCsv } from '../src/plotDesign.js';
import { parsePlotFile } from '../src/plots.js';
import { plotOutline } from '../src/plotShape.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/ceo/', import.meta.url));
const IDML_DIR = fileURLToPath(new URL('../../collect-earth/collect-earth-app/src/test/resources/ceo/', import.meta.url));
const fixture = (id: number) => readFileSync(`${FIXTURES}project-${id}.json`, 'utf8');
const survey = (id: number) => ceoSurvey(fixture(id));
const attribute = (s: ReturnType<typeof ceoSurvey>, ceoId: string) => s.plan.byCeoId.get(ceoId)!;

/** A made-up CEO project, with only what the import reads */
function project(questions: Record<string, object>, rules: object[] = [], extra: object = {}): string {
  return JSON.stringify({ id: 7, name: 'Made up', type: 'regular', samplesPerPlot: 1, surveyQuestions: questions, surveyRules: rules, ...extra });
}
const q = (question: string, answers: Record<string, string>, more: object = {}) => ({
  question, componentType: 'button', dataType: 'text', parentQuestionId: -1, parentAnswerIds: [],
  answers: Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, { answer: a, color: '#000000' }])), ...more,
});

describe('reading a CEO project file', () => {
  it('refuses what is not one, and simplified projects', () => {
    expect(() => readCeoProject('<html>')).toThrow(CeoImportError);
    expect(() => readCeoProject('{"name":"x"}')).toThrow(/no survey questions/);
    expect(() => survey(64113)).toThrow(/simplified/);
  });

  it('reads the questions, answers and rules as CEO writes them', () => {
    const p = readCeoProject(fixture(2616));
    expect(p.questions).toHaveLength(29);
    expect(p.rules.map((r) => r.ruleType)).toContain('matching-sums');
    const first = p.questions.find((x) => x.id === '1')!;
    expect(first).toMatchObject({ question: 'Uso del Suelo 2018 - Centroide', componentType: 'button', dataType: 'text', parentQuestionId: null });
  });
});

describe('the survey', () => {
  it('the simplest project: one question of buttons, asked for every plot', () => {
    const s = survey(1);
    expect(s.plan.attributes).toHaveLength(1);
    const lulc = s.plan.attributes[0];
    expect(lulc).toMatchObject({ name: 'lulc', kind: 'code', layout: 'buttons', required: true, relevant: null });
    expect(lulc.items.map((i) => i.label)).toEqual(['Forest', 'Grassland', 'Bare Surface', 'Impervious Surface', 'Agriculture', 'Urban', 'Water', 'Cloud', 'Unknown']);
    expect(lulc.items[0].code).toBe('forest');
    expect(s.surveyName).toBe('ceo_1');
    // 15 samples per plot in CEO: said, once for the project
    expect(s.report.entries.find((e) => e.subject === 'Samples')).toMatchObject({ outcome: 'changed' });
  });

  it('answers that are numbers keep the numbers as codes, which the sum rules add', () => {
    const s = survey(2616);
    const forest = attribute(s, '16');
    expect(forest).toMatchObject({ kind: 'code', numericCodes: true });
    expect(forest.items.map((i) => i.code)).toEqual(expect.arrayContaining(['80', '20']));
  });

  it('a child question is shown under its parent\'s answers, and only when its parent is shown', () => {
    const s = ceoSurvey(project({
      1: q('Land use', { 1: 'Forest', 2: 'Cropland' }),
      2: q('Forest type', { 1: 'Natural', 2: 'Planted' }, { parentQuestionId: 1, parentAnswerIds: [1] }),
      3: q('Planted species', { 1: 'Pine', 2: 'Eucalyptus' }, { parentQuestionId: 2, parentAnswerIds: [2] }),
      4: q('Notes on the type', { 1: 'Some' }, { parentQuestionId: 2, parentAnswerIds: [] }),
    }));
    expect(s.plan.attributes.map((a) => a.name)).toEqual(['land_use', 'forest_type', 'planted_species', 'notes_on_the_type']);
    expect(attribute(s, '2').relevant).toBe("land_use = 'forest'");
    expect(attribute(s, '3').relevant).toBe("(land_use = 'forest') and forest_type = 'planted'");
    // no answer named: any answer of the parent shows it
    expect(attribute(s, '4').relevant).toBe("(land_use = 'forest') and not(idm:blank(forest_type))");
  });

  it('a chain of children 19 deep (project 37956) nests its relevance all the way', () => {
    const s = survey(37956);
    const deepest = s.plan.attributes.reduce((a, b) => ((b.relevant?.length ?? 0) > (a.relevant?.length ?? 0) ? b : a));
    expect((deepest.relevant!.match(/ and /g) ?? []).length).toBeGreaterThanOrEqual(18);
    expect(s.plan.attributes).toHaveLength(429 - s.report.count('skipped', 'question'));
  });

  it('hidden questions and answers are left out and said', () => {
    const s = survey(53855);
    expect(s.plan.byCeoId.has('2')).toBe(false);
    expect(s.report.entries.filter((e) => e.area === 'question' && e.outcome === 'skipped').map((e) => e.message)).toContain('Hidden in CEO: not asked.');
    const hidden = ceoSurvey(project({ 1: { ...q('Cover', { 1: 'Trees', 2: 'Old class' }), answers: { 1: { answer: 'Trees', color: '#0' }, 2: { answer: 'Old class', color: '#0', hide: true } } } }));
    expect(hidden.plan.attributes[0].items.map((i) => i.label)).toEqual(['Trees']);
    expect(hidden.report.entries[0]).toMatchObject({ outcome: 'changed' });
  });

  it('inputs: a number or a text, CEO\'s placeholder as the description, required unless CEO says not', () => {
    const s = ceoSurvey(project({
      1: { ...q('Canopy height', { 0: '9999' }), componentType: 'input', dataType: 'number' },
      2: { question: 'Comment', componentType: 'input', dataType: 'text', parentQuestionId: -1, parentAnswerIds: [],
        answers: { 0: { answer: 'insert comment here', color: '#000', required: false } } },
    }));
    expect(attribute(s, '1')).toMatchObject({ kind: 'number', required: true, description: 'In CEO: "9999"' });
    expect(attribute(s, '2')).toMatchObject({ kind: 'text', required: false });
  });

  it('names: Collect\'s rules, unique, never one Collect Earth fills itself', () => {
    expect(slug('Área de Bosque (%) 2018', 40)).toBe('area_de_bosque_2018');
    const s = ceoSurvey(project({
      1: q('ID', { 1: 'a' }),
      2: q('2018 cover', { 1: 'a' }),
      3: q('Cover', { 1: 'a' }),
      4: q('Cover', { 1: 'a' }),
    }));
    expect(s.plan.attributes.map((a) => a.name)).toEqual(['q_id', 'q_2018_cover', 'cover', 'cover_2']);
    const withColumns = ceoSurvey(project({ 1: q('Region', { 1: 'a' }) }), { columns: ['region', 'Elevation (m)'] });
    expect(withColumns.plan.columns.map((c) => c.name)).toEqual(['region', 'elevation_m']);
    expect(withColumns.plan.attributes[0].name).toBe('region_2');
  });
});

describe('the rules', () => {
  const checksOn = (s: ReturnType<typeof ceoSurvey>, name: string) => s.checks.filter((c) => c.attribute === name);

  it('sum of answers and matching sums add the chosen numbers, once every one is answered', () => {
    const s = survey(2616);
    const names = ['16', '17', '18', '19'].map((id) => attribute(s, id).name);
    const sum = s.checks.find((c) => c.kind === 'custom' && c.expr.endsWith('= 100') && c.expr.includes(`number(${names[0]})`))!;
    expect(sum).toMatchObject({ attribute: names[3], expr: `${names.map((n) => `number(${n})`).join(' + ')} = 100` });
    expect(sum.kind === 'custom' && sum.when).toBe(names.map((n) => `not(idm:blank(${n}))`).join(' and '));
    expect(s.checks.some((c) => c.kind === 'custom' && /^number\(\w+\)( \+ number\(\w+\))* = number\(\w+\)/.test(c.expr))).toBe(true);
  });

  it('incompatible answers: on the question asked last', () => {
    const s = survey(2616);
    const one = attribute(s, '11');
    const two = attribute(s, '13');
    const code = (a: typeof one, id: string) => a.items.find((i) => i.answerId === id)!.code;
    expect(checksOn(s, two.name)).toContainEqual(expect.objectContaining({
      kind: 'custom', expr: `not(${one.name} = '${code(one, '1')}' and ${two.name} = '${code(two, '1')}')`,
    }));
  });

  it('multiple incompatible answers: all the answers together rule out the last one', () => {
    const s = survey(46643);
    const multiple = s.report.entries.filter((e) => e.area === 'rule' && e.subject.startsWith('multiple-incompatible-answers'));
    expect(multiple.length).toBeGreaterThan(0);
    expect(multiple.every((e) => e.outcome === 'imported')).toBe(true);
    expect(s.checks.some((c) => c.kind === 'custom' && c.expr.startsWith('not(') && c.message.includes('cannot go with'))).toBe(true);
  });

  it('a numeric range: a compare check on a number, a custom one on numbers offered as buttons', () => {
    const s = survey(30918);
    expect(checksOn(s, attribute(s, '3').name)).toContainEqual(expect.objectContaining({ kind: 'compare', gte: 7, lte: 49 }));
    const buttons = ceoSurvey(project({ 1: { ...q('Cover', { 1: '10', 2: '50', 3: '90' }), dataType: 'number' } }, [
      { id: 0, ruleType: 'numeric-range', questionId: 1, min: 20, max: null },
    ]));
    expect(buttons.checks).toEqual([expect.objectContaining({ kind: 'custom', expr: 'number($this) >= 20', message: 'The answer to “Cover” must be at least 20.' })]);
  });

  it('a text pattern: whole answer in Collect, anywhere in it as in CEO unless anchored', () => {
    const input = (question: string) => ({ question, componentType: 'input', dataType: 'text', parentQuestionId: -1, parentAnswerIds: [], answers: { 0: { answer: '', color: '#0' } } });
    const s = ceoSurvey(project({ 1: input('Year'), 2: input('Code') }, [
      { id: 0, ruleType: 'text-match', questionId: 1, regex: '^\\d{4}$' },
      { id: 1, ruleType: 'text-match', questionId: 2, regex: '[A-Z]{2}' },
      { id: 2, ruleType: 'text-match', questionId: 2, regex: '(' },
    ]));
    expect(s.checks).toEqual([
      expect.objectContaining({ attribute: 'year', kind: 'pattern', regex: '\\d{4}' }),
      expect.objectContaining({ attribute: 'code', kind: 'pattern', regex: '.*(?:[A-Z]{2}).*' }),
    ]);
    expect(s.report.entries.find((e) => e.subject === 'text-match 2')).toMatchObject({ outcome: 'skipped' });
  });

  it('a rule naming a question that did not come across is left out and said', () => {
    const s = ceoSurvey(project({ 1: q('A', { 1: 'x' }), 2: { ...q('B', { 1: 'y' }), hideQuestion: true } }, [
      { id: 5, ruleType: 'incompatible-answers', questionId1: 1, answerId1: 1, questionId2: 2, answerId2: 1 },
      { id: 6, ruleType: 'something-new' },
    ]));
    expect(s.checks).toEqual([]);
    expect(s.report.entries.filter((e) => e.area === 'rule').map((e) => e.outcome)).toEqual(['skipped', 'skipped']);
  });

  it('on every public fixture, nearly every rule comes across', () => {
    for (const id of [2616, 30918, 46643]) {
      const s = survey(id);
      expect(s.report.count('imported', 'rule') + s.report.count('changed', 'rule')).toBe(readCeoProject(fixture(id)).rules.length);
    }
  });
});

describe('the written survey', () => {
  it('has the skeleton Collect Earth expects, the questions on their tab, the checks inside them', () => {
    const { idml } = survey(30918);
    for (const name of ['id', 'location', 'operator', 'actively_saved', 'actively_saved_on', 'plot_file', 'elevation', 'slope', 'aspect']) {
      expect(idml).toContain(`name="${name}"`);
    }
    expect(idml).toMatch(/<number id="\d+" name="[a-z_]+"[^>]* ui:tab="survey_tab" type="real">/);
    expect(idml).toContain('<compare flag="error" gte="7" lte="49">');
    expect(idml).not.toMatch(/[\u0000-\u0008]/);
  });

  // The surveys CeoSurveyIdmlTest reads with Collect: kept equal to what the import writes
  it('the fixtures\' surveys are the ones the desktop\'s test reads', () => {
    const ids = readdirSync(FIXTURES).map((f) => /^project-(\d+)\.json$/.exec(f)?.[1]).filter((x): x is string => !!x).map(Number);
    for (const id of ids) {
      if (id === 64113) continue; // simplified: refused
      const path = `${IDML_DIR}project-${id}.idm.xml`;
      const written = survey(id).idml;
      if (process.env.UPDATE_CEO_IDML === '1' || !existsSync(path)) writeFileSync(path, written);
      expect(readFileSync(path, 'utf8'), path).toBe(written);
    }
  });
});

describe('the plots (B3)', () => {
  const plotsOf = (id: number) => readFileSync(`${FIXTURES}project-${id}-plots.json`, 'utf8');
  const withPlots = (id: number) => ceoSurvey(fixture(id), { plots: plotsOf(id) });
  const plotEntries = (s: ReturnType<typeof ceoSurvey>) => s.report.entries.filter((e) => e.area === 'plots');

  it("draws CEO's plots as Collect Earth's settings say", () => {
    // a circle: its radius, the first point at the centre and the others at random
    expect(layoutProperties(survey(1).layout)).toEqual([
      'sample_shape=CIRCLE', 'number_of_sampling_points_in_plot=15', 'distance_between_sample_points=100', 'distance_to_plot_boundaries=0', 'inner_point_side=2',
    ]);
    // CEO's grid reaches the plot's edge: 6 × 6 points 20 m apart fill 100 m
    expect(survey(743).layout).toMatchObject({ shape: 'SQUARE', points: 36, distance: 20, boundary: 0 });
    expect(survey(30918).layout).toMatchObject({ shape: 'SQUARE', points: 49, distance: 10, boundary: 5 });
    // one sample at the centre: the square is twice the boundary
    expect(survey(20170).layout).toMatchObject({ shape: 'SQUARE', points: 1, distance: 0, boundary: 15 });
    // every layout gives CEO's plot side, as the dashboard and Collect Earth work it out
    for (const id of [743, 30918, 20170, 5455]) {
      const s = survey(id);
      const outline = plotOutline(new Map(layoutProperties(s.layout).map((l) => l.split('=') as [string, string])));
      expect(outline, String(id)).toEqual({ kind: 'square', sideMeters: s.project.plotSize });
    }
  });

  it('says where the layout is not CEO\'s: uploaded shapes, samples off the grid', () => {
    const shp = survey(2616);
    expect(shp.layout).toMatchObject({ shape: 'CIRCLE', distance: DEFAULT_SIDE_M / 2 });
    expect(shp.report.entries.find((e) => e.subject === 'Plot size')).toMatchObject({ outcome: 'changed', message: expect.stringContaining('shapefile') });
    expect(survey(54724).report.entries.find((e) => e.subject === 'Plot size')?.message).toMatch(/GeoJSON.*square of 30 m/);
    // 15 random samples in a square: a 4 × 4 grid
    const square = ceoSurvey(project({ 1: q('Land', { 1: 'Forest' }) }, [], { plotShape: 'square', plotSize: 40, sampleDistribution: 'random', samplesPerPlot: 15 }));
    expect(square.layout).toMatchObject({ points: 16, distance: 10, boundary: 5 });
    expect(square.report.entries.find((e) => e.subject === 'Sample points')?.message).toMatch(/at random.*4 × 4/);
  });

  it("reads CEO's plot list: each plot with the id its people saw", () => {
    const s = withPlots(30918);
    expect(s.plots).toMatchObject({ ids: 'visible', analyzed: 2, flagged: 2 });
    expect(s.plots!.plots[0]).toEqual({ id: '1425', lon: expect.any(Number), lat: expect.any(Number) });
    expect(plotEntries(s).map((e) => e.subject)).toEqual(['Plot shape', 'Plots', 'Plots done in CEO']);
    // every saved plot list comes across whole
    for (const id of [1, 743, 17814, 20170, 54724]) {
      const plots = withPlots(id).plots!;
      expect(plots.plots, String(id)).toHaveLength((JSON.parse(plotsOf(id)) as unknown[]).length);
      expect(new Set(plots.plots.map((p) => p.id)).size, String(id)).toBe(plots.plots.length);
    }
  });

  it('written as a plot file Collect Earth and the upload read: CEO ids, centres, the survey\'s columns', () => {
    const s = withPlots(1);
    const csv = plotFileCsv(s.plots!.plots, { count: 1, roundIndex: null, roundCode: '1' }, ['elevation', 'slope', 'aspect']);
    expect(csv).toBe('id,YCoordinate,XCoordinate,elevation,slope,aspect\n1,22.046807,102.999640,0,0,0\n2,12.379354,98.568022,0,0,0\n3,13.745907,106.718471,0,0,0\n');
    expect(parsePlotFile(Buffer.from(csv)).plotIds).toEqual(['1', '2', '3']);
  });

  it('refuses a file that is no plot list, or the plots of another project', () => {
    expect(() => ceoSurvey(fixture(1), { plots: '<html>' })).toThrow(/plots file is not JSON/);
    expect(() => ceoSurvey(fixture(1), { plots: fixture(1) })).toThrow(/not a Collect Earth Online plot list/);
    expect(() => ceoSurvey(fixture(1), { plots: '[{"center":"x","id":1}]' })).toThrow(/no plot with a place/);
    expect(() => ceoSurvey(fixture(1), { plots: plotsOf(743) })).toThrow(/outside this project's area/);
  });

  it("takes CEO's internal numbers when its plot ids repeat", () => {
    const point = (lon: number, lat: number) => JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
    const list = JSON.stringify([
      { center: point(100, 15), id: 1, plotId: 501 },
      { center: point(101, 16), id: 1, plotId: 502 },
    ]);
    const s = ceoSurvey(fixture(1), { plots: list });
    expect(s.plots!.ids).toBe('internal');
    expect(s.plots!.plots.map((p) => p.id)).toEqual(['501', '502']);
    expect(plotEntries(s).find((e) => e.subject === 'Plot ids')?.outcome).toBe('changed');
  });
});
