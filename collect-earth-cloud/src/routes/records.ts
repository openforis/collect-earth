import { telemetry } from '../telemetry.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RecordUpload, Store } from '../store/store.js';
import { PROJECT_DRAFT, requireProjectMembership } from '../plugins/projectAuth.js';
import { audit, noteActivity } from '../activity.js';
import { isServerMadeName } from '../anonymize.js';
import { applyLww, recordEventOf } from '../lww.js';
import { plotOwnershipOf } from '../plotOwnership.js';
import type { SamplingService } from '../samplingService.js';
import type { BatchItemResult, RecordEnvelope, RoundInfo } from '../types.js';
import { isTrainingRecord, trainingPlots } from './training.js';
import { keyShape, splitKey } from '../rounds.js';

interface BatchBody {
  records?: unknown[];
}

/**
 * Record intake. Accepts a batch of envelopes (or tombstones), applies
 * last-write-wins per (project, recordKey, operator), and returns a per-record
 * status the client uses to advance or retry its local sync queue.
 *
 * With a user session the records are stored under the session's username, whatever
 * operator the envelope names: the quality figures and the personal report go by the
 * operator, so no one may write records as someone else. The envelope's operator is
 * not refused when it differs (the collector may have changed the operator name in
 * Collect Earth's settings, and refusing would lose their work); it is logged once per
 * request. Collect Earth matches the results by recordKey only. A project token is no
 * person: its envelopes keep their operator.
 *
 * Each stored upload is logged in record_events (what it changed: recordEventOf);
 * stale ones and the same save sent again are not. The sync counts in the member's
 * activity, with the records stored.
 *
 * The request body is gzip-compressed by the Java client; the gunzip preParsing
 * hook in buildServer() decompresses it before this handler runs. The route path
 * contains a literal ':batch' segment (Collect Earth posts to `records:batch`).
 */
/** Sync batches an instance takes at once by default (RECORDS_BATCH_CONCURRENCY) */
export const DEFAULT_BATCH_CONCURRENCY = 16;

export async function registerRecordRoutes(app: FastifyInstance, store: Store, sampling?: SamplingService, options: { concurrency?: number } = {}): Promise<void> {
  // Batches taken at once, the others answered 503 busy before their body is read. A room of Collect Earths back
  // online sends a backlog each at the same moment (50 records of 10-20 KB a batch): parsed all at once, they waited
  // in memory for one of the pool's connections until the heap ran out and the instance stopped (load test, 17 Nov
  // 2026: 200 batches at once, a heap of 224 MB). Collect Earth sends a refused batch again later (CloudSyncService).
  const limit = options.concurrency ?? DEFAULT_BATCH_CONCURRENCY;
  let inFlight = 0;
  const taken = new WeakSet<FastifyRequest>();
  const release = async (request: FastifyRequest) => {
    if (taken.delete(request)) inFlight -= 1;
  };
  app.post(
    '/v1/projects/:pid/records:batch',
    {
      onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
        if (limit > 0 && inFlight >= limit) {
          void reply.code(503).header('retry-after', '10').send({ error: 'busy', reason: 'The server is busy: the records will be sent again in a moment.' });
          return reply;
        }
        inFlight += 1;
        taken.add(request);
      },
      onResponse: release,
      onRequestAbort: release,
      preHandler: requireProjectMembership(store),
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      let sessionUsername: string | null = null;
      if (request.membership!.userId) {
        const user = await store.getUserById(request.membership!.userId);
        if (!user) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        sessionUsername = user.username;
      }
      let warned = false;
      // Whose each plot is, read once per batch and only when a record under another name is there to move
      let ownership: Awaited<ReturnType<typeof plotOwnershipOf>> | null = null;
      let roundInfo: { info: RoundInfo | null } | null = null;
      // Whether a name sent as operator is an account's username, asked once per name in a batch
      const accountNames = new Map<string, boolean>();
      const accountName = async (name: string): Promise<boolean> => {
        let known = accountNames.get(name);
        if (known === undefined) {
          known = await store.isAccountUsername(name);
          accountNames.set(name, known);
        }
        return known;
      };
      // A typed name with the username as one of its words, in any letter case ("Juan Perez", the account juan)
      const nameHas = (name: string, username: string): boolean => name.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(username.toLowerCase());
      const ownNameInOtherCase = async (name: string, username: string): Promise<boolean> =>
        name !== username && name.toLowerCase() === username.toLowerCase() && (await store.getUserByUsername(name)) === null;
      const body = (request.body ?? {}) as BatchBody;
      const envelopes = Array.isArray(body.records) ? body.records : [];
      // The plots of a training: those running take their records apart, those over discard them (trainingPlots)
      const plotsOfTraining = await trainingPlots(store, projectId);
      const trainingInfo = plotsOfTraining.open.size + plotsOfTraining.closed.size > 0 ? await store.getRoundInfo(projectId) : null;
      // A project still being set up takes only the records of a training running (the team trained before it is
      // published); a batch with none of them is refused whole, as it always was, and Collect Earth keeps it to send later
      const draft = (await store.getProjectStatus(projectId)) === 'draft';
      if (draft && !envelopes.some((raw) => isTrainingRecord(keyOf(raw), plotsOfTraining.open, trainingInfo))) {
        return reply.code(409).send(PROJECT_DRAFT);
      }

      const receivedAt = Date.now();
      const results: BatchItemResult[] = [];
      let storedCount = 0;
      // A first submission stored: the check sampling may draw (coalesced, SamplingService).
      let firstSubmission = false;
      // Training records stored (training_records), for the Activity log
      let trainingStored = 0;
      // The project's records of the batch, written together once all are read (putRecordsWithEvents): where each answer goes
      const uploads: { index: number; recordKey: string; operator: string; revision: string | null; apply: RecordUpload['apply']; submitted: () => boolean }[] = [];
      // The survey each record stored was made with, when Collect Earth says it
      const revisions: { recordKey: string; operator: string; revision: string }[] = [];

      for (const raw of envelopes) {
        const envelope = normalizeEnvelope(raw);
        if (!envelope) {
          results.push({ recordKey: keyOf(raw), status: 'error', reason: 'malformed envelope' });
          continue;
        }
        try {
          if (sessionUsername !== null && envelope.operator !== sessionUsername) {
            if (!warned) {
              warned = true;
              request.log.warn({ sent: envelope.operator, username: sessionUsername }, 'records stored under the signed-in username, not the operator sent');
            }
            const sent = envelope.operator;
            envelope.operator = sessionUsername;
            // Before records went by the username, a session upload was stored under the
            // operator name Collect Earth sent ("Juan Perez" for the account juan). Its
            // next save moves that row to the username, so the record is not counted twice
            // and a deletion reaches it. The name is the client's word, so never a row kept
            // under any account's username, a member's, a former member's or a deleted
            // account's, never a name the server made (former-member-N, ceo-collector-N),
            // and never one the account has already (renameRecordOperator).
            // The person's own username in other letter case ("Marta" typed, the account marta) is theirs too, unless
            // another account has that exact name (usernames are case-sensitive): an office team's backup has the
            // names as typed, and refusing it here made a second copy of each plot saved again (workflows.test.ts).
            //
            // Nor a record of a plot given to other people only, whatever the name: a typed name (a backup's, an
            // import's) is no account, and a save sent under it took that person's record, to be downloaded with the
            // caller's own. Of a plot the project gave to nobody, only by a save no older than the record: the caller
            // then keeps what they sent and reads nothing of what was there.
            const own = sent !== null && (await ownNameInOtherCase(sent, sessionUsername));
            if (sent !== null && sent !== '' && !isServerMadeName(sent) && (own || !(await accountName(sent)))) {
              let allowed = own;
              let notNewerThan: number | undefined;
              if (!allowed && (await store.getRecord(projectId, envelope.recordKey, sent))) {
                roundInfo ??= { info: await store.getRoundInfo(projectId) };
                ownership ??= await plotOwnershipOf(store, projectId, request.membership!.userId ?? null, roundInfo.info);
                const shape = keyShape(roundInfo.info);
                const whose = ownership([envelope.recordKey, splitKey(envelope.recordKey, shape.count, shape.roundIndex).plot]);
                allowed = whose !== 'others';
                // (An older copy from their own computer still takes the record when the typed name has their username
                // in it, "Rosa Vidal" for rosa: the office team's backup, sent again by each person once they join.)
                if (whose === 'free' && !nameHas(sent, sessionUsername)) notNewerThan = envelope.modifiedOn ?? 0;
              }
              if (allowed && (await store.renameRecordOperator(projectId, envelope.recordKey, sent, sessionUsername, notNewerThan))) {
                request.log.info({ projectId, recordKey: envelope.recordKey, from: sent, to: sessionUsername }, 'record moved from a legacy operator name to the username');
              }
            }
          }
          // A project token is no person: it may not change or delete a record kept under an account's username (a
          // member's, a former member's) or a name the server made. That record is the person's, changed with their
          // sign-in only. (A new record under such a name is still taken: projects made before accounts sync so.)
          if (
            sessionUsername === null &&
            envelope.operator &&
            (isServerMadeName(envelope.operator) || (await accountName(envelope.operator))) &&
            (await store.getRecord(projectId, envelope.recordKey, envelope.operator))
          ) {
            results.push({ recordKey: envelope.recordKey, status: 'error', reason: 'this record is an account\'s: sign in as that person to change it' });
            continue;
          }
          const operator = envelope.operator ?? '';
          if (isTrainingRecord(envelope.recordKey, plotsOfTraining.closed, trainingInfo)) {
            // A plot of a training over, sent by a computer that was offline when it ended: discarded ("stale", so
            // that Collect Earth stops sending it), never stored as the project's
            results.push({ recordKey: envelope.recordKey, status: 'stale' });
            continue;
          }
          if (draft && !isTrainingRecord(envelope.recordKey, plotsOfTraining.open, trainingInfo)) {
            // Kept by Collect Earth to send once the project is published
            results.push({ recordKey: envelope.recordKey, status: 'error', reason: PROJECT_DRAFT.reason });
            continue;
          }
          if (isTrainingRecord(envelope.recordKey, plotsOfTraining.open, trainingInfo)) {
            // A calibration or learning plot: kept apart, never in the project's figures (no event either).
            const kept = await store.putTrainingRecord(projectId, envelope.recordKey, operator, (existing) => {
              const { row, status } = applyLww(envelope, existing, receivedAt);
              return status === 'stored' ? { ...row, projectId } : null;
            });
            if (kept) {
              storedCount += 1;
              trainingStored += 1;
            }
            results.push({ recordKey: envelope.recordKey, status: kept ? 'stored' : 'stale' });
            continue;
          }
          // The record and its event in one transaction, decided on the row stored
          // before, read under the record's lock: a crash cannot keep one without the
          // other, and two uploads of the record at once cannot both log the same change.
          let submitted = false;
          uploads.push({
            index: results.length,
            recordKey: envelope.recordKey,
            operator,
            revision: envelope.surveyRevision ?? null,
            apply: (existing, submittedBefore) => {
              const { row, status } = applyLww(envelope, existing, receivedAt);
              if (status !== 'stored') {
                return null;
              }
              const next = { ...row, projectId };
              const event = recordEventOf(existing, next, submittedBefore);
              submitted = event?.change === 'submitted';
              return { row: next, event };
            },
            submitted: () => submitted,
          });
          results.push({ recordKey: envelope.recordKey, status: 'error', reason: 'internal error' }); // until written below
        } catch (err) {
          request.log.error({ err, recordKey: envelope.recordKey }, 'record store failed');
          telemetry.captureError(err, { route: 'records:batch', project: projectId });
          results.push({ recordKey: envelope.recordKey, status: 'error', reason: 'internal error' });
        }
      }

      // The batch's records in one transaction (a few statements, not six or more per record). Should it fail, each
      // record on its own, so that one the store refuses does not take the others with it.
      const settle = (u: (typeof uploads)[number], stored: boolean) => {
        results[u.index] = { recordKey: u.recordKey, status: stored ? 'stored' : 'stale' };
        if (stored) {
          storedCount += 1;
          firstSubmission ||= u.submitted();
          if (u.revision) revisions.push({ recordKey: u.recordKey, operator: u.operator, revision: u.revision });
        }
      };
      if (uploads.length > 0) {
        let together: boolean[] | null = null;
        try {
          together = await store.putRecordsWithEvents(projectId, uploads);
        } catch (err) {
          request.log.warn({ err, records: uploads.length }, 'the batch could not be stored at once: one record at a time');
        }
        if (together) {
          uploads.forEach((u, i) => settle(u, together![i]));
        } else {
          for (const u of uploads) {
            try {
              settle(u, await store.putRecordWithEvent(projectId, u.recordKey, u.operator, u.apply));
            } catch (err) {
              request.log.error({ err, recordKey: u.recordKey }, 'record store failed');
              telemetry.captureError(err, { route: 'records:batch', project: projectId });
            }
          }
        }
      }

      if (revisions.length > 0) {
        // Never failing the batch: the records are stored
        await store.setRecordSurveyRevisions(projectId, revisions).catch((err: unknown) => request.log.warn({ err }, 'the survey revisions of the records could not be kept'));
      }
      noteActivity(request, { sync: { records: storedCount } }, { desktop: true });
      // Records refused (malformed, or failed to store): the owner is told when many are, in an hour
      request.server.ownerAlerts?.note('syncError', results.filter((r) => r.status === 'error').length);
      if (trainingStored > 0) {
        // In the Activity log (a coordinators' "who sent training plots"): one entry per batch.
        await audit(store, request, 'training.synced', { records: trainingStored }).catch(() => undefined);
      }
      if (firstSubmission && sampling) {
        // Before the answer (Cloud Run gives no CPU after it), never failing the batch, waited
        // for at most SAMPLING_INLINE_MS; at most once per project per 10 min.
        await sampling.afterSubmission(projectId, request.log);
      }
      return reply.send({ results });
    },
  );
}

function keyOf(raw: unknown): string {
  const rk = (raw as { recordKey?: unknown })?.recordKey;
  return typeof rk === 'string' ? rk : '';
}

/** Validates/normalises an untrusted JSON value into a RecordEnvelope, or null. */
function normalizeEnvelope(raw: unknown): RecordEnvelope | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.recordKey !== 'string' || o.recordKey.length === 0) {
    return null;
  }
  if (typeof o.surveyUri !== 'string') {
    return null;
  }
  const deleted = o.deleted === true;
  return {
    recordKey: o.recordKey,
    surveyUri: o.surveyUri,
    operator: typeof o.operator === 'string' ? o.operator : null,
    modifiedOn: typeof o.modifiedOn === 'number' ? o.modifiedOn : null,
    activelySaved: o.activelySaved === true,
    step: typeof o.step === 'number' ? o.step : 0,
    xml: typeof o.xml === 'string' ? o.xml : null,
    summary: summaryOf(o.summary),
    deleted,
    payloadVersion: typeof o.payloadVersion === 'number' ? o.payloadVersion : 1,
    activeSeconds: activeSecondsOf(o.activeSeconds),
    surveyRevision: typeof o.surveyRevision === 'string' && /^[0-9a-f]{8,64}$/.test(o.surveyRevision) ? o.surveyRevision : null,
  };
}

/** The most active time a record may claim: a week (a larger number is a mistake, not a plot). */
export const MAX_ACTIVE_SECONDS = 7 * 24 * 3600;

/** The active time sent with a record: whole seconds from 0 to MAX_ACTIVE_SECONDS, else not known (null). */
export function activeSecondsOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_ACTIVE_SECONDS) return null;
  return Math.round(value);
}

/**
 * At most this many answers are kept from a record's summary. A Collect Earth survey has
 * one per attribute (a few hundred in a large one); the rest of an oversized summary is
 * left out, the record is kept.
 */
export const MAX_SUMMARY_KEYS = 2000;
/** Longer keys are left out: a summary key is an attribute's HTML parameter name. */
export const MAX_SUMMARY_KEY_CHARS = 200;
/** Longer values are left out (not cut, so a cut answer is never compared as an answer). */
export const MAX_SUMMARY_VALUE_CHARS = 10_000;

/**
 * The summary's answers. Collect Earth sends `BalloonInputFieldsUtils.getValuesByHtmlParameters`,
 * a Map<String, String> that holds null for every empty attribute of the root entity
 * (AbstractAttributeHandler.getParameterValue gives null for no value; an entity's empty
 * attributes are not in it at all). A null is kept as '' (a blank answer): a question the
 * record's survey has but that was left empty is then told from one its survey does not
 * have (the "required left empty" flag needs it; every reader of summaries takes '' as no
 * answer, and the quality figures never compare a question blank on both sides). Records
 * stored before this keep no key for their blanks until they are saved again. Anything
 * else that is not a string (Collect Earth sends none) is left out, key by key, and the
 * rest of the summary is kept: refusing the whole summary for one empty attribute lost
 * every answer of the desktop's records.
 */
function summaryOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return out;
  }
  let kept = 0;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (kept >= MAX_SUMMARY_KEYS) {
      break;
    }
    const value = v === null ? '' : v;
    if (typeof value !== 'string' || key === '' || key === '__proto__' || key.length > MAX_SUMMARY_KEY_CHARS || value.length > MAX_SUMMARY_VALUE_CHARS) {
      continue;
    }
    out[key] = value;
    kept++;
  }
  return out;
}
