import { isoWeek } from './quality.js';
import type { Member, PlotAssignment, SampledCopy, SamplingCore, SamplingFileRule, SamplingRule } from './types.js';

/**
 * Automatic check sampling (Task 13): which submitted plots of the divided files get a
 * quality check, and who checks each one. Pure; the service (samplingService.ts) loads the
 * project state, stores the copies and audits the draw.
 *
 * - A plot is drawn when its first assessment is submitted and it has no check yet (no copy
 *   holder anywhere, no check record), by either rule of its file:
 *   - "the first N plots of every person": each person's first N submitted plots (by their
 *     first submission);
 *   - "X % of submitted plots": of all of each person's submitted plots, round(n × X / 100)
 *     (a half up) have a check; plots with a check already, the first N among them, count
 *     towards it. The ISO weeks (UTC) of the first submissions only spread the rest: each
 *     pick from the week with the fewest checks for its plots, then in a seeded order (a hash
 *     of the rule's seed and the plot: the same draw again picks the same plots, and a plot
 *     added later moves no other). A part-time collector (4 plots a week at 10 %) gets checks.
 * - Covered: a copy or a check record of the unit, or (own round) of the plot's
 *   reassessment-code unit; a drawn copy whose holder was disabled before doing it covers
 *   nothing (`stale`) and is dropped when its plot is drawn again.
 * - Each drawn plot goes to one checker, as a copy (`overlap`) in the file: the checker with
 *   the fewest open checks (copies held and not checked yet, plus those of this draw), ties
 *   by a seeded hash. Never the person who assessed it, anyone with a record of it (any
 *   round, drafts too), anyone holding it (main or copy) or holding it as main elsewhere,
 *   nor (own round) anyone with a copy of another round of the same plot. A plot no checker
 *   can take is counted in `noChecker` and tried again next time.
 */

/** "First N": at most this many plots per person. */
export const MAX_FIRST_N = 1000;
/** "X %": from 1 to 100. */
export const MAX_PERCENT = 100;

export interface DrawFile {
  id: string;
  /** The file's plot units, in file order. */
  units: readonly string[];
  /** Who holds which plot of it now (main and copies). */
  holdings: readonly PlotAssignment[];
}

export interface DrawInput {
  rule: SamplingRule;
  /** The divided files (whole files cannot hold copies). */
  files: readonly DrawFile[];
  members: readonly Member[];
  /** unit -> its submitted first assessment: who (operator = username) and when it was first submitted. */
  submitted: ReadonlyMap<string, { operator: string; at: number }>;
  /** unit -> the usernames with a record of it, any round, drafts too (not deleted). */
  assessedBy: ReadonlyMap<string, ReadonlySet<string>>;
  /** Units with a check record (submitted or not). */
  checked: ReadonlySet<string>;
  /** unit -> the usernames holding it only as a copy, in any divided file. */
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>;
  /** Whether the person holds the unit as a main plot (a whole file given to them, or a divided one). */
  heldMain: (username: string, unit: string) => boolean;
  /** username -> their open checks: copies held and not checked yet. */
  openChecks: ReadonlyMap<string, number>;
  /** An own round's plot of a unit ("18,1" and "18,3" are plot 18); the unit itself otherwise. */
  plotOf?: (unit: string) => string;
  /**
   * Whether a unit is a check of its plot (an own round's unit whose round is the reassessment
   * code): a copy or check record of "18,R" covers the plot's other units ("18,1").
   */
  isCheckUnit?: (unit: string) => boolean;
  /**
   * Drawn copies whose holder can no longer do them (a disabled account) and has not: not counted
   * as covering their plot (`copyHolders` leaves them out), and dropped when the plot is drawn again.
   */
  stale?: readonly { csvFileId: string; plotKey: string; userId: string }[];
}

export interface DrawResult {
  copies: SampledCopy[];
  /** Stale drawn copies to drop: their plots were drawn again. */
  drop: { csvFileId: string; plotKey: string; userId: string }[];
  /** Plots due for a check that no checker could take. */
  noChecker: number;
}

/** The rule a divided file follows: its own, the project's, or none (null). */
export function coreOf(rule: SamplingRule, csvFileId: string): SamplingCore | null {
  const own: SamplingFileRule | undefined = rule.files[csvFileId];
  if (own?.use === 'off') return null;
  const core = own?.use === 'own' ? own : rule;
  return core.firstN === null && core.percent === null ? null : { checkers: core.checkers, firstN: core.firstN, percent: core.percent };
}

/** Whether any file could get checks: the project's rule or a file's own has a rule on. */
export function samplingActive(rule: SamplingRule | null): boolean {
  if (!rule) return false;
  if (rule.firstN !== null || rule.percent !== null) return true;
  return Object.values(rule.files).some((f) => f.use === 'own' && (f.firstN !== null || f.percent !== null));
}

/** A 32-bit FNV-1a hash of the seed and the parts: the seeded order of plots and checkers. */
export function priority(seed: number, ...parts: string[]): number {
  let h = 0x811c9dc5;
  const text = `${seed}\u0000${parts.join('\u0000')}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The people who may check under a rule: the chosen ones, or every collector; never a disabled
 * account. Reviewers and coordinators only when chosen (Decision 10): they can read the first
 * assessments on the dashboard, so their checks are not blind (notBlindCheckers).
 */
export function checkersOf(core: SamplingCore, members: readonly Member[]): Member[] {
  const chosen = core.checkers === null ? null : new Set(core.checkers);
  return members.filter((m) => !m.disabled && (chosen ? chosen.has(m.userId) : m.role === 'operator'));
}

/** The reviewers and coordinators a rule names as checkers (project and own file rules), by username, sorted. */
export function notBlindCheckers(rule: SamplingRule | null, members: readonly Member[]): string[] {
  if (!rule) return [];
  const chosen = new Set<string>([...(rule.checkers ?? []), ...Object.values(rule.files).flatMap((f) => (f.use === 'own' ? (f.checkers ?? []) : []))]);
  return members
    .filter((m) => chosen.has(m.userId) && (m.role === 'reviewer' || m.role === 'admin'))
    .map((m) => m.username)
    .sort();
}

interface Plot {
  unit: string;
  csvFileId: string;
  operator: string;
  at: number;
}

const byTime = (a: Plot, b: Plot) => a.at - b.at || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0);

export function drawChecks(input: DrawInput): DrawResult {
  const { rule } = input;
  const plotOf = input.plotOf ?? ((unit: string) => unit);
  // The rule's scopes: the files on the project's rule together, each file with its own apart.
  const scopes = new Map<string, { core: SamplingCore; files: DrawFile[] }>();
  for (const file of input.files) {
    const core = coreOf(rule, file.id);
    if (!core) continue;
    const key = rule.files[file.id]?.use === 'own' ? `file:${file.id}` : 'project';
    const scope = scopes.get(key) ?? { core, files: [] };
    scope.files.push(file);
    scopes.set(key, scope);
  }
  const isCheckUnit = input.isCheckUnit ?? (() => false);
  const direct = (unit: string) => (input.copyHolders.get(unit)?.size ?? 0) > 0 || input.checked.has(unit);
  // Plots covered through a check unit of theirs (own round: "18,R" covers "18,1").
  const coveredPlots = new Set<string>();
  for (const unit of [...input.copyHolders.keys(), ...input.checked]) {
    if (isCheckUnit(unit) && direct(unit)) coveredPlots.add(plotOf(unit));
  }
  const covered = (unit: string) => direct(unit) || coveredPlots.has(plotOf(unit));
  const picked = new Set<string>();
  const picks: { plot: Plot; reason: SampledCopy['reason']; core: SamplingCore; file: DrawFile }[] = [];
  const fileById = new Map(input.files.map((f) => [f.id, f]));
  for (const { core, files } of scopes.values()) {
    // Each submitted plot once in the scope: in the first of its files.
    const plots = new Map<string, Plot>();
    for (const file of files) {
      for (const unit of file.units) {
        const sub = input.submitted.get(unit);
        if (sub && !plots.has(unit)) plots.set(unit, { unit, csvFileId: file.id, operator: sub.operator, at: sub.at });
      }
    }
    const byPerson = new Map<string, Plot[]>();
    for (const p of plots.values()) {
      const list = byPerson.get(p.operator) ?? [];
      list.push(p);
      byPerson.set(p.operator, list);
    }
    const isDone = (unit: string) => covered(unit) || picked.has(unit);
    const pick = (plot: Plot, reason: SampledCopy['reason']) => {
      picked.add(plot.unit);
      picks.push({ plot, reason, core, file: fileById.get(plot.csvFileId)! });
    };
    for (const list of byPerson.values()) {
      list.sort(byTime);
      if (core.firstN !== null) {
        for (const plot of list.slice(0, core.firstN)) {
          if (!isDone(plot.unit)) pick(plot, 'firstN');
        }
      }
      if (core.percent !== null) {
        const weeks = new Map<string, Plot[]>();
        for (const plot of list) {
          const week = isoWeek(plot.at);
          const w = weeks.get(week) ?? [];
          w.push(plot);
          weeks.set(week, w);
        }
        // Cumulative per person: round(all their plots × X / 100) less those covered. The weeks
        // only spread the picks: the week with the fewest checks for its plots first, then the
        // seeded order (its best plot's hash).
        const target = Math.floor((list.length * core.percent) / 100 + 0.5);
        let need = target - list.filter((p) => isDone(p.unit)).length;
        const spread = [...weeks.values()].map((w) => ({
          plots: w.length,
          done: w.filter((p) => isDone(p.unit)).length,
          free: w
            .filter((p) => !isDone(p.unit))
            .map((p) => ({ p, h: priority(rule.seed, p.unit) }))
            .sort((a, b) => a.h - b.h || (a.p.unit < b.p.unit ? -1 : 1)),
        }));
        while (need > 0) {
          let best: (typeof spread)[number] | null = null;
          for (const w of spread) {
            if (w.free.length === 0) continue;
            if (best === null) {
              best = w;
              continue;
            }
            // done/plots smaller first (compared without division), then the better plot.
            const diff = w.done * best.plots - best.done * w.plots;
            if (diff < 0 || (diff === 0 && (w.free[0].h < best.free[0].h || (w.free[0].h === best.free[0].h && w.free[0].p.unit < best.free[0].p.unit)))) {
              best = w;
            }
          }
          if (!best) break;
          pick(best.free.shift()!.p, 'percent');
          best.done += 1;
          need -= 1;
        }
      }
    }
  }

  // Who checks each one: the fewest open checks first.
  const load = new Map(input.openChecks);
  // username -> the plots (own round: of the units) they hold copies of, this draw's too.
  const copyPlots = new Map<string, Set<string>>();
  for (const [unit, users] of input.copyHolders) {
    for (const u of users) {
      const set = copyPlots.get(u) ?? new Set<string>();
      set.add(plotOf(unit));
      copyPlots.set(u, set);
    }
  }
  const holdersByFile = new Map<string, Map<string, Set<string>>>();
  const holdersIn = (file: DrawFile) => {
    let map = holdersByFile.get(file.id);
    if (!map) {
      map = new Map();
      for (const a of file.holdings) {
        const set = map.get(a.plotKey) ?? new Set<string>();
        set.add(a.userId);
        map.set(a.plotKey, set);
      }
      holdersByFile.set(file.id, map);
    }
    return map;
  };
  const checkerLists = new Map<SamplingCore, Member[]>();
  const copies: SampledCopy[] = [];
  let noChecker = 0;
  picks.sort((a, b) => byTime(a.plot, b.plot));
  for (const { plot, reason, core, file } of picks) {
    let checkers = checkerLists.get(core);
    if (!checkers) {
      checkers = checkersOf(core, input.members);
      checkerLists.set(core, checkers);
    }
    const holders = holdersIn(file).get(plot.unit);
    const assessed = input.assessedBy.get(plot.unit);
    const plotKey = plotOf(plot.unit);
    let best: Member | null = null;
    let bestLoad = 0;
    let bestHash = 0;
    for (const m of checkers) {
      if (
        m.username === plot.operator ||
        assessed?.has(m.username) ||
        holders?.has(m.userId) ||
        copyPlots.get(m.username)?.has(plotKey) ||
        input.heldMain(m.username, plot.unit)
      ) {
        continue;
      }
      const l = load.get(m.username) ?? 0;
      const h = priority(rule.seed, plot.unit, m.userId);
      if (best === null || l < bestLoad || (l === bestLoad && h < bestHash)) {
        best = m;
        bestLoad = l;
        bestHash = h;
      }
    }
    if (!best) {
      noChecker += 1;
      continue;
    }
    load.set(best.username, bestLoad + 1);
    const set = copyPlots.get(best.username) ?? new Set<string>();
    set.add(plotKey);
    copyPlots.set(best.username, set);
    copies.push({ csvFileId: plot.csvFileId, plotKey: plot.unit, userId: best.userId, reason });
  }
  const redrawn = new Set(copies.map((c) => `${c.csvFileId}\n${c.plotKey}`));
  const drop = (input.stale ?? []).filter((s) => redrawn.has(`${s.csvFileId}\n${s.plotKey}`)).map((s) => ({ csvFileId: s.csvFileId, plotKey: s.plotKey, userId: s.userId }));
  return { copies, drop, noChecker };
}

type BadRequest = { reason: string };

/**
 * Validates a PUT /sampling body: `{ checkers, firstN, percent, seed?, files? }`. `members` are
 * the project's user ids, `divided` its divided files' ids; the stored `seed` is kept unless
 * the body gives one (a new rule gets `newSeed()`). A file on the project's rule is not stored.
 */
export function parseSamplingRule(
  body: unknown,
  known: { members: ReadonlySet<string>; divided: ReadonlySet<string>; seed: number | null; newSeed: () => number },
): SamplingRule | BadRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { reason: 'the body must be an object: { checkers, firstN, percent, files }' };
  }
  const b = body as Record<string, unknown>;
  const core = coreInput(b, known.members, '');
  if ('reason' in core) return core;
  let seed = known.seed ?? known.newSeed();
  if (b.seed !== undefined && b.seed !== null) {
    if (typeof b.seed !== 'number' || !Number.isSafeInteger(b.seed)) return { reason: 'seed must be a whole number' };
    seed = b.seed;
  }
  const files: Record<string, SamplingFileRule> = {};
  if (b.files !== undefined && b.files !== null) {
    if (typeof b.files !== 'object' || Array.isArray(b.files)) return { reason: 'files must be an object: { <plot file id>: { use } }' };
    for (const [id, raw] of Object.entries(b.files as Record<string, unknown>)) {
      if (!known.divided.has(id)) return { reason: `files: ${id} is not a divided plot file of the project (only divided files can hold checks)` };
      const f = (raw ?? {}) as Record<string, unknown>;
      if (f.use === 'project') continue;
      if (f.use === 'off') {
        files[id] = { use: 'off' };
        continue;
      }
      if (f.use !== 'own') return { reason: `files: ${id}: use must be 'project', 'off' or 'own'` };
      const own = coreInput(f, known.members, `files: ${id}: `);
      if ('reason' in own) return own;
      files[id] = { use: 'own', ...own };
    }
  }
  return { ...core, seed, files };
}

function coreInput(b: Record<string, unknown>, members: ReadonlySet<string>, where: string): SamplingCore | BadRequest {
  const firstN = b.firstN === undefined || b.firstN === null ? null : b.firstN;
  if (firstN !== null && !(Number.isInteger(firstN) && (firstN as number) >= 1 && (firstN as number) <= MAX_FIRST_N)) {
    return { reason: `${where}firstN must be a whole number from 1 to ${MAX_FIRST_N}, or null (off)` };
  }
  const percent = b.percent === undefined || b.percent === null ? null : b.percent;
  if (percent !== null && !(Number.isInteger(percent) && (percent as number) >= 1 && (percent as number) <= MAX_PERCENT)) {
    return { reason: `${where}percent must be a whole number from 1 to ${MAX_PERCENT}, or null (off)` };
  }
  let checkers: string[] | null = null;
  if (b.checkers !== undefined && b.checkers !== null) {
    if (!Array.isArray(b.checkers)) return { reason: `${where}checkers must be a list of user ids, or null (every collector)` };
    checkers = [];
    for (const id of b.checkers) {
      if (typeof id !== 'string' || !members.has(id)) return { reason: `${where}checkers: ${String(id)} is not a member of the project` };
      if (!checkers.includes(id)) checkers.push(id);
    }
  }
  return { checkers, firstN: firstN as number | null, percent: percent as number | null };
}
