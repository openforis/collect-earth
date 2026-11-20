// Corrections (docs/plans/2026-11-20-review-at-scale.md, B2-B4): plots decided "Correct it in Collect Earth" are
// assigned by a coordinator to people of the project, who correct them in their own Collect Earth. A correction is kept
// apart from the records (quality_corrections): it is no interpretation, so it never counts in the figures, the progress
// or anyone's plots, and it is the plot's final answer in the export.
//
// - GET  /quality/corrections        coordinators: who corrects which plot, which are corrected, whom to assign to
// - POST /quality/corrections:assign coordinators: assign plots decided "correct" (shared evenly), or to nobody
// - GET  /my-corrections             the person's plots to correct (Collect Earth): each with its answers, where they
//                                    differ, the reviewer's comment, and whether the person answered it themselves
// - GET  /my-corrections.csv         those plots as a plot file (their rows from the project's plot files)
// - PUT  /corrections/:plot          a correction (the record's XML and summary), only by whom it is assigned to
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { assignmentCounts, correctionDifferences, correctionsVersion, ownAssignments, shareEvenly } from '../corrections.js';
import { attachment } from '../download.js';
import { mergePlotFiles, type PlotFilePart } from '../myPlots.js';
import { plotFileOf } from '../plotFileCache.js';
import { buildPlotFile, noteText } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { recordResolver } from '../quality.js';
import { loadPlotContext, type QualityService } from '../qualityService.js';
import { fileKeyCount, keyShape, recordKeysOfUnit } from '../rounds.js';
import type { Store } from '../store/store.js';
import type { QualityDecision } from '../types.js';
import type {
  AssignCorrectionsAnswer,
  AssignmentPreview,
  CorrectionAnswer,
  CorrectionSavedAnswer,
  CorrectionsAnswer,
  MyCorrection,
  MyCorrectionsAnswer,
  OwnAssignment,
} from '../wire/review.js';
import { noteColumnOf, roundColumnOf } from './assignments.js';
import { copiesHeld, MAX_APPLY_PLOTS, MAX_BULK_LISTED, MAX_NAME } from './quality.js';

/** The largest record a correction may carry (XML), as records:batch takes a record */
const MAX_CORRECTION_XML = 2 * 1024 * 1024;
/** People plots are shared between in one assignment */
const MAX_ASSIGN_PEOPLE = 100;

const bad = (reason: string) => ({ error: 'bad_request', reason });

/**
 * How plots would be assigned to people (shared evenly, in the order given), and the plots that are someone's own (a
 * record of theirs, or a copy they hold). A reason (400) when a person is not one of the project's members who sign in.
 */
export async function planAssignment(
  store: Store,
  projectId: string,
  plots: readonly string[],
  people: readonly string[],
): Promise<{ assignments: { plot: string; userId: string | null }[]; preview: AssignmentPreview; own: OwnAssignment[] } | { reason: string }> {
  const unique = [...new Set(people)];
  if (unique.length > MAX_ASSIGN_PEOPLE) return { reason: `at most ${MAX_ASSIGN_PEOPLE} people` };
  const members = new Map((await store.listMembers(projectId)).filter((m) => !m.disabled).map((m) => [m.userId, m.username]));
  const unknown = unique.find((id) => !members.has(id));
  if (unknown !== undefined) return { reason: 'people must be members of the project who sign in (not disabled)' };
  const assignments = shareEvenly(plots, unique);
  // Who answered each plot: its records (by its keys), and the copies each person holds
  const info = await store.getRoundInfo(projectId);
  const keysOf = new Map(plots.map((plot) => [plot, recordKeysOfUnit(plot, info)]));
  const plotOfKey = new Map<string, string[]>();
  for (const [plot, keys] of keysOf) for (const k of keys) plotOfKey.set(k, [...(plotOfKey.get(k) ?? []), plot]);
  const records = unique.length > 0 && plots.length > 0 ? await store.listRecordsByKeys(projectId, [...plotOfKey.keys()]) : [];
  const answered = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.deleted) continue;
    for (const plot of plotOfKey.get(r.recordKey) ?? []) answered.set(plot, (answered.get(plot) ?? new Set()).add(r.operator));
  }
  const copies = new Map<string, Set<string>>();
  for (const id of unique) copies.set(id, await copiesHeld(store, projectId, id));
  const usernameOf = (id: string) => members.get(id) ?? null;
  const own = ownAssignments(assignments, usernameOf, (plot, username, userId) => answered.get(plot)?.has(username) === true || copies.get(userId)?.has(plot) === true);
  return { assignments, own, preview: { people: assignmentCounts(assignments, own, usernameOf), own: own.slice(0, MAX_BULK_LISTED), ownCount: own.length } };
}

export async function registerCorrectionRoutes(app: FastifyInstance, store: Store, quality: QualityService): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const member = { preHandler: requireProjectMembership(store) };
  const toCorrect = (decisions: readonly QualityDecision[]) => decisions.filter((d) => d.decision === 'correct');

  app.get('/v1/projects/:pid/quality/corrections', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const [decisions, corrections, members] = await Promise.all([store.listQualityDecisions(projectId), store.listCorrections(projectId), store.listMembers(projectId)]);
    const byPlot = new Map(corrections.map((c) => [c.plot, c]));
    const plots = toCorrect(decisions).map((d) => d.plot);
    // Whose own plots are assigned: worked out as an assignment would be, person by person
    const assigned = plots.map((plot) => ({ plot, userId: byPlot.get(plot)?.assignedTo ?? null }));
    const people = [...new Set(assigned.flatMap((a) => (a.userId ? [a.userId] : [])))];
    const own = new Set<string>();
    for (const userId of people) {
      const p = await planAssignment(store, projectId, assigned.filter((a) => a.userId === userId).map((a) => a.plot), [userId]);
      // (someone no longer a member who signs in: no warning, the plot is theirs to give to someone else)
      if (!('reason' in p)) for (const o of p.own) own.add(o.plot);
    }
    const lines = plots.map((plot) => {
      const c = byPlot.get(plot);
      return {
        plot,
        assignedTo: c?.assignedTo && c.assignedToName ? { userId: c.assignedTo, username: c.assignedToName } : null,
        assignedAt: c?.assignedTo ? c.assignedAt : null,
        correctedBy: c?.correctedBy ?? null,
        correctedAt: c?.correctedAt ?? null,
        own: own.has(plot),
      };
    });
    return reply.send({
      lines,
      counts: {
        unassigned: lines.filter((l) => l.assignedTo === null).length,
        assigned: lines.filter((l) => l.assignedTo !== null && l.correctedAt === null).length,
        corrected: lines.filter((l) => l.correctedAt !== null).length,
      },
      people: members.filter((m) => !m.disabled).map((m) => ({ userId: m.userId, username: m.username, role: m.role })),
    } satisfies CorrectionsAnswer);
  });

  // (`::` is a literal colon for Fastify's router.)
  app.post('/v1/projects/:pid/quality/corrections::assign', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { plots?: unknown; people?: unknown };
    const plots = body.plots;
    if (!Array.isArray(plots) || plots.length === 0 || plots.length > MAX_APPLY_PLOTS || !plots.every((x) => typeof x === 'string' && x.length > 0 && x.length <= MAX_NAME)) {
      return reply.code(400).send(bad(`plots must be 1 to ${MAX_APPLY_PLOTS} plot ids`));
    }
    const people = body.people;
    if (!Array.isArray(people) || !people.every((x) => typeof x === 'string')) return reply.code(400).send(bad('people must be user ids (none: to nobody)'));
    const dryRunText = (request.query as { dryRun?: unknown } | undefined)?.dryRun;
    const dryRun = dryRunText === '1' || dryRunText === 'true';
    const correct = new Set(toCorrect(await store.listQualityDecisions(projectId)).map((d) => d.plot));
    const asked = [...new Set(plots as string[])];
    const take = asked.filter((p) => correct.has(p));
    const skipped = asked.filter((p) => !correct.has(p));
    const plan = await planAssignment(store, projectId, take, people as string[]);
    if ('reason' in plan) return reply.code(400).send(bad(plan.reason));
    if (!dryRun && take.length > 0) {
      await store.assignCorrections(projectId, plan.assignments, request.membership!.userId ?? null, Date.now());
      await audit(store, request, 'corrections.assigned', { count: take.length, people: plan.preview.people.length, own: plan.preview.ownCount });
    }
    return reply.send({ ...plan.preview, count: take.length, skipped: skipped.slice(0, MAX_BULK_LISTED), skippedCount: skipped.length, dryRun } satisfies AssignCorrectionsAnswer);
  });

  /**
   * The person's plots to correct, with what Collect Earth needs of each: its answers (the first assessment first: the
   * form starts from it), where they differ, the reviewer's comment and whether the person answered it themselves.
   */
  const myCorrections = async (request: FastifyRequest): Promise<{ version: string; plots: MyCorrection[]; sources: { csvFileId: string; plots: Set<string> }[]; keyCount: number } | null> => {
    const { projectId, userId } = request.membership!;
    if (!userId) return null;
    const [decisions, corrections] = await Promise.all([store.listQualityDecisions(projectId), store.listCorrections(projectId)]);
    const byPlot = new Map(toCorrect(decisions).map((d) => [d.plot, d]));
    const mine = corrections.filter((c) => c.assignedTo === userId && byPlot.has(c.plot));
    const username = (await store.getUserById(userId))?.username ?? '';
    const context = await loadPlotContext(store, projectId, request.log);
    const keyCount = keyShape(context.info).count;
    if (mine.length === 0) return { version: correctionsVersion([]), plots: [], sources: [], keyCount };
    const keysOf = new Map(mine.map((c) => [c.plot, recordKeysOfUnit(c.plot, context.info)]));
    const records = (await store.listRecordsByKeys(projectId, [...new Set([...keysOf.values()].flat())])).filter((r) => !r.deleted);
    const xmls = new Map((await store.getRecordXml(projectId, records.map((r) => ({ recordKey: r.recordKey, operator: r.operator })))).map((x) => [`${x.recordKey}\u0000${x.operator}`, x.xml]));
    const resolve = recordResolver(context);
    const [outline, settings, copies] = await Promise.all([quality.outline(projectId, request.log), store.getQualitySettings(projectId), copiesHeld(store, projectId, userId)]);
    const plots: MyCorrection[] = mine.map((c) => {
      const keys = new Set(keysOf.get(c.plot));
      const answers: (CorrectionAnswer & { order: number })[] = records
        .filter((r) => keys.has(r.recordKey) && resolve(r).group === c.plot)
        .map((r) => {
          const assessment = resolve(r).round.assessment;
          return {
            operator: r.operator,
            recordKey: r.recordKey,
            assessment,
            submitted: r.activelySaved,
            modifiedOn: r.modifiedOn,
            xml: xmls.get(`${r.recordKey}\u0000${r.operator}`) ?? null,
            summary: r.summary,
            // The first assessment first (the latest of them), then the checks, the submitted before the drafts
            order: (assessment === 'main' ? 0 : assessment === 'check' ? 2 : 4) + (r.activelySaved ? 0 : 1),
          };
        })
        .sort((a, b) => a.order - b.order || b.modifiedOn - a.modifiedOn);
      const decision = byPlot.get(c.plot)!;
      return {
        plot: c.plot,
        comment: decision.comment,
        decidedBy: decision.decidedBy,
        decidedAt: decision.decidedAt,
        own: answers.some((a) => a.operator === username) || copies.has(c.plot),
        correctedAt: c.correctedAt,
        answers: answers.map(({ order: _order, ...a }) => a),
        differences: correctionDifferences(answers, outline, settings.margins ?? {}),
      };
    });
    // The plots' rows: from each plot file holding them, in the files' order
    const sources: { csvFileId: string; plots: Set<string> }[] = [];
    const wanted = new Set(plots.map((p) => p.plot));
    for (const [csvFileId, units] of context.fileUnits) {
      const here = new Set(units.filter((u) => wanted.has(u)));
      if (here.size > 0) sources.push({ csvFileId, plots: here });
    }
    const version = correctionsVersion([
      plots.map((p) => [p.plot, p.comment, p.decidedAt, p.correctedAt, p.answers.map((a) => [a.operator, a.recordKey, a.modifiedOn])]),
      sources.map((s) => s.csvFileId),
    ]);
    return { version, plots, sources, keyCount };
  };

  app.get('/v1/projects/:pid/my-corrections', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const mine = await myCorrections(request);
    if (!mine) return reply.code(403).send({ error: 'forbidden', reason: 'corrections are a signed-in person\'s, not a project token\'s' });
    const projectId = request.membership!.projectId;
    return reply.header('cache-control', 'no-store').send({
      version: mine.version,
      plots: mine.plots,
      keyColumns: mine.keyCount,
      downloadPath: `/v1/projects/${projectId}/my-corrections.csv?v=${mine.version}`,
    } satisfies MyCorrectionsAnswer);
  });

  app.get('/v1/projects/:pid/my-corrections.csv', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const mine = await myCorrections(request);
    if (!mine) return reply.code(403).send({ error: 'forbidden', reason: 'corrections are a signed-in person\'s, not a project token\'s' });
    const v = (request.query as { v?: unknown } | undefined)?.v;
    // Listed a moment ago and changed since: 409, as a plot file that changed (Collect Earth asks again)
    if (typeof v === 'string' && v !== '' && v !== mine.version) return reply.code(409).send({ error: 'changed', reason: 'the plots to correct changed: ask for them again' });
    const projectId = request.membership!.projectId;
    const files = new Map((await store.listCsvFiles(projectId)).map((f) => [f.id, f]));
    const info = await store.getRoundInfo(projectId);
    // As the person's own plots are served: the round column of a first assessment (what the form starts from), and
    // the reviewer's comment in the coordinator's note column when the survey has it
    const round = roundColumnOf(info, new Set()) ?? undefined;
    const note = noteColumnOf(info, new Map(mine.plots.map((p) => [p.plot, noteText(p.comment ?? '')])));
    const parts: PlotFilePart[] = [];
    for (const s of mine.sources) {
      const meta = files.get(s.csvFileId);
      const file = meta ? await store.getCsvFile(projectId, s.csvFileId) : null;
      if (!meta || !file) continue;
      const plotFile = plotFileOf(file, fileKeyCount(info));
      const keys = new Set(plotFile.plotIds.filter((id) => s.plots.has(id)));
      if (keys.size > 0) parts.push({ csvFileId: s.csvFileId, filename: meta.filename, data: buildPlotFile(plotFile, keys, round, undefined, note) });
    }
    const merged = mergePlotFiles(parts, mine.keyCount, { plotFile: false });
    return reply
      .header('content-type', 'text/csv')
      .header('cache-control', 'no-store')
      .header('x-checksum-sha256', merged.checksum)
      .header('x-plots', String(merged.plots))
      .header('content-disposition', attachment('to-correct.csv'))
      .send(merged.data);
  });

  app.put('/v1/projects/:pid/corrections/:plot', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, userId } = request.membership!;
    if (!userId) return reply.code(403).send({ error: 'forbidden', reason: 'a correction is a signed-in person\'s, not a project token\'s' });
    const plot = (request.params as { plot?: string }).plot ?? '';
    if (plot.length === 0 || plot.length > MAX_NAME) return reply.code(400).send(bad(`the plot must be 1-${MAX_NAME} characters`));
    const body = (request.body ?? {}) as { recordKey?: unknown; xml?: unknown; summary?: unknown; baseOperator?: unknown };
    if (typeof body.recordKey !== 'string' || body.recordKey.length === 0 || body.recordKey.length > MAX_NAME) return reply.code(400).send(bad('recordKey must be the corrected record\'s key'));
    if (typeof body.xml !== 'string' || body.xml.length === 0 || body.xml.length > MAX_CORRECTION_XML) return reply.code(400).send(bad('xml must be the corrected record'));
    const summary = body.summary;
    if (typeof summary !== 'object' || summary === null || Array.isArray(summary) || !Object.values(summary).every((v) => typeof v === 'string')) {
      return reply.code(400).send(bad('summary must be the record\'s answers by key (text)'));
    }
    const baseOperator = body.baseOperator === undefined || body.baseOperator === null ? null : body.baseOperator;
    if (baseOperator !== null && (typeof baseOperator !== 'string' || baseOperator.length > MAX_NAME)) return reply.code(400).send(bad('baseOperator must be the operator of the answer the form started from'));
    // Only a plot decided "Correct it in Collect Earth" and assigned to the person (another decision since, or someone
    // else now: 409, and Collect Earth says so and takes the plot off its list)
    const decision = (await store.listQualityDecisions(projectId)).find((d) => d.plot === plot);
    if (decision?.decision !== 'correct') return reply.code(409).send({ error: 'not_to_correct', reason: 'This plot is no longer to be corrected: its decision changed.' });
    const at = Date.now();
    const saved = await store.saveCorrection(projectId, plot, userId, { recordKey: body.recordKey, xml: body.xml, summary: summary as Record<string, string>, baseOperator: baseOperator as string | null, at });
    if (saved === 'not_assigned') return reply.code(409).send({ error: 'not_assigned', reason: 'This plot is no longer assigned to you to correct.' });
    await audit(store, request, 'correction.saved', { plot });
    return reply.send({ plot, correctedAt: at } satisfies CorrectionSavedAnswer);
  });
}
