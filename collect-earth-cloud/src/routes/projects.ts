import { isPositionKey, withoutPositions } from '../positions.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { secretsEqual } from '../accountRules.js';
import { audit } from '../activity.js';
import { bearerToken } from '../auth.js';
import type { Config } from '../config.js';
import { attachment } from '../download.js';
import { NOTE_SUMMARY_KEY, noteColumn, zipCep } from '../cep.js';
import type { AnalysisModel } from '../analysis.js';
import { answerLabels, csvFormatOf, exportRoundOf, recordsCsv, recordsTable, type ExportOptions } from '../export.js';
import { storageSummary } from '../limits.js';
import { geojsonOf, kmlOf, rowGeometries, shapefileOf } from '../mapExport.js';
import { finalAnswers, recordResolver } from '../quality.js';
import { loadPlotContext } from '../qualityService.js';
import type { Store } from '../store/store.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR } from '../surveyOutline.js';
import { PROJECT_STATUSES, STATUS_MOVES, type AuditDetails, type EventCursor, type ProjectStatus, type RecordRow, type User } from '../types.js';
import type { ProjectCopyAnswer, ProjectRenameAnswer, ProjectStatusAnswer } from '../wire/projectSettings.js';
import { copyProject } from '../projectCopy.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { factorsByRecord, firstAssessments, projectFactors } from './analysis.js';
import { surveyOf } from './areas.js';
import { PlotPlaceReader } from './plotPlaces.js';

interface SurveyBody {
  surveyUri?: string;
  surveyName?: string;
  idmlBase64?: string;
}

/**
 * Why this account may not make a new project (403), or null: projectCreation, and the per-account
 * limit on the projects one coordinates (the hosted model). Platform admins own the server and are exempt.
 */
export async function creationRefusal(store: Store, user: User): Promise<{ error: string; limit?: number } | null> {
  if (user.isPlatformAdmin) return null;
  const settings = await store.getSettings();
  if (settings.projectCreation !== 'anyone') {
    return { error: 'project_creation_restricted' };
  }
  const limit = settings.maxProjectsPerUser;
  if (limit > 0 && (await store.countCoordinatedProjects(user.id)) >= limit) {
    return { error: 'project_limit_reached', limit };
  }
  return null;
}

/** Project provisioning, ping/metadata, and survey-definition upload. */
export async function registerProjectRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
  places = new PlotPlaceReader(store),
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
      const refused = await creationRefusal(store, user);
      if (refused) {
        return reply.code(403).send(refused);
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
        status: project.status,
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
      await audit(store, request, 'settings.changed', { setting: 'name', name });
      return reply.send({ projectId: request.membership!.projectId, name } satisfies ProjectRenameAnswer);
    },
  );

  // The project's lifecycle (admin): publish a draft, close, reopen, archive, restore (STATUS_MOVES).
  app.put(
    '/v1/projects/:pid/status',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const status = ((request.body ?? {}) as { status?: unknown }).status;
      if (!PROJECT_STATUSES.includes(status as ProjectStatus)) {
        return reply.code(400).send({ error: 'bad_request', reason: `status must be one of ${PROJECT_STATUSES.join(', ')}` });
      }
      const from = await store.getProjectStatus(projectId);
      if (!from) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (!STATUS_MOVES[from].includes(status as ProjectStatus)) {
        return reply.code(409).send({ error: 'bad_transition', reason: `A ${from} project cannot become ${String(status)}`, status: from });
      }
      await store.setProjectStatus(projectId, status as ProjectStatus);
      await audit(store, request, 'settings.changed', { setting: 'status', from, status: status as ProjectStatus });
      return reply.send({ projectId, status: status as ProjectStatus } satisfies ProjectStatusAnswer);
    },
  );

  // A new project from this one (admin, with a session: the copy's coordinator), as a draft: see copyProject.
  // The same rules as making a project (creationRefusal); works from a closed or archived project too.
  app.post(
    '/v1/projects/:pid/copy',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.userId ? await store.getUserById(request.userId) : null;
      if (!user) {
        return reply.code(403).send({ error: 'user_session_required', reason: 'Copy a project signed in as a person: the copy needs a coordinator' });
      }
      const body = (request.body ?? {}) as { name?: unknown; members?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 200) {
        return reply.code(400).send({ error: 'bad_request', reason: 'name must be 1-200 characters' });
      }
      const refused = await creationRefusal(store, user);
      if (refused) {
        return reply.code(403).send(refused);
      }
      const projectId = await copyProject(store, request.membership!.projectId, { name, ownerId: user.id, members: body.members === true });
      return reply.code(201).send({ projectId, name, status: 'draft' } satisfies ProjectCopyAnswer);
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

  // All collected data as one CSV (admin), for Excel / a spreadsheet; or as a map file, each
  // record with its plot's shape (GeoJSON, KML, a zipped shapefile).
  const formats = [
    { path: 'export.csv', format: 'csv', type: 'text/csv; charset=utf-8', file: 'data.csv' },
    { path: 'export.geojson', format: 'geojson', type: 'application/geo+json', file: 'data.geojson' },
    { path: 'export.kml', format: 'kml', type: 'application/vnd.google-earth.kml+xml', file: 'data.kml' },
    { path: 'export.shp.zip', format: 'shp', type: 'application/zip', file: 'data-shapefile.zip' },
  ] as const;
  for (const { path, format, type, file } of formats) app.get(
    `/v1/projects/:pid/${path}`,
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
      const [all, context, decisions, members, parsed] = await Promise.all([
        store.listRecordSummaries(projectId, { firstSubmissions: true }),
        loadPlotContext(store, projectId, request.log),
        store.listQualityDecisions(projectId),
        store.listMembers(projectId),
        surveyOf(store, projectId),
      ]);
      const query = (request.query ?? {}) as { excluded?: unknown; lang?: unknown; labels?: unknown };
      const choice = await recordsChoice(store, request, parsed.model);
      if (typeof choice === 'string') return reply.code(400).send({ error: 'bad_request', reason: choice });
      // The records of people left out of the results are not in it, unless ?excluded=include.
      const excluded = query.excluded === 'include' ? new Set<string>() : new Set(members.filter((m) => m.excluded).map((m) => m.username));
      const records = excluded.size > 0 ? all.filter((r) => !excluded.has(r.operator)) : all;
      const { info, units, copyHolders, reference } = context;
      // Reference plots (Task 14) are never decided: their round 2 measures the collectors
      // against the reference, so `final` stays blank for them and `reference` says "yes".
      const finalOf = finalAnswers({ records, info, units, copyHolders }, new Map(decisions.filter((d) => !reference.has(d.plot)).map((d) => [d.plot, d.decision])));
      const resolve = recordResolver({ info, units, copyHolders });
      // The coordinator's note the server added (Task 16) is the coordinator's text, not an answer.
      const leaveOut = noteColumn(info) !== null ? new Set([NOTE_SUMMARY_KEY]) : new Set<string>();
      // Without plot locations (?coordinates=none): for sharing with whoever only needs the answers
      const noPositions = withoutPositions(request.query);
      if (noPositions && format !== 'csv') {
        return reply.code(400).send({ error: 'bad_request', reason: 'a map file always has the plot locations' });
      }
      if (noPositions) for (const r of records) for (const k of Object.keys(r.summary)) if (isPositionKey(k)) leaveOut.add(k);
      // The plots' expansion factors and weights, as the analysis has them: over every first assessment of the project
      const firsts = firstAssessments(all, resolve);
      const factors = await projectFactors(store, projectId, parsed, firsts, info);
      // The person's language (?lang=): the CSV's separators, and the labels of the answers when asked (?labels=include)
      const language = typeof query.lang === 'string' ? query.lang : 'en';
      const labels = query.labels === 'include';
      const options: ExportOptions = {
        keep: choice.keep,
        labelsOf: labels ? answerLabels(parsed.model, language) : undefined,
        weights: factors ? factorsByRecord(factors, firsts) : undefined,
        format: csvFormatOf(language),
      };
      const args = [records, exportRoundOf(info, units, copyHolders), finalOf, (r: RecordRow) => reference.size > 0 && reference.has(resolve(r).group), leaveOut, options] as const;
      let body: string | Buffer;
      if (format === 'csv') {
        body = recordsCsv(...args);
      } else {
        const table = recordsTable(...args);
        const plot = table.columns.indexOf('plot');
        const found = await places.places(projectId, [...new Set(table.rows.map((row) => row[plot]))], request.log);
        const geometries = rowGeometries(table, new Map(found.places.map((p) => [p.plot, [p.lat, p.lon] as const])), found.outline);
        body =
          format === 'geojson' ? geojsonOf(table, geometries)
          : format === 'kml' ? kmlOf(table, geometries, project.name)
          : zipCep(shapefileOf(table, geometries, 'plots', new Date()), new Date());
      }
      const count = choice.keep ? records.filter(choice.keep).length : records.length;
      await audit(store, request, 'export.downloaded', { records: count, ...(format === 'csv' ? {} : { format }), ...(noPositions ? { coordinates: false } : {}), ...(labels ? { labels: true } : {}), ...choice.details });
      return reply
        .header('content-type', type)
        .header('content-disposition', attachment(`${project.name}-${file}`, `export-${file}`))
        .send(body);
    },
  );

  // What the data download's "Records to download" offers (admin): when this person last downloaded the data, and the
  // survey's plot questions, with the code lists of the code ones, to keep the records with an answer.
  app.get(
    '/v1/projects/:pid/export/choices',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const [{ model }, lastDownload] = await Promise.all([surveyOf(store, projectId), lastDataDownload(store, projectId, request.membership!.userId)]);
      const questions = model.tables[0].columns.map((c) => ({ key: c.key, name: c.name, labels: c.labels, list: c.type === 'code' && c.list && model.lists[c.list] ? c.list : null }));
      const lists = Object.fromEntries(questions.flatMap((q) => (q.list ? [[q.list, model.lists[q.list]]] : [])));
      return reply.header('cache-control', 'no-store').send({ lastDownload, languages: model.languages, questions, lists });
    },
  );
}

/**
 * When this person last downloaded the data (an `export.downloaded` without a kind: the activity files, the backups and
 * the analysis file have one), or null: never, or no person (a project token).
 */
async function lastDataDownload(store: Store, projectId: string, userId: string | undefined): Promise<number | null> {
  if (!userId) return null;
  const limit = 100;
  for (let before: EventCursor | undefined; ; ) {
    const page = await store.listAudit(projectId, { limit, actor: userId, action: 'export.downloaded', before });
    const found = page.find((e) => e.details.kind === undefined);
    if (found) return found.at;
    if (page.length < limit) return null;
    before = { at: page[limit - 1].at, id: page[limit - 1].id };
  }
}

/**
 * The records a download keeps (the dashboard's "Records to download"), and what to note of the choice in the log; or
 * why the query is wrong. `?since=` an ISO date or time, or `last` (this person's last download of the data; none: every
 * record): the records received since then (receivedAt, server time); a date: the records saved (modifiedOn) from then. `?question=` a summary key of the survey's plot and `?value=`:
 * the records with that answer, exactly (a code question: one of its codes).
 */
async function recordsChoice(store: Store, request: FastifyRequest, model: AnalysisModel): Promise<string | { keep?: (r: RecordRow) => boolean; details: AuditDetails }> {
  const q = (request.query ?? {}) as { since?: unknown; question?: unknown; value?: unknown };
  const tests: ((r: RecordRow) => boolean)[] = [];
  const details: AuditDetails = {};
  if (q.since !== undefined) {
    const last = q.since === 'last';
    const since = last
      ? await lastDataDownload(store, request.membership!.projectId, request.membership!.userId)
      : typeof q.since === 'string' && /^\d{4}-\d{2}-\d{2}/.test(q.since) ? Date.parse(q.since) : Number.NaN;
    if (since !== null && !Number.isFinite(since)) return 'The date to download the records changed since is not a date (2026-11-01).';
    details.since = since;
    if (last) details.sinceLast = true;
    // since the last download: what reached the server since (a plot saved offline before it and sent after is not missed)
    if (since !== null) tests.push(last ? (r) => r.receivedAt >= since : (r) => r.modifiedOn >= since);
  }
  if (q.question !== undefined) {
    const question = model.tables[0].columns.find((c) => c.key === q.question);
    if (!question) return 'The question to keep the records by is not a question of the survey.';
    const value = q.value;
    if (typeof value !== 'string' || value === '') return 'Give the answer to keep the records by.';
    const { key } = question;
    tests.push(question.type === 'code'
      ? (r) => (r.summary[key] ?? '').split(SUMMARY_VALUES_SEPARATOR).some((v) => v.split(QUALIFIER_SEPARATOR)[0] === value)
      : (r) => r.summary[key] === value);
    // the question only: the log holds ids and counts, never answers
    details.question = key;
  }
  return { keep: tests.length > 0 ? (r) => tests.every((test) => test(r)) : undefined, details };
}
