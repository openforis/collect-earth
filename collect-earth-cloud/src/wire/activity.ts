// The activity log, the weekly summary and the downloads (coordinators), as the server sends them. The bell is in
// progress.ts (BellAnswer). Types only: see README.md in this folder.

import type { FlagCounts, PersonRow, PersonStatus, Role } from './people.js';
import type { ProgressTotals, Rate } from './progress.js';

/** Which answer of a differing plot is right: the first assessment, the check, or neither (look again). (The server's src/types.ts DecisionKind.) */
export type DecisionKind = 'first' | 'check' | 'recheck';

/** A choice question's codes and their labels, by question key (the server's src/qualityReports.ts answerOptions). */
export type AnswerOptions = Record<string, { code: string; label: string }[]>;

/**
 * What one stored upload did to a record (recordChange, src/lww.ts), from the stored
 * row before it and whether the record (key, operator) was ever submitted:
 * - `submitted`: actively saved (Submit and validate), the record's first submission;
 * - `resubmitted`: actively saved again, after an earlier submission;
 * - `unsubmitted`: a draft save (an autosave) onto a submitted plot;
 * - `deleted`: a tombstone;
 * - `created`: a first (or revived) record, not submitted;
 * - `updated`: a draft saved again.
 */
export type RecordChange = 'created' | 'updated' | 'submitted' | 'resubmitted' | 'unsubmitted' | 'deleted';

// --- the log (GET /v1/projects/:pid/activity) ---

/** One row of the log as the dashboard gets it. */
export type LogItem =
  | {
      type: 'record';
      id: string;
      /** When Collect Earth saved it (modifiedOn, the collector's clock). */
      at: number;
      receivedAt: number;
      person: string;
      change: RecordChange;
      /** The plot unit (the plot page's id), or null for a record of a plot in no plot file. */
      plot: string | null;
      /** The plot as the collector sees it (the keys hidden from the record list left out). */
      name: string;
      /** Coordinators see whether it is a first assessment or a check (the log is theirs only). */
      assessment: 'main' | 'check' | 'other';
      round: string;
    }
  | {
      type: 'audit';
      id: string;
      at: number;
      /** Who did it; null for a project key, or someone since removed or whose account is gone. */
      person: string | null;
      /** The audit action (the server's AUDIT_ACTIONS). */
      action: string;
      details: Record<string, string | number | boolean | null>;
      /** For a decision: the plot as the collector sees it. */
      plotName?: string;
    };

/** One page of the log. */
export interface ActivityPage {
  items: LogItem[];
  /** The cursor of the next page; null on the last one. */
  next: string | null;
  /** user id -> their name now (null: the account is gone) and whether they left the project. */
  people: Record<string, { name: string | null; removed: boolean }>;
  /** plot file id -> its name, or null when it is gone. */
  files: Record<string, string | null>;
  /** The people the log can be filtered by (the members' usernames). */
  persons: string[];
}

// --- the weekly summary (GET /v1/projects/:pid/weekly?week=&tz=) ---

export interface WeeklyPerson {
  userId: string;
  username: string;
  role: Role;
  /** Plots (not checks) first submitted in the week. */
  submitted: number;
  /** Checks first submitted in the week, reference plots' left out (they are measurements, Decision 8). */
  checks: number;
  /** Their checks of reference plots first submitted in the week (measurements against the reference, counted apart). */
  referenceMeasurements: number;
  /** As the People table has it now. */
  status: PersonStatus;
  plots: PersonRow['plots'];
}

export interface WeeklySummary {
  week: string;
  timeZone: string;
  /** Monday and Sunday of the week. */
  start: string;
  end: string;
  /** Whether the week is the viewer's current one (its figures are still growing). */
  current: boolean;
  progress: {
    /** Each day of the week: plots first submitted that day (as the Progress tab's bars), and checks (reference plots' apart). */
    days: { date: string; submitted: number; checks: number }[];
    submitted: number;
    /** Checks of the week, reference plots' left out. */
    checks: number;
    /** Checks of reference plots in the week: measurements against the reference, never decided (Decision 8). */
    referenceMeasurements: number;
    /** Plots submitted before the week, and by its end (each plot once, on the day of its first submission). */
    before: number;
    byEnd: number;
    /** The project's totals now. */
    totals: ProgressTotals;
  };
  people: WeeklyPerson[];
  quality: {
    /** False when no quality figures were at hand (nobody opened the Quality tab since the server started). */
    available: boolean;
    computedAt: number | null;
    stale: boolean;
    /** Checks of the week compared with their first assessment (the report's week: the check's last save, in UTC). */
    week: Rate | null;
    /** Every check so far. */
    overall: Rate | null;
    /** Decisions made in the week, by kind (decisions changed since keep only their last time; none of a reference plot). */
    decided: Record<DecisionKind, number> & { total: number };
    /** Plots worth a look found in the week (their time in the week), by kind; null without figures. */
    flags: { counts: FlagCounts; total: number } | null;
  };
}

export interface WeeklyAnswer extends WeeklySummary {
  /** When the figures are older than the records: the time they are from (newer ones are being worked out). */
  asOf: number | null;
}

// --- the downloads (GET /v1/projects/:pid/exports/:kind?tz=) ---

export type ExportKind = 'people' | 'daily' | 'decisions' | 'differences';

/** The daily activity download: per local day and person, what Collect Earth stored. */
export interface DailyRow {
  date: string;
  person: string;
  /** Plots (first assessments) first submitted that day, as the Progress tab counts them. */
  plots: number;
  /** Checks first submitted that day. */
  checks: number;
  /** Plots submitted again after being taken back to edit (record events). */
  submittedAgain: number;
  /** Saves not submitted: a draft saved, first or again (record events, autosaves included). */
  drafts: number;
  /** Submitted plots opened again and changed (not submitted now). */
  reopened: number;
  deleted: number;
}

/** One row of the decisions download. */
export interface DecisionRow {
  plot: string;
  /** The plot as the collector sees it. */
  name: string;
  decision: DecisionKind;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: number;
  /** Null when the figures were not at hand to tell. */
  byAssessor: boolean | null;
  /** Made for several plots at once. */
  bulk: boolean;
}

/** One row of the differences download: a differing question of a pair, or a pair changed or gone since the figures. */
export interface DifferenceRow {
  plot: string;
  name: string;
  first: string;
  check: string;
  latest: boolean;
  decision: DecisionKind | null;
  /** Null for a pair changed or gone since the figures. */
  key: string | null;
  firstAnswer: string | null;
  checkAnswer: string | null;
  /** differs: the answers differ as the figures found; changed: they no longer differ; gone: a record of the pair was deleted. */
  status: 'differs' | 'changed' | 'gone';
}

/** The quality figures a download was made from: when, and whether newer records are being worked in. */
export interface ExportFigures {
  computedAt: number;
  stale: boolean;
}

/** The rows of a download, written as CSV in the browser in the person's language. */
export type ExportAnswer =
  | { kind: 'people'; today: string; timeZone: string; rows: PersonRow[] }
  | { kind: 'daily'; today: string; timeZone: string; rows: DailyRow[] }
  | { kind: 'decisions'; today: string; timeZone: string; rows: DecisionRow[]; figures: ExportFigures | null }
  | {
      kind: 'differences';
      today: string;
      timeZone: string;
      rows: DifferenceRow[];
      /** question key -> its label. */
      labels: Record<string, string>;
      options: AnswerOptions;
      /** The number questions: their answers are written as numbers in the CSV. */
      numbers: string[];
      figures: ExportFigures;
    };
