import { describe, expect, it } from 'vitest';
import type { PeopleTable, PersonRow } from '../src/people.js';
import type { OperatorWork, PlotUnits } from '../src/progress.js';
import type { QualityReport } from '../src/quality.js';
import { isIsoWeek, weekMonday, weekOfDate, weeklySummary } from '../src/weekly.js';

const work = (main: [string, number][], checks: [string, number][] = []): OperatorWork => ({
  mainSubmitted: new Map(main),
  mainDrafts: new Set(),
  checkSubmitted: new Map(checks),
  checkDrafts: new Set(),
  submissionTimes: [],
  mainSubmissionTimes: [],
});
const row = (userId: string, username: string): PersonRow => ({
  userId,
  username,
  role: 'operator',
  plots: { assigned: 10, submitted: 0, started: 0, remaining: 10, done: 0 },
  submittedLast7: 0,
  medianPerDay: null,
  lastSyncAt: null,
  lastPlotsDownloadAt: null,
  lastSubmittedAt: null,
  agreement: null,
  status: { kind: 'working' },
});

describe('ISO weeks', () => {
  it('the Monday of a week and the week of a day, across years', () => {
    expect(weekMonday('2026-W45')).toBe('2026-11-02');
    expect(weekOfDate('2026-11-08')).toBe('2026-W45');
    expect(weekOfDate('2026-11-09')).toBe('2026-W46');
    // 2027-01-01 is a Friday: still week 53 of 2026; 2026 has 53 weeks.
    expect(weekOfDate('2027-01-01')).toBe('2026-W53');
    expect(weekMonday('2026-W53')).toBe('2026-12-28');
    expect(weekMonday('2025-W01')).toBe('2024-12-30');
    expect(isIsoWeek('2026-W53')).toBe(true);
    expect(isIsoWeek('2025-W53')).toBe(false);
    for (const bad of ['2026-W00', '2026-W54', '2026-45', '2026W45', 'x', 45, null]) expect(isIsoWeek(bad), String(bad)).toBe(false);
  });
});

describe('the weekly summary', () => {
  // Week 45 of 2026 in Europe/Rome (UTC+1): Monday 2026-11-02 00:00 local is 2026-11-01 23:00 UTC.
  const sundayNightUtc = Date.UTC(2026, 10, 1, 23, 30); // Monday 00:30 in Rome: in the week
  const sundayEveningUtc = Date.UTC(2026, 10, 1, 22, 30); // Sunday 23:30 in Rome: the week before
  const wednesday = Date.UTC(2026, 10, 4, 10);
  const nextMonday = Date.UTC(2026, 10, 9, 8);
  const units = {
    totals: { plots: 20, assigned: 20, notAssigned: 0, submitted: 4, started: 1, notStarted: 15 },
    firstSubmitted: new Map([
      ['1', sundayEveningUtc],
      ['2', sundayNightUtc],
      ['3', wednesday],
      ['4', nextMonday],
    ]),
    started: new Set(['5']),
    held: new Map(),
    copies: new Map(),
    checksDone: new Set(),
    byOperator: new Map([
      ['maria', work([['1', sundayEveningUtc], ['2', sundayNightUtc], ['3', wednesday]])],
      ['ana', work([['4', nextMonday]], [['3', wednesday]])],
    ]),
  } as unknown as PlotUnits;
  const people = { people: [row('u1', 'ana'), row('u2', 'maria'), row('u3', 'zoe')] } as unknown as PeopleTable;
  const report = { weeks: [{ week: '2026-W45', compared: 25, agreeing: 20 }, { week: '2026-W44', compared: 5, agreeing: 5 }] } as unknown as QualityReport;

  it('the days of the week in the viewer\'s zone, before and by its end, each person\'s week, decisions and agreement', () => {
    const s = weeklySummary({
      week: '2026-W45',
      timeZone: 'Europe/Rome',
      now: Date.UTC(2026, 10, 5, 12),
      units,
      people,
      decisions: [
        { plot: '1', decision: 'first', comment: null, decidedBy: 'owner', decidedAt: wednesday },
        { plot: '2', decision: 'recheck', comment: null, decidedBy: 'owner', decidedAt: wednesday },
        { plot: '3', decision: 'check', comment: null, decidedBy: 'owner', decidedAt: nextMonday },
      ],
      quality: { report, computedAt: 1, stale: false },
      flags: { counts: { very_fast: 2, same_as_before: 0, required_empty: 1, edited_after_decision: 0, two_main: 0, no_plot: 0 }, total: 3 },
    });
    expect(s).toMatchObject({ week: '2026-W45', start: '2026-11-02', end: '2026-11-08', current: true });
    expect(s.progress.days.map((d) => [d.date, d.submitted, d.checks])).toEqual([
      ['2026-11-02', 1, 0],
      ['2026-11-03', 0, 0],
      ['2026-11-04', 1, 1],
      ['2026-11-05', 0, 0],
      ['2026-11-06', 0, 0],
      ['2026-11-07', 0, 0],
      ['2026-11-08', 0, 0],
    ]);
    expect(s.progress).toMatchObject({ submitted: 2, checks: 1, before: 1, byEnd: 3 });
    expect(s.people.map((p) => [p.username, p.submitted, p.checks])).toEqual([
      ['maria', 2, 0],
      ['ana', 0, 1],
      ['zoe', 0, 0],
    ]);
    expect(s.quality.decided).toEqual({ first: 1, check: 0, recheck: 1, total: 2 });
    expect(s.quality.week).toEqual({ compared: 25, agreeing: 20, rate: 0.8 });
    expect(s.quality.overall).toEqual({ compared: 30, agreeing: 25, rate: 25 / 30 });
    expect(s.quality.flags?.total).toBe(3);
  });

  it('without figures at hand: no agreement nor flags, the decisions still counted; a past week is not current', () => {
    const s = weeklySummary({ week: '2026-W44', timeZone: 'UTC', now: wednesday, units, people, decisions: [], quality: null, flags: null });
    expect(s.current).toBe(false);
    expect(s.quality).toEqual({ available: false, computedAt: null, stale: false, week: null, overall: null, decided: { first: 0, check: 0, recheck: 0, total: 0 }, flags: null });
    // In UTC, plot 1 (Sunday 22:30) and 2 (Sunday 23:30) are both in week 44.
    expect(s.progress.submitted).toBe(2);
  });
});
