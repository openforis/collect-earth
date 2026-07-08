import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Store } from '../store/store.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { applyLww } from '../lww.js';
import type { BatchItemResult, RecordEnvelope } from '../types.js';

interface BatchBody {
  records?: unknown[];
}

/**
 * Record intake. Accepts a batch of envelopes (or tombstones), applies
 * last-write-wins per (project, recordKey, operator), and returns a per-record
 * status the client uses to advance or retry its local sync queue.
 *
 * The request body is gzip-compressed by the Java client; the gunzip preParsing
 * hook in buildServer() decompresses it before this handler runs. The route path
 * contains a literal ':batch' segment (Collect Earth posts to `records:batch`).
 */
export async function registerRecordRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post(
    '/v1/projects/:pid/records:batch',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const body = (request.body ?? {}) as BatchBody;
      const envelopes = Array.isArray(body.records) ? body.records : [];

      const receivedAt = Date.now();
      const results: BatchItemResult[] = [];

      for (const raw of envelopes) {
        const envelope = normalizeEnvelope(raw);
        if (!envelope) {
          results.push({ recordKey: keyOf(raw), status: 'error', reason: 'malformed envelope' });
          continue;
        }
        try {
          const operator = envelope.operator ?? '';
          const existing = await store.getRecord(projectId, envelope.recordKey, operator);
          const { row, status } = applyLww(envelope, existing, receivedAt);
          if (status === 'stored') {
            await store.putRecord({ ...row, projectId });
          }
          results.push({ recordKey: envelope.recordKey, status });
        } catch (err) {
          request.log.error({ err, recordKey: envelope.recordKey }, 'record store failed');
          results.push({ recordKey: envelope.recordKey, status: 'error', reason: 'internal error' });
        }
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
    summary: isStringMap(o.summary) ? (o.summary as Record<string, string>) : {},
    deleted,
    payloadVersion: typeof o.payloadVersion === 'number' ? o.payloadVersion : 1,
  };
}

function isStringMap(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}
