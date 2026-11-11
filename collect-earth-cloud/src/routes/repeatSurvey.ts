// A repeat survey (docs/plans/2026-11-11-repeat-survey.md): a new project that collects the plots of this one again,
// years later, with this project's answers as an earlier period ("2020"). The new project is a copy of this one
// (copyProject: survey, project file, plot files, settings, and its people when asked), with a newer project file when
// the coordinator gives one; the earlier answers are stored apart (period_answers), never counted as its records.
//
// - POST /v1/projects/:pid/repeat/preview { projectFile? } (admin) -> what would come: the plots, the default labels,
//   the questions the header can show and the default ones, and what does not match a newer survey. Nothing stored.
// - POST /v1/projects/:pid/repeat { name, label, earlierLabel, members?, headerQuestions?, projectFile? } (admin, a
//   person's session) -> 201 { projectId, name, status: 'draft', ... }: the new project, as a draft.
// - GET /v1/projects/:pid/periods (member) -> { settings, periods: [{ label, plots }], questions }: null settings for
//   a project that repeats none.
// - PUT /v1/projects/:pid/periods/header { headerQuestions } (admin): the questions the header shows.
// - GET /v1/projects/:pid/periods/plots/:plot (member) -> { periods: [{ label, savedAt, answers, operator? }], labels,
//   options }: one plot's earlier answers, with the questions' labels and answers' names; who collected them is told to
//   coordinators and reviewers only.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { CepError, addPeriodStatus, readCep } from '../cep.js';
import { finalAnswers, recordResolver } from '../quality.js';
import { answerOptions } from '../qualityReports.js';
import { loadPlotContext } from '../qualityService.js';
import {
  defaultHeaderQuestions,
  earlierRecords,
  headerCandidates,
  labelOf,
  matchToSurvey,
  yearOf,
  type EarlierRecord,
  type MatchReport,
} from '../repeatSurvey.js';
import { copyProject } from '../projectCopy.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { keyShape, splitKey } from '../rounds.js';
import type { Store } from '../store/store.js';
import { surveyOutline, type Question } from '../surveyOutline.js';
import type { RepeatSettings } from '../types.js';
import { acceptCep } from './platform.js';
import { creationRefusal } from './projects.js';

interface RepeatBody {
  name?: unknown;
  /** this new project's period ("2025") */
  label?: unknown;
  /** the earlier period's ("2020") */
  earlierLabel?: unknown;
  members?: unknown;
  headerQuestions?: unknown;
  /** a newer project file (.cep), in base64 */
  projectFile?: unknown;
}

type Log = FastifyRequest['log'];

/** The survey of a project file (the served one, or a newer one given), as its questions; null when it has none. */
function outlineOf(cep: Buffer | null): Map<string, Question> | null {
  if (!cep) return null;
  const files = readCep(cep);
  return surveyOutline(new TextDecoder().decode(files.entries.get(files.surveyPath)!));
}

/** This project's earlier record of each plot: the coordinator's final one, else the latest submitted first assessment. */
async function earlierOf(store: Store, projectId: string, log: Log): Promise<EarlierRecord[]> {
  const [records, context, decisions] = await Promise.all([store.listRecordSummaries(projectId), loadPlotContext(store, projectId, log), store.listQualityDecisions(projectId)]);
  const { info, units, copyHolders, reference } = context;
  const resolve = recordResolver({ info, units, copyHolders });
  const finalOf = finalAnswers({ records, info, units, copyHolders }, new Map(decisions.filter((d) => !reference.has(d.plot)).map((d) => [d.plot, d.decision])));
  return earlierRecords(records, (r) => resolve(r).round, finalOf);
}

/** The body's newer project file, or the answer refusing it; undefined when none was given. */
function newerCepOf(body: RepeatBody, reply: FastifyReply): Buffer | null | undefined {
  if (body.projectFile === undefined || body.projectFile === null || body.projectFile === '') return undefined;
  if (typeof body.projectFile !== 'string') {
    void reply.code(400).send({ error: 'bad_request', reason: 'projectFile must be the project file (.cep) in base64' });
    return null;
  }
  const cep = Buffer.from(body.projectFile, 'base64');
  try {
    outlineOf(cep);
  } catch (e) {
    if (e instanceof CepError) {
      void reply.code(400).send({ error: 'cep_unreadable', reason: e.message });
      return null;
    }
    throw e;
  }
  return cep;
}

/** The header's questions asked for, the ones the survey has (the default ones when none is). */
function headerOf(raw: unknown, outline: ReadonlyMap<string, Question>): string[] {
  const candidates = new Set(headerCandidates(outline).map((q) => q.key));
  const asked = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string' && candidates.has(k)) : [];
  return asked.length > 0 ? [...new Set(asked)].slice(0, 12) : defaultHeaderQuestions(outline);
}

/** The served project file with the period status (addPeriodStatus), the original kept as the upload path keeps it. */
export async function servePeriodStatus(store: Store, projectId: string): Promise<void> {
  const [served, info, original] = await Promise.all([store.getCep(projectId), store.getRoundInfo(projectId), store.getOriginalCep(projectId)]);
  if (!served || !info) return;
  const status = addPeriodStatus(served);
  if (status.added) await store.putCep(projectId, status.cep, info, original ?? served);
}

const questionList = (outline: ReadonlyMap<string, Question>) => headerCandidates(outline).map((q) => ({ key: q.key, label: q.label, kind: q.kind }));

export async function registerRepeatSurveyRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const member = { preHandler: requireProjectMembership(store) };

  app.post('/v1/projects/:pid/repeat/preview', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as RepeatBody;
    const newer = newerCepOf(body, reply);
    if (newer === null) return reply;
    const outline = outlineOf(newer ?? (await store.getCep(projectId)));
    if (!outline) return reply.code(409).send({ error: 'no_project_file', reason: 'This project has no project file to repeat.' });
    const earlier = await earlierOf(store, projectId, request.log);
    const { report } = matchToSurvey(earlier, outline);
    const settings = await store.getRepeatSettings(projectId);
    const thisYear = String(new Date().getUTCFullYear());
    return reply.send({
      plots: earlier.length,
      // This project's own period when it repeats another, else the year most of its plots were saved in
      earlierLabel: settings?.label ?? yearOf(earlier) ?? '',
      label: thisYear,
      // The periods before it come along
      periods: [...(settings?.earlier ?? []).map((p) => ({ label: p.label, plots: p.plots }))],
      questions: questionList(outline),
      headerQuestions: settings ? headerOf(settings.headerQuestions, outline) : defaultHeaderQuestions(outline),
      report,
    });
  });

  app.post('/v1/projects/:pid/repeat', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const sourceId = request.membership!.projectId;
    const user = request.userId ? await store.getUserById(request.userId) : null;
    if (!user) return reply.code(403).send({ error: 'user_session_required', reason: 'Repeat a survey signed in as a person: the new project needs a coordinator' });
    const body = (request.body ?? {}) as RepeatBody;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 200) return reply.code(400).send({ error: 'bad_request', reason: 'name must be 1-200 characters' });
    const label = labelOf(body.label);
    const earlierLabel = labelOf(body.earlierLabel);
    if (!label || !earlierLabel) return reply.code(400).send({ error: 'bad_request', reason: 'label and earlierLabel must be 1-40 characters' });
    const source = await store.getProject(sourceId);
    const sourceSettings = await store.getRepeatSettings(sourceId);
    const taken = new Set([...(sourceSettings?.earlier ?? []).map((p) => p.label), earlierLabel]);
    if (taken.has(label) || (sourceSettings?.earlier ?? []).some((p) => p.label === earlierLabel)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'Each period needs a label of its own' });
    }
    const newer = newerCepOf(body, reply);
    if (newer === null) return reply;
    if (!(await store.getCep(sourceId))) return reply.code(409).send({ error: 'no_project_file', reason: 'This project has no project file to repeat.' });
    const refused = await creationRefusal(store, user);
    if (refused) return reply.code(403).send(refused);

    const earlier = await earlierOf(store, sourceId, request.log);
    const projectId = await copyProject(store, sourceId, { name, ownerId: user.id, members: body.members === true });
    if (newer) {
      const accepted = await acceptCep(store, projectId, newer, request.log);
      if (!accepted.ok) {
        // Nothing half made
        await store.deleteProject(projectId);
        return reply.code(accepted.status).send(accepted.body);
      }
    }
    const outline = outlineOf(await store.getCep(projectId))!;

    // This project's answers, and those of the periods before it (a project that repeats another), matched to the new
    // survey; what does not match is reported, per period
    const reports: { label: string; plots: number; report: MatchReport }[] = [];
    const matched = matchToSurvey(earlier, outline);
    const periods: RepeatSettings['earlier'] = [];
    const now = Date.now();
    for (const p of sourceSettings?.earlier ?? []) {
      const rows = (await store.listPeriodAnswers(sourceId, p.label)).map((r) => ({ plot: r.plotKey, operator: r.operator, savedAt: r.savedAt, answers: r.answers }));
      const before = matchToSurvey(rows, outline);
      await store.replacePeriodAnswers(projectId, p.label, before.records.map((r) => ({ plotKey: r.plot, operator: r.operator, savedAt: r.savedAt, answers: r.answers })));
      periods.push(p);
      reports.push({ label: p.label, plots: before.records.length, report: before.report });
    }
    await store.replacePeriodAnswers(projectId, earlierLabel, matched.records.map((r) => ({ plotKey: r.plot, operator: r.operator, savedAt: r.savedAt, answers: r.answers })));
    periods.push({ label: earlierLabel, sourceProjectId: sourceId, sourceName: source?.name ?? '', plots: matched.records.length, madeAt: now });
    reports.push({ label: earlierLabel, plots: matched.records.length, report: matched.report });
    const headerQuestions = headerOf(body.headerQuestions, outline);
    await store.setRepeatSettings(projectId, { label, earlier: periods, headerQuestions });
    // The period status the collectors' form asks in the plot's header, added to the survey it serves
    await servePeriodStatus(store, projectId);

    try {
      await store.appendAudit(projectId, {
        actorUserId: user.id,
        action: 'project.imported',
        details: { source: 'repeat', sourceProjectId: sourceId, label, earlierLabel, plots: matched.records.length, newerSurvey: newer !== undefined },
      });
    } catch (err) {
      request.log.error({ err }, 'audit log write failed');
    }
    await audit(store, request, 'project.imported', { source: 'repeated', repeatProjectId: projectId, label });
    request.log.info({ sourceId, projectId, plots: matched.records.length }, 'survey repeated');
    return reply.code(201).send({ projectId, name, status: 'draft', label, periods: reports, headerQuestions });
  });

  app.get('/v1/projects/:pid/periods', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const settings = await store.getRepeatSettings(projectId);
    if (!settings) return reply.send({ settings: null, periods: [], questions: [] });
    const outline = outlineOf(await store.getCep(projectId));
    const labels = new Map(outline ? [...outline.values()].map((q) => [q.key, q.label] as const) : []);
    return reply.send({
      settings,
      periods: settings.earlier.map((p) => ({ label: p.label, plots: p.plots })),
      // The header's questions with their labels, in the header's order
      questions: settings.headerQuestions.map((key) => ({ key, label: labels.get(key) ?? key })),
      candidates: outline ? questionList(outline) : [],
    });
  });

  app.put('/v1/projects/:pid/periods/header', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const settings = await store.getRepeatSettings(projectId);
    if (!settings) return reply.code(404).send({ error: 'not_found', reason: 'This project repeats no survey.' });
    const outline = outlineOf(await store.getCep(projectId));
    const raw = ((request.body ?? {}) as { headerQuestions?: unknown }).headerQuestions;
    if (!outline || !Array.isArray(raw)) return reply.code(400).send({ error: 'bad_request', reason: 'headerQuestions must be a list of questions' });
    const headerQuestions = headerOf(raw, outline);
    await store.setRepeatSettings(projectId, { ...settings, headerQuestions });
    await audit(store, request, 'settings.changed', { setting: 'repeatHeader', questions: headerQuestions.length });
    return reply.send({ headerQuestions });
  });

  app.get('/v1/projects/:pid/periods/plots/:plot', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const plot = (request.params as { plot: string }).plot;
    // The plot as the desktop names it ("17,1", with the round of its key) or as the plot files do ("17")
    let rows = await store.getPlotPeriodAnswers(projectId, plot);
    if (rows.length === 0) {
      const info = await store.getRoundInfo(projectId);
      const { plot: bare } = splitKey(plot, keyShape(info).count, keyShape(info).roundIndex);
      if (bare !== plot) rows = await store.getPlotPeriodAnswers(projectId, bare);
    }
    const settings = await store.getRepeatSettings(projectId);
    const role = request.membership!.role;
    const seesWho = role === 'admin' || role === 'reviewer';
    // The questions' labels and their answers' names, from the survey: the project may have no record of the plot yet
    const outline = rows.length > 0 ? outlineOf(await store.getCep(projectId)) : null;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.answers)))];
    const labels: Record<string, string> = {};
    for (const key of keys) labels[key] = outline?.get(key)?.label ?? key;
    return reply.send({
      periods: rows.map((r) => ({ label: r.label, savedAt: r.savedAt, answers: r.answers, ...(seesWho ? { operator: r.operator } : {}) })),
      labels,
      options: outline ? answerOptions(outline, keys) : {},
      // what the form's header shows: this period's label and the plot's main characteristics
      label: settings?.label ?? null,
      header: settings?.headerQuestions ?? [],
    });
  });
}
