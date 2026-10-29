// The reports built from the quality figures for people who are not coordinators: a
// collector's own report ("My work") and the team report for training. Neither says who
// checked: they are built field by field from the figures, never by copying a record,
// a difference or a person's entry, so no username, record key or check time gets in.
import { marginKey, MIN_PLOTS, type Confusion, type QualityReport } from './quality.js';
import type { GuidanceNote } from './types.js';

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
}

/** GET /quality/team-report: no names at all. */
export interface TeamReport {
  minChecks: number;
  plotsChecked: number;
  plotsDiffering: number;
  questions: { key: string; label: string; kind: 'choice' | 'number'; checks: number; agreeing: number; rate: number | null; margin?: number }[];
  confusions: ReportConfusion[];
  notes: ReportNote[];
}

function reportNote(n: GuidanceNote): ReportNote {
  return { id: n.id, questionKey: n.questionKey, firstValue: n.firstValue, checkValue: n.checkValue, text: n.text };
}

/** Whether a note is about a confusion: its question (any index of an entity, as margins), and each answer it names. */
function matches(n: GuidanceNote, c: Confusion): boolean {
  return (
    (n.questionKey === c.key || marginKey(n.questionKey) === marginKey(c.key)) &&
    (n.firstValue === null || n.firstValue === c.first) &&
    (n.checkValue === null || n.checkValue === c.check)
  );
}

function confusionsOf(report: QualityReport, confusions: readonly Confusion[], notes: readonly GuidanceNote[], maxPlots: number): ReportConfusion[] {
  const labels = new Map(report.questions.map((q) => [q.key, q.label]));
  return confusions.map((c) => ({
    key: c.key,
    label: labels.get(c.key) ?? c.key,
    first: c.first,
    check: c.check,
    checks: c.count,
    plots: c.plots.slice(0, maxPlots),
    notes: notes.filter((n) => matches(n, c)).map(reportNote),
  }));
}

/**
 * The personal report of one collector (a member with a session): only their own
 * figures as first assessor, on the plots that are certainly theirs (PersonQuality.personal).
 */
export function personalReport(report: QualityReport, username: string, notes: readonly GuidanceNote[]): PersonalReport {
  const me = report.people.find((p) => p.username === username);
  return {
    username,
    minChecks: MIN_PLOTS,
    asFirst: me ? { checks: me.personal.asFirst.compared, agreeing: me.personal.asFirst.agreeing, rate: me.personal.asFirst.rate } : { checks: 0, agreeing: 0, rate: null },
    confusions: me ? confusionsOf(report, me.personal.confusions, notes, Infinity) : [],
  };
}

/** The team report for training: the most frequent mix-ups with a few example plots, the notes, agreement by question. */
export function teamReport(report: QualityReport, notes: readonly GuidanceNote[]): TeamReport {
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
    confusions: confusionsOf(report, report.confusions.slice(0, TEAM_CONFUSIONS), notes, TEAM_CONFUSION_PLOTS),
    notes: notes.map(reportNote),
  };
}
