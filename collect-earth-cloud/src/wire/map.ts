// The map of progress (its plots, page by page) and where plots are, as the server sends them. Types
// only: see README.md in this folder.

/** The outline Collect Earth draws around a plot (from the project file), or only its place. */
export type PlotOutline = { kind: 'square'; sideMeters: number } | { kind: 'circle'; radiusMeters: number; vertices: number } | { kind: 'place' };

export interface PlotPlace {
  plot: string;
  lat: number;
  lon: number;
  /** The plot id as the collector sees it (keys hidden from the record list left out). */
  name: string;
}

/** POST /v1/projects/:pid/quality/places: where the plots asked for are. */
export interface PlotPlaces {
  places: PlotPlace[];
  /** The outline Collect Earth draws around each plot, or only the place (plotShape.ts). */
  outline: PlotOutline;
  /**
   * Set when the survey's coordinates are not latitude and longitude (its first spatial
   * reference system, e.g. "EPSG:32633"): Collect Earth transforms them, this server does
   * not, so no place is given.
   */
  unsupportedSrs?: string;
}

/** A plot's status on the map; a page's points give it as its index in the page's `statuses`. */
export type MapStatus = 'notStarted' | 'started' | 'submitted' | 'accepted' | 'recheck' | 'differs' | 'resubmitted';

/** A plot file of the map. */
export interface MapFile {
  id: string;
  filename: string;
  /** Its plots. */
  plots: number;
  /** Of those, the ones with a place. */
  onMap: number;
  /** Coordinators: whether its plots are divided between people (a whole file's plots do not move one by one). */
  divided?: boolean;
}

/** What every page of a map has besides its plots. */
export interface MapExtras {
  /** The quality figures the disagreements come from; null when none are at hand. */
  figures: { computedAt: number; stale: boolean } | null;
  /** When the plots' state is older than the records (a newer one is being worked out). */
  asOf: number | null;
  /** The survey's coordinate system when it is not latitude and longitude: no plot is on the map. */
  unsupportedSrs?: string;
}

/** GET /v1/projects/:pid/map/plots: one page of a map (GEO_PAGE_SIZE plots from `offset`). */
export interface MapPage extends MapExtras {
  /** Every page of one map has it; the next pages send it back (?version=). */
  version: string;
  offset: number;
  /** Plots on the map. */
  total: number;
  /** The offset of the next page; null on the last. */
  next: number | null;
  /** [lat, lon, status, holder] per plot: status an index in `statuses`, holder in `holders` (-1: nobody). */
  points: [number, number, number, number][];
  /** The plot (unit) of each point, for its page (GET /plots/:plot). */
  plots: string[];
  /** The id the collector sees of each point; null when it is the plot id for every plot. */
  names: string[] | null;
  /** Coordinators: each point's plot file (index in `files`, -1 when several list it). */
  file?: number[];
  /** Coordinators: the reference plots of this page, by their index in the whole map (offset + i). */
  reference?: number[] | null;
  statuses: readonly MapStatus[];
  /** Plots per status (the filters' plots, those off the map included), by status code. */
  counts: number[];
  /** The filters' plots without a place. */
  notOnMap: number;
  files: MapFile[];
  /** Everyone who holds a plot or made a first assessment (the person filter); null for a reviewer. */
  people: string[] | null;
  /** The different groups of people holding a plot, names sorted; null for a reviewer. */
  holders: string[][] | null;
}
