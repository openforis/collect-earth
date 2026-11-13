// The analysis page (what replaces Saiku), its shared and proposed views, the uncertainty analysis, the strata and
// areas, and the IPCC exports' choices, as the server sends them. The rows of the analysis' tables come as CSV text,
// which the page reads into DuckDB. Types only: see README.md in this folder.

import type { ListItem } from './data.js';

export type { Estimate, ForestRow, IpccCategory, IpccExports, ListItem, UncertaintyAnswer, UncertaintyQuestion, UncertaintyResult, UncertaintySettings, UncertaintySettingsAnswer, UncertaintySetup } from './data.js';
export type { AreaSettings, AreasData as AreasAnswer, AreasSaved as AreaSettingsAnswer, StrataAreas } from './plotFiles.js';

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

// --- the uncertainty analysis, the areas and the IPCC exports: their types are in data.ts and plotFiles.ts ---
