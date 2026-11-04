import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from '../accountRules.js';
import { audit } from '../activity.js';
import type { RoundInfo } from '../cep.js';
import { attachment } from '../download.js';
import { checkUploadFits } from '../limits.js';
import { plotFileOf } from '../plotFileCache.js';
import { parsePlotFile } from '../plots.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Log } from '../qualityService.js';
import { fileKeyCount, unitOfRecord } from '../rounds.js';
import type { Store } from '../store/store.js';
import type { Question } from '../surveyOutline.js';
import {
  calibrationFigures,
  goldenFromConsensus,
  latestAnswers,
  learningScore,
  MAX_GOLDEN_NOTE,
  MAX_TRAINING_PLOTS,
  MAX_TRAINING_SETS,
  openAttempt,
  type Answered,
  type AttemptSnapshot,
  type LearningScore,
} from '../training.js';
import type { Member, TrainingAttempt, TrainingGolden, TrainingKind, TrainingSet } from '../types.js';
import { wholeFile } from './assignments.js';

/**
 * Training: calibration and learning plots (docs/plans/2026-11-04-calibration-and-learning-plots.md).
 * Coordinators manage the sets; every member sees their own (`/training/mine`). A set's plot file
 * is served to its participants in my-assignment (trainingAssignments) and from
 * `/training/:setId/content`; the records of its plots go to training_records (trainingUnits,
 * used by the record intake), never to the project's records.
 */

const KINDS: readonly TrainingKind[] = ['calibration', 'learning'];
const MAX_NAME = 200;

/** The name a set's file has in Collect Earth, by kind. */
export function servedName(set: Pick<TrainingSet, 'kind' | 'filename'>): string {
  return `${set.kind === 'learning' ? 'Learning' : 'Calibration'} – ${set.filename}`;
}

/** Every plot id (unit) of the project's training sets: the records of these go to training_records. */
export async function trainingUnits(store: Store, projectId: string): Promise<Set<string>> {
  const units = new Set<string>();
  for (const set of await store.listTrainingSets(projectId)) for (const plot of set.plotKeys) units.add(plot);
  return units;
}

/** The plot file entries of the sets a person takes part in, for my-assignment. */
export async function trainingAssignments(store: Store, projectId: string, userId: string, info: RoundInfo | null, base: string) {
  const out: {
    csvFileId: string;
    filename: string;
    checksum: string;
    plotCount: number;
    downloadPath: string;
    downloadUrl: string | null;
    training: { kind: TrainingKind; attempt: number; freshSince: number | null };
  }[] = [];
  for (const meta of await store.listTrainingSets(projectId)) {
    if (!meta.memberIds.includes(userId)) continue;
    const set = await store.getTrainingSet(projectId, meta.id);
    if (!set) continue;
    const served = wholeFile(set, info);
    const attempt = openAttempt(await store.listTrainingAttempts(projectId, set.id), userId);
    const path = `/v1/projects/${projectId}/training/${set.id}/content?v=${served.checksum}`;
    out.push({
      csvFileId: set.id,
      filename: servedName(set),
      checksum: served.checksum,
      plotCount: served.plotCount,
      downloadPath: path,
      downloadUrl: base ? `${base}${path}` : null,
      // From attempt 2 on, Collect Earth starts the plots afresh: its records saved before go.
      training: { kind: set.kind, attempt: attempt.number, freshSince: attempt.number > 1 ? attempt.startedAt : null },
    });
  }
  return out;
}

/** Why a set's plots cannot be training plots: in a plot file, in another set, or with production records. */
async function plotClash(store: Store, projectId: string, plots: readonly string[], info: RoundInfo | null, exceptSet?: string) {
  const wanted = new Set(plots);
  const keyCount = fileKeyCount(info);
  for (const meta of await store.listCsvFiles(projectId)) {
    const file = await store.getCsvFile(projectId, meta.id);
    if (!file) continue;
    const clash = plotFileOf(file, keyCount).plotIds.filter((id) => wanted.has(id));
    if (clash.length > 0) return { code: 'in_plot_file', plots: clash.slice(0, 20), file: meta.filename };
  }
  for (const set of await store.listTrainingSets(projectId)) {
    if (set.id === exceptSet) continue;
    const clash = set.plotKeys.filter((id) => wanted.has(id));
    if (clash.length > 0) return { code: 'in_other_set', plots: clash.slice(0, 20), file: set.name };
  }
  const withRecords = new Set<string>();
  for (const r of await store.listRecordStates(projectId)) {
    const unit = unitOfRecord(r.recordKey, wanted, info);
    if (unit !== null) withRecords.add(unit);
  }
  if (withRecords.size > 0) return { code: 'has_records', plots: [...withRecords].slice(0, 20), file: null };
  return null;
}

const REASONS: Record<string, string> = {
  in_plot_file: 'Some plots of this file are in a plot file of the project: training plots must be plots of their own.',
  in_other_set: 'Some plots of this file are in another training set.',
  has_records: 'Some plots of this file already have records in the project.',
};

/** The participants as people: user id, username (records go by it). */
function participants(set: TrainingSet, members: readonly Member[]) {
  const byId = new Map(members.map((m) => [m.userId, m]));
  return set.memberIds.flatMap((id) => {
    const m = byId.get(id);
    return m ? [{ userId: id, username: m.username, role: m.role }] : [];
  });
}

/** Everything one set's figures need, read once. */
async function loadSet(store: Store, projectId: string, setId: string, outline: (projectId: string, log: Log) => Promise<ReadonlyMap<string, Question> | null>, log: Log) {
  const set = await store.getTrainingSet(projectId, setId);
  if (!set) return null;
  const [members, records, golden, attempts, info, settings, survey] = await Promise.all([
    store.listMembers(projectId),
    store.listTrainingRecords(projectId),
    store.listTrainingGolden(projectId, setId),
    store.listTrainingAttempts(projectId, setId),
    store.getRoundInfo(projectId),
    store.getQualitySettings(projectId),
    outline(projectId, log),
  ]);
  const people = participants(set, members);
  const startOf = new Map(people.map((p) => [p.username, openAttempt(attempts, p.userId)]));
  // Each person's latest submitted record in their open attempt.
  const answers = latestAnswers(records, set.plotKeys, info, (operator) => startOf.get(operator)?.startedAt ?? 0);
  return {
    set,
    people,
    records,
    golden: new Map(golden.map((g) => [g.plotKey, g])),
    attempts,
    info,
    margins: settings.margins ?? {},
    outline: survey,
    answers,
    startOf,
  };
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadSet>>>;

/** One person's score in their open attempt. */
function scoreOf(loaded: Loaded, username: string): LearningScore {
  const mine = new Map<string, Answered>();
  for (const [plot, byPerson] of loaded.answers) {
    const a = byPerson.get(username);
    if (a) mine.set(plot, a);
  }
  return learningScore({ plots: loaded.set.plotKeys, golden: loaded.golden, answers: mine, outline: loaded.outline, margins: loaded.margins, passMark: loaded.set.passMark });
}

/** A closed attempt as listed: its number, dates and score figures (no answers). */
function history(attempts: readonly TrainingAttempt[], userId: string) {
  return attempts
    .filter((a) => a.userId === userId && a.results !== null)
    .sort((a, b) => a.number - b.number)
    .map((a) => {
      const snap = a.results as Partial<AttemptSnapshot>;
      const score = snap.score;
      return {
        number: a.number,
        startedAt: a.startedAt,
        closedAt: snap.closedAt ?? null,
        plots: score?.plots ?? 0,
        submitted: score?.submitted ?? 0,
        answers: score?.answers ?? { compared: 0, agreeing: 0, rate: null },
        plotsRight: score?.plotsRight ?? 0,
        passed: score?.passed ?? null,
      };
    });
}

/** The questions a golden answer can be given for: those compared, with their options. */
function goldenQuestions(outline: ReadonlyMap<string, Question> | null) {
  if (!outline) return [];
  return [...outline.values()]
    .filter((q) => !q.excluded && !q.calculated && (q.kind === 'choice' || q.kind === 'number'))
    .map((q) => ({ key: q.key, label: q.label, kind: q.kind, options: q.options ?? null, multiple: q.multiple }));
}

function summaryOf(set: TrainingSet, people: ReturnType<typeof participants>) {
  return {
    id: set.id,
    kind: set.kind,
    name: set.name,
    filename: set.filename,
    servedName: servedName(set),
    plotCount: set.plotCount,
    passMark: set.passMark,
    createdAt: set.createdAt,
    participants: people,
  };
}

function bad(reply: FastifyReply, reason: string, code = 'bad_request', extra: Record<string, unknown> = {}) {
  return reply.code(400).send({ error: 'bad_request', code, reason, ...extra });
}

function readPassMark(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : undefined;
}

export async function registerTrainingRoutes(
  app: FastifyInstance,
  store: Store,
  deps: { outline: (projectId: string, log: Log) => Promise<ReadonlyMap<string, Question> | null>; now?: () => number },
): Promise<void> {
  const now = deps.now ?? Date.now;
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const member = { preHandler: requireProjectMembership(store) };
  const setIdOf = (request: FastifyRequest) => (request.params as { setId: string }).setId;

  // The project's sets, with each participant's progress in their open attempt (coordinators).
  app.get('/v1/projects/:pid/training', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const [sets, members] = await Promise.all([store.listTrainingSets(projectId), store.listMembers(projectId)]);
    const out = [];
    for (const meta of sets) {
      const loaded = await loadSet(store, projectId, meta.id, deps.outline, request.log);
      if (!loaded) continue;
      out.push({
        ...summaryOf(loaded.set, loaded.people),
        golden: loaded.golden.size,
        progress: loaded.people.map((p) => {
          let submitted = 0;
          for (const byPerson of loaded.answers.values()) if (byPerson.has(p.username)) submitted += 1;
          const score = loaded.set.kind === 'learning' ? scoreOf(loaded, p.username) : null;
          return { userId: p.userId, attempt: loaded.startOf.get(p.username)!.number, submitted, accuracy: score?.answers.rate ?? null, passed: score?.passed ?? null };
        }),
      });
    }
    return reply.send({ sets: out, members: members.filter((m) => !m.disabled).map((m) => ({ userId: m.userId, username: m.username, role: m.role })), max: MAX_TRAINING_SETS });
  });

  // A new set: PUT the CSV with ?kind=&name=&passMark= (coordinators).
  app.put('/v1/projects/:pid/training-sets/:filename', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const filename = (request.params as { filename: string }).filename;
    if (!filename || /[/\\\0]/.test(filename) || filename.includes('..')) return bad(reply, 'invalid filename');
    const q = (request.query ?? {}) as { kind?: string; name?: string; passMark?: string };
    const kind = (q.kind ?? 'calibration') as TrainingKind;
    if (!KINDS.includes(kind)) return bad(reply, 'kind must be calibration or learning');
    const name = (q.name ?? filename.replace(/\.csv$/i, '')).trim();
    if (name.length === 0 || name.length > MAX_NAME) return bad(reply, `name must be 1-${MAX_NAME} characters`);
    const passMark = readPassMark(q.passMark);
    if (passMark === undefined && q.passMark !== undefined) return bad(reply, 'passMark must be a whole number from 0 to 100');
    const data = request.body;
    if (!Buffer.isBuffer(data) || data.length === 0) return bad(reply, 'expected a non-empty CSV body');
    const over = await checkUploadFits(store, projectId, { kind: 'csv', filename: `training/${filename}` }, data.length);
    if (over) return reply.code(413).send(over);
    if ((await store.listTrainingSets(projectId)).length >= MAX_TRAINING_SETS) return bad(reply, `A project can have at most ${MAX_TRAINING_SETS} training sets.`, 'too_many_sets');
    const info = await store.getRoundInfo(projectId);
    const plots = parsePlotFile(data, fileKeyCount(info)).plotIds;
    if (plots.length === 0) return bad(reply, 'This file has no plots: only a header row, or no row with a number in it.', 'no_plots');
    if (plots.length > MAX_TRAINING_PLOTS) return bad(reply, `A training set can have at most ${MAX_TRAINING_PLOTS} plots.`, 'too_many_plots');
    const clash = await plotClash(store, projectId, plots, info);
    if (clash) return reply.code(409).send({ error: 'training_plot_clash', code: clash.code, reason: REASONS[clash.code], plots: clash.plots, file: clash.file });
    const set = await store.createTrainingSet(projectId, {
      kind,
      name,
      filename,
      data,
      plotKeys: plots,
      passMark: passMark ?? null,
      memberIds: [],
      createdBy: request.userId ?? null,
      at: now(),
    });
    await audit(store, request, 'training.changed', { setId: set.id, change: 'created', name: set.name, kind: set.kind, plots: set.plotCount });
    return reply.code(201).send(summaryOf(set, []));
  });

  // Name, kind, pass mark (coordinators).
  app.patch('/v1/projects/:pid/training/:setId', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { name?: unknown; kind?: unknown; passMark?: unknown };
    const change: { name?: string; kind?: TrainingKind; passMark?: number | null } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > MAX_NAME) return bad(reply, `name must be 1-${MAX_NAME} characters`);
      change.name = body.name.trim();
    }
    if (body.kind !== undefined) {
      if (!KINDS.includes(body.kind as TrainingKind)) return bad(reply, 'kind must be calibration or learning');
      change.kind = body.kind as TrainingKind;
    }
    if (body.passMark !== undefined) {
      const pm = readPassMark(body.passMark);
      if (pm === undefined) return bad(reply, 'passMark must be a whole number from 0 to 100, or null');
      change.passMark = pm;
    }
    const set = await store.updateTrainingSet(projectId, setIdOf(request), change);
    if (!set) return reply.code(404).send({ error: 'not_found' });
    await audit(store, request, 'training.changed', { setId: set.id, change: 'changed', name: set.name, kind: set.kind });
    return reply.send(summaryOf(set, participants(set, await store.listMembers(projectId))));
  });

  app.delete('/v1/projects/:pid/training/:setId', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const set = await store.getTrainingSet(projectId, setIdOf(request));
    if (!set || !(await store.deleteTrainingSet(projectId, set.id))) return reply.code(404).send({ error: 'not_found' });
    await audit(store, request, 'training.changed', { setId: set.id, change: 'deleted', name: set.name, kind: set.kind });
    return reply.send({ ok: true });
  });

  // The participants (coordinators): members of the project, any role.
  app.put('/v1/projects/:pid/training/:setId/members', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const ids = (request.body as { userIds?: unknown } | null)?.userIds;
    if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string' && isUuid(id))) return bad(reply, 'userIds must be a list of user ids');
    const members = new Set((await store.listMembers(projectId)).map((m) => m.userId));
    if (!ids.every((id) => members.has(id))) return bad(reply, 'Everyone taking part must be a member of the project.', 'not_member');
    const set = await store.getTrainingSet(projectId, setIdOf(request));
    if (!set) return reply.code(404).send({ error: 'not_found' });
    await store.setTrainingMembers(projectId, set.id, ids, now());
    await audit(store, request, 'training.changed', { setId: set.id, change: 'members', name: set.name, people: new Set(ids).size });
    return reply.send({ ok: true });
  });

  // One set in full (coordinators): calibration figures, golden answers, scores and attempts.
  app.get('/v1/projects/:pid/training/:setId', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const loaded = await loadSet(store, projectId, setIdOf(request), deps.outline, request.log);
    if (!loaded) return reply.code(404).send({ error: 'not_found' });
    const calibration = calibrationFigures({
      plots: loaded.set.plotKeys,
      answers: loaded.answers,
      participants: loaded.people.map((p) => p.username),
      outline: loaded.outline,
      margins: loaded.margins,
    });
    return reply.send({
      set: summaryOf(loaded.set, loaded.people),
      plots: loaded.set.plotKeys,
      calibration,
      golden: [...loaded.golden.values()],
      questions: goldenQuestions(loaded.outline),
      scores: loaded.people.map((p) => ({
        userId: p.userId,
        username: p.username,
        attempt: loaded.startOf.get(p.username),
        score: scoreOf(loaded, p.username),
        history: history(loaded.attempts, p.userId),
      })),
    });
  });

  // The golden interpretation of one plot (coordinators): { answers, note }.
  app.put('/v1/projects/:pid/training/:setId/golden/:plot', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const plot = (request.params as { plot: string }).plot;
    const body = (request.body ?? {}) as { answers?: unknown; note?: unknown };
    const set = await store.getTrainingSet(projectId, setIdOf(request));
    if (!set) return reply.code(404).send({ error: 'not_found' });
    if (!set.plotKeys.includes(plot)) return bad(reply, 'This plot is not in the set.', 'unknown_plot');
    const answers = body.answers ?? {};
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers) || !Object.values(answers).every((v) => typeof v === 'string' && v.length <= 1000)) {
      return bad(reply, 'answers must map question keys to answers');
    }
    if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > MAX_GOLDEN_NOTE)) {
      return bad(reply, `note must be at most ${MAX_GOLDEN_NOTE} characters`);
    }
    const clean = Object.fromEntries(Object.entries(answers as Record<string, string>).filter(([, v]) => v.trim() !== ''));
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;
    const row: TrainingGolden = { plotKey: plot, answers: clean, note, updatedAt: now(), updatedBy: request.userId ?? null };
    await store.putTrainingGolden(projectId, set.id, [row]);
    return reply.send(row);
  });

  // Golden answers for every plot at once (coordinators): from the calibration's agreed answers, or one person's records.
  app.post('/v1/projects/:pid/training/:setId/golden', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { from?: unknown; userId?: unknown };
    const loaded = await loadSet(store, projectId, setIdOf(request), deps.outline, request.log);
    if (!loaded) return reply.code(404).send({ error: 'not_found' });
    let rows: { plotKey: string; answers: Record<string, string> }[];
    if (body.from === 'consensus') {
      rows = goldenFromConsensus(
        calibrationFigures({ plots: loaded.set.plotKeys, answers: loaded.answers, participants: loaded.people.map((p) => p.username), outline: loaded.outline, margins: loaded.margins }),
      );
    } else if (body.from === 'person' && typeof body.userId === 'string') {
      const person = (await store.listMembers(projectId)).find((m) => m.userId === body.userId);
      if (!person) return bad(reply, 'No such member.', 'not_member');
      // Their latest submitted records, whatever the attempt (an expert's assessment).
      const theirs = latestAnswers(loaded.records, loaded.set.plotKeys, loaded.info);
      rows = loaded.set.plotKeys.flatMap((plot) => {
        const a = theirs.get(plot)?.get(person.username);
        return a ? [{ plotKey: plot, answers: { ...a.summary } }] : [];
      });
    } else return bad(reply, "from must be 'consensus', or 'person' with a userId");
    const at = now();
    // The coordinator's explanations stay.
    await store.putTrainingGolden(
      projectId,
      loaded.set.id,
      rows.map((r) => ({ ...r, note: loaded.golden.get(r.plotKey)?.note ?? null, updatedAt: at, updatedBy: request.userId ?? null })),
    );
    await audit(store, request, 'training.changed', { setId: loaded.set.id, change: 'golden', name: loaded.set.name, plots: rows.length });
    return reply.send({ plots: rows.length });
  });

  // New attempts (coordinators): { userIds } or { all: true }. Each open attempt is closed with its score.
  app.post('/v1/projects/:pid/training/:setId/attempts', admin, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const body = (request.body ?? {}) as { userIds?: unknown; all?: unknown };
    const loaded = await loadSet(store, projectId, setIdOf(request), deps.outline, request.log);
    if (!loaded) return reply.code(404).send({ error: 'not_found' });
    let people = loaded.people;
    if (body.all !== true) {
      if (!Array.isArray(body.userIds) || !body.userIds.every((id) => typeof id === 'string')) return bad(reply, 'give userIds or all: true');
      const wanted = new Set(body.userIds as string[]);
      people = people.filter((p) => wanted.has(p.userId));
    }
    const at = now();
    await store.startTrainingAttempts(
      projectId,
      loaded.set.id,
      people.map((p) => ({ userId: p.userId, results: { score: scoreOf(loaded, p.username), closedAt: at } satisfies AttemptSnapshot })),
      at,
    );
    await audit(store, request, 'training.changed', { setId: loaded.set.id, change: 'attempts', name: loaded.set.name, people: people.length });
    return reply.send({ started: people.length });
  });

  // A participant's own sets: progress, and for learning sets their answers next to the golden ones.
  app.get('/v1/projects/:pid/training/mine', member, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const userId = request.userId;
    if (!userId) return reply.send({ sets: [] });
    const out = [];
    for (const meta of await store.listTrainingSets(projectId)) {
      if (!meta.memberIds.includes(userId)) continue;
      const loaded = await loadSet(store, projectId, meta.id, deps.outline, request.log);
      const me = loaded?.people.find((p) => p.userId === userId);
      if (!loaded || !me) continue;
      let submitted = 0;
      for (const byPerson of loaded.answers.values()) if (byPerson.has(me.username)) submitted += 1;
      const base = {
        id: loaded.set.id,
        kind: loaded.set.kind,
        name: loaded.set.name,
        servedName: servedName(loaded.set),
        plotCount: loaded.set.plotCount,
        passMark: loaded.set.passMark,
        attempt: loaded.startOf.get(me.username),
        submitted,
      };
      if (loaded.set.kind !== 'learning') {
        // A calibration: no one's answers (each assesses on their own) and no golden ones yet.
        out.push(base);
        continue;
      }
      const score = scoreOf(loaded, me.username);
      out.push({
        ...base,
        score: { ...score, byPlot: score.byPlot.map((p) => ({ ...p, note: loaded.golden.get(p.plot)?.note ?? null })) },
        history: history(loaded.attempts, userId),
      });
    }
    return reply.send({ sets: out });
  });

  // A set's plot file as Collect Earth gets it (participants and coordinators).
  app.get('/v1/projects/:pid/training/:setId/content', member, async (request, reply) => {
    const projectId = request.membership!.projectId;
    const set = await store.getTrainingSet(projectId, setIdOf(request));
    const allowed = set && (request.membership!.role === 'admin' || (request.userId !== undefined && set.memberIds.includes(request.userId)));
    if (!set || !allowed) return reply.code(404).send({ error: 'not_found' });
    const served = wholeFile(set, await store.getRoundInfo(projectId));
    const expected = (request.query as { v?: string } | undefined)?.v;
    if (expected && expected !== served.checksum) {
      return reply.code(409).send({ error: 'changed', reason: 'This plot file changed after the list of your plot files was read. Press Refresh to get the new list, then download it again.' });
    }
    return reply
      .header('content-type', 'text/csv')
      .header('x-checksum-sha256', served.checksum)
      .header('content-disposition', attachment(servedName(set)))
      .send(served.data);
  });
}

/** For the record intake: whether a record belongs to a training plot. */
export function isTrainingRecord(recordKey: string, units: ReadonlySet<string>, info: RoundInfo | null): boolean {
  return units.size > 0 && unitOfRecord(recordKey, units, info) !== null;
}

