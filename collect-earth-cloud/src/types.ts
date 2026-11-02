/** Membership role within a single project. Authority derives only from these. */
export type Role = 'admin' | 'reviewer' | 'operator';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email: string | null;
  /** Owns the server (first-run setup): edits server settings, issues reset links. Not a project role. */
  isPlatformAdmin: boolean;
  /** When the account accepted the terms of use at sign-up (epoch ms); null if never asked. */
  termsAcceptedAt?: number | null;
}

/** A user's membership of one project, with the project name for listings. */
export interface Membership {
  projectId: string;
  projectName: string;
  role: Role;
}

/** One project member, for the admin members listing. */
export interface Member {
  userId: string;
  username: string;
  role: Role;
}

export interface Invite {
  projectId: string;
  projectName: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  /** A revoked invite answers like an unknown one on register, and previews as not valid. */
  revoked: boolean;
}

/** An open invite as the project admin sees it (the token itself is only shown at creation). */
export interface InviteSummary {
  id: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number;
}

/** Who may create projects with a session: every logged-in user, or platform admins only. */
export type ProjectCreation = 'anyone' | 'platform-admins';

/** Server-wide settings edited by the platform admin. */
export interface ServerSettings {
  signupOpen: boolean;
  projectCreation: ProjectCreation;
  /** Most projects one account may coordinate (be admin of); 0 = no limit. Platform admins are exempt. */
  maxProjectsPerUser: number;
  /** Most space one project may use, in MB (CEP + plot files + records); 0 = no limit. */
  maxProjectStorageMb: number;
  /** Terms of use (http/https). When set, sign-up asks people to accept them. */
  termsUrl: string | null;
  /** Shown on every page so people know whom to ask (forgotten password...). */
  contactEmail: string | null;
  /** Shown in the app bar instead of "Collect Earth Cloud". */
  serverName: string | null;
  /** The AI assistant may be used on this server (it also needs the AI_VERTEX_* configuration). */
  aiEnabled: boolean;
  /** AI reports per project per UTC day; 0 = none allowed. */
  aiReportsPerDay: number;
  /** AI follow-ups and questions per project per UTC day; 0 = none allowed. */
  aiFollowUpsPerDay: number;
  /**
   * AI tokens (input + output) per project per calendar month (UTC); 0 = none allowed.
   * Per project: the server's total can reach this times the number of projects.
   */
  aiMonthlyTokens: number;
}

export const DEFAULT_SETTINGS: ServerSettings = {
  signupOpen: false,
  projectCreation: 'platform-admins',
  maxProjectsPerUser: 0,
  maxProjectStorageMb: 0,
  termsUrl: null,
  contactEmail: null,
  serverName: null,
  aiEnabled: false,
  aiReportsPerDay: 5,
  aiFollowUpsPerDay: 30,
  aiMonthlyTokens: 2_000_000,
};

/** One account in the platform admin's user list: a project COUNT only, never names (§4b). */
export interface UserSummary {
  userId: string;
  username: string;
  isPlatformAdmin: boolean;
  /** Projects the account belongs to, in any role. */
  projects: number;
  /** Projects the account coordinates (admin role): what maxProjectsPerUser counts. */
  coordinatedProjects: number;
}

/** Bytes a project uses, by kind. Records count their XML and summary JSON. */
export interface ProjectStorage {
  cepBytes: number;
  /** Bytes of each plot CSV, by filename (an upload with the same name replaces it). */
  csvBytesByFilename: Record<string, number>;
  recordBytes: number;
}

export function totalStorageBytes(s: ProjectStorage): number {
  return s.cepBytes + Object.values(s.csvBytesByFilename).reduce((a, b) => a + b, 0) + s.recordBytes;
}

/** What the server did about the round key of a project's CEP (see src/cep.ts). */
export type { RoundInfo } from './cep.js';

/** Size and last upload time (epoch ms) of a project's CEP. */
export interface CepInfo {
  bytes: number;
  updatedAt: number;
}

/** A plot CSV file belonging to a project (metadata; content fetched separately). */
export interface CsvFile {
  id: string;
  filename: string;
  checksum: string;
  plotCount: number;
  /** How its plots are divided between people; null (or absent) = whole file, the assignments grid applies. */
  distribution?: StoredDistribution | null;
}

export type DivisionOrder = 'file' | 'mixed';

/**
 * A divided plot file's rule (csv_files.distribution), as last applied. `seed` is the
 * shuffle seed of order 'mixed'. 'manual' = changed by hand (move-unfinished).
 */
export type StoredDistribution =
  | { mode: 'even'; people: string[]; order: DivisionOrder; overlapPercent: number; seed?: number }
  | {
      mode: 'column';
      column: number;
      groups: { value: string; people: string[] }[];
      order: DivisionOrder;
      overlapPercent: number;
      seed?: number;
    }
  | { mode: 'manual' };

/** One plot of a divided file held by one person; overlap = given as a quality-check copy. */
export interface PlotAssignment {
  plotKey: string;
  userId: string;
  overlap: boolean;
}

/** One csv-file ↔ user assignment. */
export interface Assignment {
  userId: string;
  csvFileId: string;
}

/** An assignment enriched with names, for the admin listing. */
export interface AssignmentDetail {
  userId: string;
  username: string;
  csvFileId: string;
  filename: string;
}

/**
 * One record (or deletion tombstone) exactly as the Java client uploads it.
 * Field names and types mirror CloudApiClient.toJson / CloudRecordSerializer.
 */
export interface RecordEnvelope {
  recordKey: string;
  surveyUri: string;
  operator: string | null;
  /** Local modification time as epoch milliseconds, or null if the client had none. */
  modifiedOn: number | null;
  activelySaved: boolean;
  step: number;
  xml: string | null;
  summary: Record<string, string>;
  deleted: boolean;
  payloadVersion: number;
}

/** Per-record outcome, as consumed by CloudSyncService.applyResult. */
export type StoreStatus = 'stored' | 'stale' | 'conflict' | 'error';

export interface BatchItemResult {
  recordKey: string;
  status: StoreStatus;
  reason?: string;
}

export interface ProjectRow {
  projectId: string;
  name: string;
  surveyUri: string | null;
  surveyName: string | null;
  idmlBase64: string | null;
}

/**
 * A stored record, keyed by (projectId, recordKey, operator). LWW is decided on
 * modifiedOn with receivedAt as the tiebreak. Deletions are soft (deleted=true).
 */
export interface RecordRow {
  projectId: string;
  recordKey: string;
  operator: string;
  modifiedOn: number;
  receivedAt: number;
  activelySaved: boolean;
  step: number;
  xml: string | null;
  summary: Record<string, string>;
  deleted: boolean;
  deletedOn: number | null;
  /** Only from listRecordSummaries with firstSubmissions: the modifiedOn of its record event `submitted` (null: none). */
  firstSubmittedOn?: number | null;
}

/**
 * A record without its answers (listRecordStates), and when it was first submitted: the
 * modifiedOn of its record event `submitted` (null when it never was, or was stored
 * before record events were kept and the backfill did not see it).
 */
export type RecordState = Pick<RecordRow, 'recordKey' | 'operator' | 'activelySaved' | 'deleted' | 'modifiedOn'> & { firstSubmittedOn: number | null };

/** A project's quality-review settings: number margins (percent) by question key. */
export interface QualitySettings {
  margins: Record<string, number>;
  /** The "very fast" flag's threshold in whole seconds (Task 5); absent: DEFAULT_FAST_SECONDS (15). */
  fastSeconds?: number;
}

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

export const DEFAULT_PROGRESS_SETTINGS: ProgressSettings = { deadline: null, targetPlots: null, quietDays: 3 };

/** Which answer of a differing plot is right: the first assessment, the check, or neither (look again). */
export type DecisionKind = 'first' | 'check' | 'recheck';

/** The coordinator's decision on one plot unit (the plot as the quality figures pair it). */
export interface QualityDecision {
  plot: string;
  decision: DecisionKind;
  comment: string | null;
  /** Username of who decided; null when made with a project token or the account is gone. */
  decidedBy: string | null;
  decidedAt: number;
  /**
   * The records of the plot as the quality figures showed them when it was decided (each
   * one's person and answers' hash, flags.ts DecisionSeen); null when none were at hand.
   * For the pattern flags only: the routes do not send it.
   */
  seen?: { operator: string; hash: number }[] | null;
}

/** What a guidance note is about: a question and, for a mixed-up pair, both answers. */
export interface GuidanceNoteInput {
  questionKey: string;
  firstValue: string | null;
  checkValue: string | null;
  text: string;
}

/** A note for collectors about a question (or one mix-up of its answers). */
export interface GuidanceNote extends GuidanceNoteInput {
  id: string;
  /** Username of who last wrote it; null when made with a project token or the account is gone. */
  updatedBy: string | null;
  updatedAt: number;
}

// --- The AI assistant's runs (ai_runs, migration 011) ---

export type AiRunKind = 'report' | 'follow_up' | 'question';
export type AiRunStatus = 'running' | 'done' | 'failed' | 'refused';

/** One tool call of a run as stored: our tool's name (or "unknown"), the arguments as validated (pseudonymous), and whether it worked. */
export interface AiToolCall {
  name: string;
  args: Record<string, unknown> | null;
  ok: boolean;
}

/** A run as listed: no result, no question, no tool arguments. */
export interface AiRunSummary {
  id: string;
  kind: AiRunKind;
  status: AiRunStatus;
  /** Username of who started it; null once the account is deleted. */
  startedBy: string | null;
  startedAt: number;
  finishedAt: number | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  parentRun: string | null;
  findingIndex: number | null;
  action: string | null;
  /** Why it failed (a FailureCode of src/ai/run.ts, or `interrupted`); `off_topic` when refused. */
  errorCode: string | null;
}

/** A run as stored. `result` is pseudonymous: `{ result, pseudonyms, plots }` (StoredResult). */
export interface AiRunRow extends AiRunSummary {
  toolCalls: AiToolCall[];
  result: unknown | null;
  /** The failure's plain English text, or the refusal shown to the coordinator. */
  error: string | null;
  /** A free question, with the usernames in it replaced by pseudonyms (see questionNames). */
  question: string | null;
  /** The pseudonyms of the question (pseudonym -> username), to show it back with real names. */
  questionNames: Record<string, string> | null;
}

export interface AiRunStart {
  kind: AiRunKind;
  /** The user who started it (a person: runs need a signed-in coordinator). */
  startedBy: string;
  model: string;
  parentRun?: string | null;
  findingIndex?: number | null;
  action?: string | null;
  question?: string | null;
  questionNames?: Record<string, string> | null;
}

/**
 * The limits a new run is checked against, in this order: one running run per project
 * (rows still running that started before `staleBefore` are failed first, as
 * `interrupted`), the day's runs of its kind, then the month's tokens. Times in ms.
 */
export interface AiRunWindow {
  now: number;
  staleBefore: number;
  dayStart: number;
  monthStart: number;
  reportsPerDay: number;
  followUpsPerDay: number;
  monthlyTokens: number;
}

/** What counts toward the limits, as a store reads it under its lock. */
export interface AiRunCounts {
  running: boolean;
  /** Reports done today (UTC). Failed ones do not count. */
  reportsToday: number;
  /** Follow-ups and questions done or refused today (UTC). Failed ones do not count. */
  answersToday: number;
  /** Input and output tokens of every run this month (UTC), failed ones too. */
  tokensThisMonth: number;
}

export type AiRunStartResult = { ok: true; run: AiRunRow } | { ok: false; limit: 'busy' | 'daily' | 'monthly' };

export interface AiRunProgress {
  inputTokens: number;
  outputTokens: number;
  toolCalls: AiToolCall[];
}

export interface AiRunEnd extends AiRunProgress {
  status: 'done' | 'failed' | 'refused';
  result: unknown | null;
  error: string | null;
  errorCode: string | null;
  finishedAt: number;
}

/** One project's AI use since a time, for the server owner: counts only, never names or content (§4b). */
export interface AiUsage {
  projectId: string;
  runs: number;
  reports: number;
  followUps: number;
  questions: number;
  failed: number;
  refused: number;
  inputTokens: number;
  outputTokens: number;
}

/** Which limit a new run would pass first, or null when it may start (AiRunWindow's order). */
export function aiLimitReached(kind: AiRunKind, counts: AiRunCounts, w: AiRunWindow): 'busy' | 'daily' | 'monthly' | null {
  if (counts.running) return 'busy';
  if (kind === 'report' ? counts.reportsToday >= w.reportsPerDay : counts.answersToday >= w.followUpsPerDay) return 'daily';
  if (counts.tokensThisMonth >= w.monthlyTokens) return 'monthly';
  return null;
}

/** The failure of a run that was still running when its server stopped, or long past its time limit. */
export const AI_INTERRUPTED = { code: 'interrupted', message: 'The assistant stopped before it finished: the server restarted, or the run took too long.' } as const;

// --- Activity data (record_events, member_activity, audit_log) ---

/**
 * What one stored upload did to a record (recordChange, src/lww.ts), from the stored
 * row before it and whether the record (key, operator) was ever submitted:
 * - `submitted`: actively saved (Submit and validate), the record's first submission;
 * - `resubmitted`: actively saved again, after an earlier submission;
 * - `unsubmitted`: a draft save (an autosave) onto a submitted plot;
 * - `deleted`: a tombstone;
 * - `created`: a first (or revived) record, not submitted;
 * - `updated`: a draft saved again.
 */
export type RecordChange = 'created' | 'updated' | 'submitted' | 'resubmitted' | 'unsubmitted' | 'deleted';

/** One stored upload of a record (record_events). No XML; the answers only on a (re)submission. */
export interface RecordEvent {
  /** Increasing; with modifiedOn the cursor of a page (EventCursor). */
  id: string;
  projectId: string;
  recordKey: string;
  operator: string;
  modifiedOn: number;
  receivedAt: number;
  activelySaved: boolean;
  step: number;
  deleted: boolean;
  change: RecordChange;
  /** The record's summary when change is `submitted` or `resubmitted`, else null. */
  summary: Record<string, string> | null;
}

export type RecordEventInput = Omit<RecordEvent, 'id'>;

/** Where a newest-first page ended: the time (modifiedOn or at) and id of its last row. */
export interface EventCursor {
  at: number;
  id: string;
}

export interface RecordEventQuery {
  /** modifiedOn >= from and < to (epoch ms). */
  from: number;
  to: number;
  operator?: string;
  limit: number;
  /** Rows after this one in the order (modifiedOn, id) newest first. */
  before?: EventCursor;
}

/** When a member last used the project, and how much (member_activity). */
export interface MemberActivity {
  userId: string;
  /** Any authenticated call to the project. */
  lastSeenAt: number | null;
  /** records:batch. */
  lastSyncAt: number | null;
  /** my-assignment or a plot file's content. */
  lastPlotsDownloadAt: number | null;
  /** GET /cep by Collect Earth (its User-Agent); a browser's download does not count. */
  lastCepDownloadAt: number | null;
  syncsCount: number;
  /** Records stored from this member's syncs (stale ones not counted). */
  recordsReceived: number;
  /** The raw User-Agent of the member's last Collect Earth call (at most 200 characters). */
  clientAgent: string | null;
}

/**
 * What to add to a member's activity: each time is kept when later than the stored
 * one, counters are added, and a client agent replaces the stored one.
 */
export interface MemberActivityPatch {
  lastSeenAt?: number;
  lastSyncAt?: number;
  lastPlotsDownloadAt?: number;
  lastCepDownloadAt?: number;
  syncs?: number;
  recordsReceived?: number;
  clientAgent?: string;
}

/** The coordinator actions the audit log keeps (some written by later tasks). */
export const AUDIT_ACTIONS = [
  'invite.created',
  'invite.revoked',
  'member.removed',
  'member.role',
  'cep.replaced',
  'csv.uploaded',
  'assignments.set',
  'division.applied',
  'plots.moved',
  'decision.set',
  'decision.deleted',
  'decision.bulk',
  'settings.changed',
  'export.downloaded',
  'survey.replaced',
  'sampling.drawn',
  'reference.changed',
  'link.created',
  'link.revoked',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Ids and counts only, never answers. */
export type AuditDetails = Record<string, string | number | boolean | null>;

export interface AuditInput {
  /** Null for a project token (no person). */
  actorUserId: string | null;
  action: AuditAction;
  details: AuditDetails;
}

/** One entry of the audit log (audit_log). */
export interface AuditEntry extends AuditInput {
  id: string;
  projectId: string;
  at: number;
  /** The actor's username; null for a project token or an account since deleted. */
  actor: string | null;
}

export interface AuditQuery {
  limit: number;
  /** Rows after this one in the order (at, id) newest first. */
  before?: EventCursor;
  /** Only this actor's (a user id). */
  actor?: string;
  action?: AuditAction;
}
