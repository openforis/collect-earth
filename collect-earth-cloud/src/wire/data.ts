// The Data tab's calls as the server answers them: the data download's choices, the Collect Earth backup, Collect
// Earth's IPCC exports, the uncertainty analysis and the areas of a repeat survey's changes. Types only: see README.md
// in this folder.

import type { AreasSource } from './analysis.js';

/** An item of a code list (src/analysis.ts ListItem): its code, its labels by language, its parent in a hierarchy. */
export interface ListItem {
  code: string;
  labels: Record<string, string>;
  /** The code of the item above it in a hierarchical list, else null. */
  parent: string | null;
  level: number;
}

/**
 * GET /v1/projects/:pid/export/choices: what "Records to download" offers: when this person last downloaded the data
 * (ms, or null), and the survey's plot questions with the code lists of the code ones.
 */
export interface ExportChoices {
  lastDownload: number | null;
  languages: string[];
  questions: { key: string; name: string; labels: Record<string, string>; list: string | null }[];
  lists: Record<string, ListItem[]>;
}

// --- the Collect Earth backup (Task 17) ----------------------------------------------------------

/** Which records a Collect Earth backup holds: the first assessments (round 1), or every round. */
export type BackupRounds = '1' | 'all';

/** Which file: the zip Collect Earth imports, or OpenForis Collect's own backup (.collect-backup). */
export type BackupFormat = 'zip' | 'collect';

/** What a Collect Earth backup would hold with one choice. */
export interface BackupCounts {
  /** Records in the backup (one per plot and round). */
  records: number;
  /** Of them, not submitted. */
  drafts: number;
  /** Records of other rounds left out (the checks, with the first assessments only). */
  otherRounds: number;
  /** The collectors' measurements of reference plots, left out in every choice. */
  measurements: number;
  /** Records left out because another record has the same plot and round (Collect Earth keeps one). */
  sameKey: number;
  /** Some of the plots and rounds that had more than one record ("17,1"). */
  sameKeyExamples: string[];
  /** Records left out because the server has no XML for them. */
  noXml: number;
  /** About how large the file is, in bytes. */
  estimatedBytes: number;
}

/** GET /v1/projects/:pid/exports/collect-backup/summary: what the backup would hold with each choice. */
export interface BackupSummary {
  /** A project file was uploaded (the backup carries its survey). */
  projectFile: boolean;
  /** The survey has the round key, so every round can go in the backup. */
  roundKey: boolean;
  /** What the server did about round (null before any project file). */
  roundState: 'added' | 'own' | 'none' | null;
  /** The round codes of the first assessments ("1"; a survey's own codes), or null when they are told apart by who holds the plots. */
  firstCodes: string[] | null;
  /** The project file carries the coordinator's note (Task 16). */
  note: boolean;
  rounds: {
    '1': BackupCounts;
    /** null without the round key */
    all: BackupCounts | null;
  };
}

/** POST /v1/projects/:pid/exports/collect-backup/link: a link for the browser to download the backup by itself, once, within a minute. */
export interface BackupLinkAnswer {
  /** /v1/collect-backup/<token> */
  url: string;
  expiresAt: number;
}

// --- Collect Earth's IPCC exports (src/routes/ipcc.ts) -----------------------------------------------

/** GET /v1/projects/:pid/exports/ipcc: what the survey lacks, the plots, and what the form offers. */
export interface IpccExports {
  /** Questions or lists the survey lacks for them: none when they can be made. */
  missing: string[];
  /** Plots with a submitted first assessment. */
  plots: number;
  /** Where the plots' areas come from, null when the project has none. */
  areas: AreasSource | null;
  /** The IPCC Inventory Software's countries: code and name. */
  countries: readonly (readonly [string, string])[];
  /** The questions that can hold the region, and the one to choose first. */
  regions: string[];
  region: string | null;
  /** The land use subdivisions and their default management type. */
  subdivisions: { category: 'F' | 'C' | 'G' | 'W' | 'S' | 'O'; code: string; name: string; management: string }[];
}

// --- the uncertainty analysis (src/uncertainty.ts) ---------------------------------------------------

/** The six IPCC land categories. */
export type IpccCategory = 'forest' | 'cropland' | 'grassland' | 'wetland' | 'settlement' | 'other';

/** What a coordinator sets up once per project (projects.uncertainty_settings); PUT .../uncertainty/settings sends it. */
export interface UncertaintySettings {
  /** The plot table's code columns of the land use at the start and at the end (src/analysis.ts column names). */
  initial: string;
  final: string;
  /** Labels of the two years ("2000", "2024"). */
  initialYear: string;
  finalYear: string;
  /** Per code list, each code's IPCC category; null: left out on purpose. A code not here is unmapped. */
  codes: Record<string, Record<string, IpccCategory | null>>;
  /** The area in hectares when the project file has no areas file (every plot then stands for the same area). */
  totalArea: number | null;
}

/** A plot code question the analysis can use. */
export interface UncertaintyQuestion {
  name: string;
  labels: Record<string, string>;
  list: string;
  parent: string | null;
  fromPlotFile: boolean;
  calculated: boolean;
}

/** GET /v1/projects/:pid/uncertainty/settings: the setup, and the survey's code questions and lists to make it with. */
export interface UncertaintySetup {
  settings: UncertaintySettings | null;
  languages: string[];
  questions: UncertaintyQuestion[];
  lists: Record<string, ListItem[]>;
  /** the strata or total set on the dashboard, else the project file's areas file (the page's own total area: null) */
  areas: string | null;
  canEdit: boolean;
}

/** PUT /v1/projects/:pid/uncertainty/settings */
export interface UncertaintySettingsAnswer {
  settings: UncertaintySettings;
}

export interface Estimate {
  plots: number;
  /** Of the total area, 0–1. */
  proportion: number;
  area: number;
  se: number;
  ci: number;
  /** CI / area · 100; null when the area is 0. */
  uncertainty: number | null;
}

export type ForestRow = 'forestStable' | 'nonForestToForest' | 'forestToNonForest' | 'nonForestStable' | 'initiallyForest' | 'initiallyNonForest' | 'currentlyForest' | 'currentlyNonForest';

/** The tables of the uncertainty analysis. */
export interface UncertaintyResult {
  /** "simple": one stratum, every plot standing for the same area; "stratified": the areas file's strata. */
  estimator: 'simple' | 'stratified';
  totalArea: number;
  /** The plots used. */
  plots: number;
  strata: { key: string; area: number; plots: number }[];
  /** Strata with fewer than 2 plots used: no variance (n_h − 1 = 0). With 1 plot its area counts, with none it does not. */
  notEstimable: { key: string; area: number; plots: number }[];
  /** Plots not used, by why. A plot unmapped in both years is counted once (initial first). */
  skipped: { missing: number; unmapped: number; noArea: number };
  /** The plots of a code left out (no data), each year: in their stratum's count, in no category. */
  noData: { initial: Estimate; final: Estimate };
  unmapped: { which: 'initial' | 'final'; code: string; plots: number }[];
  categories: { category: IpccCategory; initial: Estimate; final: Estimate }[];
  total: Estimate;
  forest: { row: ForestRow; estimate: Estimate }[];
  /** Every pair, initial category by final category, in IPCC_CATEGORIES order. */
  transitions: { from: IpccCategory; to: IpccCategory; estimate: Estimate }[];
  /**
   * Hectares: cells[from][to], with the row and column totals, and each row's share of its initial category (%). Over
   * the plots with a category both years: its total is the total area less the no data of either year.
   */
  matrix: { cells: number[][]; rowTotals: number[]; columnTotals: number[]; total: number; rowPercent: (number | null)[][] };
}

/** GET /v1/projects/:pid/uncertainty: the tables, with the setup and where the areas come from. */
export interface UncertaintyAnswer extends UncertaintyResult {
  settings: UncertaintySettings;
  areas: string | null;
}

// --- the areas of a repeat survey's changes (stage 4) ------------------------------------------------

/** An area estimated from the plots, in hectares (or in shares of 1 when the area is not known). */
export interface AreaEstimate {
  plots: number;
  area: number;
  /** of the total area, 0–1 */
  share: number;
  se: number;
  /** half the 95% confidence interval: 1.96 · se */
  ci: number;
  /** ci / |area| · 100; null when the area is 0 */
  uncertainty: number | null;
}

/** The areas of a comparison's changes (src/repeatSurvey.ts changeAreas), without where they come from. */
export interface ChangeAreaEstimates {
  /** "simple": one stratum, every plot standing for the same area; "stratified": the areas file's strata */
  estimator: 'simple' | 'stratified';
  totalArea: number;
  /** the plots compared and used */
  plots: number;
  strata: { key: string; area: number; plots: number }[];
  /** strata with fewer than 2 plots used: no variance; with none their area is not counted */
  notEstimable: { key: string; area: number; plots: number }[];
  /** plots not used: not compared (new, or not collected yet), and in no stratum (no area) */
  skipped: { notCompared: number; noArea: number };
  outcomes: Record<'unchanged' | 'changed' | 'corrected', AreaEstimate>;
  /** the area of each cell of the transition matrix (unchanged and changed plots) */
  matrix: { from: string; to: string; estimate: AreaEstimate }[];
  /** the area of the corrections, by earlier answer and the answer that corrects it */
  corrections: { from: string; to: string; estimate: AreaEstimate }[];
  /**
   * Each answer's area in the earlier period (as now known: a corrected plot counts with the answer that corrects it,
   * the earlier one having been wrong), now, and the net change between them (now − then), each with its uncertainty
   */
  classes: { code: string; then: AreaEstimate; now: AreaEstimate; net: AreaEstimate }[];
}

/** The areas of a comparison as GET .../periods/change sends them (its `areas`). */
export interface ChangeAreas extends ChangeAreaEstimates {
  /** where the strata come from (the dashboard's strata or total, the project file's areas file); null: none */
  source: string | null;
  /** false: no areas and no total area, the areas are shares of the whole */
  areaKnown: boolean;
  /** the total area saved by the coordinator, null when none */
  savedArea: number | null;
}
