import type { RecordEnvelope, RecordRow, StoreStatus } from './types.js';

/**
 * Applies last-write-wins for one incoming envelope against the currently stored
 * row (or null if none exists). Returns the row to persist and the status to
 * report to the client. Keying by (project, recordKey, operator) is the caller's
 * responsibility; this function only compares timestamps.
 *
 * Rules:
 *  - No existing row: always store (a tombstone with no prior record is still stored).
 *  - Incoming strictly older than stored: reject as `stale`, keep the stored row.
 *  - Otherwise (newer or equal): store. Equal timestamps are treated as an
 *    idempotent re-send and overwrite, so a retried batch converges.
 */
export function applyLww(
  envelope: RecordEnvelope,
  existing: RecordRow | null,
  receivedAt: number,
): { row: RecordRow; status: StoreStatus } {
  const modifiedOn = envelope.modifiedOn ?? receivedAt;

  if (existing && modifiedOn < existing.modifiedOn) {
    return { row: existing, status: 'stale' };
  }

  const operator = envelope.operator ?? '';
  const row: RecordRow = {
    projectId: existing?.projectId ?? '',
    recordKey: envelope.recordKey,
    operator,
    modifiedOn,
    receivedAt,
    activelySaved: envelope.activelySaved,
    step: envelope.step,
    xml: envelope.deleted ? (existing?.xml ?? null) : envelope.xml,
    summary: envelope.deleted ? (existing?.summary ?? {}) : envelope.summary,
    deleted: envelope.deleted,
    deletedOn: envelope.deleted ? modifiedOn : null,
  };
  return { row, status: 'stored' };
}
