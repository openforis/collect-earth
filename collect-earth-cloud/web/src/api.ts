import type { MessageKey } from "./i18n";
import { getToken } from "./storage";

// Every call the dashboard makes to the Collect Earth Cloud server, in one place, with
// the response shapes it expects. Responses are normalised here (timestamps to epoch
// ms, counts to numbers, relative links to absolute ones) so the pages do not have to
// care about small differences between server versions.

export type Role = "admin" | "reviewer" | "operator";
export const ROLES: Role[] = ["operator", "reviewer", "admin"];
export type ProjectCreation = "anyone" | "platform-admins";

export interface ServerInfo {
  needsSetup: boolean;
  signupOpen: boolean;
  projectCreation: ProjectCreation;
  version: string | null;
  /** Terms of use: when set, sign-up asks people to accept them. */
  termsUrl: string | null;
  contactEmail: string | null;
  /** Shown in the app bar instead of "Collect Earth Cloud". */
  serverName: string | null;
}

export interface Session {
  token: string;
  userId: string;
  username: string;
}

export interface Membership {
  projectId: string;
  projectName: string;
  role: Role;
}

export interface Me {
  userId: string;
  username: string;
  memberships: Membership[];
  isPlatformAdmin: boolean;
}

export interface ProjectInfo {
  projectId: string;
  name: string;
  role: Role;
}

export interface OperatorProgress {
  operator: string;
  total: number;
  submitted: number;
  lastModifiedOn: number | null;
}

export interface Overview {
  name: string;
  cep: { bytes: number; updatedAt: number | null } | null;
  members: number;
  csvFiles: number;
  plots: number;
  records: { total: number; submitted: number; byOperator: OperatorProgress[] };
  /** Space the project uses; limitBytes null = no limit. Null from servers that do not report it. */
  storage: { usedBytes: number; limitBytes: number | null } | null;
}

export interface Invite {
  id: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number | null;
}

export interface NewInvite {
  inviteToken: string;
  joinPath: string;
  /** Always absolute: built from this page's address when the server does not know its own. */
  joinUrl: string;
  role: Role;
  maxUses: number;
  expiresAt: number | null;
}

export interface JoinPreview {
  projectId: string;
  projectName: string;
  role: Role;
  valid: boolean;
}

export interface Member {
  userId: string;
  username: string;
  role: Role;
}

export interface CsvFile {
  id: string;
  filename: string;
  checksum: string;
  plotCount: number;
}

export interface Assignment {
  userId: string;
  csvFileId: string;
}

export interface ServerSettings {
  signupOpen: boolean;
  projectCreation: ProjectCreation;
  /** 0 = no limit. */
  maxProjectsPerUser: number;
  /** 0 = no limit. */
  maxProjectStorageMb: number;
  termsUrl: string | null;
  contactEmail: string | null;
  serverName: string | null;
}

export interface AdminUser {
  userId: string;
  username: string;
  isPlatformAdmin: boolean;
  projects: number;
  /** Projects the person coordinates (what the per-account project limit counts). */
  coordinatedProjects: number;
}

export interface ProjectRef {
  projectId: string;
  name: string;
}

/** What deleting one's own account would do. */
export interface AccountDeletion {
  /** Projects where the person is the only coordinator and others work: deleting is refused. */
  soleCoordinator: ProjectRef[];
  /** Projects with nobody else in them: deleted together with the account. */
  deletedWithAccount: ProjectRef[];
  /** The only server administrator cannot delete their account. */
  lastPlatformAdmin: boolean;
}

export interface ResetLink {
  resetUrl: string;
  expiresAt: number | null;
}

/** A failed call. status 0 means the server could not be reached at all. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason: string | null;
  /** The whole error body, for codes that carry more (limit, usedBytes, projects...). */
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, reason: string | null = null, details: Record<string, unknown> = {}) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}

export const NETWORK_ERROR = "network";

/** Builds the error for a non-2xx response from its status and (parsed JSON) body. */
export function apiErrorFrom(status: number, body: unknown): ApiError {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof record.error === "string" && record.error ? record.error : `http_${status}`;
  const reason = typeof record.reason === "string" ? record.reason : null;
  return new ApiError(status, code, reason, record);
}

const CODE_MESSAGES: Record<string, MessageKey> = {
  [NETWORK_ERROR]: "error.network",
  invalid_credentials: "error.invalidCredentials",
  wrong_password: "error.wrongPassword",
  username_taken: "error.usernameTaken",
  signup_closed: "error.signupClosed",
  weak_password: "error.weakPassword",
  bad_username: "error.badUsername",
  bad_setup_code: "error.badSetupCode",
  already_set_up: "error.alreadySetUp",
  project_creation_restricted: "error.projectCreationRestricted",
  last_admin: "error.lastAdmin",
  invite_exhausted: "error.inviteExhausted",
  invalid_invite: "error.inviteInvalid",
  invalid_reset_token: "error.linkUsedOrExpired",
  rate_limited: "error.rateLimited",
  unauthorized: "error.sessionEnded",
  forbidden: "error.forbidden",
  not_found: "error.notFound",
  payload_too_large: "error.tooLarge",
  project_limit_reached: "error.projectLimitReached",
  storage_limit_reached: "error.storageLimitReached",
  confirm_mismatch: "error.confirmMismatch",
  sole_coordinator: "error.soleCoordinator",
  last_platform_admin: "error.lastPlatformAdmin",
  terms_not_accepted: "error.termsNotAccepted",
};

/** The sentence (message key) to show a person for any error thrown by this module. */
export function errorMessageKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return "error.unknown";
  const byCode = CODE_MESSAGES[error.code];
  if (byCode) return byCode;
  switch (error.status) {
    case 0:
      return "error.network";
    case 401:
      return "error.sessionEnded";
    case 403:
      return "error.forbidden";
    case 404:
      return "error.notFound";
    case 410:
      return "error.linkUsedOrExpired";
    case 413:
      return "error.tooLarge";
    case 429:
      return "error.rateLimited";
    case 400:
      return "error.badRequest";
  }
  return error.status >= 500 ? "error.server" : "error.unknown";
}

// --- transport -------------------------------------------------------------------

let unauthorizedHandler: (() => void) | null = null;

/** Called when the server says the session is no longer valid (the page goes back to log in). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  json?: unknown;
  /** Do not treat a 401 as "your session ended" (log in, wrong current password…). */
  noSessionEnd?: boolean;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function fail(status: number, body: unknown, options: RequestOptions): never {
  const error = apiErrorFrom(status, body);
  if (status === 401 && !options.noSessionEnd && getToken()) unauthorizedHandler?.();
  throw error;
}

async function send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: headers(options.json !== undefined ? { "content-type": "application/json" } : {}),
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }
  if (!response.ok) fail(response.status, await parseBody(response), options);
  return response;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  return (await parseBody(response)) as T;
}

/** Upload progress, 0..1. */
export type Progress = (fraction: number) => void;

/** Sends a raw file body (fetch cannot report upload progress, XMLHttpRequest can). */
function upload<T>(method: string, path: string, body: Blob, contentType: string, onProgress?: Progress): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.setRequestHeader("content-type", contentType);
    const token = getToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new ApiError(0, NETWORK_ERROR));
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(parsed as T);
        return;
      }
      try {
        fail(xhr.status, parsed, {});
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(body);
  });
}

// --- normalisers -----------------------------------------------------------------

/** Epoch ms from a number (ms) or an ISO 8601 string; null when absent or unreadable. */
export function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** A count from a number or a list (its length). */
export function toCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** An absolute URL for a server link that may be relative or missing. */
export function absoluteUrl(url: string | null | undefined, fallbackPath: string, origin = window.location.origin): string {
  if (url && /^https?:\/\//i.test(url)) return url;
  const path = url || fallbackPath;
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Optional text from the server: null when missing or empty. */
function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An http(s) link, or null: a terms link is put in an href, so nothing else gets through. */
export function safeUrl(value: unknown): string | null {
  const text = optionalText(value);
  return text && /^https?:\/\//i.test(text) ? text : null;
}

function asRole(value: unknown): Role {
  return value === "admin" || value === "reviewer" ? value : "operator";
}

const p = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}`;

// --- server & account --------------------------------------------------------------

export async function getServerInfo(): Promise<ServerInfo> {
  try {
    const info = await request<Record<string, unknown>>("GET", "/v1/server-info", { noSessionEnd: true });
    return {
      needsSetup: info?.needsSetup === true,
      signupOpen: info?.signupOpen === true,
      projectCreation: info?.projectCreation === "anyone" ? "anyone" : "platform-admins",
      version: typeof info?.version === "string" ? info.version : null,
      termsUrl: safeUrl(info?.termsUrl),
      contactEmail: optionalText(info?.contactEmail),
      serverName: optionalText(info?.serverName),
    };
  } catch (error) {
    // A server from before the dashboard existed: no setup, no sign-up.
    if (error instanceof ApiError && error.status === 404) {
      return {
        needsSetup: false,
        signupOpen: false,
        projectCreation: "platform-admins",
        version: null,
        termsUrl: null,
        contactEmail: null,
        serverName: null,
      };
    }
    throw error;
  }
}

export function setup(setupCode: string, username: string, password: string): Promise<Session> {
  return request<Session>("POST", "/v1/setup", { json: { setupCode, username, password }, noSessionEnd: true });
}

export function login(username: string, password: string): Promise<Session> {
  return request<Session>("POST", "/v1/auth/login", { json: { username, password }, noSessionEnd: true });
}

export function signup(username: string, password: string, email?: string, acceptTerms?: boolean): Promise<Session> {
  const json: Record<string, string | boolean> = { username, password };
  if (email) json.email = email;
  if (acceptTerms) json.acceptTerms = true;
  return request<Session>("POST", "/v1/auth/signup", { json, noSessionEnd: true });
}

export async function logout(): Promise<void> {
  await send("POST", "/v1/auth/logout", { noSessionEnd: true });
}

export async function getMe(): Promise<Me> {
  const me = await request<Partial<Me>>("GET", "/v1/me");
  return {
    userId: String(me?.userId ?? ""),
    username: String(me?.username ?? ""),
    memberships: Array.isArray(me?.memberships) ? me.memberships.map((m) => ({ ...m, role: asRole(m.role) })) : [],
    isPlatformAdmin: me?.isPlatformAdmin === true,
  };
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  try {
    await send("PUT", "/v1/me/password", { json: { currentPassword, newPassword }, noSessionEnd: true });
  } catch (error) {
    // Here a 401 means the current password is wrong, not that the session ended.
    if (error instanceof ApiError && error.status === 401) throw new ApiError(401, "wrong_password", error.reason);
    throw error;
  }
}

export async function getAccountDeletion(): Promise<AccountDeletion> {
  const body = await request<Record<string, unknown>>("GET", "/v1/me/deletion");
  const refs = (value: unknown): ProjectRef[] =>
    Array.isArray(value)
      ? value.map((p: Record<string, unknown>) => ({ projectId: String(p?.projectId ?? ""), name: String(p?.name ?? "") }))
      : [];
  return {
    soleCoordinator: refs(body?.soleCoordinator),
    deletedWithAccount: refs(body?.deletedWithAccount),
    lastPlatformAdmin: body?.lastPlatformAdmin === true,
  };
}

/** Deletes the logged-in person's account (the password confirms it). */
export async function deleteAccount(password: string): Promise<void> {
  try {
    await send("DELETE", "/v1/me", { json: { password }, noSessionEnd: true });
  } catch (error) {
    // Here a 401 means the password is wrong, not that the session ended.
    if (error instanceof ApiError && error.status === 401) throw new ApiError(401, "wrong_password", error.reason);
    throw error;
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await send("POST", "/v1/auth/reset", { json: { token, newPassword }, noSessionEnd: true });
}

// --- projects --------------------------------------------------------------------------

export async function listProjects(): Promise<Membership[]> {
  const body = await request<{ projects?: Membership[] }>("GET", "/v1/projects");
  return (body?.projects ?? []).map((m) => ({ ...m, role: asRole(m.role) }));
}

export function createProject(name: string): Promise<{ projectId: string; name: string }> {
  return request("POST", "/v1/projects", { json: { name } });
}

export async function getProject(projectId: string): Promise<ProjectInfo> {
  const body = await request<{ projectId: string; name: string; role: string }>("GET", p(projectId));
  return { projectId: body.projectId, name: body.name, role: asRole(body.role) };
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await send("PATCH", p(projectId), { json: { name } });
}

/** Deletes the project and everything in it; confirmName must be the project name. */
export async function deleteProject(projectId: string, confirmName: string): Promise<void> {
  await send("DELETE", p(projectId), { json: { confirmName } });
}

export async function getOverview(projectId: string): Promise<Overview> {
  const body = await request<Record<string, unknown>>("GET", `${p(projectId)}/overview`);
  const cep = body?.cep as Record<string, unknown> | null | undefined;
  const records = (body?.records ?? {}) as Record<string, unknown>;
  const byOperator = Array.isArray(records.byOperator) ? (records.byOperator as Record<string, unknown>[]) : [];
  const storage = body?.storage as Record<string, unknown> | null | undefined;
  return {
    name: String(body?.name ?? ""),
    cep: cep ? { bytes: toCount(cep.bytes), updatedAt: toMillis(cep.updatedAt) } : null,
    members: toCount(body?.members),
    csvFiles: toCount(body?.csvFiles),
    plots: toCount(body?.plots),
    records: {
      total: toCount(records.total),
      submitted: toCount(records.submitted),
      byOperator: byOperator.map((o) => ({
        operator: String(o.operator ?? ""),
        total: toCount(o.total),
        submitted: toCount(o.submitted),
        // 0 = the client sent no modification time
        lastModifiedOn: toMillis(o.lastModifiedOn) || null,
      })),
    },
    storage: storage
      ? { usedBytes: toCount(storage.usedBytes), limitBytes: storage.limitBytes == null ? null : toCount(storage.limitBytes) || null }
      : null,
  };
}

export async function uploadCep(projectId: string, file: Blob, onProgress?: Progress): Promise<void> {
  await upload("PUT", `${p(projectId)}/cep`, file, "application/zip", onProgress);
}

// --- invites ------------------------------------------------------------------------------

export async function createInvite(
  projectId: string,
  options: { role: Role; maxUses: number; expiresInDays: number | null },
): Promise<NewInvite> {
  const json: Record<string, unknown> = { role: options.role, maxUses: options.maxUses };
  if (options.expiresInDays) json.expiresInDays = options.expiresInDays;
  const body = await request<Record<string, unknown>>("POST", `${p(projectId)}/invites`, { json });
  const inviteToken = String(body.inviteToken ?? "");
  const joinPath = typeof body.joinPath === "string" && body.joinPath ? body.joinPath : `/join/${encodeURIComponent(inviteToken)}`;
  return {
    inviteToken,
    joinPath,
    joinUrl: absoluteUrl(typeof body.joinUrl === "string" ? body.joinUrl : null, joinPath),
    role: asRole(body.role),
    maxUses: toCount(body.maxUses),
    expiresAt: toMillis(body.expiresAt),
  };
}

export async function listInvites(projectId: string): Promise<Invite[]> {
  const body = await request<{ invites?: Record<string, unknown>[] } | Record<string, unknown>[]>("GET", `${p(projectId)}/invites`);
  const raw = Array.isArray(body) ? body : (body?.invites ?? []);
  return raw.map((i) => ({
    id: String(i.id ?? ""),
    role: asRole(i.role),
    maxUses: toCount(i.maxUses),
    usedCount: toCount(i.usedCount),
    expiresAt: toMillis(i.expiresAt),
    createdAt: toMillis(i.createdAt),
  }));
}

export async function revokeInvite(projectId: string, inviteId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/invites/${encodeURIComponent(inviteId)}`);
}

export function previewInvite(token: string): Promise<JoinPreview> {
  return request<JoinPreview>("GET", `/v1/join/${encodeURIComponent(token)}`, { noSessionEnd: true });
}

// --- people -----------------------------------------------------------------------------------

export async function listMembers(projectId: string): Promise<Member[]> {
  const body = await request<{ members?: Member[] }>("GET", `${p(projectId)}/members`);
  return (body?.members ?? []).map((m) => ({ ...m, role: asRole(m.role) }));
}

export async function setMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
  await send("PUT", `${p(projectId)}/members/${encodeURIComponent(userId)}`, { json: { role } });
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/members/${encodeURIComponent(userId)}`);
}

// --- plot files and assignments ----------------------------------------------------------

export async function listCsvFiles(projectId: string): Promise<CsvFile[]> {
  const body = await request<{ csvFiles?: CsvFile[] }>("GET", `${p(projectId)}/csv-files`);
  return body?.csvFiles ?? [];
}

export function uploadCsvFile(projectId: string, file: File, onProgress?: Progress): Promise<CsvFile> {
  return upload<CsvFile>("PUT", `${p(projectId)}/csv-files/${encodeURIComponent(file.name)}`, file, "text/csv", onProgress);
}

export async function listAssignments(projectId: string): Promise<Assignment[]> {
  const body = await request<{ assignments?: Assignment[] }>("GET", `${p(projectId)}/assignments`);
  return (body?.assignments ?? []).map((a) => ({ userId: a.userId, csvFileId: a.csvFileId }));
}

export async function saveAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
  await send("PUT", `${p(projectId)}/assignments`, { json: { assignments } });
}

// --- data ------------------------------------------------------------------------------------

/** The collected data as a CSV file (fetched with the session, then saved by the page). */
export async function downloadExport(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/export.csv`);
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  let filename = "collect-earth-data.csv";
  if (match) {
    try {
      filename = decodeURIComponent(match[1]);
    } catch {
      filename = match[1];
    }
  }
  return { blob: await response.blob(), filename };
}

// --- platform admin ---------------------------------------------------------------------

export const DEFAULT_SERVER_SETTINGS: ServerSettings = {
  signupOpen: false,
  projectCreation: "platform-admins",
  maxProjectsPerUser: 0,
  maxProjectStorageMb: 0,
  termsUrl: null,
  contactEmail: null,
  serverName: null,
};

/** Settings from a server answer, keeping `fallback` for anything missing (older servers). */
export function toServerSettings(body: unknown, fallback: ServerSettings = DEFAULT_SERVER_SETTINGS): ServerSettings {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const limit = (value: unknown, old: number) => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : old);
  const text = (key: string, old: string | null) => (key in b ? optionalText(b[key]) : old);
  return {
    signupOpen: typeof b.signupOpen === "boolean" ? b.signupOpen : fallback.signupOpen,
    projectCreation: b.projectCreation === "anyone" || b.projectCreation === "platform-admins" ? b.projectCreation : fallback.projectCreation,
    maxProjectsPerUser: limit(b.maxProjectsPerUser, fallback.maxProjectsPerUser),
    maxProjectStorageMb: limit(b.maxProjectStorageMb, fallback.maxProjectStorageMb),
    termsUrl: text("termsUrl", fallback.termsUrl),
    contactEmail: text("contactEmail", fallback.contactEmail),
    serverName: text("serverName", fallback.serverName),
  };
}

export async function getServerSettings(): Promise<ServerSettings> {
  return toServerSettings(await request<unknown>("GET", "/v1/admin/settings"));
}

/** Saves some settings; returns all of them as the server now has them. */
export async function saveServerSettings(current: ServerSettings, changes: Partial<ServerSettings>): Promise<ServerSettings> {
  const body = await request<unknown>("PUT", "/v1/admin/settings", { json: changes });
  return toServerSettings(body, { ...current, ...changes });
}

export async function listUsers(): Promise<AdminUser[]> {
  const body = await request<{ users?: Record<string, unknown>[] }>("GET", "/v1/admin/users");
  return (body?.users ?? []).map((u) => ({
    userId: String(u.userId ?? ""),
    username: String(u.username ?? ""),
    isPlatformAdmin: u.isPlatformAdmin === true,
    projects: toCount(u.projects),
    coordinatedProjects: toCount(u.coordinatedProjects),
  }));
}

export async function makeResetLink(userId: string): Promise<ResetLink> {
  const body = await request<{ resetUrl?: string; expiresAt?: unknown }>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/password-reset`);
  return { resetUrl: absoluteUrl(body?.resetUrl ?? null, "/"), expiresAt: toMillis(body?.expiresAt) };
}
