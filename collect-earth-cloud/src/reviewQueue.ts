// The review queue (Task 7): one list of the plots worth a decision, for coordinators and
// reviewers, in the order they are best worked through:
// 1. plots whose check differs from the first assessment, without a decision (plot order);
// 2. plots with pattern flags (Task 5) without a decision, newest flag first; a decided plot
//    only for "saved again after a decision" (deciding again takes it out);
// 3. plots decided "both need another look" that were submitted again since.
// A plot is listed once, in the first part it belongs to, with everything known about it.
// Pure: the routes give it the figures' pairs, the flags and the decisions as they are now.
import { FLAG_KINDS, type Flag, type FlagKind, type Resubmitted } from './flags.js';
import type { DifferingPairRef } from './quality.js';
import type { DecisionKind } from './types.js';

export type QueueSection = 'difference' | 'flag' | 'resubmitted';
/** What the queue can be filtered by: a part, or a kind of flag. */
export const QUEUE_KINDS = ['difference', ...FLAG_KINDS, 'resubmitted'] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export interface QueueItem {
  plot: string;
  section: QueueSection;
  /** Everyone whose record is shown: first assessors, checkers, flagged people, those who submitted again; sorted. */
  people: string[];
  /** The plot's differing pairs (first assessment and a check), in the report's order. */
  pairs: DifferingPairRef[];
  /** Its flags in the queue, newest first. */
  flags: Flag[];
  /** Who submitted it again after "both need another look", newest first. */
  resubmitted: Resubmitted[];
}

export interface QueueInput {
  pairs: readonly DifferingPairRef[];
  /** The flags as listed (patternFlags: newest first). */
  flags: readonly Flag[];
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
  /** Everyone named in the whole queue (for the person filter), sorted. */
  people: string[];
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The review queue of a project, filtered. */
export function reviewQueue(input: QueueInput, filter: QueueFilter): ReviewQueue {
  const items = new Map<string, QueueItem & { names: Set<string> }>();
  const itemOf = (plot: string, section: QueueSection) => {
    let item = items.get(plot);
    if (!item) {
      item = { plot, section, people: [], pairs: [], flags: [], resubmitted: [], names: new Set() };
      items.set(plot, item);
    }
    return item;
  };
  // 1. Differences without a decision (the pairs are in plot order).
  for (const p of input.pairs) {
    if (input.decided.has(p.plot)) continue;
    const item = itemOf(p.plot, 'difference');
    item.pairs.push(p);
    item.names.add(p.first.operator).add(p.check.operator);
  }
  // 2. Flags of plots without a decision, or saved again after one.
  for (const f of input.flags) {
    if (input.decided.has(f.plot) && f.kind !== 'edited_after_decision') continue;
    const item = itemOf(f.plot, 'flag');
    item.flags.push(f);
    item.names.add(f.operator);
  }
  // 3. Submitted again after "both need another look".
  for (const r of input.resubmitted) {
    if (input.decided.get(r.plot) !== 'recheck') continue;
    const item = itemOf(r.plot, 'resubmitted');
    item.resubmitted.push(r);
    item.names.add(r.operator);
  }

  const people = new Set<string>();
  const sections: QueueSection[] = ['difference', 'flag', 'resubmitted'];
  const all: QueueItem[] = [];
  for (const section of sections) {
    for (const item of items.values()) {
      if (item.section !== section) continue;
      for (const name of item.names) people.add(name);
      const { names, ...rest } = item;
      all.push({ ...rest, people: [...names].sort(byName) });
    }
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

/** The bulk decisions a coordinator can make (Task 7). */
export const BULK_RULES = ['first_by_reviewer', 'check_by_reviewer'] as const;
export type BulkRule = (typeof BULK_RULES)[number];

/**
 * The plots a bulk rule decides, among the differing plots without a decision, in plot order.
 * `trusted`: the usernames whose assessment is taken (the project's reviewers and coordinators).
 * - first_by_reviewer: the first assessment is a trusted person's and no differing check is
 *   (with both sides trusted, which is right is not clear): decided "first";
 * - check_by_reviewer: the plot's latest check (the one a decision for the check takes) differs,
 *   is a trusted person's, and the first assessment is not: decided "check".
 */
export function bulkPlots(
  pairs: readonly DifferingPairRef[],
  decided: ReadonlyMap<string, DecisionKind>,
  trusted: ReadonlySet<string>,
  rule: BulkRule,
): { plot: string; decision: 'first' | 'check' }[] {
  const byPlot = new Map<string, DifferingPairRef[]>();
  for (const p of pairs) {
    if (decided.has(p.plot)) continue;
    const list = byPlot.get(p.plot);
    if (list) list.push(p);
    else byPlot.set(p.plot, [p]);
  }
  const out: { plot: string; decision: 'first' | 'check' }[] = [];
  for (const [plot, list] of byPlot) {
    const firstTrusted = trusted.has(list[0].first.operator);
    if (rule === 'first_by_reviewer') {
      if (firstTrusted && !list.some((p) => trusted.has(p.check.operator))) out.push({ plot, decision: 'first' });
    } else {
      const latest = list.find((p) => p.latest);
      if (!firstTrusted && latest && trusted.has(latest.check.operator)) out.push({ plot, decision: 'check' });
    }
  }
  return out;
}
