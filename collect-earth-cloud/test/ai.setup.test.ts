import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_AI_MODEL, loadConfig, type Config } from '../src/config.js';
import { DEFAULT_SETTINGS } from '../src/types.js';
import { bearer, createProject, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

const SECRET = 'AIzaSy-very-secret-vertex-key-0123456789';

/** The AI part of a config as loadConfig makes it. */
function aiConfig(env: Record<string, string>): Partial<Config> {
  const c = loadConfig(env);
  return { aiVertexApiKey: c.aiVertexApiKey, aiVertexProject: c.aiVertexProject, aiVertexRegion: c.aiVertexRegion, aiModel: c.aiModel, aiConfigured: c.aiConfigured };
}

describe('AI configuration', () => {
  it('is not configured by default, with the global region and Gemini 3.8 Flash', () => {
    expect(DEFAULT_AI_MODEL).toBe('gemini-3.8-flash');
    expect(aiConfig({})).toEqual({
      aiVertexApiKey: undefined,
      aiVertexProject: undefined,
      aiVertexRegion: 'global',
      aiModel: 'gemini-3.8-flash',
      aiConfigured: false,
    });
  });

  it('is configured by an API key, or by a project (and region)', () => {
    expect(aiConfig({ AI_VERTEX_API_KEY: SECRET })).toMatchObject({ aiVertexApiKey: SECRET, aiConfigured: true });
    expect(aiConfig({ AI_VERTEX_PROJECT: 'my-gcp-project' })).toMatchObject({
      aiVertexProject: 'my-gcp-project',
      aiVertexRegion: 'global',
      aiConfigured: true,
    });
    expect(aiConfig({ AI_VERTEX_PROJECT: 'p', AI_VERTEX_REGION: ' europe-west4 ' })).toMatchObject({ aiVertexRegion: 'europe-west4', aiConfigured: true });
    expect(aiConfig({ AI_VERTEX_REGION: 'us-central1' })).toMatchObject({ aiConfigured: false });
  });

  it('takes the model from AI_MODEL, and ignores blank values', () => {
    expect(aiConfig({ AI_MODEL: ' gemini-3.7-flash ' }).aiModel).toBe('gemini-3.7-flash');
    expect(aiConfig({ AI_MODEL: '  ', AI_VERTEX_API_KEY: ' ', AI_VERTEX_PROJECT: '', AI_VERTEX_REGION: '' })).toEqual({
      aiVertexApiKey: undefined,
      aiVertexProject: undefined,
      aiVertexRegion: 'global',
      aiModel: 'gemini-3.8-flash',
      aiConfigured: false,
    });
  });
});

function putSettings(app: FastifyInstance, token: string, settings: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(token), payload: settings });
}

describe('AI server settings', () => {
  let ctx: TestContext;
  let owner: { token: string };
  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it('defaults to off, 5 reports and 30 follow-ups a day, 2,000,000 tokens a month', async () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ aiEnabled: false, aiReportsPerDay: 5, aiFollowUpsPerDay: 30, aiMonthlyTokens: 2_000_000 });
    const read = await ctx.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: bearer(owner.token) });
    expect(read.json()).toMatchObject({ aiEnabled: false, aiReportsPerDay: 5, aiFollowUpsPerDay: 30, aiMonthlyTokens: 2_000_000 });
  });

  it('validates the AI settings', async () => {
    const bad: Record<string, unknown>[] = [
      { aiEnabled: 'true' },
      { aiEnabled: 1 },
      { aiEnabled: null },
      { aiReportsPerDay: -1 },
      { aiReportsPerDay: 2.5 },
      { aiReportsPerDay: '5' },
      { aiReportsPerDay: 1001 },
      { aiFollowUpsPerDay: -3 },
      { aiFollowUpsPerDay: 10_001 },
      { aiMonthlyTokens: -1 },
      { aiMonthlyTokens: 1e12 },
      { aiMonthlyTokens: null },
    ];
    for (const payload of bad) {
      const res = await putSettings(ctx.app, owner.token, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error).toBe('bad_request');
    }
    const read = await ctx.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: bearer(owner.token) });
    expect(read.json()).toMatchObject({ aiEnabled: false, aiReportsPerDay: 5, aiFollowUpsPerDay: 30, aiMonthlyTokens: 2_000_000 });
  });

  it('stores good values; 0 allows none', async () => {
    const res = await putSettings(ctx.app, owner.token, { aiEnabled: true, aiReportsPerDay: 0, aiFollowUpsPerDay: 100, aiMonthlyTokens: 0 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ aiEnabled: true, aiReportsPerDay: 0, aiFollowUpsPerDay: 100, aiMonthlyTokens: 0 });
  });
});

describe('aiAvailable in server-info', () => {
  const contexts: TestContext[] = [];
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((c) => c.app.close()));
  });
  async function available(config: Partial<Config>, enable: boolean): Promise<boolean> {
    const ctx = await makeContext(config);
    contexts.push(ctx);
    const owner = await setupPlatformAdmin(ctx.app);
    if (enable) {
      expect((await putSettings(ctx.app, owner.token, { aiEnabled: true })).statusCode).toBe(200);
    }
    const info = await ctx.app.inject({ method: 'GET', url: '/v1/server-info' });
    return info.json().aiAvailable;
  }

  it('is true only when the server is configured and the owner switched it on', async () => {
    expect(await available({}, false)).toBe(false);
    expect(await available({}, true)).toBe(false);
    expect(await available(aiConfig({ AI_VERTEX_API_KEY: SECRET }), false)).toBe(false);
    expect(await available(aiConfig({ AI_VERTEX_API_KEY: SECRET }), true)).toBe(true);
    expect(await available(aiConfig({ AI_VERTEX_PROJECT: 'p' }), true)).toBe(true);
  });
});

describe('the AI switch of a project', () => {
  let ctx: TestContext;
  let owner: { token: string };
  let pid: string;
  let adminToken: string;
  let operatorToken: string;
  const project = (method: 'GET' | 'PUT', payload?: unknown, token = adminToken, id = pid) =>
    ctx.app.inject({ method, url: `/v1/projects/${id}/ai`, headers: bearer(token), payload: payload as object });

  async function setUp(config: Partial<Config>) {
    ctx = await makeContext(config);
    owner = await setupPlatformAdmin(ctx.app);
    const p = await createProject(ctx.app);
    pid = p.projectId;
    adminToken = p.adminToken;
    operatorToken = p.projectToken;
  }
  afterEach(async () => {
    await ctx.app.close();
  });

  it('is off, and cannot be switched on while the assistant is not available', async () => {
    await setUp(aiConfig({ AI_VERTEX_API_KEY: SECRET }));
    expect((await project('GET')).json()).toEqual({ enabled: false, available: false });
    const refused = await project('PUT', { enabled: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('ai_unavailable');
    // Switching it off is always allowed.
    expect((await project('PUT', { enabled: false })).statusCode).toBe(200);
  });

  it('is switched on and off by the coordinator once the server owner allows it', async () => {
    await setUp(aiConfig({ AI_VERTEX_API_KEY: SECRET }));
    await putSettings(ctx.app, owner.token, { aiEnabled: true });
    const on = await project('PUT', { enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toEqual({ enabled: true, available: true });
    expect((await project('GET')).json()).toEqual({ enabled: true, available: true });
    expect(await ctx.store.isAiEnabled(pid)).toBe(true);

    // The owner switching it off for the server leaves the project's choice but makes it unavailable.
    await putSettings(ctx.app, owner.token, { aiEnabled: false });
    expect((await project('GET')).json()).toEqual({ enabled: true, available: false });

    expect((await project('PUT', { enabled: false })).json()).toEqual({ enabled: false, available: false });
    expect(await ctx.store.isAiEnabled(pid)).toBe(false);
  });

  it('validates the body, is for coordinators only, and only for their project', async () => {
    await setUp(aiConfig({ AI_VERTEX_API_KEY: SECRET }));
    await putSettings(ctx.app, owner.token, { aiEnabled: true });
    for (const payload of [{}, { enabled: 'yes' }, { enabled: 1 }, { enabled: null }]) {
      const res = await project('PUT', payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await project('PUT', { enabled: true }, operatorToken)).statusCode).toBe(403);
    expect((await project('GET', undefined, operatorToken)).statusCode).toBe(403);
    const other = await createProject(ctx.app, 'Other');
    expect((await project('PUT', { enabled: true }, adminToken, other.projectId)).statusCode).toBe(404);
    expect(await ctx.store.isAiEnabled(other.projectId)).toBe(false);
  });
});

describe('the Vertex API key is never shown', () => {
  it('appears in no response of server-info, the settings or the project switch', async () => {
    const ctx = await makeContext(aiConfig({ AI_VERTEX_API_KEY: SECRET, AI_VERTEX_PROJECT: 'my-gcp-project' }));
    try {
      const owner = await setupPlatformAdmin(ctx.app);
      const p = await createProject(ctx.app);
      const responses = [
        await ctx.app.inject({ method: 'GET', url: '/v1/server-info' }),
        await ctx.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: bearer(owner.token) }),
        await putSettings(ctx.app, owner.token, { aiEnabled: true }),
        await putSettings(ctx.app, owner.token, { aiEnabled: 'bad' }),
        await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/ai`, headers: bearer(p.adminToken) }),
        await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/ai`, headers: bearer(p.adminToken), payload: { enabled: true } }),
        await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${p.projectId}/ai`, headers: bearer(p.adminToken), payload: { enabled: 'x' } }),
        await ctx.app.inject({ method: 'GET', url: '/v1/server-info' }),
      ];
      for (const res of responses) {
        expect(res.statusCode).toBeLessThan(500);
        expect(res.body).not.toContain(SECRET);
        expect(JSON.stringify(res.headers)).not.toContain(SECRET);
      }
      expect(responses[responses.length - 1].json().aiAvailable).toBe(true);
    } finally {
      await ctx.app.close();
    }
  });
});
