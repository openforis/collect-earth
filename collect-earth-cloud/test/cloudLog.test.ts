import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logFormatters, MAX_CLIENT, MESSAGE_KEY, severityOf, traceFields, whoOf } from '../src/cloudLog.js';
import { bearer, createProject, makeContext, type TestContext } from './helpers.js';

const TRACE = '105445aa7843bc8bf206b12000100000';

describe('the log as Google Cloud Logging reads it', () => {
  it("names each pino level as Cloud Logging's severity", () => {
    expect(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'other'].map(severityOf)).toEqual(['DEBUG', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'DEFAULT']);
  });

  it('writes the severity beside the level number, the text as message, and the stack of an error', () => {
    const lines: Record<string, unknown>[] = [];
    const log = pino({ messageKey: MESSAGE_KEY, formatters: logFormatters }, { write: (s: string) => void lines.push(JSON.parse(s)) });
    log.warn('a warning');
    log.error({ err: new Error('failed at https://x.org/a?token=s3cret') }, 'background work failed');
    expect(lines[0]).toMatchObject({ level: 40, severity: 'WARNING', message: 'a warning' });
    expect(lines[0]).not.toHaveProperty('msg');
    expect(lines[0]).not.toHaveProperty('stack_trace');
    expect(lines[1]).toMatchObject({ level: 50, severity: 'ERROR', message: 'background work failed' });
    expect(lines[1].stack_trace).toContain('failed at');
    // redacted as a failed request's stack is
    expect(lines[1].stack_trace).not.toContain('s3cret');
  });

  it("takes the trace of Cloud Run's header, named in the project when it is known", () => {
    expect(traceFields(`${TRACE}/1;o=1`, 'collectearth')).toEqual({ 'logging.googleapis.com/trace': `projects/collectearth/traces/${TRACE}`, trace: TRACE });
    expect(traceFields(TRACE.toUpperCase(), undefined)).toEqual({ trace: TRACE });
    for (const bad of [undefined, '', 'not-a-trace/1', 'abc', ['zz']]) expect(traceFields(bad, 'collectearth')).toEqual({});
  });

  it('says who a request was for by ids, and the client cut short', () => {
    expect(whoOf({ membership: { projectId: 'p1', userId: 'u1' }, headers: { 'user-agent': 'CollectEarth/2.0.0 cloud-sync' } })).toEqual({ projectId: 'p1', userId: 'u1', client: 'CollectEarth/2.0.0 cloud-sync' });
    expect(whoOf({ userId: 'u2', headers: {} })).toEqual({ userId: 'u2' });
    expect(whoOf({ headers: { 'user-agent': 'x'.repeat(500) } }).client).toHaveLength(MAX_CLIENT);
  });
});

describe("the server's lines", () => {
  let ctx: TestContext | null = null;
  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx?.app.close();
    ctx = null;
  });

  it('a failed request: its severity, trace, address without secrets, who, the client and the stack', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({ write: (chunk, _e, cb) => { for (const l of String(chunk).split('\n')) if (l) lines.push(JSON.parse(l)); cb(); } });
    ctx = await makeContext({ googleCloudProject: 'collectearth' }, { logger: { stream, level: 'info' } });
    const p = await createProject(ctx.app, 'Log');
    vi.spyOn(ctx.store, 'getProject').mockRejectedValue(new Error('the disk is on fire'));
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${p.projectId}?token=secret-in-the-address`,
      headers: { ...bearer(p.adminToken), 'x-cloud-trace-context': `${TRACE}/7;o=1`, 'user-agent': 'CollectEarth/2.0.0 cloud-sync' },
    });
    expect(res.statusCode).toBe(500);
    const failed = lines.find((l) => l.message === 'request failed')!;
    const completed = lines.filter((l) => l.message === 'request completed').at(-1)!;
    for (const line of [failed, completed]) {
      expect(line).toMatchObject({ level: 50, severity: 'ERROR', trace: TRACE, 'logging.googleapis.com/trace': `projects/collectearth/traces/${TRACE}`, client: 'CollectEarth/2.0.0 cloud-sync' });
    }
    expect(failed).toMatchObject({ method: 'GET', route: '/v1/projects/:pid', failure: { type: 'Error', message: 'the disk is on fire' } });
    expect(String(failed.stack_trace)).toContain('the disk is on fire');
    expect(String(failed.url)).toContain(p.projectId);
    expect(JSON.stringify(lines)).not.toContain('secret-in-the-address');
  });

  it('a request without a trace, on a server that does not know its project, still writes the rest', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({ write: (chunk, _e, cb) => { for (const l of String(chunk).split('\n')) if (l) lines.push(JSON.parse(l)); cb(); } });
    ctx = await makeContext({}, { logger: { stream, level: 'info' } });
    const p = await createProject(ctx.app, 'Log');
    await ctx.app.inject({ method: 'GET', url: `/v1/projects/${p.projectId}/progress`, headers: { ...bearer(p.adminToken), 'x-cloud-trace-context': `${TRACE}/7` } });
    const completed = lines.filter((l) => l.message === 'request completed').at(-1)!;
    expect(completed).toMatchObject({ level: 30, severity: 'INFO', trace: TRACE, projectId: p.projectId });
    expect(completed).not.toHaveProperty('logging.googleapis.com/trace');
  });
});
