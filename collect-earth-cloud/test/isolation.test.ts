import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { batchRequest, createProject, makeContext, type TestContext } from './helpers.js';

/**
 * The §4b.8 tenancy gate: authenticated as an admin of project A, every
 * project-scoped endpoint aimed at project B must return 404 — a non-member must
 * not even be able to confirm that project B exists. New endpoints do not merge
 * without a case here.
 */
describe('cross-tenant isolation', () => {
  let ctx: TestContext;
  let a: Awaited<ReturnType<typeof createProject>>;
  let b: Awaited<ReturnType<typeof createProject>>;

  beforeEach(async () => {
    ctx = await makeContext();
    a = await createProject(ctx.app, 'Project A');
    b = await createProject(ctx.app, 'Project B');
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it("A's admin token can read A", async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${a.projectId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectId).toBe(a.projectId);
  });

  it("A's admin token gets 404 (not 403) when reading B", async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${b.projectId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("A's admin token gets 404 when uploading a survey to B", async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${b.projectId}/survey`,
      headers: { authorization: `Bearer ${a.adminToken}` },
      payload: { surveyUri: 'x', idmlBase64: 'eA==' },
    });
    expect(res.statusCode).toBe(404);
  });

  it("A's admin token gets 404 when posting records to B", async () => {
    const res = await batchRequest(ctx.app, b.projectId, a.adminToken, [{ recordKey: '1', surveyUri: 'x' }]);
    expect(res.statusCode).toBe(404);
    // and nothing was written into B
    expect(await ctx.store.listRecords(b.projectId)).toHaveLength(0);
  });

  // §4b.8 gate for the Phase-A project-scoped endpoints: A's admin must get 404
  // against B for every one of them.
  it("A's admin token gets 404 on every Phase-A endpoint aimed at B", async () => {
    const auth = { authorization: `Bearer ${a.adminToken}` };
    const cases = [
      { method: 'POST' as const, url: `/v1/projects/${b.projectId}/invites`, payload: { role: 'operator' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/cep` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/cep`, payload: Buffer.from('zip'),
        headers: { ...auth, 'content-type': 'application/zip' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/cep/original` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/round` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/round`, payload: { reassessmentCode: null } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/members` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/members/someone`, payload: { role: 'operator' } },
      { method: 'DELETE' as const, url: `/v1/projects/${b.projectId}/members/someone` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/csv-files` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/csv-files/x.csv`, payload: Buffer.from('id\n1\n'),
        headers: { ...auth, 'content-type': 'text/csv' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/csv-files/someid/content` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/assignments`, payload: { assignments: [] } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/assignments` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/my-assignment` },
    ];
    for (const c of cases) {
      const res = await ctx.app.inject({
        method: c.method,
        url: c.url,
        headers: c.headers ?? auth,
        payload: c.payload,
      });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
    }
  });

  // Same gate for the dashboard endpoints.
  it("A's admin token gets 404 on every dashboard endpoint aimed at B", async () => {
    const auth = { authorization: `Bearer ${a.adminToken}` };
    const cases = [
      { method: 'PATCH' as const, url: `/v1/projects/${b.projectId}`, payload: { name: 'hijacked' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/overview` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/invites` },
      { method: 'DELETE' as const, url: `/v1/projects/${b.projectId}/invites/00000000-0000-0000-0000-000000000000` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/export.csv` },
      { method: 'DELETE' as const, url: `/v1/projects/${b.projectId}`, payload: { confirmName: 'Project B' } },
    ];
    for (const c of cases) {
      const res = await ctx.app.inject({ method: c.method, url: c.url, headers: auth, payload: c.payload });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
    }
    expect((await ctx.store.getProject(b.projectId))?.name).toBe('Project B');
  });

  // Same gate for dividing plots: aimed at B, or at B's file through A's path.
  it("A's admin token gets 404 on every plot-division endpoint aimed at B or at B's file", async () => {
    const upload = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${b.projectId}/csv-files/plots.csv`,
      headers: { authorization: `Bearer ${b.adminToken}`, 'content-type': 'text/csv' },
      payload: 'id,lat,lon\n1,0,0\n2,1,1\n',
    });
    const fileB = upload.json().id as string;
    const auth = { authorization: `Bearer ${a.adminToken}` };
    const nobody = '00000000-0000-0000-0000-000000000000';
    const cases = [b.projectId, a.projectId].flatMap((pid) => [
      { method: 'GET' as const, url: `/v1/projects/${pid}/csv-files/${fileB}/columns` },
      { method: 'GET' as const, url: `/v1/projects/${pid}/csv-files/${fileB}/distribution` },
      { method: 'PUT' as const, url: `/v1/projects/${pid}/csv-files/${fileB}/distribution`, payload: { mode: 'whole' } },
      { method: 'POST' as const, url: `/v1/projects/${pid}/csv-files/${fileB}/move-unfinished`,
        payload: { fromUserId: nobody, toUserId: nobody } },
      { method: 'GET' as const, url: `/v1/projects/${pid}/csv-files/${fileB}/content` },
      { method: 'GET' as const, url: `/v1/projects/${pid}/csv-files/${fileB}/content?mine=1` },
    ]);
    for (const c of cases) {
      const res = await ctx.app.inject({ method: c.method, url: c.url, headers: auth, payload: c.payload });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
    }
  });

  // Same gate for the quality routes; and A's admin, on A's own path, cannot reach B's
  // decisions or notes, nor see them.
  it("A's admin token gets 404 on every quality route aimed at B, and sees none of B's rows", async () => {
    const authB = { authorization: `Bearer ${b.adminToken}` };
    const noteB = await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${b.projectId}/quality/notes`,
      headers: authB,
      payload: { questionKey: 'collect_code_land_use', text: 'B only' },
    });
    expect(noteB.statusCode).toBe(201);
    const idB = noteB.json().id as string;
    const decided = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${b.projectId}/quality/decisions/17`,
      headers: authB,
      payload: { decision: 'first' },
    });
    expect(decided.statusCode).toBe(200);

    const auth = { authorization: `Bearer ${a.adminToken}` };
    const note = { questionKey: 'collect_code_land_use', text: 'x' };
    const cases = [
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/quality` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/quality/settings`, payload: { margins: {} } },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/quality/settings`, payload: { fastSeconds: 30 } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/quality/flags` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/quality/survey-health` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/quality/decisions/17`, payload: { decision: 'check' } },
      { method: 'DELETE' as const, url: `/v1/projects/${b.projectId}/quality/decisions/17` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/quality/notes` },
      { method: 'POST' as const, url: `/v1/projects/${b.projectId}/quality/notes`, payload: note },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/quality/notes/${idB}`, payload: note },
      { method: 'DELETE' as const, url: `/v1/projects/${b.projectId}/quality/notes/${idB}` },
      // B's note and decision through A's own path.
      { method: 'PUT' as const, url: `/v1/projects/${a.projectId}/quality/notes/${idB}`, payload: note },
      { method: 'DELETE' as const, url: `/v1/projects/${a.projectId}/quality/notes/${idB}` },
      { method: 'DELETE' as const, url: `/v1/projects/${a.projectId}/quality/decisions/17` },
    ];
    for (const c of cases) {
      const res = await ctx.app.inject({ method: c.method, url: c.url, headers: auth, payload: c.payload });
      expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
    }
    const own = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${a.projectId}/quality`, headers: auth });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({ decisions: [], notes: [] });
    // B's rows are untouched.
    expect((await ctx.store.listGuidanceNotes(b.projectId)).map((n) => n.text)).toEqual(['B only']);
    expect((await ctx.store.listQualityDecisions(b.projectId)).map((d) => [d.plot, d.decision])).toEqual([['17', 'first']]);
  });

  // The reports, the places of differing plots and the AI assistant: aimed at B with A's
  // project token or A's signed-in coordinator, and B's AI run through A's own path.
  it("A's admin gets 404 on every report, place and AI route aimed at B, and on B's run through A's path", async () => {
    const user = await ctx.store.createUser({ username: 'coord_a', passwordHash: 'x', email: null });
    await ctx.store.addMembership(a.projectId, user.id, 'admin');
    const session = await ctx.store.createSession(user.id);
    const other = await ctx.store.createUser({ username: 'coord_b', passwordHash: 'x', email: null });
    await ctx.store.addMembership(b.projectId, other.id, 'admin');
    const started = await ctx.store.startAiRun(
      b.projectId,
      { kind: 'report', startedBy: other.id, model: 'm' },
      { now: Date.now(), staleBefore: 0, dayStart: 0, monthStart: 0, reportsPerDay: 10, followUpsPerDay: 10, monthlyTokens: 1_000_000 },
    );
    if (!started.ok) throw new Error(`no run: ${started.limit}`);
    const runB = started.run.id;
    const unknown = '00000000-0000-0000-0000-000000000000';
    const cases = [
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/my-quality` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/quality/team-report` },
      { method: 'POST' as const, url: `/v1/projects/${b.projectId}/quality/places`, payload: { plots: ['17'] } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/ai` },
      { method: 'PUT' as const, url: `/v1/projects/${b.projectId}/ai`, payload: { enabled: true } },
      { method: 'POST' as const, url: `/v1/projects/${b.projectId}/ai/runs`, payload: { kind: 'report' } },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/ai/runs` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/ai/runs/${runB}` },
      { method: 'GET' as const, url: `/v1/projects/${b.projectId}/ai/runs/${unknown}` },
    ];
    for (const auth of [{ authorization: `Bearer ${a.adminToken}` }, { authorization: `Bearer ${session}` }]) {
      for (const c of cases) {
        const res = await ctx.app.inject({ method: c.method, url: c.url, headers: auth, payload: c.payload });
        expect(res.statusCode, `${c.method} ${c.url}`).toBe(404);
      }
    }
    // B's run through A's path, as A's coordinator (a person: runs need one).
    const through = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${a.projectId}/ai/runs/${runB}`,
      headers: { authorization: `Bearer ${session}` },
    });
    expect(through.statusCode).toBe(404);
    const listA = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${a.projectId}/ai/runs`, headers: { authorization: `Bearer ${session}` } });
    expect(listA.statusCode).toBe(200);
    expect(JSON.stringify(listA.json())).not.toContain(runB);
    expect(await ctx.store.isAiEnabled(b.projectId)).toBe(false);
  });

  it("deleting A leaves B whole, and A's admin cannot delete B even with B's name", async () => {
    await batchRequest(ctx.app, b.projectId, b.projectToken, [{ recordKey: '1', surveyUri: 'x', operator: 'o' }]);
    const cross = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${b.projectId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
      payload: { confirmName: 'Project B' },
    });
    expect(cross.statusCode).toBe(404);
    const own = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${a.projectId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
      payload: { confirmName: 'Project A' },
    });
    expect(own.statusCode).toBe(204);
    expect(await ctx.store.getProject(b.projectId)).not.toBeNull();
    expect(await ctx.store.listRecords(b.projectId)).toHaveLength(1);
    const ping = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${b.projectId}`,
      headers: { authorization: `Bearer ${b.adminToken}` },
    });
    expect(ping.statusCode).toBe(200);
  });

  it("A's admin cannot revoke B's invite through A's path", async () => {
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/projects/${b.projectId}/invites`,
      headers: { authorization: `Bearer ${b.adminToken}` },
      payload: { role: 'operator' },
    });
    const listB = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${b.projectId}/invites`,
      headers: { authorization: `Bearer ${b.adminToken}` },
    });
    const inviteId = listB.json().invites[0].id as string;

    // A's admin, on A's own path, naming B's invite id: not found, and nothing revoked.
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/projects/${a.projectId}/invites/${inviteId}`,
      headers: { authorization: `Bearer ${a.adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    const after = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${b.projectId}/invites`,
      headers: { authorization: `Bearer ${b.adminToken}` },
    });
    expect(after.json().invites).toHaveLength(1);
  });

  it('an unknown token is 401, an absent token is 401', async () => {
    const bad = await ctx.app.inject({
      method: 'GET',
      url: `/v1/projects/${a.projectId}`,
      headers: { authorization: 'Bearer nonsense' },
    });
    expect(bad.statusCode).toBe(401);

    const none = await ctx.app.inject({ method: 'GET', url: `/v1/projects/${a.projectId}` });
    expect(none.statusCode).toBe(401);
  });

  it('an operator token cannot upload a survey (403 within its own project)', async () => {
    const res = await ctx.app.inject({
      method: 'PUT',
      url: `/v1/projects/${a.projectId}/survey`,
      headers: { authorization: `Bearer ${a.projectToken}` },
      payload: { surveyUri: 'x', idmlBase64: 'eA==' },
    });
    expect(res.statusCode).toBe(403);
  });
});
