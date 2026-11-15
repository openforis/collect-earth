// The ways people work with Collect Earth, and the moves between them, as the server sees them (the desktop's side is
// in CloudServiceTest and CloudRecordsSenderTest; the runs with the real desktop are described in
// docs/plans/2026-11-15-workflow-review.md):
// - a big group on a cloud server: a coordinator, an invitation link, people with and without an account;
// - someone who worked alone, then joins a cloud project and sends the plots already on their computer;
// - an office team that shared one database, brought to the cloud from its backup, its people joining afterwards;
// - people joining a project after its work started.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sampleBackupZip } from './backupSampleData.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from './helpers.js';

interface BatchResponse {
  results: { recordKey: string; status: string; reason?: string }[];
}

const invite = async (app: FastifyInstance, projectId: string, token: string, maxUses = 5, role = 'operator') =>
  (await app.inject({ method: 'POST', url: `/v1/projects/${projectId}/invites`, headers: bearer(token), payload: { role, maxUses } })).json() as {
    inviteToken: string;
    joinUrl: string;
  };
const register = (app: FastifyInstance, username: string, password: string, inviteToken: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/register', payload: { username, password, inviteToken } });
const login = (app: FastifyInstance, username: string, password: string, inviteToken?: string) =>
  app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password, ...(inviteToken ? { inviteToken } : {}) } });
const usesOf = async (app: FastifyInstance, projectId: string, token: string) =>
  ((await app.inject({ method: 'GET', url: `/v1/projects/${projectId}/invites`, headers: bearer(token) })).json() as { invites: { usedCount: number }[] }).invites.map(
    (i) => i.usedCount,
  );

describe('a big group on a cloud server: who joins, and how', () => {
  let ctx: TestContext;
  let coordinator: { token: string };
  let projectId: string;

  beforeEach(async () => {
    ctx = await makeContext();
    coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
    projectId = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Land use 2026' } })).json().projectId;
  });
  afterEach(async () => ctx.app.close());

  it('someone without an account makes one with the link; the link counts one use', async () => {
    const link = await invite(ctx.app, projectId, coordinator.token, 3);
    const preview = (await ctx.app.inject({ method: 'GET', url: `/v1/join/${link.inviteToken}` })).json();
    expect(preview).toMatchObject({ valid: true, projectName: 'Land use 2026', role: 'operator' });
    const res = await register(ctx.app, 'ana', 'ana-password', link.inviteToken);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ username: 'ana', projectId, role: 'operator' });
    expect(await usesOf(ctx.app, projectId, coordinator.token)).toEqual([1]);
  });

  it('someone with an account (from another project) signs in with the link: the project is added to theirs', async () => {
    const other = await createProject(ctx.app, 'Older project');
    expect((await register(ctx.app, 'bruno', 'bruno-password', (await invite(ctx.app, other.projectId, other.adminToken)).inviteToken)).statusCode).toBe(201);
    const link = await invite(ctx.app, projectId, coordinator.token, 3);

    // making a second account with the same name is refused, and does not use the link
    expect((await register(ctx.app, 'bruno', 'another-password', link.inviteToken)).json()).toEqual({ error: 'username_taken' });
    expect(await usesOf(ctx.app, projectId, coordinator.token)).toEqual([0]);

    const res = await login(ctx.app, 'bruno', 'bruno-password', link.inviteToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: 'bruno', projectId, role: 'operator' });
    const me = (await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(res.json().token) })).json();
    expect(me.memberships.map((m: { projectId: string }) => m.projectId).sort()).toEqual([other.projectId, projectId].sort());
    expect(await usesOf(ctx.app, projectId, coordinator.token)).toEqual([1]);
  });

  it('someone already in the project signs in with the link again: their role is kept and no use is counted', async () => {
    const link = await invite(ctx.app, projectId, coordinator.token, 3);
    await register(ctx.app, 'carla', 'carla-password', link.inviteToken);
    const again = await login(ctx.app, 'carla', 'carla-password', link.inviteToken);
    expect(again.json()).toMatchObject({ projectId, role: 'operator' });
    expect(await usesOf(ctx.app, projectId, coordinator.token)).toEqual([1]);
  });

  it('a used-up or withdrawn link refuses new people with a reason Collect Earth shows', async () => {
    const once = await invite(ctx.app, projectId, coordinator.token, 1);
    expect((await register(ctx.app, 'dani', 'dani-password', once.inviteToken)).statusCode).toBe(201);
    expect((await register(ctx.app, 'eva', 'eva-password', once.inviteToken)).json()).toEqual({ error: 'invite_exhausted' });
    // the person who used it can still sign in with it
    expect((await login(ctx.app, 'dani', 'dani-password', once.inviteToken)).statusCode).toBe(200);

    const withdrawn = await invite(ctx.app, projectId, coordinator.token, 5);
    const id = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/invites`, headers: bearer(coordinator.token) })).json().invites[0].id;
    await ctx.app.inject({ method: 'DELETE', url: `/v1/projects/${projectId}/invites/${id}`, headers: bearer(coordinator.token) });
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/join/${withdrawn.inviteToken}` })).json().valid).toBe(false);
    expect((await register(ctx.app, 'eva', 'eva-password', withdrawn.inviteToken)).json()).toEqual({ error: 'invalid_invite' });
    // a too short password is said before the link is looked at
    expect((await register(ctx.app, 'eva', 'short', withdrawn.inviteToken)).json().error).toBe('weak_password');
  });

  it("each person's plots are kept as theirs, whatever name Collect Earth sends with them", async () => {
    const link = await invite(ctx.app, projectId, coordinator.token, 5);
    const ana = (await register(ctx.app, 'ana', 'ana-password', link.inviteToken)).json().token as string;
    const bruno = (await register(ctx.app, 'bruno', 'bruno-password', link.inviteToken)).json().token as string;
    await batchRequest(ctx.app, projectId, ana, [envelope({ recordKey: 'P1', operator: 'ana' }), envelope({ recordKey: 'P2', operator: 'Ana Gómez' })]);
    // bruno sends a plot with ana's name: it is still his
    await batchRequest(ctx.app, projectId, bruno, [envelope({ recordKey: 'P3', operator: 'ana' })]);
    // the same plot done by two people: two records, one each
    await batchRequest(ctx.app, projectId, bruno, [envelope({ recordKey: 'P1', operator: 'bruno' })]);
    const rows = (await ctx.store.listRecords(projectId)).map((r) => `${r.recordKey}:${r.operator}`).sort();
    expect(rows).toEqual(['P1:ana', 'P1:bruno', 'P2:ana', 'P3:bruno']);
  });
});

describe('alone first, then a cloud project', () => {
  let ctx: TestContext;
  let projectId: string;
  let coordinator: { token: string };

  beforeEach(async () => {
    ctx = await makeContext();
    coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
    projectId = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Land use 2026' } })).json().projectId;
  });
  afterEach(async () => ctx.app.close());

  it('the plots done alone, under the name typed in Collect Earth, become the account’s when sent; sending again adds nothing', async () => {
    const juan = (await register(ctx.app, 'juan', 'juan-password', (await invite(ctx.app, projectId, coordinator.token)).inviteToken)).json().token as string;
    // what CloudRecordsSender sends: every record of the computer, with the operator name of the time (Collect Earth's
    // default name for one of them)
    const local = [
      envelope({ recordKey: 'P1', operator: 'Juan Perez', modifiedOn: 1000 }),
      envelope({ recordKey: 'P2', operator: 'Juan Perez', modifiedOn: 2000 }),
      envelope({ recordKey: 'P3', operator: 'Collect Earth User', modifiedOn: 3000, activelySaved: false }),
    ];
    const first = (await batchRequest(ctx.app, projectId, juan, local)).json() as BatchResponse;
    expect(first.results.map((r) => r.status)).toEqual(['stored', 'stored', 'stored']);
    const second = (await batchRequest(ctx.app, projectId, juan, local)).json() as BatchResponse;
    expect(second.results.map((r) => r.status)).not.toContain('error');
    const rows = (await ctx.store.listRecords(projectId)).map((r) => `${r.recordKey}:${r.operator}`).sort();
    expect(rows).toEqual(['P1:juan', 'P2:juan', 'P3:juan']);
  });
});

describe('an office team on one database, then the cloud', () => {
  let ctx: TestContext;
  let coordinator: { token: string };

  beforeEach(async () => {
    ctx = await makeContext();
    coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
  });
  afterEach(async () => ctx.app.close());

  /** Rosa has an account already (another project); the backup's collectors are Marta, Marta P, Rosa Vidal and Collect Earth's default name */
  async function rosaWithAccount(): Promise<void> {
    const other = await createProject(ctx.app, 'Older project');
    await register(ctx.app, 'rosa', 'rosa-password', (await invite(ctx.app, other.projectId, other.adminToken)).inviteToken);
  }
  const importBackup = (collectors: Record<string, string>) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/projects/from-backup',
      headers: bearer(coordinator.token),
      payload: { backup: sampleBackupZip().toString('base64'), collectors, name: 'Office survey' },
    });
  const owners = async (projectId: string) =>
    (await ctx.store.listRecords(projectId)).map((r) => `${r.recordKey}:${r.operator}`).sort();

  it('the coordinator brings the team’s backup: a named account takes its collector’s plots, the others keep the typed name', async () => {
    await rosaWithAccount();
    const res = await importBackup({ 'Rosa Vidal': 'rosa' });
    expect(res.statusCode).toBe(201);
    const { projectId } = res.json();
    expect(await owners(projectId)).toEqual(['P1,1:Marta', 'P1,2:Marta P', 'P2,1:Collect Earth User', 'P3,1:rosa']);
    // an account named for nobody that exists is refused before anything is made
    expect((await importBackup({ Marta: 'nobody' })).json().error).toBe('unknown_account');
  });

  it('a typed name that is an account’s username must be given an account: those plots would otherwise become that person’s', async () => {
    const p = await createProject(ctx.app, 'Older project');
    await register(ctx.app, 'Marta', 'marta-password', (await invite(ctx.app, p.projectId, p.adminToken)).inviteToken);
    expect((await importBackup({})).json()).toMatchObject({ error: 'name_is_account', name: 'Marta' });
    expect((await importBackup({ Marta: 'Marta' })).statusCode).toBe(201);
  });

  it('a person who joins later takes the plots under their typed name only as they save them again', async () => {
    const { projectId } = (await importBackup({})).json();
    const marta = (await register(ctx.app, 'marta', 'marta-password', (await invite(ctx.app, projectId, coordinator.token)).inviteToken)).json().token as string;
    // Marta saves P1 again in Collect Earth, which still sends her typed name
    await batchRequest(ctx.app, projectId, marta, [envelope({ recordKey: 'P1,1', operator: 'Marta', modifiedOn: Date.now() })]);
    // P1 is hers now (her typed name is her username in other letter case), not a second copy; her other plots ('Marta
    // P', the name she used later) stay under the typed name until saved again
    expect(await owners(projectId)).toEqual(['P1,1:marta', 'P1,2:Marta P', 'P2,1:Collect Earth User', 'P3,1:Rosa Vidal']);
  });

  it('…but never when another person has that exact name as their username', async () => {
    const { projectId } = (await importBackup({})).json();
    const link = (await invite(ctx.app, projectId, coordinator.token)).inviteToken;
    const marta = (await register(ctx.app, 'marta', 'marta-password', link)).json().token as string;
    // another person, whose username is "Marta" exactly, joins the server afterwards
    const p = await createProject(ctx.app, 'Other');
    await register(ctx.app, 'Marta', 'other-password', (await invite(ctx.app, p.projectId, p.adminToken)).inviteToken);
    await batchRequest(ctx.app, projectId, marta, [envelope({ recordKey: 'P1,1', operator: 'Marta', modifiedOn: Date.now() })]);
    expect(await owners(projectId)).toEqual(['P1,1:Marta', 'P1,1:marta', 'P1,2:Marta P', 'P2,1:Collect Earth User', 'P3,1:Rosa Vidal']);
  });

  it('a person who joins and sends their own computer’s copies takes those plots, without doubling them', async () => {
    const { projectId } = (await importBackup({})).json();
    const rosa = (await register(ctx.app, 'rosa', 'rosa-password', (await invite(ctx.app, projectId, coordinator.token)).inviteToken)).json().token as string;
    // her computer has P3 under her typed name (the copy the backup was made from), older than the server's
    const res = (await batchRequest(ctx.app, projectId, rosa, [envelope({ recordKey: 'P3,1', operator: 'Rosa Vidal', modifiedOn: 1000 })])).json() as BatchResponse;
    expect(res.results[0].status).not.toBe('error');
    expect(await owners(projectId)).toEqual(['P1,1:Marta', 'P1,2:Marta P', 'P2,1:Collect Earth User', 'P3,1:rosa']);
  });
});

describe('joining after the work started', () => {
  let ctx: TestContext;
  let coordinator: { token: string };
  let projectId: string;

  beforeEach(async () => {
    ctx = await makeContext();
    coordinator = await setupPlatformAdmin(ctx.app, 'coordinator', 'coordinator-pw');
    projectId = (await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: bearer(coordinator.token), payload: { name: 'Land use 2026' } })).json().projectId;
  });
  afterEach(async () => ctx.app.close());

  it("a late joiner's plots count beside the others', and nobody's earlier plots change hands", async () => {
    const link = await invite(ctx.app, projectId, coordinator.token, 10);
    const ana = (await register(ctx.app, 'ana', 'ana-password', link.inviteToken)).json().token as string;
    await batchRequest(ctx.app, projectId, ana, [envelope({ recordKey: 'P1', operator: 'ana' }), envelope({ recordKey: 'P2', operator: 'ana' })]);
    const late = (await register(ctx.app, 'luis', 'luis-password', link.inviteToken)).json().token as string;
    // luis's computer had ana's plots in it (a copy of her database): sent with his sign-in they are his copies, ana keeps hers
    await batchRequest(ctx.app, projectId, late, [envelope({ recordKey: 'P2', operator: 'ana', modifiedOn: 5000 }), envelope({ recordKey: 'P3', operator: 'luis' })]);
    expect((await ctx.store.listRecords(projectId)).map((r) => `${r.recordKey}:${r.operator}`).sort()).toEqual(['P1:ana', 'P2:ana', 'P2:luis', 'P3:luis']);
    const people = (await ctx.app.inject({ method: 'GET', url: `/v1/projects/${projectId}/members`, headers: bearer(coordinator.token) })).json();
    expect(JSON.stringify(people)).toContain('luis');
  });
});
