import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { parsePlotFile } from '../src/plots.js';
import { fileKeyCount, keyShape, recordRound, splitKey, unitOfRecord } from '../src/rounds.js';

const phases = [
  { code: '1', label: 'First assessment' },
  { code: '2', label: 'Re-assessment' },
];
const added: RoundInfo = { state: 'added', refusal: null, keyCount: 2, roundIndex: 1, roundCodes: phases, reassessmentCode: '2' };
const ownYears: RoundInfo = {
  state: 'own',
  refusal: null,
  keyCount: 2,
  roundIndex: 1,
  roundCodes: [
    { code: '2025', label: '2025' },
    { code: '2', label: 'check' },
  ],
  reassessmentCode: null,
};
const ownWithCode: RoundInfo = { ...ownYears, reassessmentCode: '2' };
const none: RoundInfo = { state: 'none', refusal: 'several_keys', keyCount: 2, roundIndex: null, roundCodes: [], reassessmentCode: null };
const noCopies = new Map<string, Set<string>>();

describe('keyShape and fileKeyCount', () => {
  it('reads the shape of the served survey; no info is an id-only survey', () => {
    expect(keyShape(null)).toEqual({ count: 1, roundIndex: null });
    expect(keyShape(added)).toEqual({ count: 2, roundIndex: 1 });
    expect(keyShape(none)).toEqual({ count: 2, roundIndex: null });
    // An unreadable survey (no keys) still has the plot id.
    expect(keyShape({ ...none, keyCount: 0 })).toEqual({ count: 1, roundIndex: null });
  });

  it('counts the key columns of the uploaded plot file: the round the server added is not in it', () => {
    expect(fileKeyCount(null)).toBe(1);
    expect(fileKeyCount(added)).toBe(1);
    expect(fileKeyCount(ownYears)).toBe(2);
    expect(fileKeyCount(none)).toBe(2);
  });
});

describe('splitKey', () => {
  it('takes the round part out and joins the rest', () => {
    expect(splitKey('17,1', 2, 1)).toEqual({ plot: '17', round: '1' });
    expect(splitKey('17', 1, null)).toEqual({ plot: '17', round: null });
    expect(splitKey('17,2020', 2, null)).toEqual({ plot: '17,2020', round: null });
  });

  it('finds the round at index 1 of 3', () => {
    expect(splitKey('17,2,north', 3, 1)).toEqual({ plot: '17,north', round: '2' });
  });

  it('keeps extra parts in the plot, and has no round when the key is too short', () => {
    expect(splitKey('17,1,extra', 2, 1)).toEqual({ plot: '17,extra', round: '1' });
    expect(splitKey('17', 2, 1)).toEqual({ plot: '17', round: null });
  });
});

describe('recordRound', () => {
  const rec = (recordKey: string, operator = 'maria') => ({ recordKey, operator });

  it('added: round 1 is the main assessment and round 2 the check', () => {
    expect(recordRound(rec('17,1'), added, noCopies)).toEqual({ plot: '17', round: '1', assessment: 'main' });
    expect(recordRound(rec('17,2'), added, noCopies)).toEqual({ plot: '17', round: '2', assessment: 'check' });
    expect(recordRound(rec('17,3'), added, noCopies)).toEqual({ plot: '17', round: '3', assessment: 'other' });
  });

  it('own round with years: main without a reassessment code; with code 2, round 2 is the check', () => {
    expect(recordRound(rec('17,2025'), ownYears, noCopies)).toEqual({ plot: '17', round: '2025', assessment: 'main' });
    expect(recordRound(rec('17,2'), ownWithCode, noCopies)).toEqual({ plot: '17', round: '2', assessment: 'check' });
    expect(recordRound(rec('17,2025'), ownWithCode, noCopies)).toEqual({ plot: '17', round: '2025', assessment: 'main' });
  });

  it('own round without a reassessment code: the person holding a copy did the check', () => {
    const copies = new Map([['17,2025', new Set(['jose'])]]);
    expect(recordRound(rec('17,2025', 'jose'), ownYears, copies)).toEqual({ plot: '17', round: '2025', assessment: 'check' });
    expect(recordRound(rec('17,2025', 'maria'), ownYears, copies)).toEqual({ plot: '17', round: '2025', assessment: 'main' });
  });

  it('no round: virtual round 1 or 2, from who holds the plot as a quality-check copy', () => {
    const copies = new Map([['17', new Set(['jose'])]]);
    expect(recordRound(rec('17', 'maria'), null, copies)).toEqual({ plot: '17', round: '1', assessment: 'main' });
    expect(recordRound(rec('17', 'jose'), null, copies)).toEqual({ plot: '17', round: '2', assessment: 'check' });
    expect(recordRound(rec('18', 'jose'), null, copies)).toEqual({ plot: '18', round: '1', assessment: 'main' });
    const twoKeys = new Map([['17,2020', new Set(['jose'])]]);
    expect(recordRound(rec('17,2020', 'jose'), none, twoKeys)).toEqual({ plot: '17,2020', round: '2', assessment: 'check' });
  });
});

describe('unitOfRecord', () => {
  it('matches exactly: "17" does not catch "170,1" or "17x"', () => {
    const units = new Set(['17', '2']);
    expect(unitOfRecord('17,1', units, added)).toBe('17');
    expect(unitOfRecord('17,2', units, added)).toBe('17');
    expect(unitOfRecord('170,1', units, added)).toBeNull();
    expect(unitOfRecord('17x,1', units, added)).toBeNull();
    expect(unitOfRecord('17', units, null)).toBe('17');
    expect(unitOfRecord('17x', units, null)).toBeNull();
    expect(unitOfRecord('171', units, null)).toBeNull();
    expect(unitOfRecord('3,17', units, null)).toBeNull();
  });

  it('with no round in the key, matches every key column', () => {
    const units = new Set(['17,2020', '17,2021']);
    expect(unitOfRecord('17,2020', units, none)).toBe('17,2020');
    expect(unitOfRecord('17,2022', units, none)).toBeNull();
    expect(unitOfRecord('17', units, none)).toBeNull();
  });

  it('still matches a key with more parts than the survey has, by its key columns', () => {
    expect(unitOfRecord('17,2020', new Set(['17', '17a']), null)).toBe('17');
    expect(unitOfRecord('17a,x,y', new Set(['17', '17a']), null)).toBe('17a');
    expect(unitOfRecord('17,1,x', new Set(['17']), added)).toBe('17');
  });

  it('own round: the unit of the same plot and round; a check record matches the plot with any round', () => {
    const units = new Set(['17,2025', '18,2025', '18,2026']);
    expect(unitOfRecord('17,2025', units, ownWithCode)).toBe('17,2025');
    expect(unitOfRecord('18,2026', units, ownWithCode)).toBe('18,2026');
    // The served copy had its round replaced by the reassessment code.
    expect(unitOfRecord('17,2', units, ownWithCode)).toBe('17,2025');
    expect(unitOfRecord('17,2026', units, ownWithCode)).toBeNull();
    expect(unitOfRecord('17,2', units, ownYears)).toBeNull();
    expect(unitOfRecord('170,2', units, ownWithCode)).toBeNull();
    expect(unitOfRecord('17,2025,x', units, ownWithCode)).toBe('17,2025');
  });
});

describe('parsePlotFile with several key columns', () => {
  it('makes the plot id of the first keyCount fields joined by ","', () => {
    const data = Buffer.from('id,year,lat,lon\n17,2020,0,0\n17,2021,1,1\n17,2020,2,2\n', 'utf8');
    const file = parsePlotFile(data, 2);
    expect(file.rows.map((r) => r.id)).toEqual(['17,2020', '17,2021', '17,2020']);
    expect(file.plotIds).toEqual(['17,2020', '17,2021']);
    expect(parsePlotFile(data).plotIds).toEqual(['17']);
  });
});
