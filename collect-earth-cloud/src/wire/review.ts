// The review queue, plot search and a plot's page, as the server sends them. Types only: see README.md
// in this folder.
import type { PlotOutline } from './map.js';

// ---------------------------------------------------------------------------
// The quality figures' pieces these answers carry. Their server types live with the quality figures
// and the pattern flags (Flag in src/flags.ts, Difference in src/quality.ts, QualityDecision and
// DecisionKind in src/types.ts, AnswerOptions in src/qualityReports.ts, Resubmitted in src/flags.ts);
// these are their shapes as sent, which the routes' `satisfies` checks. Merge: once those move to
// src/wire/, import them from there instead.

export type DecisionKind = 'first' | 'check' | 'recheck';

export type FlagKind = 'very_fast' | 'same_as_before' | 'required_empty' | 'edited_after_decision' | 'two_main' | 'no_plot';

export type FlagDetails =
  /** very_fast: ms since the same person's previous first assessment, and its plot (null: a plot hidden from the viewer). */
  | { gapMs: number; previousPlot: string | null }
  /** same_as_before: the plot before it (same answers), the run's length and its first plot (null: hidden from the viewer). */
  | { previousPlot: string | null; runLength: number; firstPlot: string | null; answers: number }
  /** required_empty: the questions left empty. */
  | { questions: { key: string; label: string }[] }
  /** edited_after_decision: the decision and when it was made. */
  | { decision: DecisionKind; decidedAt: number }
  /** two_main, no_plot: the record (the quality report's data problem). */
  | { recordKey: string };

/** A plot worth a look (pattern flags, Task 5). Only `operator` names a person. */
export interface Flag {
  kind: FlagKind;
  /** The plot unit (as Difference.plot and the decisions), or for a plot in no file its id. */
  plot: string;
  /** The username of the person whose record it is: the only person a flag ever names. */
  operator: string;
  /** When that record was saved (modifiedOn, ms), or null when it is not known. */
  at: number | null;
  details: FlagDetails;
}

/** A check of a plot whose answers differ from the first assessment; `changed` (only ever true): the records changed since the figures. */
export interface Difference {
  /** The plot unit, as in the plot file (with its round part for an own round). */
  plot: string;
  first: { operator: string; recordKey: string };
  check: { operator: string; recordKey: string };
  /** Answers as given, blank and null values left out, several joined by ", ". */
  fields: { key: string; first: string; check: string }[];
  changed?: boolean;
}

/** A plot's decision as sent (publicDecision): whoever decided it has a record of it (`byAssessor`). */
export interface PlotDecision {
  plot: string;
  decision: DecisionKind;
  comment: string | null;
  /** Username of who decided; null when made with a project token or the account is gone. */
  decidedBy: string | null;
  decidedAt: number;
  /** The bulk run that made it; null for a decision made alone. */
  batch?: string | null;
  byAssessor: boolean;
}

/** The answer options of choice questions, by question key: to show an answer by its label ("Forest") instead of its code ("F"). */
export type AnswerOptions = Record<string, { code: string; label: string }[]>;

// ---------------------------------------------------------------------------
// The review queue (Task 7): GET /v1/projects/:pid/quality/queue, POST .../quality/decisions:bulk

export type QueueSection = 'difference' | 'flag' | 'resubmitted';

/** A plot decided "both need another look" that someone submitted again. */
export interface Resubmission {
  plot: string;
  operator: string;
  at: number;
  decidedAt: number;
}

/** One plot of the review queue, with everything known about it. */
export interface ReviewQueueItem {
  plot: string;
  section: QueueSection;
  /** Everyone whose record is shown, sorted. */
  people: string[];
  /** Its checks that differ from the first assessment, with the answers. */
  differences: Difference[];
  /** Its flags in the queue, newest first. */
  flags: Flag[];
  /** Who submitted it again after "both need another look", newest first. */
  resubmitted: Resubmission[];
  /**
   * Decided "both need another look" only: who it went back to and has not submitted it again yet,
   * still in the project (`waiting`), and those of them no longer in it or disabled (`left`).
   */
  waiting?: string[];
  left?: string[];
  decision: PlotDecision | null;
}

export interface ReviewQueueAnswer {
  items: ReviewQueueItem[];
  /** The cursor of the next page (null: no more plots after this page). */
  next: string | null;
  /** Plots in the queue (with the filters), listed or not. */
  total: number;
  counts: Record<QueueSection, number>;
  /** Everyone named in the whole queue, whatever the filters (for the person filter). */
  people: string[];
  /** A reviewer's own plots left out of the queue (someone else decides them); 0 for a coordinator. */
  excludedOwn: number;
  /** Only the newest flags (MAX_LISTED_FLAGS) were looked at. */
  flagsCapped: boolean;
  /** The labels of the questions shown, by key. */
  labels: Record<string, string>;
  options: AnswerOptions;
  computedAt: number;
  stale: boolean;
}

export type BulkRule = 'first_by_reviewer' | 'check_by_reviewer';

/** POST .../quality/decisions:bulk (?dryRun=1 only counts). */
export interface BulkDecisionAnswer {
  rule: BulkRule;
  decision: DecisionKind;
  /** Plots decided (or, in a dry run, that would be). */
  count: number;
  /** The first of them (up to MAX_BULK_LISTED). */
  plots: string[];
  dryRun: boolean;
  /** The run's id, kept with its decisions and in its audit entry (null for a dry run or nothing decided). */
  batch: string | null;
}

// ---------------------------------------------------------------------------
// Plot search (Task 8): GET /v1/projects/:pid/plots/search?q= and GET /v1/projects/:pid/plots/:plot

export interface PlotMatch {
  /** The plot unit, as the quality figures, the decisions and the review queue name it. */
  plot: string;
  /** The id the collector sees. */
  name: string;
  /** The plot files holding it, in the files' order. */
  files: { id: string; filename: string }[];
}

export interface PlotSearchAnswer {
  plots: PlotMatch[];
  /** Other plots match too: typing more narrows them. */
  more: boolean;
}

/** Which assessment a record is: the first assessment, a check, or neither (an unknown round). */
export type Assessment = 'main' | 'check' | 'other';

/** One record of the plot as the page shows it. */
export interface PlotPageRecord {
  operator: string;
  recordKey: string;
  /** The round as the figures read it ("1", "2", a year...). */
  round: string;
  assessment: Assessment;
  submitted: boolean;
  deleted: boolean;
  modifiedOn: number;
  /** Coordinators only. */
  receivedAt?: number;
  /** Its answers to the questions listed (`questions`), as stored. */
  answers: Record<string, string>;
}

/** A plot file holding the plot; coordinators also get who holds it there (main and copies), reviewers the file only. */
export interface PlotPageFile {
  id: string;
  filename: string;
  divided: boolean;
  main?: string[];
  copies?: string[];
}

/** GET /v1/projects/:pid/plots/:plot: one plot's page. */
export interface PlotPageAnswer {
  plot: string;
  name: string;
  files: PlotPageFile[];
  records: PlotPageRecord[];
  /** The questions answered, in the survey's order. */
  questions: { key: string; label: string }[];
  labels: Record<string, string>;
  options: AnswerOptions;
  decision: PlotDecision | null;
  /** The reviewer asking made a record of it (or holds a copy): someone else decides it. */
  ownPlot: boolean;
  /** A reference plot (only coordinators see one's page), with its assessor; null: not one. */
  reference: { assessor: string } | null;
  /** From the quality figures at hand; null when there are none (the Quality tab works them out). */
  flags: Flag[] | null;
  differences: Difference[] | null;
  figures: { computedAt: number; stale: boolean } | null;
  place: { lat: number; lon: number; name: string } | null;
  outline: PlotOutline;
  /** Set when the survey's coordinates are not latitude and longitude: no place is given. */
  unsupportedSrs?: string;
}
