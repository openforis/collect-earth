// The survey designer's stage 2 (docs/plans/2026-11-18-survey-designer.md): the survey's words changed in the
// dashboard (labels, help texts, list answers, rule messages, page names, the title; a language added), saved into
// the project file with the survey check, kept as versions that can be brought back.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cepWith, demoCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';
import { SurveyEdit, SurveyEditError } from '../src/survey/edit.js';
import { surveyDesign } from '../src/survey/design.js';
import type { SurveyChangeRefusal, SurveyDesignAnswer, SurveyOperation, SurveyVersionsAnswer } from '../src/wire/survey.js';

const TEMPLATES = fileURLToPath(new URL('./fixtures/templates/', import.meta.url));
const template = (name: string) => readFileSync(`${TEMPLATES}collect_earth${name}.idm.xml`);

/** The lines that differ between two surveys (both read as Latin-1, lastId left out) */
function changed(before: Buffer, after: Buffer): { removed: string[]; added: string[] } {
  const lines = (b: Buffer) => b.toString('latin1').split(/\r?\n/);
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { removed: a.slice(start, a.length - end), added: b.slice(start, b.length - end) };
}

const apply = (survey: Buffer, ...ops: SurveyOperation[]) => {
  const s = new SurveyEdit(survey);
  for (const op of ops) s.apply(op);
  return s.bytes();
};

describe("the designer's operations on words", () => {
  const basic = template('');
  const design = surveyDesign(basic);
  const id = (name: string) => [...design.pages.flatMap((p) => p.items), ...design.hidden].find((q) => q.name === name)!.id;

  it("changes a question's label and help in a language, and only those lines", () => {
    const label = apply(basic, { op: 'setText', target: { kind: 'node', id: id('code_demo') }, part: 'label', language: 'es', text: 'Elija una opción' });
    expect(changed(basic, label)).toEqual({
      removed: [expect.stringMatching(/^ {8}<label type="instance" xml:lang="es">/)],
      added: ['        <label type="instance" xml:lang="es">Elija una opci&#243;n</label>'],
    });
    const help = apply(label, { op: 'setText', target: { kind: 'node', id: id('code_demo') }, part: 'help', language: 'pt', text: '' });
    const { removed, added } = changed(label, help);
    expect(added).toEqual([]);
    expect(removed[0]).toMatch(/^ {8}<description xml:lang="pt">/);
    const q = surveyDesign(help).pages[0].items.find((i) => i.name === 'code_demo')!;
    expect(q.label.es).toBe('Elija una opción');
    expect(q.help.pt).toBeUndefined();
  });

  it('writes a label in a language the question had none in, after the others', () => {
    const one = Buffer.from(
      basic.toString('latin1').replace('<label type="instance" xml:lang="fr">Démo - integer'.replace(/./gu, (c) => Buffer.from(c, 'utf8').toString('latin1')), '<label type="instance" xml:lang="xx">Démo - integer'),
      'latin1',
    );
    const out = apply(one, { op: 'setText', target: { kind: 'node', id: id('integer_demo') }, part: 'label', language: 'fr', text: 'Nombre entier' });
    const { added } = changed(one, out);
    expect(added).toContain('        <label type="instance" xml:lang="fr">Nombre entier</label>');
  });

  it('changes the title, a page, a list, an answer and its help, a rule message', () => {
    const out = apply(
      basic,
      { op: 'setText', target: { kind: 'title' }, part: 'label', language: 'en', text: 'Land use survey' },
      { op: 'setText', target: { kind: 'page', name: 'tab_1312' }, part: 'label', language: 'en', text: 'Dates' },
      { op: 'setText', target: { kind: 'list', name: 'demo_codelist' }, part: 'label', language: 'en', text: 'Options' },
      { op: 'setText', target: { kind: 'item', list: 'demo_codelist', code: 'B' }, part: 'label', language: 'fr', text: 'Option B' },
      { op: 'setText', target: { kind: 'item', list: 'demo_codelist', code: 'B' }, part: 'help', language: 'en', text: 'The second one' },
      { op: 'setText', target: { kind: 'rule', node: id('integer_demo'), index: 0 }, part: 'message', language: 'en', text: 'Between 5 and 20' },
    );
    const d = surveyDesign(out);
    expect(d.title.en).toBe('Land use survey');
    expect(d.pages[1].label.en).toBe('Dates');
    const list = d.lists.find((l) => l.name === 'demo_codelist')!;
    expect(list.label.en).toBe('Options');
    expect(list.items[1]).toMatchObject({ code: 'B', label: { fr: 'Option B' }, help: { en: 'The second one' } });
    const integer = d.pages[0].items.find((i) => i.name === 'integer_demo');
    expect(integer?.kind === 'question' && integer.rules[0].message.en).toBe('Between 5 and 20');
    // The page's label keeps its prefix (n0:label)
    expect(out.toString('latin1')).toContain('<n0:label xml:lang="en">Dates</n0:label>');
  });

  it('adds a language after the others, once', () => {
    const out = apply(basic, { op: 'addLanguage', language: 'sw' }, { op: 'addLanguage', language: 'sw' });
    expect(surveyDesign(out).languages).toEqual(['en', 'es', 'fr', 'pt', 'sw']);
    expect(changed(basic, out).added).toEqual(['  <language>sw</language>']);
    expect(() => apply(basic, { op: 'addLanguage', language: 'Swahili' })).toThrow(SurveyEditError);
  });

  it('refuses a text in a language the survey has not, a target it has not, a part it has not', () => {
    expect(() => apply(basic, { op: 'setText', target: { kind: 'title' }, part: 'label', language: 'sw', text: 'x' })).toThrow(/add it first/);
    expect(() => apply(basic, { op: 'setText', target: { kind: 'node', id: 999999 }, part: 'label', language: 'en', text: 'x' })).toThrow(SurveyEditError);
    expect(() => apply(basic, { op: 'setText', target: { kind: 'item', list: 'demo_codelist', code: 'Z' }, part: 'label', language: 'en', text: 'x' })).toThrow(SurveyEditError);
    expect(() => apply(basic, { op: 'setText', target: { kind: 'title' }, part: 'help', language: 'en', text: 'x' })).toThrow(SurveyEditError);
    expect(() => apply(basic, { op: 'setText', target: { kind: 'page', name: 'nope' }, part: 'label', language: 'en', text: 'x' })).toThrow(SurveyEditError);
  });

  it('changes nothing when the text is the one there', () => {
    const q = design.pages[0].items.find((i) => i.name === 'code_demo')!;
    const out = apply(basic, { op: 'setText', target: { kind: 'node', id: q.id }, part: 'label', language: 'en', text: q.label.en });
    expect(out.equals(basic)).toBe(true);
  });
});

describe('POST /v1/projects/:pid/survey/design and the versions', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  async function project(cep: Buffer) {
    const p = await createProject(ctx.app);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: cep });
    expect(up.statusCode, up.body).toBeLessThan(300);
    const get = async () => (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(p.adminToken) })).json() as SurveyDesignAnswer;
    const post = (body: unknown, token = p.adminToken) =>
      ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/design`, headers: bearer(token), payload: body as object });
    const versions = async () =>
      ((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/survey/versions`, headers: bearer(p.adminToken) })).json() as SurveyVersionsAnswer).versions;
    const restore = (vid: string, revision: string) =>
      ctx.app.inject({ method: 'POST', url: `/v1/projects/${p.projectId}/survey/versions/${vid}/restore`, headers: bearer(p.adminToken), payload: { revision } });
    const surveyIn = (cep: Buffer | null) => strFromU8(unzipSync(cep!)['placemark.idm.xml']);
    return { p, get, post, versions, restore, surveyIn };
  }

  it('saves a label into the served project file and the uploaded one, keeps the survey before, and brings it back', async () => {
    const { p, get, post, versions, restore, surveyIn } = await project(demoCep());
    const first = await get();
    expect(first.editable).toBe(true);
    expect(first.revision).toMatch(/^[0-9a-f]{24}$/);
    const question = first.design!.pages.flatMap((pg) => pg.items).find((i) => i.kind === 'question')!;
    const res = await post({ revision: first.revision, operations: [{ op: 'setText', target: { kind: 'node', id: question.id }, part: 'label', language: first.design!.languages[0], text: 'A new label' }] });
    expect(res.statusCode, res.body).toBe(200);
    const after = res.json() as SurveyDesignAnswer;
    expect(after.revision).not.toBe(first.revision);
    expect(after.design!.pages.flatMap((pg) => pg.items).find((i) => i.id === question.id)!.label[first.design!.languages[0]]).toBe('A new label');
    // Both files: the served one (with the server's round) and the upload
    const served = await ctx.store.getCep(p.projectId);
    const original = await ctx.store.getOriginalCep(p.projectId);
    expect(served!.equals(original!)).toBe(false);
    expect(surveyIn(served)).toContain('A new label');
    expect(surveyIn(original)).toContain('A new label');
    expect(surveyIn(served)).toContain('name="round"');

    const kept = await versions();
    expect(kept).toEqual([{ id: expect.any(String), createdAt: expect.any(Number), by: null, changes: 1, restore: false }]);
    const back = await restore(kept[0].id, after.revision!);
    expect(back.statusCode, back.body).toBe(200);
    expect((back.json() as SurveyDesignAnswer).revision).toBe(first.revision);
    expect(surveyIn(await ctx.store.getCep(p.projectId))).not.toContain('A new label');
    // The restore can be undone too
    const again = await versions();
    expect(again).toHaveLength(2);
    expect(again[0]).toMatchObject({ restore: true, changes: 0 });
  });

  it('refuses a change made on another revision, an operation it does not know, and to collectors', async () => {
    const { p, get, post } = await project(demoCep());
    const first = await get();
    const op = { op: 'addLanguage', language: 'fr' };
    expect((await post({ revision: 'old', operations: [op] })).json()).toMatchObject({ error: 'stale' } satisfies Partial<SurveyChangeRefusal>);
    expect((await post({ revision: first.revision, operations: [{ op: 'deleteEverything' }] })).statusCode).toBe(400);
    expect((await post({ revision: first.revision, operations: [] })).statusCode).toBe(400);
    expect((await post({ revision: first.revision, operations: [{ op: 'addLanguage', language: 'French' }] })).json()).toMatchObject({ error: 'bad_request' });
    expect((await post({ revision: first.revision, operations: [op] }, p.projectToken)).statusCode).toBe(403);
    // Nothing was written
    expect((await get()).revision).toBe(first.revision);
  });

  it('a new upload forgets the versions of the file before', async () => {
    const { p, get, post, versions } = await project(demoCep());
    const first = await get();
    expect((await post({ revision: first.revision, operations: [{ op: 'addLanguage', language: 'sw' }] })).statusCode).toBe(200);
    expect(await versions()).toHaveLength(1);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/cep`, headers: { ...bearer(p.adminToken), 'content-type': 'application/zip' }, payload: demoCep() });
    expect(up.statusCode).toBeLessThan(300);
    expect(await versions()).toEqual([]);
  });

  it('refuses to save a survey with a problem it did not have, and saves one that kept its old ones', async () => {
    // A survey uploaded with a broken condition: words can still be changed
    const files = unzipSync(demoCep());
    const broken = strFromU8(files['placemark.idm.xml']).replace(/(<(?:text|code|number|boolean)\b[^>]*?name="[a-z_]+")(?![^>]*relevant=)/, '$1 relevant="no_such = 1"');
    const cep = cepWith(Object.entries({ ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])), 'placemark.idm.xml': broken }));
    const { get, post } = await project(cep);
    const first = await get();
    expect(first.problems.length).toBe(1);
    const res = await post({ revision: first.revision, operations: [{ op: 'setText', target: { kind: 'title' }, part: 'label', language: first.design!.languages[0], text: 'Still broken' }] });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as SurveyDesignAnswer).problems).toHaveLength(1);
  });
});
