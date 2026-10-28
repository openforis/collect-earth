/** Membership role within a single project. Authority derives only from these. */
export type Role = 'admin' | 'reviewer' | 'operator';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  email: string | null;
  /** Owns the server (first-run setup): edits server settings, issues reset links. Not a project role. */
  isPlatformAdmin: boolean;
  /** When the account accepted the terms of use at sign-up (epoch ms); null if never asked. */
  termsAcceptedAt?: number | null;
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
  /** A revoked invite answers like an unknown one on register, and previews as not valid. */
  revoked: boolean;
}

/** An open invite as the project admin sees it (the token itself is only shown at creation). */
export interface InviteSummary {
  id: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number;
}

/** Who may create projects with a session: every logged-in user, or platform admins only. */
export type ProjectCreation = 'anyone' | 'platform-admins';

/** Server-wide settings edited by the platform admin. */
export interface ServerSettings {
  signupOpen: boolean;
  projectCreation: ProjectCreation;
  /** Most projects one account may coordinate (be admin of); 0 = no limit. Platform admins are exempt. */
  maxProjectsPerUser: number;
  /** Most space one project may use, in MB (CEP + plot files + records); 0 = no limit. */
  maxProjectStorageMb: number;
  /** Terms of use (http/https). When set, sign-up asks people to accept them. */
  termsUrl: string | null;
  /** Shown on every page so people know whom to ask (forgotten password...). */
  contactEmail: string | null;
  /** Shown in the app bar instead of "Collect Earth Cloud". */
  serverName: string | null;
}

export const DEFAULT_SETTINGS: ServerSettings = {
  signupOpen: false,
  projectCreation: 'platform-admins',
  maxProjectsPerUser: 0,
  maxProjectStorageMb: 0,
  termsUrl: null,
  contactEmail: null,
  serverName: null,
};

/** One account in the platform admin's user list: a project COUNT only, never names (§4b). */
export interface UserSummary {
  userId: string;
  username: string;
  isPlatformAdmin: boolean;
  /** Projects the account belongs to, in any role. */
  projects: number;
  /** Projects the account coordinates (admin role): what maxProjectsPerUser counts. */
  coordinatedProjects: number;
}

/** Bytes a project uses, by kind. Records count their XML and summary JSON. */
export interface ProjectStorage {
  cepBytes: number;
  /** Bytes of each plot CSV, by filename (an upload with the same name replaces it). */
  csvBytesByFilename: Record<string, number>;
  recordBytes: number;
}

export function totalStorageBytes(s: ProjectStorage): number {
  return s.cepBytes + Object.values(s.csvBytesByFilename).reduce((a, b) => a + b, 0) + s.recordBytes;
}

/** Size and last upload time (epoch ms) of a project's CEP. */
export interface CepInfo {
  bytes: number;
  updatedAt: number;
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
