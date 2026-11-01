import type { RecordChange, RecordEnvelope, RecordEventInput, RecordRow, StoreStatus } from './types.js';

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

/**
 * What storing `row` over `existing` (null when there was none) does to the record
 * (RecordChange), or null when it is the same save sent again (a retried batch: same
 * modifiedOn, deleted and actively saved), which changes nothing worth logging.
 */
export function recordChange(existing: RecordRow | null, row: RecordRow): RecordChange | null {
  if (
    existing &&
    existing.modifiedOn === row.modifiedOn &&
    existing.deleted === row.deleted &&
    existing.activelySaved === row.activelySaved
  ) {
    return null;
  }
  if (row.deleted) {
    return 'deleted';
  }
  if (!existing || existing.deleted) {
    return row.activelySaved ? 'submitted' : 'created';
  }
  if (row.activelySaved !== existing.activelySaved) {
    return row.activelySaved ? 'submitted' : 'unsubmitted';
  }
  return 'updated';
}

/** The record_events row of a stored upload (recordChange), or null when there is none to log. */
export function recordEventOf(existing: RecordRow | null, row: RecordRow): RecordEventInput | null {
  const change = recordChange(existing, row);
  if (change === null) {
    return null;
  }
  return {
    projectId: row.projectId,
    recordKey: row.recordKey,
    operator: row.operator,
    modifiedOn: row.modifiedOn,
    receivedAt: row.receivedAt,
    activelySaved: row.activelySaved,
    step: row.step,
    deleted: row.deleted,
    change,
    summary: change === 'submitted' ? { ...row.summary } : null,
  };
}
