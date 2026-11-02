import { describe, expect, it } from 'vitest';
import { localHour } from '../src/days.js';
import {
  MAX_LISTED_PLOTS,
  peopleTable,
  personDetail,
  SESSION_GAP_MS,
  speedOf,
  statusOf,
  VERY_FAST_MS,
  type PeopleInput,
} from '../src/people.js';
import { progressReport, type ProgressRecord } from '../src/progress.js';
import type { QualityReport } from '../src/quality.js';
import type { CsvFile, Member, MemberActivity, ProgressSettings } from '../src/types.js';

const DAY = 86_400_000;
const MIN = 60_000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const settings: ProgressSettings = { deadline: null, targetPlots: null, quietDays: 3 };

const member = (userId: string, username: string, role: Member['role'] = 'operator'): Member => ({ userId, username, role });
const file = (id: string, divided = false): CsvFile => ({ id, filename: `${id}.csv`, checksum: 'x', plotCount: 0, distribution: divided ? { mode: 'manual' } : null }) as CsvFile;
const act = (userId: string, over: Partial<MemberActivity> = {}): MemberActivity => ({
  userId,
  lastSeenAt: null,
  lastSyncAt: null,
  lastPlotsDownloadAt: null,
  lastCepDownloadAt: null,
  syncsCount: 0,
  recordsReceived: 0,
  clientAgent: null,
  ...over,
});
const rec = (recordKey: string, operator: string, activelySaved = true, first: number | null = NOW - DAY): ProgressRecord => ({
  recordKey,
  operator,
  activelySaved,
  deleted: false,
  modifiedOn: first ?? NOW - DAY,
  firstSubmittedOn: activelySaved ? first : null,
});

function input(over: Partial<PeopleInput> = {}): PeopleInput {
  return {
    now: NOW,
    timeZone: 'UTC',
    settings,
    records: [],
    info: null,
    units: new Set(),
    copyHolders: new Map(),
    mainHolders: new Map(),
    fileUnits: new Map(),
    assignments: [],
    members: [],
    activity: [],
    invites: [],
    files: [],
    cep: null,
    quality: null,
    decisions: [],
    ...over,
  };
}

/**
 * ana holds the whole file w (1-4); the divided file d (5-8) gives 5 and 6 to bo, 7 to
 * ana, 8 to nobody, and 5 to ana as a quality-check copy.
 */
function project(records: ProgressRecord[], over: Partial<PeopleInput> = {}): PeopleInput {
  return input({
    units: new Set(['1', '2', '3', '4', '5', '6', '7', '8']),
    fileUnits: new Map([
      ['w', ['1', '2', '3', '4']],
      ['d', ['5', '6', '7', '8']],
    ]),
    files: [file('w'), file('d', true)],
    assignments: [{ csvFileId: 'w', username: 'ana' }],
    mainHolders: new Map([
      ['5', new Set(['bo'])],
      ['6', new Set(['bo'])],
      ['7', new Set(['ana'])],
      ['8', new Set<string>()],
    ]),
    copyHolders: new Map([['5', new Set(['ana'])]]),
    members: [member('u-ana', 'ana'), member('u-bo', 'bo'), member('u-co', 'coord', 'admin')],
    activity: [act('u-ana', { lastSyncAt: NOW - DAY }), act('u-bo', { lastSyncAt: NOW - DAY })],
    records,
    ...over,
  });
}

describe('status chips', () => {
  const base = { now: NOW, quietDays: 3, holdsPlots: true, left: true, sentAnything: true, lastSyncAt: NOW - DAY, lastPlotsDownloadAt: null };
  it('no plots, finished, never started, working', () => {
    expect(statusOf({ ...base, holdsPlots: false })).toEqual({ kind: 'noPlots' });
    expect(statusOf({ ...base, left: false })).toEqual({ kind: 'finished' });
    expect(statusOf({ ...base, lastSyncAt: null })).toEqual({ kind: 'neverStarted' });
    expect(statusOf({ ...base, sentAnything: false })).toEqual({ kind: 'neverStarted' });
    expect(statusOf(base)).toEqual({ kind: 'working' });
  });

  it('quiet from N days on (amber), red after 2N; the later of the last sync and the last plot download counts', () => {
    expect(statusOf({ ...base, lastSyncAt: NOW - 3 * DAY })).toEqual({ kind: 'working' });
    expect(statusOf({ ...base, lastSyncAt: NOW - 3 * DAY - 1 })).toEqual({ kind: 'quiet', days: 3, level: 'amber' });
    expect(statusOf({ ...base, lastSyncAt: NOW - 6 * DAY })).toEqual({ kind: 'quiet', days: 6, level: 'amber' });
    expect(statusOf({ ...base, lastSyncAt: NOW - 6 * DAY - 1 })).toEqual({ kind: 'quiet', days: 6, level: 'red' });
    expect(statusOf({ ...base, lastSyncAt: NOW - 10 * DAY, lastPlotsDownloadAt: NOW - DAY })).toEqual({ kind: 'working' });
    // Never synced but downloaded their plots 4 days ago: quiet, even with nothing sent.
    expect(statusOf({ ...base, lastSyncAt: null, lastPlotsDownloadAt: NOW - 4 * DAY, sentAnything: false })).toEqual({ kind: 'quiet', days: 4, level: 'amber' });
    // Finished people are never quiet.
    expect(statusOf({ ...base, left: false, lastSyncAt: NOW - 30 * DAY })).toEqual({ kind: 'finished' });
  });
});

describe('speed', () => {
  it('gaps under 30 min between consecutive submissions; a longer gap starts a new session', () => {
    const t0 = NOW - DAY;
    const s = speedOf([t0 + 10_000, t0, t0 + 70_000, t0 + 70_000 + SESSION_GAP_MS, t0 + 70_000 + SESSION_GAP_MS + 5 * MIN]);
    expect(s.submissions).toBe(5);
    expect(s.sessions).toBe(2);
    // 10 s, 60 s, then (new session) 5 min.
    expect(s.gaps).toBe(3);
    expect(s.medianGapMs).toBe(60_000);
    expect(s.veryFast).toBe(1);
    expect(s.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1, 0, 1, 0]);
    expect(s.buckets.at(-1)!.upToMs).toBe(SESSION_GAP_MS);
  });

  it('a gap of just under 15 s is very fast, 15 s is not; a gap of exactly 30 min splits', () => {
    const s = speedOf([0, VERY_FAST_MS - 1, 2 * VERY_FAST_MS - 1, 2 * VERY_FAST_MS - 1 + SESSION_GAP_MS]);
    expect(s).toMatchObject({ gaps: 2, veryFast: 1, sessions: 2 });
    expect(speedOf([])).toMatchObject({ submissions: 0, sessions: 0, gaps: 0, medianGapMs: null, veryFast: 0 });
    expect(speedOf([5])).toMatchObject({ submissions: 1, sessions: 1, gaps: 0, medianGapMs: null });
  });
});

describe('the people table', () => {
  const records = [
    rec('1', 'ana', true, NOW - 2 * DAY),
    rec('2', 'ana', true, NOW - 10 * DAY),
    rec('3', 'ana', false),
    rec('5', 'bo', true, NOW - DAY),
    rec('5', 'ana', true, NOW - DAY), // ana's check of 5
    rec('6', 'bo', false),
    rec('7', 'bo', true, NOW), // bo submitted ana's plot 7
  ];

  it("per person: assigned, submitted, started, remaining and done, checks apart, as the Progress tab's totals count them", () => {
    const table = peopleTable(project(records));
    const ana = table.people.find((r) => r.username === 'ana')!;
    const bo = table.people.find((r) => r.username === 'bo')!;
    expect(ana.plots).toEqual({ assigned: 5, submitted: 2, started: 1, remaining: 2, done: 3 / 5 });
    expect(ana.checks).toEqual({ assigned: 1, submitted: 1, remaining: 0 });
    expect(bo.plots).toEqual({ assigned: 2, submitted: 2, started: 1, remaining: 1, done: 1 / 2 });
    expect(bo.checks).toEqual({ assigned: 0, submitted: 0, remaining: 0 });
    const totals = progressReport({ ...project(records), days: 30, settings }).totals;
    // Every plot submitted is someone's; nobody's check counts.
    expect(ana.plots.submitted + bo.plots.submitted).toBe(totals.submitted);
    expect(table.people.map((r) => r.username)).toEqual(['ana', 'bo', 'coord']);
    expect(table.people.find((r) => r.username === 'coord')!.status).toEqual({ kind: 'noPlots' });
  });

  it('the last 7 days, the median plots a day, the last submission, the status', () => {
    const table = peopleTable(project(records));
    const ana = table.people.find((r) => r.username === 'ana')!;
    expect(ana.submittedLast7).toBe(1);
    expect(ana.medianPerDay).toBe(1);
    expect(ana.lastSubmittedAt).toBe(NOW - DAY); // the check
    expect(ana.status).toEqual({ kind: 'working' });
    expect(ana.agreement).toBeNull();
    expect(table.quality).toEqual({ available: false, computedAt: null, stale: false });
  });

  it('the week: plots a day, the most and the least active', () => {
    const table = peopleTable(project(records));
    expect(table.week.days).toHaveLength(7);
    expect(table.week.days.at(-1)).toEqual({ date: '2026-11-01', submitted: 1 });
    expect(table.week.days.reduce((s, d) => s + d.submitted, 0)).toBe(3);
    expect(table.week.mostActive).toEqual([
      { userId: 'u-bo', username: 'bo', submitted: 2 },
      { userId: 'u-ana', username: 'ana', submitted: 1 },
    ]);
    expect(table.week.leastActive).toEqual([]);
    const quiet = peopleTable(project([]));
    expect(quiet.week.mostActive).toEqual([]);
    expect(quiet.week.leastActive.map((p) => p.username)).toEqual(['ana', 'bo']);
  });

  it('agreement from the quality figures at hand; the open invitation links', () => {
    const report = { people: [{ username: 'ana', asFirst: { compared: 25, agreeing: 20, rate: 0.8 }, asChecker: { compared: 0, agreeing: 0, rate: null }, weakest: [], personal: { asFirst: { compared: 21, agreeing: 17, rate: 17 / 21 }, confusions: [] } }] } as unknown as QualityReport;
    const table = peopleTable(
      project(records, {
        quality: { report, computedAt: NOW - MIN, stale: true },
        invites: [
          { id: 'i1', role: 'operator', usedCount: 1, maxUses: 5, expiresAt: null, createdAt: NOW - DAY },
          { id: 'i2', role: 'operator', usedCount: 0, maxUses: 1, expiresAt: null, createdAt: NOW },
        ],
        inviteFor: new Map([['i2', 'bo']]),
      }),
    );
    expect(table.people.find((r) => r.username === 'ana')!.agreement).toEqual({ compared: 25, agreeing: 20, rate: 0.8 });
    expect(table.people.find((r) => r.username === 'bo')!.agreement).toEqual({ compared: 0, agreeing: 0, rate: null });
    expect(table.quality).toEqual({ available: true, computedAt: NOW - MIN, stale: true });
    expect(table.invites).toEqual([
      { id: 'i1', role: 'operator', usedCount: 1, maxUses: 5, expiresAt: null, createdAt: NOW - DAY, forUsername: null },
      { id: 'i2', role: 'operator', usedCount: 0, maxUses: 1, expiresAt: null, createdAt: NOW, forUsername: 'bo' },
    ]);
  });
});

describe("a person's page", () => {
  const records = [
    rec('1', 'ana', true, Date.parse('2026-10-30T09:00:00Z')),
    rec('2', 'ana', true, Date.parse('2026-10-30T09:00:10Z')),
    rec('3', 'ana', false),
    rec('5', 'ana', true, Date.parse('2026-10-31T23:30:00Z')), // the check
    rec('7', 'bo', true, NOW),
  ];

  it('the calendar and the hours in the viewer’s time zone', () => {
    const utc = personDetail(project(records), 'u-ana', { self: false })!;
    expect(utc.calendar).toEqual([
      { date: '2026-10-30', plots: 2, checks: 0 },
      { date: '2026-10-31', plots: 0, checks: 1 },
    ]);
    expect(utc.hours[9]).toBe(2);
    expect(utc.hours[23]).toBe(1);
    const rome = personDetail(project(records, { timeZone: 'Europe/Rome' }), 'u-ana', { self: false })!;
    // 23:30 UTC on 31 October is 00:30 on 1 November in Rome (CET).
    expect(rome.calendar.at(-1)).toEqual({ date: '2026-11-01', plots: 0, checks: 1 });
    expect(rome.hours[0]).toBe(1);
    expect(rome.hours[10]).toBe(2);
    expect(localHour(Date.parse('2026-07-01T23:30:00Z'), 'Europe/Rome')).toBe(1);
  });

  it('files and plots with their status; the speed', () => {
    const d = personDetail(project(records), 'u-ana', { self: false })!;
    expect(d.files.map((f) => f.csvFileId)).toEqual(['w', 'd']);
    expect(d.files[0].plots).toEqual({ total: 4, submitted: 2, doneByOther: 0, started: 1, notStarted: 1 });
    expect(d.files[0].list.map((p) => `${p.plot}:${p.status}`)).toEqual(['1:submitted', '2:submitted', '3:started', '4:notStarted']);
    expect(d.files[1].plots).toEqual({ total: 1, submitted: 0, doneByOther: 1, started: 0, notStarted: 0 });
    expect(d.files[1].checks).toEqual({ total: 1, submitted: 1, started: 0, notStarted: 0 });
    expect(d.files[1].list).toEqual([
      { plot: '5', kind: 'check', status: 'submitted' },
      { plot: '7', kind: 'main', status: 'doneByOther' },
    ]);
    // The coordinator's page: first assessments only (the check is not), as the flags.
    expect(d.speed).toMatchObject({ submissions: 2, sessions: 1, gaps: 1, medianGapMs: 10_000, veryFast: 1 });
    // The project's threshold.
    expect(personDetail(project(records, { fastSeconds: 10 }), 'u-ana', { self: false })!.speed.veryFast).toBe(0);
    expect(personDetail(project(records, { fastSeconds: 11 }), 'u-ana', { self: false })!.speed.veryFast).toBe(1);
    // My work: plots and copies alike (checks stay blind).
    expect(personDetail(project(records), 'u-ana', { self: true })!.speed).toMatchObject({ submissions: 3, sessions: 2, gaps: 1 });
  });

  it('a long file lists at most MAX_LISTED_PLOTS plots, the counts are of all', () => {
    const ids = Array.from({ length: MAX_LISTED_PLOTS + 5 }, (_, i) => String(i + 1));
    const d = personDetail(
      input({ units: new Set(ids), fileUnits: new Map([['w', ids]]), files: [file('w')], assignments: [{ csvFileId: 'w', username: 'ana' }], members: [member('u-ana', 'ana')] }),
      'u-ana',
      { self: false },
    )!;
    expect(d.files[0].list).toHaveLength(MAX_LISTED_PLOTS);
    expect(d.files[0].truncated).toBe(true);
    expect(d.files[0].plots.notStarted).toBe(MAX_LISTED_PLOTS + 5);
  });

  it('sync health: an old project file, the Collect Earth version', () => {
    const d = personDetail(
      project(records, {
        cep: { bytes: 1, updatedAt: NOW - DAY },
        activity: [act('u-ana', { lastSyncAt: NOW - DAY, lastCepDownloadAt: NOW - 2 * DAY, clientAgent: 'CollectEarth/1.21.3 cloud-sync' })],
      }),
      'u-ana',
      { self: false },
    )!;
    expect(d.sync).toMatchObject({ oldProjectFile: true, cepUpdatedAt: NOW - DAY, collectEarth: { kind: 'collect-earth', version: '1.21.3' } });
    const never = personDetail(project(records, { activity: [] }), 'u-ana', { self: false })!;
    expect(never.sync).toMatchObject({ oldProjectFile: false, collectEarth: null, lastSyncAt: null, syncsCount: 0 });
    const old = personDetail(project(records, { activity: [act('u-ana', { lastSyncAt: NOW, clientAgent: 'CollectEarth-cloud-sync' })] }), 'u-ana', { self: false })!;
    expect(old.sync.collectEarth).toEqual({ kind: 'old-collect-earth', version: null });
  });

  it('quality: agreement, the plots to look at again; on My work only plots certainly theirs and no names', () => {
    const report = {
      people: [
        {
          username: 'ana',
          asFirst: { compared: 25, agreeing: 20, rate: 0.8 },
          asChecker: { compared: 22, agreeing: 22, rate: 1 },
          weakest: [],
          personal: { asFirst: { compared: 21, agreeing: 17, rate: 17 / 21 }, confusions: [] },
        },
      ],
    } as unknown as QualityReport;
    const decisions = [
      { plot: '1', decision: 'recheck' as const, comment: 'Look at the trees', decidedBy: 'coord', decidedAt: NOW - DAY },
      { plot: '2', decision: 'first' as const, comment: null, decidedBy: 'coord', decidedAt: NOW - DAY },
      { plot: '7', decision: 'recheck' as const, comment: null, decidedBy: 'coord', decidedAt: NOW }, // bo's record
    ];
    const over = { quality: { report, computedAt: NOW, stale: false }, decisions };
    const coordinator = personDetail(project(records, over), 'u-ana', { self: false })!;
    expect(coordinator.quality).toMatchObject({ available: true, asFirst: { rate: 0.8 }, asChecker: { rate: 1 } });
    expect(coordinator.quality.sentBack).toEqual([{ plot: '1', comment: 'Look at the trees', decidedAt: NOW - DAY, decidedBy: 'coord' }]);
    const mine = personDetail(project(records, over), 'u-ana', { self: true })!;
    expect(mine.quality.asFirst).toEqual({ compared: 21, agreeing: 17, rate: 17 / 21 });
    expect(mine.person.agreement).toEqual(mine.quality.asFirst);
    expect('asChecker' in mine.quality).toBe(false);
    expect(mine.quality.sentBack).toEqual([{ plot: '1', comment: 'Look at the trees', decidedAt: NOW - DAY }]);
    expect(personDetail(project(records), 'u-ana', { self: true })!.quality.asFirst).toBeNull();
  });

  it('the plots to look at again are only those where they made the first assessment', () => {
    const decisions = [
      { plot: '5', decision: 'recheck' as const, comment: 'edge', decidedBy: 'coord', decidedAt: NOW }, // bo first, ana's check
      { plot: '7', decision: 'recheck' as const, comment: null, decidedBy: 'coord', decidedAt: NOW }, // ana holds 7, bo assessed it
    ];
    const ana = personDetail(project(records, { decisions }), 'u-ana', { self: false })!;
    expect(ana.quality.sentBack).toEqual([]);
    expect(personDetail(project(records, { decisions }), 'u-ana', { self: true })!.quality.sentBack).toEqual([]);
    const bo = personDetail(project([...records, rec('5', 'bo', true, NOW - DAY)], { decisions }), 'u-bo', { self: false })!;
    expect(bo.quality.sentBack.map((d) => d.plot).sort()).toEqual(['5', '7']);
  });

  it('what removing them leaves behind: plots they alone hold, not submitted, and copies not checked', () => {
    expect(personDetail(project(records), 'u-ana', { self: false })!.removal).toEqual({ plots: 2, copies: 0 });
    // bo holds 5 and 6; ana holds 5 as a copy, not checked yet without her record.
    const noCheck = records.filter((r) => !(r.recordKey === '5' && r.operator === 'ana'));
    expect(personDetail(project(noCheck), 'u-ana', { self: false })!.removal).toEqual({ plots: 2, copies: 1 });
    expect(personDetail(project(noCheck), 'u-bo', { self: false })!.removal).toEqual({ plots: 2, copies: 0 });
    expect(personDetail(project(records), 'u-ana', { self: true })!.removal).toBeUndefined();
  });

  it('My work never tells which plots are quality checks: copies are counted, listed and drawn as plots', () => {
    const over = { quality: null, decisions: [{ plot: '1', decision: 'recheck' as const, comment: 'x', decidedBy: 'coord', decidedAt: NOW }] };
    const mine = personDetail(project(records, over), 'u-ana', { self: true })!;
    const text = JSON.stringify(mine);
    expect(text).not.toMatch(/check|cop(y|ies)|overlap|"kind":"main"/i);
    // ana holds 1-4 and 7 as plots and 5 as a copy (checked): 6 plots, 3 submitted (1, 2 and 5).
    expect(mine.person.plots).toEqual({ assigned: 6, submitted: 3, started: 1, remaining: 2, done: 4 / 6 });
    expect('checks' in mine.person).toBe(false);
    expect(mine.calendar).toEqual([
      { date: '2026-10-30', plots: 2 },
      { date: '2026-10-31', plots: 1 },
    ]);
    const d = mine.files.find((f) => f.csvFileId === 'd')!;
    expect(d.plots).toEqual({ total: 2, submitted: 1, doneByOther: 1, started: 0, notStarted: 0 });
    expect(d.list).toEqual([
      { plot: '5', status: 'submitted' },
      { plot: '7', status: 'doneByOther' },
    ]);
    expect('checks' in d).toBe(false);
    expect(mine.speed.submissions).toBe(3);
    // The coordinator's page does tell them apart.
    const theirs = personDetail(project(records, over), 'u-ana', { self: false })!;
    expect(theirs.person.checks).toEqual({ assigned: 1, submitted: 1, remaining: 0 });
    expect(theirs.files.find((f) => f.csvFileId === 'd')!.list[0]).toEqual({ plot: '5', kind: 'check', status: 'submitted' });
  });

  it('null for someone who is not a member', () => {
    expect(personDetail(project(records), 'u-nobody', { self: false })).toBeNull();
  });
});
