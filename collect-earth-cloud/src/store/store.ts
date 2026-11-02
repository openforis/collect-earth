import type {
  AiRunEnd,
  AiRunProgress,
  AiRunRow,
  AiRunStart,
  AiRunStartResult,
  AiRunSummary,
  AiRunWindow,
  AiUsage,
  Assignment,
  AssignmentDetail,
  AuditEntry,
  AuditInput,
  AuditQuery,
  CepInfo,
  CsvFile,
  DatabaseHealth,
  DecisionKind,
  EventCursor,
  GuidanceNote,
  GuidanceNoteInput,
  Invite,
  InviteSummary,
  Member,
  MemberActivity,
  MemberActivityPatch,
  Membership,
  PlatformStats,
  PlotAssignment,
  ProgressSettings,
  ProjectRow,
  ProjectStorage,
  QualityDecision,
  QualitySettings,
  RecordEvent,
  RecordEventCount,
  RecordEventInput,
  RecordEventQuery,
  RecordRow,
  RecordState,
  RoundInfo,
  Role,
  SampledCopy,
  SamplingDraw,
  SamplingRule,
  SamplingState,
  ServerSettings,
  StoredDistribution,
  User,
  UserSummary,
} from '../types.js';

export interface CreateProjectResult {
  projectId: string;
  adminToken: string;
  projectToken: string;
}

/** Resolved identity of a bearer token: which project it belongs to and its role. */
export interface TokenMembership {
  projectId: string;
  role: Role;
}

/** The plots one person holds in a divided file; copyKeys are those given as quality-check copies. */
export interface UserPlots {
  plotKeys: string[];
  copyKeys: string[];
}

export interface CreateInviteInput {
  projectId: string;
  role: Role;
  maxUses: number;
  expiresAt: number | null;
  /** The user who made it; null when made with a Phase-0 project admin token (no user). */
  createdBy: string | null;
}

/**
 * Persistence boundary. Every method that touches project data takes a projectId
 * and never returns anything outside it — the tenant boundary lives here as well
 * as in the auth middleware. Two implementations exist: an in-memory store for
 * development and tests, and a PostgreSQL store for deployment.
 */
export interface Store {
  createProject(input: { name: string }): Promise<CreateProjectResult>;
  getProject(projectId: string): Promise<ProjectRow | null>;
  renameProject(projectId: string, name: string): Promise<void>;
  /**
   * Deletes a project and everything in it: records, CEP, plot files, assignments,
   * invites, memberships, activity data and its Phase-0 tokens. One transaction (Postgres).
   */
  deleteProject(projectId: string): Promise<void>;
  /** Bytes the project uses (CEP, plot files, stored records). */
  getProjectStorage(projectId: string): Promise<ProjectStorage>;

  /**
   * Resolves a plaintext PROJECT-scoped token (Phase 0 admin/operator tokens) to
   * its single project membership, or null. User session tokens are resolved via
   * resolveSession + getMembership instead.
   */
  resolveToken(token: string): Promise<TokenMembership | null>;

  setSurvey(projectId: string, surveyUri: string, surveyName: string | null, idmlBase64: string): Promise<void>;

  /**
   * Stores the CEP the project serves (overwrites), what the server did about round,
   * and the uploaded file when it differs from the served one (else null).
   */
  putCep(projectId: string, served: Buffer, info: RoundInfo, original: Buffer | null): Promise<void>;
  /** The CEP the project serves. */
  getCep(projectId: string): Promise<Buffer | null>;
  /** The CEP as uploaded: the original when the server changed it, else the served one. */
  getOriginalCep(projectId: string): Promise<Buffer | null>;
  getRoundInfo(projectId: string): Promise<RoundInfo | null>;
  /** Sets the code that marks re-assessments in the stored round info (no-op without one). */
  setReassessmentCode(projectId: string, code: string | null): Promise<void>;
  /** Whether the project has any record, deleted ones included. */
  hasRecords(projectId: string): Promise<boolean>;
  /** Size and last upload time of the CEP, without loading it; null if none uploaded. */
  getCepInfo(projectId: string): Promise<CepInfo | null>;

  // --- Users & sessions (Phase A) ---

  /** Creates a user; rejects if the username already exists. */
  createUser(input: { username: string; passwordHash: string; email: string | null; termsAcceptedAt?: number | null }): Promise<User>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(userId: string): Promise<User | null>;

  /** Issues an opaque session token for a user and returns the plaintext token. */
  createSession(userId: string): Promise<string>;
  /** Resolves a session token to its user id, or null if unknown/expired or the account is disabled. */
  resolveSession(token: string): Promise<{ userId: string } | null>;
  deleteSession(token: string): Promise<void>;
  /** Revokes every session of a user (password reset). */
  deleteUserSessions(userId: string): Promise<void>;
  /** Also cancels every reset link of the user: an older, leaked one must not work afterwards. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
  /**
   * Deletes an account: its sessions, memberships, assignments, activity, bell read state and reset
   * links. Records it uploaded (and their events) stay in their projects (they belong
   * to the project); its audit entries stay with no actor. Refused, changing nothing, for the
   * last enabled platform admin (counted again inside the deletion, under the lock disableUser
   * takes).
   */
  deleteUser(userId: string): Promise<'ok' | 'last_platform_admin'>;

  // --- Platform administration (dashboard) ---
  // Global, not project-scoped: none of these return project data.

  /** Whether a platform admin exists, enabled or not (first-run setup never opens again). */
  hasPlatformAdmin(): Promise<boolean>;
  /** Enabled platform admins: those who can still run the server. */
  countPlatformAdmins(): Promise<number>;
  /**
   * Disables an account (`disabledBy` = the platform admin doing it): it can no longer log in
   * and its sessions and reset links go. Refused, changing nothing, when it is the last
   * enabled platform admin (checked atomically). 'not_found' for an unknown id.
   */
  disableUser(userId: string, disabledBy: string): Promise<'ok' | 'last_platform_admin' | 'not_found'>;
  /** Enables a disabled account again (it logs in anew). */
  enableUser(userId: string): Promise<'ok' | 'not_found'>;
  /**
   * The server owner's figures (Task 11): totals across projects, each project read under its
   * own RLS setting; projects by id only (§4b).
   */
  platformStats(q: { activeSince: number; signupsFrom: number; receivedFrom: number }): Promise<PlatformStats>;
  /** The database's size, version and the migrations recorded as applied. */
  databaseHealth(): Promise<DatabaseHealth>;
  /**
   * Creates the first platform admin atomically: returns null (and creates nothing)
   * if a platform admin already exists. Throws UsernameTakenError on a duplicate.
   */
  createFirstPlatformAdmin(input: { username: string; passwordHash: string }): Promise<User | null>;
  getSettings(): Promise<ServerSettings>;
  updateSettings(patch: Partial<ServerSettings>): Promise<ServerSettings>;
  /** All accounts with their project count (no project names: §4b). */
  listUsers(): Promise<UserSummary[]>;
  /** Issues a single-use password-reset token and returns the plaintext token; null for a disabled (or unknown) account. */
  createPasswordReset(userId: string, expiresAt: number): Promise<string | null>;
  /** Atomically marks a reset token used; returns its user id, or null if unknown/used/expired. */
  consumePasswordReset(token: string, now: number): Promise<string | null>;

  // --- Memberships (Phase A, tenancy model §4b) ---

  addMembership(projectId: string, userId: string, role: Role): Promise<void>;
  getMembership(projectId: string, userId: string): Promise<TokenMembership | null>;
  listMemberships(userId: string): Promise<Membership[]>;
  listMembers(projectId: string): Promise<Member[]>;
  setMemberRole(projectId: string, userId: string, role: Role): Promise<void>;
  /**
   * Also drops the member's assignments, plot holdings, activity and bell read state in the project;
   * its audit entries there stay with no actor.
   */
  removeMember(projectId: string, userId: string): Promise<void>;
  countAdmins(projectId: string): Promise<number>;
  /** How many projects the user coordinates (admin role). */
  countCoordinatedProjects(userId: string): Promise<number>;

  // --- Invites (Phase A) ---

  /** The new invite's token (shown once) and id (in listings). */
  createInvite(input: CreateInviteInput): Promise<{ token: string; id: string }>;
  getInvite(token: string): Promise<Invite | null>;
  /** Open invites of one project: not revoked, not expired, not exhausted. */
  listInvites(projectId: string, now: number): Promise<InviteSummary[]>;
  /** Revokes an invite of THIS project; returns false if no such open invite in it. */
  revokeInvite(projectId: string, inviteId: string): Promise<boolean>;
  /** Atomically records one use of an invite; returns false if it is exhausted/expired/revoked. */
  consumeInvite(token: string, now: number): Promise<boolean>;

  // --- CSV files & assignments (Phase B) ---

  /**
   * Stores (or replaces, by filename) a plot CSV and returns its metadata. A replaced
   * file keeps its division; given `plotKeys` (the new content's plot ids), holdings
   * of plots no longer in it are dropped.
   */
  putCsvFile(projectId: string, filename: string, data: Buffer, plotKeys?: string[]): Promise<CsvFile>;
  listCsvFiles(projectId: string): Promise<CsvFile[]>;
  /** Counts every plot file's plots again with `keyCount` key columns (a new project file changed it). */
  recountPlots(projectId: string, keyCount: number): Promise<void>;
  getCsvFile(projectId: string, csvFileId: string): Promise<(CsvFile & { data: Buffer }) | null>;

  /** Replaces the project's whole assignment set with the given pairs (pairs of divided files are ignored). */
  setAssignments(projectId: string, assignments: Assignment[]): Promise<void>;
  listAssignments(projectId: string): Promise<AssignmentDetail[]>;
  listAssignmentsForUser(projectId: string, userId: string): Promise<CsvFile[]>;
  isAssigned(projectId: string, csvFileId: string, userId: string): Promise<boolean>;

  /**
   * Divides a file (distribution set): its holdings become `plots` and its whole-file
   * assignments are deleted. With null the file is whole again and its holdings go.
   */
  setDivision(projectId: string, csvFileId: string, distribution: StoredDistribution | null, plots: PlotAssignment[]): Promise<void>;
  /** Who holds which plot of a file (a copy drawn by the check sampling with its sampledAt). */
  listPlotAssignments(projectId: string, csvFileId: string): Promise<PlotAssignment[]>;

  // --- Check sampling (Task 13: sampling_rules, plot_assignments.sampled_at) ---

  /** The project's sampling rule and its draws' state (nothing stored: no rule). */
  getSampling(projectId: string): Promise<SamplingState>;
  /**
   * Stores the rule (`active`: it can draw something). A draw due stays due while it is
   * active; saving makes none due ("Draw now" applies it to the plots already submitted).
   */
  setSamplingRule(projectId: string, rule: SamplingRule, active: boolean): Promise<void>;
  /**
   * The intake's coalescing, in one statement: with `markDue`, a draw becomes due (when the
   * rule is active and none is due yet). Claims the automatic draw (true) when one is due and
   * the last automatic one is at least `minIntervalMs` old, and records it as started now; so
   * at most one automatic draw per project per interval, across server instances.
   */
  claimSamplingDraw(projectId: string, q: { now: number; markDue: boolean; minIntervalMs: number }): Promise<boolean>;
  /**
   * Adds drawn copies (overlap, sampled_at = draw.at) in one transaction, under the project's
   * sampling lock, each only while its file is divided, its holder a member, the plot has no
   * copy in the file and the holder does not hold it yet; then keeps the draw (its counts are
   * those of the copies added) and ends a due draw that started at or before `dueBefore`.
   * Gives the copies added.
   */
  addSampledCopies(projectId: string, copies: readonly SampledCopy[], draw: SamplingDraw, dueBefore: number): Promise<SampledCopy[]>;
  /**
   * The divided files where the user holds plots, with those plots, by filename.
   * `copyKeys` are the ones among them given as quality-check copies (overlap).
   */
  listPlotHoldings(projectId: string, userId: string): Promise<({ csvFileId: string } & UserPlots)[]>;
  /**
   * Every holding (main and quality-check copy) of the project's divided files, in
   * one list: for copyHoldersOf across files (the export).
   */
  listDividedHoldings(projectId: string): Promise<PlotAssignment[]>;
  /** Who holds some plots (main or copy) in some plot files, divided or not: the plot page's people. */
  listPlotHolders(projectId: string, csvFileIds: readonly string[], plotKeys: readonly string[]): Promise<(PlotAssignment & { csvFileId: string })[]>;
  /** How many people hold at least one plot, by csv file id (divided files only). */
  countPlotHolders(projectId: string): Promise<Map<string, number>>;
  /** The user's plots of one divided file (none for a whole file), and which of them are copies. */
  listUserPlots(projectId: string, csvFileId: string, userId: string): Promise<UserPlots>;

  getRecord(projectId: string, recordKey: string, operator: string): Promise<RecordRow | null>;
  putRecord(row: RecordRow): Promise<void>;
  /**
   * Moves the record (recordKey, from) to (recordKey, to), in one transaction. When
   * (recordKey, to) exists too, the newer one (modifiedOn; the `to` row on a tie) is
   * kept under `to` and the other deleted. False when there is no (recordKey, from).
   */
  renameRecordOperator(projectId: string, recordKey: string, from: string, to: string): Promise<boolean>;

  /** All records for a project (deleted excluded unless includeDeleted). For stats/export/tests. */
  listRecords(projectId: string, includeDeleted?: boolean): Promise<RecordRow[]>;
  /**
   * As listRecords without deleted ones and with xml left null: for the overview and the
   * export. With firstSubmissions, each record also says when it was first submitted
   * (firstSubmittedOn, as listRecordStates): for the quality figures' pattern flags.
   */
  listRecordSummaries(projectId: string, options?: { firstSubmissions?: boolean }): Promise<RecordRow[]>;
  /**
   * Some records by key and operator, with their summaries and without XML (deleted ones
   * too; those that do not exist are left out): the review queue's plots beyond the listed
   * differences, in one read.
   */
  getRecordSummaries(projectId: string, keys: readonly { recordKey: string; operator: string }[]): Promise<RecordRow[]>;
  /**
   * Every record (any operator) whose key is one of `recordKeys`, with its summary and without
   * XML, deleted ones too: one plot's records for the plot page (rounds.recordKeysOfUnit), in
   * one read of the primary key.
   */
  listRecordsByKeys(projectId: string, recordKeys: readonly string[]): Promise<RecordRow[]>;

  /**
   * Which records there are, whether each is submitted and when it was first submitted
   * (deleted ones left out; no answers): for the Progress tab.
   */
  listRecordStates(projectId: string): Promise<RecordState[]>;

  // --- Quality review (decisions, notes, margins) ---

  /**
   * Changes whenever the records or the divided files' holdings change: with the round
   * info, the CEP, the plot files and the settings, the version of the quality figures'
   * inputs (their cache key). Cheap: no records are loaded.
   */
  qualityVersion(projectId: string): Promise<string>;
  /**
   * How another thread can read this store's records itself (a quality figures worker):
   * the database URL, or null when only this thread holds them (the memory store).
   */
  recordsSource(): { databaseUrl: string } | null;
  /** The settings, `{ margins: {} }` when none were saved. */
  getQualitySettings(projectId: string): Promise<QualitySettings>;
  setQualitySettings(projectId: string, settings: QualitySettings): Promise<void>;
  /** Replaces the settings given (margins as a whole, fastSeconds) and keeps the others, in one write; gives them all as stored. */
  patchQualitySettings(projectId: string, patch: Partial<QualitySettings>): Promise<QualitySettings>;
  /** The project's AI assistant switch (off by default; false for an unknown project). */
  isAiEnabled(projectId: string): Promise<boolean>;
  setAiEnabled(projectId: string, enabled: boolean): Promise<void>;
  listQualityDecisions(projectId: string): Promise<QualityDecision[]>;
  /** Sets (or replaces) the decision on a plot unit. `userId` null for a project token. */
  setQualityDecision(
    projectId: string,
    plot: string,
    decision: DecisionKind,
    comment: string | null,
    userId: string | null,
    seen?: { operator: string; hash: number; full?: number }[] | null,
  ): Promise<QualityDecision>;
  /**
   * Decides several plots at once (the bulk decisions), in one transaction: each plot only
   * when it has no decision yet (one made meanwhile is kept). Gives the plots decided.
   */
  addQualityDecisions(
    projectId: string,
    decisions: readonly { plot: string; decision: DecisionKind; seen: { operator: string; hash: number; full?: number }[] | null }[],
    comment: string | null,
    userId: string | null,
    batch: string,
  ): Promise<string[]>;
  /** False when the plot had no decision. */
  deleteQualityDecision(projectId: string, plot: string): Promise<boolean>;
  listGuidanceNotes(projectId: string): Promise<GuidanceNote[]>;
  createGuidanceNote(projectId: string, note: GuidanceNoteInput, userId: string | null): Promise<GuidanceNote>;
  /** Null when the project has no note with that id. */
  updateGuidanceNote(projectId: string, id: string, note: GuidanceNoteInput, userId: string | null): Promise<GuidanceNote | null>;
  /** False when the project has no note with that id. */
  deleteGuidanceNote(projectId: string, id: string): Promise<boolean>;

  // --- The AI assistant's runs (ai_runs) ---

  /**
   * Starts a run if the limits allow it, atomically per project (two requests at once
   * cannot both pass): rows still running that started before `window.staleBefore` are
   * failed as `interrupted` first, then the limits are checked in AiRunWindow's order
   * (aiLimitReached), then the run is stored as running with `startedAt = window.now`.
   */
  startAiRun(projectId: string, start: AiRunStart, window: AiRunWindow): Promise<AiRunStartResult>;
  /** Stores a running run's progress (tokens, tool calls); nothing when it is no longer running. */
  updateAiRun(projectId: string, runId: string, progress: AiRunProgress): Promise<void>;
  /** Ends a running run; false (and nothing changed) when it is no longer running. */
  finishAiRun(projectId: string, runId: string, end: AiRunEnd): Promise<boolean>;
  /**
   * Fails the runs still running that started before `before` (crashed or cut off) with
   * `code` and `message`, of one project. How many.
   */
  failStaleAiRuns(projectId: string, before: number, code: string, message: string, now: number): Promise<number>;
  /** The project's runs, newest first, at most `limit`. */
  listAiRuns(projectId: string, limit: number): Promise<AiRunSummary[]>;
  /** Null when the project has no run with that id. */
  getAiRun(projectId: string, runId: string): Promise<AiRunRow | null>;
  /** Every project's AI use for runs started at or after `from`, by project id only; projects without runs are left out. */
  aiUsageSince(from: number): Promise<AiUsage[]>;

  // --- Activity data (record_events, member_activity, audit_log) ---

  /**
   * Stores an upload of the record (projectId, recordKey, operator) and its event in one
   * transaction. Uploads of the same record are serialised: `apply` gets the row stored
   * before (read under a lock) and whether the record was ever submitted (an event
   * `submitted` or `resubmitted`), and gives the row to store with its event (null for
   * none), or null to store nothing (stale). True when stored.
   */
  putRecordWithEvent(
    projectId: string,
    recordKey: string,
    operator: string,
    apply: (existing: RecordRow | null, submittedBefore: boolean) => { row: RecordRow; event: RecordEventInput | null } | null,
  ): Promise<boolean>;
  /** Logs one record event by itself (putRecordWithEvent is the intake's way). */
  appendRecordEvent(event: RecordEventInput): Promise<void>;
  /**
   * The project's record events in the query's window, newest first (modifiedOn, then
   * id). Throws InvalidCursorError for a `before` that is no cursor (checkCursor).
   */
  listRecordEvents(projectId: string, query: RecordEventQuery): Promise<RecordEvent[]>;
  /**
   * The record events with modifiedOn in [from, to), counted by person, change and quarter of an
   * hour (the daily activity download: the days are worked out in the viewer's zone from these).
   */
  recordEventCounts(projectId: string, query: { from: number; to: number }): Promise<RecordEventCount[]>;
  /**
   * Adds to a member's activity (MemberActivityPatch), creating the row on first use.
   * Nothing for a user who is not a member of the project (removed meanwhile).
   */
  touchMemberActivity(projectId: string, userId: string, patch: MemberActivityPatch): Promise<void>;
  /** The activity of the project's members who have any, by user id. */
  listMemberActivity(projectId: string): Promise<MemberActivity[]>;
  /**
   * Per operator, the median of receivedAt − modifiedOn over their record events
   * received at or after `since` (deletions left out): how long saved work waits before
   * it reaches the server.
   */
  unsentDelays(projectId: string, since: number): Promise<{ operator: string; medianMs: number; uploads: number }[]>;
  /** The progress settings; DEFAULT_PROGRESS_SETTINGS when none were saved. */
  getProgressSettings(projectId: string): Promise<ProgressSettings>;
  setProgressSettings(projectId: string, settings: ProgressSettings): Promise<void>;
  /** Logs a coordinator action at the current time. */
  appendAudit(projectId: string, entry: AuditInput): Promise<void>;
  /** The project's audit log, newest first (at, then id). Throws InvalidCursorError as listRecordEvents. */
  listAudit(projectId: string, query: AuditQuery): Promise<AuditEntry[]>;

  // --- The bell: which "needs attention" items each coordinator has read (attention_reads) ---

  /** The keys of the items the member has read (an item's key changes with its content). */
  listAttentionReads(projectId: string, userId: string): Promise<string[]>;
  /** Replaces the member's read keys with these (nothing for someone not a member). */
  setAttentionReads(projectId: string, userId: string, keys: readonly string[]): Promise<void>;

  close(): Promise<void>;
}

/** A page cursor that is not one: its id is not a whole number, or its time not a number. */
export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

/** The earliest time Postgres's timestamptz holds (4714-11-24 BC), in ms since 1970. */
export const MIN_STORED_TIME = -210_866_803_200_000;
/** The latest time a JS Date holds (Postgres holds later ones). */
export const MAX_STORED_TIME = 8.64e15;

/** Whether a time (ms) is one both a JS Date and Postgres's timestamptz hold. */
export function isStoredTime(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= MIN_STORED_TIME && ms <= MAX_STORED_TIME && !Number.isNaN(new Date(ms).getTime());
}

/**
 * Both stores check a cursor the same way before using it (ids are BIGSERIAL), and its time
 * and a window's bounds against what timestamptz holds (Postgres would refuse it with a 500).
 */
export function checkCursor(cursor: EventCursor | undefined, window: { from?: number; to?: number } = {}): void {
  if (cursor !== undefined && (!/^\d{1,18}$/.test(cursor.id) || !isStoredTime(cursor.at))) {
    throw new InvalidCursorError();
  }
  for (const t of [window.from, window.to]) {
    if (t !== undefined && !isStoredTime(t)) throw new InvalidCursorError();
  }
}
