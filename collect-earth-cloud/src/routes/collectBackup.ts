import { Readable } from 'node:stream';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../activity.js';
import { ATTRIBUTE_AREAS_CSV } from '../analysis.js';
import { backupSurvey } from '../backupImport.js';
import { readBackupLink, UsedLinks, writeBackupLink, linkSecret } from '../backupLink.js';
import { cepProperties, noteColumn, readCep, type CepFiles, type RoundInfo } from '../cep.js';
import {
  BACKUP_FORMATS,
  BACKUP_ROUNDS,
  BYTES_PER_RECORD,
  SURVEY_BYTES,
  collectBackupZip,
  collectHead,
  planBackup,
  type BackupFormat,
  type BackupOutcome,
  type BackupPlan,
  type BackupRounds,
  type PlanInput,
} from '../collectBackup.js';
import type { Config } from '../config.js';
import { attachment } from '../download.js';
import { holderHas } from '../holders.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { recordResolver } from '../quality.js';
import { loadPlotContext } from '../qualityService.js';
import type { RateLimiter } from '../rateLimit.js';
import { keyShape } from '../rounds.js';
import type { Store } from '../store/store.js';
import { wholeFile } from './assignments.js';

const BUSY = { error: 'backup_busy', reason: 'another Collect Earth backup is being prepared on this server: try again in a few minutes' };

/**
 * The Collect Earth backup (Task 17), coordinators only:
 * - `GET /v1/projects/:pid/exports/collect-backup/summary`: what the file would hold with each choice;
 * - `POST /v1/projects/:pid/exports/collect-backup/link { rounds, format? }`: a download link, signed, for 60 s
 *   and one use (backupLink.ts), so the browser downloads the file by itself;
 * - `GET /v1/collect-backup/:token`: the file, by that link (no session: the link is the permission,
 *   checked again against the coordinator's role);
 * - `GET /v1/projects/:pid/exports/collect-backup?rounds=1|all&format=zip|collect`: the file, with the session.
 * `format` is `zip` (Collect Earth's import, the default) or `collect` (OpenForis Collect's own backup,
 * .collect-backup, with the plot files and the areas per stratum; collectBackup.ts).
 * One backup is written at a time on an instance (memory: 100,000 records keep the heap under
 * 384 MB, two at once would not); another gets 429 `backup_busy`. The link and the downloads go
 * through the rate limiter's `admin` bucket. A download is audited (`export.downloaded { kind:
 * 'collect-backup', rows, rounds }`) when it starts, and again with `completed: false` when the
 * client goes away before the end (`format` noted too).
 */
export async function registerCollectBackupRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
  limiter: RateLimiter,
  now: () => number = Date.now,
): Promise<void> {
  const secret = linkSecret(config);
  const used = new UsedLinks();
  let busy = false;
  const admin = { preHandler: [limiter.guard('admin'), requireProjectMembership(store, 'admin')] };

  app.get(
    '/v1/projects/:pid/exports/collect-backup/summary',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const facts = await backupFacts(store, projectId, request.log);
      return reply.send({
        projectFile: facts.projectFile,
        roundKey: facts.roundKey,
        roundState: facts.info?.state ?? null,
        firstCodes: firstCodes(facts.info),
        note: facts.note,
        rounds: {
          '1': planSummary(planBackup(facts.input, '1')),
          all: facts.roundKey ? planSummary(planBackup(facts.input, 'all')) : null,
        },
      });
    },
  );

  app.post('/v1/projects/:pid/exports/collect-backup/link', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const body = request.body as { rounds?: unknown; format?: unknown } | null;
    const rounds = body?.rounds;
    const format = body?.format ?? 'zip';
    if (!BACKUP_ROUNDS.includes(rounds as BackupRounds)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'rounds is 1 or all' });
    }
    if (!BACKUP_FORMATS.includes(format as BackupFormat)) return reply.code(400).send(BAD_FORMAT);
    const refusal = await refusalOf(store, projectId, rounds as BackupRounds);
    if (refusal) return reply.code(409).send(refusal);
    if (busy) return reply.code(429).send(BUSY);
    const { token, expiresAt } = writeBackupLink(
      { projectId, userId: request.membership!.userId ?? null, rounds: rounds as BackupRounds, format: format as BackupFormat },
      secret,
      now(),
    );
    return reply.send({ url: `/v1/collect-backup/${token}`, expiresAt });
  });

  app.get('/v1/collect-backup/:token', { preHandler: limiter.guard('admin') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const at = now();
    const link = readBackupLink((request.params as { token: string }).token, secret, at);
    if (link === null) return reply.code(404).send({ error: 'not_found' });
    if (link === 'expired') return reply.code(410).send({ error: 'link_expired', reason: 'the download link is used within a minute: ask for the backup again' });
    // Still a coordinator of the project (a project admin token's link: the project still exists).
    if (link.userId !== null) {
      const membership = await store.getMembership(link.projectId, link.userId);
      if (!membership) return reply.code(404).send({ error: 'not_found' });
      if (membership.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    } else if (!(await store.getProject(link.projectId))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (busy) return reply.code(429).send(BUSY);
    if (!used.use(link, at)) return reply.code(410).send({ error: 'link_used', reason: 'the download link was used already: ask for the backup again' });
    request.membership = { projectId: link.projectId, role: 'admin', ...(link.userId ? { userId: link.userId } : {}) };
    return send(request, reply, link.projectId, link.rounds, link.format);
  });

  app.get('/v1/projects/:pid/exports/collect-backup', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const { rounds = '1', format = 'zip' } = request.query as { rounds?: BackupRounds; format?: BackupFormat };
    if (!BACKUP_ROUNDS.includes(rounds)) {
      return reply.code(400).send({ error: 'bad_request', reason: 'rounds is 1 or all' });
    }
    if (!BACKUP_FORMATS.includes(format)) return reply.code(400).send(BAD_FORMAT);
    return send(request, reply, request.membership!.projectId, rounds, format);
  });

  /** Writes the backup to the response, one at a time on this instance. */
  async function send(request: FastifyRequest, reply: FastifyReply, projectId: string, rounds: BackupRounds, format: BackupFormat) {
    if (busy) return reply.code(429).send(BUSY);
    busy = true;
    let handedOver = false;
    try {
      const project = await store.getProject(projectId);
      if (!project) return reply.code(404).send({ error: 'not_found' });
      const [facts, cep] = await Promise.all([backupFacts(store, projectId, request.log), store.getCep(projectId)]);
      if (!cep) return reply.code(409).send(NO_PROJECT_FILE);
      if (rounds === 'all' && !facts.roundKey) return reply.code(409).send(NO_ROUND_KEY);
      // The survey as served (with the round and the coordinator's note the server added): the one
      // Collect Earth has loaded, which the import finds by its URI.
      const files = readCep(cep);
      const date = new Date(now());
      const head =
        format === 'collect'
          ? await collectHeadOf(store, projectId, files, facts.info, date)
          : [{ name: 'idml.xml', data: files.entries.get(files.surveyPath)! }];
      const plan = planBackup(facts.input, rounds);
      const details = { kind: 'collect-backup', rows: plan.records.length, rounds, format };
      await audit(store, request, 'export.downloaded', details);
      const outcome: BackupOutcome = { written: 0, missing: 0, deleted: 0 };
      const stream = Readable.from(collectBackupZip(store, projectId, head, plan, date, outcome, format));
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        busy = false;
        if (outcome.missing > 0 || outcome.deleted > 0) {
          request.log.warn({ missing: outcome.missing, deleted: outcome.deleted }, 'collect backup: records gone or deleted since the plan were left out');
        }
      };
      reply.raw.once('finish', release);
      reply.raw.once('close', () => {
        const finished = reply.raw.writableFinished;
        release();
        if (!finished) {
          stream.destroy();
          void audit(store, request, 'export.downloaded', { ...details, completed: false });
        }
      });
      handedOver = true;
      const allRounds = rounds === 'all' ? '-all-rounds' : '';
      return reply
        .header('content-type', format === 'collect' ? 'application/octet-stream' : 'application/zip')
        .header(
          'content-disposition',
          format === 'collect'
            ? attachment(`${project.name}${allRounds}.collect-backup`, 'backup.collect-backup')
            : attachment(`${project.name}-collect-earth-backup${allRounds}.zip`, 'collect-earth-backup.zip'),
        )
        .send(stream);
    } finally {
      if (!handedOver) busy = false;
    }
  }
}

const BAD_FORMAT = { error: 'bad_request', reason: 'format is zip or collect' };
const NO_PROJECT_FILE = { error: 'no_project_file', reason: 'the backup carries the survey of the project file: upload a project file first' };
// Without round in the key a plot's first assessment and its check have one key, and Collect Earth
// keeps one record per key: only the first assessments can go.
const NO_ROUND_KEY = { error: 'no_round_key', reason: 'the survey has no round key: only the first assessments can be in the backup' };

/**
 * The files of OpenForis Collect's backup before its records: the survey as served, under the name
 * Collect Earth gives it (the project file's survey_name), and each plot file whole, as people get it
 * (with the round and note columns the served survey has).
 */
async function collectHeadOf(store: Store, projectId: string, files: CepFiles, info: RoundInfo | null, date: Date) {
  const survey = files.entries.get(files.surveyPath)!;
  const read = backupSurvey(new TextDecoder().decode(survey));
  const grids: { filename: string; data: Uint8Array }[] = [];
  for (const meta of await store.listCsvFiles(projectId)) {
    const file = await store.getCsvFile(projectId, meta.id);
    if (file) grids.push({ filename: file.filename, data: wholeFile(file, info).data });
  }
  const name = cepProperties(files).get('survey_name') || read.surveyName;
  return collectHead({ survey, uri: read.uri, name, grids, areas: files.entries.get(ATTRIBUTE_AREAS_CSV) ?? null }, date);
}

/** Why a backup cannot be made now (before a link is given), or null. */
async function refusalOf(store: Store, projectId: string, rounds: BackupRounds) {
  const [cepInfo, info] = await Promise.all([store.getCepInfo(projectId), store.getRoundInfo(projectId)]);
  if (!cepInfo) return NO_PROJECT_FILE;
  if (rounds === 'all' && keyShape(info).roundIndex === null) return NO_ROUND_KEY;
  return null;
}

/** What the backup is made of: the records with their round, reference plot, holder and XML. */
async function backupFacts(store: Store, projectId: string, log: FastifyBaseLogger) {
  const [records, context, cepInfo, withoutXml] = await Promise.all([
    store.listRecordStates(projectId),
    loadPlotContext(store, projectId, log),
    store.getCepInfo(projectId),
    store.listRecordKeysWithoutXml(projectId),
  ]);
  const { info, units, copyHolders, reference, mainHolders } = context;
  const resolve = recordResolver({ info, units, copyHolders });
  const resolved = new Map<string, ReturnType<typeof resolve>>();
  const id = (r: { recordKey: string; operator: string }) => `${r.recordKey}\u0000${r.operator}`;
  const of = (r: { recordKey: string; operator: string }) => {
    let hit = resolved.get(id(r));
    if (!hit) {
      hit = resolve(r);
      resolved.set(id(r), hit);
    }
    return hit;
  };
  const noXml = new Set(withoutXml.map(id));
  const input: PlanInput = {
    records,
    roundOf: (r) => of(r).round,
    isReference: (r) => reference.size > 0 && reference.has(of(r).group),
    isMainHolder: (r) => {
      const unit = of(r).unit;
      return unit !== null && holderHas(mainHolders.get(unit), r.operator);
    },
    hasXml: (r) => !noXml.has(id(r)),
  };
  return {
    input,
    info,
    projectFile: cepInfo !== null,
    roundKey: keyShape(info).roundIndex !== null,
    note: noteColumn(info) !== null,
  };
}

/**
 * The round codes the first assessments have, to name them in the dialog: "1" when the server
 * added round; a survey's own round, its codes but the re-assessment code (none set: null, the
 * holders tell them apart); no round: null.
 */
function firstCodes(info: RoundInfo | null): string[] | null {
  if (!info || keyShape(info).roundIndex === null) return null;
  if (info.state === 'added') return ['1'];
  if (info.reassessmentCode === null) return null;
  return info.roundCodes.map((c) => c.code).filter((c) => c !== info.reassessmentCode);
}

/** A plan's counts for the dialog (not its list of records), and about how large the file is. */
function planSummary(plan: BackupPlan) {
  return {
    records: plan.records.length,
    drafts: plan.drafts,
    otherRounds: plan.otherRounds,
    measurements: plan.measurements,
    sameKey: plan.sameKey,
    sameKeyExamples: plan.sameKeyExamples,
    noXml: plan.noXml,
    estimatedBytes: SURVEY_BYTES + plan.records.length * BYTES_PER_RECORD,
  };
}
