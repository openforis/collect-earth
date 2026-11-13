// The project calls as the server answers them: the project list and a project's info, overview, the project file and
// its round, plot layout and imagery, repeat survey and periods, the members' roles and exclusion, and making a project
// from Collect Earth Online or a Collect Earth backup. Types only: see README.md in this folder.
//
// The Java desktop app reads GET /v1/projects, GET /v1/projects/:pid, the project file, plot-layout, imagery and
// periods/plots/:plot: a change to their types is a change to the /v1 contract.

import type { ChangeAreas } from './data.js';
import type { ProjectStatus } from './projectSettings.js';

/** Membership role within a single project. Authority derives only from these. */
export type Role = 'admin' | 'reviewer' | 'operator';

/** A user's membership of one project, with the project name for listings. */
export interface Membership {
  projectId: string;
  projectName: string;
  role: Role;
  status: ProjectStatus;
}

/** GET /v1/projects: the caller's own projects (there is no global listing). */
export interface ProjectListAnswer {
  projects: Membership[];
}

/** POST /v1/projects with a session: the new project, whose coordinator the caller is. */
export interface NewProjectAnswer {
  projectId: string;
  name: string;
}

/** GET /v1/projects/:pid: the project as its member sees it (the desktop's "Test connection" too). */
export interface ProjectInfo {
  projectId: string;
  name: string;
  surveyUri: string | null;
  surveyName: string | null;
  hasSurvey: boolean;
  role: Role;
  status: ProjectStatus;
}

/** Size and last upload time (epoch ms) of a project's CEP. */
export interface CepInfo {
  bytes: number;
  updatedAt: number;
}

/** One collector's records, on the overview. */
export interface OperatorProgress {
  operator: string;
  total: number;
  submitted: number;
  /** The newest modification time Collect Earth sent (epoch ms); 0 when it sent none. */
  lastModifiedOn: number;
}

/** GET /v1/projects/:pid/overview: what has been set up and how collection is going (deleted records not counted). */
export interface Overview {
  name: string;
  /** null before any project file */
  cep: CepInfo | null;
  members: number;
  csvFiles: number;
  plots: number;
  records: { total: number; submitted: number; byOperator: OperatorProgress[] };
  /** Space the project uses; limitBytes null = no limit. */
  storage: { usedBytes: number; limitBytes: number | null };
}

/** One project member, for the admin members listing. */
export interface Member {
  userId: string;
  username: string;
  role: Role;
  /** The server owner disabled the account (a flag only: not when or by whom). */
  disabled?: boolean;
  /** A coordinator left their records out of the results (the figures and the exports); absent otherwise. */
  excluded?: { at: number; reason: string | null };
}

/** GET /v1/projects/:pid/members */
export interface MembersAnswer {
  members: Member[];
}

// --- the project file and its round -------------------------------------------------------------

/** Why a project file cannot be read. */
export type CepErrorCode = 'not_a_zip' | 'too_large' | 'no_survey' | 'survey_unreadable';

/** added: the server added round; own: the survey has a round key; none: no round. */
export type RoundState = 'added' | 'own' | 'none';

/** Why the server did not add round to a project file. */
export type RefusalCode =
  | CepErrorCode
  | 'several_entities'
  | 'several_keys'
  | 'round_not_key'
  | 'balloon_missing'
  | 'balloon_marker_missing'
  | 'balloon_ids_missing'
  | 'template_missing'
  | 'template_marker_missing';

/** A code of a code list, with its label in the survey's default language. */
export interface CodeItem {
  code: string;
  label: string;
}

/** Why the server did not add the coordinator's note to a project file. */
export type NoteRefusal =
  | CepErrorCode
  | 'several_entities'
  | 'note_name_taken'
  | 'note_mismatch'
  | 'nested_plot_columns'
  | 'balloon_missing'
  | 'balloon_marker_missing'
  | 'template_missing'
  | 'template_marker_missing'
  | 'records_exist';

/** Whether the served project file carries the coordinator's note to Collect Earth (Task 16), else why not. */
export interface NoteInfo {
  /** added: the served survey has the note (the server added it, or the upload had it). */
  state: 'added' | 'none';
  /** Why the server did not add it (state none), else null. */
  refusal: NoteRefusal | null;
  /**
   * added: the note's place among a served row's extra columns (those after the keys and the
   * latitude and longitude): the number of attributes the survey fills from the plot file before it.
   */
  column: number | null;
}

/** What the server did about the round key of a project's CEP (GET and PUT /round, and the upload's `round`). */
export interface RoundInfo {
  /** added: the server added round; own: the survey has a round key; none: no round. */
  state: RoundState;
  /** Why the server did not add it (state none), else null. */
  refusal: RefusalCode | null;
  /** Keys of the served survey. */
  keyCount: number;
  /** Position of round among the keys of the served survey. */
  roundIndex: number | null;
  /** Codes of round's list (own and added). */
  roundCodes: CodeItem[];
  /** added: "2"; own: "2" when that code exists, else null until the coordinator picks one. */
  reassessmentCode: string | null;
  /**
   * The coordinator's note (Task 16): whether the served survey has it and at which extra column of
   * a served row it is read. Absent on infos stored before it (read as none).
   */
  note?: NoteInfo;
}

/** PUT /v1/projects/:pid/cep: the upload taken, and what the server did about round. */
export interface CepUploadAnswer {
  ok: true;
  bytes: number;
  round: RoundInfo;
  /** The coordinator's note moved to another extra column of the served rows (from, to). */
  noteColumnChanged?: { from: number; to: number };
}

/** GET /v1/projects/:pid/round: null before any upload. */
export type RoundAnswer = RoundInfo | null;

/** Settings of the project file's project_definition.properties: the keys it has, with their values as written. */
export type PropertiesValues = Record<string, string>;

/** GET /v1/projects/:pid/plot-layout: Collect Earth's Settings > Plot, and whether records exist (changing it then is risky). */
export interface PlotLayoutAnswer {
  layout: PropertiesValues;
  recordsExist: boolean;
}

/** PUT /v1/projects/:pid/plot-layout: the layout as it is now. */
export interface PlotLayoutChangeAnswer {
  layout: PropertiesValues;
}

/** GET and PUT /v1/projects/:pid/imagery: Collect Earth's Settings > Imagery (without the Planet key). */
export interface ImageryAnswer {
  imagery: PropertiesValues;
}

// --- a Collect Earth backup's records into a project --------------------------------------------

/** POST /v1/projects/:pid/records/import/preview: a Collect Earth backup's records against the project, nothing stored. */
export interface CollectImportPreview {
  records: number;
  submitted: number;
  drafts: number;
  newRecords: number;
  /** In the project already, newer there: left as they are. */
  newerThere: number;
  /** In the project already, older there: replaced. */
  olderThere: number;
  /** Who collected them: the name Collect Earth wrote, the username they are kept under, whether a member. */
  operators: { name: string; username: string; records: number; member: boolean }[];
  /** Up to 20 files that could not be read, and how many in all. */
  problems: string[];
  problemCount: number;
}

/** POST /v1/projects/:pid/records/import */
export interface CollectImportResult extends CollectImportPreview {
  stored: number;
  kept: number;
}

// --- repeat survey (docs/plans/2026-11-11-repeat-survey.md) -------------------------------------

/** A question the form's header can show. */
export interface HeaderQuestion {
  key: string;
  label: string;
  kind: 'choice' | 'number' | 'text' | 'other';
}

/** What could not be matched to the new survey, for the coordinator. */
export interface MatchReport {
  /** Questions of the earlier answers the new survey does not have (by key, rows' keys left out), with their plots */
  questionsLeftOut: { key: string; plots: number }[];
  /** Answers whose code the new survey's question does not offer, kept as they were */
  unknownAnswers: { key: string; code: string; plots: number }[];
}

/** POST /v1/projects/:pid/repeat/preview: what a repeat survey would bring; nothing is stored. */
export interface RepeatPreview {
  /** the plots with an earlier answer (a submitted first assessment, or the coordinator's final one) */
  plots: number;
  /** the plots of the plot files: all of them can be collected again, or only those collected (`plots`) */
  filePlots: number;
  /** the proposed labels: this project's period, and the new one's */
  earlierLabel: string;
  label: string;
  /** the periods before this one, when this project repeats another */
  periods: { label: string; plots: number }[];
  /** the questions the form's header can show, and the ones proposed */
  questions: HeaderQuestion[];
  headerQuestions: string[];
  /** what a newer survey no longer asks, and answers it no longer offers */
  report: MatchReport;
}

/** POST /v1/projects/:pid/repeat: the new project, a draft that collects this one's plots again. */
export interface RepeatAnswer {
  projectId: string;
  name: string;
  status: 'draft';
  label: string;
  /** each earlier period, with what of it did not match the new survey */
  periods: { label: string; plots: number; report: MatchReport }[];
  headerQuestions: string[];
  plots: 'all' | 'collected';
  filePlots: number;
}

/** A repeat survey's settings. */
export interface RepeatSettings {
  /** This project's period ("2025") */
  label: string;
  /** The earlier periods, oldest first */
  earlier: { label: string; sourceProjectId: string; sourceName: string; plots: number; madeAt: number }[];
  /** The summary keys of the questions the form's header shows of the earlier period (the plot's main characteristics) */
  headerQuestions: string[];
  /** The total area in hectares, for the areas of the changes when the project file has no areas file */
  totalArea?: number;
}

/** GET /v1/projects/:pid/periods: a repeat survey's periods and the questions its form's header shows. */
export type Periods =
  | { settings: null; periods: []; questions: [] }
  | {
      settings: RepeatSettings;
      periods: { label: string; plots: number }[];
      /** The header's questions with their labels, in the header's order */
      questions: { key: string; label: string }[];
      /** The questions the header can show */
      candidates: HeaderQuestion[];
    };

/** PUT /v1/projects/:pid/periods/header */
export interface PeriodHeaderAnswer {
  headerQuestions: string[];
}

/** What the collector said of a plot against the earlier period (the survey's period_status) */
export type PeriodStatusAnswer = 'same' | 'changed' | 'corrected';

/** How a plot compares between the two periods, for the question compared. */
export type ChangeOutcome =
  /** the same answer in both periods */
  | 'unchanged'
  /** another answer: a change of the land */
  | 'changed'
  /** another answer, the collector having said the earlier one was wrong: a correction, not a change */
  | 'corrected'
  /** collected now, with no earlier answer */
  | 'new'
  /** an earlier answer, not collected yet (or not submitted) */
  | 'pending';

export interface ChangeRow {
  plot: string;
  earlier: string | null;
  now: string | null;
  /** the collector's answer to the header (period_status), null when none */
  status: PeriodStatusAnswer | null;
  outcome: ChangeOutcome;
  /**
   * The collector's answer and the answers disagree: said "still the same" with another answer now, or "changed" with
   * the same answer (to look at again)
   */
  mismatch: 'sameButDiffers' | 'changedButSame' | null;
}

/** GET /v1/projects/:pid/periods/change: one question compared between an earlier period and this one. */
export interface RepeatChange {
  /** the earlier period compared */
  period: string;
  /** this project's period */
  label: string;
  periods: string[];
  question: { key: string; label: string };
  questions: { key: string; label: string }[];
  options: { code: string; label: string }[];
  counts: Record<ChangeOutcome, number> & { mismatches: number };
  /** plots by earlier answer and answer now, real changes and unchanged only (not the corrections), by code */
  matrix: { from: string; to: string; plots: number }[];
  /** the corrections, by earlier answer and the answer that corrects it */
  corrections: { from: string; to: string; plots: number }[];
  rows: ChangeRow[];
  /** the areas of the changes, with their uncertainty (stage 4) */
  areas: ChangeAreas;
  /** a coordinator: may save the total area */
  canEdit: boolean;
}

/** PUT /v1/projects/:pid/periods/area */
export interface RepeatAreaAnswer {
  totalArea: number | null;
}

/** One plot's answers in an earlier period (who collected them: for coordinators and reviewers only). */
export interface PlotPeriod {
  label: string;
  savedAt: number;
  answers: Record<string, string>;
  operator?: string;
}

/** GET /v1/projects/:pid/periods/plots/:plot (Collect Earth reads it too): one plot's earlier answers, oldest first. */
export interface PlotPeriodsAnswer {
  periods: PlotPeriod[];
  /** the questions' labels, by summary key */
  labels: Record<string, string>;
  /** the answers' names of the choice questions, by summary key */
  options: Record<string, { code: string; label: string }[]>;
  /** this period's label, null when the project repeats none */
  label: string | null;
  /** the questions the form's header shows */
  header: string[];
}

// --- a new project from Collect Earth Online ------------------------------------------------------

/** POST /v1/projects/from-ceo/fetch: a CEO project and its plot list, as text, read by the server from CEO. */
export interface CeoFetchAnswer {
  project: string;
  plots: string;
}

/** One line of a Collect Earth Online import's report (src/ceo/report.ts); its subject and message are the server's, in English. */
export interface CeoReportEntry {
  /** what the entry is about */
  area: 'project' | 'question' | 'rule' | 'plots';
  /** the question's text, the rule's kind and id, the setting's name */
  subject: string;
  outcome: 'imported' | 'changed' | 'skipped' | 'info';
  message: string;
}

/** What a CEO project would become (the preview), and what the import answers too. */
export interface CeoImportSummary {
  ceoProjectId: number | null;
  /** plots: null without CEO's plot list */
  counts: { questions: number; questionsChanged: number; questionsSkipped: number; rules: number; rulesSkipped: number; plots: number | null };
  /** the points of the questions' table when answered per sample point; null: once for the plot */
  perPoint: number | null;
  /** the points a plot could be answered per (a square grid of several); null: per plot only */
  samplePoints: number | null;
  /** null without CEO's sample data; the collectors by email, for the coordinator to map (the server keeps no email) */
  answers: { plots: number; flagged: number; collectors: { email: string; plots: number }[] } | null;
  report: CeoReportEntry[];
}

/** POST /v1/projects/from-ceo/preview: nothing is stored. */
export interface CeoImportPreview extends CeoImportSummary {
  name: string;
}

/** A plot file a project import stored. */
export interface ImportedPlotFile {
  csvFileId: string;
  filename: string;
  plots: number;
}

/** POST /v1/projects/from-ceo: the new project, whose coordinator the caller is. */
export interface CeoImportAnswer extends CeoImportSummary {
  projectId: string;
  name: string;
  round: RoundState;
  /** the plots to give out; null without CEO's plot list (or none left) */
  plotFile: ImportedPlotFile | null;
  /** the plots answered in CEO, in a file of their own */
  doneFile: ImportedPlotFile | null;
  records: number;
  /** the shapes of the plots to copy from CEO, in steps (GET/POST .../ceo-shapes); null: none */
  shapes: { total: number } | null;
  reportText: string;
  /** the CEO collectors and the username their records are kept under */
  collectors: { email: string; plots: number; username: string }[];
}

// --- a new project from a Collect Earth backup ----------------------------------------------------

/** A plot layout of a project file: the shape, its sample points and their spacing, in metres. */
export interface PlotLayout {
  shape: 'CIRCLE' | 'SQUARE';
  /** number_of_sampling_points_in_plot */
  points: number;
  /** distance_between_sample_points: the circle's radius, or the square's spacing between points */
  distance: number;
  /** distance_to_plot_boundaries: from the outer points to the square's edge (unused by a circle) */
  boundary: number;
  /** inner_point_side: the side of each sample point's square, in metres */
  pointSide: number;
}

/** POST /v1/projects/from-backup/preview: what a Collect Earth backup (its "Export data to XML (ZIP)") would become; nothing is stored. */
export interface BackupImportPreview {
  name: string;
  surveyName: string;
  surveyUri: string;
  records: { total: number; submitted: number; drafts: number; steps: { entry: number; cleansing: number; analysis: number }; unreadable: number; unreadableExamples: string[] };
  /** the names typed in Collect Earth, with their records */
  collectors: { name: string; records: number }[];
  plots: {
    /** plots with records, placed by them */
    withRecords: number;
    /** of them, with a submitted record: the done file */
    done: number;
    /** plots whose records have no location: in no plot file unless the original one has them */
    withoutPlace: number;
    withoutPlaceExamples: string[];
    /** plots of the original plot file, null when none was given */
    inFile: number | null;
    /** plots to give out */
    toDo: number;
    /** plots of the records not in the original plot file */
    notInFile: number | null;
  };
  /** the strata with an area (lines of the backup's areas_per_attribute.csv), null without the file */
  strata: number | null;
  /** the layout the survey suggests (its plot area and points) */
  layout: PlotLayout;
  survey: { plotAreaHa: number | null; samplePoints: number | null; plotColumns: string[] };
}

/** POST /v1/projects/from-backup: the new project, whose coordinator the caller is. */
export interface BackupImportAnswer {
  projectId: string;
  name: string;
  round: RoundState;
  layout: PlotLayout;
  plotFile: ImportedPlotFile | null;
  doneFile: ImportedPlotFile | null;
  records: number;
  /** false: the plot files could not be written (the survey identifies a plot by several keys) */
  plotFilesMade: boolean;
  /** each name typed in Collect Earth, the username its records are kept under, and whether that is an account */
  collectors: { name: string; username: string; account: boolean }[];
  /** what the preview showed, for the report */
  backup: BackupImportPreview;
}
