import type { DivisionOrder, PlotAssignment, RecordRow, StoredDistribution } from './types.js';
import type { RoundInfo } from './cep.js';
import { copyUnitsByUser, keyShape, recordRound, unitOfRecord } from './rounds.js';
import { inRankOrder } from './nearby.js';

/**
 * Dividing one plot file's plots between people: validating a request, computing
 * who gets which plot, moving unfinished plots, and the summaries the dashboard
 * shows. Pure functions; the routes load and save.
 */

export const MAX_OVERLAP_PERCENT = 50;

/**
 * Who submitted one plot: `main` the main assessment, `check` the quality check
 * (recordRound). Dealing keeps a plot with its main submitters; anything else that
 * counts "submitted" takes either.
 */
export interface Submitters {
  main: ReadonlySet<string>;
  check: ReadonlySet<string>;
}
export type SubmittedBy = ReadonlyMap<string, Submitters>;

/** Whether the user submitted the plot, main or check. */
export function hasSubmitted(submittedBy: SubmittedBy, plot: string, userId: string): boolean {
  const s = submittedBy.get(plot);
  return s !== undefined && (s.main.has(userId) || s.check.has(userId));
}

/**
 * Whether a holding is done: a main holding when its holder submitted the main
 * assessment; a copy when they submitted the check, or the main assessment (a second
 * main submitter, e.g. two people had the plot on a whole file before it was divided:
 * their work is done, and the quality figures list the plot as a data problem).
 */
export function holdingDone(submittedBy: SubmittedBy, a: PlotAssignment): boolean {
  const s = submittedBy.get(a.plotKey);
  return s !== undefined && (s.main.has(a.userId) || (a.overlap && s.check.has(a.userId)));
}

/** A division request after validation, before the plots are dealt. */
export type DivisionRequest = { mode: 'whole' } | Exclude<StoredDistribution, { mode: 'manual' }>;

/**
 * Validates a PUT /distribution body. `members` are the project's user ids, and
 * `columnCount` the widest row of the file. A mixed order without a seed gets
 * `newSeed()`; order 'nearby' needs none (a seed sent is not kept). Whether the file's
 * places allow 'nearby' is the route's check. Returns the request, or the reason it is
 * refused.
 */
export function parseDivisionRequest(
  body: unknown,
  members: ReadonlySet<string>,
  columnCount: number,
  newSeed: () => number,
): DivisionRequest | { reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.mode === 'whole') {
    return { mode: 'whole' };
  }
  if (b.mode !== 'even' && b.mode !== 'column') {
    return { reason: "mode must be 'whole', 'even' or 'column'" };
  }
  const order: DivisionOrder | null =
    b.order === undefined || b.order === 'file' ? 'file' : b.order === 'mixed' || b.order === 'nearby' ? b.order : null;
  if (!order) {
    return { reason: "order must be 'file', 'mixed' or 'nearby'" };
  }
  const overlapPercent = b.overlapPercent === undefined || b.overlapPercent === null ? 0 : b.overlapPercent;
  if (typeof overlapPercent !== 'number' || !Number.isFinite(overlapPercent) || overlapPercent < 0 || overlapPercent > MAX_OVERLAP_PERCENT) {
    return { reason: `overlapPercent must be a number from 0 to ${MAX_OVERLAP_PERCENT}` };
  }
  let seed: number | undefined;
  if (order === 'mixed') {
    if (b.seed === undefined || b.seed === null) {
      seed = newSeed();
    } else if (typeof b.seed === 'number' && Number.isSafeInteger(b.seed)) {
      seed = b.seed;
    } else {
      return { reason: 'seed must be an integer' };
    }
  }
  const people = (value: unknown, what: string): string[] | { reason: string } => {
    if (!Array.isArray(value) || value.length === 0) {
      return { reason: `${what} needs at least one person` };
    }
    const result: string[] = [];
    for (const p of value) {
      if (typeof p !== 'string' || !members.has(p)) {
        return { reason: `${what}: ${String(p)} is not a member of the project` };
      }
      if (!result.includes(p)) {
        result.push(p);
      }
    }
    return result;
  };
  const extra = { order, overlapPercent, ...(seed === undefined ? {} : { seed }) };
  if (b.mode === 'even') {
    const list = people(b.people, 'people');
    return 'reason' in list ? list : { mode: 'even', people: list, ...extra };
  }
  if (typeof b.column !== 'number' || !Number.isInteger(b.column) || b.column < 0 || b.column >= columnCount) {
    return { reason: `column must be a column of the file, from 0 to ${columnCount - 1}` };
  }
  if (!Array.isArray(b.groups) || b.groups.length === 0) {
    return { reason: 'groups needs at least one value' };
  }
  const groups: { value: string; people: string[] }[] = [];
  const values = new Set<string>();
  for (const g of b.groups as Record<string, unknown>[]) {
    if (typeof g?.value !== 'string') {
      return { reason: 'every group needs a value' };
    }
    if (values.has(g.value)) {
      return { reason: `the value "${g.value}" is in two groups` };
    }
    values.add(g.value);
    const list = people(g.people, `the group "${g.value}"`);
    if ('reason' in list) {
      return list;
    }
    groups.push({ value: g.value, people: list });
  }
  return { mode: 'column', column: b.column, groups, ...extra };
}

/** Everyone of a division, in order of first appearance. */
export function divisionPeople(d: StoredDistribution): string[] {
  if (d.mode === 'even') {
    return [...d.people];
  }
  if (d.mode === 'column') {
    return [...new Set(d.groups.flatMap((g) => g.people))];
  }
  return [];
}

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of items in a seeded (Fisher-Yates) order. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  const random = prng(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * How many plots each person ends up with when `pinned[i]` are already theirs and
 * `free` more are to be shared: as even as possible (the most anyone has is as
 * low as it can be), the earlier people taking the extra one.
 */
export function shareSizes(pinned: readonly number[], free: number): number[] {
  const need = (level: number) => pinned.reduce((sum, p) => sum + Math.max(0, level - p), 0);
  let lo = 0;
  let hi = free + Math.max(0, ...pinned);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (need(mid) <= free) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  let left = free - need(lo);
  return pinned.map((p) => {
    let extra = Math.max(0, lo - p);
    if (left > 0 && p <= lo) {
      extra += 1;
      left -= 1;
    }
    return extra;
  });
}

/**
 * Deals `plots` (in the order they are to be dealt) between `people`.
 * - A plot whose main assessment one of them submitted stays theirs (the first of
 *   them, if several; the others keep it as a copy) and counts towards their share.
 * - A plot whose main assessment only people outside `people` submitted is done: it
 *   stays with them (the first as main, the others as copies) and is not dealt again.
 * - Those who submitted a plot's check always keep it as a copy, never as main: the
 *   plot goes to someone else (the next person with room who did not check it, or
 *   else the one of them with the fewest plots). When everyone checked it, it is
 *   left unassigned.
 * The rest goes out in order: person i the next chunk, so neighbouring plots stay
 * together. Returns each person's plots in dealing order, the copies and the
 * holdings kept outside `people`.
 */
function deal(
  plots: readonly string[],
  people: readonly string[],
  submittedBy: SubmittedBy,
): { lists: string[][]; copies: PlotAssignment[]; kept: PlotAssignment[] } {
  const n = people.length;
  const index = new Map(people.map((p, i) => [p, i]));
  const owner = new Map<string, number>();
  const done = new Set<string>();
  const checkedBy = new Map<string, Set<number>>();
  const copies: PlotAssignment[] = [];
  const kept: PlotAssignment[] = [];
  const pinned = people.map(() => 0);
  const among = (users: ReadonlySet<string>) =>
    [...users].map((u) => index.get(u)).filter((i): i is number => i !== undefined).sort((x, y) => x - y);
  for (const plot of plots) {
    const by = submittedBy.get(plot);
    if (!by) {
      continue;
    }
    const holders = among(by.main);
    const checkers = among(by.check).filter((i) => !holders.includes(i));
    for (const i of [...holders.slice(1), ...checkers]) {
      copies.push({ plotKey: plot, userId: people[i], overlap: true });
    }
    if (holders.length > 0) {
      owner.set(plot, holders[0]);
      pinned[holders[0]] += 1;
    } else if (by.main.size > 0) {
      const outside = [...by.main].sort();
      done.add(plot);
      outside.forEach((userId, i) => kept.push({ plotKey: plot, userId, overlap: i > 0 }));
    } else if (checkers.length > 0) {
      checkedBy.set(plot, new Set(checkers));
    }
  }
  const extra = shareSizes(pinned, plots.length - owner.size - done.size);
  const lists: string[][] = people.map(() => []);
  let person = 0;
  for (const plot of plots) {
    const pinnedTo = owner.get(plot);
    if (pinnedTo !== undefined) {
      lists[pinnedTo].push(plot);
      continue;
    }
    if (done.has(plot)) {
      continue;
    }
    while (person < n && extra[person] === 0) {
      person += 1;
    }
    const checkers = checkedBy.get(plot);
    let j = person;
    while (j < n && (extra[j] === 0 || checkers?.has(j))) {
      j += 1;
    }
    if (j < n) {
      lists[j].push(plot);
      extra[j] -= 1;
      continue;
    }
    // Everyone with room checked it: the one who did not with the fewest plots.
    let best = -1;
    for (let i = 0; i < n; i += 1) {
      if (!checkers?.has(i) && (best < 0 || lists[i].length < lists[best].length)) {
        best = i;
      }
    }
    if (best >= 0) {
      lists[best].push(plot);
    }
  }
  return { lists, copies, kept };
}

/** `m` of `count` items, spread evenly: their indices. */
function spread(count: number, m: number): number[] {
  const picks: number[] = [];
  for (let j = 0; j < m; j += 1) {
    picks.push(Math.floor((j * count) / m));
  }
  return picks;
}

/** Which plots of a list of `count` become copies: ceil(percent) of them, spread evenly. */
export function overlapPicks(count: number, percent: number): number[] {
  if (count === 0 || percent <= 0) {
    return [];
  }
  return spread(count, overlapCount(count, percent));
}

/** ceil(percent of count), at most count. */
function overlapCount(count: number, percent: number): number {
  return count === 0 || percent <= 0 ? 0 : Math.min(count, Math.ceil((percent * count) / 100 - 1e-9));
}

/**
 * Computes a division. `plotIds` are the file's plots in file order, `values` (for
 * mode column) each plot's value in the chosen column, and `submittedBy` the user
 * ids that submitted each plot. Each person's plots are in file order.
 *
 * `plotOf` gives a unit's plot (without its round) for a survey with its own round,
 * where a plot may have several units ("18,1", "18,3"): no new overlap copy gives
 * anyone copies of two units of the same plot. That rule is only for the new picks:
 * the copies kept for what people submitted (their check, or a second main
 * assessment) are always kept, and are dealt in every group before any new pick. A
 * plot that already has a copy gets no other one, and counts towards the overlap
 * share. Plots kept with people outside the division, and plots everyone of their
 * group checked (left unassigned), are in nobody's list and get no new copies.
 *
 * `drawn` are the copies the check sampling drew (sampledAt) held now: they are kept, after
 * what is dealt and before any new pick, so they count towards the overlap share and their
 * plots get no other copy. One whose holder is now dealt the plot as main goes (nobody
 * checks their own plot); those of plots no longer in the file go.
 *
 * Order 'nearby' (Task 15) deals the plots along a Hilbert curve: `curve` is each plot's
 * position on the curve over the WHOLE file (nearbyRanks; plots without a place last, in file
 * order), so that plots left out of the division (reference plots) change nothing and the
 * division follows the curve the served rows follow. Each person's chunk is a compact area; in
 * a column division each group follows the curve. Each
 * person's list is then kept in curve order, so their overlap copies are spread over their
 * area, and go (as always) to the next person, who holds the next stretch of the curve:
 * mostly a neighbouring area.
 */
export function divide(
  d: Exclude<StoredDistribution, { mode: 'manual' }>,
  plotIds: readonly string[],
  values: readonly string[] | null,
  submittedBy: SubmittedBy,
  plotOf: (unit: string) => string = (unit) => unit,
  drawn: readonly PlotAssignment[] = [],
  curve: ReadonlyMap<string, number> = new Map(),
): PlotAssignment[] {
  const position = new Map(plotIds.map((id, i) => [id, i]));
  const order =
    d.order === 'mixed' ? shuffled(plotIds, d.seed ?? 0) : d.order === 'nearby' ? inRankOrder(plotIds, curve) : [...plotIds];
  // Each person's list is kept in file order, or along the curve for 'nearby'.
  const rank = d.order === 'nearby' ? new Map(order.map((id, i) => [id, i])) : position;
  const groups: { people: string[]; plots: string[] }[] = [];
  if (d.mode === 'even') {
    groups.push({ people: d.people, plots: order });
  } else {
    const valueOf = new Map(plotIds.map((id, i) => [id, values?.[i] ?? '']));
    const byValue = new Map(d.groups.map((g) => [g.value, { people: g.people, plots: [] as string[] }]));
    for (const plot of order) {
      byValue.get(valueOf.get(plot) ?? '')?.plots.push(plot);
    }
    groups.push(...byValue.values());
  }
  const everyone = divisionPeople(d);
  const result = new Map<string, PlotAssignment>();
  // The plots each person holds copies of, and through which units.
  const copyUnitOf = new Map<string, Map<string, Set<string>>>();
  const copied = new Set<string>();
  /**
   * Adds a holding. A copy kept for what someone submitted (`isNew` false) is always
   * added; a new overlap copy is not when the person already holds the plot, or a
   * copy of another unit of the same plot.
   */
  const add = (a: PlotAssignment, isNew = false): void => {
    const key = `${a.plotKey}\u0000${a.userId}`;
    const existing = result.get(key);
    if (a.overlap) {
      if (existing) {
        return;
      }
      let plots = copyUnitOf.get(a.userId);
      if (!plots) {
        plots = new Map();
        copyUnitOf.set(a.userId, plots);
      }
      const plot = plotOf(a.plotKey);
      let units = plots.get(plot);
      if (isNew && units !== undefined && units.size > 0) {
        return;
      }
      if (!units) {
        units = new Set();
        plots.set(plot, units);
      }
      units.add(a.plotKey);
      copied.add(a.plotKey);
    }
    if (!existing || (existing.overlap && !a.overlap)) {
      result.set(key, a);
    }
  };
  // First everything dealt (the main holdings and the copies kept for what people
  // submitted, in every group), then the new overlap copies.
  const dealt = groups.map((group) => ({ group, ...deal(group.plots, group.people, submittedBy) }));
  for (const { group, lists, copies, kept } of dealt) {
    lists.forEach((list, i) => {
      list.sort((x, y) => rank.get(x)! - rank.get(y)!);
      for (const plot of list) {
        add({ plotKey: plot, userId: group.people[i], overlap: false });
      }
    });
    kept.filter((a) => !a.overlap).forEach((a) => add(a));
    kept.filter((a) => a.overlap).forEach((a) => add(a));
    copies.forEach((a) => add(a));
  }
  for (const a of drawn) {
    if (!a.overlap || a.sampledAt === undefined || !position.has(a.plotKey)) {
      continue;
    }
    add({ plotKey: a.plotKey, userId: a.userId, overlap: true });
    // Kept (or already kept as the copy of a check its holder submitted): it stays drawn.
    const row = result.get(`${a.plotKey}\u0000${a.userId}`);
    if (row?.overlap) {
      row.sampledAt = a.sampledAt;
    }
  }
  for (const { group, lists } of dealt) {
    lists.forEach((list, i) => {
      const userId = group.people[i];
      // Quality-check copies go to the next person of the group, or of everyone
      // when the group has one person; nobody when there is only one in all.
      const next =
        group.people.length > 1
          ? group.people[(i + 1) % group.people.length]
          : everyone.length > 1
            ? everyone[(everyone.indexOf(userId) + 1) % everyone.length]
            : null;
      if (!next) {
        return;
      }
      // Plots that already have a copy count towards the share and get no other.
      const free = list.filter((plot) => !copied.has(plot));
      const wanted = overlapCount(list.length, d.overlapPercent) - (list.length - free.length);
      // The units `next` may get a new copy of: one per plot, and none of a plot they
      // already hold a copy of (with plain ids, every free plot).
      const held = copyUnitOf.get(next);
      const plotsTaken = new Set<string>();
      const candidates = free.filter((unit) => {
        const plot = plotOf(unit);
        if (plotsTaken.has(plot) || (held?.get(plot)?.size ?? 0) > 0) {
          return false;
        }
        plotsTaken.add(plot);
        return true;
      });
      for (const pick of spread(candidates.length, Math.max(0, Math.min(candidates.length, wanted)))) {
        add({ plotKey: candidates[pick], userId: next, overlap: true }, true);
      }
    });
  }
  return [...result.values()].sort((x, y) => position.get(x.plotKey)! - position.get(y.plotKey)! || (x.userId < y.userId ? -1 : 1));
}

/**
 * Moves what `from` has not done (holdingDone) to `to`.
 * - `to` does not hold the plot: they get it, main or copy as `from` had it. It stays
 *   with `from` (`notMoved`) when it would make `to` the main holder of a plot they
 *   checked, give them a copy of a plot whose main assessment they did, or (`plotOf`,
 *   own round) a copy of a second unit of a plot they hold a copy of.
 * - `from` had it as main and `to` as a copy: `to`'s copy becomes main, unless `to`
 *   already submitted the check; then the plot stays with `from` (`notMoved`).
 * - `from` had a copy and `to` holds it as main: the copy goes (`droppedChecks`), as
 *   nobody checks their own plot.
 * - otherwise `to` already holds it the same way, and `from` simply loses it.
 * `moved` counts the plots `from` gave up, apart from the dropped checks. What is done
 * (holdingDone) never moves: a copy whose main assessment `from` did stays theirs.
 */
export function moveUnfinished(
  holdings: readonly PlotAssignment[],
  from: string,
  to: string,
  submittedBy: SubmittedBy,
  plotOf: (unit: string) => string = (unit) => unit,
): { plots: PlotAssignment[]; moved: number; notMoved: number; droppedChecks: number } {
  const copiesOf = holdings.map((a) => ({ ...a }));
  const toRows = new Map(copiesOf.filter((a) => a.userId === to).map((a) => [a.plotKey, a]));
  // The plots `to` holds copies of: through which units.
  const toCopyUnits = new Map<string, Set<string>>();
  const addCopyUnit = (unit: string) => {
    const plot = plotOf(unit);
    let units = toCopyUnits.get(plot);
    if (!units) {
      units = new Set();
      toCopyUnits.set(plot, units);
    }
    units.add(unit);
  };
  for (const a of toRows.values()) {
    if (a.overlap) {
      addCopyUnit(a.plotKey);
    }
  }
  const plots: PlotAssignment[] = [];
  let moved = 0;
  let notMoved = 0;
  let droppedChecks = 0;
  for (const a of copiesOf) {
    if (a.userId !== from || holdingDone(submittedBy, a)) {
      plots.push(a);
      continue;
    }
    const theirs = toRows.get(a.plotKey);
    const by = submittedBy.get(a.plotKey);
    if (!theirs) {
      const keep = a.overlap
        ? by?.main.has(to) === true || [...(toCopyUnits.get(plotOf(a.plotKey)) ?? [])].some((u) => u !== a.plotKey)
        : by?.check.has(to) === true && !by.main.has(to);
      if (keep) {
        plots.push(a);
        notMoved += 1;
        continue;
      }
      const row: PlotAssignment = { ...a, userId: to };
      toRows.set(a.plotKey, row);
      if (row.overlap) {
        addCopyUnit(row.plotKey);
      }
      plots.push(row);
      moved += 1;
    } else if (a.overlap && !theirs.overlap) {
      droppedChecks += 1;
    } else if (!a.overlap && theirs.overlap) {
      if (by?.check.has(to) && !by.main.has(to)) {
        plots.push(a);
        notMoved += 1;
      } else {
        theirs.overlap = false;
        delete theirs.sampledAt;
        toCopyUnits.get(plotOf(a.plotKey))?.delete(a.plotKey);
        moved += 1;
      }
    } else {
      moved += 1;
    }
  }
  return { plots, moved, notMoved, droppedChecks };
}

/** A submitted record: saved with "Submit" in Collect Earth, not deleted. */
function isSubmitted(r: RecordRow): boolean {
  return r.activelySaved && !r.deleted;
}

/**
 * The quality-check copy holders of a file's plots, for recordRound: plot -> the
 * usernames holding it only as a copy (overlap, and not also as a main plot).
 */
export function copyHoldersOf(
  holdings: readonly PlotAssignment[],
  usernames: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const pair = (a: PlotAssignment) => JSON.stringify([a.plotKey, a.userId]);
  const main = new Set(holdings.filter((a) => !a.overlap).map(pair));
  const result = new Map<string, Set<string>>();
  for (const a of holdings) {
    const username = usernames.get(a.userId);
    if (!a.overlap || username === undefined || main.has(pair(a))) {
      continue;
    }
    let set = result.get(a.plotKey);
    if (!set) {
      set = new Set();
      result.set(a.plotKey, set);
    }
    set.add(username);
  }
  return result;
}

/**
 * The user ids that submitted each plot of a file, the main assessment apart from
 * the check. A record is a person's when its operator is their username (joining sets
 * the Collect Earth operator name to it). `plotIds` are the file's plot units, `info`
 * the project's RoundInfo and `copyHolders` the file's copyHoldersOf: records "17,1"
 * and "17,2" both belong to plot 17, one main and one check.
 */
export function submittedByPlot(
  records: readonly RecordRow[],
  plotIds: ReadonlySet<string>,
  userIdByUsername: ReadonlyMap<string, string>,
  info: RoundInfo | null,
  copyHolders: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): Map<string, { main: Set<string>; check: Set<string> }> {
  // The units each username holds as a copy: a check record goes to that one.
  const copyUnits = copyUnitsByUser(copyHolders);
  const result = new Map<string, { main: Set<string>; check: Set<string> }>();
  for (const r of records) {
    const userId = userIdByUsername.get(r.operator);
    if (!userId || !isSubmitted(r)) {
      continue;
    }
    const plot = unitOfRecord(r.recordKey, plotIds, info, copyUnits.get(r.operator));
    if (plot === null) {
      continue;
    }
    let entry = result.get(plot);
    if (!entry) {
      entry = { main: new Set(), check: new Set() };
      result.set(plot, entry);
    }
    const { assessment } = recordRound(r, info, copyHolders, plot);
    (assessment === 'check' ? entry.check : entry.main).add(userId);
  }
  return result;
}

/**
 * Whether a check record has a key of its own: the files people get carry a round (the round the
 * server added, or an own round with its reassessment code), so "17,2" is a check whoever holds
 * the plot. Otherwise only who holds the copy tells a check from a first assessment ("17").
 */
export function checksHaveOwnKey(info: RoundInfo | null): boolean {
  if (info?.state === 'added') return true;
  return info?.state === 'own' && info.reassessmentCode !== null && keyShape(info).roundIndex !== null;
}

/**
 * What a division and a move keep with a copy's holder (Task 22 review, B3): the plots submitted
 * (submittedByPlot), and, when check records have no key of their own (checksHaveOwnKey), the
 * checks a copy holder has begun (a draft, not deleted): moved or dealt to someone else, that
 * draft would read as a second first assessment of the plot. The summaries keep counting the
 * submitted ones only.
 */
export function keptBy(
  submitted: SubmittedBy,
  records: readonly RecordRow[],
  plotIds: ReadonlySet<string>,
  userIdByUsername: ReadonlyMap<string, string>,
  info: RoundInfo | null,
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>,
): SubmittedBy {
  if (checksHaveOwnKey(info)) return submitted;
  const copyUnits = copyUnitsByUser(copyHolders);
  let result: Map<string, Submitters> | null = null;
  for (const r of records) {
    if (r.activelySaved || r.deleted) continue;
    const userId = userIdByUsername.get(r.operator);
    if (!userId) continue;
    const plot = unitOfRecord(r.recordKey, plotIds, info, copyUnits.get(r.operator));
    if (plot === null || recordRound(r, info, copyHolders, plot).assessment !== 'check') continue;
    result ??= new Map(submitted);
    const was = result.get(plot);
    if (was?.check.has(userId)) continue;
    result.set(plot, { main: was?.main ?? new Set(), check: new Set([...(was?.check ?? []), userId]) });
  }
  return result ?? submitted;
}

/**
 * The copies one person is served as main: those whose MAIN assessment they submitted
 * (a second main submitter, e.g. after a whole file was divided). Their file shows
 * them the plot they already assessed instead of asking for a check. `records` may be
 * anyone's: only the person's (operator = `username`) count.
 */
export function copiesSubmittedAsMain(
  records: readonly RecordRow[],
  userId: string,
  username: string,
  plots: { plotKeys: readonly string[]; copyKeys: readonly string[] },
  info: RoundInfo | null,
): Set<string> {
  if (plots.copyKeys.length === 0) {
    return new Set();
  }
  const mine = records.filter((r) => r.operator === username);
  const copyHolders = new Map(plots.copyKeys.map((k) => [k, new Set([username])]));
  const units = new Set([...plots.plotKeys, ...plots.copyKeys]);
  const submitted = submittedByPlot(mine, units, new Map([[username, userId]]), info, copyHolders);
  return new Set(plots.copyKeys.filter((k) => submitted.get(k)?.main.has(userId) === true));
}

export interface PersonShare {
  userId: string;
  username: string;
  /** Includes the overlap copies. */
  plots: number;
  overlap: number;
  /** Of the copies, those the check sampling drew (Task 13); the others came with the division. */
  sampled: number;
  /** Of the copies, those of reference plots (Task 14): every collector has them, they are no checks to decide. */
  reference: number;
  submitted: number;
}

export interface DistributionSummary {
  distribution: StoredDistribution | null;
  plotCount: number;
  unassigned: number;
  people: PersonShare[];
}

/**
 * What GET /distribution answers. Holdings of plots no longer in the file are not
 * counted. People come in the division's order, then the others by name.
 */
export function summarize(
  distribution: StoredDistribution | null,
  plotIds: readonly string[],
  holdings: readonly PlotAssignment[],
  submittedBy: SubmittedBy,
  usernames: ReadonlyMap<string, string>,
  reference: ReadonlySet<string> = new Set(),
): DistributionSummary {
  const inFile = new Set(plotIds);
  // A plot is assigned when someone holds it as main: a copy alone leaves it unassigned.
  const held = new Set<string>();
  const people = new Map<string, PersonShare>();
  const share = (userId: string): PersonShare => {
    let s = people.get(userId);
    if (!s) {
      s = { userId, username: usernames.get(userId) ?? userId, plots: 0, overlap: 0, sampled: 0, reference: 0, submitted: 0 };
      people.set(userId, s);
    }
    return s;
  };
  if (distribution) {
    divisionPeople(distribution).filter((u) => usernames.has(u)).forEach(share);
  }
  for (const a of holdings) {
    if (!inFile.has(a.plotKey)) {
      continue;
    }
    if (!a.overlap) {
      held.add(a.plotKey);
    }
    const s = share(a.userId);
    s.plots += 1;
    if (a.overlap) {
      s.overlap += 1;
      if (a.sampledAt !== undefined) {
        s.sampled += 1;
      }
      if (reference.has(a.plotKey)) {
        s.reference += 1;
      }
    }
    if (holdingDone(submittedBy, a)) {
      s.submitted += 1;
    }
  }
  const ordered = distribution ? divisionPeople(distribution) : [];
  const rank = (u: string) => {
    const i = ordered.indexOf(u);
    return i < 0 ? ordered.length : i;
  };
  return {
    distribution,
    plotCount: plotIds.length,
    unassigned: plotIds.length - held.size,
    people: [...people.values()].sort((x, y) => rank(x.userId) - rank(y.userId) || x.username.localeCompare(y.username)),
  };
}

/**
 * Summary keys that are bookkeeping, not answers: a key the survey outline does not
 * know is never compared by the quality figures when its name contains any of these.
 */
export const METADATA_KEY_PARTS = ['operator', 'actively_saved', 'saved_on', 'modified', 'created', 'timestamp', 'skipped', '_time'];
