import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { LOCAL_OFF_ROUTES, LocalSignIn, SIGN_IN_TTL_MS, localUsername, startLocal, type LocalSetup } from '../src/local.js';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/store/memory.js';
import { idOnlyCep } from './fixtures/cep.js';
import { batchRequest, bearer, envelope } from './helpers.js';

const PROJECT_ID = '0b5d6c1e-8a7f-4e3d-9c2b-1a0f9e8d7c6b';
const LAND_USE = 'collect_code_land_use_category';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('LOCAL_MODE configuration', () => {
  const local = (env: NodeJS.ProcessEnv = {}): Config => loadConfig({ LOCAL_MODE: '1', ...env });

  it('listens on 127.0.0.1, on a free port unless told, with the memory store', () => {
    const config = local({ LOCAL_USER: 'Ana', LOCAL_PROJECT_ID: PROJECT_ID.toUpperCase() });
    expect(config).toMatchObject({ localMode: true, host: '127.0.0.1', port: 0, storeBackend: 'memory', localUser: 'Ana', localProjectId: PROJECT_ID });
    expect(local({ HOST: '127.0.0.1', PORT: '8123' })).toMatchObject({ host: '127.0.0.1', port: 8123 });
  });

  it('refuses any other HOST', () => {
    for (const host of ['0.0.0.0', '::', 'localhost', '192.168.1.10', '::1']) {
      expect(() => local({ HOST: host })).toThrow(/LOCAL_MODE=1 listens on 127\.0\.0\.1 only/);
    }
  });

  it('never reads the cloud settings, whatever the environment has', () => {
    const config = local({
      STORE_BACKEND: 'postgres',
      DATABASE_URL: 'postgres://u:p@db/x',
      MIGRATE_ON_BOOT: '1',
      SETUP_CODE: 'ABCD-EFGH-JK',
      ADMIN_API_KEY: 'key',
      SMTP_URL: 'not even a url',
      AI_VERTEX_API_KEY: 'k',
      AI_FAKE: '1',
      DIGEST_SECRET: 'short',
    });
    expect(config.storeBackend).toBe('memory');
    for (const key of ['databaseUrl', 'migrateOnBoot', 'setupCode', 'adminApiKey', 'smtpUrl', 'mailFrom', 'aiVertexApiKey', 'aiFake', 'digestSecret'] as const) {
      expect(config[key]).toBeUndefined();
    }
    expect(config.aiConfigured).toBe(false);
  });

  it('checks LOCAL_PROJECT_ID, PORT and LOCAL_MODE', () => {
    expect(() => local({ LOCAL_PROJECT_ID: 'not-a-uuid' })).toThrow(/LOCAL_PROJECT_ID/);
    expect(() => local({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ LOCAL_MODE: 'yes' })).toThrow(/LOCAL_MODE/);
    expect(loadConfig({ LOCAL_MODE: '0' }).localMode).toBeUndefined();
  });
});

describe('localUsername', () => {
  it('keeps a name the account rules accept, and makes one from any other', () => {
    expect(localUsername('maria')).toBe('maria');
    expect(localUsername('  ana.perez ')).toBe('ana.perez');
    expect(localUsername('José Pérez')).toBe('Jose.Perez');
    expect(localUsername('Ana  María  López')).toBe('Ana.Maria.Lopez');
    expect(localUsername("O'Brien, Seán")).toBe('OBrien.Sean');
    expect(localUsername('Li')).toBe('Li_');
    expect(localUsername('王伟')).toBe('you');
    expect(localUsername(undefined)).toBe('you');
    expect(localUsername('x'.repeat(100))).toBe('x'.repeat(64));
  });
});

describe('LocalSignIn', () => {
  it('a token works once, and not after SIGN_IN_TTL_MS', () => {
    let now = 1000;
    const signIn = new LocalSignIn(() => now);
    const a = signIn.issue();
    const b = signIn.issue();
    expect(signIn.consume(a)).toBe(true);
    expect(signIn.consume(a)).toBe(false);
    expect(signIn.consume('made-up')).toBe(false);
    now += SIGN_IN_TTL_MS;
    expect(signIn.consume(b)).toBe(false);
  });
});

describe('LOCAL_MODE server', () => {
  let store: InMemoryStore;
  let local: LocalSetup;
  let app: FastifyInstance;

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url: `/v1/projects/${PROJECT_ID}${path}`, headers: { ...bearer(local.apiToken), ...headers }, payload: payload as never });

  beforeEach(async () => {
    store = new InMemoryStore();
    const config: Config = {
      ...loadConfig({ LOCAL_MODE: '1', LOCAL_USER: 'Ana María', LOCAL_PROJECT_ID: PROJECT_ID }),
      rateLimitPerMinute: 0,
      qualityMinIntervalMs: 0,
      stateStaleMs: 0,
    };
    local = await startLocal(store, config);
    app = await buildServer({ store, config, local, webDir: null });
  });

  afterEach(async () => {
    await app.close();
  });

  it('makes one account, coordinator of the one project, with the stable id', async () => {
    expect(local.projectId).toBe(PROJECT_ID);
    expect(local.username).toBe('Ana.Maria');
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(local.apiToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ username: 'Ana.Maria', isPlatformAdmin: false, memberships: [{ projectId: PROJECT_ID, role: 'admin' }] });
    expect((await call('GET', '')).json()).toMatchObject({ projectId: PROJECT_ID, name: 'My project', role: 'admin' });
  });

  it('server-info says localMode and offers nothing about sign-up, setup or the AI', async () => {
    const info = (await app.inject({ method: 'GET', url: '/v1/server-info' })).json();
    expect(info).toMatchObject({ localMode: true, needsSetup: false, signupOpen: false, projectCreation: 'platform-admins', aiAvailable: false, termsUrl: null, selfServiceReset: false });
  });

  it('every route about other people or the server answers 404, with or without the session', async () => {
    expect(LOCAL_OFF_ROUTES.length).toBeGreaterThan(50);
    // "Forgot your password?" too: the one account has no address nor a password anyone knows.
    expect(LOCAL_OFF_ROUTES).toContain('POST /v1/auth/forgot');
    for (const route of LOCAL_OFF_ROUTES) {
      const [method, path] = route.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
      const url = path.replace('/:pid', `/${PROJECT_ID}`).replace(/\/:[A-Za-z]+/g, '/x');
      for (const headers of [bearer(local.apiToken), {}]) {
        const res = await app.inject({ method, url, headers, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
        expect(res.statusCode, `${route} ${JSON.stringify(headers)}`).toBe(404);
        expect(res.json()).toEqual({ error: 'not_found' });
      }
    }
  });

  it('no second account can be made, and the one account stays', async () => {
    const tries = [
      { url: '/v1/auth/signup', payload: { username: 'other', password: 'password12' } },
      { url: '/v1/auth/register', payload: { username: 'other', password: 'password12', inviteToken: 'x' } },
      { url: '/v1/setup', payload: { setupCode: 'x', username: 'other', password: 'password12' } },
    ];
    for (const t of tries) {
      expect((await app.inject({ method: 'POST', ...t })).statusCode).toBe(404);
    }
    expect(await store.getUserByUsername('other')).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(local.apiToken), payload: { name: 'Another' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(local.apiToken), payload: { password: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/projects', headers: bearer(local.apiToken) })).json().projects).toHaveLength(1);
  });

  it('the desktop feeds it with its token and the kept pages work for the one account', async () => {
    expect((await call('PUT', '/cep', idOnlyCep(), { 'content-type': 'application/zip' })).statusCode).toBe(200);
    const csv = await call('PUT', '/csv-files/plots.csv', 'id,lat,lon\n1,1,1\n2,1,2\n3,2,1\n4,2,2\n', { 'content-type': 'text/csv' });
    expect(csv.statusCode, csv.body).toBe(201);
    const fileId = csv.json().id as string;
    const day = (d: number) => Date.UTC(2026, 9, d, 12);
    // Collect Earth sends the operator's name: the records are the account's.
    const batch = await batchRequest(app, PROJECT_ID, local.apiToken, [
      envelope({ recordKey: '1', operator: 'Ana María', modifiedOn: day(1), summary: { [LAND_USE]: 'F' } }),
      envelope({ recordKey: '2', operator: 'Ana María', modifiedOn: day(2), summary: { [LAND_USE]: 'F' } }),
      envelope({ recordKey: '3', operator: 'Ana María', modifiedOn: day(3), summary: { [LAND_USE]: 'C' }, activelySaved: false }),
    ]);
    expect(batch.statusCode).toBe(200);
    expect(batch.json().results.map((r: { status: string }) => r.status)).toEqual(['stored', 'stored', 'stored']);
    expect((await store.listRecordSummaries(PROJECT_ID)).map((r) => r.operator)).toEqual(['Ana.Maria', 'Ana.Maria', 'Ana.Maria']);

    const progress = await call('GET', '/progress?tz=UTC');
    expect(progress.statusCode, progress.body).toBe(200);
    expect(progress.json().totals).toMatchObject({ plots: 4, submitted: 2, started: 1, notStarted: 1 });
    expect((await call('PUT', '/progress/settings', { deadline: '2099-01-31', targetPlots: 4, quietDays: 5 })).statusCode).toBe(200);
    expect((await call('GET', '/progress/settings')).json()).toEqual({ deadline: '2099-01-31', targetPlots: 4, quietDays: 5 });

    const answers = await call('GET', '/quality/answers');
    expect(answers.statusCode, answers.body).toBe(200);
    expect(answers.json()).toMatchObject({ plots: 2, people: [{ username: 'Ana.Maria', plots: 2 }] });
    expect((await call('GET', `/quality/answers/columns?file=${fileId}`)).statusCode).toBe(200);
    expect((await call('GET', '/quality/flags')).statusCode).toBe(200);
    expect((await call('GET', '/quality/survey-health')).statusCode).toBe(200);
    expect((await call('GET', '/quality')).statusCode).toBe(200);
    expect((await call('PUT', '/quality/settings', { fastSeconds: 20 })).statusCode).toBe(200);

    const ok = [
      '/overview',
      '/map/plots',
      '/activity',
      '/weekly',
      '/attention',
      '/plots/search?q=1',
      '/plots/1',
      '/my-work',
      '/members',
      '/round',
      '/csv-files',
      `/csv-files/${fileId}/content`,
      '/cep',
      '/export.csv',
      '/exports/people',
      '/exports/daily',
      '/exports/collect-backup/summary',
      '/exports/collect-backup?rounds=1',
    ];
    for (const path of ok) {
      const res = await call('GET', path);
      expect(res.statusCode, `${path}: ${res.body.slice(0, 200)}`).toBe(200);
    }
    const link = await call('POST', '/exports/collect-backup/link', { rounds: '1' });
    expect(link.statusCode, link.body).toBe(200);
    expect((await app.inject({ method: 'GET', url: link.json().url })).statusCode).toBe(200);
  });

  it('the sign-in link opens one dashboard session, once', async () => {
    const token = local.signIn.issue();
    const first = await app.inject({ method: 'GET', url: `/local-sign-in/${token}` });
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toMatch(/text\/html/);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['referrer-policy']).toBe('no-referrer');
    // The page keeps the session where the dashboard keeps it, then opens the Progress tab.
    const match = /localStorage\.setItem\("collectEarthCloud\.session","([A-Za-z0-9_-]+)"\)/.exec(first.body);
    expect(match).not.toBeNull();
    expect(first.body).toContain(`location.replace("/projects/${PROJECT_ID}")`);
    const session = match![1];
    expect(session).not.toBe(local.apiToken);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(session) })).json().username).toBe('Ana.Maria');
    expect((await app.inject({ method: 'GET', url: `/v1/projects/${PROJECT_ID}/progress`, headers: bearer(session) })).statusCode).toBe(200);

    const again = await app.inject({ method: 'GET', url: `/local-sign-in/${token}` });
    expect(again.statusCode).toBe(410);
    expect(again.body).not.toContain('setItem');
    expect((await app.inject({ method: 'GET', url: '/local-sign-in/made-up' })).statusCode).toBe(410);
  });

  it("a sign-in link opens a page of the list (Collect Earth's Analyse the data), never another address", async () => {
    const open = async (to: string) => (await app.inject({ method: 'GET', url: `/local-sign-in/${local.signIn.issue()}?to=${encodeURIComponent(to)}` })).body;
    expect(await open('analysis')).toContain(`location.replace("/projects/${PROJECT_ID}/analysis")`);
    expect(await open('data')).toContain(`location.replace("/projects/${PROJECT_ID}/data")`);
    for (const bad of ['https://evil.example', '../../x', 'people', '']) {
      expect(await open(bad), bad).toContain(`location.replace("/projects/${PROJECT_ID}")`);
    }
    // a used link: a browser already signed in goes to the page asked
    const token = local.signIn.issue();
    await app.inject({ method: 'GET', url: `/local-sign-in/${token}` });
    expect((await app.inject({ method: 'GET', url: `/local-sign-in/${token}?to=analysis` })).body).toContain(`location.replace("/projects/${PROJECT_ID}/analysis")`);
  });

  it('the desktop asks a new sign-in link with its token; no one else can', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/local/sign-in-links' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/v1/local/sign-in-links', headers: { ...bearer(local.apiToken), host: '127.0.0.1:4321' } });
    expect(res.statusCode).toBe(201);
    const { path, url } = res.json();
    expect(url).toBe(`http://127.0.0.1:4321${path}`);
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(410);
  });

  it('is built only with the memory store and the local setup', async () => {
    const config = loadConfig({ LOCAL_MODE: '1' });
    await expect(buildServer({ store, config, webDir: null })).rejects.toThrow(/startLocal/);
  });
});

describe('LOCAL_MODE process', () => {
  /** Starts src/index.ts (tsx) with the given environment; the first stdout line, or the exit. */
  function start(env: Record<string, string>): Promise<{ line: string | null; code: number | null; stderr: string; stop: () => Promise<void> }> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? '', LOCAL_MODE: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    const stop = async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise((r) => child.once('exit', r));
      }
    };
    return new Promise((resolve) => {
      createInterface({ input: child.stdout }).once('line', (line) => resolve({ line, code: null, stderr, stop }));
      child.once('close', (code) => resolve({ line: null, code, stderr, stop }));
    });
  }

  it('prints one ready line with the real port, and serves on 127.0.0.1', async () => {
    const run = await start({ PORT: '0', LOCAL_USER: 'Ana María', LOCAL_PROJECT_ID: PROJECT_ID });
    try {
      expect(run.line, run.stderr).not.toBeNull();
      const ready = JSON.parse(run.line!);
      expect(ready).toMatchObject({ ready: true, projectId: PROJECT_ID, username: 'Ana.Maria' });
      expect(ready.port).toBeGreaterThan(0);
      expect(ready.signInUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${ready.port}/local-sign-in/[A-Za-z0-9_-]+$`));
      const me = await fetch(`http://127.0.0.1:${ready.port}/v1/me`, { headers: bearer(ready.apiToken) });
      expect(((await me.json()) as { username: string }).username).toBe('Ana.Maria');
      const signIn = await fetch(ready.signInUrl);
      expect(signIn.status).toBe(200);
      expect((await fetch(ready.signInUrl)).status).toBe(410);
    } finally {
      await run.stop();
    }
  }, 30_000);

  it('refuses a HOST other than 127.0.0.1', async () => {
    const run = await start({ PORT: '0', HOST: '0.0.0.0' });
    await run.stop();
    expect(run.line).toBeNull();
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/LOCAL_MODE=1 listens on 127\.0\.0\.1 only/);
  }, 30_000);
});
