import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RoundInfo } from '../cep.js';
import { copyHoldersOf } from '../division.js';
import { assessesPlot, fastSecondsOf, patternFlags, type Flag } from '../flags.js';
import { plotIdsOf } from '../plotFileCache.js';
import { buildPlotIndex, filesOfUnit, searchPlots, unitIndex, unitsOfPlot, type PlotIndex, type PlotIndexFile } from '../plotSearch.js';
import type { PlotOutline } from '../plotShape.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { pairAt, pairFields, type Difference } from '../quality.js';
import { answerOptions } from '../qualityReports.js';
import { recordResolver } from '../quality.js';
import { remember, sha256, type Log, type QualityService, type ServedReport } from '../qualityService.js';
import { fileKeyCount, keyShape, recordKeysOfUnit, type Assessment } from '../rounds.js';
import type { Store } from '../store/store.js';
import type { RecordRow, ReferencePlot } from '../types.js';
import { PlotPlaceReader } from './plotPlaces.js';
import { copiesHeld, MAX_NAME, publicDecision, unnamedFlag } from './quality.js';

/**
 * Plot search (Task 8), for coordinators and reviewers (never collectors: a collector must not
 * see who else has a plot): GET /plots/search?q= finds plots by the id the coordinator sees,
 * from the plot files' parsed ids (an index per version of the files, kept); GET /plots/:plot
 * gives one plot: its files and who holds it, every record of it with its round and answers
 * (read by their keys: that plot's records only), the decision, its flags from the figures at
 * hand (QualityService.peek, never awaited: no computation is waited for here) and where it is.
 * Reviewers get the page trimmed (Decision 3): the files without who holds them, no deleted
 * records, no time the server received each.
 */

/** Projects whose index is kept (least recently used out first). */
export const MAX_CACHED_INDEXES = 4;
/** An index built while a plot file could not be read is served this long before it is built again. */
export const INDEX_RETRY_MS = 5000;

interface IndexEntry {
  version: string;
  index: PlotIndex;
  /** Set when a plot file could not be read: the index lacks its plots and is built again after the retry wait. */
  failedAt: number | null;
}

/** The project's plot index, built once per version of its files, survey keys and round. */
export class PlotIndexCache {
  private readonly entries = new Map<string, IndexEntry>();
  private readonly building = new Map<string, { version: string; promise: Promise<IndexEntry> }>();
  /** How many indexes were built (for tests). */
  built = 0;

  private readonly retryMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly places: PlotPlaceReader,
    options: { retryMs?: number; now?: () => number } = {},
  ) {
    this.retryMs = options.retryMs ?? INDEX_RETRY_MS;
    this.now = options.now ?? Date.now;
  }

  /** `partial`: a plot file could not be read, so the index lacks its plots. */
  async get(projectId: string, log: Log & FastifyRequest['log']): Promise<{ index: PlotIndex; info: RoundInfo | null; partial: boolean }> {
    const [info, files, facts] = await Promise.all([this.store.getRoundInfo(projectId), this.store.listCsvFiles(projectId), this.places.surveyFacts(projectId, log)]);
    const keyCount = fileKeyCount(info);
    const version = sha256(JSON.stringify([keyCount, facts.hidden, files.map((f) => [f.id, f.checksum, f.filename])]));
    const hit = this.entries.get(projectId);
    if (hit && hit.version === version && (hit.failedAt === null || this.now() - hit.failedAt < this.retryMs)) {
      remember(this.entries, projectId, hit, MAX_CACHED_INDEXES);
      return { index: hit.index, info, partial: hit.failedAt !== null };
    }
    const running = this.building.get(projectId);
    if (running && running.version === version) {
      const entry = await running.promise;
      return { index: entry.index, info, partial: entry.failedAt !== null };
    }
    const promise = (async (): Promise<IndexEntry> => {
      const read: PlotIndexFile[] = [];
      let failed = false;
      for (const meta of files) {
        try {
          const file = await this.store.getCsvFile(projectId, meta.id);
          if (file) read.push({ id: meta.id, filename: meta.filename, units: plotIdsOf(file, keyCount) });
        } catch (err) {
          failed = true;
          log.error({ err, csvFileId: meta.id }, 'plot search: could not read the plot file');
        }
      }
      this.built += 1;
      const shape = keyShape(info);
      const ownRound = info?.state === 'own' && shape.roundIndex !== null ? shape : null;
      return { version, index: buildPlotIndex(read, facts.hidden, ownRound), failedAt: failed ? this.now() : null };
    })();
    this.building.set(projectId, { version, promise });
    try {
      const entry = await promise;
      remember(this.entries, projectId, entry, MAX_CACHED_INDEXES);
      return { index: entry.index, info, partial: entry.failedAt !== null };
    } finally {
      if (this.building.get(projectId)?.promise === promise) this.building.delete(projectId);
    }
  }
}

type BadRequest = { error: 'bad_request'; reason: string };
const bad = (reason: string): BadRequest => ({ error: 'bad_request', reason });

/** One record of the plot as the page shows it. */
export interface PlotPageRecord {
  operator: string;
  recordKey: string;
  /** The round as the figures read it ("1", "2", a year...). */
  round: string;
  assessment: Assessment;
  submitted: boolean;
  deleted: boolean;
  modifiedOn: number;
  /** Coordinators only. */
  receivedAt?: number;
  /** Its answers to the questions listed (`questions`), as stored. */
  answers: Record<string, string>;
}

const ORDER: Record<Assessment, number> = { main: 0, check: 1, other: 2 };

export async function registerPlotSearchRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService,
  places: PlotPlaceReader,
  indexes: PlotIndexCache = new PlotIndexCache(store, places),
): Promise<void> {
  const reviewer = { preHandler: requireProjectMembership(store, 'reviewer') };

  async function search(request: FastifyRequest, reply: FastifyReply, q: string) {
    if (q.length > MAX_NAME) return reply.code(400).send(bad(`q must be at most ${MAX_NAME} characters`));
    const { projectId, role } = request.membership!;
    const { index } = await indexes.get(projectId, request.log);
    // Reviewers never find a reference plot (Task 14): which plots they are is the coordinators'.
    const hidden = role === 'admin' ? null : new Set((await store.listReferencePlots(projectId)).map((r) => r.plotKey));
    return reply.send(searchPlots(index, q, undefined, hidden && hidden.size > 0 ? (plot) => hidden.has(plot) : undefined));
  }

  async function page(request: FastifyRequest, reply: FastifyReply, plot: string) {
    if (!plot || plot.length > MAX_NAME) return reply.code(400).send(bad(`the plot must be 1-${MAX_NAME} characters`));
    const { projectId, role, userId } = request.membership!;
    const coordinator = role === 'admin';
    const { index, info } = await indexes.get(projectId, request.log);
    const u = unitIndex(index, plot);
    if (u < 0) return reply.code(404).send({ error: 'not_found', reason: 'no plot file of this project has this plot' });
    // A reference plot is no reviewer's (Task 14): its many checks would say which plots are reference plots.
    if (!coordinator && (await store.listReferencePlots(projectId)).some((r) => r.plotKey === plot)) {
      return reply.code(404).send({ error: 'not_found', reason: 'no plot file of this project has this plot' });
    }
    const files = filesOfUnit(index, u);

    // An own round: the plot's other rounds are units of their own, and a check may go to any of them.
    const units = unitsOfPlot(index, plot);
    const unitFiles = [...new Set(units.flatMap((unit) => filesOfUnit(index, unitIndex(index, unit)).map((f) => f.id)))];

    const [metas, members, assignments, holdings, rows, decisions, settings, outline, where, user, references] = await Promise.all([
      store.listCsvFiles(projectId),
      store.listMembers(projectId),
      store.listAssignments(projectId),
      store.listPlotHolders(projectId, unitFiles, units),
      store.listRecordsByKeys(projectId, recordKeysOfUnit(plot, info)),
      store.listQualityDecisions(projectId),
      store.getQualitySettings(projectId),
      quality.outline(projectId, request.log),
      places.places(projectId, [plot], request.log),
      userId ? store.getUserById(userId) : Promise.resolve(null),
      store.listReferencePlots(projectId),
    ]);
    // The figures at hand (peek, never awaited): the flags and the differing pairs come from them.
    let figures: ServedReport | null = null;
    try {
      figures = await quality.peek(projectId, request.log);
    } catch (err) {
      request.log.warn({ err, projectId }, 'plot page: the figures at hand could not be read');
    }

    // Who holds it: per file, the people given the whole file, or its holders in a divided file.
    const usernames = new Map(members.map((m) => [m.userId, m.username]));
    const divided = new Set(metas.filter((m) => m.distribution != null).map((m) => m.id));
    const sorted = (names: Iterable<string>) => [...new Set(names)].sort();
    const fileRows = files.map((f) => {
      const isDivided = divided.has(f.id);
      // Reviewers: the files only, not who holds the plot (Decision 3).
      if (!coordinator) return { id: f.id, filename: f.filename, divided: isDivided };
      const here = holdings.filter((h) => h.csvFileId === f.id && h.plotKey === plot && usernames.has(h.userId));
      return {
        id: f.id,
        filename: f.filename,
        divided: isDivided,
        main: isDivided ? sorted(here.filter((h) => !h.overlap).map((h) => usernames.get(h.userId)!)) : sorted(assignments.filter((a) => a.csvFileId === f.id).map((a) => a.username)),
        copies: isDivided ? sorted(here.filter((h) => h.overlap).map((h) => usernames.get(h.userId)!)) : [],
      };
    });

    // Its records, resolved as the figures pair them (the check of an own round may be another unit's).
    const copyHolders = copyHoldersOf(
      holdings.filter((h) => divided.has(h.csvFileId)),
      usernames,
    );
    const resolve = recordResolver({ info, units: new Set(units), copyHolders });
    const all: { row: RecordRow; round: string; assessment: Assessment }[] = [];
    for (const row of rows) {
      const { round, group } = resolve(row);
      if (group === plot) all.push({ row, round: round.round, assessment: round.assessment });
    }
    // A reviewer holding a copy of the plot (division, drawn, reference) checks it blind (Decision
    // 10): until their check is submitted the page is as for a plot that is not there.
    const holdsCopy = !coordinator && !!user && (copyHolders.get(plot)?.has(user.username) ?? false);
    if (holdsCopy && !all.some((m) => m.row.operator === user!.username && m.row.activelySaved && !m.row.deleted)) {
      return reply.code(404).send({ error: 'not_found', reason: 'no plot file of this project has this plot' });
    }
    // Reviewers: no deleted records (drafts stay: they are the queue's material).
    const mine = coordinator ? all : all.filter((m) => !m.row.deleted);
    mine.sort((a, b) => ORDER[a.assessment] - ORDER[b.assessment] || a.row.modifiedOn - b.row.modifiedOn || (a.row.operator < b.row.operator ? -1 : 1));

    // The questions answered, in the survey's order (those never compared, such as the keys and
    // the plot file's columns, left out), then any the survey does not have.
    const answered = new Set(mine.flatMap((m) => Object.keys(m.row.summary)));
    const keys: string[] = [];
    for (const q of outline?.values() ?? []) {
      if (!q.excluded && answered.has(q.key)) keys.push(q.key);
    }
    if (outline) {
      keys.push(...[...answered].filter((k) => !outline.has(k)).sort());
    } else {
      keys.push(...[...answered].sort());
    }
    const shown = new Set(keys);
    const records: PlotPageRecord[] = mine.map(({ row, round, assessment }) => ({
      operator: row.operator,
      recordKey: row.recordKey,
      round,
      assessment,
      submitted: row.activelySaved,
      deleted: row.deleted,
      modifiedOn: row.modifiedOn,
      ...(coordinator ? { receivedAt: row.receivedAt } : {}),
      answers: Object.fromEntries(Object.entries(row.summary).filter(([k]) => shown.has(k))),
    }));

    // The decision, and whether whoever decided assessed the plot (the 409's rule: assessesPlot).
    const operators = new Set(all.filter((m) => assessesPlot(m.row, m.assessment)).map((m) => m.row.operator));
    const decided = decisions.find((d) => d.plot === plot) ?? null;
    const decision = decided ? { ...publicDecision(decided), byAssessor: decided.decidedBy !== null && operators.has(decided.decidedBy) } : null;
    // A reviewer does not decide a plot they assessed (Decision 3); the decision route says so too.
    const ownPlot = !coordinator && !!user && (operators.has(user.username) || holdsCopy);

    // Its flags and differing pairs, from the figures at hand.
    let flags: Flag[] | null = null;
    let differences: (Difference & { changed?: boolean })[] | null = null;
    if (figures) {
      flags = patternFlags(figures, decisions, { fastSeconds: fastSecondsOf(settings), plot }).flags;
      // A reviewer: no reference plot nor copy they hold named as the previous or first plot (Decision 10).
      if (!coordinator) {
        const unnamed = new Set([...references.map((r) => r.plotKey), ...(userId ? await copiesHeld(store, projectId, userId, metas) : [])]);
        if (unnamed.size > 0) flags = flags.map((f) => unnamedFlag(f, unnamed));
      }
      differences = [];
      const pairs = figures.report.pairs;
      const byId = new Map(rows.map((r) => [`${r.recordKey}\u0000${r.operator}`, r]));
      for (let i = 0; i < pairs.plot.length; i++) {
        if (pairs.plot[i] !== plot) continue;
        const p = pairAt(pairs, i);
        const first = byId.get(`${p.first.recordKey}\u0000${p.first.operator}`);
        const check = byId.get(`${p.check.recordKey}\u0000${p.check.operator}`);
        const fields = first && check && !first.deleted && !check.deleted ? pairFields(first.summary, check.summary, outline, figures.margins ?? settings.margins ?? {}) : [];
        differences.push({ plot, first: p.first, check: p.check, fields, ...(fields.length === 0 ? { changed: true } : {}) });
      }
    }

    const labels: Record<string, string> = {};
    for (const key of keys) labels[key] = outline?.get(key)?.label ?? key;
    for (const d of differences ?? []) for (const f of d.fields) labels[f.key] ??= outline?.get(f.key)?.label ?? f.key;
    const place = where.places[0] ?? null;
    const outlineOf: PlotOutline = where.outline;
    return reply.send({
      plot,
      name: index.names[u],
      files: fileRows,
      records,
      questions: keys.map((key) => ({ key, label: labels[key] })),
      labels,
      options: answerOptions(outline, Object.keys(labels)),
      decision,
      ownPlot,
      // A reference plot (Task 14): its checks are measured against its reference assessment
      // ("Reference plots" on the Quality tab), never compared as a difference nor decided.
      reference: referenceOf(references, plot),
      flags,
      differences,
      figures: figures ? { computedAt: figures.computedAt, stale: figures.stale } : null,
      place: place ? { lat: place.lat, lon: place.lon, name: place.name } : null,
      outline: outlineOf,
      ...(where.unsupportedSrs ? { unsupportedSrs: where.unsupportedSrs } : {}),
    });
  }

  /** Whether the plot is a reference plot (null: no), with its assessor (only coordinators see a reference plot's page). */
  function referenceOf(references: readonly ReferencePlot[], plot: string): { assessor: string } | null {
    const r = references.find((x) => x.plotKey === plot);
    return r ? { assessor: r.assessor } : null;
  }

  // "/plots/search" with q searches; without it, it is the page of a plot named "search".
  app.get('/v1/projects/:pid/plots/search', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    const q = (request.query as { q?: unknown } | undefined)?.q;
    if (q === undefined) return page(request, reply, 'search');
    if (typeof q !== 'string') return reply.code(400).send(bad('q must be text'));
    return search(request, reply, q);
  });

  app.get('/v1/projects/:pid/plots/:plot', reviewer, async (request: FastifyRequest, reply: FastifyReply) => {
    return page(request, reply, (request.params as { plot: string }).plot);
  });
}
