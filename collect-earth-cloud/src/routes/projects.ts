import { Readable } from 'node:stream';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { secretsEqual } from '../accountRules.js';
import { audit } from '../activity.js';
import { bearerToken } from '../auth.js';
import type { Config } from '../config.js';
import { attachment } from '../download.js';
import { NOTE_SUMMARY_KEY, noteColumn, readCep } from '../cep.js';
import { BACKUP_ROUNDS, collectBackupZip, planBackup, type BackupOutcome, type BackupPlan, type BackupRounds, type PlanInput } from '../collectBackup.js';
import { exportRoundOf, recordsCsv } from '../export.js';
import { storageSummary } from '../limits.js';
import { finalAnswers, recordResolver } from '../quality.js';
import { loadPlotContext } from '../qualityService.js';
import { keyShape } from '../rounds.js';
import type { Store } from '../store/store.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';

interface SurveyBody {
  surveyUri?: string;
  surveyName?: string;
  idmlBase64?: string;
}

/** Project provisioning, ping/metadata, and survey-definition upload. */
export async function registerProjectRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
): Promise<void> {
  // Provisioning, three ways (not a project-scoped route):
  //  1. `x-admin-key` matching ADMIN_API_KEY: the Phase-0 operator path, unchanged —
  //     returns the project tokens.
  //  2. A user session (dashboard): allowed when projectCreation is "anyone" or the
  //     caller is a platform admin; the caller becomes the project's admin.
  //  3. Neither: only on a throwaway dev/test server (no ADMIN_API_KEY AND the memory
  //     store). A real deployment never hands out projects anonymously.
  app.post('/v1/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { name?: string };
    const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : 'Untitled project';

    const adminKey = request.headers['x-admin-key'];
    if (typeof adminKey === 'string' && adminKey.length > 0) {
      if (!config.adminApiKey || !secretsEqual(adminKey, config.adminApiKey)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      return reply.code(201).send(await store.createProject({ name }));
    }

    const token = bearerToken(request.headers.authorization);
    if (token) {
      const session = await store.resolveSession(token);
      const user = session ? await store.getUserById(session.userId) : null;
      if (!user) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const settings = await store.getSettings();
      if (settings.projectCreation !== 'anyone' && !user.isPlatformAdmin) {
        return reply.code(403).send({ error: 'project_creation_restricted' });
      }
      // Per-account limit on the projects one coordinates (the hosted model).
      // Platform admins own the server and are exempt.
      const limit = settings.maxProjectsPerUser;
      if (limit > 0 && !user.isPlatformAdmin && (await store.countCoordinatedProjects(user.id)) >= limit) {
        return reply.code(403).send({ error: 'project_limit_reached', limit });
      }
      // The Phase-0 tokens are minted but not returned: the creator works with
      // their session, as a project admin member.
      const { projectId } = await store.createProject({ name });
      await store.addMembership(projectId, user.id, 'admin');
      return reply.code(201).send({ projectId, name });
    }

    if (!config.adminApiKey && config.storeBackend === 'memory') {
      return reply.code(201).send(await store.createProject({ name }));
    }
    return reply.code(401).send({ error: 'unauthorized' });
  });

  // Ping / metadata — used by the desktop "Test connection" button and by clients
  // to confirm the token before syncing.
  app.get(
    '/v1/projects/:pid',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const project = await store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.send({
        projectId: project.projectId,
        name: project.name,
        surveyUri: project.surveyUri,
        surveyName: project.surveyName,
        hasSurvey: project.idmlBase64 !== null,
        role: request.membership!.role,
      });
    },
  );

  // Survey definition upload (admin only). Body: { surveyUri, surveyName?, idmlBase64 }.
  app.put(
    '/v1/projects/:pid/survey',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as SurveyBody;
      if (!body.surveyUri || !body.idmlBase64) {
        return reply.code(400).send({ error: 'bad_request', reason: 'surveyUri and idmlBase64 are required' });
      }
      await store.setSurvey(
        request.membership!.projectId,
        body.surveyUri,
        body.surveyName ?? null,
        body.idmlBase64,
      );
      await audit(store, request, 'survey.replaced', { bytes: Buffer.byteLength(body.idmlBase64, 'base64') });
      return reply.send({ ok: true });
    },
  );

  // Rename (admin).
  app.patch(
    '/v1/projects/:pid',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { name?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 200) {
        return reply.code(400).send({ error: 'bad_request', reason: 'name must be 1-200 characters' });
      }
      await store.renameProject(request.membership!.projectId, name);
      await audit(store, request, 'settings.changed', { setting: 'name' });
      return reply.send({ projectId: request.membership!.projectId, name });
    },
  );

  // Delete the project and all its data (admin). The body must repeat the project
  // name, so a slip of the mouse cannot do it. Cannot be undone.
  app.delete(
    '/v1/projects/:pid',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const project = await store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const body = (request.body ?? {}) as { confirmName?: unknown };
      const confirmName = typeof body.confirmName === 'string' ? body.confirmName.trim() : '';
      if (confirmName !== project.name.trim()) {
        return reply.code(400).send({ error: 'confirm_mismatch', reason: 'confirmName must be the project name' });
      }
      await store.deleteProject(projectId);
      return reply.code(204).send();
    },
  );

  // Dashboard overview (admin): what has been set up and how collection is going.
  // Deleted records (tombstones) are not counted.
  app.get(
    '/v1/projects/:pid/overview',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const project = await store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const [cep, members, csvFiles, records, storage] = await Promise.all([
        store.getCepInfo(projectId),
        store.listMembers(projectId),
        store.listCsvFiles(projectId),
        store.listRecordSummaries(projectId),
        storageSummary(store, projectId),
      ]);
      const byOperator = new Map<string, { operator: string; total: number; submitted: number; lastModifiedOn: number }>();
      let submitted = 0;
      for (const r of records) {
        const entry = byOperator.get(r.operator) ?? { operator: r.operator, total: 0, submitted: 0, lastModifiedOn: 0 };
        entry.total += 1;
        if (r.activelySaved) {
          entry.submitted += 1;
          submitted += 1;
        }
        entry.lastModifiedOn = Math.max(entry.lastModifiedOn, r.modifiedOn);
        byOperator.set(r.operator, entry);
      }
      return reply.send({
        name: project.name,
        cep,
        members: members.length,
        csvFiles: csvFiles.length,
        plots: csvFiles.reduce((sum, f) => sum + f.plotCount, 0),
        records: {
          total: records.length,
          submitted,
          byOperator: [...byOperator.values()].sort((a, b) => a.operator.localeCompare(b.operator)),
        },
        storage,
      });
    },
  );

  // All collected data as one CSV (admin), for Excel / a spreadsheet.
  app.get(
    '/v1/projects/:pid/export.csv',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const project = await store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      // The plots of every plot file, read as the division reads them, so a record gets
      // the same plot and round here as in the division and the plot files served; and
      // the coordinator's decisions, by plot unit as the quality figures pair records.
      const [records, context, decisions] = await Promise.all([
        store.listRecordSummaries(projectId),
        loadPlotContext(store, projectId, request.log),
        store.listQualityDecisions(projectId),
      ]);
      const { info, units, copyHolders, reference } = context;
      // Reference plots (Task 14) are never decided: their round 2 measures the collectors
      // against the reference, so `final` stays blank for them and `reference` says "yes".
      const finalOf = finalAnswers({ records, info, units, copyHolders }, new Map(decisions.filter((d) => !reference.has(d.plot)).map((d) => [d.plot, d.decision])));
      const resolve = recordResolver({ info, units, copyHolders });
      // The coordinator's note the server added (Task 16) is the coordinator's text, not an answer.
      const leaveOut = noteColumn(info) !== null ? new Set([NOTE_SUMMARY_KEY]) : new Set<string>();
      const csv = recordsCsv(records, exportRoundOf(info, units, copyHolders), finalOf, (r) => reference.size > 0 && reference.has(resolve(r).group), leaveOut);
      await audit(store, request, 'export.downloaded', { records: records.length });
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', attachment(`${project.name}-data.csv`, 'export.csv'))
        .send(csv);
    },
  );

  // The Collect Earth backup (Task 17): what it would hold with each choice, for the dialog.
  app.get(
    '/v1/projects/:pid/exports/collect-backup/summary',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const facts = await backupFacts(store, projectId, request.log);
      return reply.send({
        projectFile: facts.projectFile,
        roundKey: facts.roundKey,
        roundState: facts.roundState,
        note: facts.note,
        rounds: {
          '1': planSummary(planBackup(facts.input, '1')),
          all: facts.roundKey ? planSummary(planBackup(facts.input, 'all')) : null,
        },
      });
    },
  );

  // The Collect Earth backup itself: a zip Collect Earth imports ("Import new data from ZIP"),
  // written as it is sent. `rounds` 1 (first assessments) or all (only with the round key).
  app.get(
    '/v1/projects/:pid/exports/collect-backup',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const rounds = ((request.query as { rounds?: string }).rounds ?? '1') as BackupRounds;
      if (!BACKUP_ROUNDS.includes(rounds)) {
        return reply.code(400).send({ error: 'bad_request', reason: 'rounds is 1 or all' });
      }
      const project = await store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const [facts, cep] = await Promise.all([backupFacts(store, projectId, request.log), store.getCep(projectId)]);
      if (!cep) {
        return reply.code(409).send({ error: 'no_project_file', reason: 'the backup carries the survey of the project file: upload a project file first' });
      }
      if (rounds === 'all' && !facts.roundKey) {
        // Without round in the key a plot's first assessment and its check have one key, and
        // Collect Earth keeps one record per key: only the first assessments can go.
        return reply.code(409).send({ error: 'no_round_key', reason: 'the survey has no round key: only round 1 can be in the backup' });
      }
      // The survey as served (with the round and the coordinator's note the server added): the one
      // Collect Earth has loaded, which the import finds by its URI.
      const files = readCep(cep);
      const survey = files.entries.get(files.surveyPath)!;
      const plan = planBackup(facts.input, rounds);
      await audit(store, request, 'export.downloaded', { kind: 'collect-backup', rows: plan.records.length, rounds });
      const outcome: BackupOutcome = { written: 0, missing: 0 };
      const stream = Readable.from(collectBackupZip(store, projectId, survey, plan, new Date(), outcome));
      stream.on('end', () => {
        if (outcome.missing > 0) request.log.warn({ missing: outcome.missing }, 'collect backup: records gone since the plan were left out');
      });
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', attachment(`${project.name}-collect-earth-backup${rounds === 'all' ? '-all-rounds' : ''}.zip`, 'collect-earth-backup.zip'))
        .send(stream);
    },
  );
}

/** What the backup is made of: the records with their round and whether each is of a reference plot. */
async function backupFacts(store: Store, projectId: string, log: FastifyBaseLogger) {
  const [records, context, cepInfo] = await Promise.all([
    store.listRecordStates(projectId),
    loadPlotContext(store, projectId, log),
    store.getCepInfo(projectId),
  ]);
  const { info, units, copyHolders, reference } = context;
  const resolve = recordResolver({ info, units, copyHolders });
  const resolved = new Map<string, ReturnType<typeof resolve>>();
  const of = (r: { recordKey: string; operator: string }) => {
    const id = `${r.recordKey}\u0000${r.operator}`;
    let hit = resolved.get(id);
    if (!hit) {
      hit = resolve(r);
      resolved.set(id, hit);
    }
    return hit;
  };
  const input: PlanInput = {
    records,
    roundOf: (r) => of(r).round,
    isReference: (r) => reference.size > 0 && reference.has(of(r).group),
  };
  return {
    input,
    projectFile: cepInfo !== null,
    roundKey: keyShape(info).roundIndex !== null,
    roundState: info?.state ?? null,
    note: noteColumn(info) !== null,
  };
}

/** A plan's counts for the dialog (not its list of records). */
function planSummary(plan: BackupPlan) {
  return {
    records: plan.records.length,
    drafts: plan.drafts,
    reference: plan.reference,
    otherRounds: plan.otherRounds,
    sameKey: plan.sameKey,
    sameKeyReference: plan.sameKeyReference,
    sameKeyExamples: plan.sameKeyExamples,
  };
}
