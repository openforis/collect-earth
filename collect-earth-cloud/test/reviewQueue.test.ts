import { describe, expect, it } from 'vitest';
import type { Flag, Resubmitted } from '../src/flags.js';
import type { DifferingPairRef } from '../src/quality.js';
import { bulkPlots, QUEUE_KINDS, reviewQueue, type QueueInput } from '../src/reviewQueue.js';
import type { DecisionKind } from '../src/types.js';

const pair = (plot: string, first: string, check: string, latest = true): DifferingPairRef => ({
  plot,
  first: { operator: first, recordKey: `${plot},1` },
  check: { operator: check, recordKey: `${plot},2` },
  latest,
});
const flag = (plot: string, operator: string, kind: Flag['kind'], at: number): Flag => ({
  kind,
  plot,
  operator,
  at,
  details: kind === 'very_fast' ? { gapMs: 5000, previousPlot: '0' } : kind === 'edited_after_decision' ? { decision: 'first', decidedAt: 1 } : { questions: [] },
});
const back = (plot: string, operator: string, at: number): Resubmitted => ({ plot, operator, at, decidedAt: 1 });

function input(extra: Partial<QueueInput> & { decisions?: [string, DecisionKind][] } = {}): QueueInput {
  return {
    pairs: extra.pairs ?? [],
    flags: extra.flags ?? [],
    resubmitted: extra.resubmitted ?? [],
    decided: new Map(extra.decisions ?? []),
  };
}

describe('reviewQueue: one queue', () => {
  const all = input({
    pairs: [pair('1', 'ana', 'ben'), pair('2', 'ana', 'ben'), pair('2', 'ana', 'carl'), pair('3', 'ana', 'ben'), pair('9', 'dan', 'ben')],
    flags: [
      flag('5', 'ana', 'very_fast', 900),
      flag('2', 'ana', 'very_fast', 800), // on a difference: shown with it
      flag('6', 'ben', 'required_empty', 700),
      flag('5', 'ana', 'required_empty', 600), // the same plot: one item
      flag('7', 'ana', 'very_fast', 500), // decided: not in the queue
      flag('8', 'ana', 'edited_after_decision', 400), // decided, saved again after: in the queue
    ],
    resubmitted: [back('4', 'ben', 300), back('4', 'ana', 200)],
    decisions: [
      ['3', 'first'],
      ['7', 'check'],
      ['8', 'first'],
      ['4', 'recheck'],
    ],
  });

  it('differences without a decision first (plot order), then plots with flags (newest first), then plots submitted again after "both need another look"', () => {
    const queue = reviewQueue(all, {});
    expect(queue.items.map((i) => [i.plot, i.section])).toEqual([
      ['1', 'difference'],
      ['2', 'difference'],
      ['9', 'difference'],
      ['5', 'flag'],
      ['6', 'flag'],
      ['8', 'flag'],
      ['4', 'resubmitted'],
    ]);
    expect(queue.counts).toEqual({ difference: 3, flag: 3, resubmitted: 1 });
    const two = queue.items[1];
    expect(two.pairs.map((p) => p.check.operator)).toEqual(['ben', 'carl']);
    expect(two.flags.map((f) => f.kind)).toEqual(['very_fast']);
    expect(two.people).toEqual(['ana', 'ben', 'carl']);
    expect(queue.items[3].flags.map((f) => f.kind)).toEqual(['very_fast', 'required_empty']);
    expect(queue.items[6]).toMatchObject({ plot: '4', people: ['ana', 'ben'], resubmitted: [back('4', 'ben', 300), back('4', 'ana', 200)] });
    expect(queue.people).toEqual(['ana', 'ben', 'carl', 'dan']);
  });

  it('filters by person (anyone whose record is shown) and by kind', () => {
    expect(reviewQueue(all, { person: 'carl' }).items.map((i) => i.plot)).toEqual(['2']);
    expect(reviewQueue(all, { person: 'ben' }).items.map((i) => i.plot)).toEqual(['1', '2', '9', '6', '4']);
    expect(reviewQueue(all, { kind: 'difference' }).items.map((i) => i.plot)).toEqual(['1', '2', '9']);
    expect(reviewQueue(all, { kind: 'very_fast' }).items.map((i) => i.plot)).toEqual(['2', '5']);
    expect(reviewQueue(all, { kind: 'resubmitted' }).items.map((i) => i.plot)).toEqual(['4']);
    const filtered = reviewQueue(all, { person: 'dan', kind: 'difference' });
    expect(filtered.counts).toEqual({ difference: 1, flag: 0, resubmitted: 0 });
    // The person menu lists everyone in the whole queue.
    expect(filtered.people).toEqual(['ana', 'ben', 'carl', 'dan']);
    expect(QUEUE_KINDS).toContain('very_fast');
  });

  it('an empty queue', () => {
    expect(reviewQueue(input(), {})).toEqual({ items: [], counts: { difference: 0, flag: 0, resubmitted: 0 }, people: [] });
  });
});

describe('bulkPlots: the two bulk rules', () => {
  const reviewers = new Set(['rita', 'cora']);
  const pairs = [
    pair('1', 'rita', 'ben'), // first a reviewer's: take the first
    pair('2', 'ana', 'rita'), // check a reviewer's: take the check
    pair('3', 'rita', 'cora'), // both: neither rule
    pair('4', 'ana', 'ben'), // neither
    pair('5', 'rita', 'ben'),
    pair('6', 'ana', 'rita', false), // the reviewer's check is not the latest: not taken
    pair('7', 'ana', 'ben', false),
    pair('7', 'ana', 'cora', true), // latest check a reviewer's
    pair('8', 'rita', 'ben', false),
    pair('8', 'rita', 'cora', true), // a reviewer's check differs too: not "first"
  ];

  it('first where the first assessment is a reviewer\'s and no differing check is; check where the latest check is and the first is not; only plots without a decision', () => {
    const decided = new Map<string, DecisionKind>([['5', 'recheck']]);
    expect(bulkPlots(pairs, decided, reviewers, 'first_by_reviewer')).toEqual([{ plot: '1', decision: 'first' }]);
    expect(bulkPlots(pairs, decided, reviewers, 'check_by_reviewer')).toEqual([
      { plot: '2', decision: 'check' },
      { plot: '7', decision: 'check' },
    ]);
    expect(bulkPlots(pairs, new Map(), reviewers, 'first_by_reviewer').map((p) => p.plot)).toEqual(['1', '5']);
    expect(bulkPlots(pairs, new Map(), new Set(), 'first_by_reviewer')).toEqual([]);
  });
});
