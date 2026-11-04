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
    // A tombstone keeps the time the plot took; a save without one (an older Collect Earth) has none.
    activeSeconds: envelope.deleted ? (existing?.activeSeconds ?? null) : (envelope.activeSeconds ?? null),
  };
  return { row, status: 'stored' };
}

/**
 * What storing `row` over `existing` (null when there was none) does to the record
 * (RecordChange); `submittedBefore` says whether the record (key, operator) was ever
 * submitted. Null when it is the same save sent again (a retried batch: same
 * modifiedOn, flags, XML and answers), which changes nothing worth logging.
 *
 * Collect Earth gives every save a new modifiedOn (Collect's RecordManager.save sets
 * it to now), and its autosaves are activelySaved false, also onto a submitted plot;
 * so editing a submitted plot and submitting it again is `unsubmitted`, then
 * `resubmitted`. Every actively saved upload is a submission (Submit pressed again,
 * or an edit that reached the server with the submit).
 */
export function recordChange(existing: RecordRow | null, row: RecordRow, submittedBefore: boolean): RecordChange | null {
  if (existing && isSameSave(existing, row)) {
    return null;
  }
  if (row.deleted) {
    return 'deleted';
  }
  if (row.activelySaved) {
    return submittedBefore ? 'resubmitted' : 'submitted';
  }
  if (!existing || existing.deleted) {
    return 'created';
  }
  return existing.activelySaved ? 'unsubmitted' : 'updated';
}

function isSameSave(a: RecordRow, b: RecordRow): boolean {
  return (
    a.modifiedOn === b.modifiedOn &&
    a.deleted === b.deleted &&
    a.activelySaved === b.activelySaved &&
    a.step === b.step &&
    a.xml === b.xml &&
    sameSummary(a.summary, b.summary)
  );
}

function sameSummary(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** The record_events row of a stored upload (recordChange), or null when there is none to log. */
export function recordEventOf(existing: RecordRow | null, row: RecordRow, submittedBefore: boolean): RecordEventInput | null {
  const change = recordChange(existing, row, submittedBefore);
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
    summary: change === 'submitted' || change === 'resubmitted' ? { ...row.summary } : null,
  };
}
