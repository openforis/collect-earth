import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { isUuid } from '../accountRules.js';
import { generateToken, hashToken } from '../auth.js';
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
  type ServerSettings,
  type StoredDistribution,
  type Role,
  type User,
  type UserSummary,
} from '../types.js';
import type { CreateInviteInput, CreateProjectResult, Store, TokenMembership, UserPlots } from './store.js';
import { UsernameTakenError } from './memory.js';
import { checksumOf, plotCountOf } from '../csv.js';

const { Pool } = pg;

/** Rows per INSERT when saving a division (a file can have ~100k plots). */
const PLOT_INSERT_CHUNK = 5000;

/**
 * PostgreSQL-backed Store. In addition to app-level project scoping (every query
 * is parameterised by project_id), each project-scoped operation runs inside a
 * transaction that sets `app.current_project`, so the Row-Level Security policies
 * defined in migrations/001_init.sql act as a hard second fence against any query
 * that forgets its project_id filter.
 */
export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  /** Runs fn inside a transaction scoped to a project for RLS enforcement. */
  private async withProject<T>(projectId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_project', projectId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async createProject(input: { name: string }): Promise<CreateProjectResult> {
    const projectId = randomUUID();
    const adminToken = generateToken();
    const projectToken = generateToken();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO projects (id, name) VALUES ($1, $2)', [projectId, input.name]);
      await client.query(
        'INSERT INTO project_tokens (token_hash, project_id, role) VALUES ($1, $2, $3), ($4, $2, $5)',
        [hashToken(adminToken), projectId, 'admin', hashToken(projectToken), 'operator'],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return { projectId, adminToken, projectToken };
  }

  async getProject(projectId: string): Promise<ProjectRow | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT id, name, survey_uri, survey_name, idml_base64 FROM projects WHERE id = $1',
        [projectId],
      );
      if (res.rowCount === 0) {
        return null;
      }
      const r = res.rows[0];
      return {
        projectId: r.id,
        name: r.name,
        surveyUri: r.survey_uri,
        surveyName: r.survey_name,
        idmlBase64: r.idml_base64,
      };
    });
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('UPDATE projects SET name = $2 WHERE id = $1', [projectId, name]);
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    // One transaction with app.current_project set, so the RLS-fenced tables
    // (records, project_ceps, csv_files, assignments, projects) are deleted through
    // their policies. The global tables (tokens, invites, members) are matched by
    // project_id. Children first, so nothing relies on ON DELETE CASCADE.
    await this.withProject(projectId, async (client) => {
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM assignments WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM csv_files WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM records WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_ceps WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM invites WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_members WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_tokens WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    });
  }

  async getProjectStorage(projectId: string): Promise<ProjectStorage> {
    return this.withProject(projectId, async (client) => {
      const cep = await client.query(
        `SELECT (octet_length(data) + COALESCE(octet_length(cep_original), 0))::bigint AS bytes
           FROM project_ceps WHERE project_id = $1`,
        [projectId],
      );
      const csv = await client.query(
        'SELECT filename, octet_length(data)::bigint AS bytes FROM csv_files WHERE project_id = $1',
        [projectId],
      );
      const rec = await client.query(
        `SELECT COALESCE(SUM(COALESCE(octet_length(xml), 0) + octet_length(summary::text)), 0)::bigint AS bytes
           FROM records WHERE project_id = $1`,
        [projectId],
      );
      const csvBytesByFilename: Record<string, number> = {};
      for (const r of csv.rows) {
        csvBytesByFilename[r.filename as string] = Number(r.bytes);
      }
      return {
        cepBytes: cep.rowCount === 0 ? 0 : Number(cep.rows[0].bytes),
        csvBytesByFilename,
        recordBytes: Number(rec.rows[0].bytes),
      };
    });
  }

  async resolveToken(token: string): Promise<TokenMembership | null> {
    const res = await this.pool.query(
      'SELECT project_id, role FROM project_tokens WHERE token_hash = $1',
      [hashToken(token)],
    );
    if (res.rowCount === 0) {
      return null;
    }
    return { projectId: res.rows[0].project_id, role: res.rows[0].role };
  }

  async setSurvey(projectId: string, surveyUri: string, surveyName: string | null, idmlBase64: string): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query(
        'UPDATE projects SET survey_uri = $2, survey_name = $3, idml_base64 = $4 WHERE id = $1',
        [projectId, surveyUri, surveyName, idmlBase64],
      );
    });
  }

  async getRecord(projectId: string, recordKey: string, operator: string): Promise<RecordRow | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary,
                deleted, deleted_on
           FROM records
          WHERE project_id = $1 AND record_key = $2 AND operator = $3`,
        [projectId, recordKey, operator],
      );
      return res.rowCount === 0 ? null : mapRecord(res.rows[0]);
    });
  }

  async putRecord(row: RecordRow): Promise<void> {
    await this.withProject(row.projectId, async (client) => {
      await client.query(
        `INSERT INTO records (project_id, record_key, operator, modified_on, received_at, actively_saved, step,
                              xml, summary, deleted, deleted_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project_id, record_key, operator) DO UPDATE SET
           modified_on = EXCLUDED.modified_on,
           received_at = EXCLUDED.received_at,
           actively_saved = EXCLUDED.actively_saved,
           step = EXCLUDED.step,
           xml = EXCLUDED.xml,
           summary = EXCLUDED.summary,
           deleted = EXCLUDED.deleted,
           deleted_on = EXCLUDED.deleted_on`,
        [
          row.projectId,
          row.recordKey,
          row.operator,
          new Date(row.modifiedOn),
          new Date(row.receivedAt),
          row.activelySaved,
          row.step,
          row.xml,
          JSON.stringify(row.summary),
          row.deleted,
          row.deletedOn === null ? null : new Date(row.deletedOn),
        ],
      );
    });
  }

  async listRecords(projectId: string, includeDeleted = false): Promise<RecordRow[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary,
                deleted, deleted_on
           FROM records
          WHERE project_id = $1 AND ($2 OR NOT deleted)`,
        [projectId, includeDeleted],
      );
      return res.rows.map(mapRecord);
    });
  }

  async listRecordSummaries(projectId: string): Promise<RecordRow[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, NULL AS xml, summary,
                deleted, deleted_on
           FROM records
          WHERE project_id = $1 AND NOT deleted`,
        [projectId],
      );
      return res.rows.map(mapRecord);
    });
  }

  async putCep(projectId: string, served: Buffer, info: RoundInfo, original: Buffer | null): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query(
        `INSERT INTO project_ceps (project_id, data, cep_original, round_info) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id) DO UPDATE SET
           data = EXCLUDED.data,
           cep_original = EXCLUDED.cep_original,
           round_info = EXCLUDED.round_info,
           updated_at = now()`,
        [projectId, served, original, JSON.stringify(info)],
      );
    });
  }

  async getOriginalCep(projectId: string): Promise<Buffer | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT COALESCE(cep_original, data) AS data FROM project_ceps WHERE project_id = $1',
        [projectId],
      );
      return res.rowCount === 0 ? null : (res.rows[0].data as Buffer);
    });
  }

  async getRoundInfo(projectId: string): Promise<RoundInfo | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT round_info FROM project_ceps WHERE project_id = $1', [projectId]);
      return res.rowCount === 0 ? null : ((res.rows[0].round_info as RoundInfo | null) ?? null);
    });
  }

  async setReassessmentCode(projectId: string, code: string | null): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query(
        `UPDATE project_ceps SET round_info = jsonb_set(round_info, '{reassessmentCode}', $2::jsonb)
          WHERE project_id = $1 AND round_info IS NOT NULL`,
        [projectId, JSON.stringify(code)],
      );
    });
  }

  async hasRecords(projectId: string): Promise<boolean> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT EXISTS (SELECT 1 FROM records WHERE project_id = $1) AS found', [projectId]);
      return res.rows[0].found as boolean;
    });
  }

  async getCep(projectId: string): Promise<Buffer | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT data FROM project_ceps WHERE project_id = $1', [projectId]);
      return res.rowCount === 0 ? null : (res.rows[0].data as Buffer);
    });
  }

  async getCepInfo(projectId: string): Promise<CepInfo | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT octet_length(data)::int AS bytes, updated_at FROM project_ceps WHERE project_id = $1',
        [projectId],
      );
      if (res.rowCount === 0) {
        return null;
      }
      return { bytes: res.rows[0].bytes as number, updatedAt: (res.rows[0].updated_at as Date).getTime() };
    });
  }

  async createUser(input: {
    username: string;
    passwordHash: string;
    email: string | null;
    termsAcceptedAt?: number | null;
  }): Promise<User> {
    const id = randomUUID();
    const termsAcceptedAt = input.termsAcceptedAt ?? null;
    try {
      await this.pool.query(
        'INSERT INTO users (id, username, password_hash, email, terms_accepted_at) VALUES ($1, $2, $3, $4, $5)',
        [id, input.username, input.passwordHash, input.email, termsAcceptedAt === null ? null : new Date(termsAcceptedAt)],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new UsernameTakenError(input.username);
      }
      throw err;
    }
    return {
      id,
      username: input.username,
      passwordHash: input.passwordHash,
      email: input.email,
      isPlatformAdmin: false,
      termsAcceptedAt,
    };
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT id, username, password_hash, email, is_platform_admin, terms_accepted_at FROM users WHERE username = $1',
      [username],
    );
    return res.rowCount === 0 ? null : mapUser(res.rows[0]);
  }

  async getUserById(userId: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT id, username, password_hash, email, is_platform_admin, terms_accepted_at FROM users WHERE id = $1',
      [userId],
    );
    return res.rowCount === 0 ? null : mapUser(res.rows[0]);
  }

  async createSession(userId: string): Promise<string> {
    const token = generateToken();
    await this.pool.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [hashToken(token), userId]);
    return token;
  }

  async resolveSession(token: string): Promise<{ userId: string } | null> {
    const res = await this.pool.query(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND (expires_at IS NULL OR expires_at > now())',
      [hashToken(token)],
    );
    return res.rowCount === 0 ? null : { userId: res.rows[0].user_id };
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Assignments are RLS-fenced project data: delete them project by project
      // with app.current_project set, as every other project-scoped write does.
      const projects = await client.query('SELECT project_id FROM project_members WHERE user_id = $1', [userId]);
      for (const r of projects.rows) {
        await client.query('SELECT set_config($1, $2, true)', ['app.current_project', r.project_id]);
        await client.query('DELETE FROM assignments WHERE project_id = $1 AND user_id = $2', [r.project_id, userId]);
        await client.query('DELETE FROM plot_assignments WHERE project_id = $1 AND user_id = $2', [r.project_id, userId]);
      }
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM project_members WHERE user_id = $1', [userId]);
      // invites.created_by is ON DELETE SET NULL; records keep the operator name.
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Platform administration: global tables (users, server_settings,
  // password_resets), not under RLS, never returning project data. ---

  async hasPlatformAdmin(): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 FROM users WHERE is_platform_admin LIMIT 1');
    return res.rowCount !== null && res.rowCount > 0;
  }

  async countPlatformAdmins(): Promise<number> {
    const res = await this.pool.query('SELECT COUNT(*)::int AS n FROM users WHERE is_platform_admin');
    return res.rows[0].n as number;
  }

  async createFirstPlatformAdmin(input: { username: string; passwordHash: string }): Promise<User | null> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise concurrent first-run setups (several instances, double submit):
      // the transaction-scoped advisory lock makes check-then-insert atomic.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:first-platform-admin'))");
      const existing = await client.query('SELECT 1 FROM users WHERE is_platform_admin LIMIT 1');
      if (existing.rowCount !== null && existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(
        'INSERT INTO users (id, username, password_hash, email, is_platform_admin) VALUES ($1, $2, $3, NULL, true)',
        [id, input.username, input.passwordHash],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if ((err as { code?: string }).code === '23505') {
        throw new UsernameTakenError(input.username);
      }
      throw err;
    } finally {
      client.release();
    }
    return { id, username: input.username, passwordHash: input.passwordHash, email: null, isPlatformAdmin: true };
  }

  async getSettings(): Promise<ServerSettings> {
    const res = await this.pool.query('SELECT key, value FROM server_settings');
    const settings: ServerSettings = { ...DEFAULT_SETTINGS };
    for (const r of res.rows) {
      if (r.key === 'signupOpen') {
        settings.signupOpen = r.value === 'true';
      } else if (r.key === 'projectCreation' && (r.value === 'anyone' || r.value === 'platform-admins')) {
        settings.projectCreation = r.value;
      } else if (r.key === 'maxProjectsPerUser' || r.key === 'maxProjectStorageMb') {
        const n = Number(r.value);
        settings[r.key as 'maxProjectsPerUser' | 'maxProjectStorageMb'] = Number.isInteger(n) && n >= 0 ? n : 0;
      } else if (r.key === 'termsUrl' || r.key === 'contactEmail' || r.key === 'serverName') {
        settings[r.key as 'termsUrl' | 'contactEmail' | 'serverName'] = r.value.length > 0 ? r.value : null;
      }
    }
    return settings;
  }

  async updateSettings(patch: Partial<ServerSettings>): Promise<ServerSettings> {
    // A null text setting is stored as a missing key (= the default: none).
    const entries: [string, string | null][] = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        entries.push([key, value === null ? null : String(value)]);
      }
    }
    for (const [key, value] of entries) {
      if (value === null) {
        await this.pool.query('DELETE FROM server_settings WHERE key = $1', [key]);
        continue;
      }
      await this.pool.query(
        `INSERT INTO server_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value],
      );
    }
    return this.getSettings();
  }

  async listUsers(): Promise<UserSummary[]> {
    // project_members is a global table (002); only a COUNT leaves this query.
    const res = await this.pool.query(
      `SELECT u.id, u.username, u.is_platform_admin, COUNT(m.project_id)::int AS projects,
              (COUNT(m.project_id) FILTER (WHERE m.role = 'admin'))::int AS coordinated
         FROM users u LEFT JOIN project_members m ON m.user_id = u.id
        GROUP BY u.id, u.username, u.is_platform_admin
        ORDER BY u.username`,
    );
    return res.rows.map((r) => ({
      userId: r.id,
      username: r.username,
      isPlatformAdmin: r.is_platform_admin,
      projects: r.projects,
      coordinatedProjects: r.coordinated,
    }));
  }

  async createPasswordReset(userId: string, expiresAt: number): Promise<string> {
    const token = generateToken();
    await this.pool.query(
      'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hashToken(token), userId, new Date(expiresAt)],
    );
    return token;
  }

  async consumePasswordReset(token: string, now: number): Promise<string | null> {
    // One UPDATE = atomic single use, even with concurrent submits.
    const res = await this.pool.query(
      `UPDATE password_resets SET used_at = $2
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
        RETURNING user_id`,
      [hashToken(token), new Date(now)],
    );
    return res.rowCount === 0 ? null : (res.rows[0].user_id as string);
  }

  async addMembership(projectId: string, userId: string, role: Role): Promise<void> {
    await this.pool.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [projectId, userId, role],
    );
  }

  async getMembership(projectId: string, userId: string): Promise<TokenMembership | null> {
    const res = await this.pool.query(
      'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
      [projectId, userId],
    );
    return res.rowCount === 0 ? null : { projectId, role: res.rows[0].role };
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    const res = await this.pool.query(
      `SELECT m.project_id, p.name, m.role
         FROM project_members m JOIN projects p ON p.id = m.project_id
        WHERE m.user_id = $1
        ORDER BY p.name`,
      [userId],
    );
    return res.rows.map((r) => ({ projectId: r.project_id, projectName: r.name, role: r.role }));
  }

  async listMembers(projectId: string): Promise<Member[]> {
    const res = await this.pool.query(
      `SELECT m.user_id, u.username, m.role
         FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1
        ORDER BY u.username`,
      [projectId],
    );
    return res.rows.map((r) => ({ userId: r.user_id, username: r.username, role: r.role }));
  }

  async setMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
    await this.pool.query(
      'UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2',
      [projectId, userId, role],
    );
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('DELETE FROM assignments WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    });
  }

  async countAdmins(projectId: string): Promise<number> {
    const res = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'",
      [projectId],
    );
    return res.rows[0].n as number;
  }

  async countCoordinatedProjects(userId: string): Promise<number> {
    const res = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM project_members WHERE user_id = $1 AND role = 'admin'",
      [userId],
    );
    return res.rows[0].n as number;
  }

  async createInvite(input: CreateInviteInput): Promise<string> {
    const token = generateToken();
    await this.pool.query(
      `INSERT INTO invites (id, token_hash, project_id, role, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        hashToken(token),
        input.projectId,
        input.role,
        input.maxUses,
        input.expiresAt === null ? null : new Date(input.expiresAt),
        input.createdBy,
      ],
    );
    return token;
  }

  async getInvite(token: string): Promise<Invite | null> {
    const res = await this.pool.query(
      `SELECT i.project_id, p.name, i.role, i.max_uses, i.used_count, i.expires_at, i.revoked_at
         FROM invites i JOIN projects p ON p.id = i.project_id
        WHERE i.token_hash = $1`,
      [hashToken(token)],
    );
    if (res.rowCount === 0) {
      return null;
    }
    const r = res.rows[0];
    return {
      projectId: r.project_id,
      projectName: r.name,
      role: r.role,
      maxUses: r.max_uses,
      usedCount: r.used_count,
      expiresAt: r.expires_at === null ? null : (r.expires_at as Date).getTime(),
      revoked: r.revoked_at !== null,
    };
  }

  async listInvites(projectId: string, now: number): Promise<InviteSummary[]> {
    const res = await this.pool.query(
      `SELECT id, role, max_uses, used_count, expires_at, created_at
         FROM invites
        WHERE project_id = $1
          AND revoked_at IS NULL
          AND used_count < max_uses
          AND (expires_at IS NULL OR expires_at >= $2)
        ORDER BY created_at`,
      [projectId, new Date(now)],
    );
    return res.rows.map((r) => ({
      id: r.id,
      role: r.role,
      maxUses: r.max_uses,
      usedCount: r.used_count,
      expiresAt: r.expires_at === null ? null : (r.expires_at as Date).getTime(),
      createdAt: (r.created_at as Date).getTime(),
    }));
  }

  async revokeInvite(projectId: string, inviteId: string): Promise<boolean> {
    // The project_id predicate is the tenant fence: an id of another project matches
    // nothing. A non-UUID id would make Postgres raise; it is simply "not found".
    if (!isUuid(inviteId)) {
      return false;
    }
    const res = await this.pool.query(
      'UPDATE invites SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL',
      [inviteId, projectId],
    );
    return res.rowCount !== null && res.rowCount > 0;
  }

  async consumeInvite(token: string, now: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE invites SET used_count = used_count + 1
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND used_count < max_uses
          AND (expires_at IS NULL OR expires_at > $2)
        RETURNING token_hash`,
      [hashToken(token), new Date(now)],
    );
    return res.rowCount !== null && res.rowCount > 0;
  }

  async putCsvFile(projectId: string, filename: string, data: Buffer, plotKeys?: string[]): Promise<CsvFile> {
    const checksum = checksumOf(data);
    // The route passes the plot ids it read with the survey's key count.
    const plotCount = plotKeys ? plotKeys.length : plotCountOf(data);
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `INSERT INTO csv_files (id, project_id, filename, checksum, plot_count, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, filename) DO UPDATE SET
           checksum = EXCLUDED.checksum, plot_count = EXCLUDED.plot_count, data = EXCLUDED.data
         RETURNING id, filename, checksum, plot_count, distribution`,
        [randomUUID(), projectId, filename, checksum, plotCount, data],
      );
      const meta = mapCsvFile(res.rows[0]);
      if (plotKeys && meta.distribution) {
        // A replaced file keeps the holdings of the plot ids it still has.
        await client.query(
          `DELETE FROM plot_assignments
            WHERE project_id = $1 AND csv_file_id = $2 AND NOT (plot_key = ANY($3::text[]))`,
          [projectId, meta.id, plotKeys],
        );
      }
      return meta;
    });
  }

  async listCsvFiles(projectId: string): Promise<CsvFile[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT id, filename, checksum, plot_count, distribution FROM csv_files WHERE project_id = $1 ORDER BY filename',
        [projectId],
      );
      return res.rows.map(mapCsvFile);
    });
  }

  async recountPlots(projectId: string, keyCount: number): Promise<void> {
    await this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT id, data FROM csv_files WHERE project_id = $1', [projectId]);
      for (const row of res.rows as { id: string; data: Buffer }[]) {
        await client.query('UPDATE csv_files SET plot_count = $3 WHERE project_id = $1 AND id = $2', [
          projectId,
          row.id,
          plotCountOf(row.data, keyCount),
        ]);
      }
    });
  }

  async getCsvFile(projectId: string, csvFileId: string): Promise<(CsvFile & { data: Buffer }) | null> {
    if (!isUuid(csvFileId)) {
      return null;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT id, filename, checksum, plot_count, distribution, data FROM csv_files WHERE project_id = $1 AND id = $2',
        [projectId, csvFileId],
      );
      if (res.rowCount === 0) {
        return null;
      }
      return { ...mapCsvFile(res.rows[0]), data: res.rows[0].data as Buffer };
    });
  }

  async setAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('DELETE FROM assignments WHERE project_id = $1', [projectId]);
      for (const a of assignments) {
        // ON CONFLICT DO NOTHING tolerates duplicate pairs; FK enforces valid csv/user.
        // Divided files are skipped: their plots are given out one by one.
        await client.query(
          `INSERT INTO assignments (project_id, csv_file_id, user_id)
           SELECT $1, id, $3 FROM csv_files WHERE project_id = $1 AND id = $2 AND distribution IS NULL
           ON CONFLICT DO NOTHING`,
          [projectId, a.csvFileId, a.userId],
        );
      }
    });
  }

  async listAssignments(projectId: string): Promise<AssignmentDetail[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT a.user_id, u.username, a.csv_file_id, c.filename
           FROM assignments a
           JOIN users u ON u.id = a.user_id
           JOIN csv_files c ON c.id = a.csv_file_id
          WHERE a.project_id = $1
          ORDER BY u.username, c.filename`,
        [projectId],
      );
      return res.rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        csvFileId: r.csv_file_id,
        filename: r.filename,
      }));
    });
  }

  async listAssignmentsForUser(projectId: string, userId: string): Promise<CsvFile[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT c.id, c.filename, c.checksum, c.plot_count
           FROM assignments a JOIN csv_files c ON c.id = a.csv_file_id
          WHERE a.project_id = $1 AND a.user_id = $2
          ORDER BY c.filename`,
        [projectId, userId],
      );
      return res.rows.map((r) => ({ id: r.id, filename: r.filename, checksum: r.checksum, plotCount: r.plot_count }));
    });
  }

  async isAssigned(projectId: string, csvFileId: string, userId: string): Promise<boolean> {
    if (!isUuid(csvFileId)) {
      return false;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT 1 FROM assignments WHERE project_id = $1 AND csv_file_id = $2 AND user_id = $3',
        [projectId, csvFileId, userId],
      );
      return res.rowCount !== null && res.rowCount > 0;
    });
  }

  async setDivision(
    projectId: string,
    csvFileId: string,
    distribution: StoredDistribution | null,
    plots: PlotAssignment[],
  ): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('UPDATE csv_files SET distribution = $3 WHERE project_id = $1 AND id = $2', [
        projectId,
        csvFileId,
        distribution === null ? null : JSON.stringify(distribution),
      ]);
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1 AND csv_file_id = $2', [projectId, csvFileId]);
      if (distribution === null) {
        return;
      }
      await client.query('DELETE FROM assignments WHERE project_id = $1 AND csv_file_id = $2', [projectId, csvFileId]);
      for (let i = 0; i < plots.length; i += PLOT_INSERT_CHUNK) {
        const chunk = plots.slice(i, i + PLOT_INSERT_CHUNK);
        await client.query(
          `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap)
           SELECT $1, $2, t.plot_key, t.user_id, t.overlap
             FROM unnest($3::text[], $4::uuid[], $5::boolean[]) AS t(plot_key, user_id, overlap)
           ON CONFLICT DO NOTHING`,
          [projectId, csvFileId, chunk.map((a) => a.plotKey), chunk.map((a) => a.userId), chunk.map((a) => a.overlap)],
        );
      }
    });
  }

  async listPlotAssignments(projectId: string, csvFileId: string): Promise<PlotAssignment[]> {
    if (!isUuid(csvFileId)) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT plot_key, user_id, overlap FROM plot_assignments WHERE project_id = $1 AND csv_file_id = $2',
        [projectId, csvFileId],
      );
      return res.rows.map((r) => ({ plotKey: r.plot_key, userId: r.user_id, overlap: r.overlap }));
    });
  }

  async listPlotHoldings(projectId: string, userId: string): Promise<({ csvFileId: string } & UserPlots)[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT c.id, array_agg(p.plot_key) AS plot_keys,
                COALESCE(array_agg(p.plot_key) FILTER (WHERE p.overlap), '{}') AS copy_keys
           FROM plot_assignments p JOIN csv_files c ON c.id = p.csv_file_id
          WHERE p.project_id = $1 AND p.user_id = $2 AND c.distribution IS NOT NULL
          GROUP BY c.id, c.filename
          ORDER BY c.filename`,
        [projectId, userId],
      );
      return res.rows.map((r) => ({ csvFileId: r.id, plotKeys: r.plot_keys as string[], copyKeys: r.copy_keys as string[] }));
    });
  }

  async listDividedHoldings(projectId: string): Promise<PlotAssignment[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT p.plot_key, p.user_id, p.overlap
           FROM plot_assignments p JOIN csv_files c ON c.id = p.csv_file_id
          WHERE p.project_id = $1 AND c.distribution IS NOT NULL`,
        [projectId],
      );
      return res.rows.map((r) => ({ plotKey: r.plot_key as string, userId: r.user_id as string, overlap: r.overlap as boolean }));
    });
  }

  async countPlotHolders(projectId: string): Promise<Map<string, number>> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT p.csv_file_id, COUNT(DISTINCT p.user_id)::int AS n
           FROM plot_assignments p JOIN csv_files c ON c.id = p.csv_file_id
          WHERE p.project_id = $1 AND c.distribution IS NOT NULL
          GROUP BY p.csv_file_id`,
        [projectId],
      );
      return new Map(res.rows.map((r) => [r.csv_file_id as string, r.n as number]));
    });
  }

  async listUserPlots(projectId: string, csvFileId: string, userId: string): Promise<UserPlots> {
    if (!isUuid(csvFileId)) {
      return { plotKeys: [], copyKeys: [] };
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT p.plot_key, p.overlap
           FROM plot_assignments p JOIN csv_files c ON c.id = p.csv_file_id
          WHERE p.project_id = $1 AND p.csv_file_id = $2 AND p.user_id = $3 AND c.distribution IS NOT NULL`,
        [projectId, csvFileId, userId],
      );
      return {
        plotKeys: res.rows.map((r) => r.plot_key as string),
        copyKeys: res.rows.filter((r) => r.overlap === true).map((r) => r.plot_key as string),
      };
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function mapCsvFile(r: Record<string, unknown>): CsvFile {
  return {
    id: r.id as string,
    filename: r.filename as string,
    checksum: r.checksum as string,
    plotCount: r.plot_count as number,
    distribution: (r.distribution as StoredDistribution | null) ?? null,
  };
}

function mapUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    username: r.username as string,
    passwordHash: r.password_hash as string,
    email: (r.email as string | null) ?? null,
    isPlatformAdmin: r.is_platform_admin === true,
    termsAcceptedAt: r.terms_accepted_at ? (r.terms_accepted_at as Date).getTime() : null,
  };
}

function mapRecord(r: Record<string, unknown>): RecordRow {
  return {
    projectId: r.project_id as string,
    recordKey: r.record_key as string,
    operator: r.operator as string,
    modifiedOn: (r.modified_on as Date).getTime(),
    receivedAt: (r.received_at as Date).getTime(),
    activelySaved: r.actively_saved as boolean,
    step: r.step as number,
    xml: (r.xml as string | null) ?? null,
    summary: (r.summary as Record<string, string> | null) ?? {},
    deleted: r.deleted as boolean,
    deletedOn: r.deleted_on === null ? null : (r.deleted_on as Date).getTime(),
  };
}
