import type { DigestKind, Role } from './wire/account.js';
import type { ProgressSettings } from './wire/progress.js';
import type { ProjectStatus } from './wire/projectSettings.js';
import type { SamplingDraw, SamplingRule } from './wire/checks.js';
import type { AiRunKind, AiRunStatus, FollowUpAction } from './wire/ai.js';
import type { DecisionKind } from './wire/quality.js';
import type { DayCount, ServerAction, ServerActionKind, ServerSettings } from './wire/serverAdmin.js';
import type { RecordChange } from './wire/activity.js';
import type { TrainingKind } from './wire/training.js';

export type { DigestKind, InviteSummary, Membership, ProjectCreation, Role } from './wire/account.js';
export type { ProgressSettings } from './wire/progress.js';
export type { ProjectStatus, ShareLink } from './wire/projectSettings.js';
/** The project calls' types (src/wire/projects.ts); Role and Membership are in src/wire/account.ts. */
export type { CepInfo, Member, RepeatSettings } from './wire/projects.js';
export type { Assignment, AssignmentDetail, CsvFile, DivisionOrder, StoredDistribution } from './wire/plotFiles.js';
export type { ReferenceChangeResult, SamplingCore, SamplingDraw, SamplingFileRule, SamplingRule } from './wire/checks.js';
export type { DecisionKind, GuidanceNote, GuidanceNoteInput, QualitySettings } from './wire/quality.js';
export type { AiRunKind, AiRunStatus } from './wire/ai.js';
export type {
  AdminProject,
  DayCount,
  ServerAction,
  ServerActionKind,
  ServerActivityEntry,
  ServerSettings,
  StoppedDigest,
  StoredOwnerAlert,
  UserSummary,
} from './wire/serverAdmin.js';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email: string | null;
  /** Owns the server (first-run setup): edits server settings, issues reset links. Not a project role. */
  isPlatformAdmin: boolean;
  /** When the account accepted the terms of use at sign-up (epoch ms); null if never asked. */
  termsAcceptedAt?: number | null;
  /** When a platform admin disabled the account (epoch ms): it cannot log in. Null or absent: enabled. */
  disabledAt?: number | null;
}

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['draft', 'active', 'closed', 'archived'];
/** The moves a coordinator can make: publish, close, reopen, archive, restore. */
export const STATUS_MOVES: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ['active'],
  active: ['closed'],
  closed: ['active', 'archived'],
  archived: ['closed'],
};

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

/**
 * The quality figure a progress link shows (Decision 9): every check so far compared with its first
 * assessment, stored whenever the quality figures are worked out for the project, so the link reads
 * it from the database on any instance and never makes the server compute.
 */
export interface PublicQuality {
  compared: number;
  agreeing: number;
  /** agreeing / compared, null under MIN_PLOTS. */
  rate: number | null;
  /** When the inputs of the figures it comes from were read (ms). */
  computedAt: number;
}

/** The bounds of the settings above that are numbers (checked by PUT /v1/admin/settings). */
export const SETTING_BOUNDS = {
  alertFailedLogins: [1, 100_000],
  alertServerErrors: [1, 100_000],
  alertSyncErrors: [1, 100_000],
  alertStoragePercent: [1, 100],
  minPasswordLength: [8, 64],
  loginLockFailures: [0, 1000],
  loginLockMinutes: [1, 1440],
} as const;

/** An account's two-step sign-in, as stored (src/twoFactor.ts): the secrets encrypted, the recovery codes hashed. */
export interface TwoFactorState {
  secretEnc: string | null;
  pendingEnc: string | null;
  enabledAt: number | null;
  lastStep: number | null;
  recoveryHashes: string[];
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
  announcement: null,
  announcementUntil: null,
  twoFactorForCoordinators: false,
  alertFailedLogins: 50,
  alertServerErrors: 20,
  alertSyncErrors: 50,
  alertStoragePercent: 90,
  alertWebhookUrl: null,
  signupDomains: null,
  minPasswordLength: 8,
  loginLockFailures: 0,
  loginLockMinutes: 15,
};

/** What the server activity log keeps: server administrators' actions (migration 041). */
export const SERVER_ACTIONS = [
  'settings.changed',
  'account.created',
  'account.disabled',
  'account.enabled',
  'account.admin_granted',
  'account.admin_removed',
  'account.signed_out',
  'account.deleted',
  'account.reset_link',
  'account.reset_mailed',
  'account.two_factor_off',
  'accounts.exported',
  'project.archived',
  'project.restored',
  'project.coordinator',
  'mail.test',
  'message.sent',
  'alerts.seen',
  'account.unlocked',
] as const satisfies readonly ServerAction[];
/** The kinds the log is filtered by: an action's first word ("accounts" counts as "account"). */
export const SERVER_ACTION_KINDS = ['settings', 'account', 'project', 'mail', 'message', 'alerts'] as const satisfies readonly ServerActionKind[];
export const serverActionKind = (a: ServerAction): ServerActionKind =>
  (a.startsWith('accounts.') ? 'account' : a.slice(0, a.indexOf('.'))) as ServerActionKind;

export interface ServerActivityInput {
  /** The server administrator; null for the server itself. */
  actorUserId: string | null;
  action: ServerAction;
  /** The account acted on, and its username then (kept when the account is deleted). */
  targetUserId?: string | null;
  targetName?: string | null;
  /** The project acted on, by id only. */
  projectId?: string | null;
  /** Ids, names of settings and counts: never a password, a link or a project's name. */
  details?: AuditDetails;
}

export interface ServerActivityQuery {
  /** Only this actor's (by the username kept). */
  actor: string | null;
  kind: ServerActionKind | null;
  offset: number;
  limit: number;
}

/** The Collect Earth one account last used in one project (member_activity.client_agent). */
export interface ClientUse {
  userId: string;
  agent: string;
  /** Its last sync, else when it was last seen (epoch ms). */
  at: number;
}

/**
 * The server owner's panel's figures from the store (Task 11). Totals only: no names, no
 * answers; a project appears by its id with its size and whether it was active (§4b).
 */
export interface PlatformStats {
  users: number;
  disabledUsers: number;
  /** Enabled platform admins. */
  platformAdmins: number;
  /** Accounts seen in a project (member_activity.last_seen_at) or that logged in (a session created) since `activeSince`. */
  activeUsers: number;
  /** Accounts created per UTC day since `signupsFrom` (days with none left out). */
  signupsByDay: DayCount[];
  /** Every project: its id, its bytes (as the storage limit counts them), and whether it was active since `activeSince`. */
  projects: { projectId: string; storageBytes: number; active: boolean }[];
  /** Records stored per UTC day since `receivedFrom` (record_events.received_at), all projects added up. */
  receivedByDay: DayCount[];
}

/** The database's health for the server owner's panel; nulls on the memory store. */
export interface DatabaseHealth {
  sizeBytes: number | null;
  version: string | null;
  /** The migrations recorded as applied (schema_migrations, migration 018), in name order. */
  migrations: { name: string; firstAppliedAt: number }[] | null;
}

/** Bytes a project uses, by kind. Records count their XML and summary JSON. */
export interface ProjectStorage {
  cepBytes: number;
  /** Bytes of each plot CSV, by filename (an upload with the same name replaces it). */
  csvBytesByFilename: Record<string, number>;
  recordBytes: number;
  /** Training sets (their files) and their records: they count towards the project's storage too. */
  trainingBytes?: number;
}

export function totalStorageBytes(s: ProjectStorage): number {
  return s.cepBytes + Object.values(s.csvBytesByFilename).reduce((a, b) => a + b, 0) + s.recordBytes + (s.trainingBytes ?? 0);
}

/** What the server did about the round key of a project's CEP (see src/cep.ts). */
export type { RoundInfo } from './wire/projects.js';

/** A plot's answers in the reference set a coordinator uploaded, by summary key. */
/** One plot's answers in an earlier period of a repeat survey (migration 037). */
export interface PeriodAnswer {
  label: string;
  plotKey: string;
  operator: string;
  /** Summary key -> answer, as the record's summary */
  answers: Record<string, string>;
  savedAt: number;
}

export interface ReferenceAnswer {
  plotKey: string;
  answers: Record<string, string>;
  uploadedAt: number;
}

/**
 * One plot of a divided file held by one person; overlap = given as a quality-check copy.
 * `sampledAt` (a copy only): drawn by the check sampling at that time (epoch ms), not dealt
 * by the division; absent for every other holding.
 */
export interface PlotAssignment {
  plotKey: string;
  userId: string;
  overlap: boolean;
  sampledAt?: number;
}

/** The project's sampling state (sampling_rules). */
export interface SamplingState {
  rule: SamplingRule | null;
  /** The earliest first submission not drawn yet, while a draw is due; else null. */
  dueSince: number | null;
  lastAutoDrawAt: number | null;
  /** The last draw that added copies. */
  lastDraw: SamplingDraw | null;
  /** When a draw last looked for plots to check (one that found none included). */
  lastCheckedAt: number | null;
}

/** A copy a draw adds: the plot of a divided file, to a checker. */
export interface SampledCopy {
  csvFileId: string;
  plotKey: string;
  userId: string;
  /** Which rule asked for it. */
  reason: 'firstN' | 'percent';
}

/**
 * A reference plot (Task 14, reference_plots): a plot of a divided file whose first assessment,
 * by its reference assessor (its main holder there), every collector checks blind (a copy each).
 */
/** Calibration or learning plots (docs/plans/2026-11-04-calibration-and-learning-plots.md; src/wire/training.ts). */
export type { TrainingGolden, TrainingKind } from './wire/training.js';

/** A training set: its own plot file, given whole to its participants, kept apart from production. */
export interface TrainingSet {
  id: string;
  projectId: string;
  kind: TrainingKind;
  name: string;
  /** The file's name as uploaded. */
  filename: string;
  checksum: string;
  plotCount: number;
  /** Its plot ids (units, parsed with fileKeyCount), in file order. */
  plotKeys: string[];
  /** Percent of answers right to pass (learning), or null. */
  passMark: number | null;
  createdAt: number;
  createdBy: string | null;
  updatedAt: number;
  /** Participants (user ids). */
  memberIds: string[];
}


/**
 * One attempt of one participant at a set. A record counts for the open attempt when it was
 * submitted at or after `startedAt`; a closed attempt keeps a snapshot of its scores (`results`).
 */
export interface TrainingAttempt {
  userId: string;
  number: number;
  startedAt: number;
  /** Null while open. */
  results: unknown;
}

export interface ReferencePlot {
  csvFileId: string;
  plotKey: string;
  assessorUserId: string;
  /** The assessor's username (records are kept by it), also once they left the project. */
  assessor: string;
  addedAt: number;
  /** Who marked it (a user id), null when unknown. */
  addedBy: string | null;
}

/** One holding of a divided file's plot, for the reference copies. */
export interface PlotHoldingKey {
  csvFileId: string;
  plotKey: string;
  userId: string;
}

/** What changeReferencePlots does, in this order, in one transaction. */
export interface ReferenceChange {
  /** No longer reference plots (their holdings stay, unless `dropCopies` names them). */
  unmark: readonly { csvFileId: string; plotKey: string }[];
  /** Copies (only copies) to drop. */
  dropCopies: readonly PlotHoldingKey[];
  /**
   * Plots to mark (only in a divided file, the assessor a member): the assessor becomes their
   * main holder there; every other holding of them in the file becomes a copy (no longer drawn).
   */
  mark: readonly { csvFileId: string; plotKey: string; assessorUserId: string }[];
  /** Copies to add: only of a reference plot of a divided file, to a member other than its assessor who does not hold it there. */
  addCopies: readonly PlotHoldingKey[];
  at: number;
  by: string | null;
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
  /**
   * Seconds of active work on the plot counted by Collect Earth (its form open and in use, long pauses left out),
   * or absent/null when not known (an older Collect Earth, a tool).
   */
  activeSeconds?: number | null;
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
  status: ProjectStatus;
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
  /** The active time spent on the plot, in seconds, as Collect Earth sent it with this save (null/absent: not known). */
  activeSeconds?: number | null;
}

/**
 * A record without its answers (listRecordStates), and when it was first submitted: the
 * modifiedOn of its record event `submitted` (null when it never was, or was stored
 * before record events were kept and the backfill did not see it).
 */
export type RecordState = Pick<RecordRow, 'recordKey' | 'operator' | 'activelySaved' | 'deleted' | 'modifiedOn' | 'activeSeconds'> & { firstSubmittedOn: number | null };

/** A record's stored XML (getRecordXml), as Collect Earth sent it. */
export type RecordXml = Pick<RecordRow, 'recordKey' | 'operator' | 'step' | 'xml' | 'deleted'>;

export const DEFAULT_PROGRESS_SETTINGS: ProgressSettings = { deadline: null, targetPlots: null, quietDays: 3 };

/** A view of the analysis page shared with the team (src/wire/analysis.ts). */
export type { SharedAnalysisView } from './wire/analysis.js';

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
  seen?: { operator: string; hash: number; full?: number }[] | null;
  /** The bulk run that made it (its audit entry has the same id); null for a decision made alone. */
  batch?: string | null;
}

// --- The AI assistant's runs (ai_runs, migration 011) ---

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
  action: FollowUpAction | null;
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
  action?: FollowUpAction | null;
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

/**
 * Whether a person's AI tokens this month (every project, deleted ones included) reach the monthly limit
 * times the projects they coordinate (at least one): deleting a project and making another does not start
 * a fresh allowance.
 */
export function personOverMonth(tokensThisMonth: number, coordinatedProjects: number, w: AiRunWindow): boolean {
  return tokensThisMonth >= w.monthlyTokens * Math.max(1, coordinatedProjects);
}

/** The failure of a run that was still running when its server stopped, or long past its time limit. */
export const AI_INTERRUPTED = { code: 'interrupted', message: 'The assistant stopped before it finished: the server restarted, or the run took too long.' } as const;

// --- Activity data (record_events, member_activity, audit_log) ---

/** What one stored upload did to a record (src/wire/activity.ts). */
export type { RecordChange } from './wire/activity.js';

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
  /** Only events of these changes (none given: all). */
  changes?: readonly RecordChange[];
  limit: number;
  /** Rows after this one in the order (modifiedOn, id) newest first. */
  before?: EventCursor;
}

/** How many record events of one person and change were saved in one quarter of an hour (recordEventCounts). */
export interface RecordEventCount {
  operator: string;
  change: RecordChange;
  /** The quarter of an hour's start (epoch ms, a multiple of 900,000): every time zone's days start on one. */
  at: number;
  count: number;
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
  'member.anonymized',
  'member.signed_out',
  'member.role',
  'cep.replaced',
  'csv.uploaded',
  'assignments.set',
  'division.applied',
  'plots.moved',
  'plots.rebalanced',
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
  'training.changed',
  'training.synced',
  'member.excluded',
  'project.imported',
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
  /** Only these actions (none given: all). */
  actions?: readonly AuditAction[];
  /** at >= from and < to (epoch ms), when given. */
  from?: number;
  to?: number;
}

// --- Email digests (Task 19): account data, global as users ---

export const DIGEST_KINDS: readonly DigestKind[] = ['coordinator', 'collector'];

/** The languages the dashboard and the mails are written in. */
export type MailLanguage = 'en' | 'es' | 'fr' | 'pt' | 'tr';
export const MAIL_LANGUAGES: readonly MailLanguage[] = ['en', 'es', 'fr', 'pt', 'tr'];

/** An account's mail settings. */
export interface AccountMail {
  email: string | null;
  /** When the email was confirmed by its link; null until then (and again after a change). */
  emailConfirmedAt: number | null;
  /** The language and time zone the mails are written in (chosen on the Account page); null: English, UTC. */
  language: MailLanguage | null;
  timeZone: string | null;
  digests: DigestState[];
}

/** One subscription as the account page shows it. */
export interface DigestState {
  kind: DigestKind;
  createdAt: number;
  /** The latest week done (mailed, or with nothing to tell). */
  lastSentWeek: string | null;
  /** The latest week a mail went for, and when. */
  lastMailedWeek: string | null;
  lastSentAt: number | null;
  /** Refusals for good in a row; at MAX_DIGEST_FAILURES the subscription stopped (stoppedAt). */
  failures: number;
  stoppedAt: number | null;
}

/** Refusals for good (SMTP 5xx) in a row after which a subscription stops. */
export const MAX_DIGEST_FAILURES = 3;

/** A subscription the digest job looks at, with what it needs of the account. */
export interface DueDigest {
  userId: string;
  kind: DigestKind;
  /** When it was turned on: a week that ended before is never sent. */
  createdAt: number;
  lastSentWeek: string | null;
  username: string;
  email: string | null;
  emailConfirmed: boolean;
  disabled: boolean;
  language: MailLanguage | null;
  timeZone: string | null;
}
