// The review queue as a list (docs/plans/2026-11-20-review-at-scale.md, A1): one line per plot, to search, sort and
// page through hundreds of plots, and to pick many for one decision (decisions:apply). The plots waiting are the
// queue's (src/reviewQueue.ts, the same rules: a reviewer's own plots left out, reference plots hidden); the decided
// ones are added when asked for (`state`), so a decision can be found and changed from the list too.
// Pure: the route gives it the queue, the pairs, the flags and the decisions as they are now.
import type { Flag, FlagKind } from './flags.js';
import { plotOrder, type DifferingPairs } from './quality.js';
import type { QueueItem, QueueKind } from './reviewQueue.js';
import type { DecisionKind } from './types.js';
import type { QueueSection, ReviewListSort, ReviewListState } from './wire/review.js';

export type { ReviewListSort, ReviewListState } from './wire/review.js';

export const REVIEW_LIST_STATES: readonly ReviewListState[] = ['waiting', 'decided', 'all'];
export const REVIEW_LIST_SORTS: readonly ReviewListSort[] = ['queue', 'plot', 'person', 'kind'];
/** Lines of a page: at most */
export const MAX_REVIEW_LIST_LINES = 200;

/** A line of the list, before the route adds the decision as the dashboard shows it */
export interface ReviewLine {
  plot: string;
  /** Its part of the queue; null: decided and no longer waiting */
  section: QueueSection | null;
  /** Why it is there: 'difference', the kinds of its flags, 'resubmitted' (sorted, once each) */
  kinds: string[];
  /** Everyone whose record is in it, sorted */
  people: string[];
  /** Its checks whose answers differ from the first assessment */
  checks: number;
}

export interface ReviewListInput {
  /** The queue, filtered by person and kind (reviewQueue), in its order */
  queue: readonly QueueItem[];
  pairs: DifferingPairs;
  /** Everyone's flags as listed (newest first), for the kinds of a decided plot */
  flags: readonly Flag[];
  /** The decisions as they are now: plot → decision and when */
  decided: ReadonlyMap<string, { decision: DecisionKind; at: number }>;
  /** Who has a record of a decided plot (the figures' records) */
  operatorsOf: (plot: string) => Iterable<string>;
  /** Plots never listed (a reviewer's own, reference plots) */
  left?: ReadonlySet<string>;
}

export interface ReviewListQuery {
  state: ReviewListState;
  person: string | null;
  kind: QueueKind | null;
  /** Part of the plot id, any case */
  q: string | null;
  sort: ReviewListSort;
  descending: boolean;
  offset: number;
  limit: number;
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The lines asked for, and how many match the query in all */
export function reviewList(input: ReviewListInput, query: ReviewListQuery): { lines: ReviewLine[]; total: number } {
  const lines: (ReviewLine & { order: number; decidedAt: number | null })[] = [];
  const waiting = new Set<string>();
  if (query.state !== 'decided') {
    input.queue.forEach((item, order) => {
      waiting.add(item.plot);
      const kinds = new Set<string>(item.section === 'flag' ? [] : [item.section]);
      if (item.pairs.length > 0) kinds.add('difference');
      for (const f of item.flags) kinds.add(f.kind);
      lines.push({ plot: item.plot, section: item.section, kinds: [...kinds].sort(byName), people: item.people, checks: item.pairs.length, order, decidedAt: null });
    });
  }
  if (query.state !== 'waiting') {
    // The decided plots not waiting again (a plot saved again after its decision is in the queue)
    const pairsOf = new Map<string, number[]>();
    for (let i = 0; i < input.pairs.plot.length; i++) {
      const plot = input.pairs.plot[i];
      if (!input.decided.has(plot)) continue;
      const list = pairsOf.get(plot);
      if (list) list.push(i);
      else pairsOf.set(plot, [i]);
    }
    const flagsOf = new Map<string, Set<FlagKind>>();
    for (const f of input.flags) {
      if (!input.decided.has(f.plot)) continue;
      const kinds = flagsOf.get(f.plot) ?? new Set<FlagKind>();
      kinds.add(f.kind);
      flagsOf.set(f.plot, kinds);
    }
    const queued = new Set(input.queue.map((i) => i.plot));
    for (const [plot, d] of input.decided) {
      if (queued.has(plot) || input.left?.has(plot)) continue;
      const pairs = pairsOf.get(plot) ?? [];
      const people = new Set(input.operatorsOf(plot));
      for (const i of pairs) people.add(input.pairs.people[input.pairs.first[i]]).add(input.pairs.people[input.pairs.check[i]]);
      const kinds = new Set<string>(flagsOf.get(plot) ?? []);
      if (pairs.length > 0) kinds.add('difference');
      const line = { plot, section: null, kinds: [...kinds].sort(byName), people: [...people].sort(byName), checks: pairs.length, order: Number.MAX_SAFE_INTEGER, decidedAt: d.at };
      if (query.person !== null && !line.people.includes(query.person)) continue;
      if (query.kind !== null && query.kind !== 'resubmitted' && !line.kinds.includes(query.kind)) continue;
      if (query.kind === 'resubmitted') continue;
      lines.push(line);
    }
  }
  const q = query.q?.trim().toLowerCase() ?? '';
  const matching = q === '' ? lines : lines.filter((l) => l.plot.toLowerCase().includes(q));
  const compare = comparer(query.sort);
  matching.sort((a, b) => (query.descending ? -compare(a, b) : compare(a, b)) || plotOrder(a.plot, b.plot));
  const page = matching.slice(query.offset, query.offset + query.limit).map(({ order: _order, decidedAt: _at, ...line }) => line);
  return { lines: page, total: matching.length };
}

type Sortable = ReviewLine & { order: number; decidedAt: number | null };

function comparer(sort: ReviewListSort): (a: Sortable, b: Sortable) => number {
  switch (sort) {
    case 'plot':
      return (a, b) => plotOrder(a.plot, b.plot);
    case 'person':
      return (a, b) => byName(a.people[0] ?? '', b.people[0] ?? '');
    case 'kind':
      return (a, b) => byName(a.kinds[0] ?? '', b.kinds[0] ?? '');
    default:
      // The queue's order, then the decided plots, the latest decided first
      return (a, b) => a.order - b.order || (b.decidedAt ?? 0) - (a.decidedAt ?? 0);
  }
}
