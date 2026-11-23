// The "Early warning" view of the Quality tab: what the reference plots say of the data collection, by layer, so a
// coordinator finds where a problem comes from before it is in thousands of plots. Pure functions.
//
// The layers are read from the top, because a problem in one explains problems in the ones under it:
//   1. arriving   - is the data coming in at all (nobody started, work not sent, an old project file)?
//   2. reference  - can the reference be trusted (not assessed yet; answers most collectors contradict)?
//   3. questions  - a question everyone gets wrong is the question's or the training's, not anyone's
//   4. people     - who is under the accuracy target, on what, and whether they are improving
//   5. plots      - the reference plots most collectors get wrong (hard plots, to talk through with the team)
//
// Everything is counted from the first check: a share comes with its margin of error and a verdict (the server's
// src/accuracy.ts), never hidden for being few.
import type { AttentionItem, Judged, JudgedPerson, ReferenceAmong, ReferenceAnswer, ReferenceDoubt, Tally, Verdict } from "./api";
import type { Translate } from "./i18n";
import { formatRate } from "./qualityView";

/** How a layer stands: something is wrong for certain, something to look at, fine, too early to say, or not in use. */
export type Level = "problem" | "look" | "ok" | "early" | "none";

export type LayerId = "arriving" | "reference" | "questions" | "people" | "plots";

/** The layers in the order they are read. */
export const LAYERS: readonly LayerId[] = ["arriving", "reference", "questions", "people", "plots"];

/** The attention items (Progress) that say the data is not coming in as it should. */
const ARRIVING_KINDS = ["neverDownloaded", "quiet", "oldUnsentWork", "oldProjectFile", "oldCollectEarth", "notAssigned"] as const;
export type ArrivingItem = Extract<AttentionItem, { kind: (typeof ARRIVING_KINDS)[number] }>;

/**
 * Where a question's wrong answers come from, as far as the figures tell:
 * - few: most of them are a few people's (the people layer, not the question);
 * - shared: the collectors agree with each other, not with the reference (the reference, or what all were taught);
 * - unclear: the collectors disagree with each other too (the question or its options are not clear);
 * - number: a number question, compared within its margin (the margin may be too narrow).
 */
export type Reading = "few" | "shared" | "unclear" | "number";

export interface QuestionRow extends Tally, Judged {
  key: string;
  label: string;
  kind: "choice" | "number";
  /** The collectors among themselves on this question (choice questions with at least two collectors on a plot). */
  among: ReferenceAmong | null;
  reading: Reading | null;
  /** For "few": whose wrong answers they mostly are. */
  who: string[];
}

export interface PersonRow {
  username: string;
  userId: string | null;
  answers: Tally & Judged;
  /** The most worrying of their questions' verdicts. */
  verdict: Verdict | null;
  trend: JudgedPerson["trend"];
  /** Their questions under the target (below first), at most three. */
  weak: (Tally & Judged & { key: string; label: string })[];
  /** How many of their copies of the reference plots they have submitted; null when not known. */
  done: { checked: number; copies: number } | null;
}

export interface PlotRow {
  plot: string;
  assessor: string;
  checks: number;
  agreeing: number;
  /** One of its reference answers is in doubt (layer 2): look at the reference first. */
  doubt: boolean;
}

export interface EarlyWarning {
  /** The accuracy target, in percent. */
  target: number;
  /** Whether the project has reference plots at all. */
  inUse: boolean;
  so: { plots: number; assessed: number; checks: number; collectors: number; judged: number };
  levels: Record<LayerId, Level>;
  /** The layer to start with: the first one with a problem, else the first one to look at; null when there is none. */
  first: LayerId | null;
  /** Null for a reviewer (the Progress cards are the coordinators'). */
  arriving: ArrivingItem[] | null;
  reference: { unassessed: number; waiting: number; doubtful: ReferenceDoubt[]; doubtfulTotal: number; doubtfulPlots: number };
  questions: QuestionRow[];
  /** Null for a reviewer: no one's accuracy by name. */
  people: { rows: PersonRow[]; notStarted: string[]; counts: Record<Verdict, number> } | null;
  /** Null for a reviewer: which plots are reference plots is the coordinators'. */
  plots: { rows: PlotRow[]; total: number; worthALook: number } | null;
}

const RANK: Record<Verdict, number> = { below: 0, watch: 1, early: 2, ok: 3 };
const rankOf = (v: Verdict | null) => (v === null ? 4 : RANK[v]);
const shareOf = (t: Tally) => (t.compared > 0 ? t.agreeing / t.compared : 1);
const byWorry = <T extends Tally & { verdict: Verdict | null }>(a: T, b: T) => rankOf(a.verdict) - rankOf(b.verdict) || shareOf(a) - shareOf(b) || b.compared - a.compared;

/** At least this many collectors on a plot before it can be "a plot most get wrong". */
export const MIN_PLOT_CHECKS = 3;
/** At most this many plots listed in the plots layer. */
export const MAX_HARD_PLOTS = 20;
/** The collectors "agree with each other" from this share of same pairs, when it is also well above their accuracy. */
const SHARED_AMONG = 0.7;
const SHARED_GAP = 0.15;
/** A question's wrong answers are "a few people's" when at most two people, and at most half of those who answered, gave this share of them. */
const FEW_SHARE = 2 / 3;

/** The level of some verdicts: a problem with any "below", to look at with any "watch", fine with any "ok", else too early. */
function levelOf(verdicts: readonly (Verdict | null)[]): Level {
  if (verdicts.includes("below")) return "problem";
  if (verdicts.includes("watch")) return "look";
  if (verdicts.includes("ok")) return "ok";
  return "early";
}

function readingOf(q: Tally & { key: string; kind: "choice" | "number"; verdict: Verdict | null }, among: ReferenceAmong | null, people: readonly JudgedPerson[] | undefined): { reading: Reading | null; who: string[] } {
  if (q.verdict !== "below" && q.verdict !== "watch") return { reading: null, who: [] };
  const wrong = q.compared - q.agreeing;
  if (people && wrong > 0) {
    const misses = people
      .map((p) => ({ username: p.username, q: p.questions.find((x) => x.key === q.key) }))
      .filter((x): x is { username: string; q: NonNullable<typeof x.q> } => x.q !== undefined && x.q.compared > 0)
      .map((x) => ({ username: x.username, wrong: x.q.compared - x.q.agreeing }))
      .sort((a, b) => b.wrong - a.wrong || a.username.localeCompare(b.username));
    if (misses.length >= 3) {
      for (const n of [1, 2]) {
        if (n * 2 > misses.length) break;
        const top = misses.slice(0, n);
        if (top.every((m) => m.wrong > 0) && top.reduce((sum, m) => sum + m.wrong, 0) >= FEW_SHARE * wrong) return { reading: "few", who: top.map((m) => m.username) };
      }
    }
  }
  if (q.kind === "number") return { reading: "number", who: [] };
  if (among && among.compared >= 3) {
    const same = among.agreeing / among.compared;
    return { reading: same >= SHARED_AMONG && same - shareOf(q) >= SHARED_GAP ? "shared" : "unclear", who: [] };
  }
  return { reading: null, who: [] };
}

/**
 * The view's model from the reference plots' answer (GET /reference) and, when at hand, the Progress cards.
 * `attention` is null for a reviewer and undefined while it is not loaded (the first layer then says nothing).
 */
export function earlyWarning(answer: ReferenceAnswer, attention?: readonly AttentionItem[] | null): EarlyWarning {
  const f = answer.figures;
  const inUse = answer.count > 0;
  const among = new Map(f.among.map((a) => [a.key, a]));
  const questions: QuestionRow[] = f.questions
    .map((q) => ({ ...q, among: among.get(q.key) ?? null, ...readingOf(q, among.get(q.key) ?? null, f.people) }))
    .sort((a, b) => byWorry(a, b) || a.label.localeCompare(b.label));

  const arriving = attention ? attention.filter((i): i is ArrivingItem => (ARRIVING_KINDS as readonly string[]).includes(i.kind)) : null;
  const worthALook = attention?.find((i) => i.kind === "worthALook")?.count ?? 0;

  // The answers in doubt, the most contradicted first, with a plot's other answers in doubt right after its first.
  const order = new Map<string, number>();
  for (const d of f.doubtful ?? []) if (!order.has(d.plot)) order.set(d.plot, order.size);
  const doubtful = (f.doubtful ?? []).map((d, i) => ({ d, i })).sort((a, b) => order.get(a.d.plot)! - order.get(b.d.plot)! || a.i - b.i).map((x) => x.d);
  const unassessed = Math.max(0, f.plots - f.assessed);
  // Checks already done of plots whose reference is not: they cannot be measured until the assessor is done.
  const waiting = f.byPlot ? f.byPlot.filter((p) => !p.assessed && p.checks > 0).length : 0;

  let people: EarlyWarning["people"] = null;
  if (f.people) {
    const set = answer.coordinator ? answer.people : [];
    const byName = new Map(set.map((p) => [p.username, p]));
    const rows: PersonRow[] = f.people
      .map((p) => {
        const member = byName.get(p.username);
        return {
          username: p.username,
          userId: member?.userId ?? null,
          answers: p.answers,
          verdict: p.verdict,
          trend: p.trend,
          weak: p.questions
            .filter((q) => q.verdict === "below" || q.verdict === "watch")
            .sort(byWorry)
            .slice(0, 3)
            .map(({ key, label, compared, agreeing, low, high, verdict }) => ({ key, label, compared, agreeing, low, high, verdict })),
          done: member ? { checked: member.checked, copies: member.copies } : null,
        };
      })
      .sort((a, b) => rankOf(a.verdict) - rankOf(b.verdict) || shareOf(a.answers) - shareOf(b.answers) || a.username.localeCompare(b.username));
    const measured = new Set(f.people.map((p) => p.username));
    const counts: Record<Verdict, number> = { below: 0, watch: 0, ok: 0, early: 0 };
    for (const r of rows) if (r.verdict) counts[r.verdict] += 1;
    people = {
      rows,
      // Holding copies and none submitted, once someone else has: they have not begun the reference plots.
      notStarted: set.filter((p) => p.copies > 0 && p.checked === 0 && !measured.has(p.username)).map((p) => p.username).sort((a, b) => a.localeCompare(b)),
      counts,
    };
  }

  let plots: EarlyWarning["plots"] = null;
  if (f.byPlot) {
    const inDoubt = new Set(doubtful.map((d) => d.plot));
    const hard = f.byPlot
      .filter((p) => p.assessed && p.checks >= MIN_PLOT_CHECKS && p.agreeing * 2 < p.checks)
      .sort((a, b) => a.agreeing / a.checks - b.agreeing / b.checks || b.checks - a.checks || a.plot.localeCompare(b.plot, "en", { numeric: true }));
    plots = { rows: hard.slice(0, MAX_HARD_PLOTS).map((p) => ({ plot: p.plot, assessor: p.assessor, checks: p.checks, agreeing: p.agreeing, doubt: inDoubt.has(p.plot) })), total: hard.length, worthALook };
  }

  const levels: Record<LayerId, Level> = {
    arriving: arriving === null ? "none" : arriving.length > 0 ? "look" : "ok",
    reference: !inUse ? "none" : f.doubtfulTotal > 0 ? "problem" : (f.byPlot ? waiting > 0 : unassessed > 0 && f.checks > 0) ? "look" : f.assessed === 0 ? "early" : "ok",
    questions: !inUse ? "none" : levelOf(questions.map((q) => q.verdict)),
    people: !inUse || !people ? "none" : people.rows.length === 0 ? "early" : (() => {
      const level = levelOf(people.rows.map((r) => r.verdict));
      return level === "ok" && people.notStarted.length > 0 ? "look" : level;
    })(),
    plots: !plots ? "none" : plots.total > 0 || plots.worthALook > 0 ? "look" : !inUse ? "none" : f.byPlot!.some((p) => p.assessed && p.checks >= MIN_PLOT_CHECKS) ? "ok" : "early",
  };
  const first = LAYERS.find((l) => levels[l] === "problem") ?? LAYERS.find((l) => levels[l] === "look") ?? null;
  return {
    target: f.target,
    inUse,
    so: {
      plots: f.plots,
      assessed: f.assessed,
      checks: f.checks,
      collectors: f.people?.length ?? 0,
      judged: f.people?.filter((p) => p.verdict !== null && p.verdict !== "early").length ?? 0,
    },
    levels,
    first,
    arriving,
    reference: { unassessed, waiting, doubtful, doubtfulTotal: f.doubtfulTotal, doubtfulPlots: order.size },
    questions,
    people,
    plots,
  };
}

/** "3 of 8", the count a share is made of. */
export function tallyText(t: Translate, tally: Tally): string {
  return t("accuracy.of", { agreeing: tally.agreeing, count: tally.compared });
}

/** "38% (3 of 8). With this many, between 14% and 69%. Target: 80%." - the whole of what a margin bar draws, in words. */
export function marginText(t: Translate, tally: Tally & { low: number | null; high: number | null }, target: number, language: string): string {
  if (tally.compared === 0 || tally.low === null || tally.high === null) return t("accuracy.none");
  return t("accuracy.margin", {
    pct: formatRate(tally.agreeing / tally.compared, language),
    agreeing: tally.agreeing,
    count: tally.compared,
    low: formatRate(tally.low, language),
    high: formatRate(tally.high, language),
    target: formatRate(target / 100, language),
  });
}

/** "14–69%": the margin alone, for a table cell beside the count. */
export function rangeText(tally: { low: number | null; high: number | null }, language: string): string {
  if (tally.low === null || tally.high === null) return "";
  // The two ends as whole percent; one figure when they round to the same.
  const low = Math.round(tally.low * 100);
  const high = Math.round(tally.high * 100);
  const pct = formatRate(high / 100, language);
  return low === high ? pct : `${low}–${pct}`;
}
