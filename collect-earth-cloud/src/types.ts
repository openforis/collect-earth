/** Membership role within a single project. Authority derives only from these. */
export type Role = 'admin' | 'reviewer' | 'operator';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email: string | null;
}

/** A user's membership of one project, with the project name for listings. */
export interface Membership {
  projectId: string;
  projectName: string;
  role: Role;
}

/** One project member, for the admin members listing. */
export interface Member {
  userId: string;
  username: string;
  role: Role;
}

export interface Invite {
  projectId: string;
  projectName: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
}

/** A plot CSV file belonging to a project (metadata; content fetched separately). */
export interface CsvFile {
  id: string;
  filename: string;
  checksum: string;
  plotCount: number;
}

/** One csv-file ↔ user assignment. */
export interface Assignment {
  userId: string;
  csvFileId: string;
}

/** An assignment enriched with names, for the admin listing. */
export interface AssignmentDetail {
  userId: string;
  username: string;
  csvFileId: string;
  filename: string;
}

/**
 * One record (or deletion tombstone) exactly as the Java client uploads it.
 * Field names and types mirror CloudApiClient.toJson / CloudRecordSerializer.
 */
export interface RecordEnvelope {
  recordKey: string;
  surveyUri: string;
  operator: string | null;
  /** Local modification time as epoch milliseconds, or null if the client had none. */
  modifiedOn: number | null;
  activelySaved: boolean;
  step: number;
  xml: string | null;
  summary: Record<string, string>;
  deleted: boolean;
  payloadVersion: number;
}

/** Per-record outcome, as consumed by CloudSyncService.applyResult. */
export type StoreStatus = 'stored' | 'stale' | 'conflict' | 'error';

export interface BatchItemResult {
  recordKey: string;
  status: StoreStatus;
  reason?: string;
}

export interface ProjectRow {
  projectId: string;
  name: string;
  surveyUri: string | null;
  surveyName: string | null;
  idmlBase64: string | null;
}

/**
 * A stored record, keyed by (projectId, recordKey, operator). LWW is decided on
 * modifiedOn with receivedAt as the tiebreak. Deletions are soft (deleted=true).
 */
export interface RecordRow {
  projectId: string;
  recordKey: string;
  operator: string;
  modifiedOn: number;
  receivedAt: number;
  activelySaved: boolean;
  step: number;
  xml: string | null;
  summary: Record<string, string>;
  deleted: boolean;
  deletedOn: number | null;
}
