// The People tab, a person's page, My work and the time spent on each plot, as the server sends them.
// Types only: see README.md in this folder.

import type { Rate } from './progress.js';

/** A member's role in a project (the server's src/types.ts Role). */
export type Role = 'admin' | 'reviewer' | 'operator';

/** The kinds of pattern flag (the server's src/flags.ts FLAG_KINDS). */
export type FlagKind = 'very_fast' | 'same_as_before' | 'required_empty' | 'edited_after_decision' | 'two_main' | 'no_plot';
/** Pattern flags counted by kind. */
export type FlagCounts = Record<FlagKind, number>;

/** One person's accuracy against the reference plots (the server's src/reference.ts). */
export interface ReferencePerson {
  username: string;
  /** Reference plots they checked (one check per plot, their latest); agreeing = every compared answer matches. */
  plots: Rate;
  /** Per question, in the survey's order: their answers compared with the reference's. */
  questions: { key: string; label: string; compared: number; agreeing: number; rate: number | null }[];
}

export type PersonStatus =
  /** Holds no plots (a coordinator, or someone whose plots were all moved). */
  | { kind: 'noPlots' }
  /** Every plot they hold is submitted and every check copy checked. */
  | { kind: 'finished' }
  /** Holds plots, has sent nothing yet (or never downloaded their plots). */
  | { kind: 'neverStarted' }
  /** Plots left, and neither a sync nor a plot download for more than quietDays days (red after twice that). */
  | { kind: 'quiet'; days: number; level: 'amber' | 'red' }
  | { kind: 'working' }
  /** The server owner disabled their account: they cannot log in or sync (Task 11). */
  | { kind: 'disabled' };

export interface PersonRow {
  userId: string;
  username: string;
  role: Role;
  plots: {
    /** Plots they hold (whole files given to them, and their plots of divided files). */
    assigned: number;
    /** Plots whose first assessment by them is submitted now (held now or not). */
    submitted: number;
    /** Plots with their first assessment saved, not submitted. */
    started: number;
    /** Plots they hold that nobody has submitted yet. */
    remaining: number;
    /** (assigned − remaining) / assigned, 0..1; null without plots. */
    done: number | null;
  };
  /** Left out on My work: checks are blind, and a collector is never told which plots are checks. */
  checks?: {
    /** Quality-check copies they hold. */
    assigned: number;
    /** Checks by them submitted now. */
    submitted: number;
    /** Copies they hold without their submitted check. */
    remaining: number;
  };
  /** Plots (not checks; on My work, plots and checks alike) first submitted in the last 7 days, today included, in the viewer's time zone. */
  submittedLast7: number;
  /** The median of plots a day over the days they submitted any; null for none. */
  medianPerDay: number | null;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  /** Their latest first submission of a plot or a check. */
  lastSubmittedAt: number | null;
  /** Their plots as first assessor that a check compared; null when the quality figures are not at hand. */
  agreement: Rate | null;
  status: PersonStatus;
  /**
   * A coordinator left their records out of the results (they are in no figure nor export): when and why. Only on the
   * People tab and a person's page (as the members are now); absent otherwise.
   */
  excluded?: { at: number; reason: string | null };
}

export interface InviteRow {
  id: string;
  role: Role;
  usedCount: number;
  maxUses: number;
  expiresAt: number | null;
  createdAt: number;
  /** Made from a person's page for someone already in the project (to get the new project file): their name. */
  forUsername: string | null;
}

export interface WeekSummary {
  /** The last 7 days, today last: plots first submitted that day (as the Progress tab's bars). */
  days: { date: string; submitted: number }[];
  /** Up to WEEK_PEOPLE people with the most plots submitted in those days (at least one). */
  mostActive: { userId: string; username: string; submitted: number }[];
  /** Up to WEEK_PEOPLE people with plots left and the fewest submitted in those days (not among the most active). */
  leastActive: { userId: string; username: string; submitted: number }[];
}

export interface QualityAtHand {
  /** False when no quality figures were at hand (nobody opened the Quality tab since the server started). */
  available: boolean;
  computedAt: number | null;
  stale: boolean;
}

export interface PeopleTable {
  timeZone: string;
  today: string;
  quietDays: number;
  quality: QualityAtHand;
  people: PersonRow[];
  /** Open invitation links: people invited who have not joined. */
  invites: InviteRow[];
  week: WeekSummary;
}

/** GET /v1/projects/:pid/people?tz= (coordinators). */
export interface PeopleAnswer extends PeopleTable {
  /** When the figures are older than the records: the time they are from (newer ones are being worked out). */
  asOf: number | null;
}

export type PlotStatus = 'submitted' | 'doneByOther' | 'started' | 'notStarted';

export interface PersonFile {
  csvFileId: string;
  filename: string;
  divided: boolean;
  plots: { total: number; submitted: number; doneByOther: number; started: number; notStarted: number };
  /** Left out on My work (checks are blind there: copies are counted as plots). */
  checks?: { total: number; submitted: number; started: number; notStarted: number };
  /** Their plots and copies in file order, at most MAX_LISTED_PLOTS; `kind` left out on My work. */
  list: { plot: string; kind?: 'main' | 'check'; status: PlotStatus }[];
  truncated: boolean;
}

export interface Speed {
  /** Submissions with a known time (record events), plots and checks. */
  submissions: number;
  /** Working sessions: runs of submissions less than SESSION_GAP_MS apart. */
  sessions: number;
  /** Gaps between consecutive submissions inside a session. */
  gaps: number;
  medianGapMs: number | null;
  /** Gaps under the project's "very fast" threshold (fastSeconds; VERY_FAST_MS by default). */
  veryFast: number;
  /** That threshold in seconds, for the page's sentence. */
  veryFastSeconds: number;
  /** Gaps per bin: [previous upToMs, upToMs). */
  buckets: { upToMs: number; count: number }[];
}

export interface SyncHealth {
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  lastCepDownloadAt: number | null;
  syncsCount: number;
  recordsReceived: number;
  cepUpdatedAt: number | null;
  /** The project file was replaced after their last download of it in Collect Earth. */
  oldProjectFile: boolean;
  /** Their Collect Earth, from its last call; null when it never called. */
  collectEarth: { kind: 'collect-earth' | 'old-collect-earth' | 'unknown'; version: string | null } | null;
}

export interface SentBack {
  plot: string;
  comment: string | null;
  decidedAt: number;
  /** Who decided (left out on My work). */
  decidedBy?: string | null;
  /** They submitted it again since: it has left their "To check again" file. */
  submittedAgain: boolean;
  /** The "To check again" plot file it is in for them in Collect Earth, while waiting (null: none). */
  file: string | null;
}

export interface PersonDetail {
  timeZone: string;
  today: string;
  quietDays: number;
  person: PersonRow;
  /** Days with a submission, oldest first: plots and checks first submitted that day (on My work, `plots` counts both and `checks` is left out). */
  calendar: { date: string; plots: number; checks?: number }[];
  /** Plots and checks first submitted in each hour of the day (0-23), in the viewer's time zone. */
  hours: number[];
  files: PersonFile[];
  speed: Speed;
  sync: SyncHealth;
  /**
   * What removing them leaves behind (not on My work): plots they alone hold that nobody
   * submitted yet (given to nobody after), and their copies not checked yet (dropped).
   */
  removal?: { plots: number; copies: number };
  quality: QualityAtHand & {
    /** Their plots as first assessor compared by a check (on My work: only plots certainly theirs). */
    asFirst: Rate | null;
    /** The plots they checked (not on My work). */
    asChecker?: Rate | null;
    /**
     * Plots sent back to them for another look (decision "recheck" on a plot with a record of
     * theirs, first assessment or check alike: src/sendBack.ts), the same plots as their "To
     * check again" files and those submitted again since, newest first. Never says which are checks.
     */
    sentBack: SentBack[];
    /** Their pattern flags by kind (Task 5), from the figures at hand; null without them. Never on My work. */
    flags?: FlagCounts | null;
    /**
     * Their accuracy against the reference plots (Task 14), from the figures at hand: absent when the
     * figures have no reference plot (or there are none at hand), null when none of their checks is
     * measured yet. Never on My work (nothing tells a collector
     * which plots are reference plots).
     */
    reference?: ReferencePerson | null;
  };
}

/** GET /v1/projects/:pid/people/:userId?tz= (coordinators) and GET /v1/projects/:pid/my-work?tz= (the person's own). */
export interface PersonAnswer extends PersonDetail {
  /** When the figures are older than the records: the time they are from (newer ones are being worked out). */
  asOf: number | null;
}

// --- the time spent on each plot (GET /v1/projects/:pid/time-spent?person=, coordinators) ---

export interface PersonTime {
  username: string;
  /** Submitted plots with a time, and without. */
  timed: number;
  untimed: number;
  medianSeconds: number | null;
  /** The middle half of their plots: the first and third quartiles. */
  q1Seconds: number | null;
  q3Seconds: number | null;
  totalSeconds: number;
  /** Their plots under the quick limit (0 while there is no limit). */
  quick: number;
  /** How many of their timed plots fall in each band of TIME_BANDS (one more than the bands: the last is open). */
  bands: number[];
}

/** A plot done much quicker than the team usually takes. */
export interface QuickPlot {
  plot: string;
  operator: string;
  seconds: number;
  submittedAt: number;
}

export interface TimeSpent {
  timed: number;
  untimed: number;
  medianSeconds: number | null;
  q1Seconds: number | null;
  q3Seconds: number | null;
  /** Plots under this many seconds are quick; null while fewer than MIN_TIMED_FOR_QUICK plots are timed. */
  quickBelowSeconds: number | null;
  quickShare: number;
  minTimed: number;
  bands: number[];
  bandLimits: readonly number[];
  people: PersonTime[];
  /** All quick plots, counted. */
  quickCount: number;
  /** The quick plots, quickest first (at most MAX_LISTED_QUICK). */
  quick: QuickPlot[];
}
