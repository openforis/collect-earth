// The review queue, plot search and a plot's page, as the server sends them. Types only: see README.md
// in this folder.
import type { PlotOutline } from './map.js';
import type { AnswerOptions, DecisionKind, Difference, Flag, PublicDecision } from './quality.js';

export type { AnswerOptions, DecisionKind, Difference, Flag, FlagDetails, FlagKind } from './quality.js';
/** A plot's decision as the review queue and the plot page carry it (the quality figures' PublicDecision). */
export type PlotDecision = PublicDecision;

/** A check whose answers differ from the first assessment; `changed` (only ever true): the records changed since the figures. */
export interface ListedDifference extends Difference {
  changed?: boolean;
}

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
  differences: ListedDifference[];
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
  /** The asker answered it (a record of theirs, or a copy they hold): someone else had better decide it (a warning) */
  own?: boolean;
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
  /** More flags than the queue takes (MAX_QUEUE_FLAGS): the newest of the plots still to decide were looked at. */
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
// The review queue as a list (docs/plans/2026-11-20-review-at-scale.md, A1): GET /v1/projects/:pid/quality/review-list,
// and one decision for many plots (A2): POST /v1/projects/:pid/quality/decisions:apply

/** Which plots the list shows: those waiting (the queue), those decided, or both */
export type ReviewListState = 'waiting' | 'decided' | 'all';
export type ReviewListSort = 'queue' | 'plot' | 'person' | 'kind';

/** One plot of the list */
export interface ReviewListLine {
  plot: string;
  /** Its part of the queue; null: decided and no longer waiting */
  section: QueueSection | null;
  /** Why it is there: 'difference', its kinds of flags, 'resubmitted' */
  kinds: string[];
  /** Everyone whose record is in it */
  people: string[];
  /** Its checks whose answers differ from the first assessment */
  checks: number;
  decision: PlotDecision | null;
  /** The asker answered it: someone else had better decide it (a warning, never a refusal) */
  own?: boolean;
}

export interface ReviewListAnswer {
  lines: ReviewListLine[];
  /** Lines matching the query, on every page */
  total: number;
  offset: number;
  /** Everyone named in the whole queue (the person filter's names: a coordinator's) */
  people: string[];
  computedAt: number;
  stale: boolean;
}

/** A plot that could not take the decision, and why */
export interface SkippedPlot {
  plot: string;
  reason: 'not_in_list' | 'no_check' | 'reference_plot';
}

/** POST .../quality/decisions:apply (?dryRun=1 only counts) */
export interface ApplyDecisionsAnswer {
  decision: DecisionKind;
  /** Plots decided (or, in a dry run, that would be) */
  count: number;
  /** The first of them (up to MAX_BULK_LISTED) */
  plots: string[];
  /** The plots asked for that cannot take it (up to MAX_BULK_LISTED), and how many in all */
  skipped: SkippedPlot[];
  skippedCount: number;
  dryRun: boolean;
  /** The run's id, kept with its decisions and in its audit entry (null for a dry run or nothing decided) */
  batch: string | null;
  /** Of the plots taken, those the asker answered (up to MAX_BULK_LISTED), and how many: a warning, never a refusal */
  own: string[];
  ownCount: number;
  /** "Correct it in Collect Earth" with people to assign them to (`assign`): who gets how many, and their own plots */
  assignment?: AssignmentPreview;
}

// ---------------------------------------------------------------------------
// Corrections (docs/plans/2026-11-20-review-at-scale.md, B2-B4): GET /quality/corrections, POST
// /quality/corrections:assign, and for Collect Earth GET /my-corrections(.csv), PUT /corrections/:plot

/** A plot assigned to someone who answered it: they would correct their own work (a warning, not a refusal) */
export interface OwnAssignment {
  plot: string;
  username: string;
}

/** Who gets how many plots to correct, and the plots that are their own */
export interface AssignmentPreview {
  people: { userId: string; username: string; plots: number; own: number }[];
  /** The plots assigned to someone who answered them (up to MAX_BULK_LISTED), and how many in all */
  own: OwnAssignment[];
  ownCount: number;
}

/** POST .../quality/corrections:assign (?dryRun=1 only counts) */
export interface AssignCorrectionsAnswer extends AssignmentPreview {
  /** Plots assigned (or, in a dry run, that would be); to nobody when no people were given */
  count: number;
  /** Plots not decided "Correct it in Collect Earth" (up to MAX_BULK_LISTED), and how many in all */
  skipped: string[];
  skippedCount: number;
  dryRun: boolean;
}

/** One plot to correct, as the coordinators see it */
export interface CorrectionLine {
  plot: string;
  /** Who corrects it (null: nobody yet) */
  assignedTo: { userId: string; username: string } | null;
  assignedAt: number | null;
  correctedBy: string | null;
  correctedAt: number | null;
  /** Assigned to someone who answered it */
  own: boolean;
}

export interface CorrectionsAnswer {
  lines: CorrectionLine[];
  counts: { unassigned: number; assigned: number; corrected: number };
  /** The people plots can be assigned to: the project's members who sign in (not disabled) */
  people: { userId: string; username: string; role: string }[];
}

/** One answer of a plot to correct, as Collect Earth gets it */
export interface CorrectionAnswer {
  operator: string;
  recordKey: string;
  /** The first assessment, a check, or neither */
  assessment: Assessment;
  submitted: boolean;
  modifiedOn: number;
  /** The record's XML (null when the server has none of it) */
  xml: string | null;
  summary: Record<string, string>;
}

/** A question on which the answers differ, with every answer (in the order of `answers`) */
export interface CorrectionDifference {
  key: string;
  /** The question's label */
  question: string;
  values: { operator: string; value: string; label: string }[];
}

/** One plot to correct of the person's */
export interface MyCorrection {
  plot: string;
  /** The plot's id in my-corrections.csv (its keys joined by ","): the plot unit, with the round of a first assessment when the server added round */
  placemarkId: string;
  /** The reviewer's comment, and who decided when */
  comment: string | null;
  decidedBy: string | null;
  decidedAt: number;
  /** The person answered it: a warning, as on the dashboard */
  own: boolean;
  /** When they corrected it (null: not yet) */
  correctedAt: number | null;
  /** First the answer the form starts from (the first assessment), then the others */
  answers: CorrectionAnswer[];
  differences: CorrectionDifference[];
}

/** GET .../my-corrections */
export interface MyCorrectionsAnswer {
  version: string;
  plots: MyCorrection[];
  /** The plot id's columns in the plot file (my-corrections.csv) */
  keyColumns: number;
  downloadPath: string;
}

/** PUT .../corrections/:plot */
export interface CorrectionSavedAnswer {
  plot: string;
  correctedAt: number;
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
  differences: ListedDifference[] | null;
  figures: { computedAt: number; stale: boolean } | null;
  place: { lat: number; lon: number; name: string } | null;
  outline: PlotOutline;
  /** Set when the survey's coordinates are not latitude and longitude: no place is given. */
  unsupportedSrs?: string;
}
