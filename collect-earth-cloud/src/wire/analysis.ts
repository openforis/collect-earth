// The analysis page (what replaces Saiku), its shared and proposed views, the uncertainty analysis, the strata and
// areas, and the IPCC exports' choices, as the server sends them. The rows of the analysis' tables come as CSV text,
// which the page reads into DuckDB. Types only: see README.md in this folder.

/** A label per language: the survey's languages, "" for a label without xml:lang. */
export type Labels = Record<string, string>;

export type ColumnType = 'code' | 'boolean' | 'integer' | 'real' | 'text' | 'date' | 'time';

export interface AnalysisColumn {
  /** The column's name in its table (the attribute's name; an attribute of a single entity: entity_attribute). */
  name: string;
  /** The summary key it is read from (for a multiple entity, the part after `[key].`). */
  key: string;
  labels: Labels;
  type: ColumnType;
  /** For a code: its list. */
  list: string | null;
  calculated: boolean;
  /** Several values (the summary joins them with "==="): kept as text. */
  multiple: boolean;
  /** Filled from the plot file (collectearth:fromcsv): province, elevation… */
  fromPlotFile: boolean;
  /** A key attribute of the survey (the plot's id, the assessment round): what identifies a record, not an answer. */
  keyAttr: boolean;
  /** For a code: the column of the code it depends on (`parent` in the survey: a land use's subdivision), else null. */
  parent: string | null;
  /**
   * The yes/no column the question is asked after (its `relevant` expression starts with it: "change2", "change2 and
   * …"), else null: the analysis page counts such answers among the plots where it is yes (the year of a change…).
   */
  relevantIf: string | null;
  /** A repeat survey's earlier period the column holds the answers of ("2020"), absent for this period's columns */
  period?: string;
}

export interface AnalysisTable {
  /** "plot" for the root entity, else the multiple entity's name. */
  name: string;
  labels: Labels;
  /** For a multiple entity: the column holding the entity's key (the code or number in `[…]` of its summary keys). */
  keyColumn: string | null;
  columns: AnalysisColumn[];
}

export interface ListItem {
  code: string;
  labels: Labels;
  /** The code of the item above it in a hierarchical list, else null. */
  parent: string | null;
  level: number;
}

export interface AnalysisModel {
  /** The survey's languages; the first is the default one (labels without xml:lang). */
  languages: string[];
  tables: AnalysisTable[];
  lists: Record<string, ListItem[]>;
}

/** A table's rows, as CSV text with a header (RFC 4180), and their count. */
export interface TableData {
  name: string;
  /** Column name → DuckDB type, in order: the browser reads the CSV with these types. */
  columns: [string, string][];
  rows: number;
  csv: string;
}

/** Where the plots' areas come from: the project file's areas file, or the project's setting (its strata, or one total area). */
export type AreasSource = 'region_areas.csv' | 'areas_per_attribute.csv' | 'strata' | 'total';

/** GET /v1/projects/:pid/analysis (any member): the survey's model and the rows of its tables. */
export interface AnalysisAnswer {
  model: AnalysisModel;
  /** "project": every record (coordinators, reviewers); "own": the person's own, without rounds (collectors). */
  scope: 'project' | 'own';
  /**
   * Where the areas come from, or null: no areas. `unmatched`: lines of the file that matched no plot, or whose area
   * could not be read; `unknownColumns`: the file's columns that are no question of the survey; `noStratum`: plots in no
   * line of the file, their values most plots first.
   */
  areas: {
    source: AreasSource;
    plots: number;
    unmatched: number;
    unknownColumns: string[];
    noStratum: { plots: number; examples: { stratum: string; plots: number }[] };
  } | null;
  tables: TableData[];
}

/** What the stand-alone analysis file (GET …/analysis/standalone) holds besides the page's data: its project, and when it was made. */
export interface StandaloneAnalysis extends AnalysisAnswer {
  project: { id: string; name: string };
  /** ISO 8601. */
  made: string;
  /** The plots' locations were left out (?coordinates=none). */
  withoutPositions: boolean;
}

/**
 * A view of the analysis page a coordinator shared with the project's team (web/src/analysisView.ts): the table, the
 * language its column names are in, and Perspective's configuration (kept as given: the page reads it).
 */
export interface SharedAnalysisView {
  name: string;
  table: string;
  language: string;
  config: Record<string, unknown>;
  savedBy: string;
  savedAt: number;
}

/** GET, PUT and DELETE /v1/projects/:pid/analysis/views: every shared view of the project, after the change. */
export interface SharedAnalysisViewsAnswer {
  views: SharedAnalysisView[];
}

/** PUT /v1/projects/:pid/analysis/views (coordinators): a view to share, replacing one of the same name and table. */
export type SharedAnalysisViewInput = Pick<SharedAnalysisView, 'name' | 'table' | 'language' | 'config'>;

// --- views proposed by the AI assistant (POST /v1/projects/:pid/analysis/proposals; the server's src/ai/analysisViews.ts) ---

export type ViewChart = 'table' | 'bars' | 'hbars' | 'stacked' | 'lines' | 'areas' | 'heatmap' | 'treemap' | 'sunburst';
export type FilterOp = 'is' | 'isNot' | 'yes' | 'no' | 'answered' | 'notAnswered' | 'atLeast' | 'atMost';
export type ViewOrder = 'largest' | 'smallest' | 'name';

export interface ProposedFilter {
  column: string;
  op: FilterOp;
  /** For is / isNot: codes of the column's list. */
  codes?: string[];
  /** For atLeast / atMost: a number, or a date (yyyy-mm-dd). */
  value?: number | string;
}

/** A view of the analysis page proposed from the survey's structure, by the cube's column ids. */
export interface ProposedView {
  title: string;
  why: string;
  rows: string[];
  columns: string[];
  measures: string[];
  chart: ViewChart;
  filters: ProposedFilter[];
  order: ViewOrder;
}

export interface ProposedViewsAnswer {
  views: ProposedView[];
}

// --- the uncertainty analysis (src/routes/uncertainty.ts) ---

/** The six IPCC land categories (the server's src/uncertainty.ts IPCC_CATEGORIES). */
export type IpccCategory = 'forest' | 'cropland' | 'grassland' | 'wetland' | 'settlement' | 'other';

/** What a coordinator sets up once per project (projects.uncertainty_settings). */
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

/** A code question of the plot the setup can choose. */
export interface UncertaintyQuestion {
  name: string;
  labels: Labels;
  /** Its code list. */
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
  /** The strata or total set on the dashboard, else the project file's areas file (the page's own total area: null). */
  areas: AreasSource | null;
  canEdit: boolean;
}

/** PUT /v1/projects/:pid/uncertainty/settings (coordinators): the settings as saved. */
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

/** GET /v1/projects/:pid/uncertainty: the tables, with the settings and where the areas come from. */
export interface UncertaintyAnswer extends UncertaintyResult {
  settings: UncertaintySettings;
  areas: AreasSource;
}

// --- strata and areas (src/routes/areas.ts) ---

export interface StrataAreas {
  /** The columns whose values make a stratum: questions of the survey or columns of the plot files. */
  columns: string[];
  strata: { values: string[]; area: number }[];
}

/** The strata and their areas, or one total area (the server's src/areas.ts). */
export type AreaSettings = ({ mode: 'strata' } & StrataAreas) | { mode: 'total'; area: number };

/** GET /v1/projects/:pid/areas?columns=: what the plots' areas come from, and the strata with their plots. */
export interface AreasAnswer {
  /** "strata" | "total": set on the dashboard; a file of the project file; "uncertainty": the Uncertainty page's total; null: none. */
  source: AreasSource | 'uncertainty' | null;
  settings: AreaSettings | null;
  /** Lines of the project file's areas file whose area cannot be read. */
  unreadable: number;
  /** The columns that can make strata: the survey's questions filled from the plot file, then the plot files' columns. */
  columns: string[];
  /** Each stratum: its area (null: none yet), its plots in the plot files (null: a column only in the answers), assessed, ha per plot. */
  strata: { values: string[]; area: number | null; plots: number | null; assessed: number; haPerPlot: number | null }[];
  /** Plots of values not listed (a column of many values). */
  more: number;
  assessed: number;
  withArea: number;
  unknownColumns: string[];
  noStratum: { plots: number; examples: { stratum: string; plots: number }[] };
  canEdit: boolean;
}

/** PUT /v1/projects/:pid/areas (coordinators): the settings as saved; null: back to the project file's areas file. */
export interface AreaSettingsAnswer {
  settings: AreaSettings | null;
}

// --- Collect Earth's IPCC exports (src/routes/ipcc.ts) ---

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
  subdivisions: { category: string; code: string; name: string; management: string }[];
}
