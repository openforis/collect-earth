// Plot files as the server answers them: the list and the upload, the assignments grid, dividing a plot file between
// people, plot design, SIGRID plots and the strata's areas. Types only: see README.md in this folder.
//
// Collect Earth reads the csv-files routes (the list and each file's content): a change to their types is a change to
// the /v1 contract.

/**
 * The order plots are dealt in: the file's, 'mixed' (a seeded shuffle) or 'nearby' (along a
 * Hilbert curve over their latitude and longitude, Task 15: each share a compact area, and
 * the rows of each served file in that order too).
 */
export type DivisionOrder = 'file' | 'mixed' | 'nearby';

/**
 * A divided plot file's rule (csv_files.distribution), as last applied. `seed` is the
 * shuffle seed of order 'mixed'. 'manual' = changed by hand (move-unfinished); it keeps
 * `order: 'nearby'` when the division it changed had it, so the served files keep their
 * rows in that order.
 */
export type StoredDistribution =
  /** `percents`: each person's share of the plots (one per person, adding up to 100); absent = even shares. */
  | { mode: 'even'; people: string[]; percents?: number[]; order: DivisionOrder; overlapPercent: number; seed?: number }
  | {
      mode: 'column';
      column: number;
      groups: { value: string; people: string[] }[];
      order: DivisionOrder;
      overlapPercent: number;
      seed?: number;
    }
  | { mode: 'manual'; order?: 'nearby' };

/**
 * PUT /v1/projects/:pid/csv-files/:id/distribution's body: a division (or the whole file again), with
 * `dryRun` to only see what it would give. Missing `order` is 'file', missing `overlapPercent` 0, and a
 * 'mixed' order without a `seed` gets one.
 */
export type DivisionBody =
  | { mode: 'whole'; dryRun?: boolean }
  | { mode: 'even'; people: string[]; percents?: number[]; order?: DivisionOrder; overlapPercent?: number; seed?: number; dryRun?: boolean }
  | {
      mode: 'column';
      column: number;
      groups: { value: string; people: string[] }[];
      order?: DivisionOrder;
      overlapPercent?: number;
      seed?: number;
      dryRun?: boolean;
    };

/** A plot CSV file belonging to a project (metadata; content fetched separately). */
export interface CsvFile {
  id: string;
  filename: string;
  checksum: string;
  plotCount: number;
  /** How its plots are divided between people; null (or absent) = whole file, the assignments grid applies. */
  distribution?: StoredDistribution | null;
}

/** A plot file as GET /v1/projects/:pid/csv-files lists it. */
export interface ListedCsvFile extends CsvFile {
  /** Its plots are divided between people (see the file's distribution). */
  divided: boolean;
  /** People holding at least one of its plots; 0 for a whole file. */
  dividedPeople: number;
}

/** GET /v1/projects/:pid/csv-files */
export interface CsvFilesAnswer {
  csvFiles: ListedCsvFile[];
}

/** What may be wrong with an uploaded plot file, which was still taken. */
export interface CsvFileWarnings {
  /** Ids the survey's number keys cannot take. */
  badIds: number;
  badIdExamples: string[];
  duplicateIds: number;
  duplicateExamples: string[];
  badCoordinates: number;
  badCoordinateExamples: string[];
}

/** PUT /v1/projects/:pid/csv-files/:filename: the file stored. */
export interface CsvUploadAnswer extends CsvFile {
  /** A file with a user column: its plots were given out by it. */
  divided?: true;
  /** Given with `divided`: how its plots were given out (the plots of unknown names were not). */
  assignment?: { assigned: number; checks: number; notAssigned: number; unknown: string[] };
  warnings?: CsvFileWarnings;
}

/**
 * The 409 `replace_needs_confirm` of a plot file upload: what replacing the file would take out of the
 * project (its other fields, beside `error` and `reason`).
 */
export interface ReplaceImpact {
  removedPlots: number;
  heldRemoved: number;
  submittedRemoved: number;
  keptPlots: number;
  newPlots: number;
  divided: boolean;
}

/** One csv-file ↔ user assignment. */
export interface Assignment {
  userId: string;
  csvFileId: string;
}

/** An assignment enriched with names, as GET /v1/projects/:pid/assignments lists it. */
export interface AssignmentDetail extends Assignment {
  username: string;
  filename: string;
}

/** GET /v1/projects/:pid/assignments */
export interface AssignmentsAnswer {
  assignments: AssignmentDetail[];
}

/** PUT /v1/projects/:pid/assignments */
export interface AssignmentsSaved {
  ok: true;
  count: number;
}

// --- dividing a plot file between people -------------------------------------------------------------

/** One column of a plot file, for dividing its plots by the column's values. */
export interface PlotColumn {
  index: number;
  /** The header's name, null when the file has no header. */
  name: string | null;
  distinctCount: number;
  /** Each value with its plots, by value (the empty value last); null for the id column and a column of over 200 values. */
  values: { value: string; count: number }[] | null;
}

/** Whether order 'nearby' can be offered, and why not. */
export type NearbyAvailability =
  | { available: true; reason: null; withPlace: number; withoutPlace: number }
  | { available: false; reason: 'other_srs'; withPlace: 0; withoutPlace: number; srid: string }
  | { available: false; reason: 'no_places'; withPlace: 0; withoutPlace: number };

/** GET /v1/projects/:pid/csv-files/:id/columns */
export interface CsvColumns {
  plotCount: number;
  hasHeader: boolean;
  separator: string;
  columns: PlotColumn[];
  /** Whether order 'nearby' can be chosen, and how many plots have no place (they go last). */
  nearby: NearbyAvailability;
}

export interface PersonShare {
  userId: string;
  username: string;
  /** Includes the overlap copies. */
  plots: number;
  overlap: number;
  /** Of the copies, those the check sampling drew (Task 13); the others came with the division. */
  sampled: number;
  /** Of the copies, those of reference plots (Task 14): every collector has them, they are no checks to decide. */
  reference: number;
  submitted: number;
}

/** GET and PUT /v1/projects/:pid/csv-files/:id/distribution: who holds the file's plots (distribution null: a whole file). */
export interface DistributionSummary {
  distribution: StoredDistribution | null;
  plotCount: number;
  unassigned: number;
  people: PersonShare[];
}

/** POST /v1/projects/:pid/csv-files/:id/move-unfinished */
export interface MoveUnfinishedAnswer extends DistributionSummary {
  moved: number;
  /** Plots `to` already checked or assessed: kept with `from`. */
  notMoved: number;
  /** Copies to compare of plots `to` now collects, dropped. */
  droppedChecks: number;
}

/** A move of a rebalance: `count` plots to assess from `from` to `to`. */
export interface RebalanceMove {
  from: string;
  to: string;
  count: number;
}

/** A rebalance's plan: each person's plots still to assess before (`left`) and after (`target`), and the moves. */
export interface RebalancePlan {
  left: Record<string, number>;
  target: Record<string, number>;
  moves: RebalanceMove[];
}

/** POST /v1/projects/:pid/csv-files/:id/rebalance: the plan only (dryRun), or the plan applied with the new holdings. */
export type RebalanceAnswer = (RebalancePlan & { saved: false }) | (RebalancePlan & DistributionSummary & { saved: true; moved: number; notMoved: number });

// --- plot design and SIGRID ---------------------------------------------------------------------------

/** How plot design lays out the plots over the area of interest. */
export type PlotDesign =
  | { method: 'random'; count: number }
  | { method: 'grid'; spacingMeters: number; randomOffset: boolean }
  | { method: 'stratified'; field: string; allocation: 'equal' | 'proportional'; count: number };

/** The area of interest as sent: a GeoJSON text, or a zipped shapefile in base64. */
export type DesignArea = { geojson: string } | { shapefile: string };

/** POST /v1/projects/:pid/plot-design without a design: the area as the server read it. */
export interface DesignFacts {
  features: number;
  fields: string[];
  areaKm2: number;
  /** Most plots a design may make. */
  max: number;
}

/** A stratum of a stratified design: its value of the field, its area and its plots. */
export interface DesignStratum {
  value: string;
  areaKm2: number;
  plots: number;
}

/** POST /v1/projects/:pid/plot-design with a design: how many plots it makes, laid out with `seed`. */
export interface DesignPlan extends DesignFacts {
  /** The plots the design makes (for a grid over the limit, about how many it would). */
  plots: number;
  tooMany: boolean;
  strata: DesignStratum[] | null;
  seed: number;
}

/** A SIGRID country package: its name, and its file name's stem (Cote_d_Ivoire). */
export interface SigridCountry {
  name: string;
  file: string;
}

/** GET /v1/projects/:pid/sigrid/countries */
export interface SigridCountries {
  countries: SigridCountry[];
  spacings: readonly number[];
  max: number;
}

/** POST /v1/projects/:pid/sigrid without `generate`: plots per spacing (as `spacings`) by province and district, and for the choice. */
export interface SigridFacts {
  country: string;
  spacings: number[];
  provinces: { name: string; plots: number[]; districts: { name: string; plots: number[] }[] }[];
  /** The plots per spacing of the provinces and districts chosen, before any clip. */
  selected: number[];
  max: number;
  /** With a spacing: that spacing, and the plots of the whole choice (clip too). */
  spacingKm?: number;
  plots?: number;
  tooMany?: boolean;
}

// --- strata and areas (src/routes/areas.ts) -----------------------------------------------------------

/** The columns whose values make a stratum (questions of the survey or columns of the plot files), and each stratum's area. */
export interface StrataAreas {
  columns: string[];
  strata: { values: string[]; area: number }[];
}

/** The strata and their areas, or one total area, in hectares. */
export type AreaSettings = ({ mode: 'strata' } & StrataAreas) | { mode: 'total'; area: number };

/** GET /v1/projects/:pid/areas: what the plots' areas come from, and the strata with their plots. */
export interface AreasData {
  /** "strata" | "total": set on the dashboard; a file of the project file; "uncertainty": the Uncertainty page's total; null: none. */
  source: string | null;
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

/** PUT /v1/projects/:pid/areas */
export interface AreasSaved {
  settings: AreaSettings | null;
}
