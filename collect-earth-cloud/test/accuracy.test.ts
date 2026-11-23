import { describe, expect, it } from 'vitest';
import { accuracyTargetOf, DEFAULT_ACCURACY_TARGET, judge, MIN_VERDICT, trendOf, verdictOf, wilson, worst } from '../src/accuracy.js';

describe('wilson: the 95% margin of a share', () => {
  it('stays inside 0..1 and narrows as more are compared', () => {
    const ten = wilson(10, 9)!;
    expect(ten.low).toBeCloseTo(0.596, 3);
    expect(ten.high).toBeCloseTo(0.982, 3);
    const many = wilson(300, 270)!;
    expect(many.low).toBeCloseTo(0.861, 3);
    expect(many.high).toBeCloseTo(0.929, 3);
    expect(many.high - many.low).toBeLessThan(ten.high - ten.low);
  });

  it('is exact at the ends, and null with nothing compared', () => {
    expect(wilson(8, 8)!.high).toBe(1);
    expect(wilson(8, 8)!.low).toBeCloseTo(0.676, 3);
    expect(wilson(8, 0)!.low).toBe(0);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe('verdictOf: a share against the target', () => {
  it('says below only when the whole margin is under the target', () => {
    // 2 of 10: 6% to 51%, all of it under 80%
    expect(verdictOf(10, 2, 80)).toBe('below');
    // 7 of 10: under the target, but its margin (40% to 89%) reaches it
    expect(verdictOf(10, 7, 80)).toBe('watch');
    expect(verdictOf(10, 8, 80)).toBe('ok');
    expect(verdictOf(300, 225, 80)).toBe('below');
    expect(verdictOf(300, 232, 80)).toBe('watch');
  });

  it('never says below nor ok before MIN_VERDICT are compared', () => {
    expect(MIN_VERDICT).toBe(5);
    expect(verdictOf(4, 0, 80)).toBe('watch');
    expect(verdictOf(5, 0, 80)).toBe('below');
    expect(verdictOf(4, 4, 80)).toBe('early');
    expect(verdictOf(5, 5, 80)).toBe('ok');
    expect(verdictOf(0, 0, 80)).toBeNull();
  });

  it('takes a target of 100% as met only by everything right', () => {
    expect(verdictOf(20, 20, 100)).toBe('ok');
    // One wrong answer already puts the whole margin under 100% (it ends at 99%)...
    expect(verdictOf(20, 19, 100)).toBe('below');
    // ...but not before MIN_VERDICT are compared.
    expect(verdictOf(4, 3, 100)).toBe('watch');
  });

  it('gives the margin and the verdict together', () => {
    expect(judge(0, 0, 80)).toEqual({ low: null, high: null, verdict: null });
    const j = judge(10, 2, 80);
    expect(j.verdict).toBe('below');
    expect(j.high).toBeLessThan(0.8);
  });
});

describe('worst, trendOf and accuracyTargetOf', () => {
  it('picks the most worrying verdict', () => {
    expect(worst(['ok', 'early', 'watch'])).toBe('watch');
    expect(worst(['watch', 'below', 'ok'])).toBe('below');
    expect(worst(['early', null])).toBe('early');
    expect(worst([null])).toBeNull();
  });

  it('says a trend only with enough answers on both sides, a step of ten points, and beyond chance', () => {
    expect(trendOf({ compared: 40, agreeing: 20 }, { compared: 20, agreeing: 18 })).toBe('better');
    expect(trendOf({ compared: 20, agreeing: 18 }, { compared: 40, agreeing: 20 })).toBe('worse');
    // One answer more of twenty: under the step.
    expect(trendOf({ compared: 20, agreeing: 16 }, { compared: 20, agreeing: 17 })).toBe('same');
    // 60% to 85% of twenty answers each is a step, but twenty answers can do that by chance: no clear change.
    expect(trendOf({ compared: 20, agreeing: 12 }, { compared: 20, agreeing: 17 })).toBe('same');
    expect(trendOf({ compared: 60, agreeing: 36 }, { compared: 60, agreeing: 51 })).toBe('better');
    expect(trendOf({ compared: 9, agreeing: 0 }, { compared: 20, agreeing: 20 })).toBeNull();
    expect(trendOf(null, { compared: 20, agreeing: 20 })).toBeNull();
  });

  it('reads the target from the settings, the default otherwise', () => {
    expect(accuracyTargetOf({})).toBe(DEFAULT_ACCURACY_TARGET);
    expect(accuracyTargetOf({ accuracyTarget: 90 })).toBe(90);
    expect(accuracyTargetOf({ accuracyTarget: 12 })).toBe(80);
    expect(accuracyTargetOf({ accuracyTarget: 85.5 })).toBe(80);
  });
});
