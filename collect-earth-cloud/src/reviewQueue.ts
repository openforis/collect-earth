// The review queue (Task 7): one list of the plots worth a decision, for coordinators and
// reviewers, in the order they are best worked through:
// 1. plots whose check differs from the first assessment, without a decision (plot order);
// 2. plots with pattern flags (Task 5) without a decision, newest flag first; a decided plot
//    only for "saved again after a decision" (deciding again takes it out);
// 3. plots decided "both need another look" that were submitted again since (newest first).
// A plot is listed once, in the first part it belongs to, with everything known about it.
// Pages go by a cursor (the last plot seen and its place in the order), so plots decided by
// someone else meanwhile make no plot skipped.
// Pure: the routes give it the figures' pairs, the flags and the decisions as they are now.
import { FLAG_KINDS, type Flag, type FlagKind, type Resubmitted } from './flags.js';
import { plotOrder, type DifferingPairs } from './quality.js';
import type { DecisionKind } from './types.js';

export type QueueSection = 'difference' | 'flag' | 'resubmitted';
const SECTIONS: readonly QueueSection[] = ['difference', 'flag', 'resubmitted'];
/** What the queue can be filtered by: a part, or a kind of flag. */
export const QUEUE_KINDS = ['difference', ...FLAG_KINDS, 'resubmitted'] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export interface QueueItem {
  plot: string;
  section: QueueSection;
  /** Everyone whose record is shown: first assessors, checkers, flagged people, those who submitted again; sorted. */
  people: string[];
  /** The plot's differing pairs, as indexes into the pairs, in their order. */
  pairs: number[];
  /** Its flags in the queue, newest first. */
  flags: Flag[];
  /** Who submitted it again after "both need another look", newest first. */
  resubmitted: Resubmitted[];
}

export interface QueueInput {
  pairs: DifferingPairs;
  /** The flags as listed (patternFlags: newest first), for the filters asked. */
  flags: readonly Flag[];
  /** Everyone's flags, for the person menu (default: `flags`). */
  everyonesFlags?: readonly Flag[];
  resubmitted: readonly Resubmitted[];
  /** The decisions as they are now, by plot. */
  decided: ReadonlyMap<string, DecisionKind>;
}

export interface QueueFilter {
  person?: string | null;
  kind?: QueueKind | null;
}

export type QueueCounts = Record<QueueSection, number>;

export interface ReviewQueue {
  /** Every plot of the queue that matches the filter, in order. */
  items: QueueItem[];
  /** Of those, how many in each part. */
  counts: QueueCounts;
  /** Everyone named in the whole queue, whatever the filters (for the person filter), sorted. */
  people: string[];
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Whether a flag is in the queue: its plot has no decision, or was saved again after it. */
const inQueue = (f: Flag, decided: ReadonlyMap<string, DecisionKind>) => !decided.has(f.plot) || f.kind === 'edited_after_decision';

/** The review queue of a project, filtered. */
export function reviewQueue(input: QueueInput, filter: QueueFilter): ReviewQueue {
  const { pairs, decided } = input;
  const items = new Map<string, QueueItem & { names: Set<string> }>();
  const itemOf = (plot: string, section: QueueSection) => {
    let item = items.get(plot);
    if (!item) {
      item = { plot, section, people: [], pairs: [], flags: [], resubmitted: [], names: new Set() };
      items.set(plot, item);
    }
    return item;
  };
  const people = new Set<string>();
  // 1. Differences without a decision (the pairs are in plot order).
  for (let i = 0; i < pairs.plot.length; i++) {
    const plot = pairs.plot[i];
    if (decided.has(plot)) continue;
    const item = itemOf(plot, 'difference');
    item.pairs.push(i);
    item.names.add(pairs.people[pairs.first[i]]).add(pairs.people[pairs.check[i]]);
  }
  // 2. Flags of plots without a decision, or saved again after one.
  for (const f of input.flags) {
    if (!inQueue(f, decided)) continue;
    const item = itemOf(f.plot, 'flag');
    item.flags.push(f);
    item.names.add(f.operator);
  }
  // 3. Submitted again after "both need another look".
  for (const r of input.resubmitted) {
    if (decided.get(r.plot) !== 'recheck') continue;
    const item = itemOf(r.plot, 'resubmitted');
    item.resubmitted.push(r);
    item.names.add(r.operator);
  }
  for (const item of items.values()) for (const name of item.names) people.add(name);
  for (const f of input.everyonesFlags ?? []) if (inQueue(f, decided)) people.add(f.operator);

  const all: QueueItem[] = [];
  for (const section of SECTIONS) {
    const part: QueueItem[] = [];
    for (const item of items.values()) {
      if (item.section !== section) continue;
      const { names, ...rest } = item;
      part.push({ ...rest, people: [...names].sort(byName) });
    }
    part.sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
    all.push(...part);
  }

  const person = filter.person ?? null;
  const kind = filter.kind ?? null;
  const matches = (item: QueueItem): boolean => {
    if (person !== null && !item.people.includes(person)) return false;
    if (kind === null) return true;
    if (kind === 'difference' || kind === 'resubmitted') return item.section === kind;
    return item.flags.some((f) => f.kind === (kind as FlagKind));
  };
  const listed = all.filter(matches);
  const counts: QueueCounts = { difference: 0, flag: 0, resubmitted: 0 };
  for (const item of listed) counts[item.section] += 1;
  return { items: listed, counts, people: [...people].sort(byName) };
}

/** A plot's place in the queue's order: its part, then (flags, submitted again) newest first, then the plot. */
interface QueueKey {
  section: number;
  at: number | null;
  plot: string;
}

function keyOf(item: QueueItem): QueueKey {
  const at = item.section === 'flag' ? item.flags[0]?.at ?? null : item.section === 'resubmitted' ? item.resubmitted[0]?.at ?? null : null;
  return { section: SECTIONS.indexOf(item.section), at, plot: item.plot };
}

function compareKeys(a: QueueKey, b: QueueKey): number {
  if (a.section !== b.section) return a.section - b.section;
  if (a.section !== 0) {
    // Newest first; a time not known last.
    const x = a.at ?? -Infinity;
    const y = b.at ?? -Infinity;
    if (x !== y) return y - x;
    return byName(a.plot, b.plot);
  }
  return plotOrder(a.plot, b.plot);
}

/** The cursor of a plot of the queue: "<part>:<time or empty>:<plot>". */
export function queueCursor(item: QueueItem): string {
  const key = keyOf(item);
  return `${item.section}:${key.at ?? ''}:${item.plot}`;
}

/** A cursor read back, or null when it is not one. */
export function parseCursor(cursor: string): QueueKey | null {
  const first = cursor.indexOf(':');
  const second = first < 0 ? -1 : cursor.indexOf(':', first + 1);
  if (second < 0) return null;
  const section = SECTIONS.indexOf(cursor.slice(0, first) as QueueSection);
  const atText = cursor.slice(first + 1, second);
  const plot = cursor.slice(second + 1);
  if (section < 0 || plot === '' || (atText !== '' && !/^-?\d{1,16}(\.\d+)?$/.test(atText))) return null;
  return { section, at: atText === '' ? null : Number(atText), plot };
}

/** The plots after a cursor, in order (the cursor's plot itself is not listed again, decided or not). */
export function itemsAfter(items: readonly QueueItem[], cursor: QueueKey): QueueItem[] {
  return items.filter((item) => compareKeys(keyOf(item), cursor) > 0);
}

/** The bulk decisions a coordinator can make (Task 7). */
export const BULK_RULES = ['first_by_reviewer', 'check_by_reviewer'] as const;
export type BulkRule = (typeof BULK_RULES)[number];

/**
 * The plots a bulk rule decides, among the differing plots without a decision, in plot order.
 * `trusted`: the usernames whose assessment is taken (the project's reviewers and coordinators,
 * as members are now).
 * - first_by_reviewer: the first assessment is a trusted person's and no differing check is
 *   (with both sides trusted, which is right is not clear): decided "first";
 * - check_by_reviewer: the plot's latest check (the one a decision for the check takes) differs,
 *   is a trusted person's, and the first assessment is not: decided "check".
 */
export function bulkPlots(
  pairs: DifferingPairs,
  decided: ReadonlyMap<string, DecisionKind>,
  trusted: ReadonlySet<string>,
  rule: BulkRule,
): { plot: string; decision: 'first' | 'check' }[] {
  const byPlot = new Map<string, number[]>();
  for (let i = 0; i < pairs.plot.length; i++) {
    const plot = pairs.plot[i];
    if (decided.has(plot)) continue;
    const list = byPlot.get(plot);
    if (list) list.push(i);
    else byPlot.set(plot, [i]);
  }
  const name = (index: number) => pairs.people[index];
  const out: { plot: string; decision: 'first' | 'check' }[] = [];
  for (const [plot, list] of byPlot) {
    const firstTrusted = trusted.has(name(pairs.first[list[0]]));
    if (rule === 'first_by_reviewer') {
      if (firstTrusted && !list.some((i) => trusted.has(name(pairs.check[i])))) out.push({ plot, decision: 'first' });
    } else {
      const latest = list.find((i) => pairs.latest[i] === 1);
      if (!firstTrusted && latest !== undefined && trusted.has(name(pairs.check[latest]))) out.push({ plot, decision: 'check' });
    }
  }
  return out;
}
