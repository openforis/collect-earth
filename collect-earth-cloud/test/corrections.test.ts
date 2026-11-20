import { describe, expect, it } from 'vitest';
import { correctionPlacemarkId, shareEvenly } from '../src/corrections.js';

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
});
