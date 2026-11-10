import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextPseudonym, renameOperatorInSummary, renameOperatorInXml } from '../src/anonymize.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

describe('renaming an operator', () => {
  it("renames the XML's operator value only, not an answer that equals the name", () => {
    const xml = '<plot><operator>\n    <value>ana.m</value>\n  </operator><comment><value>ana.m</value></comment></plot>';
    expect(renameOperatorInXml(xml, 'ana.m', 'former-member-1')).toBe('<plot><operator>\n    <value>former-member-1</value>\n  </operator><comment><value>ana.m</value></comment></plot>');
    // a dot in the name is a dot, not "any character"
    expect(renameOperatorInXml('<operator><value>anaxm</value></operator>', 'ana.m', 'x')).toBe('<operator><value>anaxm</value></operator>');
    expect(renameOperatorInXml(null, 'a', 'b')).toBeNull();
  });

  it("renames the summary's operator, and numbers the pseudonyms per project", () => {
    expect(renameOperatorInSummary({ collect_text_operator: 'ana', x: 'ana' }, 'ana', 'former-member-2')).toEqual({ collect_text_operator: 'former-member-2', x: 'ana' });
    expect(renameOperatorInSummary({ collect_text_operator: 'bo' }, 'ana', 'z')).toEqual({ collect_text_operator: 'bo' });
    expect(nextPseudonym(['ana', 'bo'])).toBe('former-member-1');
    expect(nextPseudonym(['former-member-1', 'former-member-7', 'former-member-x'])).toBe('former-member-8');
  });
});

describe('former members', () => {
  let ctx: TestContext;
  let owner: { token: string; userId: string };
  let pid: string;
  const people: Record<string, { token: string; userId: string }> = {};
  const call = (method: 'GET' | 'POST' | 'DELETE', path: string, token = owner.token, payload?: Record<string, unknown>) =>
    ctx.app.inject({ method, url: `/v1/projects/${pid}${path}`, headers: bearer(token), ...(payload ? { payload } : {}) });

  beforeEach(async () => {
    ctx = await makeContext();
    owner = await setupPlatformAdmin(ctx.app);
    pid = (await createProject(ctx.app, 'Former')).projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    for (const name of ['ana', 'bo']) {
      const inv = await call('POST', '/invites', owner.token, { role: 'operator', maxUses: 1 });
      people[name] = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username: name, password: 'password12', inviteToken: inv.json().inviteToken } })).json();
    }
    const xml = (op: string) => `<plot><operator>\n    <value>${op}</value>\n  </operator></plot>`;
    for (const [name, keys] of [['ana', ['1', '2']], ['bo', ['3']]] as const) {
      const res = await batchRequest(ctx.app, pid, people[name].token, keys.map((k) => envelope({ recordKey: k, operator: name, modifiedOn: 1000 + Number(k), xml: xml(name), summary: { collect_text_operator: name, collect_text_id: k } })));
      expect(res.statusCode, res.body).toBe(200);
    }
  });
  afterEach(async () => {
    await ctx.app.close();
  });

  it("renames a former member's records everywhere, keeps the figures, and logs it without the name", async () => {
    // a member cannot be anonymised: removed first
    expect((await call('POST', '/former-members/anonymize', owner.token, { operator: 'ana' })).json().error).toBe('not_a_former_member');
    expect((await call('GET', '/former-members')).json()).toEqual({ formerMembers: [] });
    expect((await call('DELETE', `/members/${people.ana.userId}`)).statusCode).toBe(204);
    expect((await call('GET', '/former-members')).json()).toEqual({ formerMembers: [{ operator: 'ana', records: 2, anonymized: false }] });

    const res = await call('POST', '/former-members/anonymize', owner.token, { operator: 'ana' });
    expect(res.json()).toEqual({ operator: 'former-member-1', records: 2 });
    const rows = await ctx.store.listRecordSummaries(pid);
    const theirs = rows.filter((r) => r.operator === 'former-member-1');
    expect(theirs.map((r) => r.recordKey).sort()).toEqual(['1', '2']);
    expect(theirs.every((r) => r.summary.collect_text_operator === 'former-member-1')).toBe(true);
    expect(rows.some((r) => r.operator === 'ana' || JSON.stringify(r).includes('"ana"'))).toBe(false);
    const record = await ctx.store.getRecord(pid, '1', 'former-member-1');
    expect(record?.xml).toContain('<value>former-member-1</value>');
    expect(record?.xml).not.toContain('ana');
    // bo's are untouched
    expect(rows.filter((r) => r.operator === 'bo')).toHaveLength(1);
    // the history too, and the log says it was done, not who
    const events = await call('GET', '/activity');
    expect(events.statusCode, events.body).toBe(200);
    expect(events.body).toContain('member.anonymized');
    expect(events.body).not.toContain('"ana"');
    const history = await ctx.store.listRecordEvents(pid, { from: 0, to: Date.now() + 1, limit: 100 });
    expect(history.some((e) => e.operator === 'ana')).toBe(false);
    expect(history.filter((e) => e.operator === 'former-member-1').length).toBeGreaterThan(0);
    expect((await call('GET', '/former-members')).json()).toEqual({ formerMembers: [{ operator: 'former-member-1', records: 2, anonymized: true }] });
    // a second person gets the next number; a pseudonym cannot be anonymised again
    await call('DELETE', `/members/${people.bo.userId}`);
    expect((await call('POST', '/former-members/anonymize', owner.token, { operator: 'bo' })).json().operator).toBe('former-member-2');
    expect((await call('POST', '/former-members/anonymize', owner.token, { operator: 'former-member-1' })).statusCode).toBe(400);
  });

  it('is for coordinators only', async () => {
    expect((await call('GET', '/former-members', people.bo.token)).statusCode).toBe(403);
    expect((await call('POST', '/former-members/anonymize', people.bo.token, { operator: 'ana' })).statusCode).toBe(403);
  });
});
