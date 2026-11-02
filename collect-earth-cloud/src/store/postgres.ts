import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { isUuid } from '../accountRules.js';
import { generateToken, hashToken } from '../auth.js';
import { PUBLIC_SCHEMA_FIX } from './migrate.js';
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
  type AiToolCall,
  type AiUsage,
  type Assignment,
  type AssignmentDetail,
  type AuditAction,
  type AuditDetails,
  type AuditEntry,
  type AuditInput,
  type AuditQuery,
  type CepInfo,
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
  type RecordChange,
  type RecordEvent,
  type RecordEventInput,
  type RecordEventQuery,
  type RecordRow,
  type RecordState,
  type RoundInfo,
  type ServerSettings,
  type StoredDistribution,
  type Role,
  type User,
  type UserSummary,
} from '../types.js';
import { checkCursor, type CreateInviteInput, type CreateProjectResult, type Store, type TokenMembership, type UserPlots } from './store.js';
import { UsernameTakenError } from './memory.js';
import { checksumOf, plotCountOf } from '../csv.js';
import { legacyRoundInfo } from '../cep.js';
import { fileKeyCount } from '../rounds.js';

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
export interface PostgresStoreOptions {
  /** Most connections in the pool (pg's default, 10, when not given). */
  max?: number;
  /** How long to wait for a connection before failing (pg's default: for ever). */
  connectionTimeoutMillis?: number;
  /** When set, every project transaction runs with this statement_timeout (SET LOCAL). */
  statementTimeoutMs?: number;
  /** Called when an idle connection of the pool fails (the database restarts, the network drops); logged by default. */
  onPoolError?: (err: Error) => void;
}

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;
  private readonly statementTimeout: string | null;

  constructor(
    private readonly databaseUrl: string,
    options: PostgresStoreOptions = {},
  ) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ...(options.max ? { max: options.max } : {}),
      ...(options.connectionTimeoutMillis ? { connectionTimeoutMillis: options.connectionTimeoutMillis } : {}),
    });
    // Without a listener, an idle connection that fails is an uncaught 'error' event,
    // which ends the process. pg drops the connection itself; the next query gets a new one.
    const onPoolError =
      options.onPoolError ??
      ((err: Error) => {
        // eslint-disable-next-line no-console
        console.error('postgres: an idle connection of the pool failed:', err.message);
      });
    this.pool.on('error', onPoolError);
    this.statementTimeout = options.statementTimeoutMs ? String(Math.round(options.statementTimeoutMs)) : null;
  }

  /** Runs fn inside a transaction scoped to a project for RLS enforcement. */
  private async withProject<T>(projectId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.current_project', projectId]);
      if (this.statementTimeout !== null) {
        await client.query("SELECT set_config('statement_timeout', $1, true)", [this.statementTimeout]);
      }
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
      // The new project's own id, so its row passes the projects policy (RLS).
      await client.query('SELECT set_config($1, $2, true)', ['app.current_project', projectId]);
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
    for (let attempt = 1; ; attempt++) {
      try {
        await this.deleteProjectOnce(projectId);
        return;
      } catch (err) {
        // A sync of the project can still meet it in a deadlock (its foreign-key check
        // shares the project's row before its trigger updates it); one of the two is
        // cancelled, and the deletion is simply tried again.
        if ((err as { code?: string }).code !== '40P01' || attempt >= 3) {
          throw err;
        }
        // A random pause (10-50 ms), so the two do not meet again at once.
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 41)));
      }
    }
  }

  private async deleteProjectOnce(projectId: string): Promise<void> {
    await this.withProject(projectId, async (client) => {
      // The project's row first: a sync running meanwhile bumps it (records_version,
      // migration 009) after locking its records, and taking the locks the other way
      // round deadlocked. Now the sync mostly waits for the deletion, or the deletion for it.
      await client.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
      await client.query('DELETE FROM ai_runs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM record_events WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM member_activity WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM audit_log WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM quality_decisions WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM guidance_notes WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM assignments WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM csv_files WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM records WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_ceps WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM invites WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_members WHERE project_id = $1', [projectId]);
      // The only place project_tokens rows are deleted, with the project itself: every
      // project keeps at least one token row while it exists, or eachProject (the AI usage
      // page) would not see it. Anything else that deletes token rows must keep one.
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
      await upsertRecord(client, row);
    });
  }

  async putRecordWithEvent(
    projectId: string,
    recordKey: string,
    operator: string,
    apply: (existing: RecordRow | null, submittedBefore: boolean) => { row: RecordRow; event: RecordEventInput | null } | null,
  ): Promise<boolean> {
    return this.withProject(projectId, async (client) => {
      // Uploads of one record one after the other, also when it does not exist yet (no
      // row to lock): two retries at once log one event, not two. Its own statement, so
      // the read below sees what the one before committed.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('collect-earth-cloud:record:' || $1 || ' ' || $2 || ' ' || $3, 0))", [
        projectId,
        recordKey,
        operator,
      ]);
      const submittedSql = `EXISTS (SELECT 1 FROM record_events e
                                     WHERE e.project_id = $1 AND e.record_key = $2 AND e.operator = $3
                                       AND e.change IN ('submitted', 'resubmitted'))`;
      // FOR UPDATE as well: renameRecordOperator locks the rows, not the record.
      const res = await client.query(
        `SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary,
                deleted, deleted_on, ${submittedSql} AS submitted_before
           FROM records
          WHERE project_id = $1 AND record_key = $2 AND operator = $3
            FOR UPDATE`,
        [projectId, recordKey, operator],
      );
      const existing = res.rowCount === 0 ? null : mapRecord(res.rows[0]);
      const submittedBefore =
        res.rowCount === 0
          ? ((await client.query(`SELECT ${submittedSql} AS submitted_before`, [projectId, recordKey, operator])).rows[0].submitted_before as boolean)
          : (res.rows[0].submitted_before as boolean);
      const out = apply(existing, submittedBefore);
      if (out === null) {
        return false;
      }
      await upsertRecord(client, { ...out.row, projectId });
      if (out.event) {
        await insertRecordEvent(client, { ...out.event, projectId });
      }
      return true;
    });
  }

  async renameRecordOperator(projectId: string, recordKey: string, from: string, to: string): Promise<boolean> {
    if (from === to) {
      return false;
    }
    return this.withProject(projectId, async (client) => {
      // Both rows locked, in a fixed order (by operator), so two uploads of the record cannot cross.
      const res = await client.query(
        `SELECT operator, modified_on FROM records
          WHERE project_id = $1 AND record_key = $2 AND operator = ANY($3::text[])
          ORDER BY operator COLLATE "C" FOR UPDATE`,
        [projectId, recordKey, [from, to]],
      );
      const old = res.rows.find((r) => r.operator === from);
      if (!old) {
        return false;
      }
      const current = res.rows.find((r) => r.operator === to);
      if (current && (old.modified_on as Date).getTime() <= (current.modified_on as Date).getTime()) {
        await client.query('DELETE FROM records WHERE project_id = $1 AND record_key = $2 AND operator = $3', [projectId, recordKey, from]);
        return true;
      }
      if (current) {
        await client.query('DELETE FROM records WHERE project_id = $1 AND record_key = $2 AND operator = $3', [projectId, recordKey, to]);
      }
      await client.query('UPDATE records SET operator = $4 WHERE project_id = $1 AND record_key = $2 AND operator = $3', [projectId, recordKey, from, to]);
      return true;
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

  async listRecordSummaries(projectId: string, options: { firstSubmissions?: boolean } = {}): Promise<RecordRow[]> {
    return this.withProject(projectId, async (client) => {
      if (options.firstSubmissions) {
        // The first submission as listRecordStates reads it (its event `submitted`).
        const res = await client.query(
          `SELECT r.project_id, r.record_key, r.operator, r.modified_on, r.received_at, r.actively_saved, r.step, NULL AS xml, r.summary,
                  r.deleted, r.deleted_on, floor(EXTRACT(EPOCH FROM e.first_submitted_on) * 1000)::float8 AS first_submitted_on
             FROM records r
             LEFT JOIN (SELECT record_key, operator, min(modified_on) AS first_submitted_on
                          FROM record_events
                         WHERE project_id = $1 AND change = 'submitted'
                         GROUP BY record_key, operator) e
               ON e.record_key = r.record_key AND e.operator = r.operator
            WHERE r.project_id = $1 AND NOT r.deleted`,
          [projectId],
        );
        return res.rows.map((r) => ({ ...mapRecord(r), firstSubmittedOn: (r.first_submitted_on as number | null) ?? null }));
      }
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

  async getRecordSummaries(projectId: string, keys: readonly { recordKey: string; operator: string }[]): Promise<RecordRow[]> {
    if (keys.length === 0) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT r.project_id, r.record_key, r.operator, r.modified_on, r.received_at, r.actively_saved, r.step, NULL AS xml, r.summary,
                r.deleted, r.deleted_on
           FROM records r
           JOIN (SELECT DISTINCT * FROM unnest($2::text[], $3::text[])) AS k(record_key, operator)
             ON k.record_key = r.record_key AND k.operator = r.operator
          WHERE r.project_id = $1`,
        [projectId, keys.map((k) => k.recordKey), keys.map((k) => k.operator)],
      );
      return res.rows.map(mapRecord);
    });
  }

  async listRecordsByKeys(projectId: string, recordKeys: readonly string[]): Promise<RecordRow[]> {
    if (recordKeys.length === 0) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT r.project_id, r.record_key, r.operator, r.modified_on, r.received_at, r.actively_saved, r.step, NULL AS xml, r.summary,
                r.deleted, r.deleted_on
           FROM records r
          WHERE r.project_id = $1 AND r.record_key = ANY($2::text[])`,
        [projectId, [...new Set(recordKeys)]],
      );
      return res.rows.map(mapRecord);
    });
  }

  async listRecordStates(projectId: string): Promise<RecordState[]> {
    return this.withProject(projectId, async (client) => {
      // A record's first submission: its event `submitted` (one per record; min() to be
      // safe). Rows as arrays and times as epoch ms (float8): for 100,000 records the
      // parsing costs more than the query.
      const res = await client.query({
        text: `SELECT r.record_key, r.operator, r.actively_saved,
                      floor(EXTRACT(EPOCH FROM r.modified_on) * 1000)::float8,
                      floor(EXTRACT(EPOCH FROM e.first_submitted_on) * 1000)::float8
                 FROM records r
                 LEFT JOIN (SELECT record_key, operator, min(modified_on) AS first_submitted_on
                              FROM record_events
                             WHERE project_id = $1 AND change = 'submitted'
                             GROUP BY record_key, operator) e
                   ON e.record_key = r.record_key AND e.operator = r.operator
                WHERE r.project_id = $1 AND NOT r.deleted`,
        values: [projectId],
        rowMode: 'array',
      });
      return (res.rows as [string, string, boolean, number, number | null][]).map(([recordKey, operator, activelySaved, modifiedOn, first]) => ({
        recordKey,
        operator,
        activelySaved,
        deleted: false,
        modifiedOn,
        firstSubmittedOn: first,
      }));
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
      // The file's bytes only when there is no round info yet (a project file stored before it was kept).
      const res = await client.query(
        'SELECT round_info, CASE WHEN round_info IS NULL THEN data END AS data FROM project_ceps WHERE project_id = $1',
        [projectId],
      );
      if (res.rowCount === 0) {
        return null;
      }
      const stored = res.rows[0].round_info as RoundInfo | null;
      if (stored) {
        return stored;
      }
      // Read it once and keep it. Under the row lock of the UPDATE, only the first of two
      // concurrent readers (or an upload that came first) writes it; the others read what
      // was written. Plot counts follow, in the same transaction, when the file reads plots
      // with other than one key column.
      const info = res.rows[0].data ? legacyRoundInfo(res.rows[0].data as Buffer) : null;
      if (!info) {
        return null;
      }
      const updated = await client.query(
        'UPDATE project_ceps SET round_info = $2 WHERE project_id = $1 AND round_info IS NULL',
        [projectId, JSON.stringify(info)],
      );
      if (updated.rowCount === 0) {
        const now = await client.query('SELECT round_info FROM project_ceps WHERE project_id = $1', [projectId]);
        return (now.rows[0]?.round_info as RoundInfo | null) ?? null;
      }
      if (fileKeyCount(info) !== 1) {
        await this.recountPlotsWith(client, projectId, fileKeyCount(info));
      }
      return info;
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockUsername(client, input.username);
      // A deleted account's username is retired (migration 010): taken, as a live one.
      const res = await client.query(
        `INSERT INTO users (id, username, password_hash, email, terms_accepted_at)
         SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM retired_usernames WHERE username = $2)`,
        [id, input.username, input.passwordHash, input.email, termsAcceptedAt === null ? null : new Date(termsAcceptedAt)],
      );
      if (res.rowCount === 0) {
        throw new UsernameTakenError(input.username);
      }
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
      const named = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
      const username = named.rows[0]?.username as string | undefined;
      if (username !== undefined) {
        await lockUsername(client, username);
      }
      let hasRecords = false;
      for (const r of projects.rows) {
        await client.query('SELECT set_config($1, $2, true)', ['app.current_project', r.project_id]);
        if (username !== undefined && !hasRecords) {
          const found = await client.query('SELECT 1 FROM records WHERE project_id = $1 AND operator = $2 LIMIT 1', [r.project_id, username]);
          hasRecords = (found.rowCount ?? 0) > 0;
        }
        await client.query('DELETE FROM assignments WHERE project_id = $1 AND user_id = $2', [r.project_id, userId]);
        await client.query('DELETE FROM plot_assignments WHERE project_id = $1 AND user_id = $2', [r.project_id, userId]);
        await client.query('DELETE FROM member_activity WHERE project_id = $1 AND user_id = $2', [r.project_id, userId]);
      }
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM project_members WHERE user_id = $1', [userId]);
      // invites.created_by and audit_log.actor_user_id (in every project, also those
      // the account left) are ON DELETE SET NULL; records keep the operator name, so
      // with records in one of the account's projects the username is retired: a new
      // account under it would inherit their figures.
      if (hasRecords) {
        await client.query('INSERT INTO retired_usernames (username) VALUES ($1) ON CONFLICT DO NOTHING', [username]);
      }
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
      await lockUsername(client, input.username);
      const res = await client.query(
        `INSERT INTO users (id, username, password_hash, email, is_platform_admin)
         SELECT $1, $2, $3, NULL, true WHERE NOT EXISTS (SELECT 1 FROM retired_usernames WHERE username = $2)`,
        [id, input.username, input.passwordHash],
      );
      if (res.rowCount === 0) {
        throw new UsernameTakenError(input.username);
      }
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
      } else if (r.key === 'aiEnabled') {
        settings.aiEnabled = r.value === 'true';
      } else if (r.key === 'aiReportsPerDay' || r.key === 'aiFollowUpsPerDay' || r.key === 'aiMonthlyTokens') {
        const n = Number(r.value);
        const key = r.key as 'aiReportsPerDay' | 'aiFollowUpsPerDay' | 'aiMonthlyTokens';
        settings[key] = Number.isInteger(n) && n >= 0 ? n : DEFAULT_SETTINGS[key];
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
    // The memberships are global (002); each project's name is read under its own
    // project setting, so RLS lets this read only the caller's projects' rows.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const members = await client.query('SELECT project_id, role FROM project_members WHERE user_id = $1', [userId]);
      const out: Membership[] = [];
      for (const m of members.rows) {
        await client.query('SELECT set_config($1, $2, true)', ['app.current_project', m.project_id]);
        const p = await client.query('SELECT name FROM projects WHERE id = $1', [m.project_id]);
        if (p.rowCount !== 0) {
          out.push({ projectId: m.project_id, projectName: p.rows[0].name, role: m.role });
        }
      }
      await client.query('COMMIT');
      return out.sort((a, b) => a.projectName.localeCompare(b.projectName));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
      await client.query('DELETE FROM member_activity WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('UPDATE audit_log SET actor_user_id = NULL WHERE project_id = $1 AND actor_user_id = $2', [projectId, userId]);
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

  async createInvite(input: CreateInviteInput): Promise<{ token: string; id: string }> {
    const token = generateToken();
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO invites (id, token_hash, project_id, role, max_uses, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        hashToken(token),
        input.projectId,
        input.role,
        input.maxUses,
        input.expiresAt === null ? null : new Date(input.expiresAt),
        input.createdBy,
      ],
    );
    return { token, id };
  }

  async getInvite(token: string): Promise<Invite | null> {
    // Invites are global (002); the project's name is read under the invite's project.
    const client = await this.pool.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r: Record<string, any>;
    try {
      await client.query('BEGIN READ ONLY');
      const res = await client.query(
        'SELECT project_id, role, max_uses, used_count, expires_at, revoked_at FROM invites WHERE token_hash = $1',
        [hashToken(token)],
      );
      if (res.rowCount === 0) {
        await client.query('COMMIT');
        return null;
      }
      r = res.rows[0];
      await client.query('SELECT set_config($1, $2, true)', ['app.current_project', r.project_id]);
      const p = await client.query('SELECT name FROM projects WHERE id = $1', [r.project_id]);
      await client.query('COMMIT');
      if (p.rowCount === 0) {
        return null;
      }
      r.name = p.rows[0].name;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
    await this.withProject(projectId, (client) => this.recountPlotsWith(client, projectId, keyCount));
  }

  private async recountPlotsWith(client: pg.PoolClient, projectId: string, keyCount: number): Promise<void> {
    const res = await client.query('SELECT id, data FROM csv_files WHERE project_id = $1', [projectId]);
    for (const row of res.rows as { id: string; data: Buffer }[]) {
      await client.query('UPDATE csv_files SET plot_count = $3 WHERE project_id = $1 AND id = $2', [
        projectId,
        row.id,
        plotCountOf(row.data, keyCount),
      ]);
    }
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

  async listPlotHolders(projectId: string, csvFileIds: readonly string[], plotKeys: readonly string[]): Promise<(PlotAssignment & { csvFileId: string })[]> {
    const ids = [...new Set(csvFileIds)].filter(isUuid);
    if (ids.length === 0 || plotKeys.length === 0) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT csv_file_id, plot_key, user_id, overlap FROM plot_assignments
          WHERE project_id = $1 AND csv_file_id = ANY($2::uuid[]) AND plot_key = ANY($3::text[])`,
        [projectId, ids, [...new Set(plotKeys)]],
      );
      return res.rows.map((r) => ({ csvFileId: r.csv_file_id as string, plotKey: r.plot_key as string, userId: r.user_id as string, overlap: r.overlap as boolean }));
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

  // --- Quality review ---

  async qualityVersion(projectId: string): Promise<string> {
    return this.withProject(projectId, async (client) => {
      // A counter the triggers of migration 009 bump on every INSERT, UPDATE and
      // DELETE statement on records and plot_assignments, whatever wrote it.
      const res = await client.query('SELECT records_version FROM projects WHERE id = $1', [projectId]);
      return res.rows.length === 0 ? '' : String(res.rows[0].records_version);
    });
  }

  recordsSource(): { databaseUrl: string } | null {
    return { databaseUrl: this.databaseUrl };
  }

  async getQualitySettings(projectId: string): Promise<QualitySettings> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT quality_settings FROM projects WHERE id = $1', [projectId]);
      const stored = res.rows[0]?.quality_settings as QualitySettings | null | undefined;
      const fastSeconds = stored?.fastSeconds;
      return { margins: { ...(stored?.margins ?? {}) }, ...(typeof fastSeconds === 'number' ? { fastSeconds } : {}) };
    });
  }

  async patchQualitySettings(projectId: string, patch: Partial<QualitySettings>): Promise<QualitySettings> {
    return this.withProject(projectId, async (client) => {
      // One statement: two saves at once (margins and the threshold) never undo each other.
      const res = await client.query(
        `UPDATE projects SET quality_settings = COALESCE(quality_settings, '{}'::jsonb) || $2::jsonb WHERE id = $1 RETURNING quality_settings`,
        [projectId, JSON.stringify(patch)],
      );
      const stored = res.rows[0]?.quality_settings as QualitySettings | null | undefined;
      const fastSeconds = stored?.fastSeconds;
      return { margins: { ...(stored?.margins ?? {}) }, ...(typeof fastSeconds === 'number' ? { fastSeconds } : {}) };
    });
  }

  async setQualitySettings(projectId: string, settings: QualitySettings): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('UPDATE projects SET quality_settings = $2 WHERE id = $1', [projectId, JSON.stringify(settings)]);
    });
  }

  async isAiEnabled(projectId: string): Promise<boolean> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT ai_enabled FROM projects WHERE id = $1', [projectId]);
      return res.rows[0]?.ai_enabled === true;
    });
  }

  async setAiEnabled(projectId: string, enabled: boolean): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('UPDATE projects SET ai_enabled = $2 WHERE id = $1', [projectId, enabled]);
    });
  }

  async listQualityDecisions(projectId: string): Promise<QualityDecision[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT d.plot, d.decision, d.comment, u.username, d.decided_at, d.seen, d.decided_batch
           FROM quality_decisions d LEFT JOIN users u ON u.id = d.decided_by
          WHERE d.project_id = $1
          ORDER BY d.plot COLLATE "C"`,
        [projectId],
      );
      return res.rows.map(mapDecision);
    });
  }

  async setQualityDecision(
    projectId: string,
    plot: string,
    decision: DecisionKind,
    comment: string | null,
    userId: string | null,
    seen: { operator: string; hash: number }[] | null = null,
  ): Promise<QualityDecision> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `WITH d AS (
           INSERT INTO quality_decisions (project_id, plot, decision, comment, decided_by, decided_at, seen)
           VALUES ($1, $2, $3, $4, $5, now(), $6)
           ON CONFLICT (project_id, plot) DO UPDATE SET
             decision = EXCLUDED.decision, comment = EXCLUDED.comment,
             decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at, seen = EXCLUDED.seen, decided_batch = NULL
           RETURNING plot, decision, comment, decided_by, decided_at, seen, decided_batch)
         SELECT d.plot, d.decision, d.comment, u.username, d.decided_at, d.seen, d.decided_batch FROM d LEFT JOIN users u ON u.id = d.decided_by`,
        [projectId, plot, decision, comment, userId, seen === null ? null : JSON.stringify(seen)],
      );
      return mapDecision(res.rows[0]);
    });
  }

  async addQualityDecisions(
    projectId: string,
    decisions: readonly { plot: string; decision: DecisionKind; seen: { operator: string; hash: number }[] | null }[],
    comment: string | null,
    userId: string | null,
    batch: string,
  ): Promise<string[]> {
    if (decisions.length === 0) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      // One statement in the transaction: a plot decided meanwhile keeps its decision.
      const res = await client.query(
        `INSERT INTO quality_decisions (project_id, plot, decision, comment, decided_by, decided_at, seen, decided_batch)
         SELECT $1, d.plot, d.decision, $5, $6, now(), d.seen::jsonb, $7::uuid
           FROM unnest($2::text[], $3::text[], $4::text[]) AS d(plot, decision, seen)
         ON CONFLICT (project_id, plot) DO NOTHING
         RETURNING plot`,
        [
          projectId,
          decisions.map((d) => d.plot),
          decisions.map((d) => d.decision),
          decisions.map((d) => (d.seen === null ? null : JSON.stringify(d.seen))),
          comment,
          userId,
          batch,
        ],
      );
      return res.rows.map((r) => r.plot as string);
    });
  }

  async deleteQualityDecision(projectId: string, plot: string): Promise<boolean> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('DELETE FROM quality_decisions WHERE project_id = $1 AND plot = $2', [projectId, plot]);
      return (res.rowCount ?? 0) > 0;
    });
  }

  async listGuidanceNotes(projectId: string): Promise<GuidanceNote[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT n.id, n.question_key, n.first_value, n.check_value, n.text, u.username, n.updated_at
           FROM guidance_notes n LEFT JOIN users u ON u.id = n.updated_by
          WHERE n.project_id = $1
          ORDER BY n.question_key COLLATE "C", COALESCE(n.first_value, '') COLLATE "C",
                   COALESCE(n.check_value, '') COLLATE "C", n.id::text COLLATE "C"`,
        [projectId],
      );
      return res.rows.map(mapNote);
    });
  }

  async createGuidanceNote(projectId: string, note: GuidanceNoteInput, userId: string | null): Promise<GuidanceNote> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `WITH n AS (
           INSERT INTO guidance_notes (project_id, question_key, first_value, check_value, text, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, question_key, first_value, check_value, text, updated_by, updated_at)
         SELECT n.*, u.username FROM n LEFT JOIN users u ON u.id = n.updated_by`,
        [projectId, note.questionKey, note.firstValue, note.checkValue, note.text, userId],
      );
      return mapNote(res.rows[0]);
    });
  }

  async updateGuidanceNote(projectId: string, id: string, note: GuidanceNoteInput, userId: string | null): Promise<GuidanceNote | null> {
    if (!isUuid(id)) {
      return null;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `WITH n AS (
           UPDATE guidance_notes SET question_key = $3, first_value = $4, check_value = $5, text = $6,
                  updated_by = $7, updated_at = now()
            WHERE project_id = $1 AND id = $2
           RETURNING id, question_key, first_value, check_value, text, updated_by, updated_at)
         SELECT n.*, u.username FROM n LEFT JOIN users u ON u.id = n.updated_by`,
        [projectId, id, note.questionKey, note.firstValue, note.checkValue, note.text, userId],
      );
      return res.rowCount === 0 ? null : mapNote(res.rows[0]);
    });
  }

  async deleteGuidanceNote(projectId: string, id: string): Promise<boolean> {
    if (!isUuid(id)) {
      return false;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query('DELETE FROM guidance_notes WHERE project_id = $1 AND id = $2', [projectId, id]);
      return (res.rowCount ?? 0) > 0;
    });
  }

  async startAiRun(projectId: string, start: AiRunStart, w: AiRunWindow): Promise<AiRunStartResult> {
    return this.withProject(projectId, async (client) => {
      // Two requests (or two instances) at once: the second waits here until the first
      // has stored its run, then sees it running.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:ai-run:' || $1))", [projectId]);
      await failStaleRuns(client, projectId, w.staleBefore, AI_INTERRUPTED.code, AI_INTERRUPTED.message, w.now);
      const res = await client.query(
        `SELECT COALESCE(bool_or(status = 'running'), false) AS running,
                count(*) FILTER (WHERE kind = 'report' AND status = 'done' AND started_at >= $2)::int AS reports,
                count(*) FILTER (WHERE kind <> 'report' AND status IN ('done', 'refused') AND started_at >= $2)::int AS answers,
                COALESCE(sum(input_tokens + output_tokens) FILTER (WHERE started_at >= $3), 0)::bigint AS tokens
           FROM ai_runs WHERE project_id = $1 AND (status = 'running' OR started_at >= LEAST($2::timestamptz, $3::timestamptz))`,
        [projectId, new Date(w.dayStart), new Date(w.monthStart)],
      );
      const r = res.rows[0];
      const limit = aiLimitReached(
        start.kind,
        { running: r.running === true, reportsToday: r.reports, answersToday: r.answers, tokensThisMonth: Number(r.tokens) },
        w,
      );
      if (limit) {
        return { ok: false, limit } as const;
      }
      const ins = await client.query(
        `WITH a AS (
           INSERT INTO ai_runs (project_id, kind, started_by, started_at, model, parent_run, finding_index, action, question, question_names)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *)
         SELECT a.*, u.username FROM a LEFT JOIN users u ON u.id = a.started_by`,
        [
          projectId,
          start.kind,
          start.startedBy,
          new Date(w.now),
          start.model,
          start.parentRun ?? null,
          start.findingIndex ?? null,
          start.action ?? null,
          start.question ?? null,
          start.questionNames ? JSON.stringify(start.questionNames) : null,
        ],
      );
      return { ok: true, run: mapAiRun(ins.rows[0]) } as const;
    });
  }

  async updateAiRun(projectId: string, runId: string, progress: AiRunProgress): Promise<void> {
    if (!isUuid(runId)) {
      return;
    }
    await this.withProject(projectId, async (client) => {
      await client.query(
        `UPDATE ai_runs SET input_tokens = $3, output_tokens = $4, tool_calls = $5
          WHERE project_id = $1 AND id = $2 AND status = 'running'`,
        [projectId, runId, progress.inputTokens, progress.outputTokens, JSON.stringify(progress.toolCalls)],
      );
    });
  }

  async finishAiRun(projectId: string, runId: string, end: AiRunEnd): Promise<boolean> {
    if (!isUuid(runId)) {
      return false;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `UPDATE ai_runs SET status = $3, finished_at = $4, input_tokens = $5, output_tokens = $6, tool_calls = $7,
                result = $8, error = $9, error_code = $10
          WHERE project_id = $1 AND id = $2 AND status = 'running'`,
        [
          projectId,
          runId,
          end.status,
          new Date(end.finishedAt),
          end.inputTokens,
          end.outputTokens,
          JSON.stringify(end.toolCalls),
          end.result === null ? null : JSON.stringify(end.result),
          end.error,
          end.errorCode,
        ],
      );
      return (res.rowCount ?? 0) > 0;
    });
  }

  async failStaleAiRuns(projectId: string, before: number, code: string, message: string, now: number): Promise<number> {
    return this.withProject(projectId, (client) => failStaleRuns(client, projectId, before, code, message, now));
  }

  async listAiRuns(projectId: string, limit: number): Promise<AiRunSummary[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT a.id, a.kind, a.status, a.started_at, a.finished_at, a.model, a.input_tokens, a.output_tokens,
                a.parent_run, a.finding_index, a.action, a.error_code, u.username
           FROM ai_runs a LEFT JOIN users u ON u.id = a.started_by
          WHERE a.project_id = $1
          ORDER BY a.started_at DESC, a.id DESC
          LIMIT $2`,
        [projectId, limit],
      );
      return res.rows.map(mapAiRunSummary);
    });
  }

  async getAiRun(projectId: string, runId: string): Promise<AiRunRow | null> {
    if (!isUuid(runId)) {
      return null;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT a.*, u.username FROM ai_runs a LEFT JOIN users u ON u.id = a.started_by WHERE a.project_id = $1 AND a.id = $2',
        [projectId, runId],
      );
      return res.rowCount === 0 ? null : mapAiRun(res.rows[0]);
    });
  }

  async aiUsageSince(from: number): Promise<AiUsage[]> {
    // Totals across projects for the server owner. The app role sees one project's
    // runs at a time (RLS), so each project is read under its own setting, in one
    // read-only transaction, as listMemberships does: nothing bypasses RLS.
    const rows = await this.eachProject(async (client, projectId) => {
      const res = await client.query(
        `SELECT count(*)::int AS runs,
                count(*) FILTER (WHERE kind = 'report')::int AS reports,
                count(*) FILTER (WHERE kind = 'follow_up')::int AS follow_ups,
                count(*) FILTER (WHERE kind = 'question')::int AS questions,
                count(*) FILTER (WHERE status = 'failed')::int AS failed,
                count(*) FILTER (WHERE status = 'refused')::int AS refused,
                COALESCE(sum(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(sum(output_tokens), 0)::bigint AS output_tokens
           FROM ai_runs WHERE project_id = $1 AND started_at >= $2`,
        [projectId, new Date(from)],
      );
      const r = res.rows[0];
      return r.runs === 0
        ? null
        : {
            projectId,
            runs: r.runs as number,
            reports: r.reports as number,
            followUps: r.follow_ups as number,
            questions: r.questions as number,
            failed: r.failed as number,
            refused: r.refused as number,
            inputTokens: Number(r.input_tokens),
            outputTokens: Number(r.output_tokens),
          };
    });
    return rows.filter((r): r is AiUsage => r !== null);
  }

  /**
   * Runs `fn` for every project, each under its own `app.current_project`, in one
   * read-only transaction, in id order (the AI usage page). The ids come from
   * project_tokens, which is not under RLS (the auth index): every project has its two
   * tokens from createProject until deleteProject (test/projectTokens.test.ts). A
   * project without a token row would be left out here, so whatever deletes
   * project_tokens rows must leave each project at least one (see deleteProjectOnce).
   */
  // --- Activity data (record_events, member_activity, audit_log), RLS-fenced. ---

  async appendRecordEvent(e: RecordEventInput): Promise<void> {
    await this.withProject(e.projectId, async (client) => {
      await insertRecordEvent(client, e);
    });
  }

  async listRecordEvents(projectId: string, q: RecordEventQuery): Promise<RecordEvent[]> {
    checkCursor(q.before);
    return this.withProject(projectId, async (client) => {
      const params: unknown[] = [projectId, new Date(q.from), new Date(q.to), q.limit];
      let where = '';
      if (q.operator !== undefined) {
        params.push(q.operator);
        where += ` AND operator = $${params.length}`;
      }
      if (q.before !== undefined) {
        params.push(new Date(q.before.at), q.before.id);
        where += ` AND (modified_on, id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
      }
      const res = await client.query(
        `SELECT id, project_id, record_key, operator, modified_on, received_at, actively_saved, step, deleted, change, summary
           FROM record_events
          WHERE project_id = $1 AND modified_on >= $2 AND modified_on < $3${where}
          ORDER BY modified_on DESC, id DESC
          LIMIT $4`,
        params,
      );
      return res.rows.map(mapRecordEvent);
    });
  }

  async touchMemberActivity(projectId: string, userId: string, patch: MemberActivityPatch): Promise<void> {
    if (!isUuid(userId)) {
      return;
    }
    const at = (ms: number | undefined) => (ms === undefined ? null : new Date(ms));
    await this.withProject(projectId, async (client) => {
      // Only for a member (removed meanwhile: nothing). The times only move forward
      // (GREATEST skips NULL), the counters add up, a client agent replaces the old one.
      await client.query(
        `INSERT INTO member_activity (project_id, user_id, last_seen_at, last_sync_at, last_plots_download_at,
                                      last_cep_download_at, syncs_count, records_received, client_agent)
         SELECT $1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::timestamptz,
                $7::bigint, $8::bigint, $9::text
          WHERE EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2)
         ON CONFLICT (project_id, user_id) DO UPDATE SET
           last_seen_at = GREATEST(member_activity.last_seen_at, EXCLUDED.last_seen_at),
           last_sync_at = GREATEST(member_activity.last_sync_at, EXCLUDED.last_sync_at),
           last_plots_download_at = GREATEST(member_activity.last_plots_download_at, EXCLUDED.last_plots_download_at),
           last_cep_download_at = GREATEST(member_activity.last_cep_download_at, EXCLUDED.last_cep_download_at),
           syncs_count = member_activity.syncs_count + EXCLUDED.syncs_count,
           records_received = member_activity.records_received + EXCLUDED.records_received,
           client_agent = COALESCE(EXCLUDED.client_agent, member_activity.client_agent)`,
        [
          projectId,
          userId,
          at(patch.lastSeenAt),
          at(patch.lastSyncAt),
          at(patch.lastPlotsDownloadAt),
          at(patch.lastCepDownloadAt),
          patch.syncs ?? 0,
          patch.recordsReceived ?? 0,
          patch.clientAgent ?? null,
        ],
      );
    });
  }

  async listMemberActivity(projectId: string): Promise<MemberActivity[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT user_id, last_seen_at, last_sync_at, last_plots_download_at, last_cep_download_at, syncs_count,
                records_received, client_agent
           FROM member_activity
          WHERE project_id = $1
          ORDER BY user_id`,
        [projectId],
      );
      return res.rows.map(mapMemberActivity);
    });
  }

  async unsentDelays(projectId: string, since: number): Promise<{ operator: string; medianMs: number; uploads: number }[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT operator,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM received_at - modified_on) * 1000) AS median,
                count(*)::int AS n
           FROM record_events
          WHERE project_id = $1 AND change <> 'deleted' AND received_at >= $2
          GROUP BY operator
          ORDER BY operator COLLATE "C"`,
        [projectId, new Date(since)],
      );
      return res.rows.map((r) => ({ operator: String(r.operator), medianMs: Number(r.median), uploads: Number(r.n) }));
    });
  }

  async getProgressSettings(projectId: string): Promise<ProgressSettings> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT progress_settings FROM projects WHERE id = $1', [projectId]);
      const stored = res.rows[0]?.progress_settings as Partial<ProgressSettings> | null | undefined;
      return { ...DEFAULT_PROGRESS_SETTINGS, ...(stored ?? {}) };
    });
  }

  async setProgressSettings(projectId: string, settings: ProgressSettings): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query('UPDATE projects SET progress_settings = $2 WHERE id = $1', [projectId, JSON.stringify(settings)]);
    });
  }

  async appendAudit(projectId: string, entry: AuditInput): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query(
        // The server's clock, as the record events' received_at.
        'INSERT INTO audit_log (project_id, at, actor_user_id, action, details) VALUES ($1, $2, $3, $4, $5)',
        [projectId, new Date(), entry.actorUserId, entry.action, JSON.stringify(entry.details)],
      );
    });
  }

  async listAudit(projectId: string, q: AuditQuery): Promise<AuditEntry[]> {
    checkCursor(q.before);
    if (q.actor !== undefined && !isUuid(q.actor)) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const params: unknown[] = [projectId, q.limit];
      let where = '';
      if (q.actor !== undefined) {
        params.push(q.actor);
        where += ` AND a.actor_user_id = $${params.length}`;
      }
      if (q.action !== undefined) {
        params.push(q.action);
        where += ` AND a.action = $${params.length}`;
      }
      if (q.before !== undefined) {
        params.push(new Date(q.before.at), q.before.id);
        where += ` AND (a.at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
      }
      const res = await client.query(
        `SELECT a.id, a.project_id, a.at, a.actor_user_id, u.username, a.action, a.details
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.project_id = $1${where}
          ORDER BY a.at DESC, a.id DESC
          LIMIT $2`,
        params,
      );
      return res.rows.map(mapAudit);
    });
  }

  private async eachProject<T>(fn: (client: pg.PoolClient, projectId: string) => Promise<T>): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const ids = await client.query('SELECT DISTINCT project_id FROM project_tokens ORDER BY project_id');
      const out: T[] = [];
      for (const { project_id: projectId } of ids.rows as { project_id: string }[]) {
        await client.query('SELECT set_config($1, $2, true)', ['app.current_project', projectId]);
        out.push(await fn(client, projectId));
      }
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Whether Row-Level Security binds the role this store connects as, with the same
   * rules as prepareAppRole (migrate.ts): not when it is a superuser, may bypass RLS, is
   * a member of a role that is or may, has CREATEROLE, owns the tables (or is a member
   * of their owner), or may create objects in schema public.
   */
  async rowLevelSecurity(): Promise<{ role: string; enforced: boolean; reason: string | null }> {
    const res = await this.pool.query(
      `SELECT current_user AS role, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
              EXISTS (SELECT 1 FROM pg_roles m
                       WHERE m.oid <> r.oid AND (m.rolsuper OR m.rolbypassrls) AND pg_has_role(r.oid, m.oid, 'MEMBER')) AS member_of_privileged,
              COALESCE((SELECT bool_or(pg_has_role(current_user, tableowner, 'USAGE')) FROM pg_tables WHERE schemaname = 'public'), false) AS owns,
              has_schema_privilege('public', 'CREATE') AS can_create
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const r = res.rows[0];
    const reason = r.rolsuper
      ? 'a superuser'
      : r.rolbypassrls
        ? 'it may bypass RLS'
        : r.member_of_privileged
          ? 'it is a member of a superuser or BYPASSRLS role'
          : r.rolcreaterole
            ? 'it has CREATEROLE'
            : r.owns
              ? 'it owns the tables'
              : r.can_create
                ? `it may create objects in schema public; fix: ${PUBLIC_SCHEMA_FIX}`
                : null;
    return { role: r.role as string, enforced: reason === null, reason };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Fails one project's runs still running that started before `before`; how many. */
async function failStaleRuns(client: pg.PoolClient, projectId: string, before: number, code: string, message: string, now: number): Promise<number> {
  const res = await client.query(
    `UPDATE ai_runs SET status = 'failed', error_code = $3, error = $4, finished_at = $5
      WHERE project_id = $1 AND status = 'running' AND started_at < $2`,
    [projectId, new Date(before), code, message, new Date(now)],
  );
  return res.rowCount ?? 0;
}

function mapAiRunSummary(r: Record<string, unknown>): AiRunSummary {
  return {
    id: r.id as string,
    kind: r.kind as AiRunSummary['kind'],
    status: r.status as AiRunSummary['status'],
    startedBy: (r.username as string | null) ?? null,
    startedAt: (r.started_at as Date).getTime(),
    finishedAt: r.finished_at ? (r.finished_at as Date).getTime() : null,
    model: r.model as string,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    parentRun: (r.parent_run as string | null) ?? null,
    findingIndex: (r.finding_index as number | null) ?? null,
    action: (r.action as string | null) ?? null,
    errorCode: (r.error_code as string | null) ?? null,
  };
}

function mapAiRun(r: Record<string, unknown>): AiRunRow {
  return {
    ...mapAiRunSummary(r),
    toolCalls: (r.tool_calls as AiToolCall[] | null) ?? [],
    result: r.result ?? null,
    error: (r.error as string | null) ?? null,
    question: (r.question as string | null) ?? null,
    questionNames: (r.question_names as Record<string, string> | null) ?? null,
  };
}

/** Stores the row (insert, or replace the one with its key). */
async function upsertRecord(client: pg.PoolClient, row: RecordRow): Promise<void> {
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
}

async function insertRecordEvent(client: pg.PoolClient, e: RecordEventInput): Promise<void> {
  await client.query(
    `INSERT INTO record_events (project_id, record_key, operator, modified_on, received_at, actively_saved, step,
                                deleted, change, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      e.projectId,
      e.recordKey,
      e.operator,
      new Date(e.modifiedOn),
      new Date(e.receivedAt),
      e.activelySaved,
      e.step,
      e.deleted,
      e.change,
      e.summary === null ? null : JSON.stringify(e.summary),
    ],
  );
}

function timeOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : (v as Date).getTime();
}

function mapRecordEvent(r: Record<string, unknown>): RecordEvent {
  return {
    id: String(r.id),
    projectId: r.project_id as string,
    recordKey: r.record_key as string,
    operator: r.operator as string,
    modifiedOn: (r.modified_on as Date).getTime(),
    receivedAt: (r.received_at as Date).getTime(),
    activelySaved: r.actively_saved as boolean,
    step: r.step as number,
    deleted: r.deleted as boolean,
    change: r.change as RecordChange,
    summary: (r.summary as Record<string, string> | null) ?? null,
  };
}

function mapMemberActivity(r: Record<string, unknown>): MemberActivity {
  return {
    userId: r.user_id as string,
    lastSeenAt: timeOrNull(r.last_seen_at),
    lastSyncAt: timeOrNull(r.last_sync_at),
    lastPlotsDownloadAt: timeOrNull(r.last_plots_download_at),
    lastCepDownloadAt: timeOrNull(r.last_cep_download_at),
    syncsCount: Number(r.syncs_count),
    recordsReceived: Number(r.records_received),
    clientAgent: (r.client_agent as string | null) ?? null,
  };
}

function mapAudit(r: Record<string, unknown>): AuditEntry {
  return {
    id: String(r.id),
    projectId: r.project_id as string,
    at: (r.at as Date).getTime(),
    actorUserId: (r.actor_user_id as string | null) ?? null,
    actor: (r.username as string | null) ?? null,
    action: r.action as AuditAction,
    details: (r.details as AuditDetails | null) ?? {},
  };
}

function mapDecision(r: Record<string, unknown>): QualityDecision {
  return {
    plot: r.plot as string,
    decision: r.decision as DecisionKind,
    comment: (r.comment as string | null) ?? null,
    decidedBy: (r.username as string | null) ?? null,
    decidedAt: (r.decided_at as Date).getTime(),
    seen: (r.seen as { operator: string; hash: number }[] | null | undefined) ?? null,
    batch: (r.decided_batch as string | null | undefined) ?? null,
  };
}

function mapNote(r: Record<string, unknown>): GuidanceNote {
  return {
    id: r.id as string,
    questionKey: r.question_key as string,
    firstValue: (r.first_value as string | null) ?? null,
    checkValue: (r.check_value as string | null) ?? null,
    text: r.text as string,
    updatedBy: (r.username as string | null) ?? null,
    updatedAt: (r.updated_at as Date).getTime(),
  };
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

/**
 * Serialises the creation and the deletion of accounts with one username, until the
 * transaction ends. Without it, an account created while one of the same name is being
 * deleted checks retired_usernames before the deletion retires the name, waits on the
 * unique username, and is then created under a retired name with its figures.
 */
async function lockUsername(client: pg.PoolClient, username: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:username:' || $1))", [username]);
}
