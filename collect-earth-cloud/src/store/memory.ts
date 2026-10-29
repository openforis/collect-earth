import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from '../auth.js';
import { checksumOf, plotCountOf } from '../csv.js';
import {
  DEFAULT_SETTINGS,
  type Assignment,
  type AssignmentDetail,
  type CepInfo,
  type CsvFile,
  type Invite,
  type InviteSummary,
  type Member,
  type Membership,
  type PlotAssignment,
  type ProjectRow,
  type ProjectStorage,
  type RecordRow,
  type RoundInfo,
  type Role,
  type ServerSettings,
  type StoredDistribution,
  type User,
  type UserSummary,
} from '../types.js';
import type { CreateInviteInput, CreateProjectResult, Store, TokenMembership, UserPlots } from './store.js';

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
  private readonly sessions = new Map<string, string>(); // session token hash -> userId
  private readonly memberships = new Map<string, Role>(); // `${projectId} ${userId}` -> role
  private readonly invites = new Map<string, InviteEntry>(); // invite token hash -> entry
  private readonly resets = new Map<string, ResetEntry>(); // reset token hash -> entry
  private settings: ServerSettings = { ...DEFAULT_SETTINGS };

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
    const info = this.projects.get(projectId)?.roundInfo;
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
  }

  async listRecords(projectId: string, includeDeleted = false): Promise<RecordRow[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    return [...entry.records.values()].filter((r) => includeDeleted || !r.deleted);
  }

  async listRecordSummaries(projectId: string): Promise<RecordRow[]> {
    return (await this.listRecords(projectId)).map((r) => ({ ...r, xml: null }));
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
    if (this.usersByName.has(input.username)) {
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
    for (const key of this.memberships.keys()) {
      if (key.endsWith(` ${userId}`)) {
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
    }
    for (const [hash, reset] of this.resets) {
      if (reset.userId === userId) {
        this.resets.delete(hash);
      }
    }
    this.usersByName.delete(user.username);
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
    }
  }

  private static dropPlotAssignments(entry: ProjectEntry, userId: string): void {
    for (const [csvFileId, list] of entry.plotAssignments) {
      entry.plotAssignments.set(csvFileId, list.filter((a) => a.userId !== userId));
    }
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

  async createInvite(input: CreateInviteInput): Promise<string> {
    // As Postgres' invites.created_by REFERENCES users(id): a user, or nobody.
    if (input.createdBy !== null && !this.users.has(input.createdBy)) {
      throw new Error('invites.created_by must be a user id or null');
    }
    const token = generateToken();
    this.invites.set(hashToken(token), {
      id: randomUUID(),
      projectId: input.projectId,
      role: input.role,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
      createdAt: Date.now(),
      revokedAt: null,
    });
    return token;
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

  async listOverlapHoldings(projectId: string): Promise<{ plotKey: string; userId: string }[]> {
    const entry = this.projects.get(projectId);
    const result: { plotKey: string; userId: string }[] = [];
    for (const [csvFileId, list] of entry?.plotAssignments ?? []) {
      if (entry!.csvFiles.get(csvFileId)?.distribution) {
        for (const a of list) {
          if (a.overlap) {
            result.push({ plotKey: a.plotKey, userId: a.userId });
          }
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
