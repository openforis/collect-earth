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
  CepInfo,
  CsvFile,
  DecisionKind,
  GuidanceNote,
  GuidanceNoteInput,
  Invite,
  InviteSummary,
  Member,
  Membership,
  PlotAssignment,
  ProjectRow,
  ProjectStorage,
  QualityDecision,
  QualitySettings,
  RecordRow,
  RoundInfo,
  Role,
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
   * invites, memberships and its Phase-0 tokens. One transaction (Postgres).
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
  /** Resolves a session token to its user id, or null if unknown/expired. */
  resolveSession(token: string): Promise<{ userId: string } | null>;
  deleteSession(token: string): Promise<void>;
  /** Revokes every session of a user (password reset). */
  deleteUserSessions(userId: string): Promise<void>;
  /** Also cancels every reset link of the user: an older, leaked one must not work afterwards. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
  /**
   * Deletes an account: its sessions, memberships, assignments and reset links.
   * Records it uploaded stay in their projects (they belong to the project).
   */
  deleteUser(userId: string): Promise<void>;

  // --- Platform administration (dashboard) ---
  // Global, not project-scoped: none of these return project data.

  hasPlatformAdmin(): Promise<boolean>;
  countPlatformAdmins(): Promise<number>;
  /**
   * Creates the first platform admin atomically: returns null (and creates nothing)
   * if a platform admin already exists. Throws UsernameTakenError on a duplicate.
   */
  createFirstPlatformAdmin(input: { username: string; passwordHash: string }): Promise<User | null>;
  getSettings(): Promise<ServerSettings>;
  updateSettings(patch: Partial<ServerSettings>): Promise<ServerSettings>;
  /** All accounts with their project count (no project names: §4b). */
  listUsers(): Promise<UserSummary[]>;
  /** Issues a single-use password-reset token and returns the plaintext token. */
  createPasswordReset(userId: string, expiresAt: number): Promise<string>;
  /** Atomically marks a reset token used; returns its user id, or null if unknown/used/expired. */
  consumePasswordReset(token: string, now: number): Promise<string | null>;

  // --- Memberships (Phase A, tenancy model §4b) ---

  addMembership(projectId: string, userId: string, role: Role): Promise<void>;
  getMembership(projectId: string, userId: string): Promise<TokenMembership | null>;
  listMemberships(userId: string): Promise<Membership[]>;
  listMembers(projectId: string): Promise<Member[]>;
  setMemberRole(projectId: string, userId: string, role: Role): Promise<void>;
  /** Also drops the member's assignments and plot holdings in the project. */
  removeMember(projectId: string, userId: string): Promise<void>;
  countAdmins(projectId: string): Promise<number>;
  /** How many projects the user coordinates (admin role). */
  countCoordinatedProjects(userId: string): Promise<number>;

  // --- Invites (Phase A) ---

  createInvite(input: CreateInviteInput): Promise<string>;
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
  /** Who holds which plot of a file. */
  listPlotAssignments(projectId: string, csvFileId: string): Promise<PlotAssignment[]>;
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
  /** As listRecords without deleted ones and with xml left null: for the overview and the export. */
  listRecordSummaries(projectId: string): Promise<RecordRow[]>;

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
  /** The project's AI assistant switch (off by default; false for an unknown project). */
  isAiEnabled(projectId: string): Promise<boolean>;
  setAiEnabled(projectId: string, enabled: boolean): Promise<void>;
  listQualityDecisions(projectId: string): Promise<QualityDecision[]>;
  /** Sets (or replaces) the decision on a plot unit. `userId` null for a project token. */
  setQualityDecision(projectId: string, plot: string, decision: DecisionKind, comment: string | null, userId: string | null): Promise<QualityDecision>;
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
   * `code` and `message`: of one project, or of every project with null. How many.
   */
  failStaleAiRuns(projectId: string | null, before: number, code: string, message: string, now: number): Promise<number>;
  /** The project's runs, newest first, at most `limit`. */
  listAiRuns(projectId: string, limit: number): Promise<AiRunSummary[]>;
  /** Null when the project has no run with that id. */
  getAiRun(projectId: string, runId: string): Promise<AiRunRow | null>;
  /** Every project's AI use for runs started at or after `from`, by project id only; projects without runs are left out. */
  aiUsageSince(from: number): Promise<AiUsage[]>;

  close(): Promise<void>;
}
