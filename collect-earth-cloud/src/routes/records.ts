import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Store } from '../store/store.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { noteActivity } from '../activity.js';
import { applyLww, recordEventOf } from '../lww.js';
import type { SamplingService } from '../samplingService.js';
import type { BatchItemResult, RecordEnvelope } from '../types.js';

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
export async function registerRecordRoutes(app: FastifyInstance, store: Store, sampling?: SamplingService): Promise<void> {
  app.post(
    '/v1/projects/:pid/records:batch',
    { preHandler: requireProjectMembership(store) },
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
      let memberNames: Set<string> | undefined;
      const body = (request.body ?? {}) as BatchBody;
      const envelopes = Array.isArray(body.records) ? body.records : [];

      const receivedAt = Date.now();
      const results: BatchItemResult[] = [];
      let storedCount = 0;
      // A first submission stored: the check sampling may draw (coalesced, SamplingService).
      let firstSubmission = false;

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
            // and a deletion reaches it. Never a row that is another member's own.
            if (sent !== null && sent !== '') {
              memberNames ??= new Set((await store.listMembers(projectId)).map((m) => m.username));
              if (!memberNames.has(sent)) {
                await store.renameRecordOperator(projectId, envelope.recordKey, sent, sessionUsername);
              }
            }
          }
          const operator = envelope.operator ?? '';
          // The record and its event in one transaction, decided on the row stored
          // before, read under the record's lock: a crash cannot keep one without the
          // other, and two uploads of the record at once cannot both log the same change.
          let submitted = false;
          const stored = await store.putRecordWithEvent(projectId, envelope.recordKey, operator, (existing, submittedBefore) => {
            const { row, status } = applyLww(envelope, existing, receivedAt);
            if (status !== 'stored') {
              return null;
            }
            const next = { ...row, projectId };
            const event = recordEventOf(existing, next, submittedBefore);
            submitted = event?.change === 'submitted';
            return { row: next, event };
          });
          if (stored) {
            storedCount += 1;
            firstSubmission ||= submitted;
          }
          results.push({ recordKey: envelope.recordKey, status: stored ? 'stored' : 'stale' });
        } catch (err) {
          request.log.error({ err, recordKey: envelope.recordKey }, 'record store failed');
          results.push({ recordKey: envelope.recordKey, status: 'error', reason: 'internal error' });
        }
      }

      noteActivity(request, { sync: { records: storedCount } }, { desktop: true });
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
  };
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
