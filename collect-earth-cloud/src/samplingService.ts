import { copyHoldersOf } from './division.js';
import { isPlotUnit } from './progress.js';
import type { ProjectStateCache, ProjectState } from './projectState.js';
import type { Log } from './qualityService.js';
import { keyShape, splitKey } from './rounds.js';
import { checkersOf, coreOf, drawChecks, notBlindCheckers, samplingActive, type DrawFile, type DrawInput, type DrawResult } from './sampling.js';
import type { Store } from './store/store.js';
import type { CsvFile, Member, PlotAssignment, SampledCopy, SamplingDraw, SamplingRule, SamplingState } from './types.js';

/** At most one automatic draw per project in this long. */
export const SAMPLING_INTERVAL_MS = 10 * 60_000;
/**
 * How long a request (records:batch, my-assignment) waits for the automatic draw it started
 * before answering; the draw goes on after it (and its copies are stored in one transaction,
 * whole or not at all).
 */
export const SAMPLING_INLINE_MS = 5_000;

/** Everything a draw (or the Checks section's preview) works from. */
interface Loaded {
  sampling: SamplingState;
  state: ProjectState;
  members: Member[];
  divided: CsvFile[];
  holdings: Map<string, PlotAssignment[]>;
  input: DrawInput | null;
}

export interface DrawOutcome {
  draw: SamplingDraw;
  copies: SampledCopy[];
}

/**
 * The check sampling's side effects: loading what a draw needs (the Progress pages' project
 * state, read fresh, and the divided files' holdings as stored now), storing the copies, the
 * audit, and when automatic draws run.
 *
 * **When:** a records:batch that stored a first submission (`afterSubmission`) marks a draw
 * due and claims it when the last automatic one is at least 10 minutes old (one statement,
 * `claimSamplingDraw`: across server instances too); my-assignment (`runIfDue`) claims a due
 * one the same way, so a draw put off by the 10 minutes is made at the latest when someone
 * next asks for their plot files, a checker's Refresh included. The claiming request waits
 * for the draw up to SAMPLING_INLINE_MS before answering: Cloud Run gives a request's CPU
 * only until its answer, so nothing is left to run after it.
 */
export class SamplingService {
  /** The draw running (or waited for) last per project: an automatic draw joins it, "Draw now" waits for it. */
  private readonly running = new Map<string, Promise<DrawOutcome | null>>();
  private readonly now: () => number;
  readonly intervalMs: number;
  private readonly inlineMs: number;

  constructor(
    private readonly store: Store,
    private readonly states: ProjectStateCache,
    options: { now?: () => number; intervalMs?: number; inlineMs?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.intervalMs = options.intervalMs ?? SAMPLING_INTERVAL_MS;
    this.inlineMs = options.inlineMs ?? SAMPLING_INLINE_MS;
  }

  /** After a records:batch stored a first submission: due, and drawn now unless one was made in the last interval. */
  async afterSubmission(projectId: string, log: Log): Promise<void> {
    await this.automatic(projectId, log, true);
  }

  /** Before my-assignment answers: a due draw is made once the interval since the last one is over. */
  async runIfDue(projectId: string, log: Log): Promise<void> {
    await this.automatic(projectId, log, false);
  }

  /** The claim and the draw, waited for at most `inlineMs` together; never throws. */
  private async automatic(projectId: string, log: Log, markDue: boolean): Promise<void> {
    const work = (async () => {
      const claimed = await this.store.claimSamplingDraw(projectId, { now: this.now(), markDue, minIntervalMs: this.intervalMs });
      if (claimed) await this.draw(projectId, 'automatic', log);
    })().catch((err: unknown) => log.error({ err, projectId }, 'check sampling: the automatic draw failed (it stays due)'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, this.inlineMs)))]);
    clearTimeout(timer);
  }

  /**
   * Draws now (`by` the coordinator who pressed "Draw now", null for a project token; or
   * automatic). An automatic draw joins one running on this server; "Draw now" waits for it to
   * end and then makes its own (the store's lock covers other servers). Null when the rule draws
   * nothing (none, or both parts off). Audited as `sampling.drawn` when pressed, always, and when
   * an automatic draw added copies.
   */
  draw(projectId: string, by: { userId: string | null } | 'automatic', log: Log): Promise<DrawOutcome | null> {
    const current = this.running.get(projectId);
    if (by === 'automatic' && current) return current;
    const run = (current ?? Promise.resolve(null)).catch(() => null).then(() => this.drawOnce(projectId, by, log));
    this.running.set(projectId, run);
    run.then(
      () => this.running.get(projectId) === run && this.running.delete(projectId),
      () => this.running.get(projectId) === run && this.running.delete(projectId),
    );
    return run;
  }

  private async drawOnce(projectId: string, by: { userId: string | null } | 'automatic', log: Log): Promise<DrawOutcome | null> {
    // Marks of a due draw up to now are in the fresh state read below (their records were stored
    // before the mark); a later mark keeps the draw due (addSampledCopies).
    const readAt = this.now();
    const loaded = await this.load(projectId, log, true);
    if (!loaded.input) return null;
    const result = drawChecks(loaded.input);
    const at = this.now();
    const automatic = by === 'automatic';
    const byUserId = automatic ? null : by.userId;
    const draw: SamplingDraw = { at, byUserId, automatic, drawn: 0, firstN: 0, percent: 0, noChecker: result.noChecker };
    const copies = await this.store.addSampledCopies(projectId, result.copies, result.drop, draw, readAt);
    const stored = { ...draw, drawn: copies.length, firstN: copies.filter((c) => c.reason === 'firstN').length, percent: copies.filter((c) => c.reason === 'percent').length };
    if (!automatic || copies.length > 0) {
      try {
        await this.store.appendAudit(projectId, {
          actorUserId: byUserId,
          action: 'sampling.drawn',
          details: {
            automatic: stored.automatic,
            drawn: stored.drawn,
            firstN: stored.firstN,
            percent: stored.percent,
            noChecker: stored.noChecker,
            replaced: result.drop.length,
            checkers: new Set(copies.map((c) => c.userId)).size,
          },
        });
      } catch (err) {
        log.error({ err, projectId }, 'audit log write failed');
      }
    }
    return { draw: stored, copies };
  }

  /** What the Checks section shows: the rule, the last draw, what a draw now would add, the files and each person's checks. */
  async view(projectId: string, log: Log): Promise<SamplingView> {
    const { sampling, state, members, divided, holdings, input } = await this.load(projectId, log, false);
    const preview: DrawResult = input ? drawChecks(input) : { copies: [], drop: [], noChecker: 0 };
    const usernames = new Map(members.map((m) => [m.userId, m.username]));
    const rule = sampling.rule;
    const subs = submittedOf(state);
    const reference = state.context.reference;
    const files = divided.map((f) => {
      const held = holdings.get(f.id) ?? [];
      const units = state.context.fileUnits.get(f.id) ?? [];
      const own = rule?.files[f.id];
      return {
        csvFileId: f.id,
        filename: f.filename,
        use: (own?.use ?? 'project') as 'project' | 'off' | 'own',
        own: own?.use === 'own' ? { checkers: own.checkers, firstN: own.firstN, percent: own.percent } : null,
        plots: units.length,
        submitted: units.filter((u) => subs.has(u)).length,
        sampledCopies: held.filter((a) => a.overlap && a.sampledAt !== undefined).length,
        divisionCopies: held.filter((a) => a.overlap && a.sampledAt === undefined && !reference.has(a.plotKey)).length,
        referenceCopies: held.filter((a) => a.overlap && reference.has(a.plotKey)).length,
        pending: preview.copies.filter((c) => c.csvFileId === f.id).length,
      };
    });
    // Each person's checks: copies held in the divided files, done (their check submitted), of them
    // drawn. Reference copies (every collector has them) are not counted: they are no check load.
    const people = new Map<string, { open: number; done: number; sampled: number }>();
    for (const list of holdings.values()) {
      for (const a of list) {
        if (!a.overlap || reference.has(a.plotKey)) continue;
        const username = usernames.get(a.userId);
        if (username === undefined) continue;
        const p = people.get(a.userId) ?? { open: 0, done: 0, sampled: 0 };
        if (state.units.checksDone.has(`${username}\n${a.plotKey}`)) p.done += 1;
        else p.open += 1;
        if (a.sampledAt !== undefined) p.sampled += 1;
        people.set(a.userId, p);
      }
    }
    const eligible = new Set(checkersOf(rule ?? { checkers: null, firstN: null, percent: null }, members).map((m) => m.userId));
    const checkers = members
      .filter((m) => eligible.has(m.userId) || people.has(m.userId))
      .map((m) => ({ userId: m.userId, username: m.username, role: m.role, eligible: eligible.has(m.userId), disabled: m.disabled === true, ...(people.get(m.userId) ?? { open: 0, done: 0, sampled: 0 }) }))
      .sort((a, b) => a.username.localeCompare(b.username));
    const lastDraw = sampling.lastDraw ? { ...sampling.lastDraw, by: sampling.lastDraw.byUserId ? usernames.get(sampling.lastDraw.byUserId) ?? null : null } : null;
    const due = sampling.dueSince !== null && samplingActive(rule);
    // Reviewers and coordinators chosen as checkers can read the first assessments (Decision 10).
    const notBlind = notBlindCheckers(rule, members);
    return {
      rule,
      active: samplingActive(rule),
      intervalMinutes: Math.round(this.intervalMs / 60_000),
      due,
      dueSince: due ? sampling.dueSince : null,
      nextAutomaticAt: due ? Math.max(sampling.dueSince!, (sampling.lastAutoDrawAt ?? 0) + this.intervalMs) : null,
      lastDraw,
      lastCheckedAt: sampling.lastCheckedAt,
      pending: {
        drawn: preview.copies.length,
        firstN: preview.copies.filter((c) => c.reason === 'firstN').length,
        percent: preview.copies.filter((c) => c.reason === 'percent').length,
        noChecker: preview.noChecker,
      },
      files,
      wholeFiles: state.files.filter((f) => !f.distribution).map((f) => ({ csvFileId: f.id, filename: f.filename })),
      checkers,
      members: members.map((m) => ({ userId: m.userId, username: m.username, role: m.role, disabled: m.disabled === true })),
      noCheckers: eligible.size === 0,
      warning: notBlind.length > 0 ? { code: 'checkers_not_blind', usernames: notBlind } : null,
      asOf: state.builtAt,
    };
  }

  private async load(projectId: string, log: Log, fresh: boolean): Promise<Loaded> {
    const [sampling, served] = await Promise.all([this.store.getSampling(projectId), this.states.get(projectId, log, { fresh })]);
    const { state } = served;
    const members = served.members;
    const divided = state.files.filter((f) => f.distribution);
    const holdings = new Map<string, PlotAssignment[]>();
    await Promise.all(divided.map(async (f) => holdings.set(f.id, await this.store.listPlotAssignments(projectId, f.id))));
    const rule = sampling.rule;
    if (!rule || !samplingActive(rule)) {
      return { sampling, state, members, divided, holdings, input: null };
    }
    return { sampling, state, members, divided, holdings, input: drawInputOf(rule, state, members, divided, holdings) };
  }
}

export interface SamplingView {
  rule: SamplingRule | null;
  active: boolean;
  intervalMinutes: number;
  due: boolean;
  dueSince: number | null;
  /** When the next automatic draw can be made (a first submission or someone's plot list then triggers it). */
  nextAutomaticAt: number | null;
  /** The last draw that added copies. */
  lastDraw: (SamplingDraw & { by: string | null }) | null;
  /** When a draw last looked for plots to check (one that found none included). */
  lastCheckedAt: number | null;
  /** What a draw now would add. */
  pending: { drawn: number; firstN: number; percent: number; noChecker: number };
  files: {
    csvFileId: string;
    filename: string;
    use: 'project' | 'off' | 'own';
    own: { checkers: string[] | null; firstN: number | null; percent: number | null } | null;
    plots: number;
    submitted: number;
    sampledCopies: number;
    /** The division's copies (reference copies apart). */
    divisionCopies: number;
    /** Copies of reference plots (Task 14). */
    referenceCopies: number;
    pending: number;
  }[];
  /** Whole files cannot hold checks: assign them by plot to use checks. */
  wholeFiles: { csvFileId: string; filename: string }[];
  checkers: { userId: string; username: string; role: Member['role']; eligible: boolean; disabled: boolean; open: number; done: number; sampled: number }[];
  /** Everyone of the project, to choose the checkers from. */
  members: { userId: string; username: string; role: Member['role']; disabled: boolean }[];
  /** Nobody may receive checks under the project's rule. */
  noCheckers: boolean;
  /**
   * Reviewers or coordinators chosen as checkers (the project's or a file's own rule): they can
   * read the first assessments on the dashboard, so their checks may not be blind (Decision 10).
   */
  warning: { code: 'checkers_not_blind'; usernames: string[] } | null;
  asOf: number;
}

/** unit -> its earliest submitted first assessment (who and when), from the project state. */
function submittedOf(state: ProjectState): Map<string, { operator: string; at: number }> {
  const result = new Map<string, { operator: string; at: number }>();
  for (const [operator, work] of state.units.byOperator) {
    for (const [unit, at] of work.mainSubmitted) {
      const seen = result.get(unit);
      if (!seen || at < seen.at || (at === seen.at && operator < seen.operator)) result.set(unit, { operator, at });
    }
  }
  return result;
}

/** A draw's input from the project state and the holdings as stored now. */
export function drawInputOf(
  rule: SamplingRule,
  state: ProjectState,
  members: readonly Member[],
  divided: readonly CsvFile[],
  holdings: ReadonlyMap<string, readonly PlotAssignment[]>,
): DrawInput {
  const assessedBy = new Map<string, Set<string>>();
  const checked = new Set<string>();
  // A disabled account can no longer do a check: its drafts cover nothing, nor its drawn copies
  // not done (stale: drawn again, the old copy dropped).
  const disabled = new Set(members.filter((m) => m.disabled).map((m) => m.username));
  const note = (unit: string, operator: string) => {
    const set = assessedBy.get(unit) ?? new Set<string>();
    set.add(operator);
    assessedBy.set(unit, set);
  };
  for (const [operator, work] of state.units.byOperator) {
    for (const unit of work.mainSubmitted.keys()) note(unit, operator);
    for (const unit of work.mainDrafts) note(unit, operator);
    for (const unit of work.checkSubmitted.keys()) {
      note(unit, operator);
      checked.add(unit);
    }
    for (const unit of work.checkDrafts) {
      note(unit, operator);
      if (!disabled.has(operator)) checked.add(unit);
    }
  }
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  const stale: { csvFileId: string; plotKey: string; userId: string }[] = [];
  // A check begun (a draft) is kept with its holder, as one submitted (Task 22 review, B3): enabled
  // again they finish it, and without a round in the keys a draft left without its copy would read
  // as a second first assessment.
  const isStale = (a: PlotAssignment) => {
    const username = usernames.get(a.userId);
    return (
      a.overlap &&
      a.sampledAt !== undefined &&
      username !== undefined &&
      disabled.has(username) &&
      !state.units.checksDone.has(`${username}\n${a.plotKey}`) &&
      !(state.units.byOperator.get(username)?.checkDrafts.has(a.plotKey) ?? false)
    );
  };
  for (const [csvFileId, list] of holdings) {
    for (const a of list) if (isStale(a)) stale.push({ csvFileId, plotKey: a.plotKey, userId: a.userId });
  }
  const all = [...holdings.values()].flat().filter((a) => !isStale(a));
  const copyHolders = copyHoldersOf(all, usernames);
  // Reference plots (Task 14) are never drawn: every collector checks them already, they are not
  // among anyone's plots for the share, and their copies are no open checks (every collector has them).
  const reference = state.context.reference;
  const files: DrawFile[] = divided
    .filter((f) => coreOf(rule, f.id) !== null)
    .map((f) => {
      const units = state.context.fileUnits.get(f.id) ?? [];
      return { id: f.id, units: reference.size > 0 ? units.filter((u) => !reference.has(u)) : units, holdings: holdings.get(f.id) ?? [] };
    });
  // Open checks: copies held (each unit once) whose check by them is not submitted.
  const openChecks = new Map<string, number>();
  for (const [unit, users] of copyHolders) {
    if (reference.has(unit)) continue;
    for (const u of users) {
      if (!state.units.checksDone.has(`${u}\n${unit}`)) openChecks.set(u, (openChecks.get(u) ?? 0) + 1);
    }
  }
  const heldSets = new Map<string, Set<string>>();
  const heldMain = (username: string, unit: string) => {
    let set = heldSets.get(username);
    if (!set) {
      set = new Set(state.units.held.get(username) ?? []);
      heldSets.set(username, set);
    }
    return set.has(unit);
  };
  const isPlot = isPlotUnit(state.info);
  const shape = keyShape(state.info);
  const plotOf =
    state.info?.state === 'own' && shape.roundIndex !== null ? (unit: string) => splitKey(unit, shape.count, shape.roundIndex).plot : undefined;
  return {
    rule,
    files,
    members,
    submitted: reference.size > 0 ? new Map([...submittedOf(state)].filter(([unit]) => !reference.has(unit))) : submittedOf(state),
    assessedBy,
    checked,
    copyHolders,
    heldMain,
    openChecks,
    stale,
    isCheckUnit: (unit: string) => !isPlot(unit),
    ...(plotOf ? { plotOf } : {}),
  };
}
