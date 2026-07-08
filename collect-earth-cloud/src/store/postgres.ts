import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from '../auth.js';
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
import { UsernameTakenError } from './memory.js';
import { checksumOf, plotCountOf } from '../csv.js';

const { Pool } = pg;

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

  async putCep(projectId: string, cep: Buffer): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query(
        `INSERT INTO project_ceps (project_id, data) VALUES ($1, $2)
         ON CONFLICT (project_id) DO UPDATE SET data = EXCLUDED.data`,
        [projectId, cep],
      );
    });
  }

  async getCep(projectId: string): Promise<Buffer | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT data FROM project_ceps WHERE project_id = $1', [projectId]);
      return res.rowCount === 0 ? null : (res.rows[0].data as Buffer);
    });
  }

  async createUser(input: { username: string; passwordHash: string; email: string | null }): Promise<User> {
    const id = randomUUID();
    try {
      await this.pool.query(
        'INSERT INTO users (id, username, password_hash, email) VALUES ($1, $2, $3, $4)',
        [id, input.username, input.passwordHash, input.email],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new UsernameTakenError(input.username);
      }
      throw err;
    }
    return { id, username: input.username, passwordHash: input.passwordHash, email: input.email };
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT id, username, password_hash, email FROM users WHERE username = $1',
      [username],
    );
    return res.rowCount === 0 ? null : mapUser(res.rows[0]);
  }

  async getUserById(userId: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT id, username, password_hash, email FROM users WHERE id = $1',
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
    await this.pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  }

  async countAdmins(projectId: string): Promise<number> {
    const res = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM project_members WHERE project_id = $1 AND role = 'admin'",
      [projectId],
    );
    return res.rows[0].n as number;
  }

  async createInvite(input: CreateInviteInput): Promise<string> {
    const token = generateToken();
    await this.pool.query(
      `INSERT INTO invites (token_hash, project_id, role, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
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
      `SELECT i.project_id, p.name, i.role, i.max_uses, i.used_count, i.expires_at
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
    };
  }

  async consumeInvite(token: string, now: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE invites SET used_count = used_count + 1
        WHERE token_hash = $1
          AND used_count < max_uses
          AND (expires_at IS NULL OR expires_at > $2)
        RETURNING token_hash`,
      [hashToken(token), new Date(now)],
    );
    return res.rowCount !== null && res.rowCount > 0;
  }

  async putCsvFile(projectId: string, filename: string, data: Buffer): Promise<CsvFile> {
    const checksum = checksumOf(data);
    const plotCount = plotCountOf(data);
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `INSERT INTO csv_files (id, project_id, filename, checksum, plot_count, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_id, filename) DO UPDATE SET
           checksum = EXCLUDED.checksum, plot_count = EXCLUDED.plot_count, data = EXCLUDED.data
         RETURNING id, filename, checksum, plot_count`,
        [randomUUID(), projectId, filename, checksum, plotCount, data],
      );
      const r = res.rows[0];
      return { id: r.id, filename: r.filename, checksum: r.checksum, plotCount: r.plot_count };
    });
  }

  async listCsvFiles(projectId: string): Promise<CsvFile[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT id, filename, checksum, plot_count FROM csv_files WHERE project_id = $1 ORDER BY filename',
        [projectId],
      );
      return res.rows.map((r) => ({ id: r.id, filename: r.filename, checksum: r.checksum, plotCount: r.plot_count }));
    });
  }

  async getCsvFile(projectId: string, csvFileId: string): Promise<(CsvFile & { data: Buffer }) | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT id, filename, checksum, plot_count, data FROM csv_files WHERE project_id = $1 AND id = $2',
        [projectId, csvFileId],
      );
      if (res.rowCount === 0) {
        return null;
      }
      const r = res.rows[0];
      return { id: r.id, filename: r.filename, checksum: r.checksum, plotCount: r.plot_count, data: r.data as Buffer };
    });
  }

  async setAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('DELETE FROM assignments WHERE project_id = $1', [projectId]);
      for (const a of assignments) {
        // ON CONFLICT DO NOTHING tolerates duplicate pairs; FK enforces valid csv/user.
        await client.query(
          `INSERT INTO assignments (project_id, csv_file_id, user_id) VALUES ($1, $2, $3)
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
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT 1 FROM assignments WHERE project_id = $1 AND csv_file_id = $2 AND user_id = $3',
        [projectId, csvFileId, userId],
      );
      return res.rowCount !== null && res.rowCount > 0;
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function mapUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string,
    username: r.username as string,
    passwordHash: r.password_hash as string,
    email: (r.email as string | null) ?? null,
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
