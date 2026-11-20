import { describe, expect, it } from 'vitest';
import { correctedAnswers, correctedStamp, correctionPlacemarkId, shareEvenly } from '../src/corrections.js';
import type { QualityCorrection } from '../src/types.js';

describe('corrections (pure)', () => {
  it('shares plots evenly, or to nobody', () => {
    expect(shareEvenly(['a', 'b', 'c'], ['u1', 'u2'])).toEqual([
      { plot: 'a', userId: 'u1' },
      { plot: 'b', userId: 'u2' },
      { plot: 'c', userId: 'u1' },
    ]);
    expect(shareEvenly(['a'], [])).toEqual([{ plot: 'a', userId: null }]);
  });

  it("a plot's id in to-correct.csv: the unit, with round 1 where the server added round", () => {
    expect(correctionPlacemarkId('17', 'added', 1)).toBe('17,1');
    expect(correctionPlacemarkId('17,north', 'added', 1)).toBe('17,1,north');
    expect(correctionPlacemarkId('17,2', 'own', 1)).toBe('17,2');
    expect(correctionPlacemarkId('17', 'none', null)).toBe('17');
    expect(correctionPlacemarkId('17', undefined, null)).toBe('17');
  });

  it("the corrections that are plots' answers: decided 'correct' now, corrected, never a reference plot's", () => {
    const c = (plot: string, correctedAt: number | null): QualityCorrection => ({
      plot, assignedTo: 'u', assignedToName: 'maria', assignedBy: 'owner', assignedAt: 1, correctedBy: correctedAt ? 'maria' : null, correctedAt,
      baseOperator: 'ana', recordKey: correctedAt ? `${plot},1` : null, summary: { lu: 'C' }, xml: null,
    });
    const decisions = [{ plot: '1', decision: 'correct' }, { plot: '2', decision: 'correct' }, { plot: '3', decision: 'first' }, { plot: '4', decision: 'correct' }];
    const out = correctedAnswers(decisions, [c('1', 10), c('2', null), c('3', 10), c('4', 10)], new Set(['4']));
    // 2 not corrected yet, 3 decided otherwise since, 4 a reference plot
    expect([...out.keys()]).toEqual(['1']);
    expect(out.get('1')).toMatchObject({ recordKey: '1,1', operator: 'maria', correctedAt: 10, summary: { lu: 'C' } });
    expect(correctedStamp(out)).not.toBe(correctedStamp(correctedAnswers(decisions, [c('1', 11)])));
  });
});
