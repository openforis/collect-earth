import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cepProperties, readCep } from '../src/cep.js';
import { MAX_GUIDE_BYTES } from '../src/surveyGuide.js';
import { cepWith, idOnlyCep } from './fixtures/cep.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 0x20), Buffer.from('\n%%EOF\n')]);

describe("a project's survey guide: kept apart from the project file, which carries its address", () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let collector: string;

  beforeEach(async () => {
    ctx = await makeContext({ publicBaseUrl: 'https://cloud.example.org' });
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Guided' } })).json().projectId;
    const invite = (await ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/invites`, headers: bearer(owner.token), payload: { role: 'operator' } })).json().inviteToken;
    collector = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: 'cora', password: 'password12', inviteToken: invite } })).json().token;
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  const call = (method: 'GET' | 'PUT' | 'DELETE', token = owner.token, payload?: unknown, headers: Record<string, string> = {}, query = '') =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}/survey-guide${query}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const putCep = (cep: Buffer) => ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(owner.token), 'content-type': 'application/zip' }, payload: cep });
  const servedProperties = async () => cepProperties(readCep((await ctx.store.getCep(pid))!));
  const pathOf = (url: string) => url.replace('https://cloud.example.org', '');

  it('a PDF is kept on the server and served from an address with no login; the project file carries that address', async () => {
    expect((await putCep(idOnlyCep())).statusCode).toBe(200);
    expect((await call('GET')).json()).toEqual({ guide: null, properties: { survey_guide_url: '' } });
    const put = await call('PUT', owner.token, PDF, { 'content-type': 'application/pdf' }, '?filename=How%20to%20interpret.pdf');
    expect(put.statusCode, put.body).toBe(200);
    const { guide, properties } = put.json();
    expect(guide).toMatchObject({ kind: 'file', filename: 'How to interpret.pdf', bytes: PDF.length });
    expect(guide.url).toMatch(new RegExp(`^https://cloud\\.example\\.org/guide/${pid}/[A-Za-z0-9_-]{20,}$`));
    expect(properties).toEqual({ survey_guide_url: guide.url });
    expect((await servedProperties()).get('survey_guide_url')).toBe(guide.url);
    // any member reads it (Collect Earth, during its sync); the PDF opens without a login, by its address only
    expect((await call('GET', collector)).json().guide.url).toBe(guide.url);
    const pdf = await ctx.app.inject({ method: 'GET', url: pathOf(guide.url) });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('inline');
    expect(pdf.rawPayload.equals(PDF)).toBe(true);
    for (const wrong of [`/guide/${pid}/${'x'.repeat(43)}`, `/guide/00000000-0000-4000-8000-000000000000/${guide.url.split('/').pop()}`, `/guide/${pid}/short`]) {
      expect((await ctx.app.inject({ method: 'GET', url: wrong })).statusCode, wrong).toBe(404);
    }
    // replaced by another PDF, the address stays (the project files people hold keep working)
    const again = await call('PUT', owner.token, Buffer.concat([PDF, Buffer.from('more')]), { 'content-type': 'application/pdf' });
    expect(again.json().guide.url).toBe(guide.url);
    expect(again.json().guide.filename).toBe('survey_guide.pdf');
    // it counts towards the project's space
    expect((await ctx.store.getProjectStorage(pid)).guideBytes).toBe(PDF.length + 4);
  });

  it('a link to a guide kept elsewhere; removed, the project file says so', async () => {
    expect((await putCep(idOnlyCep())).statusCode).toBe(200);
    const put = await call('PUT', owner.token, { url: ' https://example.org/guides/land-use.pdf ' });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().guide).toMatchObject({ kind: 'link', url: 'https://example.org/guides/land-use.pdf', bytes: 0 });
    expect((await servedProperties()).get('survey_guide_url')).toBe('https://example.org/guides/land-use.pdf');
    for (const bad of [{ url: 'ftp://example.org/x.pdf' }, { url: 'javascript:alert(1)' }, { url: 'not an address' }, { url: '' }, {}]) {
      expect((await call('PUT', owner.token, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call('DELETE')).statusCode).toBe(204);
    expect((await call('GET')).json().guide).toBeNull();
    expect((await servedProperties()).get('survey_guide_url') ?? '').toBe('');
  });

  it('refuses what is no PDF and one too large; coordinators only change it; another project sees nothing of it', async () => {
    expect((await call('PUT', owner.token, Buffer.from('PK\u0003\u0004 not a pdf'), { 'content-type': 'application/pdf' })).statusCode).toBe(400);
    expect(MAX_GUIDE_BYTES).toBe(25 * 1024 * 1024);
    expect((await call('PUT', collector, PDF, { 'content-type': 'application/pdf' })).statusCode).toBe(403);
    expect((await call('PUT', collector, { url: 'https://example.org/x.pdf' })).statusCode).toBe(403);
    expect((await call('DELETE', collector)).statusCode).toBe(403);
    const other = await createProject(ctx.app);
    expect((await call('GET', other.adminToken)).statusCode).toBe(404);
    expect((await call('PUT', other.adminToken, { url: 'https://example.org/x.pdf' })).statusCode).toBe(404);
  });

  it('a project file uploaded with its guide inside is kept without it: the guide is served from an address the file carries', async () => {
    const withGuide = cepWith([...Object.entries(unzipSync(idOnlyCep())).map(([name, data]) => [name, Buffer.from(data)] as [string, Buffer]), ['survey_guide.pdf', PDF]]);
    const res = await putCep(withGuide);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().guideMoved).toMatchObject({ bytes: PDF.length });
    const kept = unzipSync((await ctx.store.getCep(pid))!);
    expect(Object.keys(kept)).not.toContain('survey_guide.pdf');
    const guide = (await call('GET')).json().guide;
    expect(guide).toMatchObject({ kind: 'file', filename: 'survey_guide.pdf', bytes: PDF.length });
    expect(strFromU8(kept['project_definition.properties'])).toContain('survey_guide_url=');
    expect((await servedProperties()).get('survey_guide_url')).toBe(guide.url);
    expect((await ctx.app.inject({ method: 'GET', url: pathOf(guide.url) })).rawPayload.equals(PDF)).toBe(true);
    // the project file uploaded again without a guide inside: the project's guide stays, and its address is written again
    expect((await putCep(idOnlyCep())).json().guideMoved).toBeUndefined();
    expect((await servedProperties()).get('survey_guide_url')).toBe(guide.url);
  });

  it('a guide set before any project file is written into the one uploaded later', async () => {
    const put = await call('PUT', owner.token, { url: 'https://example.org/guide.pdf' });
    expect(put.statusCode, put.body).toBe(200);
    expect((await putCep(idOnlyCep())).statusCode).toBe(200);
    expect((await servedProperties()).get('survey_guide_url')).toBe('https://example.org/guide.pdf');
  });
});
