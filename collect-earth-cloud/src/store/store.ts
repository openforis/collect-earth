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

export interface CreateInviteInput {
  projectId: string;
  role: Role;
  maxUses: number;
  expiresAt: number | null;
  createdBy: string;
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

  /**
   * Resolves a plaintext PROJECT-scoped token (Phase 0 admin/operator tokens) to
   * its single project membership, or null. User session tokens are resolved via
   * resolveSession + getMembership instead.
   */
  resolveToken(token: string): Promise<TokenMembership | null>;

  setSurvey(projectId: string, surveyUri: string, surveyName: string | null, idmlBase64: string): Promise<void>;

  /** Stores the raw CEP zip for a project (overwrites). */
  putCep(projectId: string, cep: Buffer): Promise<void>;
  getCep(projectId: string): Promise<Buffer | null>;

  // --- Users & sessions (Phase A) ---

  /** Creates a user; rejects if the username already exists. */
  createUser(input: { username: string; passwordHash: string; email: string | null }): Promise<User>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(userId: string): Promise<User | null>;

  /** Issues an opaque session token for a user and returns the plaintext token. */
  createSession(userId: string): Promise<string>;
  /** Resolves a session token to its user id, or null if unknown/expired. */
  resolveSession(token: string): Promise<{ userId: string } | null>;
  deleteSession(token: string): Promise<void>;

  // --- Memberships (Phase A, tenancy model §4b) ---

  addMembership(projectId: string, userId: string, role: Role): Promise<void>;
  getMembership(projectId: string, userId: string): Promise<TokenMembership | null>;
  listMemberships(userId: string): Promise<Membership[]>;
  listMembers(projectId: string): Promise<Member[]>;
  setMemberRole(projectId: string, userId: string, role: Role): Promise<void>;
  removeMember(projectId: string, userId: string): Promise<void>;
  countAdmins(projectId: string): Promise<number>;

  // --- Invites (Phase A) ---

  createInvite(input: CreateInviteInput): Promise<string>;
  getInvite(token: string): Promise<Invite | null>;
  /** Atomically records one use of an invite; returns false if it is exhausted/expired. */
  consumeInvite(token: string, now: number): Promise<boolean>;

  // --- CSV files & assignments (Phase B) ---

  /** Stores (or replaces, by filename) a plot CSV and returns its metadata. */
  putCsvFile(projectId: string, filename: string, data: Buffer): Promise<CsvFile>;
  listCsvFiles(projectId: string): Promise<CsvFile[]>;
  getCsvFile(projectId: string, csvFileId: string): Promise<(CsvFile & { data: Buffer }) | null>;

  /** Replaces the project's whole assignment set with the given pairs. */
  setAssignments(projectId: string, assignments: Assignment[]): Promise<void>;
  listAssignments(projectId: string): Promise<AssignmentDetail[]>;
  listAssignmentsForUser(projectId: string, userId: string): Promise<CsvFile[]>;
  isAssigned(projectId: string, csvFileId: string, userId: string): Promise<boolean>;

  getRecord(projectId: string, recordKey: string, operator: string): Promise<RecordRow | null>;
  putRecord(row: RecordRow): Promise<void>;

  /** All records for a project (deleted excluded unless includeDeleted). For stats/export/tests. */
  listRecords(projectId: string, includeDeleted?: boolean): Promise<RecordRow[]>;

  close(): Promise<void>;
}
