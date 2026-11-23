// The Quality tab's automatic checks (their sampling rule), reference plots and survey health, as the
// server sends them. Types only: see README.md in this folder.
import type { Rate } from './progress.js';
import type { AnswerOptions } from './quality.js';

// ---------------------------------------------------------------------------
// Automatic checks (Task 13): GET/PUT /v1/projects/:pid/sampling, POST .../sampling/draw

/**
 * What the automatic check sampling does (Task 13), for the project or one divided file.
 * - `checkers`: the user ids who may receive checks; null = every collector (reviewers and
 *   coordinators only when chosen).
 * - `firstN`: check the first N plots each person submits; null = off.
 * - `percent`: check this share of each person's plots of each ISO week; null = off.
 */
export interface SamplingCore {
  checkers: string[] | null;
  firstN: number | null;
  percent: number | null;
}

/** One divided file's own rule: the project's (the default, not stored), none, or its own. */
export type SamplingFileRule = { use: 'off' } | ({ use: 'own' } & SamplingCore);

/** The rule as a coordinator saves it (PUT /sampling): the project's, and the divided files that do not follow it. */
export interface SamplingRuleInput extends SamplingCore {
  files: Record<string, SamplingFileRule>;
}

/** The project's rule; `seed` makes every draw repeatable; `files` only the files that do not use the project's rule. */
export interface SamplingRule extends SamplingRuleInput {
  seed: number;
}

/** One draw, as kept for the Checks section (counts and ids only). */
export interface SamplingDraw {
  at: number;
  /** Who pressed "Draw now"; null for an automatic draw. */
  byUserId: string | null;
  automatic: boolean;
  /** Copies added, and of them for each rule. */
  drawn: number;
  firstN: number;
  percent: number;
  /** Plots due for a check that no checker could take (all of them assessed or hold it). */
  noChecker: number;
}

/** A divided file in the Checks section: its rule, its plots and its copies. */
export interface SamplingFile {
  csvFileId: string;
  filename: string;
  use: 'project' | 'off' | 'own';
  own: SamplingCore | null;
  plots: number;
  submitted: number;
  sampledCopies: number;
  /** The division's copies (reference copies apart). */
  divisionCopies: number;
  /** Copies of reference plots (Task 14). */
  referenceCopies: number;
  pending: number;
}

/** Someone who may receive checks or holds some: their checks open, done and drawn. */
export interface SamplingChecker {
  userId: string;
  username: string;
  role: 'admin' | 'reviewer' | 'operator';
  eligible: boolean;
  disabled: boolean;
  open: number;
  done: number;
  sampled: number;
}

/** GET and PUT /v1/projects/:pid/sampling: what the Checks section shows. */
export interface SamplingView {
  rule: SamplingRule | null;
  active: boolean;
  intervalMinutes: number;
  due: boolean;
  dueSince: number | null;
  /** When the next automatic draw can be made (a first submission or someone's plot list then triggers it). */
  nextAutomaticAt: number | null;
  /** The last draw that added copies, with the username of who pressed "Draw now" (null: automatic, or an account since gone). */
  lastDraw: (SamplingDraw & { by: string | null }) | null;
  /** When a draw last looked for plots to check (one that found none included). */
  lastCheckedAt: number | null;
  /** What a draw now would add. */
  pending: { drawn: number; firstN: number; percent: number; noChecker: number };
  files: SamplingFile[];
  /** Whole files cannot hold checks: assign them by plot to use checks. */
  wholeFiles: { csvFileId: string; filename: string }[];
  checkers: SamplingChecker[];
  /** Everyone of the project, to choose the checkers from. */
  members: { userId: string; username: string; role: 'admin' | 'reviewer' | 'operator'; disabled: boolean }[];
  /** Nobody may receive checks under the project's rule. */
  noCheckers: boolean;
  /**
   * Reviewers or coordinators chosen as checkers (the project's or a file's own rule): they can
   * read the first assessments on the dashboard, so their checks may not be blind (Decision 10).
   */
  warning: { code: 'checkers_not_blind'; usernames: string[] } | null;
  asOf: number;
}

/** POST /v1/projects/:pid/sampling/draw ("Draw now"): the draw, and the section as it is after it. */
export interface SamplingDrawAnswer {
  draw: SamplingDraw;
  view: SamplingView;
}

// ---------------------------------------------------------------------------
// Reference plots (Task 14): /v1/projects/:pid/reference...

/** A question's accuracy: of the checks answering it (or the reference), how many match the reference. */
export interface ReferenceQuestion extends Rate {
  key: string;
  label: string;
  kind: 'choice' | 'number';
}

/** Answers compared and how many of them match. */
export interface Tally {
  compared: number;
  agreeing: number;
}

export interface ReferencePerson {
  username: string;
  /** Reference plots they checked (one check per plot, their latest); agreeing = every compared answer matches. */
  plots: Rate;
  /** Every answer of those checks compared with the reference's, all questions together. */
  answers: Tally;
  /**
   * Those answers split by when the check was submitted: the answers of their latest RECENT_CHECKS checks, and of the
   * checks before them; `earlier` is null while they have no more checks than that. For a trend ("getting better").
   */
  recent: Tally;
  earlier: Tally | null;
  /** Per question, in the survey's order: their answers compared with the reference's. */
  questions: { key: string; label: string; compared: number; agreeing: number; rate: number | null }[];
}

/**
 * How a share stands against the project's accuracy target (src/accuracy.ts): `below` when even the top of its margin
 * is under the target, `watch` when it is under the target but the margin reaches it, `ok` at the target or above,
 * `early` when at the target or above with too few compared to say.
 */
export type Verdict = 'ok' | 'watch' | 'below' | 'early';

/** A share's 95% margin of error (0..1) and its verdict against the target; all null with nothing compared. */
export interface Judged {
  low: number | null;
  high: number | null;
  verdict: Verdict | null;
}

/**
 * How much the collectors agree among themselves on the reference plots, for a choice question, whatever the reference
 * says: of every pair of collectors' answers on a plot, how many are the same, and Fleiss' kappa (the agreement
 * corrected for chance: 1 is full agreement, 0 what chance alone gives; null when it cannot be worked out).
 */
export interface ReferenceAmong extends Tally {
  key: string;
  label: string;
  /** Reference plots that two or more collectors answered. */
  plots: number;
  kappa: number | null;
}

/**
 * A reference plot whose reference answer is in doubt: most of the collectors who checked it gave one same answer,
 * and it is not the reference's. The reference assessor may be the one who is wrong.
 */
export interface ReferenceDoubt {
  plot: string;
  assessor: string;
  key: string;
  label: string;
  /** The reference's answer and the collectors' most given one, as shown (codes without qualifier). */
  reference: string;
  majority: string;
  /** Collectors who gave that answer, of those who answered the question on this plot. */
  count: number;
  of: number;
}

export interface ReferenceFigures {
  /** Reference plots, and of them those whose reference assessment is submitted (only those are measured). */
  plots: number;
  assessed: number;
  /** Checks measured: one per person and plot, with at least one question compared. */
  checks: number;
  /** Per question, everyone's checks together, in the survey's order. */
  questions: ReferenceQuestion[];
  /** Everyone with a check measured, by name. */
  people: ReferencePerson[];
  /** Each reference plot (plot order): its assessor, whether the reference is submitted, how many checks of it are, and how many of them match the reference on every question. */
  byPlot: { plot: string; assessor: string; assessed: boolean; checks: number; agreeing: number }[];
  /** The collectors' agreement among themselves, per choice question, in the survey's order. */
  among: ReferenceAmong[];
  /** Reference answers in doubt, the most contradicted first; at most MAX_DOUBTFUL, `doubtfulTotal` counts them all. */
  doubtful: ReferenceDoubt[];
  doubtfulTotal: number;
  /** Against the reference answers a coordinator uploaded (externalReferenceFigures); absent without them. */
  external?: ExternalReferenceFigures;
}

export interface ExternalReferenceFigures {
  /** Plots with reference answers, and of them those someone's record was compared on. */
  plots: number;
  assessed: number;
  /** Records compared: each person's latest submitted record of each plot (first assessment or check). */
  checks: number;
  /** Per question, everyone's answers together, in the survey's order: agreeing = the same as the reference. */
  questions: ReferenceQuestion[];
  /** Per person, by name: `answers` every compared answer (its share differing is their disagreement), `plots` all agreeing. */
  people: (Pick<ReferencePerson, 'username' | 'plots' | 'questions'> & { answers: Rate })[];
  /** Per plot (plot order): records compared, and their answers compared and agreeing. */
  byPlot: { plot: string; records: number; compared: number; agreeing: number }[];
}

/**
 * The figures as GET /reference sends them: everything for coordinators; for reviewers the figures
 * per question only (Decision 3: no one's accuracy by name, no plot list), so `byPlot` and
 * `people` are left out, of the external figures too.
 */
export interface ReferenceFiguresAnswer extends Omit<ReferenceFigures, 'byPlot' | 'people' | 'external' | 'questions' | 'doubtful'> {
  /** The project's accuracy target, in percent (its quality settings): what the verdicts are judged against. */
  target: number;
  /** Per question, with its margin of error and its verdict against the target. */
  questions: (ReferenceQuestion & Judged)[];
  byPlot?: ReferenceFigures['byPlot'];
  /** Coordinators only: each person, with their verdict (the most worrying of their questions') and their trend. */
  people?: JudgedPerson[];
  /** Coordinators only (plots and an assessor's name); reviewers get `doubtfulTotal`. */
  doubtful?: ReferenceDoubt[];
  /** Coordinators only: the answer options of the questions in doubt, so their answers are shown by their labels. */
  options?: AnswerOptions;
  external?: Omit<ExternalReferenceFigures, 'byPlot' | 'people'> & Partial<Pick<ExternalReferenceFigures, 'byPlot' | 'people'>>;
  computedAt: number;
  stale: boolean;
}

/** A person's accuracy as served: every question judged, the person by the most worrying of them. */
export interface JudgedPerson extends Omit<ReferencePerson, 'questions' | 'answers'> {
  /** All their answers together, with the margin and the verdict of that share. */
  answers: Tally & Judged;
  questions: (ReferencePerson['questions'][number] & Judged)[];
  /** The most worrying verdict of their questions; null when nothing of theirs is compared. */
  verdict: Verdict | null;
  /** Their latest answers against their earlier ones; null while there are too few on either side. */
  trend: 'better' | 'worse' | 'same' | null;
}

/** A reference plot as coordinators list it. */
export interface ReferencePlotRow {
  csvFileId: string;
  filename: string;
  plot: string;
  assessor: string;
  assessorUserId: string;
  /** The assessor is still a member of the project. */
  assessorInProject: boolean;
  addedAt: number;
  /** The reference assessment is submitted. */
  assessed: boolean;
  /** The assessor has a record of it (drafts too). */
  started: boolean;
  /** Collectors holding a copy, and of them those who submitted their check. */
  copies: number;
  checked: number;
  /** Checks of it measured by the figures; null without figures at hand. */
  measured: number | null;
}

/** The coordinator's view of the reference set: the plots, what they can be built from and each collector's copies. */
export interface ReferenceSet {
  max: number;
  count: number;
  plots: ReferencePlotRow[];
  files: { csvFileId: string; filename: string; plots: number; reference: number }[];
  wholeFiles: { csvFileId: string; filename: string }[];
  /** Who may be a reference assessor: coordinators and reviewers, not disabled. */
  assessors: { userId: string; username: string; role: 'admin' | 'reviewer' | 'operator' }[];
  collectors: number;
  people: { userId: string; username: string; copies: number; checked: number }[];
  /** The reference answers uploaded (a file of the coordinator's): how many plots, and when. */
  external: { count: number; uploadedAt: number | null };
  /** When the project state is older than the records: the time it is from. */
  asOf: number | null;
}

/** GET /v1/projects/:pid/reference: the figures and how many reference plots there are (of at most `max`); for coordinators also the reference set. */
export type ReferenceAnswer =
  | { coordinator: false; count: number; max: number; figures: ReferenceFiguresAnswer }
  | ({ coordinator: true; figures: ReferenceFiguresAnswer } & ReferenceSet);

/** What changeReferencePlots did. */
export interface ReferenceChangeResult {
  unmarked: number;
  marked: number;
  copiesAdded: number;
  copiesDropped: number;
}

/** POST .../reference/plots and .../reference/remove: what changed, and the reference set after it (no figures). */
export interface ReferenceChangeAnswer extends ReferenceSet {
  result: ReferenceChangeResult;
}

/** POST .../reference/plots: the plots of a divided file to mark, by id or `random` plots nobody has assessed. */
export type ReferenceMarkBody =
  | { csvFileId: string; assessorUserId: string; plots: string[] }
  | { csvFileId: string; assessorUserId: string; random: number };

/** PUT .../reference/answers: what an upload of reference answers took, and what did not match. */
export interface ReferenceAnswersReport {
  plots: number;
  /** The file's columns taken, with the question each one is. */
  columns: { column: string; key: string }[];
  /** Columns that are no question answers are compared on (by name, key or label). */
  unmatchedColumns: string[];
  /** Answers that are none of the question's (a number for a number question), with how often. */
  unmatchedValues: { column: string; value: string; count: number }[];
  /** Plot ids in no plot file of the project (their rows are not kept). */
  unknownPlots: string[];
  unknownPlotCount: number;
}

// ---------------------------------------------------------------------------
// Survey health (Task 6): GET /v1/projects/:pid/quality/survey-health

export type HealthReason = 'low_agreement' | 'often_other' | 'often_empty' | 'often_changed';

/** Plots answering a question with some options ("other"-like, or "none" alone), and those options. */
export interface HealthCodes {
  count: number;
  share: number | null;
  answers: { code: string; label: string; count: number }[];
}

export interface HealthRow {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  calculated: boolean;
  required: boolean;
  /** Shown or required only under a condition: its empty share is information, never a reason. */
  conditional: boolean;
  /** Inside a group of questions: whether it was left empty is never known. */
  inGroup: boolean;
  /** First assessments answering it; holding it blank; holding a non-number in a number question. */
  answered: number;
  blank: number;
  nonNumeric: number;
  /**
   * The first assessments that say whether it was left empty (they keep their empty
   * answers, see keepsBlanks, and hold the question): emptyBase; of them left empty:
   * emptyBlank. notKnown: the others (plots - emptyBase).
   */
  emptyBase: number;
  emptyBlank: number;
  notKnown: number;
  /** emptyBlank / emptyBase; null in a group, or under MIN_PLOTS of emptyBase (emptyWhy says which). */
  emptyShare: number | null;
  emptyWhy: 'group' | 'few_records' | null;
  /** For a choice: the plots answering "none" alone (Decision 6), for information: never a reason. */
  none: HealthCodes | null;
  /** For a choice: the plots answering with an other-like option, its share of those answering (null under MIN_PLOTS), and the options. */
  other: HealthCodes | null;
  /** From the quality report: checks compared on it, agreeing, the rate (null under MIN_PLOTS); null when never compared. */
  agreement: { compared: number; agreeing: number; rate: number | null } | null;
  /** Plots decided for the check where its answer differs between the first assessment and that check, and the share of decidedForCheck. */
  decisions: { changed: number; share: number | null };
  /** Why it is worth rewording, the strongest first; empty when nothing stands out. */
  reasons: HealthReason[];
}

export interface SurveyHealth {
  /** First assessments looked at. */
  plots: number;
  /** Plots with a first assessment and a check (the report's). */
  plotsChecked: number;
  /** Checked plots whose decision is "the check" (the check's answers were taken). */
  decidedForCheck: number;
  /** Worth rewording first (see sortRows), then the others in the survey's order; up to MAX_HEALTH_ROWS. */
  questions: HealthRow[];
  questionsTotal: number;
  thresholds: {
    minPlots: number;
    lowAgreement: number;
    oftenOther: number;
    oftenEmpty: number;
    minChanged: number;
    oftenChanged: number;
  };
}

/** GET /v1/projects/:pid/quality/survey-health: survey health, and when the figures it comes from were worked out. */
export interface SurveyHealthAnswer extends SurveyHealth {
  computedAt: number;
  stale: boolean;
}
