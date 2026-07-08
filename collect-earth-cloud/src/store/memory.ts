import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from '../auth.js';
import { checksumOf, plotCountOf } from '../csv.js';
import type {
  Assignment,
  AssignmentDetail,
  CsvFile,
  Invite,
  Member,
  Membership,
  ProjectRow,
  RecordRow,
  Role,
  User,
} from '../types.js';
import type { CreateInviteInput, CreateProjectResult, Store, TokenMembership } from './store.js';

interface CsvFileEntry extends CsvFile {
  data: Buffer;
}

interface ProjectEntry {
  project: ProjectRow;
  records: Map<string, RecordRow>; // key = recordKey + ' ' + operator
  cep: Buffer | null;
  csvFiles: Map<string, CsvFileEntry>; // key = csvFileId
  assignments: Set<string>; // `${userId} ${csvFileId}`
}

interface InviteEntry {
  projectId: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
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
      csvFiles: new Map(),
      assignments: new Set(),
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

  async resolveToken(token: string): Promise<TokenMembership | null> {
    return this.tokens.get(hashToken(token)) ?? null;
  }

  async setSurvey(projectId: string, surveyUri: string, surveyName: string | null, idmlBase64: string): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.project.surveyUri = surveyUri;
    entry.project.surveyName = surveyName;
    entry.project.idmlBase64 = idmlBase64;
  }

  async putCep(projectId: string, cep: Buffer): Promise<void> {
    this.requireProject(projectId).cep = Buffer.from(cep);
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

  // --- Users & sessions ---

  async createUser(input: { username: string; passwordHash: string; email: string | null }): Promise<User> {
    if (this.usersByName.has(input.username)) {
      throw new UsernameTakenError(input.username);
    }
    const user: User = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      email: input.email,
    };
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

  // --- Invites ---

  async createInvite(input: CreateInviteInput): Promise<string> {
    const token = generateToken();
    this.invites.set(hashToken(token), {
      projectId: input.projectId,
      role: input.role,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: input.expiresAt,
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
    };
  }

  async consumeInvite(token: string, now: number): Promise<boolean> {
    const entry = this.invites.get(hashToken(token));
    if (!entry) {
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

  async putCsvFile(projectId: string, filename: string, data: Buffer): Promise<CsvFile> {
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
      plotCount: plotCountOf(data),
      data: Buffer.from(data),
    };
    entry.csvFiles.set(id, meta);
    return { id: meta.id, filename: meta.filename, checksum: meta.checksum, plotCount: meta.plotCount };
  }

  async listCsvFiles(projectId: string): Promise<CsvFile[]> {
    const entry = this.projects.get(projectId);
    if (!entry) {
      return [];
    }
    return [...entry.csvFiles.values()].map((f) => ({
      id: f.id,
      filename: f.filename,
      checksum: f.checksum,
      plotCount: f.plotCount,
    }));
  }

  async getCsvFile(projectId: string, csvFileId: string): Promise<(CsvFile & { data: Buffer }) | null> {
    const file = this.projects.get(projectId)?.csvFiles.get(csvFileId);
    if (!file) {
      return null;
    }
    return { id: file.id, filename: file.filename, checksum: file.checksum, plotCount: file.plotCount, data: file.data };
  }

  async setAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.assignments.clear();
    for (const a of assignments) {
      // Ignore pairs referencing unknown csv files, to keep the set consistent.
      if (entry.csvFiles.has(a.csvFileId)) {
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

  async close(): Promise<void> {
    this.projects.clear();
    this.tokens.clear();
    this.users.clear();
    this.usersByName.clear();
    this.sessions.clear();
    this.memberships.clear();
    this.invites.clear();
  }

  private requireProject(projectId: string): ProjectEntry {
    const entry = this.projects.get(projectId);
    if (!entry) {
      throw new Error(`Unknown project ${projectId}`);
    }
    return entry;
  }
}

/** Thrown by createUser when the username is already registered. */
export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username already taken: ${username}`);
    this.name = 'UsernameTakenError';
  }
}
