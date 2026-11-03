// The reports built from the quality figures for people who are not coordinators: a
// collector's own report ("My work") and the team report for training. Neither says who
// checked: they are built field by field from the figures, never by copying a record,
// a difference or a person's entry, so no username, record key or check time gets in.
import { marginKey, MIN_PLOTS, type Confusion, type QualityReport } from './quality.js';
import { withQuestionLabels } from './questionLabels.js';
import type { Question } from './surveyOutline.js';
import type { GuidanceNote } from './types.js';

/** The served survey's outline, or null without one. */
type Outline = ReadonlyMap<string, Question> | null;

/** A choice question's answer: its code and its label in the survey. */
export interface AnswerOption {
  code: string;
  label: string;
}

/**
 * The answer options of choice questions, by question key, so answers are shown by their
 * label ("Forest"), not their code ("F"). Survey texts only: no names, no answers.
 */
export type AnswerOptions = Record<string, AnswerOption[]>;

/** The team report's confusions, and the example plots of each. */
export const TEAM_CONFUSIONS = 10;
export const TEAM_CONFUSION_PLOTS = 5;

/** A guidance note as the reports show it: who wrote it and when are left out. */
export interface ReportNote {
  id: string;
  questionKey: string;
  firstValue: string | null;
  checkValue: string | null;
  text: string;
}

/** A mix-up between a first assessment and a check of it; checks is how many checks. */
export interface ReportConfusion {
  key: string;
  label: string;
  first: string;
  check: string;
  checks: number;
  plots: string[];
  /** The notes about this mix-up: of its question with no answers given, or with these answers. */
  notes: ReportNote[];
}

/** Checks counted, those agreeing on every compared question, and the share (null below minChecks). */
export interface ReportRate {
  checks: number;
  agreeing: number;
  rate: number | null;
}

/** GET /my-quality: the caller's own figures as first assessor. */
export interface PersonalReport {
  username: string;
  /** Below this many checks a rate is null ("too few checks to judge"). */
  minChecks: number;
  /** The checks of plots the caller assessed first. */
  asFirst: ReportRate;
  /** Up to 3 of their mix-ups as first assessor, with up to 10 plots each. */
  confusions: ReportConfusion[];
  /** The options of the choice questions of the mix-ups and their notes. */
  options: AnswerOptions;
}

/** GET /quality/team-report: no names at all. */
export interface TeamReport {
  minChecks: number;
  plotsChecked: number;
  plotsDiffering: number;
  questions: { key: string; label: string; kind: 'choice' | 'number'; checks: number; agreeing: number; rate: number | null; margin?: number }[];
  confusions: ReportConfusion[];
  notes: ReportNote[];
  /** The options of the choice questions of the report. */
  options: AnswerOptions;
}

/**
 * The options of the choice questions among `keys` that the outline lists with options
 * (a boolean's are "true"/"false"; the dashboard says Yes/No in its language).
 */
export function answerOptions(outline: Outline, keys: Iterable<string>): AnswerOptions {
  const out: AnswerOptions = {};
  if (!outline) return out;
  for (const key of keys) {
    const q = outline.get(key);
    if (!q || q.kind !== 'choice' || !q.options || q.options.length === 0 || Object.hasOwn(out, key)) continue;
    out[key] = q.options.map((o) => ({ code: o.code, label: o.label }));
  }
  return out;
}

/** Each question's label by key: the survey's (choice and number questions), then the figures'. */
function questionLabels(report: QualityReport, outline: Outline): Map<string, string> {
  const labels = new Map<string, string>();
  for (const q of outline?.values() ?? []) {
    if (!q.excluded && (q.kind === 'choice' || q.kind === 'number')) labels.set(q.key, q.label);
  }
  for (const q of report.questions) {
    if (!labels.has(q.key)) labels.set(q.key, q.label);
  }
  return labels;
}

/** A note as shown: question keys in its text read as their labels (a note the assistant drafted may hold one). */
function reportNote(n: GuidanceNote, labels: ReadonlyMap<string, string>): ReportNote {
  return { id: n.id, questionKey: n.questionKey, firstValue: n.firstValue, checkValue: n.checkValue, text: withQuestionLabels(n.text, labels) };
}

/** Whether a note is about a confusion: its question (any index of an entity, as margins), and each answer it names. */
function matches(n: GuidanceNote, c: Confusion): boolean {
  return (
    (n.questionKey === c.key || marginKey(n.questionKey) === marginKey(c.key)) &&
    (n.firstValue === null || n.firstValue === c.first) &&
    (n.checkValue === null || n.checkValue === c.check)
  );
}

function confusionsOf(
  report: QualityReport,
  confusions: readonly Confusion[],
  notes: readonly GuidanceNote[],
  maxPlots: number,
  labels: ReadonlyMap<string, string>,
): ReportConfusion[] {
  const figureLabels = new Map(report.questions.map((q) => [q.key, q.label]));
  return confusions.map((c) => ({
    key: c.key,
    label: figureLabels.get(c.key) ?? c.key,
    first: c.first,
    check: c.check,
    checks: c.count,
    plots: c.plots.slice(0, maxPlots),
    notes: notes.filter((n) => matches(n, c)).map((n) => reportNote(n, labels)),
  }));
}

/**
 * The personal report of one collector (a member with a session): only their own
 * figures as first assessor, on the plots that are certainly theirs (PersonQuality.personal).
 */
export function personalReport(report: QualityReport, username: string, notes: readonly GuidanceNote[], outline: Outline = null): PersonalReport {
  const me = report.people.find((p) => p.username === username);
  const confusions = me ? confusionsOf(report, me.personal.confusions, notes, Infinity, questionLabels(report, outline)) : [];
  return {
    username,
    minChecks: MIN_PLOTS,
    asFirst: me ? { checks: me.personal.asFirst.compared, agreeing: me.personal.asFirst.agreeing, rate: me.personal.asFirst.rate } : { checks: 0, agreeing: 0, rate: null },
    confusions,
    options: answerOptions(outline, [...confusions.map((c) => c.key), ...confusions.flatMap((c) => c.notes.map((n) => n.questionKey))]),
  };
}

/** The team report for training: the most frequent mix-ups with a few example plots, the notes, agreement by question. */
export function teamReport(report: QualityReport, notes: readonly GuidanceNote[], outline: Outline = null): TeamReport {
  const labels = questionLabels(report, outline);
  const confusions = confusionsOf(report, report.confusions.slice(0, TEAM_CONFUSIONS), notes, TEAM_CONFUSION_PLOTS, labels);
  return {
    minChecks: MIN_PLOTS,
    plotsChecked: report.plotsChecked,
    plotsDiffering: report.plotsDiffering,
    questions: report.questions.map((q) => {
      const out: TeamReport['questions'][number] = { key: q.key, label: q.label, kind: q.kind, checks: q.compared, agreeing: q.agreeing, rate: q.rate };
      if (q.margin !== undefined) {
        out.margin = q.margin;
      }
      return out;
    }),
    confusions,
    notes: notes.map((n) => reportNote(n, labels)),
    options: answerOptions(outline, [...report.questions.map((q) => q.key), ...confusions.map((c) => c.key), ...notes.map((n) => n.questionKey)]),
  };
}
