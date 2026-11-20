// Corrections (docs/plans/2026-11-20-review-at-scale.md, B2-B4): plots decided "Correct it in Collect Earth" are
// assigned by a coordinator to people of the project (reviewers, interpreters or coordinators), who correct them in their
// own Collect Earth. Pure: how plots are shared, whose own plots are assigned (a warning, not a refusal), and what
// Collect Earth is given of a plot to correct (its answers and where they differ).
import { createHash } from 'node:crypto';
import { pairFields } from './quality.js';
import type { Question } from './surveyOutline.js';
import type { CorrectionAnswer, CorrectionDifference, OwnAssignment } from './wire/review.js';

/** The plots shared evenly between the people, in the order given (round robin); none: to nobody */
export function shareEvenly(plots: readonly string[], people: readonly string[]): { plot: string; userId: string | null }[] {
  return plots.map((plot, i) => ({ plot, userId: people.length === 0 ? null : people[i % people.length] }));
}

/**
 * The plots assigned to someone who answered them (a record of theirs, or a copy they hold): they would correct their
 * own work. Said to the coordinator, never refused (decided 20 Nov 2026).
 */
export function ownAssignments(
  assignments: readonly { plot: string; userId: string | null }[],
  usernameOf: (userId: string) => string | null,
  answeredBy: (plot: string, username: string, userId: string) => boolean,
): OwnAssignment[] {
  const out: OwnAssignment[] = [];
  for (const a of assignments) {
    if (a.userId === null) continue;
    const username = usernameOf(a.userId);
    if (username !== null && answeredBy(a.plot, username, a.userId)) out.push({ plot: a.plot, username });
  }
  return out;
}

/** How many plots each person gets, and how many of them are their own */
export function assignmentCounts(
  assignments: readonly { plot: string; userId: string | null }[],
  own: readonly OwnAssignment[],
  usernameOf: (userId: string) => string | null,
): { userId: string; username: string; plots: number; own: number }[] {
  const ownBy = new Map<string, number>();
  for (const o of own) ownBy.set(o.username, (ownBy.get(o.username) ?? 0) + 1);
  const by = new Map<string, number>();
  for (const a of assignments) if (a.userId !== null) by.set(a.userId, (by.get(a.userId) ?? 0) + 1);
  return [...by].map(([userId, plots]) => {
    const username = usernameOf(userId) ?? '';
    return { userId, username, plots, own: ownBy.get(username) ?? 0 };
  });
}

/**
 * Where a plot's answers differ: every question on which some answer differs from the first (`answers[0]`), with each
 * answer's value (labels as the survey says them, where it has some). The first answer is what the form starts from.
 */
export function correctionDifferences(
  answers: readonly Pick<CorrectionAnswer, 'operator' | 'summary'>[],
  outline: ReadonlyMap<string, Question> | null,
  margins: Readonly<Record<string, number>> = {},
): CorrectionDifference[] {
  if (answers.length < 2) return [];
  const keys: string[] = [];
  for (const other of answers.slice(1)) {
    for (const f of pairFields(answers[0].summary, other.summary, outline, margins)) if (!keys.includes(f.key)) keys.push(f.key);
  }
  return keys.map((key) => {
    const q = outline?.get(key);
    const label = (code: string) => q?.options?.find((o) => o.code === code)?.label ?? code;
    return {
      key,
      question: q?.label ?? key,
      values: answers.map((a) => {
        const value = Object.hasOwn(a.summary, key) ? a.summary[key] : '';
        return { operator: a.operator, value, label: value === '' ? '' : value.split(',').map((v) => label(v.trim())).join(', ') };
      }),
    };
  });
}

/** The version of a person's plots to correct: Collect Earth asks again only when it changed */
export function correctionsVersion(parts: unknown): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
