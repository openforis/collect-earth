import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from '../auth.js';
import { legacyRoundInfo } from '../cep.js';
import { checksumOf, plotCountOf } from '../csv.js';
import { fileKeyCount } from '../rounds.js';
import {
  AI_INTERRUPTED,
  aiLimitReached,
  DEFAULT_PROGRESS_SETTINGS,
  DEFAULT_SETTINGS,
  type AiRunEnd,
  type AiRunProgress,
  type AiRunRow,
  type AiRunStart,
  type AiRunStartResult,
  type AiRunSummary,
  type AiRunWindow,
  type AiUsage,
  type Assignment,
  type AssignmentDetail,
  type AuditEntry,
  type AuditInput,
  type AuditQuery,
  type CepInfo,
  type EventCursor,
  type CsvFile,
  type DecisionKind,
  type GuidanceNote,
  type GuidanceNoteInput,
  type Invite,
  type InviteSummary,
  type Member,
  type MemberActivity,
  type MemberActivityPatch,
  type Membership,
  type PlotAssignment,
  type ProgressSettings,
  type ProjectRow,
  type ProjectStorage,
  type QualityDecision,
  type QualitySettings,
  type RecordEvent,
  type RecordEventInput,
  type RecordEventQuery,
  type RecordRow,
  type RecordState,
  type RoundInfo,
  type Role,
  type ServerSettings,
  type StoredDistribution,
  type User,
  type UserSummary,
} from '../types.js';
import { checkCursor, type CreateInviteInput, type CreateProjectResult, type Store, type TokenMembership, type UserPlots } from './store.js';

interface CsvFileEntry extends CsvFile {
  data: Buffer;
  distribution: StoredDistribution | null;
}

interface ProjectEntry {
  project: ProjectRow;
  records: Map<string, RecordRow>; // key = recordKey + ' ' + operator
  cep: Buffer | null;
  cepUpdatedAt: number | null;
  /** The upload, when the server serves a changed copy of it. */
  cepOriginal: Buffer | null;
  roundInfo: RoundInfo | null;
  csvFiles: Map<string, CsvFileEntry>; // key = csvFileId
  assignments: Set<string>; // `${userId} ${csvFileId}`
  plotAssignments: Map<string, PlotAssignment[]>; // key = csvFileId (divided files)
  /** Bumped on every stored record / every change of the holdings (qualityVersion). */
  recordsGeneration: number;
  holdingsGeneration: number;
  qualitySettings: QualitySettings | null;
  progressSettings: ProgressSettings | null;
  aiEnabled: boolean;
  /** Oldest first; `startedBy` holds the user id (the username is read when listed). */
  aiRuns: AiRunRow[];
  decisions: Map<string, StoredDecision>; // key = plot
  notes: Map<string, StoredNote>; // key = id
  /** Oldest first (by id). */
  recordEvents: RecordEvent[];
  memberActivity: Map<string, MemberActivity>; // key = userId
  /** Oldest first (by id); `actorUserId` is set to null when the actor leaves (removeMember, deleteUser). */
  audit: Omit<AuditEntry, 'actor'>[];
}

interface StoredDecision {
  decision: DecisionKind;
  comment: string | null;
  decidedBy: string | null; // user id
  decidedAt: number;
  seen: { operator: string; hash: number }[] | null;
}

interface StoredNote extends GuidanceNoteInput {
  id: string;
  updatedBy: string | null; // user id
  updatedAt: number;
}

interface InviteEntry {
  id: string;
  projectId: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

interface ResetEntry {
  userId: string;
  expiresAt: number;
  usedAt: number | null;
}

/**
 * Non-persistent Store used for local development and the test suite. It holds
 * the exact same tenant semantics as the Postgres store so the isolation tests
 * exercise the real authorization path.
 */
export class InMemoryStore implements Store {
  private readonly projects = new Map<string, ProjectEntry>();
  private readonly tokens = new Map<string, TokenMembership>(); // key = project token hash

  private readonly users = new Map<string, User>(); // key = userId
  private readonly usersByName = new Map<string, string>(); // username -> userId
  /** Usernames of deleted accounts with records in one of their projects: never given out again (records keep the name). */
  private readonly retiredUsernames = new Set<string>();
  private readonly sessions = new Map<string, string>(); // session token hash -> userId
  private readonly memberships = new Map<string, Role>(); // `${projectId} ${userId}` -> role
  private readonly invites = new Map<string, InviteEntry>(); // invite token hash -> entry
  private readonly resets = new Map<string, ResetEntry>(); // reset token hash -> entry
  private settings: ServerSettings = { ...DEFAULT_SETTINGS };
  /** Ids of record events and audit entries: increasing, as Postgres's BIGSERIAL. */
  private nextEventId = 1;

  private static recordId(recordKey: string, operator: string): string {
    return `${recordKey} ${operator}`;
  }

  private static memberId(projectId: string, userId: string): string {
    return `${projectId} ${userId}`;
  }

  async createProject(input: { name: string }): Promise<CreateProjectResult> {
    const projectId = randomUUID();
    const project: ProjectRow = {
      projectId,
      name: input.name,
      surveyUri: null,
      surveyName: null,
      idmlBase64: null,
    };
    this.projects.set(projectId, {
      project,
      records: new Map(),
      cep: null,
      cepUpdatedAt: null,
      cepOriginal: null,
      roundInfo: null,
      csvFiles: new Map(),
      assignments: new Set(),
      plotAssignments: new Map(),
      recordsGeneration: 0,
      holdingsGeneration: 0,
      qualitySettings: null,
      progressSettings: null,
      aiEnabled: false,
      aiRuns: [],
      decisions: new Map(),
      notes: new Map(),
      recordEvents: [],
      memberActivity: new Map(),
      audit: [],
    });

    const adminToken = generateToken();
    const projectToken = generateToken();
    this.tokens.set(hashToken(adminToken), { projectId, role: 'admin' });
    this.tokens.set(hashToken(projectToken), { projectId, role: 'operator' });

    return { projectId, adminToken, projectToken };
  }

  async getProject(projectId: string): Promise<ProjectRow | null> {
    return this.projects.get(projectId)?.project ?? null;
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    this.requireProject(projectId).project.name = name;
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
    for (const [hash, t] of this.tokens) {
      if (t.projectId === projectId) {
        this.tokens.delete(hash);
      }
    }
    for (const key of this.memberships.keys()) {
      if (key.startsWith(`${projectId} `)) {
        this.memberships.delete(key);
      }
    }
    for (const [hash, invite] of this.invites) {
      if (invite.projectId === projectId) {
        this.invites.delete(hash);
      }
    }
  }

  async getProjectStorage(projectId: string): Promise<ProjectStorage> {
    const entry = this.projects.get(projectId);
    const storage: ProjectStorage = { cepBytes: 0, csvBytesByFilename: {}, recordBytes: 0 };
    if (!entry) {
      return storage;
    }
    storage.cepBytes = (entry.cep?.length ?? 0) + (entry.cepOriginal?.length ?? 0);
    for (const f of entry.csvFiles.values()) {
      storage.csvBytesByFilename[f.filename] = f.data.length;
    }
    for (const r of entry.records.values()) {
      storage.recordBytes += Buffer.byteLength(r.xml ?? '', 'utf8') + Buffer.byteLength(JSON.stringify(r.summary), 'utf8');
    }
    return storage;
  }

  async resolveToken(token: string): Promise<TokenMembership | null> {
    return this.tokens.get(hashToken(token)) ?? null;
  }

  async setSurvey(projectId: string, surveyUri: string, surveyName: string | null, idmlBase64: string): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.project.surveyUri = surveyUri;
    entry.project.surveyName = surveyName;
    entry.project.idmlBase64 = idmlBase64;
  }

  async putCep(projectId: string, served: Buffer, info: RoundInfo, original: Buffer | null): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.cep = Buffer.from(served);
    entry.cepOriginal = original === null ? null : Buffer.from(original);
    entry.roundInfo = structuredClone(info);
    entry.cepUpdatedAt = Date.now();
  }

  async getOriginalCep(projectId: string): Promise<Buffer | null> {
    const entry = this.projects.get(projectId);
    return entry?.cepOriginal ?? entry?.cep ?? null;
  }

  async getRoundInfo(projectId: string): Promise<RoundInfo | null> {
    const entry = this.projects.get(projectId);
    if (entry && !entry.roundInfo && entry.cep) {
      // A project file stored before round info was kept: read it once, as postgres.ts does.
      const info = legacyRoundInfo(entry.cep);
      if (info) {
        entry.roundInfo = info;
        if (fileKeyCount(info) !== 1) await this.recountPlots(projectId, fileKeyCount(info));
      }
    }
    const info = entry?.roundInfo;
    return info ? structuredClone(info) : null;
  }

  async setReassessmentCode(projectId: string, code: string | null): Promise<void> {
    const entry = this.projects.get(projectId);
    if (entry?.roundInfo) entry.roundInfo.reassessmentCode = code;
  }

  async hasRecords(projectId: string): Promise<boolean> {
    return (this.projects.get(projectId)?.records.size ?? 0) > 0;
  }

  async getCepInfo(projectId: string): Promise<CepInfo | null> {
    const entry = this.projects.get(projectId);
    if (!entry?.cep) {
      return null;
    }
    return { bytes: entry.cep.length, updatedAt: entry.cepUpdatedAt ?? 0 };
  }

  async getCep(projectId: string): Promise<Buffer | null> {
    return this.projects.get(projectId)?.cep ?? null;
  }

  async getRecord(projectId: string, recordKey: string, operator: string): Promise<RecordRow | null> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return null;
    }
    return entry.records.get(InMemoryStore.recordId(recordKey, operator)) ?? null;
  }

  async putRecord(row: RecordRow): Promise<void> {
    const entry = this.requireProject(row.projectId);
    entry.records.set(InMemoryStore.recordId(row.recordKey, row.operator), { ...row });
    entry.recordsGeneration += 1;
  }

  async renameRecordOperator(projectId: string, recordKey: string, from: string, to: string): Promise<boolean> {
    const entry = this.projects.get(projectId);
    const old = entry?.records.get(InMemoryStore.recordId(recordKey, from));
    if (!entry || !old || from === to) {
      return false;
    }
    const current = entry.records.get(InMemoryStore.recordId(recordKey, to));
    entry.records.delete(InMemoryStore.recordId(recordKey, from));
    if (!current || old.modifiedOn > current.modifiedOn) {
      entry.records.set(InMemoryStore.recordId(recordKey, to), { ...old, operator: to });
    }
    entry.recordsGeneration += 1;
    return true;
  }

  async listRecords(projectId: string, includeDeleted = false): Promise<RecordRow[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    return [...entry.records.values()].filter((r) => includeDeleted || !r.deleted);
  }

  async listRecordSummaries(projectId: string, options: { firstSubmissions?: boolean } = {}): Promise<RecordRow[]> {
    const rows = (await this.listRecords(projectId)).map((r) => ({ ...r, xml: null }));
    if (!options.firstSubmissions) return rows;
    const first = this.firstSubmissions(projectId);
    return rows.map((r) => ({ ...r, firstSubmittedOn: first.get(`${r.recordKey} ${r.operator}`) ?? null }));
  }

  /** `${recordKey} ${operator}` -> the modifiedOn of its first event `submitted`. */
  private firstSubmissions(projectId: string): Map<string, number> {
    const first = new Map<string, number>();
    for (const e of this.projects.get(projectId)?.recordEvents ?? []) {
      if (e.change === 'submitted') {
        const key = `${e.recordKey} ${e.operator}`;
        first.set(key, Math.min(first.get(key) ?? Infinity, e.modifiedOn));
      }
    }
    return first;
  }

  async listRecordStates(projectId: string): Promise<RecordState[]> {
    const first = this.firstSubmissions(projectId);
    return (await this.listRecords(projectId)).map((r) => ({
      recordKey: r.recordKey,
      operator: r.operator,
      activelySaved: r.activelySaved,
      deleted: r.deleted,
      modifiedOn: r.modifiedOn,
      firstSubmittedOn: first.get(`${r.recordKey} ${r.operator}`) ?? null,
    }));
  }

  // --- Users & sessions ---

  async createUser(input: {
    username: string;
    passwordHash: string;
    email: string | null;
    termsAcceptedAt?: number | null;
  }): Promise<User> {
    return this.insertUser({ ...input, termsAcceptedAt: input.termsAcceptedAt ?? null, isPlatformAdmin: false });
  }

  private insertUser(input: Omit<User, 'id'>): User {
    if (this.usersByName.has(input.username) || this.retiredUsernames.has(input.username)) {
      throw new UsernameTakenError(input.username);
    }
    const user: User = { id: randomUUID(), ...input };
    this.users.set(user.id, user);
    this.usersByName.set(user.username, user.id);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const id = this.usersByName.get(username);
    return id ? this.users.get(id) ?? null : null;
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }

  async createSession(userId: string): Promise<string> {
    const token = generateToken();
    this.sessions.set(hashToken(token), userId);
    return token;
  }

  async resolveSession(token: string): Promise<{ userId: string } | null> {
    const userId = this.sessions.get(hashToken(token));
    return userId ? { userId } : null;
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(hashToken(token));
  }

  async deleteUserSessions(userId: string): Promise<void> {
    for (const [hash, owner] of this.sessions) {
      if (owner === userId) {
        this.sessions.delete(hash);
      }
    }
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.passwordHash = passwordHash;
    }
    for (const [hash, reset] of this.resets) {
      if (reset.userId === userId) {
        this.resets.delete(hash);
      }
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      return;
    }
    await this.deleteUserSessions(userId);
    let hasRecords = false;
    for (const key of this.memberships.keys()) {
      if (key.endsWith(` ${userId}`)) {
        const entry = this.projects.get(key.slice(0, -userId.length - 1));
        hasRecords ||= [...(entry?.records.values() ?? [])].some((r) => r.operator === user.username);
        this.memberships.delete(key);
      }
    }
    for (const entry of this.projects.values()) {
      for (const a of entry.assignments) {
        if (a.startsWith(`${userId} `)) {
          entry.assignments.delete(a);
        }
      }
      InMemoryStore.dropPlotAssignments(entry, userId);
      // member_activity goes with the account; audit_log.actor_user_id is ON DELETE SET NULL.
      InMemoryStore.dropActivity(entry, userId);
      // decided_by / updated_by are ON DELETE SET NULL.
      for (const d of entry.decisions.values()) {
        if (d.decidedBy === userId) d.decidedBy = null;
      }
      for (const n of entry.notes.values()) {
        if (n.updatedBy === userId) n.updatedBy = null;
      }
    }
    for (const [hash, reset] of this.resets) {
      if (reset.userId === userId) {
        this.resets.delete(hash);
      }
    }
    this.usersByName.delete(user.username);
    if (hasRecords) {
      this.retiredUsernames.add(user.username);
    }
    this.users.delete(userId);
  }

  // --- Platform administration ---

  async hasPlatformAdmin(): Promise<boolean> {
    return [...this.users.values()].some((u) => u.isPlatformAdmin);
  }

  async countPlatformAdmins(): Promise<number> {
    return [...this.users.values()].filter((u) => u.isPlatformAdmin).length;
  }

  async createFirstPlatformAdmin(input: { username: string; passwordHash: string }): Promise<User | null> {
    // Single-threaded: the check and the insert cannot interleave with another setup.
    if (await this.hasPlatformAdmin()) {
      return null;
    }
    return this.insertUser({ ...input, email: null, termsAcceptedAt: null, isPlatformAdmin: true });
  }

  async getSettings(): Promise<ServerSettings> {
    return { ...this.settings };
  }

  async updateSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
    this.settings = { ...this.settings, ...patch };
    return { ...this.settings };
  }

  async listUsers(): Promise<UserSummary[]> {
    const counts = new Map<string, number>();
    const coordinated = new Map<string, number>();
    for (const [key, role] of this.memberships) {
      const userId = key.split(' ')[1];
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
      if (role === 'admin') {
        coordinated.set(userId, (coordinated.get(userId) ?? 0) + 1);
      }
    }
    return [...this.users.values()]
      .map((u) => ({
        userId: u.id,
        username: u.username,
        isPlatformAdmin: u.isPlatformAdmin,
        projects: counts.get(u.id) ?? 0,
        coordinatedProjects: coordinated.get(u.id) ?? 0,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  async createPasswordReset(userId: string, expiresAt: number): Promise<string> {
    const token = generateToken();
    this.resets.set(hashToken(token), { userId, expiresAt, usedAt: null });
    return token;
  }

  async consumePasswordReset(token: string, now: number): Promise<string | null> {
    const entry = this.resets.get(hashToken(token));
    if (!entry || entry.usedAt !== null || entry.expiresAt <= now || !this.users.has(entry.userId)) {
      return null;
    }
    entry.usedAt = now;
    return entry.userId;
  }

  // --- Memberships ---

  async addMembership(projectId: string, userId: string, role: Role): Promise<void> {
    this.memberships.set(InMemoryStore.memberId(projectId, userId), role);
  }

  async getMembership(projectId: string, userId: string): Promise<TokenMembership | null> {
    const role = this.memberships.get(InMemoryStore.memberId(projectId, userId));
    return role ? { projectId, role } : null;
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    const result: Membership[] = [];
    for (const [key, role] of this.memberships) {
      const [projectId, memberUserId] = key.split(' ');
      if (memberUserId === userId) {
        const project = this.projects.get(projectId)?.project;
        if (project) {
          result.push({ projectId, projectName: project.name, role });
        }
      }
    }
    return result;
  }

  async listMembers(projectId: string): Promise<Member[]> {
    const result: Member[] = [];
    for (const [key, role] of this.memberships) {
      const [memberProjectId, userId] = key.split(' ');
      if (memberProjectId === projectId) {
        const user = this.users.get(userId);
        if (user) {
          result.push({ userId, username: user.username, role });
        }
      }
    }
    return result;
  }

  async setMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
    const id = InMemoryStore.memberId(projectId, userId);
    if (this.memberships.has(id)) {
      this.memberships.set(id, role);
    }
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    this.memberships.delete(InMemoryStore.memberId(projectId, userId));
    const entry = this.projects.get(projectId);
    if (entry) {
      for (const a of entry.assignments) {
        if (a.startsWith(`${userId} `)) {
          entry.assignments.delete(a);
        }
      }
      InMemoryStore.dropPlotAssignments(entry, userId);
      InMemoryStore.dropActivity(entry, userId);
    }
  }

  /** The member's activity goes; their audit entries stay, with no actor. */
  private static dropActivity(entry: ProjectEntry, userId: string): void {
    entry.memberActivity.delete(userId);
    for (const e of entry.audit) {
      if (e.actorUserId === userId) e.actorUserId = null;
    }
  }

  private static dropPlotAssignments(entry: ProjectEntry, userId: string): void {
    for (const [csvFileId, list] of entry.plotAssignments) {
      entry.plotAssignments.set(csvFileId, list.filter((a) => a.userId !== userId));
    }
    entry.holdingsGeneration += 1;
  }

  async countAdmins(projectId: string): Promise<number> {
    let count = 0;
    for (const [key, role] of this.memberships) {
      if (key.startsWith(`${projectId} `) && role === 'admin') {
        count += 1;
      }
    }
    return count;
  }

  async countCoordinatedProjects(userId: string): Promise<number> {
    let count = 0;
    for (const [key, role] of this.memberships) {
      if (key.endsWith(` ${userId}`) && role === 'admin') {
        count += 1;
      }
    }
    return count;
  }

  // --- Invites ---

  async createInvite(input: CreateInviteInput): Promise<{ token: string; id: string }> {
    // As Postgres' invites.created_by REFERENCES users(id): a user, or nobody.
    if (input.createdBy !== null && !this.users.has(input.createdBy)) {
      throw new Error('invites.created_by must be a user id or null');
    }
    const token = generateToken();
    const id = randomUUID();
    this.invites.set(hashToken(token), {
      id,
      projectId: input.projectId,
      role: input.role,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
      createdAt: Date.now(),
      revokedAt: null,
    });
    return { token, id };
  }

  async getInvite(token: string): Promise<Invite | null> {
    const entry = this.invites.get(hashToken(token));
    if (!entry) {
      return null;
    }
    const project = this.projects.get(entry.projectId)?.project;
    if (!project) {
      return null;
    }
    return {
      projectId: entry.projectId,
      projectName: project.name,
      role: entry.role,
      maxUses: entry.maxUses,
      usedCount: entry.usedCount,
      expiresAt: entry.expiresAt,
      revoked: entry.revokedAt !== null,
    };
  }

  async listInvites(projectId: string, now: number): Promise<InviteSummary[]> {
    return [...this.invites.values()]
      .filter((e) => e.projectId === projectId && isOpen(e, now))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => ({
        id: e.id,
        role: e.role,
        maxUses: e.maxUses,
        usedCount: e.usedCount,
        expiresAt: e.expiresAt,
        createdAt: e.createdAt,
      }));
  }

  async revokeInvite(projectId: string, inviteId: string): Promise<boolean> {
    for (const entry of this.invites.values()) {
      // Matching on projectId too: an id from another project is "not found" here.
      if (entry.id === inviteId && entry.projectId === projectId && entry.revokedAt === null) {
        entry.revokedAt = Date.now();
        return true;
      }
    }
    return false;
  }

  async consumeInvite(token: string, now: number): Promise<boolean> {
    const entry = this.invites.get(hashToken(token));
    if (!entry || entry.revokedAt !== null) {
      return false;
    }
    if (entry.expiresAt !== null && entry.expiresAt < now) {
      return false;
    }
    if (entry.usedCount >= entry.maxUses) {
      return false;
    }
    entry.usedCount += 1;
    return true;
  }

  // --- CSV files & assignments ---

  async putCsvFile(projectId: string, filename: string, data: Buffer, plotKeys?: string[]): Promise<CsvFile> {
    const entry = this.requireProject(projectId);
    // Replace by filename if it already exists, keeping a stable id.
    let existingId: string | null = null;
    for (const [id, file] of entry.csvFiles) {
      if (file.filename === filename) {
        existingId = id;
        break;
      }
    }
    const id = existingId ?? randomUUID();
    const meta: CsvFileEntry = {
      id,
      filename,
      checksum: checksumOf(data),
      // The route passes the plot ids it read with the survey's key count.
      plotCount: plotKeys ? plotKeys.length : plotCountOf(data),
      data: Buffer.from(data),
      distribution: existingId ? entry.csvFiles.get(existingId)!.distribution : null,
    };
    entry.csvFiles.set(id, meta);
    // A replaced file keeps the holdings of the plot ids it still has.
    const held = entry.plotAssignments.get(id);
    if (held && plotKeys) {
      const keep = new Set(plotKeys);
      entry.plotAssignments.set(id, held.filter((a) => keep.has(a.plotKey)));
      entry.holdingsGeneration += 1;
    }
    return InMemoryStore.csvMeta(meta);
  }

  private static csvMeta(f: CsvFileEntry): CsvFile {
    return {
      id: f.id,
      filename: f.filename,
      checksum: f.checksum,
      plotCount: f.plotCount,
      distribution: f.distribution ? structuredClone(f.distribution) : null,
    };
  }

  async listCsvFiles(projectId: string): Promise<CsvFile[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    return [...entry.csvFiles.values()].map((f) => InMemoryStore.csvMeta(f));
  }

  async recountPlots(projectId: string, keyCount: number): Promise<void> {
    for (const file of this.projects.get(projectId)?.csvFiles.values() ?? []) {
      file.plotCount = plotCountOf(file.data, keyCount);
    }
  }

  async getCsvFile(projectId: string, csvFileId: string): Promise<(CsvFile & { data: Buffer }) | null> {
    const file = this.projects.get(projectId)?.csvFiles.get(csvFileId);
    if (!file) {
      return null;
    }
    return { ...InMemoryStore.csvMeta(file), data: file.data };
  }

  async setAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.assignments.clear();
    for (const a of assignments) {
      // Ignore pairs referencing unknown csv files, to keep the set consistent, and
      // divided files: their plots are given out one by one (plotAssignments).
      if (entry.csvFiles.has(a.csvFileId) && !entry.csvFiles.get(a.csvFileId)!.distribution) {
        entry.assignments.add(`${a.userId} ${a.csvFileId}`);
      }
    }
  }

  async listAssignments(projectId: string): Promise<AssignmentDetail[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    const result: AssignmentDetail[] = [];
    for (const key of entry.assignments) {
      const [userId, csvFileId] = key.split(' ');
      const file = entry.csvFiles.get(csvFileId);
      const user = this.users.get(userId);
      result.push({
        userId,
        username: user?.username ?? userId,
        csvFileId,
        filename: file?.filename ?? csvFileId,
      });
    }
    return result;
  }

  async listAssignmentsForUser(projectId: string, userId: string): Promise<CsvFile[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    const files: CsvFile[] = [];
    for (const key of entry.assignments) {
      const [assignedUserId, csvFileId] = key.split(' ');
      if (assignedUserId === userId) {
        const file = entry.csvFiles.get(csvFileId);
        if (file) {
          files.push({ id: file.id, filename: file.filename, checksum: file.checksum, plotCount: file.plotCount });
        }
      }
    }
    return files;
  }

  async isAssigned(projectId: string, csvFileId: string, userId: string): Promise<boolean> {
    return this.projects.get(projectId)?.assignments.has(`${userId} ${csvFileId}`) ?? false;
  }

  async setDivision(
    projectId: string,
    csvFileId: string,
    distribution: StoredDistribution | null,
    plots: PlotAssignment[],
  ): Promise<void> {
    const entry = this.requireProject(projectId);
    const file = entry.csvFiles.get(csvFileId);
    if (!file) {
      return;
    }
    file.distribution = distribution ? structuredClone(distribution) : null;
    entry.holdingsGeneration += 1;
    if (distribution) {
      entry.plotAssignments.set(csvFileId, plots.map((a) => ({ ...a })));
      for (const a of entry.assignments) {
        if (a.endsWith(` ${csvFileId}`)) {
          entry.assignments.delete(a);
        }
      }
    } else {
      entry.plotAssignments.delete(csvFileId);
    }
  }

  async listPlotAssignments(projectId: string, csvFileId: string): Promise<PlotAssignment[]> {
    return (this.projects.get(projectId)?.plotAssignments.get(csvFileId) ?? []).map((a) => ({ ...a }));
  }

  async listPlotHoldings(projectId: string, userId: string): Promise<({ csvFileId: string } & UserPlots)[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    const result: ({ csvFileId: string; filename: string } & UserPlots)[] = [];
    for (const [csvFileId, list] of entry.plotAssignments) {
      const file = entry.csvFiles.get(csvFileId);
      const mine = list.filter((a) => a.userId === userId);
      if (file?.distribution && mine.length > 0) {
        result.push({
          csvFileId,
          filename: file.filename,
          plotKeys: mine.map((a) => a.plotKey),
          copyKeys: mine.filter((a) => a.overlap).map((a) => a.plotKey),
        });
      }
    }
    return result
      .sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0))
      .map(({ csvFileId, plotKeys, copyKeys }) => ({ csvFileId, plotKeys, copyKeys }));
  }

  async listDividedHoldings(projectId: string): Promise<PlotAssignment[]> {
    const entry = this.projects.get(projectId);
    const result: PlotAssignment[] = [];
    for (const [csvFileId, list] of entry?.plotAssignments ?? []) {
      if (entry!.csvFiles.get(csvFileId)?.distribution) {
        for (const a of list) {
          result.push({ plotKey: a.plotKey, userId: a.userId, overlap: a.overlap });
        }
      }
    }
    return result;
  }

  async countPlotHolders(projectId: string): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const [csvFileId, list] of this.projects.get(projectId)?.plotAssignments ?? []) {
      if (this.projects.get(projectId)!.csvFiles.get(csvFileId)?.distribution) {
        result.set(csvFileId, new Set(list.map((a) => a.userId)).size);
      }
    }
    return result;
  }

  async listUserPlots(projectId: string, csvFileId: string, userId: string): Promise<UserPlots> {
    const entry = this.projects.get(projectId);
    if (!entry?.csvFiles.get(csvFileId)?.distribution) {
      return { plotKeys: [], copyKeys: [] };
    }
    const mine = (entry.plotAssignments.get(csvFileId) ?? []).filter((a) => a.userId === userId);
    return { plotKeys: mine.map((a) => a.plotKey), copyKeys: mine.filter((a) => a.overlap).map((a) => a.plotKey) };
  }

  // --- Quality review ---

  async qualityVersion(projectId: string): Promise<string> {
    const entry = this.projects.get(projectId);
    return entry ? `${entry.records.size}:${entry.recordsGeneration}:${entry.holdingsGeneration}` : '';
  }

  recordsSource(): { databaseUrl: string } | null {
    return null;
  }

  async getQualitySettings(projectId: string): Promise<QualitySettings> {
    const settings = this.projects.get(projectId)?.qualitySettings;
    return settings ? structuredClone(settings) : { margins: {} };
  }

  async setQualitySettings(projectId: string, settings: QualitySettings): Promise<void> {
    this.requireProject(projectId).qualitySettings = structuredClone(settings);
  }

  async patchQualitySettings(projectId: string, patch: Partial<QualitySettings>): Promise<QualitySettings> {
    const entry = this.requireProject(projectId);
    entry.qualitySettings = structuredClone({ margins: {}, ...(entry.qualitySettings ?? {}), ...patch });
    return structuredClone(entry.qualitySettings);
  }

  async isAiEnabled(projectId: string): Promise<boolean> {
    return this.projects.get(projectId)?.aiEnabled ?? false;
  }

  async setAiEnabled(projectId: string, enabled: boolean): Promise<void> {
    this.requireProject(projectId).aiEnabled = enabled;
  }

  async listQualityDecisions(projectId: string): Promise<QualityDecision[]> {
    const entry = this.projects.get(projectId);
    return [...(entry?.decisions ?? [])]
      .map(([plot, d]) => this.decisionOf(plot, d))
      .sort((a, b) => (a.plot < b.plot ? -1 : a.plot > b.plot ? 1 : 0));
  }

  async setQualityDecision(
    projectId: string,
    plot: string,
    decision: DecisionKind,
    comment: string | null,
    userId: string | null,
    seen: { operator: string; hash: number }[] | null = null,
  ): Promise<QualityDecision> {
    const entry = this.requireProject(projectId);
    const stored: StoredDecision = { decision, comment, decidedBy: this.requireUserOrNull(userId), decidedAt: Date.now(), seen: seen ? structuredClone(seen) : null };
    entry.decisions.set(plot, stored);
    return this.decisionOf(plot, stored);
  }

  async deleteQualityDecision(projectId: string, plot: string): Promise<boolean> {
    return this.projects.get(projectId)?.decisions.delete(plot) ?? false;
  }

  async listGuidanceNotes(projectId: string): Promise<GuidanceNote[]> {
    const entry = this.projects.get(projectId);
    // By question, then pair, as Postgres orders them (code-point order).
    const keyOf = (n: GuidanceNote) => [n.questionKey, n.firstValue ?? '', n.checkValue ?? '', n.id];
    return [...(entry?.notes.values() ?? [])]
      .map((n) => this.noteOf(n))
      .sort((a, b) => {
        const x = keyOf(a);
        const y = keyOf(b);
        for (let i = 0; i < x.length; i++) {
          if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
        }
        return 0;
      });
  }

  async createGuidanceNote(projectId: string, note: GuidanceNoteInput, userId: string | null): Promise<GuidanceNote> {
    const entry = this.requireProject(projectId);
    const stored: StoredNote = { ...InMemoryStore.noteInput(note), id: randomUUID(), updatedBy: this.requireUserOrNull(userId), updatedAt: Date.now() };
    entry.notes.set(stored.id, stored);
    return this.noteOf(stored);
  }

  async updateGuidanceNote(projectId: string, id: string, note: GuidanceNoteInput, userId: string | null): Promise<GuidanceNote | null> {
    const entry = this.projects.get(projectId);
    if (!entry?.notes.has(id)) {
      return null;
    }
    const stored: StoredNote = { ...InMemoryStore.noteInput(note), id, updatedBy: this.requireUserOrNull(userId), updatedAt: Date.now() };
    entry.notes.set(id, stored);
    return this.noteOf(stored);
  }

  async deleteGuidanceNote(projectId: string, id: string): Promise<boolean> {
    return this.projects.get(projectId)?.notes.delete(id) ?? false;
  }

  private static noteInput(n: GuidanceNoteInput): GuidanceNoteInput {
    return { questionKey: n.questionKey, firstValue: n.firstValue, checkValue: n.checkValue, text: n.text };
  }

  async startAiRun(projectId: string, start: AiRunStart, w: AiRunWindow): Promise<AiRunStartResult> {
    const entry = this.requireProject(projectId);
    this.requireUserOrNull(start.startedBy);
    // One thread: nothing runs between the checks and the insert, as the lock does in Postgres.
    InMemoryStore.failStale(entry, w.staleBefore, AI_INTERRUPTED.code, AI_INTERRUPTED.message, w.now);
    const runs = entry.aiRuns;
    const limit = aiLimitReached(
      start.kind,
      {
        running: runs.some((r) => r.status === 'running'),
        reportsToday: runs.filter((r) => r.kind === 'report' && r.status === 'done' && r.startedAt >= w.dayStart).length,
        answersToday: runs.filter((r) => r.kind !== 'report' && (r.status === 'done' || r.status === 'refused') && r.startedAt >= w.dayStart).length,
        tokensThisMonth: runs.filter((r) => r.startedAt >= w.monthStart).reduce((n, r) => n + r.inputTokens + r.outputTokens, 0),
      },
      w,
    );
    if (limit) {
      return { ok: false, limit };
    }
    const run: AiRunRow = {
      id: randomUUID(),
      kind: start.kind,
      status: 'running',
      startedBy: start.startedBy,
      startedAt: w.now,
      finishedAt: null,
      model: start.model,
      inputTokens: 0,
      outputTokens: 0,
      parentRun: start.parentRun ?? null,
      findingIndex: start.findingIndex ?? null,
      action: start.action ?? null,
      errorCode: null,
      toolCalls: [],
      result: null,
      error: null,
      question: start.question ?? null,
      questionNames: start.questionNames ?? null,
    };
    runs.push(run);
    return { ok: true, run: this.aiRunOf(run) };
  }

  async updateAiRun(projectId: string, runId: string, progress: AiRunProgress): Promise<void> {
    const run = this.projects.get(projectId)?.aiRuns.find((r) => r.id === runId);
    if (run?.status === 'running') {
      Object.assign(run, structuredClone({ inputTokens: progress.inputTokens, outputTokens: progress.outputTokens, toolCalls: progress.toolCalls }));
    }
  }

  async finishAiRun(projectId: string, runId: string, end: AiRunEnd): Promise<boolean> {
    const run = this.projects.get(projectId)?.aiRuns.find((r) => r.id === runId);
    if (run?.status !== 'running') {
      return false;
    }
    Object.assign(run, structuredClone(end));
    return true;
  }

  async failStaleAiRuns(projectId: string, before: number, code: string, message: string, now: number): Promise<number> {
    const entry = this.projects.get(projectId);
    return entry ? InMemoryStore.failStale(entry, before, code, message, now) : 0;
  }

  async listAiRuns(projectId: string, limit: number): Promise<AiRunSummary[]> {
    const runs = this.projects.get(projectId)?.aiRuns ?? [];
    return runs
      .slice()
      .reverse()
      .slice(0, limit)
      .map((r) => {
        const { toolCalls: _t, result: _r, error: _e, question: _q, questionNames: _n, ...summary } = this.aiRunOf(r);
        return summary;
      });
  }

  async getAiRun(projectId: string, runId: string): Promise<AiRunRow | null> {
    const run = this.projects.get(projectId)?.aiRuns.find((r) => r.id === runId);
    return run ? this.aiRunOf(run) : null;
  }

  async aiUsageSince(from: number): Promise<AiUsage[]> {
    const out: AiUsage[] = [];
    for (const [projectId, entry] of this.projects) {
      const runs = entry.aiRuns.filter((r) => r.startedAt >= from);
      if (runs.length === 0) {
        continue;
      }
      out.push({
        projectId,
        runs: runs.length,
        reports: runs.filter((r) => r.kind === 'report').length,
        followUps: runs.filter((r) => r.kind === 'follow_up').length,
        questions: runs.filter((r) => r.kind === 'question').length,
        failed: runs.filter((r) => r.status === 'failed').length,
        refused: runs.filter((r) => r.status === 'refused').length,
        inputTokens: runs.reduce((n, r) => n + r.inputTokens, 0),
        outputTokens: runs.reduce((n, r) => n + r.outputTokens, 0),
      });
    }
    return out.sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0));
  }

  // --- Activity data ---

  async putRecordWithEvent(
    projectId: string,
    recordKey: string,
    operator: string,
    apply: (existing: RecordRow | null, submittedBefore: boolean) => { row: RecordRow; event: RecordEventInput | null } | null,
  ): Promise<boolean> {
    // No await between the read and the writes: atomic, as the transaction in Postgres.
    const entry = this.requireProject(projectId);
    const existing = entry.records.get(InMemoryStore.recordId(recordKey, operator)) ?? null;
    const submittedBefore = entry.recordEvents.some(
      (e) => e.recordKey === recordKey && e.operator === operator && (e.change === 'submitted' || e.change === 'resubmitted'),
    );
    const out = apply(existing ? { ...existing } : null, submittedBefore);
    if (out === null) {
      return false;
    }
    entry.records.set(InMemoryStore.recordId(out.row.recordKey, out.row.operator), { ...out.row, projectId });
    entry.recordsGeneration += 1;
    if (out.event) {
      entry.recordEvents.push({ ...out.event, summary: out.event.summary ? { ...out.event.summary } : null, id: String(this.nextEventId++) });
    }
    return true;
  }

  async appendRecordEvent(event: RecordEventInput): Promise<void> {
    const entry = this.requireProject(event.projectId);
    entry.recordEvents.push({ ...event, summary: event.summary ? { ...event.summary } : null, id: String(this.nextEventId++) });
  }

  async listRecordEvents(projectId: string, q: RecordEventQuery): Promise<RecordEvent[]> {
    checkCursor(q.before);
    const events = this.projects.get(projectId)?.recordEvents ?? [];
    return events
      .filter(
        (e) =>
          e.modifiedOn >= q.from &&
          e.modifiedOn < q.to &&
          (q.operator === undefined || e.operator === q.operator) &&
          (q.before === undefined || isBefore(e.modifiedOn, e.id, q.before)),
      )
      .sort((x, y) => y.modifiedOn - x.modifiedOn || Number(y.id) - Number(x.id))
      .slice(0, q.limit)
      .map((e) => ({ ...e, summary: e.summary ? { ...e.summary } : null }));
  }

  async touchMemberActivity(projectId: string, userId: string, patch: MemberActivityPatch): Promise<void> {
    const entry = this.projects.get(projectId);
    if (!entry || !this.memberships.has(InMemoryStore.memberId(projectId, userId))) {
      return;
    }
    const a: MemberActivity = entry.memberActivity.get(userId) ?? {
      userId,
      lastSeenAt: null,
      lastSyncAt: null,
      lastPlotsDownloadAt: null,
      lastCepDownloadAt: null,
      syncsCount: 0,
      recordsReceived: 0,
      clientAgent: null,
    };
    const later = (stored: number | null, given: number | undefined) =>
      given === undefined ? stored : stored === null ? given : Math.max(stored, given);
    a.lastSeenAt = later(a.lastSeenAt, patch.lastSeenAt);
    a.lastSyncAt = later(a.lastSyncAt, patch.lastSyncAt);
    a.lastPlotsDownloadAt = later(a.lastPlotsDownloadAt, patch.lastPlotsDownloadAt);
    a.lastCepDownloadAt = later(a.lastCepDownloadAt, patch.lastCepDownloadAt);
    a.syncsCount += patch.syncs ?? 0;
    a.recordsReceived += patch.recordsReceived ?? 0;
    if (patch.clientAgent !== undefined) a.clientAgent = patch.clientAgent;
    entry.memberActivity.set(userId, a);
  }

  async listMemberActivity(projectId: string): Promise<MemberActivity[]> {
    const activity = this.projects.get(projectId)?.memberActivity ?? new Map<string, MemberActivity>();
    return [...activity.values()].map((a) => ({ ...a })).sort((x, y) => (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
  }

  async unsentDelays(projectId: string, since: number): Promise<{ operator: string; medianMs: number; uploads: number }[]> {
    const waits = new Map<string, number[]>();
    for (const e of this.projects.get(projectId)?.recordEvents ?? []) {
      if (e.change !== 'deleted' && e.receivedAt >= since) {
        const list = waits.get(e.operator) ?? [];
        list.push(e.receivedAt - e.modifiedOn);
        waits.set(e.operator, list);
      }
    }
    // As Postgres's percentile_cont(0.5): the middle one, or halfway between the two middle ones.
    return [...waits]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([operator, list]) => {
        list.sort((a, b) => a - b);
        const mid = (list.length - 1) / 2;
        return { operator, medianMs: (list[Math.floor(mid)] + list[Math.ceil(mid)]) / 2, uploads: list.length };
      });
  }

  async getProgressSettings(projectId: string): Promise<ProgressSettings> {
    return { ...(this.projects.get(projectId)?.progressSettings ?? DEFAULT_PROGRESS_SETTINGS) };
  }

  async setProgressSettings(projectId: string, settings: ProgressSettings): Promise<void> {
    this.requireProject(projectId).progressSettings = { ...settings };
  }

  async appendAudit(projectId: string, input: AuditInput): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.audit.push({
      id: String(this.nextEventId++),
      projectId,
      at: Date.now(),
      actorUserId: this.requireUserOrNull(input.actorUserId),
      action: input.action,
      details: { ...input.details },
    });
  }

  async listAudit(projectId: string, q: AuditQuery): Promise<AuditEntry[]> {
    checkCursor(q.before);
    const audit = this.projects.get(projectId)?.audit ?? [];
    return audit
      .filter(
        (e) =>
          (q.actor === undefined || e.actorUserId === q.actor) &&
          (q.action === undefined || e.action === q.action) &&
          (q.before === undefined || isBefore(e.at, e.id, q.before)),
      )
      .sort((x, y) => y.at - x.at || Number(y.id) - Number(x.id))
      .slice(0, q.limit)
      .map((e) => ({ ...e, details: { ...e.details }, actor: this.usernameOf(e.actorUserId) }));
  }

  private static failStale(entry: ProjectEntry, before: number, code: string, message: string, now: number): number {
    let n = 0;
    for (const r of entry.aiRuns) {
      if (r.status === 'running' && r.startedAt < before) {
        Object.assign(r, { status: 'failed', errorCode: code, error: message, finishedAt: now });
        n++;
      }
    }
    return n;
  }

  /** A copy, with the username of who started it. */
  private aiRunOf(r: AiRunRow): AiRunRow {
    return { ...structuredClone(r), startedBy: this.usernameOf(r.startedBy) };
  }

  private decisionOf(plot: string, d: StoredDecision): QualityDecision {
    return { plot, decision: d.decision, comment: d.comment, decidedBy: this.usernameOf(d.decidedBy), decidedAt: d.decidedAt, seen: d.seen ? structuredClone(d.seen) : null };
  }

  private noteOf(n: StoredNote): GuidanceNote {
    return { ...InMemoryStore.noteInput(n), id: n.id, updatedBy: this.usernameOf(n.updatedBy), updatedAt: n.updatedAt };
  }

  private usernameOf(userId: string | null): string | null {
    return userId === null ? null : (this.users.get(userId)?.username ?? null);
  }

  /** As the users foreign key in Postgres: a maker who is not a user is refused. */
  private requireUserOrNull(userId: string | null): string | null {
    if (userId !== null && !this.users.has(userId)) {
      throw new Error(`Unknown user ${userId}`);
    }
    return userId;
  }

  async close(): Promise<void> {
    this.projects.clear();
    this.tokens.clear();
    this.users.clear();
    this.usersByName.clear();
    this.sessions.clear();
    this.memberships.clear();
    this.invites.clear();
    this.resets.clear();
    this.settings = { ...DEFAULT_SETTINGS };
  }

  private requireProject(projectId: string): ProjectEntry {
    const entry = this.projects.get(projectId);
    if (!entry) {
      throw new Error(`Unknown project ${projectId}`);
    }
    return entry;
  }
}

/** Whether (at, id) comes after the cursor in a newest-first list (as Postgres's row comparison). */
function isBefore(at: number, id: string, cursor: EventCursor): boolean {
  return at < cursor.at || (at === cursor.at && Number(id) < Number(cursor.id));
}

/** An invite still usable: not revoked, not expired, uses left. */
function isOpen(e: InviteEntry, now: number): boolean {
  return e.revokedAt === null && (e.expiresAt === null || e.expiresAt >= now) && e.usedCount < e.maxUses;
}

/** Thrown by createUser when the username is already registered. */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username already taken: ${username}`);
    this.name = 'UsernameTakenError';
  }
}
