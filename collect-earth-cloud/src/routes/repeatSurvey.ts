// A repeat survey (docs/plans/2026-11-11-repeat-survey.md): a new project that collects the plots of this one again,
// years later, with this project's answers as an earlier period ("2020"). The new project is a copy of this one
// (copyProject: survey, project file, plot files, settings, and its people when asked), with a newer project file when
// the coordinator gives one; the earlier answers are stored apart (period_answers), never counted as its records.
//
// - POST /v1/projects/:pid/repeat/preview { projectFile? } (admin) -> what would come: the plots, the default labels,
//   the questions the header can show and the default ones, and what does not match a newer survey. Nothing stored.
// - POST /v1/projects/:pid/repeat { name, label, earlierLabel, members?, headerQuestions?, plots?, projectFile? } (admin,
//   a person's session) -> 201 { projectId, name, status: 'draft', filePlots, ... }: the new project, as a draft; with
//   plots 'collected', its plot files keep only the plots collected in the earlier period.
// - GET /v1/projects/:pid/periods (member) -> { settings, periods: [{ label, plots }], questions }: null settings for
//   a project that repeats none.
// - PUT /v1/projects/:pid/periods/header { headerQuestions } (admin): the questions the header shows.
// - GET /v1/projects/:pid/periods/change?question=&period=&area= (reviewer) -> the comparison of one question
//   (stage 3) with its areas and their uncertainty (stage 4, `areas`); GET .../periods/change.csv a row per plot,
//   GET .../periods/change-areas.csv the areas.
// - GET /v1/projects/:pid/periods/export.csv[?coordinates=none] (admin): every period side by side, one row per plot,
//   each question's answer in each period next to each other (bothPeriodsTable).
// - PUT /v1/projects/:pid/periods/area { totalArea } (admin): the total area in hectares, for a project file with no
//   areas file (every plot then stands for the same area); null to clear it.
// - GET /v1/projects/:pid/periods/plots/:plot (member) -> { periods: [{ label, savedAt, answers, operator? }], labels,
//   options }: one plot's earlier answers, with the questions' labels and answers' names; who collected them is told to
//   coordinators and reviewers only.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { CepError, NOTE_SUMMARY_KEY, PERIOD_STATUS_KEY, addPeriodStatus, readCep } from '../cep.js';
import { attachment } from '../download.js';
import { csvField } from '../export.js';
import { finalAnswers, recordResolver } from '../quality.js';
import { answerOptions } from '../qualityReports.js';
import { loadPlotContext } from '../qualityService.js';
import {
  changeQuestions,
  bothPeriodsTable,
  changeAreas,
  compareRepeat,
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
import { isPositionKey, withoutPositions } from '../positions.js';
import { modelOf, projectFactors, type FirstAssessment } from './analysis.js';

interface RepeatBody {
  name?: unknown;
  /** this new project's period ("2025") */
  label?: unknown;
  /** the earlier period's ("2020") */
  earlierLabel?: unknown;
  members?: unknown;
  headerQuestions?: unknown;
  /** the plots to collect again: 'all' of the plot files (the default), or only those 'collected' in the earlier period */
  plots?: unknown;
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
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };

  app.post('/v1/projects/:pid/repeat/preview', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as RepeatBody;
    const newer = newerCepOf(body, reply);
    if (newer === null) return reply;
    const outline = outlineOf(newer ?? (await store.getCep(projectId)));
    if (!outline) return reply.code(409).send({ error: 'no_project_file', reason: 'This project has no project file to repeat.' });
    const [earlier, files] = await Promise.all([earlierOf(store, projectId, request.log), store.listCsvFiles(projectId)]);
    const { report } = matchToSurvey(earlier, outline);
    const settings = await store.getRepeatSettings(projectId);
    const thisYear = String(new Date().getUTCFullYear());
    return reply.send({
      plots: earlier.length,
      // the plots of the plot files, for the choice of all of them or only those collected
      filePlots: files.reduce((n, f) => n + f.plotCount, 0),
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

    if (body.plots !== undefined && body.plots !== 'all' && body.plots !== 'collected') {
      return reply.code(400).send({ error: 'bad_request', reason: "plots must be 'all' or 'collected'" });
    }
    const earlier = await earlierOf(store, sourceId, request.log);
    // Only the plots collected in the earlier period: the plot files' rows of those plots (a file's row names the plot
    // with its round when the survey has a round of its own, as the earlier records' plots do not)
    let keepPlot: ((plotId: string) => boolean) | undefined;
    if (body.plots === 'collected') {
      if (earlier.length === 0) return reply.code(409).send({ error: 'nothing_collected', reason: 'No plot was collected in this project: repeat all of them.' });
      const collected = new Set(earlier.map((r) => r.plot));
      const info = await store.getRoundInfo(sourceId);
      const shape = keyShape(info);
      const own = info?.state === 'own' && shape.roundIndex !== null;
      keepPlot = (plotId) => collected.has(own ? splitKey(plotId, shape.count, shape.roundIndex).plot : plotId);
    }
    const projectId = await copyProject(store, sourceId, { name, ownerId: user.id, members: body.members === true, keepPlot });
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
    await store.setRepeatSettings(projectId, { label, earlier: periods, headerQuestions, ...(sourceSettings?.totalArea ? { totalArea: sourceSettings.totalArea } : {}) });
    // The period status the collectors' form asks in the plot's header, added to the survey it serves
    await servePeriodStatus(store, projectId);

    try {
      await store.appendAudit(projectId, {
        actorUserId: user.id,
        action: 'project.imported',
        details: { source: 'repeat', sourceProjectId: sourceId, label, earlierLabel, plots: matched.records.length, newerSurvey: newer !== undefined, onlyCollected: body.plots === 'collected' },
      });
    } catch (err) {
      request.log.error({ err }, 'audit log write failed');
    }
    await audit(store, request, 'project.imported', { source: 'repeated', repeatProjectId: projectId, label });
    request.log.info({ sourceId, projectId, plots: matched.records.length }, 'survey repeated');
    const filePlots = (await store.listCsvFiles(projectId)).reduce((n, f) => n + f.plotCount, 0);
    return reply.code(201).send({ projectId, name, status: 'draft', label, periods: reports, headerQuestions, plots: body.plots === 'collected' ? 'collected' : 'all', filePlots });
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

  /** The comparison of one question between an earlier period and this one (stage 3), or the answer refusing it */
  const changeOf = async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const settings = await store.getRepeatSettings(projectId);
    if (!settings || settings.earlier.length === 0) {
      void reply.code(404).send({ error: 'not_found', reason: 'This project repeats no survey.' });
      return null;
    }
    const query = (request.query ?? {}) as { question?: unknown; period?: unknown };
    const period = typeof query.period === 'string' && settings.earlier.some((p) => p.label === query.period) ? query.period : settings.earlier[settings.earlier.length - 1].label;
    const outline = outlineOf(await store.getCep(projectId));
    if (!outline) {
      void reply.code(409).send({ error: 'no_project_file', reason: 'This project has no project file.' });
      return null;
    }
    const [earlier, now] = await Promise.all([store.listPeriodAnswers(projectId, period), earlierOf(store, projectId, request.log)]);
    const questions = changeQuestions(outline, earlier, PERIOD_STATUS_KEY);
    const asked = typeof query.question === 'string' ? query.question : '';
    const question = questions.find((q) => q.key === asked) ?? questions.find((q) => settings.headerQuestions.includes(q.key)) ?? questions[0];
    if (!question) {
      void reply.code(409).send({ error: 'no_question', reason: 'The earlier period answered no question this survey asks with one choice.' });
      return null;
    }
    const change = compareRepeat(
      earlier.map((r) => ({ plot: r.plotKey, answers: r.answers })),
      now.map((r) => ({ plot: r.plot, answers: r.answers })),
      question.key,
      PERIOD_STATUS_KEY,
    );
    return { settings, period, question, questions, change, earlier, now, options: answerOptions(outline, [question.key])[question.key] ?? [] };
  };

  /**
   * The areas of a comparison: the project's areas (projectFactors: the strata or total area set on the dashboard, else
   * the project file's areas file), else one stratum of the total area (the query's `area`, else the one saved), else shares only
   * (`areaKnown` false: every plot standing for the same share of an area not known).
   */
  const areasOf = async (request: FastifyRequest, found: NonNullable<Awaited<ReturnType<typeof changeOf>>>) => {
    const projectId = request.membership!.projectId;
    const cep = await store.getCep(projectId);
    const parsed = cep ? modelOf(cep) : null;
    // Each plot as the areas read it (this period's record, else the earlier period's answers): the project's strata or
    // total area set on the dashboard, else the project file's areas file, as the Uncertainty page has them
    const plots = new Map<string, FirstAssessment>(found.earlier.map((r) => [r.plotKey, { recordKey: r.plotKey, operator: r.operator, summary: r.answers }]));
    for (const r of found.now) plots.set(r.plot, { recordKey: r.plot, operator: r.operator, summary: r.answers });
    const factors = parsed ? await projectFactors(store, projectId, parsed, plots, await store.getRoundInfo(projectId)) : null;
    const asked = Number((request.query as { area?: unknown } | undefined)?.area);
    const totalArea = Number.isFinite(asked) && asked > 0 && asked <= 1e12 ? asked : (found.settings.totalArea ?? null);
    const strata = new Map<string, number>();
    if (factors) {
      for (const f of factors.byPlot.values()) if (f.factor > 0) strata.set(f.stratum, (strata.get(f.stratum) ?? 0) + f.factor);
    } else strata.set('', totalArea ?? 1);
    const stratumOf = (plot: string) => {
      if (!factors) return '';
      const f = factors.byPlot.get(plot);
      return f && f.factor > 0 ? f.stratum : null;
    };
    return { source: factors?.source ?? null, areaKnown: factors !== null || totalArea !== null, savedArea: found.settings.totalArea ?? null, ...changeAreas(found.change.rows, stratumOf, strata) };
  };

  app.get('/v1/projects/:pid/periods/change', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const found = await changeOf(request, reply);
    if (!found) return reply;
    const { settings, period, question, questions, change, options } = found;
    return reply.send({
      period,
      label: settings.label,
      periods: settings.earlier.map((p) => p.label),
      question: { key: question.key, label: question.label },
      questions: questions.map((q) => ({ key: q.key, label: q.label })),
      options,
      counts: change.counts,
      matrix: change.matrix,
      corrections: change.corrections,
      rows: change.rows,
      areas: await areasOf(request, found),
      canEdit: request.membership!.role === 'admin',
    });
  });

  // The areas as a file: the outcomes, the transition matrix, the corrections and each answer's area, with the uncertainty
  app.get('/v1/projects/:pid/periods/change-areas.csv', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const found = await changeOf(request, reply);
    if (!found) return reply;
    const { settings, period, question, options } = found;
    const areas = await areasOf(request, found);
    const name = (code: string) => options.find((o) => o.code === code)?.label ?? code;
    const unit = areas.areaKnown ? 'ha' : 'share';
    const header = ['table', 'from', 'to', 'from label', 'to label', 'plots', `area_${unit}`, 'share_pct', `se_${unit}`, `ci95_${unit}`, 'uncertainty_pct'];
    const round = (v: number) => String(Math.round(v * 1e6) / 1e6);
    const line = (table: string, from: string, to: string, e: (typeof areas)['outcomes']['changed']) => [
      table, from, to, from === '' ? '' : name(from), to === '' ? '' : name(to), String(e.plots), round(e.area), round(e.share * 100), round(e.se), round(e.ci), e.uncertainty === null ? '' : round(e.uncertainty),
    ];
    const lines = [
      ...(['unchanged', 'changed', 'corrected'] as const).map((o) => line(`outcome ${o}`, '', '', areas.outcomes[o])),
      ...areas.matrix.map((m) => line('transition', m.from, m.to, m.estimate)),
      ...areas.corrections.map((m) => line('correction', m.from, m.to, m.estimate)),
      ...areas.classes.flatMap((c) => [line(`area ${period}`, c.code, '', c.then), line(`area ${settings.label}`, '', c.code, c.now), line('net change', c.code, c.code, c.net)]),
    ];
    const project = await store.getProject(request.membership!.projectId);
    await audit(store, request, 'export.downloaded', { kind: 'changeAreas', records: areas.plots });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(`${project?.name ?? 'project'}-change-areas-${question.key}-${period}-${settings.label}.csv`, 'change-areas.csv'))
      .send(`\uFEFF${[header, ...lines].map((r) => r.map((v) => csvField(v)).join(',')).join('\r\n')}\r\n`);
  });

  // Every period side by side: the earlier periods' answers and this one's (the record taken for each plot, as the
  // comparison takes it), a row per plot, for the coordinator to work on both in a spreadsheet
  app.get('/v1/projects/:pid/periods/export.csv', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const settings = await store.getRepeatSettings(projectId);
    if (!settings || settings.earlier.length === 0) return reply.code(404).send({ error: 'not_found', reason: 'This project repeats no survey.' });
    const outline = outlineOf(await store.getCep(projectId));
    if (!outline) return reply.code(409).send({ error: 'no_project_file', reason: 'This project has no project file.' });
    const [earlier, now, project] = await Promise.all([
      Promise.all(settings.earlier.map(async (p) => ({ label: p.label, rows: (await store.listPeriodAnswers(projectId, p.label)).map((r) => ({ plot: r.plotKey, operator: r.operator, savedAt: r.savedAt, answers: r.answers })) }))),
      earlierOf(store, projectId, request.log),
      store.getProject(projectId),
    ]);
    const noPositions = withoutPositions(request.query);
    const table = bothPeriodsTable(
      [...earlier, { label: settings.label, rows: now }],
      outline,
      PERIOD_STATUS_KEY,
      // the coordinator's note is not an answer; the places, when asked for a file without them
      (key) => key === NOTE_SUMMARY_KEY || (noPositions && isPositionKey(key)),
    );
    await audit(store, request, 'export.downloaded', { kind: 'periods', records: table.rows.length, ...(noPositions ? { coordinates: false } : {}) });
    const labels = [...settings.earlier.map((p) => p.label), settings.label].join('-');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(`${project?.name ?? 'project'}-periods-${labels}.csv`, 'periods.csv'))
      .send(`\uFEFF${[table.columns, ...table.rows].map((r) => r.map((v) => csvField(v)).join(',')).join('\r\n')}\r\n`);
  });

  app.put('/v1/projects/:pid/periods/area', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const settings = await store.getRepeatSettings(projectId);
    if (!settings) return reply.code(404).send({ error: 'not_found', reason: 'This project repeats no survey.' });
    const raw = ((request.body ?? {}) as { totalArea?: unknown }).totalArea;
    if (raw !== null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > 1e12)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'totalArea is a number of hectares above 0, or null' });
    }
    const { totalArea: _old, ...rest } = settings;
    await store.setRepeatSettings(projectId, raw === null ? rest : { ...rest, totalArea: raw });
    await audit(store, request, 'settings.changed', { setting: 'repeatArea' });
    return reply.send({ totalArea: raw });
  });

  // The comparison as a file: one row per plot, the answer of each period, the collector's answer and the outcome
  app.get('/v1/projects/:pid/periods/change.csv', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const found = await changeOf(request, reply);
    if (!found) return reply;
    const { settings, period, question, change, options } = found;
    const name = (code: string | null) => (code === null ? '' : options.find((o) => o.code === code)?.label ?? code);
    const header = ['plot', `${question.key} ${period}`, `${question.key} ${settings.label}`, `${period} label`, `${settings.label} label`, 'period_status', 'outcome', 'to_look_at'];
    const lines = change.rows.map((r) => [r.plot, r.earlier ?? '', r.now ?? '', name(r.earlier), name(r.now), r.status ?? '', r.outcome, r.mismatch ?? '']);
    const project = await store.getProject(request.membership!.projectId);
    await audit(store, request, 'export.downloaded', { kind: 'change', records: change.rows.length });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', attachment(`${project?.name ?? 'project'}-change-${period}-${settings.label}.csv`, 'change.csv'))
      .send(`\uFEFF${[header, ...lines].map((r) => r.map((v) => csvField(v)).join(',')).join('\r\n')}\r\n`);
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
