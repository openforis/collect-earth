import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { isUuid } from '../accountRules.js';
import { generateShareToken, generateToken, hashToken, SESSION_IDLE_DAYS } from '../auth.js';
import { PUBLIC_SCHEMA_FIX } from './migrate.js';
import {
  AI_INTERRUPTED,
  aiLimitReached,
  personOverMonth,
  DEFAULT_PROGRESS_SETTINGS,
  DEFAULT_SETTINGS,
  totalStorageBytes,
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
  type DatabaseHealth,
  type DecisionKind,
  type DigestKind,
  type DueDigest,
  type AccountMail,
  type MailLanguage,
  type GuidanceNote,
  type GuidanceNoteInput,
  type Invite,
  type InviteSummary,
  type Member,
  type MemberActivity,
  type MemberActivityPatch,
  type Membership,
  type PlatformStats,
  type PlotAssignment,
  type ProgressSettings,
  type PublicQuality,
  type ProjectRow,
  type ProjectStorage,
  type QualityDecision,
  type QualitySettings,
  type RecordChange,
  type RecordEvent,
  type RecordEventCount,
  type RecordEventInput,
  type RecordEventQuery,
  type RecordRow,
  type RecordState,
  type RecordXml,
  type ReferenceChange,
  type ReferenceChangeResult,
  type ReferencePlot,
  type RoundInfo,
  type SampledCopy,
  type SamplingDraw,
  type SamplingRule,
  type SamplingState,
  type ServerSettings,
  type ShareLink,
  type StoredDistribution,
  type Role,
  type User,
  type UserSummary,
  TrainingAttempt,
  TrainingGolden,
  TrainingKind,
  TrainingSet,
} from '../types.js';
import {
  checkCursor,
  type CreateInviteInput,
  type CreateProjectResult,
  type Store,
  type TokenMembership,
  type TrainingSetChange,
  type TrainingSetInput,
  type UserPlots,
} from './store.js';
import { unitOfRecord } from '../rounds.js';
import { UsernameTakenError } from './memory.js';
import { checksumOf, plotCountOf } from '../csv.js';
import { legacyRoundInfo } from '../cep.js';
import { fileKeyCount } from '../rounds.js';

const { Pool } = pg;

/** Rows per INSERT when saving a division (a file can have ~100k plots). */
const PLOT_INSERT_CHUNK = 5000;
/** The progress links' lock per project (createShareLink: the cap of links). */
const SHARE_LINKS_LOCK = "SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:share-links:' || $1))";
/** The check sampling's lock per project (addSampledCopies, setDivision). */
const SAMPLING_LOCK = "SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:sampling:' || $1))";
/** Changes to a project's admins, one at a time (lastAdmin). */
const PROJECT_ADMINS_LOCK = "SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:project-admins:' || $1))";
/** The longest statement of a draw's transaction (its lock's wait included): 24,000 copies took about 1.5 s. */
export const SAMPLING_STATEMENT_TIMEOUT_MS = 30_000;
/** The longest pause between the statements of a draw's transaction before Postgres ends it. */
export const SAMPLING_IDLE_TIMEOUT_MS = 10_000;

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

/** Clients whose connection failed while checked out: destroyed when released (PostgresStore.connect). */
const brokenClients = new WeakMap<pg.PoolClient, Error>();

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;
  private readonly statementTimeout: string | null;
  private readonly onPoolError: (err: Error) => void;

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
    this.onPoolError = onPoolError;
    this.statementTimeout = options.statementTimeoutMs ? String(Math.round(options.statementTimeoutMs)) : null;
  }

  /**
   * A client of the pool, watched while it is checked out. pg-pool removes its own 'error' listener
   * from a client it hands out, so a connection that dies meanwhile (Postgres ending it: an idle
   * transaction past idle_in_transaction_session_timeout, a restart, the network) would emit an
   * uncaught 'error' and end the process. Here the error is logged and remembered, and release()
   * then destroys the client instead of putting a broken connection back in the pool.
   */
  private async connect(): Promise<pg.PoolClient> {
    const client = await this.pool.connect();
    const onError = (err: Error) => {
      if (!brokenClients.has(client)) brokenClients.set(client, err);
      this.onPoolError(err);
    };
    client.on('error', onError);
    // pg-pool gives the client a new release() at every checkout, so this one is for this checkout only.
    const release = client.release.bind(client);
    client.release = ((err?: Error | boolean) => {
      client.removeListener('error', onError);
      const broken = brokenClients.get(client);
      brokenClients.delete(client);
      release(err ?? broken);
    }) as typeof client.release;
    return client;
  }

  /**
   * ROLLBACK after a failure, never masking it: on a connection that is gone it fails too, and the
   * client is then marked broken (destroyed on release) while the caller rethrows the first error.
   */
  private async rollback(client: pg.PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch (err) {
      if (!brokenClients.has(client)) brokenClients.set(client, err as Error);
    }
  }

  /** Runs fn inside a transaction scoped to a project for RLS enforcement. */
  private async withProject<T>(projectId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
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
      await this.rollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async createProject(input: { name: string }): Promise<CreateProjectResult> {
    const projectId = randomUUID();
    const adminToken = generateToken();
    const projectToken = generateToken();

    const client = await this.connect();
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
      await this.rollback(client);
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
      await client.query('DELETE FROM attention_reads WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM audit_log WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM quality_decisions WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM guidance_notes WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM sampling_rules WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM reference_plots WHERE project_id = $1', [projectId]);
      for (const table of ['training_attempts', 'training_golden', 'training_members', 'training_sets', 'training_records']) {
        await client.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
      }
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM assignments WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM csv_files WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM records WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_ceps WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM invites WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM share_links WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_members WHERE project_id = $1', [projectId]);
      // The only place project_tokens rows are deleted, with the project itself: every
      // project keeps at least one token row while it exists, or eachProject (the AI usage
      // page) would not see it. Anything else that deletes token rows must keep one.
      await client.query('DELETE FROM project_tokens WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM projects WHERE id = $1', [projectId]);
    });
  }

  async getProjectStorage(projectId: string): Promise<ProjectStorage> {
    return this.withProject(projectId, async (client) => storageOf(client, projectId));
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
                deleted, deleted_on, active_seconds
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
                deleted, deleted_on, active_seconds, ${submittedSql} AS submitted_before
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
      // The account has the record already: both are kept. Merging them deleted one, and a forged
      // operator name made that someone else's record.
      if (res.rows.some((r) => r.operator === to)) {
        return false;
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

  async getRecordXml(projectId: string, keys: readonly { recordKey: string; operator: string }[]): Promise<RecordXml[]> {
    if (keys.length === 0) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT r.record_key, r.operator, r.step, r.xml, r.deleted
           FROM records r
           JOIN (SELECT DISTINCT * FROM unnest($2::text[], $3::text[])) AS k(record_key, operator)
             ON k.record_key = r.record_key AND k.operator = r.operator
          WHERE r.project_id = $1`,
        [projectId, keys.map((k) => k.recordKey), keys.map((k) => k.operator)],
      );
      return res.rows.map((row) => ({ recordKey: row.record_key as string, operator: row.operator as string, step: Number(row.step), xml: (row.xml as string | null) ?? null, deleted: row.deleted === true }));
    });
  }

  async listRecordKeysWithoutXml(projectId: string): Promise<{ recordKey: string; operator: string }[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT record_key, operator FROM records WHERE project_id = $1 AND NOT deleted AND xml IS NULL', [projectId]);
      return res.rows.map((row) => ({ recordKey: row.record_key as string, operator: row.operator as string }));
    });
  }

  async listRecordsByKeys(projectId: string, recordKeys: readonly string[], operator?: string): Promise<RecordRow[]> {
    if (recordKeys.length === 0) {
      return [];
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT r.project_id, r.record_key, r.operator, r.modified_on, r.received_at, r.actively_saved, r.step, NULL AS xml, r.summary,
                r.deleted, r.deleted_on
           FROM records r
          WHERE r.project_id = $1 AND r.record_key = ANY($2::text[]) AND ($3::text IS NULL OR r.operator = $3)`,
        [projectId, [...new Set(recordKeys)], operator ?? null],
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
                      floor(EXTRACT(EPOCH FROM e.first_submitted_on) * 1000)::float8,
                      r.active_seconds
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
      return (res.rows as [string, string, boolean, number, number | null, number | null][]).map(([recordKey, operator, activelySaved, modifiedOn, first, activeSeconds]) => ({
        recordKey,
        operator,
        activelySaved,
        deleted: false,
        modifiedOn,
        firstSubmittedOn: first,
        activeSeconds: activeSeconds ?? null,
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
    const client = await this.connect();
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
      await this.rollback(client);
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

  async isAccountUsername(username: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM users WHERE username = ANY($1::text[])
       UNION ALL SELECT 1 FROM retired_usernames WHERE username = ANY($1::text[]) LIMIT 1`,
      [[username, username.toLowerCase()]],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT id, username, password_hash, email, is_platform_admin, terms_accepted_at, disabled_at FROM users WHERE username = $1',
      [username],
    );
    return res.rowCount === 0 ? null : mapUser(res.rows[0]);
  }

  async getUserById(userId: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT id, username, password_hash, email, is_platform_admin, terms_accepted_at, disabled_at FROM users WHERE id = $1',
      [userId],
    );
    return res.rowCount === 0 ? null : mapUser(res.rows[0]);
  }

  async createSession(userId: string): Promise<string> {
    const token = generateToken();
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [hashToken(token), userId, SESSION_IDLE_DAYS],
    );
    return token;
  }

  async resolveSession(token: string): Promise<{ userId: string } | null> {
    // A disabled account's sessions are deleted; the join also refuses one made meanwhile.
    const res = await this.pool.query(
      `SELECT s.user_id, s.expires_at < now() + make_interval(days => $2 - 1) AS renew
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [hashToken(token), SESSION_IDLE_DAYS],
    );
    if (res.rowCount === 0) return null;
    // In use: SESSION_IDLE_DAYS more from now, written at most once a day
    if (res.rows[0].renew) {
      await this.pool.query('UPDATE sessions SET expires_at = now() + make_interval(days => $2) WHERE token_hash = $1', [hashToken(token), SESSION_IDLE_DAYS]);
    }
    return { userId: res.rows[0].user_id };
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async deleteUserSessionsExcept(userId: string, keepToken: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, hashToken(keepToken)]);
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await this.rollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteUser(userId: string): Promise<'ok' | 'last_platform_admin'> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      // The last enabled platform admin stays: counted again under the lock disableUser
      // takes, so two admins deleting their accounts (or disabling each other) leave one.
      await client.query(PLATFORM_ADMINS_LOCK);
      const me = await client.query('SELECT is_platform_admin, disabled_at FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (me.rows[0]?.is_platform_admin && me.rows[0].disabled_at === null) {
        const others = await client.query(
          'SELECT COUNT(*)::int AS n FROM users WHERE is_platform_admin AND disabled_at IS NULL AND id <> $1',
          [userId],
        );
        if (others.rows[0].n === 0) {
          await client.query('ROLLBACK');
          return 'last_platform_admin';
        }
      }
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
        await client.query('DELETE FROM attention_reads WHERE project_id = $1 AND user_id = $2', [r.project_id, userId]);
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
      // digest_subscriptions go with the row (ON DELETE CASCADE).
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      await client.query('COMMIT');
      return 'ok';
    } catch (err) {
      await this.rollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  // --- Email digests (Task 19): users and digest_subscriptions are global (023), read by the
  // account's id or, by the digest job, as the list of subscriptions; no project data. ---

  async getAccountMail(userId: string): Promise<AccountMail | null> {
    const res = await this.pool.query('SELECT email, email_confirmed_at, mail_language, mail_time_zone FROM users WHERE id = $1', [userId]);
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    const subs = await this.pool.query(
      `SELECT kind, created_at, last_sent_week, last_mailed_week, last_sent_at, failures, stopped_at
         FROM digest_subscriptions WHERE user_id = $1 ORDER BY kind`,
      [userId],
    );
    return {
      email: (r.email as string | null) ?? null,
      emailConfirmedAt: r.email_confirmed_at ? (r.email_confirmed_at as Date).getTime() : null,
      language: (r.mail_language as MailLanguage | null) ?? null,
      timeZone: (r.mail_time_zone as string | null) ?? null,
      digests: subs.rows.map((s) => ({
        kind: s.kind as DigestKind,
        createdAt: (s.created_at as Date).getTime(),
        lastSentWeek: (s.last_sent_week as string | null) ?? null,
        lastMailedWeek: (s.last_mailed_week as string | null) ?? null,
        lastSentAt: s.last_sent_at ? (s.last_sent_at as Date).getTime() : null,
        failures: s.failures as number,
        stoppedAt: s.stopped_at ? (s.stopped_at as Date).getTime() : null,
      })),
    };
  }

  async setEmail(userId: string, email: string | null): Promise<boolean> {
    // A new address is not confirmed; the same one keeps its confirmation. A changed address also
    // ends the account's reset links: one mailed to the old address stops working with it.
    const res = await this.pool.query(
      `WITH gone AS (
         DELETE FROM password_resets WHERE user_id = $1
            AND (SELECT email FROM users WHERE id = $1) IS DISTINCT FROM $2)
       UPDATE users SET email = $2,
              email_confirmed_at = CASE WHEN email IS NOT DISTINCT FROM $2 THEN email_confirmed_at END
        WHERE id = $1`,
      [userId, email],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listUserIdsByConfirmedEmail(email: string, limit: number): Promise<string[]> {
    // users is global (no RLS); a scan of the accounts, which are few next to the records.
    const res = await this.pool.query(
      `SELECT id FROM users
        WHERE lower(email) = lower($1) AND email_confirmed_at IS NOT NULL AND disabled_at IS NULL
        ORDER BY created_at, id LIMIT $2`,
      [email, limit],
    );
    return res.rows.map((r) => r.id as string);
  }

  async confirmEmail(userId: string, email: string, at: number): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE users SET email_confirmed_at = COALESCE(email_confirmed_at, $3) WHERE id = $1 AND email = $2',
      [userId, email, new Date(at)],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async setMailPreferences(userId: string, prefs: { language: MailLanguage | null; timeZone: string | null }): Promise<void> {
    await this.pool.query('UPDATE users SET mail_language = $2, mail_time_zone = $3 WHERE id = $1', [userId, prefs.language, prefs.timeZone]);
  }

  async setDigest(userId: string, kind: DigestKind, on: boolean, at: number): Promise<boolean> {
    if (!on) {
      const res = await this.pool.query('DELETE FROM digest_subscriptions WHERE user_id = $1 AND kind = $2', [userId, kind]);
      return (res.rowCount ?? 0) > 0;
    }
    // On: a new row from `at`; one stopped after refusals starts again; one already on stays as it is.
    const res = await this.pool.query(
      `INSERT INTO digest_subscriptions (user_id, kind, created_at) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM users WHERE id = $1)
       ON CONFLICT (user_id, kind) DO UPDATE SET stopped_at = NULL, failures = 0 WHERE digest_subscriptions.stopped_at IS NOT NULL`,
      [userId, kind, new Date(at)],
    );
    if ((res.rowCount ?? 0) > 0) return true;
    const exists = await this.pool.query('SELECT 1 FROM digest_subscriptions WHERE user_id = $1 AND kind = $2', [userId, kind]);
    return (exists.rowCount ?? 0) > 0;
  }

  async listDueDigests(q: { before: string; after: { userId: string; kind: DigestKind } | null; limit: number }): Promise<DueDigest[]> {
    const res = await this.pool.query(
      `SELECT d.user_id, d.kind, d.created_at, d.last_sent_week, u.username, u.email, u.email_confirmed_at IS NOT NULL AS confirmed,
              u.disabled_at IS NOT NULL AS disabled, u.mail_language, u.mail_time_zone
         FROM digest_subscriptions d JOIN users u ON u.id = d.user_id
        WHERE d.stopped_at IS NULL AND (d.last_sent_week IS NULL OR d.last_sent_week < $1)
          AND ($2::uuid IS NULL OR (d.user_id, d.kind) > ($2::uuid, $3::text))
        ORDER BY d.user_id, d.kind
        LIMIT $4`,
      [q.before, q.after?.userId ?? null, q.after?.kind ?? null, q.limit],
    );
    return res.rows.map((r) => ({
      userId: r.user_id as string,
      kind: r.kind as DigestKind,
      createdAt: (r.created_at as Date).getTime(),
      lastSentWeek: (r.last_sent_week as string | null) ?? null,
      username: r.username as string,
      email: (r.email as string | null) ?? null,
      emailConfirmed: r.confirmed === true,
      disabled: r.disabled === true,
      language: (r.mail_language as MailLanguage | null) ?? null,
      timeZone: (r.mail_time_zone as string | null) ?? null,
    }));
  }

  async claimDigest(userId: string, kind: DigestKind, week: string, previous: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE digest_subscriptions SET last_sent_week = $3
        WHERE user_id = $1 AND kind = $2 AND last_sent_week IS NOT DISTINCT FROM $4`,
      [userId, kind, week, previous],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markDigestSent(userId: string, kind: DigestKind, week: string, at: number): Promise<void> {
    await this.pool.query(
      'UPDATE digest_subscriptions SET last_mailed_week = $3, last_sent_at = $4, failures = 0 WHERE user_id = $1 AND kind = $2',
      [userId, kind, week, new Date(at)],
    );
  }

  async noteDigestFailure(userId: string, kind: DigestKind, at: number, max: number): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE digest_subscriptions SET failures = failures + 1,
              stopped_at = CASE WHEN stopped_at IS NULL AND failures + 1 >= $4 THEN $3 ELSE stopped_at END
        WHERE user_id = $1 AND kind = $2
        RETURNING stopped_at IS NOT NULL AS stopped`,
      [userId, kind, new Date(at), max],
    );
    return res.rows[0]?.stopped === true;
  }

  async reserveConfirmationSend(userId: string, at: number, limits: { perHour: number; perDay: number }): Promise<boolean> {
    // Checked and counted under a per-account lock, so two requests at once cannot both pass the cap.
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:confirm:' || $1::text))", [userId]);
      const when = new Date(at);
      await client.query("DELETE FROM email_confirmation_sends WHERE user_id = $1 AND sent_at <= $2::timestamptz - interval '1 day'", [userId, when]);
      const counts = await client.query(
        `SELECT count(*)::int AS day, count(*) FILTER (WHERE sent_at > $2::timestamptz - interval '1 hour')::int AS hour
           FROM email_confirmation_sends WHERE user_id = $1`,
        [userId, when],
      );
      const { day, hour } = counts.rows[0] as { day: number; hour: number };
      if (hour >= limits.perHour || day >= limits.perDay) {
        await client.query('COMMIT');
        return false;
      }
      await client.query('INSERT INTO email_confirmation_sends (user_id, sent_at) SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM users WHERE id = $1)', [userId, when]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await this.rollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async releaseDigest(userId: string, kind: DigestKind, week: string, previous: string | null): Promise<void> {
    await this.pool.query(
      'UPDATE digest_subscriptions SET last_sent_week = $4 WHERE user_id = $1 AND kind = $2 AND last_sent_week = $3',
      [userId, kind, week, previous],
    );
  }

  // --- Platform administration: global tables (users, server_settings,
  // password_resets), not under RLS, never returning project data. ---

  async hasPlatformAdmin(): Promise<boolean> {
    const res = await this.pool.query('SELECT 1 FROM users WHERE is_platform_admin LIMIT 1');
    return res.rowCount !== null && res.rowCount > 0;
  }

  async countPlatformAdmins(): Promise<number> {
    const res = await this.pool.query('SELECT COUNT(*)::int AS n FROM users WHERE is_platform_admin AND disabled_at IS NULL');
    return res.rows[0].n as number;
  }

  async disableUser(userId: string, disabledBy: string): Promise<'ok' | 'last_platform_admin' | 'not_found'> {
    if (!isUuid(userId)) {
      return 'not_found';
    }
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      // Two admins disabling each other at once: the second waits and then sees the first's change.
      await client.query(PLATFORM_ADMINS_LOCK);
      const res = await client.query('SELECT is_platform_admin, disabled_at FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (res.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      const { is_platform_admin: isAdmin, disabled_at: disabledAt } = res.rows[0];
      if (isAdmin && disabledAt === null) {
        const others = await client.query(
          'SELECT COUNT(*)::int AS n FROM users WHERE is_platform_admin AND disabled_at IS NULL AND id <> $1',
          [userId],
        );
        if (others.rows[0].n === 0) {
          await client.query('ROLLBACK');
          return 'last_platform_admin';
        }
      }
      await client.query(
        'UPDATE users SET disabled_at = now(), disabled_by = $2 WHERE id = $1 AND disabled_at IS NULL',
        [userId, disabledBy],
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
      return 'ok';
    } catch (err) {
      await this.rollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async enableUser(userId: string): Promise<'ok' | 'not_found'> {
    if (!isUuid(userId)) {
      return 'not_found';
    }
    const res = await this.pool.query('UPDATE users SET disabled_at = NULL, disabled_by = NULL WHERE id = $1', [userId]);
    return res.rowCount === 0 ? 'not_found' : 'ok';
  }

  async platformStats(q: { activeSince: number; signupsFrom: number; receivedFrom: number }): Promise<PlatformStats> {
    // Accounts and sessions are global tables (002): counts only leave these queries.
    const users = await this.pool.query(
      `SELECT COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE disabled_at IS NOT NULL))::int AS disabled,
              (COUNT(*) FILTER (WHERE is_platform_admin AND disabled_at IS NULL))::int AS admins
         FROM users`,
    );
    const signups = await this.pool.query(
      `SELECT floor(extract(epoch FROM created_at) / 86400)::bigint AS d, COUNT(*)::int AS n
         FROM users WHERE created_at >= $1 GROUP BY d ORDER BY d`,
      [new Date(q.signupsFrom)],
    );
    const loggedIn = await this.pool.query('SELECT DISTINCT user_id FROM sessions WHERE created_at >= $1', [new Date(q.activeSince)]);
    const active = new Set<string>(loggedIn.rows.map((r) => r.user_id as string));
    const received = new Map<number, number>();
    // Project data (member_activity, record_events, records, files): each project read under
    // its own app.current_project, so RLS holds for this cross-project total too.
    const projects = await this.eachProject(async (client, projectId) => {
      const seen = await client.query(
        'SELECT user_id FROM member_activity WHERE project_id = $1 AND last_seen_at >= $2',
        [projectId, new Date(q.activeSince)],
      );
      for (const r of seen.rows) {
        active.add(r.user_id as string);
      }
      const days = await client.query(
        `SELECT floor(extract(epoch FROM received_at) / 86400)::bigint AS d, COUNT(*)::int AS n
           FROM record_events WHERE project_id = $1 AND received_at >= $2 GROUP BY d`,
        [projectId, new Date(q.receivedFrom)],
      );
      for (const r of days.rows) {
        const day = Number(r.d) * 86_400_000;
        received.set(day, (received.get(day) ?? 0) + Number(r.n));
      }
      const recent = await client.query('SELECT 1 FROM record_events WHERE project_id = $1 AND received_at >= $2 LIMIT 1', [
        projectId,
        new Date(q.activeSince),
      ]);
      return {
        projectId,
        storageBytes: totalStorageBytes(await storageOf(client, projectId)),
        active: seen.rows.length > 0 || (recent.rowCount ?? 0) > 0,
      };
    });
    // Users seen in a project but deleted since are not counted (member_activity goes with them);
    // disabled accounts are not active, whatever they did before.
    const disabledIds = await this.pool.query('SELECT id FROM users WHERE disabled_at IS NOT NULL');
    for (const r of disabledIds.rows) {
      active.delete(r.id as string);
    }
    const u = users.rows[0];
    return {
      users: u.total,
      disabledUsers: u.disabled,
      platformAdmins: u.admins,
      activeUsers: active.size,
      signupsByDay: signups.rows.map((r) => ({ day: Number(r.d) * 86_400_000, count: Number(r.n) })),
      projects,
      receivedByDay: [...received].map(([day, count]) => ({ day, count })).sort((a, b) => a.day - b.day),
    };
  }

  async databaseHealth(): Promise<DatabaseHealth> {
    const res = await this.pool.query(
      `SELECT pg_database_size(current_database())::bigint AS size, current_setting('server_version') AS version`,
    );
    let migrations: DatabaseHealth['migrations'] = null;
    try {
      const m = await this.pool.query('SELECT name, first_applied_at FROM schema_migrations ORDER BY name');
      migrations = m.rows.map((r) => ({ name: r.name as string, firstAppliedAt: (r.first_applied_at as Date).getTime() }));
    } catch (err) {
      // Before migration 018 (or without the grant): say nothing rather than fail the page.
      if ((err as { code?: string }).code !== '42P01' && (err as { code?: string }).code !== '42501') {
        throw err;
      }
    }
    return { sizeBytes: Number(res.rows[0].size), version: res.rows[0].version as string, migrations };
  }

  async createFirstPlatformAdmin(input: { username: string; passwordHash: string }): Promise<User | null> {
    const id = randomUUID();
    const client = await this.connect();
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
      await this.rollback(client);
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
      `SELECT u.id, u.username, u.is_platform_admin, u.disabled_at, b.username AS disabled_by,
              COUNT(m.project_id)::int AS projects,
              (COUNT(m.project_id) FILTER (WHERE m.role = 'admin'))::int AS coordinated
         FROM users u LEFT JOIN project_members m ON m.user_id = u.id
              LEFT JOIN users b ON b.id = u.disabled_by
        GROUP BY u.id, u.username, u.is_platform_admin, u.disabled_at, b.username
        ORDER BY u.username`,
    );
    return res.rows.map((r) => ({
      userId: r.id,
      username: r.username,
      isPlatformAdmin: r.is_platform_admin,
      projects: r.projects,
      coordinatedProjects: r.coordinated,
      disabledAt: r.disabled_at === null ? null : (r.disabled_at as Date).getTime(),
      disabledBy: r.disabled_at === null ? null : ((r.disabled_by as string | null) ?? null),
    }));
  }

  async createPasswordReset(userId: string, expiresAt: number): Promise<string | null> {
    const token = generateToken();
    // One statement: no link for an account disabled in the meantime (or gone).
    const res = await this.pool.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       SELECT $1, id, $3 FROM users WHERE id = $2 AND disabled_at IS NULL`,
      [hashToken(token), userId, new Date(expiresAt)],
    );
    return res.rowCount === 0 ? null : token;
  }

  async checkPasswordReset(token: string, now: number): Promise<boolean> {
    // The same conditions as consumePasswordReset, read only.
    const res = await this.pool.query(
      `SELECT 1 FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2`,
      [hashToken(token), new Date(now)],
    );
    return (res.rowCount ?? 0) > 0;
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
    const client = await this.connect();
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
      await this.rollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  async listMembers(projectId: string): Promise<Member[]> {
    const res = await this.pool.query(
      `SELECT m.user_id, u.username, m.role, u.disabled_at IS NOT NULL AS disabled
         FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1
        ORDER BY u.username`,
      [projectId],
    );
    return res.rows.map((r) => ({ userId: r.user_id, username: r.username, role: r.role, disabled: r.disabled === true }));
  }

  /**
   * Whether taking `userId`'s admin role away would leave the project with none, asked under
   * PROJECT_ADMINS_LOCK: two admins demoting or removing each other at once are then taken one
   * after the other, and the second is refused (it used to leave a project nobody could manage).
   */
  private async lastAdmin(client: pg.PoolClient, projectId: string, userId: string, keepsAdmin: boolean): Promise<boolean> {
    await client.query(PROJECT_ADMINS_LOCK, [projectId]);
    if (keepsAdmin) return false;
    const res = await client.query(
      `SELECT (SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2) AS role,
              (SELECT COUNT(*)::int FROM project_members WHERE project_id = $1 AND role = 'admin') AS admins`,
      [projectId, userId],
    );
    const r = res.rows[0];
    return r?.role === 'admin' && r.admins <= 1;
  }

  async setMemberRole(projectId: string, userId: string, role: Role): Promise<'ok' | 'last_admin'> {
    return this.withProject(projectId, async (client) => {
      if (await this.lastAdmin(client, projectId, userId, role === 'admin')) return 'last_admin';
      await client.query('UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2', [projectId, userId, role]);
      return 'ok';
    });
  }

  async removeMember(projectId: string, userId: string): Promise<'ok' | 'last_admin'> {
    return this.withProject(projectId, async (client) => {
      if (await this.lastAdmin(client, projectId, userId, false)) return 'last_admin';
      // A draw's copies land before or after the removal, never one for a person removed meanwhile.
      await client.query(SAMPLING_LOCK, [projectId]);
      await client.query('DELETE FROM assignments WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM member_activity WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM attention_reads WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      await client.query('UPDATE audit_log SET actor_user_id = NULL WHERE project_id = $1 AND actor_user_id = $2', [projectId, userId]);
      await client.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      return 'ok';
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
    const client = await this.connect();
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
      await this.rollback(client);
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

  // --- Progress links (Task 18): share_links is project data under RLS (migration 021) ---

  async createShareLink(projectId: string, input: { label: string; createdBy: string | null; max: number }): Promise<{ token: string; link: ShareLink } | null> {
    const token = generateShareToken();
    const id = randomUUID();
    const row = await this.withProject(projectId, async (client) => {
      // Counted and inserted under one lock per project, so links made at once never pass the cap.
      await client.query(SHARE_LINKS_LOCK, [projectId]);
      const res = await client.query(
        `WITH l AS (
           INSERT INTO share_links (id, project_id, token_hash, label, created_by)
           SELECT $1, $2, $3, $4, $5
            WHERE (SELECT count(*) FROM share_links WHERE project_id = $2 AND revoked_at IS NULL) < $6
           RETURNING id, label, created_by, created_at, last_used_at
         )
         SELECT l.*, u.username FROM l LEFT JOIN users u ON u.id = l.created_by`,
        [id, projectId, hashToken(token), input.label, input.createdBy, input.max],
      );
      return res.rows[0] ?? null;
    });
    return row ? { token, link: shareLinkOf(row) } : null;
  }

  async listShareLinks(projectId: string): Promise<ShareLink[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT l.id, l.label, l.created_by, l.created_at, l.last_used_at, u.username
           FROM share_links l LEFT JOIN users u ON u.id = l.created_by
          WHERE l.project_id = $1 AND l.revoked_at IS NULL
          ORDER BY l.created_at, l.id`,
        [projectId],
      );
      return res.rows.map(shareLinkOf);
    });
  }

  async revokeShareLink(projectId: string, linkId: string): Promise<ShareLink | null> {
    if (!isUuid(linkId)) {
      return null;
    }
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `WITH l AS (
           UPDATE share_links SET revoked_at = now()
            WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
           RETURNING id, label, created_by, created_at, last_used_at
         )
         SELECT l.*, u.username FROM l LEFT JOIN users u ON u.id = l.created_by`,
        [linkId, projectId],
      );
      return res.rowCount === 0 ? null : shareLinkOf(res.rows[0]);
    });
  }

  async findShareLink(token: string): Promise<{ linkId: string; projectId: string } | null> {
    // Before any project is known: share_link_lookup (SECURITY DEFINER, owned by the tables'
    // owner) gives the link's id and project for a hash of a link not revoked, and nothing else;
    // the app role itself still sees share_links only under app.current_project.
    const res = await this.pool.query('SELECT link_id, link_project FROM share_link_lookup($1)', [hashToken(token)]);
    if (res.rowCount === 0) {
      return null;
    }
    return { linkId: res.rows[0].link_id as string, projectId: res.rows[0].link_project as string };
  }

  async touchShareLink(projectId: string, linkId: string, at: number): Promise<void> {
    if (!isUuid(linkId)) {
      return;
    }
    await this.withProject(projectId, async (client) => {
      await client.query(
        `UPDATE share_links SET last_used_at = $3
          WHERE id = $1 AND project_id = $2 AND (last_used_at IS NULL OR last_used_at < $3::timestamptz - interval '1 minute')`,
        [linkId, projectId, new Date(at)],
      );
    });
  }

  async putCsvFile(projectId: string, filename: string, data: Buffer, plotKeys?: string[]): Promise<CsvFile> {
    const checksum = checksumOf(data);
    // The route passes the plot ids it read with the survey's key count.
    const plotCount = plotKeys ? plotKeys.length : plotCountOf(data);
    return this.withProject(projectId, async (client) => {
      // A draw's copies land before or after a replaced file drops the holdings of plots it no longer has.
      await client.query(SAMPLING_LOCK, [projectId]);
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
        await client.query(
          `DELETE FROM reference_plots
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
      // The check sampling's lock: a draw's copies are added before or after, never in between.
      await client.query(SAMPLING_LOCK, [projectId]);
      await client.query('UPDATE csv_files SET distribution = $3 WHERE project_id = $1 AND id = $2', [
        projectId,
        csvFileId,
        distribution === null ? null : JSON.stringify(distribution),
      ]);
      if (distribution !== null) {
        // Reference plots (Task 14) keep their holdings as stored now, under the lock: a plot marked
        // after the caller read the holdings is not dealt again.
        const kept = await client.query(
          `SELECT p.plot_key, p.user_id, p.overlap FROM plot_assignments p
             JOIN reference_plots r ON r.project_id = p.project_id AND r.csv_file_id = p.csv_file_id AND r.plot_key = p.plot_key
            WHERE p.project_id = $1 AND p.csv_file_id = $2`,
          [projectId, csvFileId],
        );
        const refs = (await client.query('SELECT plot_key FROM reference_plots WHERE project_id = $1 AND csv_file_id = $2', [projectId, csvFileId])).rows.map((r) => r.plot_key as string);
        if (refs.length > 0) {
          const ref = new Set(refs);
          plots = [...plots.filter((a) => !ref.has(a.plotKey)), ...kept.rows.map((r) => ({ plotKey: r.plot_key as string, userId: r.user_id as string, overlap: r.overlap as boolean }))];
        }
      }
      await client.query('DELETE FROM plot_assignments WHERE project_id = $1 AND csv_file_id = $2', [projectId, csvFileId]);
      if (distribution === null) {
        // Whole files hold no copies: their reference plots go too.
        await client.query('DELETE FROM reference_plots WHERE project_id = $1 AND csv_file_id = $2', [projectId, csvFileId]);
        return;
      }
      await client.query('DELETE FROM assignments WHERE project_id = $1 AND csv_file_id = $2', [projectId, csvFileId]);
      for (let i = 0; i < plots.length; i += PLOT_INSERT_CHUNK) {
        const chunk = plots.slice(i, i + PLOT_INSERT_CHUNK);
        await client.query(
          `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap, sampled_at)
           SELECT $1, $2, t.plot_key, t.user_id, t.overlap, t.sampled_at
             FROM unnest($3::text[], $4::uuid[], $5::boolean[], $6::timestamptz[]) AS t(plot_key, user_id, overlap, sampled_at)
           ON CONFLICT DO NOTHING`,
          [
            projectId,
            csvFileId,
            chunk.map((a) => a.plotKey),
            chunk.map((a) => a.userId),
            chunk.map((a) => a.overlap),
            chunk.map((a) => (a.overlap && a.sampledAt !== undefined ? new Date(a.sampledAt) : null)),
          ],
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
        'SELECT plot_key, user_id, overlap, sampled_at FROM plot_assignments WHERE project_id = $1 AND csv_file_id = $2',
        [projectId, csvFileId],
      );
      return res.rows.map((r) => ({
        plotKey: r.plot_key,
        userId: r.user_id,
        overlap: r.overlap,
        ...(r.sampled_at ? { sampledAt: (r.sampled_at as Date).getTime() } : {}),
      }));
    });
  }

  async getSampling(projectId: string): Promise<SamplingState> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT rule, due_since, last_auto_draw_at, last_draw, last_checked_at FROM sampling_rules WHERE project_id = $1', [projectId]);
      const r = res.rows[0];
      if (!r) {
        return { rule: null, dueSince: null, lastAutoDrawAt: null, lastDraw: null, lastCheckedAt: null };
      }
      return {
        rule: r.rule as SamplingRule,
        dueSince: r.due_since ? (r.due_since as Date).getTime() : null,
        lastAutoDrawAt: r.last_auto_draw_at ? (r.last_auto_draw_at as Date).getTime() : null,
        lastDraw: (r.last_draw as SamplingDraw | null) ?? null,
        lastCheckedAt: r.last_checked_at ? (r.last_checked_at as Date).getTime() : null,
      };
    });
  }

  async setSamplingRule(projectId: string, rule: SamplingRule, active: boolean): Promise<void> {
    await this.withProject(projectId, async (client) => {
      await client.query(
        `INSERT INTO sampling_rules (project_id, rule, active, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (project_id) DO UPDATE SET
           rule = EXCLUDED.rule, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at,
           due_since = CASE WHEN EXCLUDED.active THEN sampling_rules.due_since END`,
        [projectId, JSON.stringify(rule), active],
      );
    });
  }

  async claimSamplingDraw(projectId: string, q: { now: number; markDue: boolean; minIntervalMs: number }): Promise<boolean> {
    return this.withProject(projectId, async (client) => {
      // One statement: mark the draw due (with markDue, each mark's time kept) and claim it when
      // the last automatic draw is old enough; without markDue a row is written only for a claim.
      const claim = `((due_since IS NOT NULL OR $3) AND (last_auto_draw_at IS NULL OR last_auto_draw_at <= $4))`;
      const res = await client.query(
        `UPDATE sampling_rules SET
           due_since = COALESCE(due_since, CASE WHEN $3 THEN $2::timestamptz END),
           last_marked_at = CASE WHEN $3 THEN GREATEST(COALESCE(last_marked_at, $2::timestamptz), $2::timestamptz) ELSE last_marked_at END,
           last_auto_draw_at = CASE WHEN ${claim} THEN $2 ELSE last_auto_draw_at END
         WHERE project_id = $1 AND active AND ($3 OR ${claim})
         RETURNING last_auto_draw_at = $2 AS claimed`,
        [projectId, new Date(q.now), q.markDue, new Date(q.now - q.minIntervalMs)],
      );
      return res.rows[0]?.claimed === true;
    });
  }

  async addSampledCopies(
    projectId: string,
    copies: readonly SampledCopy[],
    drop: readonly { csvFileId: string; plotKey: string; userId: string }[],
    draw: SamplingDraw,
    dueBefore: number,
  ): Promise<SampledCopy[]> {
    return this.withProject(projectId, async (client) => {
      // A draw that outlives its request (Cloud Run then gives the instance little CPU) must not keep
      // the sampling lock and the rows: each statement, the lock's wait included, and any pause
      // between them are bounded (B5); a draw cut short is rolled back and stays due. This
      // statement_timeout replaces, for this transaction only, the store's own (statementTimeoutMs, set
      // by withProject just before): SAMPLING_STATEMENT_TIMEOUT_MS is the draw's bound whatever that is.
      await client.query("SELECT set_config('statement_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true)", [
        String(SAMPLING_STATEMENT_TIMEOUT_MS),
        String(SAMPLING_IDLE_TIMEOUT_MS),
      ]);
      // One draw at a time per project (and no division meanwhile): two cannot both give the same plot a copy.
      await client.query(SAMPLING_LOCK, [projectId]);
      if (drop.length > 0) {
        await client.query(
          `DELETE FROM plot_assignments p
            USING unnest($2::uuid[], $3::text[], $4::uuid[]) AS t(csv_file_id, plot_key, user_id)
            WHERE p.project_id = $1 AND p.csv_file_id = t.csv_file_id AND p.plot_key = t.plot_key AND p.user_id = t.user_id
              AND p.overlap AND p.sampled_at IS NOT NULL`,
          [projectId, drop.map((d) => d.csvFileId), drop.map((d) => d.plotKey), drop.map((d) => d.userId)],
        );
      }
      const added: SampledCopy[] = [];
      for (let i = 0; i < copies.length; i += PLOT_INSERT_CHUNK) {
        const chunk = copies.slice(i, i + PLOT_INSERT_CHUNK);
        const res = await client.query(
          `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap, sampled_at)
           SELECT $1, t.csv_file_id, t.plot_key, t.user_id, true, $5
             FROM unnest($2::uuid[], $3::text[], $4::uuid[], $6::text[]) AS t(csv_file_id, plot_key, user_id, reason)
             JOIN csv_files c ON c.project_id = $1 AND c.id = t.csv_file_id AND c.distribution IS NOT NULL
             JOIN project_members m ON m.project_id = $1 AND m.user_id = t.user_id
            WHERE NOT EXISTS (
              SELECT 1 FROM plot_assignments p
               WHERE p.project_id = $1 AND p.csv_file_id = t.csv_file_id AND p.plot_key = t.plot_key
                 AND (p.overlap OR p.user_id = t.user_id))
           ON CONFLICT DO NOTHING
           RETURNING csv_file_id, plot_key, user_id`,
          [
            projectId,
            chunk.map((c) => c.csvFileId),
            chunk.map((c) => c.plotKey),
            chunk.map((c) => c.userId),
            new Date(draw.at),
            chunk.map((c) => c.reason),
          ],
        );
        const reasons = new Map(chunk.map((c) => [`${c.csvFileId} ${c.userId} ${c.plotKey}`, c.reason]));
        for (const r of res.rows) {
          const reason = reasons.get(`${r.csv_file_id} ${r.user_id} ${r.plot_key}`) ?? 'percent';
          added.push({ csvFileId: r.csv_file_id as string, plotKey: r.plot_key as string, userId: r.user_id as string, reason });
        }
      }
      const count = (reason: SampledCopy['reason']) => added.filter((c) => c.reason === reason).length;
      const kept: SamplingDraw = { ...draw, drawn: added.length, firstN: count('firstN'), percent: count('percent') };
      // The last draw that added copies; when a draw last looked, empty ones too; the due draw
      // ends only when nothing was marked due after the draw's inputs were read.
      await client.query(
        `UPDATE sampling_rules SET last_draw = CASE WHEN $4 THEN $2::jsonb ELSE last_draw END,
           last_checked_at = $5,
           due_since = CASE WHEN COALESCE(last_marked_at, due_since) <= $3 THEN NULL ELSE due_since END
         WHERE project_id = $1`,
        [projectId, JSON.stringify(kept), new Date(dueBefore), added.length > 0, new Date(draw.at)],
      );
      return added;
    });
  }

  // --- Training: calibration and learning plots (025_training) ---

  private static readonly TRAINING_SET_COLUMNS = `s.id, s.project_id, s.kind, s.name, s.filename, s.checksum, s.plot_keys, s.pass_mark,
    s.created_at, s.created_by, s.updated_at,
    COALESCE((SELECT array_agg(m.user_id::text ORDER BY m.user_id) FROM training_members m WHERE m.set_id = s.id), '{}') AS member_ids`;

  async listTrainingSets(projectId: string): Promise<TrainingSet[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT ${PostgresStore.TRAINING_SET_COLUMNS} FROM training_sets s WHERE s.project_id = $1 ORDER BY s.created_at, s.id`,
        [projectId],
      );
      return res.rows.map(mapTrainingSet);
    });
  }

  async getTrainingSet(projectId: string, setId: string): Promise<(TrainingSet & { data: Buffer }) | null> {
    if (!isUuid(setId)) return null;
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT ${PostgresStore.TRAINING_SET_COLUMNS}, s.data FROM training_sets s WHERE s.project_id = $1 AND s.id = $2`,
        [projectId, setId],
      );
      return res.rowCount === 0 ? null : { ...mapTrainingSet(res.rows[0]), data: res.rows[0].data as Buffer };
    });
  }

  async createTrainingSet(projectId: string, input: TrainingSetInput): Promise<TrainingSet> {
    const id = randomUUID();
    const members = [...new Set(input.memberIds)];
    await this.withProject(projectId, async (client) => {
      const at = new Date(input.at);
      await client.query(
        `INSERT INTO training_sets (id, project_id, kind, name, filename, data, checksum, plot_keys, pass_mark, created_at, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10)`,
        [id, projectId, input.kind, input.name, input.filename, input.data, checksumOf(input.data), input.plotKeys, input.passMark, at, input.createdBy],
      );
      for (const userId of members) {
        await client.query('INSERT INTO training_members (project_id, set_id, user_id) VALUES ($1, $2, $3)', [projectId, id, userId]);
        await client.query('INSERT INTO training_attempts (project_id, set_id, user_id, number, started_at) VALUES ($1, $2, $3, 1, $4)', [projectId, id, userId, at]);
      }
    });
    return (await this.listTrainingSets(projectId)).find((set) => set.id === id)!;
  }

  async updateTrainingSet(projectId: string, setId: string, change: TrainingSetChange): Promise<TrainingSet | null> {
    if (!isUuid(setId)) return null;
    const found = await this.withProject(projectId, async (client) => {
      const res = await client.query(
        `UPDATE training_sets SET
           name = COALESCE($3, name),
           kind = COALESCE($4, kind),
           pass_mark = CASE WHEN $5 THEN $6::integer ELSE pass_mark END,
           updated_at = now()
         WHERE project_id = $1 AND id = $2`,
        [projectId, setId, change.name ?? null, change.kind ?? null, change.passMark !== undefined, change.passMark ?? null],
      );
      return (res.rowCount ?? 0) > 0;
    });
    return found ? ((await this.listTrainingSets(projectId)).find((set) => set.id === setId) ?? null) : null;
  }

  async deleteTrainingSet(projectId: string, setId: string): Promise<boolean> {
    if (!isUuid(setId)) return false;
    const info = await this.getRoundInfo(projectId);
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT plot_keys FROM training_sets WHERE project_id = $1 AND id = $2 FOR UPDATE', [projectId, setId]);
      if (res.rowCount === 0) return false;
      const units = new Set(res.rows[0].plot_keys as string[]);
      const records = await client.query('SELECT record_key, operator FROM training_records WHERE project_id = $1', [projectId]);
      for (const r of records.rows) {
        if (unitOfRecord(r.record_key as string, units, info) !== null) {
          await client.query('DELETE FROM training_records WHERE project_id = $1 AND record_key = $2 AND operator = $3', [projectId, r.record_key, r.operator]);
        }
      }
      for (const table of ['training_attempts', 'training_golden', 'training_members']) {
        await client.query(`DELETE FROM ${table} WHERE project_id = $1 AND set_id = $2`, [projectId, setId]);
      }
      await client.query('DELETE FROM training_sets WHERE project_id = $1 AND id = $2', [projectId, setId]);
      return true;
    });
  }

  async setTrainingMembers(projectId: string, setId: string, userIds: readonly string[], at: number): Promise<void> {
    if (!isUuid(setId)) return;
    const members = [...new Set(userIds)];
    await this.withProject(projectId, async (client) => {
      const set = await client.query('SELECT 1 FROM training_sets WHERE project_id = $1 AND id = $2 FOR UPDATE', [projectId, setId]);
      if (set.rowCount === 0) return;
      await client.query('DELETE FROM training_members WHERE project_id = $1 AND set_id = $2 AND NOT (user_id = ANY($3::uuid[]))', [projectId, setId, members]);
      for (const userId of members) {
        await client.query('INSERT INTO training_members (project_id, set_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [projectId, setId, userId]);
        await client.query(
          `INSERT INTO training_attempts (project_id, set_id, user_id, number, started_at) VALUES ($1, $2, $3, 1, $4)
           ON CONFLICT DO NOTHING`,
          [projectId, setId, userId, new Date(at)],
        );
      }
    });
  }

  async listTrainingGolden(projectId: string, setId: string): Promise<TrainingGolden[]> {
    if (!isUuid(setId)) return [];
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT plot_key, answers, note, updated_at, updated_by FROM training_golden WHERE project_id = $1 AND set_id = $2',
        [projectId, setId],
      );
      return res.rows.map((r) => ({
        plotKey: r.plot_key as string,
        answers: (r.answers as Record<string, string> | null) ?? {},
        note: (r.note as string | null) ?? null,
        updatedAt: (r.updated_at as Date).getTime(),
        updatedBy: (r.updated_by as string | null) ?? null,
      }));
    });
  }

  async putTrainingGolden(projectId: string, setId: string, rows: readonly TrainingGolden[]): Promise<void> {
    if (!isUuid(setId)) return;
    await this.withProject(projectId, async (client) => {
      for (const row of rows) {
        if (Object.keys(row.answers).length === 0 && !row.note) {
          await client.query('DELETE FROM training_golden WHERE project_id = $1 AND set_id = $2 AND plot_key = $3', [projectId, setId, row.plotKey]);
          continue;
        }
        await client.query(
          `INSERT INTO training_golden (project_id, set_id, plot_key, answers, note, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (set_id, plot_key) DO UPDATE SET answers = EXCLUDED.answers, note = EXCLUDED.note,
             updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
          [projectId, setId, row.plotKey, JSON.stringify(row.answers), row.note, new Date(row.updatedAt), row.updatedBy],
        );
      }
    });
  }

  async listTrainingAttempts(projectId: string, setId: string): Promise<TrainingAttempt[]> {
    if (!isUuid(setId)) return [];
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        'SELECT user_id, number, started_at, results FROM training_attempts WHERE project_id = $1 AND set_id = $2 ORDER BY user_id, number',
        [projectId, setId],
      );
      return res.rows.map((r) => ({
        userId: r.user_id as string,
        number: r.number as number,
        startedAt: (r.started_at as Date).getTime(),
        results: (r.results as unknown) ?? null,
      }));
    });
  }

  async startTrainingAttempts(projectId: string, setId: string, closing: readonly { userId: string; results: unknown }[], at: number): Promise<void> {
    if (!isUuid(setId)) return;
    await this.withProject(projectId, async (client) => {
      await client.query('SELECT 1 FROM training_sets WHERE project_id = $1 AND id = $2 FOR UPDATE', [projectId, setId]);
      for (const { userId, results } of closing) {
        await client.query(
          'UPDATE training_attempts SET results = $4 WHERE project_id = $1 AND set_id = $2 AND user_id = $3 AND results IS NULL',
          [projectId, setId, userId, JSON.stringify(results ?? {})],
        );
        await client.query(
          `INSERT INTO training_attempts (project_id, set_id, user_id, number, started_at)
           SELECT $1, $2, $3, COALESCE(MAX(number), 0) + 1, $4 FROM training_attempts WHERE project_id = $1 AND set_id = $2 AND user_id = $3`,
          [projectId, setId, userId, new Date(at)],
        );
      }
    });
  }

  async putTrainingRecord(projectId: string, recordKey: string, operator: string, apply: (existing: RecordRow | null) => RecordRow | null): Promise<boolean> {
    return this.withProject(projectId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('collect-earth-cloud:training-record:' || $1 || ' ' || $2 || ' ' || $3, 0))", [
        projectId,
        recordKey,
        operator,
      ]);
      const res = await client.query(
        `SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on
           FROM training_records WHERE project_id = $1 AND record_key = $2 AND operator = $3`,
        [projectId, recordKey, operator],
      );
      const row = apply(res.rowCount === 0 ? null : mapRecord(res.rows[0]));
      if (row === null) return false;
      await client.query(
        `INSERT INTO training_records (project_id, record_key, operator, modified_on, received_at, actively_saved, step, xml, summary, deleted, deleted_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project_id, record_key, operator) DO UPDATE SET
           modified_on = EXCLUDED.modified_on, received_at = EXCLUDED.received_at, actively_saved = EXCLUDED.actively_saved,
           step = EXCLUDED.step, xml = EXCLUDED.xml, summary = EXCLUDED.summary, deleted = EXCLUDED.deleted, deleted_on = EXCLUDED.deleted_on`,
        [
          projectId,
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
      return true;
    });
  }

  async listTrainingRecords(projectId: string): Promise<RecordRow[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT project_id, record_key, operator, modified_on, received_at, actively_saved, step, NULL AS xml, summary, deleted, deleted_on
           FROM training_records WHERE project_id = $1`,
        [projectId],
      );
      return res.rows.map(mapRecord);
    });
  }

  async listReferencePlots(projectId: string): Promise<ReferencePlot[]> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query(
        `SELECT r.csv_file_id, r.plot_key, r.assessor_user_id, u.username, r.added_at, r.added_by
           FROM reference_plots r
           JOIN csv_files c ON c.project_id = r.project_id AND c.id = r.csv_file_id AND c.distribution IS NOT NULL
           JOIN users u ON u.id = r.assessor_user_id
          WHERE r.project_id = $1`,
        [projectId],
      );
      return res.rows.map((r) => ({
        csvFileId: r.csv_file_id as string,
        plotKey: r.plot_key as string,
        assessorUserId: r.assessor_user_id as string,
        assessor: r.username as string,
        addedAt: (r.added_at as Date).getTime(),
        addedBy: (r.added_by as string | null) ?? null,
      }));
    });
  }

  async changeReferencePlots(projectId: string, change: ReferenceChange): Promise<ReferenceChangeResult> {
    return this.withProject(projectId, async (client) => {
      // The check sampling's lock: no draw nor division adds holdings of these plots meanwhile.
      await client.query(SAMPLING_LOCK, [projectId]);
      const result: ReferenceChangeResult = { unmarked: 0, marked: 0, copiesAdded: 0, copiesDropped: 0 };
      if (change.unmark.length > 0) {
        const res = await client.query(
          `DELETE FROM reference_plots r USING unnest($2::uuid[], $3::text[]) AS t(csv_file_id, plot_key)
            WHERE r.project_id = $1 AND r.csv_file_id = t.csv_file_id AND r.plot_key = t.plot_key`,
          [projectId, change.unmark.map((u) => u.csvFileId), change.unmark.map((u) => u.plotKey)],
        );
        result.unmarked = res.rowCount ?? 0;
      }
      if (change.dropCopies.length > 0) {
        const res = await client.query(
          `DELETE FROM plot_assignments p USING unnest($2::uuid[], $3::text[], $4::uuid[]) AS t(csv_file_id, plot_key, user_id)
            WHERE p.project_id = $1 AND p.csv_file_id = t.csv_file_id AND p.plot_key = t.plot_key AND p.user_id = t.user_id AND p.overlap`,
          [projectId, change.dropCopies.map((d) => d.csvFileId), change.dropCopies.map((d) => d.plotKey), change.dropCopies.map((d) => d.userId)],
        );
        result.copiesDropped = res.rowCount ?? 0;
      }
      if (change.mark.length > 0) {
        const marked = await client.query(
          `INSERT INTO reference_plots (project_id, csv_file_id, plot_key, assessor_user_id, added_at, added_by)
           SELECT $1, t.csv_file_id, t.plot_key, t.assessor_user_id, $5::timestamptz, $6::uuid
             FROM unnest($2::uuid[], $3::text[], $4::uuid[]) AS t(csv_file_id, plot_key, assessor_user_id)
             JOIN csv_files c ON c.project_id = $1 AND c.id = t.csv_file_id AND c.distribution IS NOT NULL
             JOIN project_members m ON m.project_id = $1 AND m.user_id = t.assessor_user_id
           ON CONFLICT (project_id, csv_file_id, plot_key) DO UPDATE SET assessor_user_id = EXCLUDED.assessor_user_id
           RETURNING csv_file_id, plot_key, assessor_user_id`,
          [
            projectId,
            change.mark.map((m) => m.csvFileId),
            change.mark.map((m) => m.plotKey),
            change.mark.map((m) => m.assessorUserId),
            new Date(change.at),
            change.by,
          ],
        );
        result.marked = marked.rowCount ?? 0;
        const files = marked.rows.map((r) => r.csv_file_id as string);
        const keys = marked.rows.map((r) => r.plot_key as string);
        const assessors = marked.rows.map((r) => r.assessor_user_id as string);
        // Everyone else holding a marked plot in its file keeps a copy of it (no longer drawn) ...
        await client.query(
          `UPDATE plot_assignments p SET overlap = true, sampled_at = NULL
             FROM unnest($2::uuid[], $3::text[], $4::uuid[]) AS t(csv_file_id, plot_key, assessor_user_id)
            WHERE p.project_id = $1 AND p.csv_file_id = t.csv_file_id AND p.plot_key = t.plot_key
              AND p.user_id <> t.assessor_user_id AND (NOT p.overlap OR p.sampled_at IS NOT NULL)`,
          [projectId, files, keys, assessors],
        );
        // ... and the assessor holds it as main.
        await client.query(
          `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap, sampled_at)
           SELECT $1, t.csv_file_id, t.plot_key, t.assessor_user_id, false, NULL
             FROM unnest($2::uuid[], $3::text[], $4::uuid[]) AS t(csv_file_id, plot_key, assessor_user_id)
           ON CONFLICT (project_id, csv_file_id, plot_key, user_id) DO UPDATE SET overlap = false, sampled_at = NULL
            WHERE plot_assignments.overlap OR plot_assignments.sampled_at IS NOT NULL`,
          [projectId, files, keys, assessors],
        );
      }
      for (let i = 0; i < change.addCopies.length; i += PLOT_INSERT_CHUNK) {
        const chunk = change.addCopies.slice(i, i + PLOT_INSERT_CHUNK);
        const res = await client.query(
          `INSERT INTO plot_assignments (project_id, csv_file_id, plot_key, user_id, overlap)
           SELECT $1, t.csv_file_id, t.plot_key, t.user_id, true
             FROM unnest($2::uuid[], $3::text[], $4::uuid[]) AS t(csv_file_id, plot_key, user_id)
             JOIN reference_plots r ON r.project_id = $1 AND r.csv_file_id = t.csv_file_id AND r.plot_key = t.plot_key
             JOIN csv_files c ON c.project_id = $1 AND c.id = t.csv_file_id AND c.distribution IS NOT NULL
             JOIN project_members m ON m.project_id = $1 AND m.user_id = t.user_id
            WHERE r.assessor_user_id <> t.user_id
           ON CONFLICT DO NOTHING`,
          [projectId, chunk.map((c) => c.csvFileId), chunk.map((c) => c.plotKey), chunk.map((c) => c.userId)],
        );
        result.copiesAdded += res.rowCount ?? 0;
      }
      return result;
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
    seen: { operator: string; hash: number; full?: number }[] | null = null,
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
    decisions: readonly { plot: string; decision: DecisionKind; seen: { operator: string; hash: number; full?: number }[] | null }[],
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
      // The person's month across projects, deleted ones included (ai_token_ledger, migration 028)
      if (start.startedBy) {
        const mine = await client.query(
          `SELECT COALESCE((SELECT tokens FROM ai_token_ledger WHERE user_id = $1 AND month = ($2::timestamptz AT TIME ZONE 'UTC')::date), 0)::bigint AS used,
                  (SELECT count(*) FROM project_members WHERE user_id = $1 AND role = 'admin')::int AS coordinated`,
          [start.startedBy, new Date(w.monthStart)],
        );
        if (personOverMonth(Number(mine.rows[0].used), mine.rows[0].coordinated, w)) {
          return { ok: false, limit: 'monthly' } as const;
        }
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
        `WITH done AS (
           UPDATE ai_runs SET status = $3, finished_at = $4, input_tokens = $5, output_tokens = $6, tool_calls = $7,
                  result = $8, error = $9, error_code = $10
            WHERE project_id = $1 AND id = $2 AND status = 'running'
            RETURNING started_by, started_at, input_tokens + output_tokens AS tokens),
         spent AS (
           INSERT INTO ai_token_ledger (user_id, month, tokens)
           SELECT started_by, date_trunc('month', started_at AT TIME ZONE 'UTC')::date, tokens
             FROM done WHERE started_by IS NOT NULL AND tokens > 0
           ON CONFLICT (user_id, month) DO UPDATE SET tokens = ai_token_ledger.tokens + EXCLUDED.tokens)
         SELECT 1 FROM done`,
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
    checkCursor(q.before, q);
    return this.withProject(projectId, async (client) => {
      const params: unknown[] = [projectId, new Date(q.from), new Date(q.to), q.limit];
      let where = '';
      if (q.operator !== undefined) {
        params.push(q.operator);
        where += ` AND operator = $${params.length}`;
      }
      if (q.changes !== undefined) {
        params.push([...q.changes]);
        where += ` AND change = ANY($${params.length}::text[])`;
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

  async recordEventCounts(projectId: string, q: { from: number; to: number }): Promise<RecordEventCount[]> {
    return this.withProject(projectId, async (client) => {
      // By quarter of an hour (epoch seconds / 900): the days are worked out in JS in the viewer's zone.
      const res = await client.query(
        `SELECT operator, change, floor(extract(epoch FROM modified_on) / 900)::bigint AS q, count(*)::int AS n
           FROM record_events
          WHERE project_id = $1 AND modified_on >= $2 AND modified_on < $3
          GROUP BY operator, change, q
          ORDER BY q, operator COLLATE "C", change COLLATE "C"`,
        [projectId, new Date(q.from), new Date(q.to)],
      );
      return res.rows.map((r) => ({ operator: String(r.operator), change: r.change as RecordEventCount['change'], at: Number(r.q) * 900_000, count: Number(r.n) }));
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

  async setPublicQuality(projectId: string, quality: PublicQuality): Promise<void> {
    await this.withProject(projectId, async (client) => {
      // Two instances may finish computations out of order: an older figure never replaces a newer one.
      await client.query(
        `UPDATE projects SET public_quality = $2
          WHERE id = $1 AND (public_quality IS NULL OR (public_quality->>'computedAt')::bigint <= $3)`,
        [projectId, JSON.stringify(quality), quality.computedAt],
      );
    });
  }

  async getPublicQuality(projectId: string): Promise<PublicQuality | null> {
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT public_quality FROM projects WHERE id = $1', [projectId]);
      return publicQualityOf(res.rows[0]?.public_quality);
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
    checkCursor(q.before, q);
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
      if (q.actions !== undefined) {
        params.push([...q.actions]);
        where += ` AND a.action = ANY($${params.length}::text[])`;
      }
      if (q.from !== undefined) {
        params.push(new Date(q.from));
        where += ` AND a.at >= $${params.length}`;
      }
      if (q.to !== undefined) {
        params.push(new Date(q.to));
        where += ` AND a.at < $${params.length}`;
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

  async listAttentionReads(projectId: string, userId: string): Promise<string[]> {
    if (!isUuid(userId)) return [];
    return this.withProject(projectId, async (client) => {
      const res = await client.query('SELECT item_key FROM attention_reads WHERE project_id = $1 AND user_id = $2 ORDER BY item_key COLLATE "C"', [projectId, userId]);
      return res.rows.map((r) => String(r.item_key));
    });
  }

  async setAttentionReads(projectId: string, userId: string, keys: readonly string[]): Promise<void> {
    if (!isUuid(userId)) return;
    await this.withProject(projectId, async (client) => {
      await client.query('DELETE FROM attention_reads WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      if (keys.length === 0) return;
      // Only for a member (removed meanwhile: nothing; the foreign key would refuse it anyway).
      await client.query(
        `INSERT INTO attention_reads (project_id, user_id, item_key, read_at)
         SELECT $1::uuid, $2::uuid, k, now() FROM unnest($3::text[]) AS k
          WHERE EXISTS (SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2)
         ON CONFLICT DO NOTHING`,
        [projectId, userId, [...new Set(keys)]],
      );
    });
  }

  private async eachProject<T>(fn: (client: pg.PoolClient, projectId: string) => Promise<T>): Promise<T[]> {
    const client = await this.connect();
    try {
      await client.query('BEGIN READ ONLY');
      // The store's statement timeout here too (M-6): each statement of the walk, as in withProject.
      if (this.statementTimeout !== null) {
        await client.query("SELECT set_config('statement_timeout', $1, true)", [this.statementTimeout]);
      }
      const ids = await client.query('SELECT DISTINCT project_id FROM project_tokens ORDER BY project_id');
      const out: T[] = [];
      for (const { project_id: projectId } of ids.rows as { project_id: string }[]) {
        await client.query('SELECT set_config($1, $2, true)', ['app.current_project', projectId]);
        out.push(await fn(client, projectId));
      }
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await this.rollback(client);
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
                          xml, summary, deleted, deleted_on, active_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (project_id, record_key, operator) DO UPDATE SET
       active_seconds = EXCLUDED.active_seconds,
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
      row.activeSeconds ?? null,
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

/** projects.public_quality as stored, or null when missing or not one. */
function publicQualityOf(v: unknown): PublicQuality | null {
  const q = v as Partial<PublicQuality> | null | undefined;
  if (!q || typeof q.compared !== 'number' || typeof q.agreeing !== 'number' || typeof q.computedAt !== 'number') return null;
  return { compared: q.compared, agreeing: q.agreeing, rate: typeof q.rate === 'number' ? q.rate : null, computedAt: q.computedAt };
}

/** A share_links row (with its maker's username joined) as coordinators list it. */
function shareLinkOf(r: Record<string, unknown>): ShareLink {
  return {
    id: r.id as string,
    label: r.label as string,
    createdAt: (r.created_at as Date).getTime(),
    createdBy: (r.username as string | null | undefined) ?? null,
    lastUsedAt: timeOrNull(r.last_used_at),
  };
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
    seen: (r.seen as { operator: string; hash: number; full?: number }[] | null | undefined) ?? null,
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
    disabledAt: r.disabled_at ? (r.disabled_at as Date).getTime() : null,
  };
}

/** Advisory lock taken while disabling an account: the last enabled platform admin stays. */
const PLATFORM_ADMINS_LOCK = "SELECT pg_advisory_xact_lock(hashtext('collect-earth-cloud:platform-admins'))";

/** A project's bytes as the storage limit counts them; the caller has set app.current_project. */
async function storageOf(client: pg.PoolClient, projectId: string): Promise<ProjectStorage> {
  const cep = await client.query(
    `SELECT (octet_length(data) + COALESCE(octet_length(cep_original), 0))::bigint AS bytes
       FROM project_ceps WHERE project_id = $1`,
    [projectId],
  );
  const csv = await client.query('SELECT filename, octet_length(data)::bigint AS bytes FROM csv_files WHERE project_id = $1', [
    projectId,
  ]);
  const rec = await client.query(
    `SELECT COALESCE(SUM(COALESCE(octet_length(xml), 0) + octet_length(summary::text)), 0)::bigint AS bytes
       FROM records WHERE project_id = $1`,
    [projectId],
  );
  // Training sets and their records count too (025_training).
  const training = await client.query(
    `SELECT (COALESCE((SELECT SUM(octet_length(data)) FROM training_sets WHERE project_id = $1), 0)
           + COALESCE((SELECT SUM(COALESCE(octet_length(xml), 0) + octet_length(summary::text)) FROM training_records WHERE project_id = $1), 0))::bigint AS bytes`,
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
    trainingBytes: Number(training.rows[0].bytes),
  };
}

function mapTrainingSet(r: Record<string, unknown>): TrainingSet {
  const plotKeys = r.plot_keys as string[];
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as TrainingKind,
    name: r.name as string,
    filename: r.filename as string,
    checksum: r.checksum as string,
    plotCount: plotKeys.length,
    plotKeys,
    passMark: (r.pass_mark as number | null) ?? null,
    createdAt: (r.created_at as Date).getTime(),
    createdBy: (r.created_by as string | null) ?? null,
    updatedAt: (r.updated_at as Date).getTime(),
    memberIds: (r.member_ids as string[] | null) ?? [],
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
    // Only where the query reads it (a record's own row): the lists leave it out.
    ...('active_seconds' in r ? { activeSeconds: (r.active_seconds as number | null) ?? null } : {}),
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
