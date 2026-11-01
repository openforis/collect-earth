import { describe, expect, it } from 'vitest';
import type { RoundInfo } from '../src/cep.js';
import { addDays, daysBetween, isDate, isTimeZone, localDate } from '../src/days.js';
import {
  dailyOf,
  differencesWaiting,
  forecastOf,
  MAX_ATTENTION_PEOPLE,
  progressReport,
  type AttentionInput,
  type ProgressInput,
  type ProgressRecord,
  type ProgressTotals,
} from '../src/progress.js';
import type { MemberActivity, ProgressSettings } from '../src/types.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const defaults: ProgressSettings = { deadline: null, targetPlots: null, quietDays: 3 };
const added: RoundInfo = {
  state: 'added',
  refusal: null,
  keyCount: 2,
  roundIndex: 1,
  roundCodes: [
    { code: '1', label: 'First' },
    { code: '2', label: 'Check' },
  ],
  reassessmentCode: '2',
};
const own: RoundInfo = { ...added, state: 'own' };

function input(over: Partial<ProgressInput> = {}): ProgressInput {
  return {
    now: NOW,
    timeZone: 'UTC',
    days: 30,
    records: [],
    info: null,
    units: new Set(),
    copyHolders: new Map(),
    mainHolders: new Map(),
    fileUnits: new Map(),
    assignments: [],
    settings: defaults,
    ...over,
  };
}

/** A record; submitted ones were first submitted at `first` (default: a day before NOW). */
const rec = (recordKey: string, operator: string, activelySaved = true, deleted = false, first: number | null = NOW - DAY): ProgressRecord => ({
  recordKey,
  operator,
  activelySaved,
  deleted,
  modifiedOn: NOW - DAY,
  firstSubmittedOn: activelySaved ? first : null,
});

function activity(userId: string, over: Partial<MemberActivity> = {}): MemberActivity {
  return {
    userId,
    lastSeenAt: null,
    lastSyncAt: null,
    lastPlotsDownloadAt: null,
    lastCepDownloadAt: null,
    syncsCount: 0,
    recordsReceived: 0,
    clientAgent: null,
    ...over,
  };
}

const attentionBase: AttentionInput = { members: [], activity: [], unsentDelays: [], cep: null, storage: null, differencesWaiting: null };

describe('days in a time zone', () => {
  it('validates time zones: the supported list, UTC, IANA aliases; never offsets or junk', () => {
    expect(isTimeZone('Europe/Rome')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    for (const bad of ['', '+05:30', 'Mars/Olympus', 'Europe/Rome; DROP', 42, null, 'x'.repeat(100)]) {
      expect(isTimeZone(bad), String(bad)).toBe(false);
    }
  });

  it('the local day of an instant, across a DST change', () => {
    // Rome goes from CEST (+2) to CET (+1) at 03:00 on 25 October 2026.
    expect(localDate(Date.parse('2026-10-24T22:30:00Z'), 'Europe/Rome')).toBe('2026-10-25');
    expect(localDate(Date.parse('2026-10-25T22:30:00Z'), 'Europe/Rome')).toBe('2026-10-25');
    expect(localDate(Date.parse('2026-10-25T23:30:00Z'), 'Europe/Rome')).toBe('2026-10-26');
    expect(localDate(Date.parse('2026-10-25T23:30:00Z'), 'UTC')).toBe('2026-10-25');
  });

  it('calendar arithmetic', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-01', '2026-11-11')).toBe(10);
    expect(daysBetween('2026-11-11', '2026-11-01')).toBe(-10);
    expect(isDate('2026-02-28')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-2-3')).toBe(false);
  });
});

describe('totals per plot unit', () => {
  it('plots, assigned (whole files and divided ones), submitted, started and not started', () => {
    const units = new Set(['1', '2', '3', '4', '5', '6']);
    const p = progressReport(
      input({
        units,
        fileUnits: new Map([
          ['whole', ['1', '2', '3']],
          ['divided', ['4', '5', '6']],
        ]),
        assignments: [{ csvFileId: 'whole', username: 'ana' }],
        mainHolders: new Map([
          ['4', new Set(['bo'])],
          ['5', new Set<string>()],
          ['6', new Set<string>()],
        ]),
        records: [
          rec('1', 'ana'),
          rec('2', 'ana', false),
          rec('3', 'ana', true, true), // deleted
          rec('4', 'bo', false),
          rec('4', 'bo2', true), // a second main record of 4: submitted wins
          rec('99', 'ana'), // in no file
        ],
      }),
    );
    expect(p.totals).toEqual({ plots: 6, assigned: 4, notAssigned: 2, submitted: 2, started: 1, notStarted: 3 });
  });

  it('round 1 only: checks (the reassessment code, or a copy) are not counted', () => {
    const p = progressReport(
      input({
        info: added,
        units: new Set(['1', '2']),
        records: [rec('1,1', 'ana'), rec('1,2', 'bo'), rec('2,2', 'bo')],
      }),
    );
    expect(p.totals).toMatchObject({ plots: 2, submitted: 1, started: 0, notStarted: 1 });

    const none = progressReport(
      input({
        units: new Set(['1', '2']),
        copyHolders: new Map([['2', new Set(['bo'])]]),
        records: [rec('2', 'bo')],
      }),
    );
    expect(none.totals.submitted).toBe(0);
  });

  it('an own round: the re-assessment units of the file are checks, not plots', () => {
    const p = progressReport(input({ info: own, units: new Set(['1,1', '1,2', '2,1']), records: [rec('1,1', 'ana')] }));
    expect(p.totals).toMatchObject({ plots: 2, submitted: 1, notStarted: 1 });
  });
});

describe('daily buckets', () => {
  it('fills every day of the window, folds days after today into today; the line starts with the days before', () => {
    const days = dailyOf(
      new Map([
        ['2026-10-01', 9], // before the window
        ['2026-10-30', 2],
        ['2026-11-01', 3],
        ['2026-11-02', 1], // a clock ahead
      ]),
      '2026-11-01',
      7,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(days.map((d) => d.submitted)).toEqual([0, 0, 0, 0, 2, 0, 4]);
    expect(days.map((d) => d.cumulative)).toEqual([9, 9, 9, 9, 11, 11, 15]);
  });

  it('plots submitted now, once each, on the day of the earliest first submission of a first assessment; checks never', () => {
    const at = (iso: string) => Date.parse(iso);
    const p = progressReport(
      input({
        info: added,
        days: 14,
        units: new Set(['1', '2', '3', '4']),
        records: [
          rec('1,1', 'ana', true, false, at('2026-10-28T10:00:00Z')),
          rec('1,1', 'bo', true, false, at('2026-10-30T10:00:00Z')), // the same plot again: counted once, on the 28th
          rec('1,2', 'cy', true, false, at('2026-10-31T10:00:00Z')), // a check: no bar
          rec('2,1', 'ana', true, false, null), // no event known: its modifiedOn (31 Oct)
          rec('3,1', 'ana', false), // a draft
          rec('4,1', 'ana', true, true, at('2026-10-29T10:00:00Z')), // deleted
        ],
      }),
    );
    expect(p.totals.submitted).toBe(2);
    expect(p.daily.filter((d) => d.submitted > 0).map((d) => [d.date, d.submitted])).toEqual([
      ['2026-10-28', 1],
      ['2026-10-31', 1],
    ]);
    expect(p.daily.reduce((s, d) => s + d.submitted, 0)).toBe(p.totals.submitted);
    expect(p.daily.at(-1)!.cumulative).toBe(p.totals.submitted);
  });

  it('a plot first submitted before the window is in the line from its start', () => {
    const p = progressReport(input({ days: 14, units: new Set(['1', '2']), records: [rec('1', 'ana', true, false, NOW - 40 * DAY), rec('2', 'ana')] }));
    expect(p.daily[0].cumulative).toBe(1);
    expect(p.daily.at(-1)!.cumulative).toBe(2);
  });

  it('days across a DST change are calendar days of the time zone', () => {
    // In Rome the 25th of October 2026 has 25 hours.
    const at = (iso: string) => Date.parse(iso);
    const p = progressReport(
      input({
        now: at('2026-10-26T10:00:00Z'),
        timeZone: 'Europe/Rome',
        days: 3,
        units: new Set(['1', '2', '3']),
        records: [
          rec('1', 'ana', true, false, at('2026-10-24T22:30:00Z')), // the 25th in Rome
          rec('2', 'ana', true, false, at('2026-10-25T22:30:00Z')), // still the 25th
          rec('3', 'ana', true, false, at('2026-10-25T23:30:00Z')), // the 26th
        ],
      }),
    );
    expect(p.today).toBe('2026-10-26');
    expect(p.daily).toEqual([
      { date: '2026-10-24', submitted: 0, cumulative: 0 },
      { date: '2026-10-25', submitted: 2, cumulative: 2 },
      { date: '2026-10-26', submitted: 1, cumulative: 3 },
    ]);
  });
});

describe('forecast', () => {
  const totals = (over: Partial<ProgressTotals>): ProgressTotals => ({ plots: 1000, assigned: 800, notAssigned: 200, submitted: 100, started: 0, notStarted: 900, ...over });
  const pace = (perDay: number) => dailyOf(new Map([...Array(14)].map((_, i) => [addDays('2026-11-01', -i), perDay] as [string, number])), '2026-11-01', 30);

  it('the pace of the last 14 days, the days left and the end date; the target is every assigned plot', () => {
    const f = forecastOf(totals({}), pace(10), '2026-11-01', defaults, '2026-09-01');
    expect(f).toMatchObject({ target: 800, targetFrom: 'assigned', remaining: 700, pacePerDay: 10, paceDays: 14, daysLeft: 70, endDate: '2027-01-10' });
    expect(f).toMatchObject({ deadline: null, daysToDeadline: null, daysOver: null, neededPerDay: null });
  });

  it('a collection younger than 14 days: the pace over the days since its first plot', () => {
    const daily = dailyOf(new Map([['2026-10-29', 6], ['2026-11-01', 2]]), '2026-11-01', 30);
    expect(forecastOf(totals({}), daily, '2026-11-01', defaults, '2026-10-29')).toMatchObject({ paceDays: 4, pacePerDay: 2 });
    expect(forecastOf(totals({}), daily, '2026-11-01', defaults, '2026-11-03')).toMatchObject({ paceDays: 1 });
    expect(forecastOf(totals({}), pace(0), '2026-11-01', defaults, null)).toMatchObject({ paceDays: 14, pacePerDay: 0 });
  });

  it('with a deadline: days over and plots a day needed', () => {
    const f = forecastOf(totals({}), pace(10), '2026-11-01', { ...defaults, deadline: '2026-12-31', targetPlots: 500 }, '2026-09-01');
    expect(f).toMatchObject({ target: 500, targetFrom: 'setting', remaining: 400, daysLeft: 40, endDate: '2026-12-11', daysToDeadline: 60 });
    expect(f.daysOver).toBe(-20);
    expect(f.neededPerDay).toBe(Math.ceil(400 / 61));
  });

  it('no pace: no end date; done: 0 days left; a deadline passed needs nothing a day', () => {
    expect(forecastOf(totals({}), pace(0), '2026-11-01', defaults, '2026-09-01')).toMatchObject({ daysLeft: null, endDate: null });
    expect(forecastOf(totals({ submitted: 800 }), pace(0), '2026-11-01', defaults, '2026-09-01')).toMatchObject({ remaining: 0, daysLeft: 0, endDate: '2026-11-01' });
    expect(forecastOf(totals({}), pace(10), '2026-11-01', { ...defaults, deadline: '2026-10-01' }, '2026-09-01')).toMatchObject({ daysToDeadline: -31, neededPerDay: null });
  });
});

describe('needs attention', () => {
  const members = [
    { userId: 'u-ana', username: 'ana', role: 'operator' as const },
    { userId: 'u-bo', username: 'bo', role: 'operator' as const },
    { userId: 'u-cy', username: 'cy', role: 'operator' as const },
    { userId: 'u-di', username: 'di', role: 'admin' as const },
  ];
  const base = (attention: Partial<AttentionInput>, over: Partial<ProgressInput> = {}) =>
    progressReport(
      input({
        units: new Set(['1', '2', '3', '4']),
        fileUnits: new Map([['f', ['1', '2', '3']]]),
        mainHolders: new Map(),
        assignments: [
          { csvFileId: 'f', username: 'ana' },
          { csvFileId: 'f', username: 'bo' },
          { csvFileId: 'f', username: 'cy' },
        ],
        ...over,
        attention: { ...attentionBase, members, ...attention },
      }),
    ).attention!;

  it('a reviewer gets none', () => {
    expect(progressReport(input()).attention).toBeNull();
  });

  it('quiet people: plots left and no sync for quietDays; never downloaded apart; done people are not quiet', () => {
    const items = base({
      activity: [
        activity('u-ana', { lastSyncAt: NOW - 4 * DAY, lastPlotsDownloadAt: NOW - 10 * DAY }),
        activity('u-bo', { lastSyncAt: NOW - 1 * DAY }),
        activity('u-di', { lastSyncAt: NOW - 30 * DAY }), // no plots
      ],
    });
    expect(items.find((i) => i.kind === 'quiet')).toEqual({
      kind: 'quiet',
      count: 1,
      quietDays: 3,
      people: [{ username: 'ana', lastSyncAt: NOW - 4 * DAY, lastPlotsDownloadAt: NOW - 10 * DAY }],
    });
    expect(items.find((i) => i.kind === 'neverDownloaded')).toEqual({ kind: 'neverDownloaded', count: 1, people: [{ username: 'cy' }] });
    expect(items.find((i) => i.kind === 'notAssigned')).toEqual({ kind: 'notAssigned', count: 1 });

    const done = base(
      { activity: [activity('u-ana', { lastSyncAt: NOW - 9 * DAY }), activity('u-bo', { lastSyncAt: NOW }), activity('u-cy', { lastSyncAt: NOW })] },
      { records: ['1', '2', '3'].map((k) => rec(k, 'ana')) },
    );
    expect(done.find((i) => i.kind === 'quiet')).toBeUndefined();
  });

  it('quiet counts from the later of the last sync and the last plot download (plots given after the last sync)', () => {
    const items = base(
      {
        activity: [
          activity('u-ana', { lastPlotsDownloadAt: NOW - 6 * DAY }), // never synced
          activity('u-bo', { lastSyncAt: NOW - 9 * DAY, lastPlotsDownloadAt: NOW - DAY }), // new plots yesterday
          activity('u-cy', { lastSyncAt: NOW }),
        ],
      },
      { settings: { ...defaults, quietDays: 5 } },
    );
    expect(items.find((i) => i.kind === 'quiet')).toMatchObject({ quietDays: 5, people: [{ username: 'ana', lastSyncAt: null, lastPlotsDownloadAt: NOW - 6 * DAY }] });
  });

  it('people holding only quality-check copies: never downloaded, quiet, and done when their checks are in', () => {
    const over = { assignments: [], copyHolders: new Map([['1', new Set(['bo'])], ['2', new Set(['cy'])]]) };
    const items = base({ activity: [activity('u-bo', { lastSyncAt: NOW - 5 * DAY })] }, over);
    expect(items.find((i) => i.kind === 'neverDownloaded')).toMatchObject({ people: [{ username: 'cy' }] });
    expect(items.find((i) => i.kind === 'quiet')).toMatchObject({ people: [{ username: 'bo' }] });
    const checked = base({ activity: [activity('u-bo', { lastSyncAt: NOW - 5 * DAY })] }, { ...over, records: [rec('1', 'bo')] });
    expect(checked.find((i) => i.kind === 'quiet')).toBeUndefined();
  });

  it('old unsent work: a median wait over 2 days', () => {
    const items = base({
      unsentDelays: [
        { operator: 'ana', medianMs: 3 * DAY, uploads: 4 },
        { operator: 'bo', medianMs: DAY, uploads: 10 },
      ],
    });
    expect(items.find((i) => i.kind === 'oldUnsentWork')).toEqual({ kind: 'oldUnsentWork', count: 1, people: [{ username: 'ana', medianDelayMs: 3 * DAY }] });
  });

  it('differences waiting, and storage near or over its limit', () => {
    expect(base({ differencesWaiting: 3 }).find((i) => i.kind === 'differencesWaiting')).toEqual({ kind: 'differencesWaiting', count: 3 });
    expect(base({ differencesWaiting: 0 }).find((i) => i.kind === 'differencesWaiting')).toBeUndefined();
    expect(base({ storage: { usedBytes: 89, limitBytes: 100 } }).find((i) => i.kind === 'storage')).toBeUndefined();
    expect(base({ storage: { usedBytes: 90, limitBytes: 100 } }).find((i) => i.kind === 'storage')).toMatchObject({ level: 'nearlyFull' });
    expect(base({ storage: { usedBytes: 101, limitBytes: 100 } }).find((i) => i.kind === 'storage')).toMatchObject({ level: 'over' });
    expect(base({ storage: { usedBytes: 1e12, limitBytes: null } }).find((i) => i.kind === 'storage')).toBeUndefined();
  });

  it('an old project file: downloaded before it was last replaced, by people who hold plots or have synced', () => {
    const items = base({
      cep: { bytes: 10, updatedAt: NOW - DAY },
      activity: [
        activity('u-ana', { lastCepDownloadAt: NOW - 2 * DAY }),
        activity('u-bo', { lastCepDownloadAt: NOW }),
        activity('u-di', { lastCepDownloadAt: NOW - 2 * DAY }), // a coordinator with no plots who never synced
      ],
    });
    expect(items.find((i) => i.kind === 'oldProjectFile')).toEqual({ kind: 'oldProjectFile', count: 1, people: [{ username: 'ana' }] });
  });

  it('an old Collect Earth: only with checks; unknown agents are counted apart, never as old', () => {
    const acts = [
      activity('u-ana', { lastSyncAt: NOW, clientAgent: 'CollectEarth-cloud-sync' }),
      activity('u-bo', { lastSyncAt: NOW, clientAgent: 'CollectEarth/1.22.0 cloud-sync' }),
      activity('u-cy', { lastSyncAt: NOW, clientAgent: null }),
      activity('u-di', { lastSyncAt: NOW, clientAgent: 'CollectEarth-cloud-sync' }), // holds no plots
    ];
    expect(base({ activity: acts }).find((i) => i.kind === 'oldCollectEarth')).toBeUndefined();
    const withChecks = base({ activity: acts }, { copyHolders: new Map([['4', new Set(['bo'])]]) });
    expect(withChecks.find((i) => i.kind === 'oldCollectEarth')).toEqual({ kind: 'oldCollectEarth', count: 1, unknownVersion: 1, people: [{ username: 'ana' }] });
  });

  it('names at most MAX_ATTENTION_PEOPLE people, in name order; the count says how many', () => {
    const many = [...Array(MAX_ATTENTION_PEOPLE + 5)].map((_, i) => ({ userId: `u${i}`, username: `p${String(i).padStart(3, '0')}`, role: 'operator' as const }));
    const p = progressReport(
      input({
        units: new Set(['1']),
        fileUnits: new Map([['f', ['1']]]),
        assignments: many.map((m) => ({ csvFileId: 'f', username: m.username })),
        attention: { ...attentionBase, members: [...many].reverse() },
      }),
    );
    const never = p.attention!.find((i) => i.kind === 'neverDownloaded') as { count: number; people: { username: string }[] };
    expect(never.count).toBe(MAX_ATTENTION_PEOPLE + 5);
    expect(never.people).toHaveLength(MAX_ATTENTION_PEOPLE);
    expect(never.people[0].username).toBe('p000');
  });

  it('differencesWaiting: listed plots without a decision, and those beyond the list', () => {
    const report = { plotsDiffering: 5, differences: [{ plot: 'a' }, { plot: 'a' }, { plot: 'b' }, { plot: 'c' }] };
    expect(differencesWaiting(report, new Set(['a', 'z']))).toBe(4);
  });
});
