// The progress figures (the Progress tab, the bell, a progress link) as the server sends them.
// Types only: see README.md in this folder.


/**
 * A project's progress settings (the Progress tab): an optional deadline (a calendar
 * day, YYYY-MM-DD), an optional target in plots (null: every assigned plot), and after
 * how many days without a sync someone with plots left counts as quiet.
 */
export interface ProgressSettings {
  deadline: string | null;
  targetPlots: number | null;
  quietDays: number;
}

export interface ProgressTotals {
  /** Plot units of the plot files, checks (the reassessment round of an own round) left out. */
  plots: number;
  assigned: number;
  notAssigned: number;
  /** Plots whose first assessment is submitted now. */
  submitted: number;
  /** Plots with a first assessment saved but not submitted. */
  started: number;
  notStarted: number;
}

export interface ProgressDay {
  date: string;
  /** Plots (submitted now) whose first assessment was first submitted that day. */
  submitted: number;
  /** Plots submitted by the end of the day, of those submitted now. */
  cumulative: number;
}

export interface Forecast {
  target: number;
  /** Where the target comes from: the project setting, or every assigned plot. */
  targetFrom: 'setting' | 'assigned';
  remaining: number;
  /** Plots a day over the last paceDays days. */
  pacePerDay: number;
  /** PACE_DAYS, or fewer when the first plot was submitted less than PACE_DAYS days ago. */
  paceDays: number;
  /** Days until the rest is done at that pace; 0 when done; null without a pace. */
  daysLeft: number | null;
  /** today + daysLeft; null without a pace. */
  endDate: string | null;
  deadline: string | null;
  /** Days from today to the deadline (negative once it has passed). */
  daysToDeadline: number | null;
  /** endDate − deadline in days: over 0 is late. Null without a deadline or a pace. */
  daysOver: number | null;
  /** Plots a day needed to finish by the deadline; null when done, without a deadline or once it has passed. */
  neededPerDay: number | null;
}

export interface AttentionPerson {
  username: string;
  /** quiet: their last sync and their last plot download (the later one is what counts). */
  lastSyncAt?: number | null;
  lastPlotsDownloadAt?: number | null;
  /** oldUnsentWork: the median wait between saving and the server receiving it. */
  medianDelayMs?: number;
  /** trainingFinished: the learning set they finished, and whether they passed (null: no pass mark). */
  set?: string;
  passed?: boolean | null;
}

export type AttentionItem =
  | { kind: 'quiet'; count: number; quietDays: number; people: AttentionPerson[] }
  | { kind: 'neverDownloaded'; count: number; people: AttentionPerson[] }
  | { kind: 'notAssigned'; count: number }
  | { kind: 'oldUnsentWork'; count: number; people: AttentionPerson[] }
  | { kind: 'differencesWaiting'; count: number }
  | { kind: 'storage'; count: number; level: 'nearlyFull' | 'over'; usedBytes: number; limitBytes: number }
  | { kind: 'oldProjectFile'; count: number; people: AttentionPerson[] }
  | { kind: 'oldCollectEarth'; count: number; unknownVersion: number; people: AttentionPerson[] }
  | { kind: 'trainingFinished'; count: number; people: AttentionPerson[] };

export interface Progress {
  timeZone: string;
  today: string;
  totals: ProgressTotals;
  daily: ProgressDay[];
  forecast: Forecast;
  /** Null for a reviewer. */
  attention: AttentionItem[] | null;
  settings: ProgressSettings;
}

/** The kinds of "needs attention" item. */
export type AttentionKind = AttentionItem['kind'];

/** GET /v1/projects/:pid/progress: the figures, and when they are older than the records the time they are from. */
export interface ProgressAnswer extends Progress {
  asOf: number | null;
}

/** GET /v1/projects/:pid/attention and POST .../attention/read: the bell's items, with what this coordinator has read. */
export interface BellAnswer {
  items: { key: string; read: boolean; item: AttentionItem }[];
  unread: number;
}

export interface Rate {
  compared: number;
  agreeing: number;
  /** agreeing / compared (0..1), null when compared < MIN_PLOTS. */
  rate: number | null;
}

/**
 * What a progress link shows (GET /v1/public/progress/:token). Built field by field from the
 * Progress tab's figures, so nothing else can slip in: the project's name, the plot totals, the
 * days, the forecast and one quality figure. Never a name, a username, an answer, a plot id, a
 * file name, a coordinate nor anyone's own counts.
 */
export interface PublicProgress {
  project: { name: string };
  timeZone: string;
  today: string;
  totals: ProgressTotals;
  daily: ProgressDay[];
  forecast: Forecast;
  quality: {
    /** False until the quality figures were first worked out for the project (nobody opened the Quality tab yet). */
    available: boolean;
    /** Every check so far compared with its first assessment; rate null under MIN_PLOTS plots. */
    agreement: Rate | null;
    computedAt: number | null;
  };
  /** When the figures are older than the records (a newer state is being worked out). */
  asOf: number | null;
}
