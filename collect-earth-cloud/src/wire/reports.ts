// The printable reports as the server sends them: a member's own figures (My quality) and the team
// report for training. Types only: see README.md in this folder.

import type { AnswerOptions } from './quality.js';

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

/** GET /v1/projects/:pid/my-quality */
export interface MyQualityAnswer extends PersonalReport {
  /** ms since the epoch: when the records the figures are from were read. */
  computedAt: number;
  /** Older figures, given while newer ones are worked out. */
  stale: boolean;
}

/** GET /v1/projects/:pid/quality/team-report */
export interface TeamReportAnswer extends TeamReport {
  computedAt: number;
  stale: boolean;
}
