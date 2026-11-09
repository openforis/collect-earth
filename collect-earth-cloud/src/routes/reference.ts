import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit } from '../activity.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { holderList } from '../holders.js';
import { isPlotUnit } from '../progress.js';
import type { ProjectState, ProjectStateCache } from '../projectState.js';
import type { QualityService, ServedReport } from '../qualityService.js';
import {
  checkMark,
  splitListedPlots,
  MAX_PLOTS_PER_REQUEST,
  MAX_REFERENCE_ANSWERS,
  MAX_REFERENCE_PLOTS,
  parseReferenceAnswers,
  parsePlotList,
  pickReference,
  referenceCopyPlan,
  type MarkRefusal,
  type ExternalReferenceFigures,
  type ReferenceFigures,
} from '../reference.js';
import type { Store } from '../store/store.js';
import type { Member, PlotAssignment, ReferencePlot } from '../types.js';
import { served } from './quality.js';
import { fileKeyCount } from '../rounds.js';

/** Why a mark was refused, in plain words (the page has its own texts by `code`). */
const REASONS: Record<MarkRefusal['code'], string> = {
  whole_file: 'Only plots of a divided plot file can be reference plots: give its plots one by one (divide it) first.',
  unknown_plots: 'Some plots are not in this plot file.',
  not_a_plot: 'Some ids are the re-assessment of a plot, not a plot.',
  in_other_file: 'Some plots are also in another plot file: only a plot in one file can be a reference plot.',
  assessed_by_others: 'Someone other than the reference assessor already assessed some of these plots first.',
  too_many: `A project can have at most ${MAX_REFERENCE_PLOTS} reference plots (each one is a copy for every collector).`,
  bad_assessor: 'The reference assessor must be a coordinator or a reviewer of the project whose account is not disabled.',
};

const bad = (reason: string) => ({ error: 'bad_request', reason });

/** Whether a person may be a reference assessor: a coordinator or a reviewer, not disabled. */
const canAssess = (m: Member) => (m.role === 'admin' || m.role === 'reviewer') && !m.disabled;

/** Whether the person has any record of the unit (first assessment or check, drafts too), from the project state. */
function recordsOf(state: ProjectState): (username: string, unit: string) => boolean {
  return (username, unit) => {
    const w = state.units.byOperator.get(username);
    return w !== undefined && (w.mainSubmitted.has(unit) || w.mainDrafts.has(unit) || w.checkSubmitted.has(unit) || w.checkDrafts.has(unit));
  };
}

/** What the figures say of the reference plots, for the page: everything for coordinators, no plot list for reviewers. */
function figuresOf(
  f: ServedReport | null,
  coordinator: boolean,
): (Omit<ReferenceFigures, 'byPlot' | 'people' | 'external'> &
  Partial<Pick<ReferenceFigures, 'byPlot' | 'people'>> & { external?: Partial<ExternalReferenceFigures>; computedAt: number; stale: boolean }) | null {
  if (!f) return null;
  const { byPlot, people, external, ...rest } = f.reference;
  // Reviewers: the figures per question only (Decision 3: no one's accuracy by name, no plot list).
  const ext = external && !coordinator ? (({ byPlot: _b, people: _p, ...e }) => e)(external) : external;
  return { ...rest, ...(coordinator ? { byPlot, people } : {}), ...(ext ? { external: ext } : {}), computedAt: f.computedAt, stale: f.stale };
}

/**
 * Reference plots (Task 14):
 * - `GET /v1/projects/:pid/reference` (coordinators and reviewers): the accuracy against the
 *   reference, per person and per question, from the quality figures (worked out when needed, as
 *   the Quality tab's other sections). Coordinators also get the reference plots, the divided
 *   files, who may be a reference assessor and each collector's copies; reviewers only the figures
 *   (they do not change the reference set, Decision 3). Collectors 403: nothing tells a collector
 *   which plots are reference plots.
 * - `POST /v1/projects/:pid/reference/plots` (coordinators) `{ csvFileId, assessorUserId, plots }`
 *   or `{ csvFileId, assessorUserId, random: N }`: marks plots of a divided file; the assessor holds
 *   them as main, every collector gets a copy (added in the same transaction), audited
 *   `reference.changed`.
 * - `POST /v1/projects/:pid/reference/remove` (coordinators) `{ plots: [{ csvFileId, plot }] }` or
 *   `{ all: true }`: unmarks them; copies whose holder has no record of the plot go, the others
 *   (and the assessor's plot) stay, so a check already made then counts as an ordinary check.
 */
/**
 * Brings a project's reference copies in line with its members now (referenceCopyPlan): run after a
 * role change, a member removed, an account disabled or enabled. Nothing is read beyond the
 * reference plots when the project has none; a failure is logged and never fails the change that
 * asked for it (the next mark, removal or plot list puts the copies right).
 */
export function referenceSyncer(store: Store, states: ProjectStateCache, now: () => number = Date.now) {
  return async (projectId: string, log: FastifyRequest['log']): Promise<void> => {
    try {
      const references = await store.listReferencePlots(projectId);
      if (references.length === 0) return;
      const { state, members } = await states.get(projectId, log, { fresh: true });
      const holdings = new Map<string, PlotAssignment[]>();
      await Promise.all([...new Set(references.map((r) => r.csvFileId))].map(async (id) => holdings.set(id, await store.listPlotAssignments(projectId, id))));
      const plan = referenceCopyPlan({ references, members, holdings, hasRecord: recordsOf(state) });
      if (plan.add.length + plan.drop.length === 0) return;
      await store.changeReferencePlots(projectId, { unmark: [], dropCopies: plan.drop, mark: [], addCopies: plan.add, at: now(), by: null });
    } catch (err) {
      log.error({ err, projectId }, 'reference plots: the copies could not be brought in line with the members');
    }
  };
}

export type ReferenceSync = ReturnType<typeof referenceSyncer>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Reference copies in line with the members (Task 14); absent in apps built without it. */
    referenceSync?: ReferenceSync;
  }
}

export async function registerReferenceRoutes(app: FastifyInstance, store: Store, quality: QualityService, states: ProjectStateCache, now: () => number = Date.now): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  /** The coordinator's view of the reference set, from the project state and the store. */
  async function view(projectId: string, request: FastifyRequest, figures: ServedReport | null, fresh = false) {
    const [served, references, answers] = await Promise.all([states.get(projectId, request.log, { fresh }), store.listReferencePlots(projectId), store.listReferenceAnswers(projectId)]);
    const { state, members } = served;
    const done = state.units.checksDone;
    const copyHolders = state.context.copyHolders;
    const filenames = new Map(state.files.map((f) => [f.id, f.filename]));
    const byPlot = new Map(figures?.reference.byPlot.map((p) => [p.plot, p]) ?? []);
    const has = recordsOf(state);
    const collectors = members.filter((m) => m.role === 'operator' && !m.disabled);
    const people = collectors.map((m) => {
      let copies = 0;
      let checked = 0;
      for (const r of references) {
        if (!copyHolders.get(r.plotKey)?.has(m.username)) continue;
        copies += 1;
        if (done.has(`${m.username}\n${r.plotKey}`)) checked += 1;
      }
      return { userId: m.userId, username: m.username, copies, checked };
    });
    const plots = references
      .map((r) => ({
        csvFileId: r.csvFileId,
        filename: filenames.get(r.csvFileId) ?? '',
        plot: r.plotKey,
        assessor: r.assessor,
        assessorUserId: r.assessorUserId,
        assessorInProject: members.some((m) => m.userId === r.assessorUserId),
        addedAt: r.addedAt,
        assessed: state.units.byOperator.get(r.assessor)?.mainSubmitted.has(r.plotKey) === true,
        started: has(r.assessor, r.plotKey),
        copies: copyHolders.get(r.plotKey)?.size ?? 0,
        checked: [...(copyHolders.get(r.plotKey) ?? [])].filter((u) => done.has(`${u}\n${r.plotKey}`)).length,
        measured: byPlot.get(r.plotKey)?.checks ?? null,
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename) || a.plot.localeCompare(b.plot, 'en', { numeric: true }));
    const counts = new Map<string, number>();
    for (const r of references) counts.set(r.csvFileId, (counts.get(r.csvFileId) ?? 0) + 1);
    return {
      max: MAX_REFERENCE_PLOTS,
      count: references.length,
      plots,
      files: state.files
        .filter((f) => f.distribution)
        .map((f) => ({ csvFileId: f.id, filename: f.filename, plots: state.context.fileUnits.get(f.id)?.length ?? f.plotCount, reference: counts.get(f.id) ?? 0 })),
      wholeFiles: state.files.filter((f) => !f.distribution).map((f) => ({ csvFileId: f.id, filename: f.filename })),
      assessors: members.filter(canAssess).map((m) => ({ userId: m.userId, username: m.username, role: m.role })),
      collectors: collectors.length,
      people,
      // The reference answers uploaded (a file of the coordinator's): how many plots, and when.
      external: { count: answers.length, uploadedAt: answers.length > 0 ? Math.max(...answers.map((a) => a.uploadedAt)) : null },
      asOf: served.stale ? state.builtAt : null,
    };
  }

  app.get('/v1/projects/:pid/reference', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const coordinator = request.membership!.role === 'admin';
    const figures = await served(quality, projectId, request, reply);
    if (!figures) return reply;
    if (!coordinator) {
      return reply.send({ coordinator: false, count: figures.reference.plots, figures: figuresOf(figures, false) });
    }
    return reply.send({ coordinator: true, ...(await view(projectId, request, figures)), figures: figuresOf(figures, true) });
  });

  // Reference answers from a file (coordinators): a CSV (text/csv: the plot id, then a column per
  // question) or a JSON array; replaces the set the project had. What did not match is answered.
  app.put('/v1/projects/:pid/reference/answers', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = request.body;
    if (!Buffer.isBuffer(body) && !Array.isArray(body)) {
      return reply.code(400).send(bad('send a CSV file (text/csv) or a JSON array of plots'));
    }
    const outline = await quality.outline(projectId, request.log);
    if (!outline) {
      return reply.code(409).send({ error: 'no_survey', reason: "Upload the project file first: the reference answers are matched to its survey's questions." });
    }
    const { state } = await states.get(projectId, request.log);
    const parsed = parseReferenceAnswers(body, outline, state.context.units, fileKeyCount(state.info));
    if (parsed.rows.length === 0) {
      return reply.code(400).send({
        ...bad('Nothing to keep: the file needs a header row, a plot id of the project in its first column and at least one column named as a question of the survey.'),
        ...parsed,
        rows: undefined,
      });
    }
    if (parsed.rows.length > MAX_REFERENCE_ANSWERS) {
      return reply.code(400).send(bad(`At most ${MAX_REFERENCE_ANSWERS} plots`));
    }
    await store.replaceReferenceAnswers(projectId, parsed.rows, now());
    await audit(store, request, 'reference.changed', { external: 'uploaded', plots: parsed.rows.length });
    const { rows, ...report } = parsed;
    return reply.send({ plots: rows.length, ...report });
  });

  app.delete('/v1/projects/:pid/reference/answers', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    await store.replaceReferenceAnswers(projectId, [], now());
    await audit(store, request, 'reference.changed', { external: 'deleted' });
    return reply.code(204).send();
  });

  /** The whole reference set after a change: every collector's copies added, those no longer wanted dropped. */
  function copiesAfter(state: ProjectState, members: readonly Member[], references: readonly ReferencePlot[], holdings: ReadonlyMap<string, readonly PlotAssignment[]>) {
    return referenceCopyPlan({ references, members, holdings, hasRecord: recordsOf(state) });
  }

  async function holdingsOf(projectId: string, fileIds: Iterable<string>): Promise<Map<string, PlotAssignment[]>> {
    const result = new Map<string, PlotAssignment[]>();
    await Promise.all([...new Set(fileIds)].map(async (id) => result.set(id, await store.listPlotAssignments(projectId, id))));
    return result;
  }

  app.post('/v1/projects/:pid/reference/plots', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { csvFileId?: unknown; assessorUserId?: unknown; plots?: unknown; random?: unknown };
    const csvFileId = typeof body.csvFileId === 'string' ? body.csvFileId : '';
    const assessorUserId = typeof body.assessorUserId === 'string' ? body.assessorUserId : '';
    const random = body.random;
    if (!isUuid(csvFileId)) return reply.code(400).send(bad('csvFileId is required'));
    if ((body.plots === undefined) === (random === undefined)) return reply.code(400).send(bad('give either plots (a list of plot ids) or random (how many to pick)'));
    if (random !== undefined && (!Number.isInteger(random) || (random as number) < 1 || (random as number) > MAX_PLOTS_PER_REQUEST)) {
      return reply.code(400).send(bad(`random must be a whole number from 1 to ${MAX_PLOTS_PER_REQUEST}`));
    }
    const listed = body.plots === undefined ? [] : parsePlotList(body.plots);
    if (listed === null) return reply.code(400).send(bad(`plots must be a list of at most ${MAX_PLOTS_PER_REQUEST} plot ids`));
    if (body.plots !== undefined && listed.length === 0) return reply.code(400).send(bad('plots is empty'));
    // The state as it is now: who assessed what is read from the latest records.
    const [{ state, members }, references] = await Promise.all([states.get(projectId, request.log, { fresh: true }), store.listReferencePlots(projectId)]);
    const assessor = members.find((m) => m.userId === assessorUserId);
    if (!assessor || !canAssess(assessor)) return reply.code(400).send({ ...bad(REASONS.bad_assessor), code: 'bad_assessor' });
    const file = state.files.find((f) => f.id === csvFileId);
    if (!file) return reply.code(404).send({ error: 'not_found' });
    const units = file.distribution ? (state.context.fileUnits.get(file.id) ?? []) : null;
    const inFiles = new Map<string, number>();
    for (const list of state.context.fileUnits.values()) for (const u of list) inFiles.set(u, (inFiles.get(u) ?? 0) + 1);
    const inOtherFile = (unit: string) => (inFiles.get(unit) ?? 0) > 1;
    const assessedByOthers = new Set<string>();
    for (const [operator, w] of state.units.byOperator) {
      if (operator === assessor.username) continue;
      for (const u of w.mainSubmitted.keys()) assessedByOthers.add(u);
      for (const u of w.mainDrafts) assessedByOthers.add(u);
    }
    const marked = new Set(references.filter((r) => r.csvFileId === csvFileId).map((r) => r.plotKey));
    let plots = units !== null ? splitListedPlots(listed, units) : listed;
    if (random !== undefined && units !== null) {
      // At random: plots nobody has a record of yet (any round, drafts too), not reference plots already.
      const touched = new Set<string>();
      for (const w of state.units.byOperator.values()) {
        for (const u of w.mainSubmitted.keys()) touched.add(u);
        for (const u of w.mainDrafts) touched.add(u);
        for (const u of w.checkSubmitted.keys()) touched.add(u);
        for (const u of w.checkDrafts) touched.add(u);
      }
      const isPlot = isPlotUnit(state.info);
      // First the plots whose main holder has never downloaded plots: no file of theirs on disk shows
      // the plot before it is marked. (When plots were dealt is not stored, so "not downloaded since
      // dealt" cannot be told; "never downloaded" is what is known.)
      const activity = await store.listMemberActivity(projectId);
      const downloaded = new Set(activity.filter((a) => a.lastPlotsDownloadAt != null).map((a) => members.find((m) => m.userId === a.userId)?.username));
      const unseen = (u: string) => holderList(state.context.mainHolders.get(u)).every((name) => !downloaded.has(name));
      plots = pickReference(units, (u) => isPlot(u) && !marked.has(u) && !touched.has(u) && !inOtherFile(u), random as number, randomInt(0, 2 ** 31), unseen);
      if (plots.length === 0) return reply.code(400).send({ ...bad('No plot of this file is free: every plot is assessed, started or a reference plot already.'), code: 'none_free' });
    }
    const refusal = checkMark({
      units,
      plots,
      info: state.info,
      inOtherFile,
      assessedByOthers,
      existing: references.length,
      already: plots.filter((p) => marked.has(p)).length,
    });
    if (refusal) return reply.code(400).send({ ...bad(REASONS[refusal.code]), code: refusal.code, ...(refusal.plots ? { plots: refusal.plots } : {}) });
    // The holdings as they will be once marked: the assessor holds each as main, everyone else a copy.
    const holdings = await holdingsOf(projectId, [csvFileId, ...references.map((r) => r.csvFileId)]);
    const chosen = new Set(plots);
    const list = holdings.get(csvFileId) ?? [];
    const after: PlotAssignment[] = list.filter((a) => !chosen.has(a.plotKey) || a.userId !== assessorUserId).map((a) => (chosen.has(a.plotKey) ? { plotKey: a.plotKey, userId: a.userId, overlap: true } : a));
    for (const p of plots) after.push({ plotKey: p, userId: assessorUserId, overlap: false });
    holdings.set(csvFileId, after);
    const at = now();
    const next: ReferencePlot[] = [
      ...references.filter((r) => r.csvFileId !== csvFileId || !chosen.has(r.plotKey)),
      ...plots.map((plotKey) => ({ csvFileId, plotKey, assessorUserId, assessor: assessor.username, addedAt: at, addedBy: request.membership!.userId ?? null })),
    ];
    const plan = copiesAfter(state, members, next, holdings);
    const result = await store.changeReferencePlots(projectId, {
      unmark: [],
      dropCopies: plan.drop,
      mark: plots.map((plotKey) => ({ csvFileId, plotKey, assessorUserId })),
      addCopies: plan.add,
      at,
      by: request.membership!.userId ?? null,
    });
    await audit(store, request, 'reference.changed', {
      csvFileId,
      added: result.marked,
      removed: 0,
      assessorUserId,
      random: random !== undefined,
      copiesAdded: result.copiesAdded,
      copiesDropped: result.copiesDropped,
    });
    return reply.send({ result, ...(await view(projectId, request, null, true)) });
  });

  app.post('/v1/projects/:pid/reference/remove', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { plots?: unknown; all?: unknown };
    const references = await store.listReferencePlots(projectId);
    let chosen: ReferencePlot[];
    if (body.all === true) {
      chosen = references;
    } else {
      const items = body.plots;
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_PLOTS_PER_REQUEST) {
        return reply.code(400).send(bad(`plots must be a list of 1 to ${MAX_PLOTS_PER_REQUEST} { csvFileId, plot }, or all: true`));
      }
      const wanted = new Set<string>();
      for (const item of items as unknown[]) {
        const i = item as { csvFileId?: unknown; plot?: unknown } | null;
        if (!i || typeof i.csvFileId !== 'string' || typeof i.plot !== 'string') return reply.code(400).send(bad('each plot is { csvFileId, plot }'));
        wanted.add(`${i.csvFileId}\n${i.plot}`);
      }
      chosen = references.filter((r) => wanted.has(`${r.csvFileId}\n${r.plotKey}`));
    }
    if (chosen.length === 0) return reply.send({ result: { unmarked: 0, marked: 0, copiesAdded: 0, copiesDropped: 0 }, ...(await view(projectId, request, null, true)) });
    const { state, members } = await states.get(projectId, request.log, { fresh: true });
    const has = recordsOf(state);
    const usernames = new Map(members.map((m) => [m.userId, m.username]));
    const holdings = await holdingsOf(projectId, references.map((r) => r.csvFileId));
    const gone = new Set(chosen.map((r) => `${r.csvFileId}\n${r.plotKey}`));
    // The copies of the plots unmarked whose holder has not made a record of them go; a check made stays.
    const drop = chosen.flatMap((r) =>
      (holdings.get(r.csvFileId) ?? [])
        .filter((a) => a.plotKey === r.plotKey && a.overlap && !has(usernames.get(a.userId) ?? '', r.plotKey))
        .map((a) => ({ csvFileId: r.csvFileId, plotKey: r.plotKey, userId: a.userId })),
    );
    // And the rest of the set kept in order (copies of collectors who joined, or no longer are).
    const plan = copiesAfter(
      state,
      members,
      references.filter((r) => !gone.has(`${r.csvFileId}\n${r.plotKey}`)),
      holdings,
    );
    const result = await store.changeReferencePlots(projectId, {
      unmark: chosen.map((r) => ({ csvFileId: r.csvFileId, plotKey: r.plotKey })),
      dropCopies: [...drop, ...plan.drop],
      mark: [],
      addCopies: plan.add,
      at: now(),
      by: request.membership!.userId ?? null,
    });
    const files = new Set(chosen.map((r) => r.csvFileId));
    await audit(store, request, 'reference.changed', {
      csvFileId: files.size === 1 ? [...files][0] : null,
      added: 0,
      removed: result.unmarked,
      copiesAdded: result.copiesAdded,
      copiesDropped: result.copiesDropped,
    });
    return reply.send({ result, ...(await view(projectId, request, null, true)) });
  });
}
