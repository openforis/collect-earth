import { renameOperatorInSummary, renameOperatorInXml } from '../anonymize.js';
import { randomUUID } from 'node:crypto';
import { generateShareToken, generateToken, hashToken, SESSION_IDLE_MS, SESSION_TOUCH_MS } from '../auth.js';
import { legacyRoundInfo } from '../cep.js';
import { checksumOf, plotCountOf } from '../csv.js';
import { fileKeyCount, unitOfRecord } from '../rounds.js';
import {
  AI_INTERRUPTED,
  aiLimitReached,
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
  type AiUsage,
  type Assignment,
  type AssignmentDetail,
  type AuditEntry,
  type AuditInput,
  type AuditQuery,
  type CepInfo,
  type EventCursor,
  type CsvFile,
  type DatabaseHealth,
  type DecisionKind,
  type DigestKind,
  type DigestState,
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
  type SharedAnalysisView,
  type TwoFactorState,
  type PublicQuality,
  type ProjectRow,
  type ProjectStatus,
  type ProjectStorage,
  type QualityDecision,
  type QualitySettings,
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
  type ReferenceAnswer,
  type RoundInfo,
  type Role,
  type SampledCopy,
  type SamplingDraw,
  type SamplingRule,
  type SamplingState,
  type ServerSettings,
  type ShareLink,
  type StoredDistribution,
  type User,
  type UserSummary,
  TrainingAttempt,
  TrainingGolden,
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

const DAY_MS = 86_400_000;

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
  analysisViews: SharedAnalysisView[];
  /** The progress link's quality figure (projects.public_quality). */
  publicQuality: PublicQuality | null;
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
  /** userId -> the keys of the bell's items they have read. */
  attentionReads: Map<string, Set<string>>;
  /** The check sampling (sampling_rules); null until a rule is saved. */
  sampling: (SamplingState & { active: boolean; lastMarkedAt: number | null }) | null;
  /** Reference plots (reference_plots), key = `${csvFileId} ${plotKey}`. */
  references: Map<string, StoredReference>;
  /** Reference answers uploaded, by plot unit. */
  referenceAnswers: Map<string, ReferenceAnswer>;
}

interface StoredReference {
  csvFileId: string;
  plotKey: string;
  assessorUserId: string;
  addedAt: number;
  addedBy: string | null;
}

interface StoredDecision {
  decision: DecisionKind;
  comment: string | null;
  decidedBy: string | null; // user id
  decidedAt: number;
  seen: { operator: string; hash: number; full?: number }[] | null;
  batch: string | null;
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

interface ShareLinkEntry {
  id: string;
  projectId: string;
  label: string;
  createdBy: string | null;
  createdAt: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
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
  /** When each session was made (active accounts on the server owner's panel). */
  private readonly sessionCreatedAt = new Map<string, number>(); // session token hash -> epoch ms
  private readonly sessionLastUsedAt = new Map<string, number>(); // session token hash -> epoch ms (SESSION_TOUCH_MS)
  /** When each account was made (sign-ups per week) and who disabled it. */
  private readonly userCreatedAt = new Map<string, number>();
  private readonly userDisabledBy = new Map<string, string>();
  private readonly memberships = new Map<string, Role>(); // `${projectId} ${userId}` -> role
  /** `${projectId} ${userId}` -> left out of the results (Member.excluded). */
  private readonly excludedMembers = new Map<string, { at: number; reason: string | null }>();
  private readonly invites = new Map<string, InviteEntry>(); // invite token hash -> entry
  private readonly resets = new Map<string, ResetEntry>(); // reset token hash -> entry
  /** Progress links (share_links): token hash -> link. */
  private readonly shareLinks = new Map<string, ShareLinkEntry>();
  /** Email digests (Task 19): userId -> confirmation and the mails' language and zone. */
  private readonly accountMail = new Map<string, { emailConfirmedAt: number | null; language: MailLanguage | null; timeZone: string | null }>();
  /** `${userId} ${kind}` -> the subscription (digest_subscriptions). */
  private readonly digests = new Map<string, { userId: string } & DigestState>();
  /** userId -> when confirmation mails were sent (email_confirmation_sends), the last day's. */
  private readonly confirmationSends = new Map<string, number[]>();
  private settings: ServerSettings = { ...DEFAULT_SETTINGS };
  /** Ids of record events and audit entries: increasing, as Postgres's BIGSERIAL. */
  private nextEventId = 1;

  /** Training sets by project (025_training): the set with its data, golden answers by plot, attempts. */
  private readonly training = new Map<
    string,
    {
      sets: Map<string, { set: TrainingSet; data: Buffer; golden: Map<string, TrainingGolden>; attempts: TrainingAttempt[] }>;
      records: Map<string, RecordRow>;
    }
  >();

  private trainingOf(projectId: string) {
    this.requireProject(projectId);
    let t = this.training.get(projectId);
    if (!t) {
      t = { sets: new Map(), records: new Map() };
      this.training.set(projectId, t);
    }
    return t;
  }

  private static copySet(set: TrainingSet): TrainingSet {
    return { ...set, plotKeys: [...set.plotKeys], memberIds: [...set.memberIds] };
  }

  async listTrainingSets(projectId: string): Promise<TrainingSet[]> {
    return [...(this.training.get(projectId)?.sets.values() ?? [])].map((e) => InMemoryStore.copySet(e.set));
  }

  async getTrainingSet(projectId: string, setId: string): Promise<(TrainingSet & { data: Buffer }) | null> {
    const e = this.training.get(projectId)?.sets.get(setId);
    return e ? { ...InMemoryStore.copySet(e.set), data: Buffer.from(e.data) } : null;
  }

  async createTrainingSet(projectId: string, input: TrainingSetInput): Promise<TrainingSet> {
    const t = this.trainingOf(projectId);
    const set: TrainingSet = {
      id: randomUUID(),
      projectId,
      kind: input.kind,
      name: input.name,
      filename: input.filename,
      checksum: checksumOf(input.data),
      plotCount: input.plotKeys.length,
      plotKeys: [...input.plotKeys],
      passMark: input.passMark,
      createdAt: input.at,
      createdBy: input.createdBy,
      updatedAt: input.at,
      memberIds: [...new Set(input.memberIds)],
    };
    t.sets.set(set.id, {
      set,
      data: Buffer.from(input.data),
      golden: new Map(),
      attempts: set.memberIds.map((userId) => ({ userId, number: 1, startedAt: input.at, results: null })),
    });
    return InMemoryStore.copySet(set);
  }

  async updateTrainingSet(projectId: string, setId: string, change: TrainingSetChange): Promise<TrainingSet | null> {
    const e = this.training.get(projectId)?.sets.get(setId);
    if (!e) return null;
    if (change.name !== undefined) e.set.name = change.name;
    if (change.kind !== undefined) e.set.kind = change.kind;
    if (change.passMark !== undefined) e.set.passMark = change.passMark;
    e.set.updatedAt = Date.now();
    return InMemoryStore.copySet(e.set);
  }

  async deleteTrainingSet(projectId: string, setId: string): Promise<boolean> {
    const t = this.training.get(projectId);
    const e = t?.sets.get(setId);
    if (!t || !e) return false;
    t.sets.delete(setId);
    const units = new Set(e.set.plotKeys);
    const info = await this.getRoundInfo(projectId);
    for (const [id, r] of t.records) {
      if (unitOfRecord(r.recordKey, units, info) !== null) t.records.delete(id);
    }
    return true;
  }

  async setTrainingMembers(projectId: string, setId: string, userIds: readonly string[], at: number): Promise<void> {
    const e = this.training.get(projectId)?.sets.get(setId);
    if (!e) return;
    e.set.memberIds = [...new Set(userIds)];
    for (const userId of e.set.memberIds) {
      if (!e.attempts.some((a) => a.userId === userId)) e.attempts.push({ userId, number: 1, startedAt: at, results: null });
    }
  }

  async listTrainingGolden(projectId: string, setId: string): Promise<TrainingGolden[]> {
    const e = this.training.get(projectId)?.sets.get(setId);
    return e ? [...e.golden.values()].map((g) => ({ ...g, answers: { ...g.answers } })) : [];
  }

  async putTrainingGolden(projectId: string, setId: string, rows: readonly TrainingGolden[]): Promise<void> {
    const e = this.training.get(projectId)?.sets.get(setId);
    if (!e) return;
    for (const row of rows) {
      if (Object.keys(row.answers).length === 0 && !row.note) e.golden.delete(row.plotKey);
      else e.golden.set(row.plotKey, { ...row, answers: { ...row.answers } });
    }
  }

  async listTrainingAttempts(projectId: string, setId: string): Promise<TrainingAttempt[]> {
    const e = this.training.get(projectId)?.sets.get(setId);
    return e ? e.attempts.map((a) => ({ ...a })) : [];
  }

  async startTrainingAttempts(projectId: string, setId: string, closing: readonly { userId: string; results: unknown }[], at: number): Promise<void> {
    const e = this.training.get(projectId)?.sets.get(setId);
    if (!e) return;
    for (const { userId, results } of closing) {
      const mine = e.attempts.filter((a) => a.userId === userId);
      const open = mine.find((a) => a.results === null);
      if (open) open.results = results ?? {};
      e.attempts.push({ userId, number: mine.reduce((n, a) => Math.max(n, a.number), 0) + 1, startedAt: at, results: null });
    }
  }

  async putTrainingRecord(projectId: string, recordKey: string, operator: string, apply: (existing: RecordRow | null) => RecordRow | null): Promise<boolean> {
    const t = this.trainingOf(projectId);
    const id = InMemoryStore.recordId(recordKey, operator);
    const existing = t.records.get(id) ?? null;
    const row = apply(existing ? { ...existing } : null);
    if (row === null) return false;
    t.records.set(InMemoryStore.recordId(row.recordKey, row.operator), { ...row, projectId });
    return true;
  }

  async anonymizeOperator(projectId: string, from: string, to: string, userId: string | null = null): Promise<number> {
    const entry = this.requireProject(projectId);
    let renamed = 0;
    const renameRows = (rows: Map<string, RecordRow>) => {
      for (const [id, r] of [...rows]) {
        if (r.operator !== from) continue;
        rows.delete(id);
        rows.set(InMemoryStore.recordId(r.recordKey, to), { ...r, operator: to, xml: renameOperatorInXml(r.xml, from, to), summary: renameOperatorInSummary(r.summary, from, to) });
        if (rows === entry.records) renamed++;
      }
    };
    renameRows(entry.records);
    const training = this.training.get(projectId);
    if (training) renameRows(training.records);
    entry.recordEvents = entry.recordEvents.map((e) => (e.operator === from ? { ...e, operator: to, summary: renameOperatorInSummary(e.summary, from, to) } : e));
    for (const d of entry.decisions.values()) {
      if (d.seen) d.seen = d.seen.map((s) => (s.operator === from ? { ...s, operator: to } : s));
    }
    if (userId) {
      for (const a of entry.audit) {
        if (a.details && a.details.userId === userId) {
          const { userId: _gone, ...rest } = a.details;
          a.details = rest;
        }
      }
    }
    entry.recordsGeneration++;
    return renamed;
  }

  async listTrainingRecords(projectId: string): Promise<RecordRow[]> {
    return [...(this.training.get(projectId)?.records.values() ?? [])].map((r) => ({ ...r, xml: null, summary: { ...r.summary } }));
  }

  private static recordId(recordKey: string, operator: string): string {
    return `${recordKey} ${operator}`;
  }

  private static memberId(projectId: string, userId: string): string {
    return `${projectId} ${userId}`;
  }

  /** `projectId`: the local mode's stable id (src/local.ts); otherwise a new one. */
  async createProject(input: { name: string; projectId?: string; status?: ProjectStatus }): Promise<CreateProjectResult> {
    const projectId = input.projectId ?? randomUUID();
    if (this.projects.has(projectId)) {
      throw new Error(`Project ${projectId} already exists`);
    }
    const project: ProjectRow = {
      projectId,
      name: input.name,
      surveyUri: null,
      surveyName: null,
      idmlBase64: null,
      status: input.status ?? 'active',
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
      analysisViews: [],
      publicQuality: null,
      aiEnabled: false,
      aiRuns: [],
      decisions: new Map(),
      notes: new Map(),
      recordEvents: [],
      memberActivity: new Map(),
      audit: [],
      attentionReads: new Map(),
      sampling: null,
      references: new Map(),
      referenceAnswers: new Map(),
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

  async getProjectStatus(projectId: string): Promise<ProjectStatus | null> {
    return this.projects.get(projectId)?.project.status ?? null;
  }

  async setProjectStatus(projectId: string, status: ProjectStatus): Promise<void> {
    this.requireProject(projectId).project.status = status;
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    this.requireProject(projectId).project.name = name;
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
    this.training.delete(projectId);
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
    for (const [hash, link] of this.shareLinks) {
      if (link.projectId === projectId) {
        this.shareLinks.delete(hash);
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
    const training = this.training.get(projectId);
    storage.trainingBytes = 0;
    for (const e of training?.sets.values() ?? []) storage.trainingBytes += e.data.length;
    for (const r of training?.records.values() ?? []) {
      storage.trainingBytes += Buffer.byteLength(r.xml ?? '', 'utf8') + Buffer.byteLength(JSON.stringify(r.summary), 'utf8');
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

  async getRecordSummaries(projectId: string, keys: readonly { recordKey: string; operator: string }[]): Promise<RecordRow[]> {
    const entry = this.projects.get(projectId);
    if (!entry) return [];
    const out: RecordRow[] = [];
    for (const k of keys) {
      const r = entry.records.get(InMemoryStore.recordId(k.recordKey, k.operator));
      if (r) out.push({ ...r, xml: null });
    }
    return out;
  }

  async getRecordXml(projectId: string, keys: readonly { recordKey: string; operator: string }[]): Promise<RecordXml[]> {
    const entry = this.projects.get(projectId);
    if (!entry) return [];
    const out: RecordXml[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      const id = InMemoryStore.recordId(k.recordKey, k.operator);
      const r = entry.records.get(id);
      if (r && !seen.has(id)) {
        seen.add(id);
        out.push({ recordKey: r.recordKey, operator: r.operator, step: r.step, xml: r.xml, deleted: r.deleted });
      }
    }
    return out;
  }

  async listRecordKeysWithoutXml(projectId: string): Promise<{ recordKey: string; operator: string }[]> {
    return (await this.listRecords(projectId)).filter((r) => r.xml === null).map((r) => ({ recordKey: r.recordKey, operator: r.operator }));
  }

  async listRecordsByKeys(projectId: string, recordKeys: readonly string[], operator?: string): Promise<RecordRow[]> {
    const entry = this.projects.get(projectId);
    if (!entry || recordKeys.length === 0) return [];
    const wanted = new Set(recordKeys);
    const out: RecordRow[] = [];
    for (const r of entry.records.values()) {
      if (wanted.has(r.recordKey) && (operator === undefined || r.operator === operator)) out.push({ ...r, xml: null });
    }
    return out;
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
      activeSeconds: r.activeSeconds ?? null,
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
    const user: User = { id: randomUUID(), disabledAt: null, ...input };
    this.users.set(user.id, user);
    this.userCreatedAt.set(user.id, Date.now());
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

  private readonly twoFactor = new Map<string, TwoFactorState>();

  async getTwoFactor(userId: string): Promise<TwoFactorState | null> {
    const s = this.twoFactor.get(userId);
    return s ? { ...s, recoveryHashes: [...s.recoveryHashes] } : null;
  }

  private twoFactorOf(userId: string): TwoFactorState {
    let s = this.twoFactor.get(userId);
    if (!s) this.twoFactor.set(userId, (s = { secretEnc: null, pendingEnc: null, enabledAt: null, lastStep: null, recoveryHashes: [] }));
    return s;
  }

  async setTwoFactorPending(userId: string, pendingEnc: string | null): Promise<void> {
    this.twoFactorOf(userId).pendingEnc = pendingEnc;
  }

  async enableTwoFactor(userId: string, secretEnc: string, recoveryHashes: string[]): Promise<void> {
    Object.assign(this.twoFactorOf(userId), { secretEnc, pendingEnc: null, enabledAt: Date.now(), lastStep: null, recoveryHashes: [...recoveryHashes] });
  }

  async disableTwoFactor(userId: string): Promise<void> {
    this.twoFactor.delete(userId);
  }

  async setRecoveryHashes(userId: string, recoveryHashes: string[]): Promise<void> {
    this.twoFactorOf(userId).recoveryHashes = [...recoveryHashes];
  }

  async claimTwoFactorStep(userId: string, step: number): Promise<boolean> {
    const s = this.twoFactor.get(userId);
    if (!s || (s.lastStep !== null && s.lastStep >= step)) return false;
    s.lastStep = step;
    return true;
  }

  async claimRecoveryCode(userId: string, hash: string): Promise<boolean> {
    const s = this.twoFactor.get(userId);
    if (!s || !s.recoveryHashes.includes(hash)) return false;
    s.recoveryHashes = s.recoveryHashes.filter((h) => h !== hash);
    return true;
  }

  async createSession(userId: string): Promise<string> {
    const token = generateToken();
    this.sessions.set(hashToken(token), userId);
    this.sessionCreatedAt.set(hashToken(token), Date.now());
    return token;
  }

  async resolveSession(token: string, now = Date.now()): Promise<{ userId: string } | null> {
    const hash = hashToken(token);
    const userId = this.sessions.get(hash);
    // A disabled account's sessions are deleted; this also covers one made meanwhile.
    if (!userId || this.users.get(userId)?.disabledAt) return null;
    const lastUsed = this.sessionLastUsedAt.get(hash) ?? this.sessionCreatedAt.get(hash) ?? now;
    if (now - lastUsed > SESSION_IDLE_MS) {
      // Unused for too long: gone
      this.sessions.delete(hash);
      this.sessionCreatedAt.delete(hash);
      this.sessionLastUsedAt.delete(hash);
      return null;
    }
    if (now - lastUsed >= SESSION_TOUCH_MS) this.sessionLastUsedAt.set(hash, now);
    return { userId };
  }

  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(hashToken(token));
    this.sessionCreatedAt.delete(hashToken(token));
    this.sessionLastUsedAt.delete(hashToken(token));
  }

  async deleteUserSessions(userId: string): Promise<void> {
    for (const [hash, owner] of this.sessions) {
      if (owner === userId) {
        this.sessions.delete(hash);
        this.sessionCreatedAt.delete(hash);
        this.sessionLastUsedAt.delete(hash);
      }
    }
  }

  async deleteUserSessionsExcept(userId: string, keepToken: string): Promise<void> {
    const keep = hashToken(keepToken);
    for (const [hash, owner] of this.sessions) {
      if (owner === userId && hash !== keep) {
        this.sessions.delete(hash);
        this.sessionCreatedAt.delete(hash);
        this.sessionLastUsedAt.delete(hash);
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

  async deleteUser(userId: string): Promise<'ok' | 'last_platform_admin'> {
    const user = this.users.get(userId);
    if (!user) {
      return 'ok';
    }
    // Checked and done with no await in between, so two deletions cannot both pass the check.
    if (user.isPlatformAdmin && !user.disabledAt && this.enabledPlatformAdmins() <= 1) {
      return 'last_platform_admin';
    }
    void this.deleteUserSessions(userId); // synchronous inside
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
      // reference_plots: assessor_user_id is ON DELETE CASCADE, added_by ON DELETE SET NULL.
      for (const [key, r] of entry.references) {
        if (r.assessorUserId === userId) {
          entry.references.delete(key);
          entry.holdingsGeneration += 1;
        } else if (r.addedBy === userId) r.addedBy = null;
      }
    }
    // share_links.created_by is ON DELETE SET NULL.
    for (const link of this.shareLinks.values()) {
      if (link.createdBy === userId) link.createdBy = null;
    }
    // digest_subscriptions go with the account (ON DELETE CASCADE), and its mail settings with the row.
    for (const [key, d] of this.digests) {
      if (d.userId === userId) this.digests.delete(key);
    }
    this.accountMail.delete(userId);
    this.confirmationSends.delete(userId);
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
    this.userCreatedAt.delete(userId);
    this.userDisabledBy.delete(userId);
    return 'ok';
  }

  // --- Email digests (Task 19) ---

  private mailOf(userId: string) {
    return this.accountMail.get(userId) ?? { emailConfirmedAt: null, language: null, timeZone: null };
  }

  async getAccountMail(userId: string): Promise<AccountMail | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    const mail = this.mailOf(userId);
    const digests = [...this.digests.values()]
      .filter((d) => d.userId === userId)
      .sort((a, b) => (a.kind < b.kind ? -1 : 1))
      .map(({ kind, createdAt, lastSentWeek, lastMailedWeek, lastSentAt, failures, stoppedAt }) => ({ kind, createdAt, lastSentWeek, lastMailedWeek, lastSentAt, failures, stoppedAt }));
    return { email: user.email, ...mail, digests };
  }

  async setEmail(userId: string, email: string | null): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    if (user.email !== email) {
      user.email = email;
      this.accountMail.set(userId, { ...this.mailOf(userId), emailConfirmedAt: null });
      // A reset link mailed to the old address stops working with it.
      for (const [hash, reset] of this.resets) if (reset.userId === userId) this.resets.delete(hash);
    }
    return true;
  }

  async listUserIdsByConfirmedEmail(email: string, limit: number): Promise<string[]> {
    const wanted = email.toLowerCase();
    const ids: string[] = [];
    for (const user of this.users.values()) {
      if (ids.length >= limit) break;
      if (user.disabledAt || user.email === null || user.email.toLowerCase() !== wanted) continue;
      if (this.mailOf(user.id).emailConfirmedAt !== null) ids.push(user.id);
    }
    return ids;
  }

  async confirmEmail(userId: string, email: string, at: number): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user || user.email !== email) return false;
    const mail = this.mailOf(userId);
    if (mail.emailConfirmedAt === null) this.accountMail.set(userId, { ...mail, emailConfirmedAt: at });
    return true;
  }

  async setMailPreferences(userId: string, prefs: { language: MailLanguage | null; timeZone: string | null }): Promise<void> {
    if (!this.users.has(userId)) return;
    this.accountMail.set(userId, { ...this.mailOf(userId), language: prefs.language, timeZone: prefs.timeZone });
  }

  async setDigest(userId: string, kind: DigestKind, on: boolean, at: number): Promise<boolean> {
    const key = `${userId} ${kind}`;
    if (!on) return this.digests.delete(key);
    if (!this.users.has(userId)) return false;
    const d = this.digests.get(key);
    if (!d) {
      this.digests.set(key, { userId, kind, createdAt: at, lastSentWeek: null, lastMailedWeek: null, lastSentAt: null, failures: 0, stoppedAt: null });
    } else if (d.stoppedAt !== null) {
      d.stoppedAt = null;
      d.failures = 0;
    }
    return true;
  }

  async listDueDigests(q: { before: string; after: { userId: string; kind: DigestKind } | null; limit: number }): Promise<DueDigest[]> {
    const after = q.after ? `${q.after.userId} ${q.after.kind}` : null;
    return [...this.digests.entries()]
      .filter(([key, d]) => (after === null || key > after) && d.stoppedAt === null && (d.lastSentWeek === null || d.lastSentWeek < q.before))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, q.limit)
      .flatMap(([, d]) => {
        const user = this.users.get(d.userId);
        if (!user) return [];
        const mail = this.mailOf(d.userId);
        return [{
          userId: d.userId,
          kind: d.kind,
          createdAt: d.createdAt,
          lastSentWeek: d.lastSentWeek,
          username: user.username,
          email: user.email,
          emailConfirmed: mail.emailConfirmedAt !== null,
          disabled: !!user.disabledAt,
          language: mail.language,
          timeZone: mail.timeZone,
        }];
      });
  }

  async claimDigest(userId: string, kind: DigestKind, week: string, previous: string | null): Promise<boolean> {
    const d = this.digests.get(`${userId} ${kind}`);
    if (!d || d.lastSentWeek !== previous) return false;
    d.lastSentWeek = week;
    return true;
  }

  async markDigestSent(userId: string, kind: DigestKind, week: string, at: number): Promise<void> {
    const d = this.digests.get(`${userId} ${kind}`);
    if (!d) return;
    d.lastMailedWeek = week;
    d.lastSentAt = at;
    d.failures = 0;
  }

  async noteDigestFailure(userId: string, kind: DigestKind, at: number, max: number): Promise<boolean> {
    const d = this.digests.get(`${userId} ${kind}`);
    if (!d) return false;
    d.failures += 1;
    if (d.failures >= max && d.stoppedAt === null) d.stoppedAt = at;
    return d.stoppedAt !== null;
  }

  async releaseDigest(userId: string, kind: DigestKind, week: string, previous: string | null): Promise<void> {
    const d = this.digests.get(`${userId} ${kind}`);
    if (d && d.lastSentWeek === week) d.lastSentWeek = previous;
  }

  async reserveConfirmationSend(userId: string, at: number, limits: { perHour: number; perDay: number }): Promise<boolean> {
    const sends = (this.confirmationSends.get(userId) ?? []).filter((t) => t > at - 86_400_000);
    const lastHour = sends.filter((t) => t > at - 3_600_000).length;
    if (lastHour >= limits.perHour || sends.length >= limits.perDay) {
      this.confirmationSends.set(userId, sends);
      return false;
    }
    sends.push(at);
    this.confirmationSends.set(userId, sends);
    return true;
  }

  private enabledPlatformAdmins(): number {
    return [...this.users.values()].filter((u) => u.isPlatformAdmin && !u.disabledAt).length;
  }

  // --- Platform administration ---

  async hasPlatformAdmin(): Promise<boolean> {
    return [...this.users.values()].some((u) => u.isPlatformAdmin);
  }

  async countPlatformAdmins(): Promise<number> {
    return this.enabledPlatformAdmins();
  }

  async disableUser(userId: string, disabledBy: string): Promise<'ok' | 'last_platform_admin' | 'not_found'> {
    const user = this.users.get(userId);
    if (!user) {
      return 'not_found';
    }
    // Counted and written with no await between them: two admins disabling each other at once
    // cannot both pass the count (Postgres holds a lock for that).
    if (user.isPlatformAdmin && !user.disabledAt && this.enabledPlatformAdmins() <= 1) {
      return 'last_platform_admin';
    }
    if (!user.disabledAt) {
      user.disabledAt = Date.now();
      this.userDisabledBy.set(userId, disabledBy);
    }
    await this.deleteUserSessions(userId);
    for (const [hash, entry] of this.resets) {
      if (entry.userId === userId) {
        this.resets.delete(hash);
      }
    }
    return 'ok';
  }

  async enableUser(userId: string): Promise<'ok' | 'not_found'> {
    const user = this.users.get(userId);
    if (!user) {
      return 'not_found';
    }
    user.disabledAt = null;
    this.userDisabledBy.delete(userId);
    return 'ok';
  }

  async platformStats(q: { activeSince: number; signupsFrom: number; receivedFrom: number }): Promise<PlatformStats> {
    const users = [...this.users.values()];
    const active = new Set<string>();
    for (const [hash, userId] of this.sessions) {
      if ((this.sessionCreatedAt.get(hash) ?? 0) >= q.activeSince) {
        active.add(userId);
      }
    }
    const signups = new Map<number, number>();
    for (const u of users) {
      const at = this.userCreatedAt.get(u.id) ?? 0;
      if (at >= q.signupsFrom) {
        const day = Math.floor(at / DAY_MS) * DAY_MS;
        signups.set(day, (signups.get(day) ?? 0) + 1);
      }
    }
    const received = new Map<number, number>();
    const projects: PlatformStats['projects'] = [];
    for (const [projectId, entry] of this.projects) {
      let isActive = false;
      for (const a of entry.memberActivity.values()) {
        if (a.lastSeenAt !== null && a.lastSeenAt >= q.activeSince) {
          active.add(a.userId);
          isActive = true;
        }
      }
      for (const e of entry.recordEvents) {
        if (e.receivedAt >= q.activeSince) {
          isActive = true;
        }
        if (e.receivedAt >= q.receivedFrom) {
          const day = Math.floor(e.receivedAt / DAY_MS) * DAY_MS;
          received.set(day, (received.get(day) ?? 0) + 1);
        }
      }
      projects.push({ projectId, storageBytes: totalStorageBytes(await this.getProjectStorage(projectId)), active: isActive });
    }
    const byDay = (m: Map<number, number>) => [...m].map(([day, count]) => ({ day, count })).sort((a, b) => a.day - b.day);
    return {
      users: users.length,
      disabledUsers: users.filter((u) => u.disabledAt).length,
      platformAdmins: await this.countPlatformAdmins(),
      // Disabled accounts are not active, whatever they did before.
      activeUsers: [...active].filter((id) => this.users.has(id) && !this.users.get(id)!.disabledAt).length,
      signupsByDay: byDay(signups),
      projects: projects.sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0)),
      receivedByDay: byDay(received),
    };
  }

  async databaseHealth(): Promise<DatabaseHealth> {
    return { sizeBytes: null, version: null, migrations: null };
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
        disabledAt: u.disabledAt ?? null,
        disabledBy: u.disabledAt ? (this.users.get(this.userDisabledBy.get(u.id) ?? '')?.username ?? null) : null,
        twoFactor: !!(this.twoFactor.get(u.id)?.enabledAt && this.twoFactor.get(u.id)?.secretEnc),
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  async createPasswordReset(userId: string, expiresAt: number): Promise<string | null> {
    const user = this.users.get(userId);
    if (!user || user.disabledAt) {
      return null;
    }
    const token = generateToken();
    this.resets.set(hashToken(token), { userId, expiresAt, usedAt: null });
    return token;
  }

  async checkPasswordReset(token: string, now: number): Promise<boolean> {
    const entry = this.resets.get(hashToken(token));
    return !!entry && entry.usedAt === null && entry.expiresAt > now && this.users.has(entry.userId);
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
          result.push({ projectId, projectName: project.name, role, status: project.status });
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
          const excluded = this.excludedMembers.get(key);
          result.push({ userId, username: user.username, role, disabled: !!user.disabledAt, ...(excluded ? { excluded: { ...excluded } } : {}) });
        }
      }
    }
    return result;
  }

  async setMemberExcluded(projectId: string, userId: string, excluded: { at: number; reason: string | null } | null): Promise<boolean> {
    const id = InMemoryStore.memberId(projectId, userId);
    if (!this.memberships.has(id)) return false;
    if (excluded) this.excludedMembers.set(id, { ...excluded });
    else this.excludedMembers.delete(id);
    return true;
  }

  async setMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
    const id = InMemoryStore.memberId(projectId, userId);
    if (this.memberships.has(id)) {
      this.memberships.set(id, role);
    }
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    this.memberships.delete(InMemoryStore.memberId(projectId, userId));
    this.excludedMembers.delete(InMemoryStore.memberId(projectId, userId));
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
    entry.attentionReads.delete(userId);
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

  // --- Progress links (Task 18) ---

  private shareLinkOf(e: ShareLinkEntry): ShareLink {
    return {
      id: e.id,
      label: e.label,
      createdAt: e.createdAt,
      createdBy: e.createdBy === null ? null : (this.users.get(e.createdBy)?.username ?? null),
      lastUsedAt: e.lastUsedAt,
    };
  }

  async createShareLink(projectId: string, input: { label: string; createdBy: string | null; max: number }): Promise<{ token: string; link: ShareLink } | null> {
    this.requireProject(projectId);
    // Counted and added with no await in between: links made at once never pass the cap.
    if ([...this.shareLinks.values()].filter((e) => e.projectId === projectId && e.revokedAt === null).length >= input.max) {
      return null;
    }
    // As Postgres' share_links.created_by REFERENCES users(id): a user, or nobody.
    if (input.createdBy !== null && !this.users.has(input.createdBy)) {
      throw new Error('share_links.created_by must be a user id or null');
    }
    const token = generateShareToken();
    const entry: ShareLinkEntry = { id: randomUUID(), projectId, label: input.label, createdBy: input.createdBy, createdAt: Date.now(), revokedAt: null, lastUsedAt: null };
    this.shareLinks.set(hashToken(token), entry);
    return { token, link: this.shareLinkOf(entry) };
  }

  async listShareLinks(projectId: string): Promise<ShareLink[]> {
    return [...this.shareLinks.values()]
      .filter((e) => e.projectId === projectId && e.revokedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .map((e) => this.shareLinkOf(e));
  }

  async revokeShareLink(projectId: string, linkId: string): Promise<ShareLink | null> {
    for (const e of this.shareLinks.values()) {
      // Matching on projectId too: a link of another project is "not found" here.
      if (e.id === linkId && e.projectId === projectId && e.revokedAt === null) {
        e.revokedAt = Date.now();
        return this.shareLinkOf(e);
      }
    }
    return null;
  }

  async findShareLink(token: string): Promise<{ linkId: string; projectId: string } | null> {
    const e = this.shareLinks.get(hashToken(token));
    if (!e || e.revokedAt !== null || !this.projects.has(e.projectId)) {
      return null;
    }
    return { linkId: e.id, projectId: e.projectId };
  }

  async setPublicQuality(projectId: string, quality: PublicQuality): Promise<void> {
    const entry = this.requireProject(projectId);
    if (entry.publicQuality === null || entry.publicQuality.computedAt <= quality.computedAt) {
      entry.publicQuality = { ...quality };
    }
  }

  async getPublicQuality(projectId: string): Promise<PublicQuality | null> {
    const q = this.projects.get(projectId)?.publicQuality ?? null;
    return q ? { ...q } : null;
  }

  async touchShareLink(projectId: string, linkId: string, at: number): Promise<void> {
    for (const e of this.shareLinks.values()) {
      if (e.id === linkId && e.projectId === projectId && (e.lastUsedAt === null || e.lastUsedAt < at - 60_000)) {
        e.lastUsedAt = at;
      }
    }
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
      for (const [key, r] of entry.references) {
        if (r.csvFileId === id && !keep.has(r.plotKey)) entry.references.delete(key);
      }
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
      // Reference plots (Task 14) keep their holdings as stored now (the Postgres store reads them under the lock).
      const refs = new Set([...entry.references.values()].filter((r) => r.csvFileId === csvFileId).map((r) => r.plotKey));
      if (refs.size > 0) {
        const kept = (entry.plotAssignments.get(csvFileId) ?? []).filter((a) => refs.has(a.plotKey));
        plots = [...plots.filter((a) => !refs.has(a.plotKey)), ...kept];
      }
      entry.plotAssignments.set(csvFileId, plots.map((a) => ({ ...a })));
      for (const a of entry.assignments) {
        if (a.endsWith(` ${csvFileId}`)) {
          entry.assignments.delete(a);
        }
      }
    } else {
      entry.plotAssignments.delete(csvFileId);
      // Whole files hold no copies: their reference plots go too.
      for (const [key, r] of entry.references) {
        if (r.csvFileId === csvFileId) entry.references.delete(key);
      }
    }
  }

  async listPlotAssignments(projectId: string, csvFileId: string): Promise<PlotAssignment[]> {
    return (this.projects.get(projectId)?.plotAssignments.get(csvFileId) ?? []).map((a) => ({ ...a }));
  }

  private static emptySampling(): SamplingState & { active: boolean; lastMarkedAt: number | null } {
    return { rule: null, dueSince: null, lastAutoDrawAt: null, lastDraw: null, lastCheckedAt: null, active: false, lastMarkedAt: null };
  }

  async getSampling(projectId: string): Promise<SamplingState> {
    const s = this.projects.get(projectId)?.sampling ?? InMemoryStore.emptySampling();
    return structuredClone({ rule: s.rule, dueSince: s.dueSince, lastAutoDrawAt: s.lastAutoDrawAt, lastDraw: s.lastDraw, lastCheckedAt: s.lastCheckedAt });
  }

  async setSamplingRule(projectId: string, rule: SamplingRule, active: boolean): Promise<void> {
    const entry = this.requireProject(projectId);
    const s = entry.sampling ?? InMemoryStore.emptySampling();
    entry.sampling = { ...s, rule: structuredClone(rule), active, dueSince: active ? s.dueSince : null };
  }

  async claimSamplingDraw(projectId: string, q: { now: number; markDue: boolean; minIntervalMs: number }): Promise<boolean> {
    const s = this.projects.get(projectId)?.sampling;
    if (!s?.active) {
      return false;
    }
    const claim = (s.dueSince !== null || q.markDue) && (s.lastAutoDrawAt === null || s.lastAutoDrawAt <= q.now - q.minIntervalMs);
    if (q.markDue) {
      s.dueSince ??= q.now;
      s.lastMarkedAt = Math.max(s.lastMarkedAt ?? q.now, q.now);
    }
    if (claim) {
      s.lastAutoDrawAt = q.now;
    }
    return claim;
  }

  async addSampledCopies(
    projectId: string,
    copies: readonly SampledCopy[],
    drop: readonly { csvFileId: string; plotKey: string; userId: string }[],
    draw: SamplingDraw,
    dueBefore: number,
  ): Promise<SampledCopy[]> {
    const entry = this.requireProject(projectId);
    let changed = false;
    for (const d of drop) {
      const list = entry.plotAssignments.get(d.csvFileId);
      const i = list?.findIndex((a) => a.plotKey === d.plotKey && a.userId === d.userId && a.overlap && a.sampledAt !== undefined) ?? -1;
      if (list && i >= 0) {
        list.splice(i, 1);
        changed = true;
      }
    }
    const added: SampledCopy[] = [];
    for (const c of copies) {
      const file = entry.csvFiles.get(c.csvFileId);
      const list = entry.plotAssignments.get(c.csvFileId);
      if (!file?.distribution || !list || !this.memberships.has(InMemoryStore.memberId(projectId, c.userId))) {
        continue;
      }
      if (list.some((a) => a.plotKey === c.plotKey && (a.overlap || a.userId === c.userId))) {
        continue;
      }
      list.push({ plotKey: c.plotKey, userId: c.userId, overlap: true, sampledAt: draw.at });
      added.push({ ...c });
    }
    if (added.length > 0 || changed) {
      entry.holdingsGeneration += 1;
    }
    const s = entry.sampling ?? InMemoryStore.emptySampling();
    const count = (reason: SampledCopy['reason']) => added.filter((c) => c.reason === reason).length;
    entry.sampling = {
      ...s,
      // The last draw that added copies; every draw, empty ones too, is when it last looked.
      lastDraw: added.length > 0 ? { ...draw, drawn: added.length, firstN: count('firstN'), percent: count('percent') } : s.lastDraw,
      lastCheckedAt: draw.at,
      // Due ends only when nothing was marked due after the draw's inputs were read.
      dueSince: s.dueSince !== null && (s.lastMarkedAt ?? s.dueSince) <= dueBefore ? null : s.dueSince,
    };
    return added;
  }

  async listReferenceAnswers(projectId: string): Promise<ReferenceAnswer[]> {
    return [...(this.projects.get(projectId)?.referenceAnswers.values() ?? [])].map((r) => ({ ...r, answers: { ...r.answers } }));
  }

  async replaceReferenceAnswers(projectId: string, rows: readonly { plotKey: string; answers: Record<string, string> }[], at: number): Promise<void> {
    const entry = this.requireProject(projectId);
    entry.referenceAnswers = new Map(rows.map((r) => [r.plotKey, { plotKey: r.plotKey, answers: { ...r.answers }, uploadedAt: at }]));
    // The quality figures' version follows the set, as Postgres's trigger (033).
    entry.holdingsGeneration += 1;
  }

  async listReferencePlots(projectId: string): Promise<ReferencePlot[]> {
    const entry = this.projects.get(projectId);
    const result: ReferencePlot[] = [];
    for (const r of entry?.references.values() ?? []) {
      const user = this.users.get(r.assessorUserId);
      if (entry!.csvFiles.get(r.csvFileId)?.distribution && user) result.push({ ...r, assessor: user.username });
    }
    return result;
  }

  async changeReferencePlots(projectId: string, change: ReferenceChange): Promise<ReferenceChangeResult> {
    const entry = this.requireProject(projectId);
    const key = (csvFileId: string, plotKey: string) => `${csvFileId} ${plotKey}`;
    const isMember = (userId: string) => this.memberships.has(InMemoryStore.memberId(projectId, userId));
    const result: ReferenceChangeResult = { unmarked: 0, marked: 0, copiesAdded: 0, copiesDropped: 0 };
    for (const u of change.unmark) {
      if (entry.references.delete(key(u.csvFileId, u.plotKey))) result.unmarked += 1;
    }
    for (const d of change.dropCopies) {
      const list = entry.plotAssignments.get(d.csvFileId);
      const i = list?.findIndex((a) => a.plotKey === d.plotKey && a.userId === d.userId && a.overlap) ?? -1;
      if (list && i >= 0) {
        list.splice(i, 1);
        result.copiesDropped += 1;
      }
    }
    for (const m of change.mark) {
      const list = entry.plotAssignments.get(m.csvFileId);
      if (!entry.csvFiles.get(m.csvFileId)?.distribution || !list || !isMember(m.assessorUserId)) continue;
      const k = key(m.csvFileId, m.plotKey);
      const before = entry.references.get(k);
      entry.references.set(k, {
        csvFileId: m.csvFileId,
        plotKey: m.plotKey,
        assessorUserId: m.assessorUserId,
        addedAt: before?.addedAt ?? change.at,
        addedBy: before?.addedBy ?? change.by,
      });
      result.marked += 1;
      // The assessor holds it as main; everyone else holding it there keeps a copy (no longer drawn).
      let held = false;
      for (const a of list) {
        if (a.plotKey !== m.plotKey) continue;
        a.overlap = a.userId !== m.assessorUserId;
        held ||= a.userId === m.assessorUserId;
        delete a.sampledAt;
      }
      if (!held) list.push({ plotKey: m.plotKey, userId: m.assessorUserId, overlap: false });
    }
    for (const c of change.addCopies) {
      const ref = entry.references.get(key(c.csvFileId, c.plotKey));
      const list = entry.plotAssignments.get(c.csvFileId);
      if (!ref || !list || !entry.csvFiles.get(c.csvFileId)?.distribution || ref.assessorUserId === c.userId || !isMember(c.userId)) continue;
      if (list.some((a) => a.plotKey === c.plotKey && a.userId === c.userId)) continue;
      list.push({ plotKey: c.plotKey, userId: c.userId, overlap: true });
      result.copiesAdded += 1;
    }
    if (result.unmarked + result.marked + result.copiesAdded + result.copiesDropped > 0) entry.holdingsGeneration += 1;
    return result;
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

  async listPlotHolders(projectId: string, csvFileIds: readonly string[], plotKeys: readonly string[]): Promise<(PlotAssignment & { csvFileId: string })[]> {
    const entry = this.projects.get(projectId);
    const keys = new Set(plotKeys);
    const result: (PlotAssignment & { csvFileId: string })[] = [];
    for (const csvFileId of new Set(csvFileIds)) {
      for (const a of entry?.plotAssignments.get(csvFileId) ?? []) {
        if (keys.has(a.plotKey)) result.push({ csvFileId, plotKey: a.plotKey, userId: a.userId, overlap: a.overlap });
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
    seen: { operator: string; hash: number; full?: number }[] | null = null,
  ): Promise<QualityDecision> {
    const entry = this.requireProject(projectId);
    const stored: StoredDecision = { decision, comment, decidedBy: this.requireUserOrNull(userId), decidedAt: Date.now(), seen: seen ? structuredClone(seen) : null, batch: null };
    entry.decisions.set(plot, stored);
    return this.decisionOf(plot, stored);
  }

  async addQualityDecisions(
    projectId: string,
    decisions: readonly { plot: string; decision: DecisionKind; seen: { operator: string; hash: number; full?: number }[] | null }[],
    comment: string | null,
    userId: string | null,
    batch: string,
  ): Promise<string[]> {
    const entry = this.requireProject(projectId);
    const decidedBy = this.requireUserOrNull(userId);
    const decidedAt = Date.now();
    const added: string[] = [];
    for (const d of decisions) {
      if (entry.decisions.has(d.plot)) continue;
      entry.decisions.set(d.plot, { decision: d.decision, comment, decidedBy, decidedAt, seen: d.seen ? structuredClone(d.seen) : null, batch });
      added.push(d.plot);
    }
    return added;
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
    checkCursor(q.before, q);
    const events = this.projects.get(projectId)?.recordEvents ?? [];
    return events
      .filter(
        (e) =>
          e.modifiedOn >= q.from &&
          e.modifiedOn < q.to &&
          (q.operator === undefined || e.operator === q.operator) &&
          (q.changes === undefined || q.changes.includes(e.change)) &&
          (q.before === undefined || isBefore(e.modifiedOn, e.id, q.before)),
      )
      .sort((x, y) => y.modifiedOn - x.modifiedOn || Number(y.id) - Number(x.id))
      .slice(0, q.limit)
      .map((e) => ({ ...e, summary: e.summary ? { ...e.summary } : null }));
  }

  async recordEventCounts(projectId: string, q: { from: number; to: number }): Promise<RecordEventCount[]> {
    const counts = new Map<string, RecordEventCount>();
    for (const e of this.projects.get(projectId)?.recordEvents ?? []) {
      if (e.modifiedOn < q.from || e.modifiedOn >= q.to) continue;
      const at = Math.floor(e.modifiedOn / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
      const key = `${e.operator}\u0000${e.change}\u0000${at}`;
      const c = counts.get(key);
      if (c) c.count += 1;
      else counts.set(key, { operator: e.operator, change: e.change, at, count: 1 });
    }
    return [...counts.values()].sort((a, b) => a.at - b.at || (a.operator < b.operator ? -1 : a.operator > b.operator ? 1 : 0) || (a.change < b.change ? -1 : a.change > b.change ? 1 : 0));
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

  async getAnalysisViews(projectId: string): Promise<SharedAnalysisView[]> {
    return structuredClone(this.projects.get(projectId)?.analysisViews ?? []);
  }

  async setAnalysisViews(projectId: string, views: SharedAnalysisView[]): Promise<void> {
    this.requireProject(projectId).analysisViews = structuredClone(views);
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
    checkCursor(q.before, q);
    const audit = this.projects.get(projectId)?.audit ?? [];
    return audit
      .filter(
        (e) =>
          (q.actor === undefined || e.actorUserId === q.actor) &&
          (q.action === undefined || e.action === q.action) &&
          (q.actions === undefined || q.actions.includes(e.action)) &&
          (q.from === undefined || e.at >= q.from) &&
          (q.to === undefined || e.at < q.to) &&
          (q.before === undefined || isBefore(e.at, e.id, q.before)),
      )
      .sort((x, y) => y.at - x.at || Number(y.id) - Number(x.id))
      .slice(0, q.limit)
      .map((e) => ({ ...e, details: { ...e.details }, actor: this.usernameOf(e.actorUserId) }));
  }

  async listAttentionReads(projectId: string, userId: string): Promise<string[]> {
    return [...(this.projects.get(projectId)?.attentionReads.get(userId) ?? [])].sort();
  }

  async setAttentionReads(projectId: string, userId: string, keys: readonly string[]): Promise<void> {
    const entry = this.projects.get(projectId);
    if (!entry || !this.memberships.has(InMemoryStore.memberId(projectId, userId))) return;
    entry.attentionReads.set(userId, new Set(keys));
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
    return { plot, decision: d.decision, comment: d.comment, decidedBy: this.usernameOf(d.decidedBy), decidedAt: d.decidedAt, seen: d.seen ? structuredClone(d.seen) : null, batch: d.batch ?? null };
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
    this.sessionCreatedAt.clear();
    this.userCreatedAt.clear();
    this.userDisabledBy.clear();
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

/** record_events are counted by quarter of an hour (recordEventCounts). */
const QUARTER_HOUR_MS = 900_000;

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
