// The Quality tab as the server sends it: the figures and the number margins, the decisions, the
// guidance notes, where plots are, the answers per person (Task 4), the pattern flags (Task 5) and
// the "very fast" threshold. Types only: see README.md in this folder.

import type { PlotColumn } from './plotFiles.js';
import type { Rate } from './progress.js';

export type { PlotColumn } from './plotFiles.js';
export type { PlotOutline, PlotPlace, PlotPlaces } from './map.js';

// --- the figures (GET /v1/projects/:pid/quality) ---

export interface QuestionAgreement extends Rate {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  /** The margin used, for a number question. */
  margin?: number;
}

export interface Confusion {
  key: string;
  /** The first assessment's answer and the check's: codes without qualifier, several sorted and joined by ", ". */
  first: string;
  check: string;
  count: number;
  /** Up to MAX_CONFUSION_PLOTS plots, in plot order. */
  plots: string[];
}

export interface PersonQuality {
  username: string;
  /** Checked plots this person assessed first; a plot agrees when no compared question differs. */
  asFirst: Rate;
  /** Plots this person checked. */
  asChecker: Rate;
  /** Up to MAX_WEAKEST questions where their plots (in either role) differ most; only questions that differed. */
  weakest: { key: string; rate: number | null; compared: number; differing: number }[];
  /**
   * For the person's own report: only the plots that are certainly theirs as first
   * assessor. A plot with two main assessments (two_main) is left out, and so is a plot
   * of a divided file they do not hold as main: anyone could otherwise post a first
   * assessment of someone else's plot and read its check in their report.
   */
  personal: {
    /** The checks of those plots, as asFirst. */
    asFirst: Rate;
    /**
     * Up to MAX_PERSON_CONFUSIONS mix-ups of a choice between their first assessment and
     * a check of it, ordered as the report's confusions; count is checks, with up to
     * MAX_PERSON_CONFUSION_PLOTS plots (in plot order).
     */
    confusions: Confusion[];
  };
}

export interface WeekAgreement {
  /** ISO week (yyyy-Www) of the check's modifiedOn, in UTC. */
  week: string;
  compared: number;
  agreeing: number;
}

export interface Difference {
  /** The plot unit, as in the plot file (with its round part for an own round). */
  plot: string;
  first: { operator: string; recordKey: string };
  check: { operator: string; recordKey: string };
  /** Answers as given, blank and null values left out, several joined by ", ". */
  fields: { key: string; first: string; check: string }[];
}

export type DataProblemKind = 'no_plot' | 'unknown_round' | 'two_main' | 'extra_key_parts';

export interface DataProblem {
  kind: DataProblemKind;
  plot: string;
  recordKey: string;
  operator: string;
}

/** The quality report's figures as sent (the server's QualityReport adds every differing pair, never sent). */
export interface QualityReportFigures {
  /** Plots with at least one main record and one check record. */
  plotsChecked: number;
  plotsDiffering: number;
  questions: QuestionAgreement[];
  confusions: Confusion[];
  people: PersonQuality[];
  weeks: WeekAgreement[];
  /** Up to MAX_DIFFERENCES, in plot order. */
  differences: Difference[];
  /** Up to MAX_PROBLEMS, in plot order. */
  problems: DataProblem[];
  problemsTotal: number;
  /** How many problems of each kind name each person, over all of them (not only the listed ones); by person, then kind. */
  problemsByPerson: { operator: string; kind: DataProblemKind; count: number }[];
  /** Answers to entities the outline does not list (e.g. tree[11]: it lists 1 to 10), never compared. */
  beyondOutline: { count: number; keys: string[] };
}

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

/** Which answer of a differing plot is right: the first assessment, the check, or neither (look again). */
export type DecisionKind = 'first' | 'check' | 'recheck';

/**
 * A decision as clients get it (PUT .../quality/decisions/:plot, and in the figures, the review queue
 * and the plot page): without what it saw of the records, and whether whoever decided has a record
 * of the plot (a coordinator may decide their own plot; the page says so). `byAssessor` is false when
 * the figures are not at hand.
 */
export interface PublicDecision {
  plot: string;
  decision: DecisionKind;
  comment: string | null;
  /** Username of who decided; null when made with a project token or the account is gone. */
  decidedBy: string | null;
  decidedAt: number;
  /** The bulk run that made it (its audit entry has the same id); null for a decision made alone. */
  batch?: string | null;
  byAssessor: boolean;
}

/** What a guidance note is about: a question and, for a mixed-up pair, both answers (the body of POST and PUT .../quality/notes). */
export interface GuidanceNoteInput {
  questionKey: string;
  firstValue: string | null;
  checkValue: string | null;
  text: string;
}

/** A note for collectors about a question (or one mix-up of its answers). */
export interface GuidanceNote extends GuidanceNoteInput {
  id: string;
  /** Username of who last wrote it; null when made with a project token or the account is gone. */
  updatedBy: string | null;
  updatedAt: number;
}

/** A project's quality-review settings as stored: number margins (percent) by question key. */
export interface QualitySettings {
  margins: Record<string, number>;
  /** The "very fast" flag's threshold in whole seconds (Task 5); absent: DEFAULT_FAST_SECONDS (15). */
  fastSeconds?: number;
}

/**
 * The quality settings as sent (in the figures, and PUT .../quality/settings): the margins, and
 * the "very fast" threshold in force (the default when the project has not set one).
 */
export interface QualitySettingsAnswer {
  margins: Record<string, number>;
  fastSeconds: number;
}

/** GET /v1/projects/:pid/quality: the figures with the decisions, notes, settings and answer options. */
export interface QualityAnswer extends QualityReportFigures {
  /** ms since the epoch: when the records the figures are from were read. */
  computedAt: number;
  /** Older figures, given while newer ones are worked out. */
  stale: boolean;
  decisions: PublicDecision[];
  notes: GuidanceNote[];
  settings: QualitySettingsAnswer;
  /** The answer options of the questions shown and of the notes. */
  options: AnswerOptions;
  /** People a coordinator left out of these figures, with why. */
  excluded: { username: string; reason: string | null }[];
}

/** GET /v1/projects/:pid/quality/notes */
export interface GuidanceNotesAnswer {
  notes: GuidanceNote[];
}

// --- where plots are (POST /v1/projects/:pid/quality/places): PlotPlaces in map.ts ---

// --- answers per person (GET /v1/projects/:pid/quality/answers, Task 4) ---

export interface CodeCount {
  code: string;
  label: string;
  count: number;
}

export interface ChoiceStats {
  key: string;
  label: string;
  multiple: boolean;
  /** Plots answering it (at least one code). */
  answered: number;
  /** Plots in the filter that did not answer it (blank, or not shown). */
  blank: number;
  /** Plots holding each code (a plot of a multiple question counts once per code it holds), codes nobody gave left out. */
  codes: CodeCount[];
  /** Per person: plots answering, and plots holding each of `codes`, in that order. */
  people: { username: string; answered: number; counts: number[] }[];
  /** Flags on this question (all of them, also those beyond MAX_FLAGS). */
  flags: number;
}

export interface Spread {
  /** Plots holding one number. */
  values: number;
  /** Plots holding something else (text, several values): not used. */
  nonNumeric: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
}

export interface NumberStats {
  key: string;
  label: string;
  team: Spread;
  people: ({ username: string } & Spread)[];
}

export interface AnswerFlag {
  key: string;
  label: string;
  username: string;
  code: string;
  codeLabel: string;
  /** The person's plots answering the question, and those holding the code. */
  plots: number;
  count: number;
  share: number;
  /** The same for the rest of the team (everyone in the filter but this person). */
  others: { plots: number; count: number; share: number };
  z: number;
}

export interface AnswerStats {
  /** First assessments in the filter. */
  plots: number;
  person: string | null;
  /** Each person's plots in the filter (only the person's when one is chosen), by name. */
  people: { username: string; plots: number }[];
  choices: ChoiceStats[];
  numbers: NumberStats[];
  /** Up to MAX_FLAGS, the largest |z| first. */
  flags: AnswerFlag[];
  flagsTotal: number;
  /** Comparisons made (a person and an answer against the rest of the team, enough plots on both sides). */
  tests: number;
  /** About how many flags chance alone would give: tests × CHANCE_PER_TEST. */
  chanceFlags: number;
}

/** GET /v1/projects/:pid/quality/answers: the figures for the filter (a reviewer's without anyone's own), and what can be filtered by. */
export interface AnswersAnswer extends AnswerStats {
  computedAt: number;
  stale: boolean;
  /** The time zone the from/to days were read in. */
  timeZone: string;
  filters: {
    /** Everyone with a first assessment (empty for a reviewer). */
    people: string[];
    files: { id: string; filename: string }[];
  };
}

/** GET /v1/projects/:pid/quality/answers/columns?file=: a plot file's columns (not the id) to filter the answers by. */
export interface AnswerColumnsAnswer {
  hasHeader: boolean;
  columns: PlotColumn[];
}

// --- pattern flags (GET /v1/projects/:pid/quality/flags, Task 5) ---

export type FlagKind = 'very_fast' | 'same_as_before' | 'required_empty' | 'edited_after_decision' | 'two_main' | 'no_plot';

/** One plot worth a look. A stable shape: the review queue (Task 7) is built from it. */
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

export type FlagCounts = Record<FlagKind, number>;

export interface PatternFlags {
  fastSeconds: number;
  /** First assessments looked at (the answer table's rows). */
  plots: number;
  /** Flags of each kind, of the person when one is chosen; two_main and no_plot are all the report found. */
  counts: FlagCounts;
  /** Everyone with a flag, the most first: their counts by kind and in all. */
  people: { username: string; counts: FlagCounts; total: number }[];
  /** Flags that match the filters, listed or not. */
  total: number;
  /** Up to MAX_LISTED_FLAGS of them, newest first (the report lists up to 500 data problems: the two_main and no_plot listed are among those). */
  flags: Flag[];
  /** Whether the survey has questions required without condition (else required_empty can never be found). */
  requiredQuestions: number;
}

/** GET /v1/projects/:pid/quality/flags: a reviewer's has no one's counts (people is empty). */
export interface FlagsAnswer extends PatternFlags {
  computedAt: number;
  stale: boolean;
}
