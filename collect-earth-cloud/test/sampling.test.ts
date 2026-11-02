import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isoWeek, qualityReport } from '../src/quality.js';
import type { RoundInfo } from '../src/cep.js';
import { copyHoldersOf } from '../src/division.js';
import { drawChecks, parseSamplingRule, priority, samplingActive, type DrawInput } from '../src/sampling.js';
import type { Member, PlotAssignment, SamplingRule } from '../src/types.js';

const DAY = 86_400_000;
/** Monday 2026-10-05 09:00 UTC: an ISO week starts. */
const MONDAY = Date.UTC(2026, 9, 5, 9);

const member = (username: string, role: Member['role'] = 'operator', extra: Partial<Member> = {}): Member => ({ userId: `u-${username}`, username, role, ...extra });

const rule = (over: Partial<SamplingRule> = {}): SamplingRule => ({ checkers: null, firstN: null, percent: null, seed: 7, files: {}, ...over });

/**
 * A divided file "f1" of `n` plots ("1".."n"): `holders[i]` holds plot i+1 as main and has
 * submitted it at `at(i)`.
 */
function setup(opts: {
  n: number;
  holders: (i: number) => string;
  at?: (i: number) => number;
  members?: Member[];
  rule?: Partial<SamplingRule>;
  extraHoldings?: PlotAssignment[];
  submittedCount?: number;
}): DrawInput {
  const units = Array.from({ length: opts.n }, (_, i) => String(i + 1));
  const members = opts.members ?? [member('ana'), member('ben'), member('cai'), member('dee', 'reviewer'), member('boss', 'admin')];
  const id = new Map(members.map((m) => [m.username, m.userId]));
  const holdings: PlotAssignment[] = units.map((u, i) => ({ plotKey: u, userId: id.get(opts.holders(i)) ?? `u-${opts.holders(i)}`, overlap: false }));
  holdings.push(...(opts.extraHoldings ?? []));
  const submitted = new Map<string, { operator: string; at: number }>();
  const assessedBy = new Map<string, Set<string>>();
  units.slice(0, opts.submittedCount ?? units.length).forEach((u, i) => {
    submitted.set(u, { operator: opts.holders(i), at: (opts.at ?? ((j) => MONDAY + j * 60_000))(i) });
    assessedBy.set(u, new Set([opts.holders(i)]));
  });
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  return {
    rule: rule(opts.rule),
    files: [{ id: 'f1', units, holdings }],
    members,
    submitted,
    assessedBy,
    checked: new Set(),
    copyHolders: copyHoldersOf(holdings, usernames),
    heldMain: () => false,
    openChecks: new Map(),
  };
}

describe('drawChecks: which plots get a check, and who checks them (pure)', () => {
  it('draws nothing while neither rule is on', () => {
    const input = setup({ n: 30, holders: () => 'ana' });
    expect(samplingActive(input.rule)).toBe(false);
    expect(drawChecks(input)).toEqual({ copies: [], noChecker: 0 });
  });

  it('is repeatable: the same records, holdings and seed give the same copies; another seed others', () => {
    const make = (seed: number) => setup({ n: 200, holders: (i) => ['ana', 'ben', 'cai'][i % 3], rule: { percent: 10, seed } });
    const a = drawChecks(make(7));
    expect(drawChecks(make(7))).toEqual(a);
    expect(a.copies.length).toBeGreaterThan(0);
    const b = drawChecks(make(8));
    expect(b.copies.map((c) => c.plotKey)).not.toEqual(a.copies.map((c) => c.plotKey));
    // The seeded order is a hash of the seed and the plot: no other plot moves when one is added.
    expect(priority(7, '1')).toBe(priority(7, '1'));
    expect(priority(7, '1')).not.toBe(priority(8, '1'));
  });

  it('X % of each person’s plots of each ISO week, rounded to the nearest (a half up)', () => {
    // ana: 25 plots in week 1 and 15 in week 2; ben: 4 in week 1 (10 % of 4 = 0.4: none).
    const at = (i: number) => (i < 25 ? MONDAY + i * 60_000 : i < 40 ? MONDAY + 7 * DAY + i * 60_000 : MONDAY + 2 * DAY + i);
    const input = setup({ n: 44, holders: (i) => (i < 40 ? 'ana' : 'ben'), at, rule: { percent: 10 } });
    const { copies } = drawChecks(input);
    const weekOf = (plot: string) => isoWeek(input.submitted.get(plot)!.at);
    const byGroup = new Map<string, number>();
    for (const c of copies) {
      const key = `${input.submitted.get(c.plotKey)!.operator} ${weekOf(c.plotKey)}`;
      byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
      expect(c.reason).toBe('percent');
    }
    // 2.5 -> 3, 1.5 -> 2, 0.4 -> 0.
    expect(Object.fromEntries(byGroup)).toEqual({ [`ana ${isoWeek(MONDAY)}`]: 3, [`ana ${isoWeek(MONDAY + 7 * DAY)}`]: 2 });
  });

  it('the first N plots of every person, by when they were first submitted', () => {
    const at = (i: number) => MONDAY + (100 - i) * 60_000; // later plots in the file were submitted first
    const input = setup({ n: 20, holders: (i) => (i % 2 === 0 ? 'ana' : 'ben'), at, rule: { firstN: 3 } });
    const { copies } = drawChecks(input);
    const plots = (who: string) => copies.filter((c) => input.submitted.get(c.plotKey)!.operator === who).map((c) => Number(c.plotKey)).sort((x, y) => x - y);
    expect(plots('ana')).toEqual([15, 17, 19]);
    expect(plots('ben')).toEqual([16, 18, 20]);
    expect(copies.every((c) => c.reason === 'firstN')).toBe(true);
    // With both rules, the first N count towards the week's share.
    const both = drawChecks(setup({ n: 20, holders: (i) => (i % 2 === 0 ? 'ana' : 'ben'), at, rule: { firstN: 3, percent: 10 } }));
    expect(both.copies.length).toBe(6);
  });

  it('never a self-check: not the assessor, not a holder of the plot, not anyone with a record of it', () => {
    // Only ana and ben may check; ana assessed every plot, so ben checks them all.
    const members = [member('ana'), member('ben'), member('cai')];
    const input = setup({ n: 10, holders: () => 'ana', members, rule: { firstN: 10, checkers: ['u-ana', 'u-ben'] } });
    const { copies } = drawChecks(input);
    expect(copies.length).toBe(10);
    expect(new Set(copies.map((c) => c.userId))).toEqual(new Set(['u-ben']));
    // ben made a draft of plot 3 and holds plot 4 as main elsewhere: nobody is left for them.
    (input.assessedBy as Map<string, Set<string>>).set('3', new Set(['ana', 'ben']));
    input.heldMain = (username, unit) => username === 'ben' && unit === '4';
    const again = drawChecks(input);
    expect(again.copies.map((c) => c.plotKey).sort()).toEqual(['1', '10', '2', '5', '6', '7', '8', '9']);
    expect(again.noChecker).toBe(2);
    // The file's holders of the plot are left out too (main or copy).
    const held = setup({ n: 1, holders: () => 'ana', members, rule: { firstN: 1, checkers: ['u-ben', 'u-cai'] }, extraHoldings: [{ plotKey: '1', userId: 'u-ben', overlap: false }] });
    expect(drawChecks(held).copies.map((c) => c.userId)).toEqual(['u-cai']);
  });

  it('no double copies: a plot that has a copy (or a check record) is never drawn again, and counts towards the share', () => {
    const input = setup({ n: 10, holders: () => 'ana', rule: { firstN: 3 } });
    const first = drawChecks(input);
    expect(first.copies.map((c) => c.plotKey)).toEqual(['1', '2', '3']);
    // The copies are added: the next draw finds nothing to do.
    const holdings = [...input.files[0].holdings, ...first.copies.map((c) => ({ plotKey: c.plotKey, userId: c.userId, overlap: true, sampledAt: 1 }))];
    const usernames = new Map(input.members.map((m) => [m.userId, m.username]));
    const next = { ...input, files: [{ ...input.files[0], holdings }], copyHolders: copyHoldersOf(holdings, usernames) };
    expect(drawChecks(next).copies).toEqual([]);
    // A plot someone checked already (a record of the check) counts as checked.
    const checked = drawChecks({ ...input, checked: new Set(['1']) });
    expect(checked.copies.map((c) => c.plotKey)).toEqual(['2', '3']);
  });

  it('balances the load: the checker with the fewest open checks first', () => {
    const members = [member('ana'), member('ben'), member('cai'), member('dee')];
    const input = setup({ n: 90, holders: () => 'ana', members, rule: { firstN: 90 } });
    input.openChecks = new Map([['ben', 10]]);
    const { copies } = drawChecks(input);
    const count = (u: string) => copies.filter((c) => c.userId === u).length;
    // 90 checks among ben (10 open already), cai and dee: about 100 / 3 each in all.
    const totals = [count('u-ben') + 10, count('u-cai'), count('u-dee')];
    expect(totals.reduce((a, b) => a + b)).toBe(100);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
    expect(count('u-ana')).toBe(0);
  });

  it('checkers: by default collectors and reviewers, never a disabled account; a chosen list otherwise', () => {
    const members = [member('ana'), member('ben', 'reviewer'), member('boss', 'admin'), member('off', 'operator', { disabled: true })];
    const input = setup({ n: 20, holders: () => 'ana', members, rule: { firstN: 20 } });
    expect(new Set(drawChecks(input).copies.map((c) => c.userId))).toEqual(new Set(['u-ben']));
    input.rule = rule({ firstN: 20, checkers: ['u-boss', 'u-off'] });
    expect(new Set(drawChecks(input).copies.map((c) => c.userId))).toEqual(new Set(['u-boss']));
    // Nobody left: every plot is due without a checker.
    input.rule = rule({ firstN: 20, checkers: ['u-ana'] });
    expect(drawChecks(input)).toEqual({ copies: [], noChecker: 20 });
  });

  it('a file of its own: no checks, or its own rule; plots not submitted are never drawn', () => {
    const input = setup({ n: 10, holders: () => 'ana', rule: { firstN: 2, files: { f1: { use: 'off' } } } });
    expect(drawChecks(input).copies).toEqual([]);
    input.rule = rule({ firstN: 2, files: { f1: { use: 'own', checkers: null, firstN: 5, percent: null } } });
    expect(drawChecks(input).copies.length).toBe(5);
    const fewer = setup({ n: 10, holders: () => 'ana', rule: { firstN: 5 }, submittedCount: 2 });
    expect(drawChecks(fewer).copies.map((c) => c.plotKey)).toEqual(['1', '2']);
  });

  it('own round: nobody gets copies of two rounds of one plot', () => {
    const input = setup({ n: 4, holders: () => 'ana', members: [member('ana'), member('ben'), member('cai')], rule: { firstN: 4 } });
    // Units "1".."4" are rounds of two plots: 1-2 are plot A, 3-4 plot B.
    input.plotOf = (unit) => (Number(unit) <= 2 ? 'A' : 'B');
    const { copies } = drawChecks(input);
    const plotsOf = (u: string) => copies.filter((c) => c.userId === u).map((c) => input.plotOf!(c.plotKey));
    for (const u of ['u-ben', 'u-cai']) {
      expect(new Set(plotsOf(u)).size).toBe(plotsOf(u).length);
    }
    expect(copies.length).toBe(4);
  });
});

describe('the drawn copies pair as round 1 and round 2 in the quality figures', () => {
  it('a check made on a drawn copy is the plot’s check, paired with the first assessment', () => {
    const input = setup({ n: 20, holders: () => 'ana', members: [member('ana'), member('ben')], rule: { firstN: 20 } });
    const { copies } = drawChecks(input);
    expect(copies.length).toBe(20);
    const holdings = [...input.files[0].holdings, ...copies.map((c) => ({ plotKey: c.plotKey, userId: c.userId, overlap: true, sampledAt: 1 }))];
    const copyHolders = copyHoldersOf(holdings, new Map(input.members.map((m) => [m.userId, m.username])));
    const added: RoundInfo = { state: 'added', refusal: null, keyCount: 2, roundIndex: 1, roundCodes: [], reassessmentCode: '2' };
    const none: RoundInfo = { state: 'none', refusal: 'several_keys', keyCount: 1, roundIndex: null, roundCodes: [], reassessmentCode: null };
    const units = new Set(input.files[0].units);
    const rec = (recordKey: string, operator: string, landUse: string) => ({ recordKey, operator, modifiedOn: MONDAY, activelySaved: true, deleted: false, summary: { collect_code_land_use: landUse } });
    // The round the server adds: the checker's file says 2, so their key is "<plot>,2".
    const withRound = qualityReport({
      records: [...[...units].map((u) => rec(`${u},1`, 'ana', 'forest')), ...copies.map((c) => rec(`${c.plotKey},2`, 'ben', Number(c.plotKey) <= 5 ? 'grass' : 'forest'))],
      info: added,
      units,
      copyHolders,
      outline: null,
    });
    expect(withRound.plotsChecked).toBe(20);
    expect(withRound.plotsDiffering).toBe(5);
    expect(withRound.people.find((p) => p.username === 'ben')?.asChecker).toMatchObject({ compared: 20, agreeing: 15 });
    expect(withRound.people.find((p) => p.username === 'ana')?.asFirst).toMatchObject({ compared: 20, agreeing: 15 });
    // No round in the key: the copy tells the check apart.
    const noRound = qualityReport({
      records: [...[...units].map((u) => rec(u, 'ana', 'forest')), ...copies.map((c) => rec(c.plotKey, 'ben', 'forest'))],
      info: none,
      units,
      copyHolders,
      outline: null,
    });
    expect(noRound.plotsChecked).toBe(20);
    expect(noRound.plotsDiffering).toBe(0);
  });
});

describe('migration 019', () => {
  const sql = readFileSync(new URL('../migrations/019_sampling.sql', import.meta.url), 'utf8');

  it('fences sampling_rules on app.current_project, as records is, and marks the drawn copies', () => {
    expect(sql).toContain('ALTER TABLE sampling_rules ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain(
      'CREATE POLICY sampling_rules_isolation ON sampling_rules\n' +
        "  USING (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid)\n" +
        "  WITH CHECK (project_id = NULLIF(current_setting('app.current_project', true), '')::uuid);",
    );
    expect(sql).toContain('ALTER TABLE plot_assignments ADD COLUMN IF NOT EXISTS sampled_at TIMESTAMPTZ;');
  });
});

describe('parseSamplingRule', () => {
  const members = new Set(['u-ana', 'u-ben']);
  const divided = new Set(['f1']);
  const parse = (body: unknown, seed: number | null = 5) => parseSamplingRule(body, { members, divided, seed, newSeed: () => 42 });

  it('takes the rule, keeps the stored seed or makes one, and only divided files', () => {
    expect(parse({ firstN: 10, percent: null, checkers: null })).toEqual({ checkers: null, firstN: 10, percent: null, seed: 5, files: {} });
    expect(parse({ percent: 10 }, null)).toEqual({ checkers: null, firstN: null, percent: 10, seed: 42, files: {} });
    expect(parse({ percent: 10, checkers: ['u-ben', 'u-ben'], files: { f1: { use: 'own', firstN: 3 } } })).toEqual({
      checkers: ['u-ben'],
      firstN: null,
      percent: 10,
      seed: 5,
      files: { f1: { use: 'own', checkers: null, firstN: 3, percent: null } },
    });
    // The project's rule for a file is not stored.
    expect(parse({ files: { f1: { use: 'project' } } })).toMatchObject({ files: {} });
  });

  it('refuses what it cannot use', () => {
    for (const body of [null, [], { firstN: 0 }, { firstN: 1.5 }, { firstN: 1001 }, { percent: 0 }, { percent: 101 }, { percent: '10' }, { checkers: ['u-x'] }, { checkers: 'u-ana' }, { files: { f2: { use: 'off' } } }, { files: { f1: { use: 'maybe' } } }, { seed: 1.5 }]) {
      expect(parse(body), JSON.stringify(body)).toHaveProperty('reason');
    }
  });
});
