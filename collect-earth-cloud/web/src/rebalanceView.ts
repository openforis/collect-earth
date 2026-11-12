import type { DistributionState, Member, PersonRow, RebalancePlan } from "./api";
import { collectors, sortPeople } from "./division";
import { formatNumber } from "./format";
import type { MessageKey, Translate } from "./i18n";

// "Share again what is left" on a plot file's page: the people who share the plots still to do of a divided file,
// how (equally, by percentage, by pace), the request for POST .../rebalance, and the sentences about its plan.

export type ShareHow = "equal" | "percent" | "pace";

export interface ShareForm {
  how: ShareHow;
  /** The people ticked: they share the plots left. A holder not ticked gives all theirs away (weight 0). */
  chosen: string[];
  /** By percentage: the text typed for each person ticked. */
  percents: Record<string, string>;
}

/** The days the pace is counted over: the People tab's "Last 7 days". */
export const PACE_DAYS = 7;
/** The server's largest weight. */
const MAX_WEIGHT = 1000;

/** The people who hold plots of the file now. */
export function holdersOf(state: DistributionState): string[] {
  return state.people.filter((p) => p.plots > 0).map((p) => p.userId);
}

/** The people listed: those who normally collect, and anyone who holds plots of the file (a coordinator too). */
export function shareCandidates(members: Member[], state: DistributionState): Member[] {
  const holders = new Set(holdersOf(state));
  const ids = new Set(collectors(members).map((m) => m.userId));
  return sortPeople(members.filter((m) => ids.has(m.userId) || holders.has(m.userId)));
}

/**
 * The form at the start: ticked are the people who still have plots to do (an account turned off is not), or, when
 * nobody has, the collectors.
 */
export function initialShareForm(members: Member[], state: DistributionState): ShareForm {
  const off = new Set(members.filter((m) => m.disabled).map((m) => m.userId));
  const known = new Set(members.map((m) => m.userId));
  const working = state.people.filter((p) => p.plots > p.submitted && known.has(p.userId) && !off.has(p.userId)).map((p) => p.userId);
  const chosen = working.length > 0 ? working : collectors(members).filter((m) => !m.disabled).map((m) => m.userId);
  const order = new Map(shareCandidates(members, state).map((m, i) => [m.userId, i]));
  return { how: "equal", chosen: [...chosen].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), percents: {} };
}

export function toggleChosen(form: ShareForm, userId: string): ShareForm {
  return { ...form, chosen: form.chosen.includes(userId) ? form.chosen.filter((id) => id !== userId) : [...form.chosen, userId] };
}

/** A whole number from 0 to 100, or null. */
function percentOf(text: string | undefined): number | null {
  const s = (text ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= 100 ? n : null;
}

/** The percentages of the people ticked, added up (what is not a whole number counts as 0). */
export function percentSum(form: ShareForm): number {
  return form.chosen.reduce((sum, id) => sum + (percentOf(form.percents[id]) ?? 0), 0);
}

/** A person's pace: `perDay` their own (null: no plot in the last 7 days), `used` what the share counts. */
export interface Pace {
  perDay: number | null;
  used: number;
  /** No pace of their own: `used` is the middle pace of the others ticked. */
  guessed: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The pace of the people ticked, from the People tab's rows: their plots submitted in the last 7 days, a day. Someone
 * with none is counted at the middle pace of the others; null when nobody ticked has a pace.
 */
export function pacesOf(chosen: readonly string[], rows: readonly Pick<PersonRow, "userId" | "submittedLast7">[]): Map<string, Pace> | null {
  const last7 = new Map(rows.map((r) => [r.userId, r.submittedLast7]));
  const own = new Map(chosen.map((id) => [id, (last7.get(id) ?? 0) > 0 ? (last7.get(id) ?? 0) / PACE_DAYS : null]));
  const middle = median([...own.values()].filter((v): v is number => v !== null));
  if (middle === null) return null;
  return new Map(chosen.map((id) => {
    const perDay = own.get(id) ?? null;
    return [id, { perDay, used: perDay ?? middle, guessed: perDay === null }];
  }));
}

export type ShareRequest = { people: { userId: string; weight: number }[]; problem: null } | { people: null; problem: MessageKey };

/**
 * The people and weights to send: the people ticked by the chosen way, then each holder not ticked with 0 (they give
 * all theirs away). `paces` is needed by pace (null: nobody ticked has one).
 */
export function shareRequest(form: ShareForm, holders: readonly string[], paces?: Map<string, Pace> | null): ShareRequest {
  const fail = (problem: MessageKey): ShareRequest => ({ people: null, problem });
  if (form.chosen.length === 0) return fail("divide.move.shareProblemNobody");
  let weightOf: (id: string) => number = () => 1;
  if (form.how === "percent") {
    if (form.chosen.some((id) => percentOf(form.percents[id]) === null) || percentSum(form) !== 100) return fail("divide.problemPercents");
    weightOf = (id) => percentOf(form.percents[id]) ?? 0;
  } else if (form.how === "pace") {
    if (!paces) return fail("divide.move.shareProblemNoPace");
    weightOf = (id) => Math.min(MAX_WEIGHT, Math.round((paces.get(id)?.used ?? 0) * 100) / 100);
  }
  const people = form.chosen.map((userId) => ({ userId, weight: weightOf(userId) }));
  for (const id of holders) if (!form.chosen.includes(id)) people.push({ userId: id, weight: 0 });
  if (people.length < 2) return fail("divide.move.shareProblemTwo");
  if (!people.some((p) => p.weight > 0)) return fail("divide.move.shareProblemNobody");
  return { people, problem: null };
}

export interface PlanRow {
  userId: string;
  name: string;
  before: number;
  after: number;
}

/** The preview's table: each person of the plan, plots left to do now and after, in the order of the list. */
export function planRows(plan: RebalancePlan, names: ReadonlyMap<string, string>, order: readonly string[] = []): PlanRow[] {
  const at = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return Object.keys(plan.left)
    .map((userId) => ({ userId, name: names.get(userId) ?? userId, before: plan.left[userId] ?? 0, after: plan.target[userId] ?? plan.left[userId] ?? 0 }))
    .sort((a, b) => at(a.userId) - at(b.userId) || a.name.localeCompare(b.name));
}

/** "ana gives 12 plots to bo", one per move. */
export function moveLines(t: Translate, plan: Pick<RebalancePlan, "moves">, names: ReadonlyMap<string, string>, language: string): string[] {
  return plan.moves
    .filter((m) => m.count > 0)
    .map((m) =>
      t(m.count === 1 ? "divide.move.shareGivesOne" : "divide.move.shareGives", {
        from: names.get(m.from) ?? m.from,
        to: names.get(m.to) ?? m.to,
        count: formatNumber(m.count, language),
      }),
    );
}

/** What "Apply" did: the plots moved, then those kept (the person taking them had assessed or checked them). */
export function sharedText(t: Translate, result: { moved: number; notMoved: number }, language: string): string {
  const parts = [t("divide.move.shareDone", { count: formatNumber(result.moved, language) })];
  if (result.notMoved > 0) parts.push(t("divide.move.shareKept", { count: formatNumber(result.notMoved, language) }));
  return parts.join(" ");
}

/** A pace, as the People tab writes plots a day. */
export function paceNumber(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(language, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  } catch {
    return String(Math.round(value * 10) / 10);
  }
}

/** The pace line under a person ticked, when sharing by pace. */
export function paceText(t: Translate, pace: Pace | undefined, language: string): string {
  if (!pace) return "";
  return t(pace.guessed ? "divide.move.sharePaceGuessed" : "divide.move.sharePaceOf", { pace: paceNumber(pace.used, language) });
}
