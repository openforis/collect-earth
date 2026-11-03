import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const LAND_USE = 'collect_code_land_use_category';

describe('GET /quality/survey-health', () => {
  let ctx: TestContext;
  let pid: string;
  let owner: { token: string; userId: string };
  let rita: { token: string };
  let maria: { token: string };

  const call = (method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: { ...bearer(token), ...headers }, payload: payload as never });
  const join = async (username: string, role: 'operator' | 'reviewer') => {
    const invite = await call('POST', '/invites', owner.token, { role, maxUses: 1 });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password: 'password12', inviteToken: invite.json().inviteToken } });
    return { token: res.json().token as string };
  };

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(owner.token), payload: { name: 'Health' } })).json().projectId;
    rita = await join('rita', 'reviewer');
    maria = await join('maria', 'operator');
    await call('PUT', '/cep', owner.token, idOnlyCep(), { 'content-type': 'application/zip' });
    await call('PUT', '/csv-files/plots.csv', owner.token, ['id,lat,lon', ...Array.from({ length: 30 }, (_, i) => `${i + 1},0,0`)].join('\n'), { 'content-type': 'text/csv' });
    const ana = await join('ana', 'operator');
    const ben = await join('ben', 'operator');
    const day = Date.UTC(2026, 9, 1, 12);
    // ana: plots 1-30, forest, land use left empty (null, as Collect Earth sends it) on 1-8;
    // ben checks 1-25: cropland on 1-12, forest on the others.
    const first = Array.from({ length: 30 }, (_, i) =>
      envelope({ recordKey: `${i + 1},1`, operator: 'ana', modifiedOn: day, summary: { [LAND_USE]: i < 8 ? null : 'F', collect_code_round: '1' } as never }),
    );
    const checks = Array.from({ length: 25 }, (_, i) =>
      envelope({ recordKey: `${i + 1},2`, operator: 'ben', modifiedOn: day + 1000, summary: { [LAND_USE]: i < 12 ? 'C' : 'F', collect_code_round: '2' } }),
    );
    expect((await batchRequest(ctx.app, pid, ana.token, first)).statusCode).toBe(200);
    expect((await batchRequest(ctx.app, pid, ben.token, checks)).statusCode).toBe(200);
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('per question: empty, agreement and changes by decisions for the check, worth rewording first', async () => {
    for (const plot of ['9', '10', '11']) {
      expect((await call('PUT', `/quality/decisions/${plot}`, owner.token, { decision: 'check' })).statusCode).toBe(200);
    }
    await call('PUT', '/quality/decisions/12', owner.token, { decision: 'first' });
    await call('PUT', '/quality/decisions/20', owner.token, { decision: 'check' });
    const res = await call('GET', '/quality/survey-health', owner.token);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ plots: 30, plotsChecked: 25, decidedForCheck: 4, stale: false });
    expect(typeof body.computedAt).toBe('number');
    expect(body.thresholds).toMatchObject({ minPlots: 20, lowAgreement: 0.8 });
    const land = body.questions[0];
    expect(land.key).toBe(LAND_USE);
    expect(land).toMatchObject({ answered: 22, blank: 8, notKnown: 0, emptyShare: 8 / 30 });
    expect(land.agreement).toEqual({ compared: 25, agreeing: 13, rate: 13 / 25 });
    // Plots 9-11 changed (forest to cropland); plot 20 was decided for the check but agreed.
    expect(land.decisions).toEqual({ changed: 3, share: 3 / 4 });
    expect(land.reasons).toEqual(['low_agreement', 'often_empty']);
    // No names, no plots.
    expect(JSON.stringify(body)).not.toMatch(/ana|ben|"plot"/);
  });

  it('coordinators and reviewers; collectors 403, and nothing of it in My work', async () => {
    expect((await call('GET', '/quality/survey-health', rita.token)).statusCode).toBe(200);
    expect((await call('GET', '/quality/survey-health', maria.token)).statusCode).toBe(403);
    const mine = await call('GET', '/my-quality', maria.token);
    expect(JSON.stringify(mine.json())).not.toContain('decidedForCheck');
  });
});
