import type { DivisionOrder, PlotAssignment, RecordRow, StoredDistribution } from './types.js';
import { plotOfRecordKey } from './plots.js';

/**
 * Dividing one plot file's plots between people: validating a request, computing
 * who gets which plot, moving unfinished plots, and the summaries the dashboard
 * shows. Pure functions; the routes load and save.
 */

export const MAX_OVERLAP_PERCENT = 50;

/** A division request after validation, before the plots are dealt. */
export type DivisionRequest = { mode: 'whole' } | Exclude<StoredDistribution, { mode: 'manual' }>;

/**
 * Validates a PUT /distribution body. `members` are the project's user ids, and
 * `columnCount` the widest row of the file. A mixed order without a seed gets
 * `newSeed()`. Returns the request, or the reason it is refused.
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
  const order: DivisionOrder | null = b.order === undefined || b.order === 'file' ? 'file' : b.order === 'mixed' ? 'mixed' : null;
  if (!order) {
    return { reason: "order must be 'file' or 'mixed'" };
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
function prng(seed: number): () => number {
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
 * Deals `plots` (in the order they are to be dealt) between `people`. A plot
 * submitted by one of them stays theirs (the first of them, if several; the others
 * keep it as a copy), and counts towards their share. The rest goes out in order:
 * person i the next chunk, so neighbouring plots stay together. Returns each
 * person's plots in dealing order, and the extra copies.
 */
function deal(
  plots: readonly string[],
  people: readonly string[],
  submittedBy: ReadonlyMap<string, ReadonlySet<string>>,
): { lists: string[][]; copies: PlotAssignment[] } {
  const index = new Map(people.map((p, i) => [p, i]));
  const owner = new Map<string, number>();
  const copies: PlotAssignment[] = [];
  const pinned = people.map(() => 0);
  for (const plot of plots) {
    const by = submittedBy.get(plot);
    if (!by) {
      continue;
    }
    const holders = [...by].map((u) => index.get(u)).filter((i): i is number => i !== undefined).sort((x, y) => x - y);
    if (holders.length > 0) {
      owner.set(plot, holders[0]);
      pinned[holders[0]] += 1;
      for (const other of holders.slice(1)) {
        copies.push({ plotKey: plot, userId: people[other], overlap: true });
      }
    }
  }
  const extra = shareSizes(pinned, plots.length - owner.size);
  const lists: string[][] = people.map(() => []);
  let person = 0;
  for (const plot of plots) {
    const pinnedTo = owner.get(plot);
    if (pinnedTo !== undefined) {
      lists[pinnedTo].push(plot);
      continue;
    }
    while (extra[person] === 0) {
      person += 1;
    }
    lists[person].push(plot);
    extra[person] -= 1;
  }
  return { lists, copies };
}

/** Which plots of a list of `count` become copies: ceil(percent) of them, spread evenly. */
export function overlapPicks(count: number, percent: number): number[] {
  if (count === 0 || percent <= 0) {
    return [];
  }
  const m = Math.min(count, Math.ceil((percent * count) / 100 - 1e-9));
  const picks: number[] = [];
  for (let j = 0; j < m; j += 1) {
    picks.push(Math.floor((j * count) / m));
  }
  return picks;
}

/**
 * Computes a division. `plotIds` are the file's plots in file order, `values` (for
 * mode column) each plot's value in the chosen column, and `submittedBy` the user
 * ids that submitted each plot. Each person's plots are in file order.
 */
export function divide(
  d: Exclude<StoredDistribution, { mode: 'manual' }>,
  plotIds: readonly string[],
  values: readonly string[] | null,
  submittedBy: ReadonlyMap<string, ReadonlySet<string>>,
): PlotAssignment[] {
  const position = new Map(plotIds.map((id, i) => [id, i]));
  const order = d.order === 'mixed' ? shuffled(plotIds, d.seed ?? 0) : [...plotIds];
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
  const add = (a: PlotAssignment): void => {
    const key = `${a.plotKey}\u0000${a.userId}`;
    const existing = result.get(key);
    if (!existing || (existing.overlap && !a.overlap)) {
      result.set(key, a);
    }
  };
  for (const group of groups) {
    const { lists, copies } = deal(group.plots, group.people, submittedBy);
    lists.forEach((list, i) => {
      list.sort((x, y) => position.get(x)! - position.get(y)!);
      const userId = group.people[i];
      for (const plot of list) {
        add({ plotKey: plot, userId, overlap: false });
      }
      // Quality-check copies go to the next person of the group, or of everyone
      // when the group has one person; nobody when there is only one in all.
      const next =
        group.people.length > 1
          ? group.people[(i + 1) % group.people.length]
          : everyone.length > 1
            ? everyone[(everyone.indexOf(userId) + 1) % everyone.length]
            : null;
      if (next) {
        for (const pick of overlapPicks(list.length, d.overlapPercent)) {
          add({ plotKey: list[pick], userId: next, overlap: true });
        }
      }
    });
    copies.forEach(add);
  }
  return [...result.values()].sort((x, y) => position.get(x.plotKey)! - position.get(y.plotKey)! || (x.userId < y.userId ? -1 : 1));
}

/**
 * Moves the plots `from` has not submitted to `to`; if `to` holds one already,
 * `from` simply loses it. Returns the new holdings and how many plots `from` lost.
 */
export function moveUnfinished(
  holdings: readonly PlotAssignment[],
  from: string,
  to: string,
  submittedBy: ReadonlyMap<string, ReadonlySet<string>>,
): { plots: PlotAssignment[]; moved: number } {
  const toHolds = new Set(holdings.filter((a) => a.userId === to).map((a) => a.plotKey));
  const plots: PlotAssignment[] = [];
  let moved = 0;
  for (const a of holdings) {
    if (a.userId !== from || submittedBy.get(a.plotKey)?.has(from)) {
      plots.push(a);
      continue;
    }
    moved += 1;
    if (!toHolds.has(a.plotKey)) {
      toHolds.add(a.plotKey);
      plots.push({ plotKey: a.plotKey, userId: to, overlap: a.overlap });
    }
  }
  return { plots, moved };
}

/** A submitted record: saved with "Submit" in Collect Earth, not deleted. */
function isSubmitted(r: RecordRow): boolean {
  return r.activelySaved && !r.deleted;
}

/**
 * The user ids that submitted each plot of a file. A record is a person's when its
 * operator is their username (joining sets the Collect Earth operator name to it).
 */
export function submittedByPlot(
  records: readonly RecordRow[],
  plotIds: ReadonlySet<string>,
  userIdByUsername: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const r of records) {
    const userId = userIdByUsername.get(r.operator);
    if (!userId || !isSubmitted(r)) {
      continue;
    }
    const plot = plotOfRecordKey(r.recordKey, plotIds);
    if (plot === null) {
      continue;
    }
    let set = result.get(plot);
    if (!set) {
      set = new Set();
      result.set(plot, set);
    }
    set.add(userId);
  }
  return result;
}

export interface PersonShare {
  userId: string;
  username: string;
  /** Includes the overlap copies. */
  plots: number;
  overlap: number;
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
  submittedBy: ReadonlyMap<string, ReadonlySet<string>>,
  usernames: ReadonlyMap<string, string>,
): DistributionSummary {
  const inFile = new Set(plotIds);
  const held = new Set<string>();
  const people = new Map<string, PersonShare>();
  const share = (userId: string): PersonShare => {
    let s = people.get(userId);
    if (!s) {
      s = { userId, username: usernames.get(userId) ?? userId, plots: 0, overlap: 0, submitted: 0 };
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
    held.add(a.plotKey);
    const s = share(a.userId);
    s.plots += 1;
    if (a.overlap) {
      s.overlap += 1;
    }
    if (submittedBy.get(a.plotKey)?.has(a.userId)) {
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
 * Summary keys that are bookkeeping, not answers: never compared by the overlap
 * report. A key is one when its name contains any of these.
 */
export const METADATA_KEY_PARTS = ['operator', 'actively_saved', 'saved_on', 'modified', 'created', 'timestamp', 'skipped', '_time'];
export const MAX_OVERLAP_ITEMS = 500;

function isMetadataKey(key: string): boolean {
  const k = key.toLowerCase();
  return METADATA_KEY_PARTS.some((part) => k.includes(part));
}

export interface OverlapReport {
  plots: number;
  differing: number;
  items: { recordKey: string; operators: string[]; fields: { key: string; values: Record<string, string> }[] }[];
}

/**
 * Plots submitted by two or more people, and those where their answers (summary
 * values) differ. A value missing for someone counts as "".
 */
export function overlapReport(records: readonly RecordRow[]): OverlapReport {
  const byKey = new Map<string, RecordRow[]>();
  for (const r of records) {
    if (!isSubmitted(r)) {
      continue;
    }
    const list = byKey.get(r.recordKey);
    if (list) {
      list.push(r);
    } else {
      byKey.set(r.recordKey, [r]);
    }
  }
  let plots = 0;
  const items: OverlapReport['items'] = [];
  for (const [recordKey, list] of byKey) {
    if (new Set(list.map((r) => r.operator)).size < 2) {
      continue;
    }
    plots += 1;
    list.sort((x, y) => x.operator.localeCompare(y.operator));
    const keys = [...new Set(list.flatMap((r) => Object.keys(r.summary)))].filter((k) => !isMetadataKey(k)).sort();
    const fields: OverlapReport['items'][number]['fields'] = [];
    for (const key of keys) {
      const values: Record<string, string> = {};
      for (const r of list) {
        values[r.operator] = r.summary[key] ?? '';
      }
      if (new Set(Object.values(values)).size > 1) {
        fields.push({ key, values });
      }
    }
    if (fields.length > 0) {
      items.push({ recordKey, operators: list.map((r) => r.operator), fields });
    }
  }
  items.sort((x, y) => x.recordKey.localeCompare(y.recordKey, undefined, { numeric: true }));
  return { plots, differing: items.length, items: items.slice(0, MAX_OVERLAP_ITEMS) };
}
