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
  differences: ListedDifference[] | null;
  figures: { computedAt: number; stale: boolean } | null;
  place: { lat: number; lon: number; name: string } | null;
  outline: PlotOutline;
  /** Set when the survey's coordinates are not latitude and longitude: no place is given. */
  unsupportedSrs?: string;
}
