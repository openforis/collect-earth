// Training sets (calibration and learning plots), their golden answers and figures, as the server sends them to the
// dashboard. (GET …/training/feedback, read by Collect Earth, is not here.) Types only: see README.md in this folder.

import type { Role } from './people.js';

export type TrainingKind = 'calibration' | 'learning';

/** Agreement as counts and their share (null with nothing compared). */
export interface Share {
  compared: number;
  agreeing: number;
  rate: number | null;
}

// --- calibration ---

export interface AnswerCount {
  /** The answer as shown (its values, qualifiers kept). */
  value: string;
  count: number;
  people: string[];
}

export interface CalibrationCell {
  key: string;
  /** Different answers given, most given first. */
  answers: AnswerCount[];
  /** Pairs of people whose answers agree, of all pairs who answered. */
  pairs: Share;
  /** The proposed agreed answer: the most given (choice) or the median (number); null on a tie or with no answer. */
  consensus: string | null;
}

export interface CalibrationPlot {
  plot: string;
  /** People with a submitted record of it. */
  people: string[];
  questions: CalibrationCell[];
}

export interface CalibrationQuestion {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  pairs: Share;
  /** Fleiss' kappa (choice questions with two people or more on a plot); null when it cannot be worked out. */
  kappa: number | null;
}

export interface CalibrationPerson {
  username: string;
  plots: number;
  /** Their answers that agree with the proposed agreed answer. */
  withConsensus: Share;
  byQuestion: Record<string, Share>;
}

export interface CalibrationFigures {
  participants: string[];
  plots: CalibrationPlot[];
  questions: CalibrationQuestion[];
  people: CalibrationPerson[];
  /** All pairs of answers, every question. */
  overall: Share;
}

/** Calibration figures without anyone's name: for reviewers (no one's agreement by name, as for reference plots). */
export interface AnonymousCalibration {
  participants: number;
  plots: { plot: string; people: number; questions: { key: string; answers: { value: string; count: number }[]; pairs: Share; consensus: string | null }[] }[];
  questions: CalibrationQuestion[];
  overall: Share;
}

// --- learning ---

/** One question of one plot: the person's answer next to the golden one. */
export interface ScoredAnswer {
  key: string;
  label: string;
  golden: string;
  given: string;
  right: boolean;
}

export interface ScoredPlot {
  plot: string;
  submittedAt: number;
  answers: Share;
  /** Every compared answer right. */
  right: boolean;
  questions: ScoredAnswer[];
}

/** One person's score on a set in one attempt. */
export interface LearningScore {
  /** Plots with a golden interpretation (what is scored). */
  plots: number;
  /** Of those, the ones they submitted in the attempt. */
  submitted: number;
  /** Answers that match the golden ones (accuracy). */
  answers: Share;
  /** Plots with every answer right. */
  plotsRight: number;
  byQuestion: Record<string, Share>;
  /** Every plot submitted and accuracy at least the pass mark; null without a pass mark or before the end. */
  passed: boolean | null;
  byPlot: ScoredPlot[];
}

/** The golden interpretation of one plot of a set (PUT …/golden/:plot answers it). */
export interface TrainingGolden {
  plotKey: string;
  answers: Record<string, string>;
  note: string | null;
  updatedAt: number;
  updatedBy: string | null;
}

/** An attempt's number and when its records start counting (0: every record, for a first attempt). */
export interface TrainingAttemptStart {
  number: number;
  startedAt: number;
}

/** A closed attempt as listed: its number, dates and score figures (no answers). */
export interface TrainingAttemptPast {
  number: number;
  startedAt: number;
  closedAt: number | null;
  plots: number;
  submitted: number;
  answers: Share;
  plotsRight: number;
  passed: boolean | null;
}

/** A question a golden answer can be given for: those compared, with their options. */
export interface TrainingQuestion {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  options: { code: string; label: string }[] | null;
  multiple: boolean;
}

// --- what the coordinators' calls answer ---

/** A participant, or a member who can be one. */
export interface TrainingPerson {
  userId: string;
  username: string;
  role: Role;
}

/** A set as listed; PUT …/training-sets/:filename (201) and PATCH …/training/:setId answer it. */
export interface TrainingSetSummary {
  id: string;
  kind: TrainingKind;
  name: string;
  /** The file's name as uploaded. */
  filename: string;
  /** The file's name in Collect Earth ("Learning – plots.csv"). */
  servedName: string;
  plotCount: number;
  /** Percent of answers right to pass (learning), or null. */
  passMark: number | null;
  createdAt: number;
  participants: TrainingPerson[];
}

export interface TrainingListItem extends TrainingSetSummary {
  /** Plots with a golden interpretation. */
  golden: number;
  /** Each participant in their open attempt: plots submitted, and for a learning set their accuracy and whether they passed. */
  progress: { userId: string; attempt: number; submitted: number; accuracy: number | null; passed: boolean | null }[];
}

/** GET /v1/projects/:pid/training (coordinators): the sets, the members who can take part, and how many sets a project may have. */
export interface TrainingList {
  sets: TrainingListItem[];
  members: TrainingPerson[];
  max: number;
}

/** GET /v1/projects/:pid/training/:setId (coordinators): one set in full. */
export interface TrainingSetView {
  set: TrainingSetSummary;
  plots: string[];
  calibration: CalibrationFigures;
  golden: TrainingGolden[];
  questions: TrainingQuestion[];
  /** Golden answers' questions the survey no longer has (not scored). */
  staleQuestions: string[];
  scores: { userId: string; username: string; attempt: TrainingAttemptStart; score: LearningScore; history: TrainingAttemptPast[] }[];
}

/** POST /v1/projects/:pid/training/:setId/golden: the plots given golden answers. */
export interface GoldenFromAnswer {
  plots: number;
}

/** POST /v1/projects/:pid/training/:setId/golden/prune: the plots changed, and the questions taken out. */
export interface GoldenPruneAnswer {
  plots: number;
  questions: number;
}

/** POST /v1/projects/:pid/training/:setId/attempts: the attempts started. */
export interface AttemptsAnswer {
  started: number;
}

// --- reviewers' and participants' calls ---

/** One set's calibration figures without names (GET …/training/figures); a set the caller takes part in and has not finished: no figures. */
export interface TrainingFiguresSet {
  id: string;
  kind: TrainingKind;
  name: string;
  plotCount: number;
  /** The caller takes part and has not submitted every plot yet: no figures. */
  takingPart?: { submitted: number };
  calibration?: AnonymousCalibration;
}

/** GET /v1/projects/:pid/training/figures (reviewers and coordinators). */
export interface TrainingFiguresAnswer {
  sets: TrainingFiguresSet[];
  /** The survey's questions and their answers' labels, for the figures. */
  questions: TrainingQuestion[];
}

/** A plot of a participant's learning set, scored, with the coordinator's explanation. */
export interface MyScoredPlot extends ScoredPlot {
  note: string | null;
}

/** One of the participant's own sets (GET …/training/mine). */
export interface MyTrainingSet {
  id: string;
  kind: TrainingKind;
  name: string;
  servedName: string;
  plotCount: number;
  passMark: number | null;
  attempt: TrainingAttemptStart;
  submitted: number;
  /** Learning sets only: their answers next to the golden ones. */
  score?: Omit<LearningScore, 'byPlot'> & { byPlot: MyScoredPlot[] };
  history?: TrainingAttemptPast[];
}

/** GET /v1/projects/:pid/training/mine (any member): the sets they take part in. */
export interface MyTrainingAnswer {
  sets: MyTrainingSet[];
}
