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
  /** The AI assistant can be switched on for a project (set up and switched on by the server owner). */
  aiAvailable: boolean;
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
  /** Its plots are divided between people (see the file's distribution). */
  divided?: boolean;
  /** People holding at least one of its plots; 0 for a whole file. */
  dividedPeople?: number;
}

export interface Assignment {
  userId: string;
  csvFileId: string;
}

/** One column of a plot file, for dividing its plots by the column's values. */
export interface CsvColumn {
  /** 0-based. */
  index: number;
  /** From the header row; null when the file has none. */
  name: string | null;
  distinctCount: number;
  /** Sorted by value; null when the column has too many different values (more than 200). */
  values: { value: string; count: number }[] | null;
}

export interface CsvColumns {
  plotCount: number;
  hasHeader: boolean;
  separator: string;
  columns: CsvColumn[];
}

export type DivisionOrder = "file" | "mixed";

/** How a plot file's plots are divided between people (what the server stores and applies). */
export type Distribution =
  | { mode: "whole" }
  | { mode: "manual" }
  | { mode: "even"; people: string[]; order: DivisionOrder; overlapPercent?: number; seed?: number }
  | {
      mode: "column";
      column: number;
      groups: { value: string; people: string[] }[];
      order: DivisionOrder;
      overlapPercent?: number;
      seed?: number;
    };

export interface PersonShare {
  userId: string;
  username: string;
  /** Includes the quality-check copies. */
  plots: number;
  /** Quality-check copies: plots someone else also has. */
  overlap: number;
  /** Plots this person has submitted, among the ones they hold. */
  submitted: number;
}

/** Who holds a file's plots. distribution null = the whole file goes to the people ticked in the grid. */
export interface DistributionState {
  distribution: Distribution | null;
  plotCount: number;
  unassigned: number;
  people: PersonShare[];
}

/** Agreement over some checks; rate (0..1) is null when there are too few checks to judge. */
export interface Rate {
  compared: number;
  agreeing: number;
  rate: number | null;
}

export interface QuestionAgreement extends Rate {
  key: string;
  label: string;
  kind: "choice" | "number";
  /** The margin used (percent), for a number question. */
  margin: number | null;
}

/** How often a first answer was met by another answer in the check. */
export interface Confusion {
  key: string;
  first: string;
  check: string;
  count: number;
  plots: string[];
}

export interface PersonQuality {
  username: string;
  asFirst: Rate;
  asChecker: Rate;
  weakest: { key: string; rate: number | null; compared: number; differing: number }[];
}

export interface WeekAgreement {
  /** ISO week, yyyy-Www. */
  week: string;
  compared: number;
  agreeing: number;
}

/** One check of a plot whose answers differ from the first assessment. */
export interface Difference {
  plot: string;
  first: { operator: string; recordKey: string };
  check: { operator: string; recordKey: string };
  fields: { key: string; first: string; check: string }[];
}

export type DataProblemKind = "no_plot" | "unknown_round" | "two_main" | "extra_key_parts";

export interface DataProblem {
  kind: DataProblemKind | string;
  plot: string;
  recordKey: string;
  operator: string;
}

export type DecisionKind = "first" | "check" | "recheck";

export interface QualityDecision {
  plot: string;
  decision: DecisionKind;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
}

export interface GuidanceNoteInput {
  questionKey: string;
  firstValue: string | null;
  checkValue: string | null;
  text: string;
}

export interface GuidanceNote extends GuidanceNoteInput {
  id: string;
  updatedBy: string | null;
  updatedAt: number | null;
}

/**
 * The answer options of choice questions, by question key, from the survey: to show an
 * answer by its label ("Forest") instead of its code ("F").
 */
export type AnswerOptions = Record<string, { code: string; label: string }[]>;

/** The Quality tab's figures (GET /quality). Counts are checks, except plotsChecked and plotsDiffering. */
export interface QualityData {
  plotsChecked: number;
  plotsDiffering: number;
  questions: QuestionAgreement[];
  confusions: Confusion[];
  people: PersonQuality[];
  weeks: WeekAgreement[];
  differences: Difference[];
  problems: DataProblem[];
  problemsTotal: number;
  beyondOutline: { count: number; keys: string[] };
  decisions: QualityDecision[];
  notes: GuidanceNote[];
  /** Number margins in percent, by margin key (an indexed entity's question as [*]). */
  margins: Record<string, number>;
  /** The "very fast" flag's threshold, in seconds (Task 5). */
  fastSeconds: number;
  /** The answer options of the choice questions shown. */
  options: AnswerOptions;
  /** When the figures' records were read (ms). */
  computedAt: number | null;
  /** Older figures, given while newer ones are worked out. */
  stale: boolean;
}

/** Where a plot is, from the plot files. */
export interface PlotPlace {
  plot: string;
  lat: number;
  lon: number;
}

/** The places asked for; none, with the system's id, when the survey's coordinates are not latitude and longitude. */
export interface PlotPlaces {
  places: PlotPlace[];
  unsupportedSrs: string | null;
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
  /** The AI assistant may be used on this server (it also needs the server's AI configuration). */
  aiEnabled: boolean;
  /** AI reports per project per UTC day; 0 = none allowed. */
  aiReportsPerDay: number;
  /** AI follow-ups and questions per project per UTC day; 0 = none allowed. */
  aiFollowUpsPerDay: number;
  /** AI tokens per project per calendar month (UTC); 0 = none allowed. */
  aiMonthlyTokens: number;
  /** Read only: whether the server has its AI configuration (Vertex AI). */
  aiConfigured: boolean;
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

/** added: the server added a hidden round key; own: the survey has one; none: no round. */
export type RoundState = "added" | "own" | "none";

/** A code of the round key's list, with its label in the survey's default language. */
export interface RoundCode {
  code: string;
  label: string;
}

/** What the server did about the round key of the project file (GET /round). */
export interface RoundInfo {
  state: RoundState;
  /** Why the server did not add round (state none before collection), e.g. "several_keys". */
  refusal: string | null;
  keyCount: number;
  roundIndex: number | null;
  roundCodes: RoundCode[];
  /** The code that marks re-assessments; null for none (or not chosen yet). */
  reassessmentCode: string | null;
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
  // Project file uploads (PUT /cep) refused once data exists or plots are divided.
  round_removed: "error.roundRemoved",
  round_codes_changed: "error.roundCodesChanged",
  key_shape_changed: "error.keyShapeChanged",
  plots_divided: "error.plotsDivided",
  too_large: "error.cepTooLarge",
  // The quality figures (GET /quality and the reports).
  busy: "quality.busy",
  quality_failed: "quality.failed",
  // The AI assistant (its limits and "busy" are told by the assistant's panel).
  user_session_required: "ai.sessionRequired",
  ai_unavailable: "ai.unavailable",
  ai_not_enabled: "ai.notEnabled",
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
      aiAvailable: info?.aiAvailable === true,
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
        aiAvailable: false,
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

/** What the server did about round, from a server answer; null when absent or not an object. */
export function toRoundInfo(body: unknown): RoundInfo | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const state: RoundState = record.state === "added" || record.state === "own" ? record.state : "none";
  const codes = Array.isArray(record.roundCodes) ? (record.roundCodes as Record<string, unknown>[]) : [];
  return {
    state,
    refusal: typeof record.refusal === "string" && record.refusal ? record.refusal : null,
    keyCount: toCount(record.keyCount),
    roundIndex: typeof record.roundIndex === "number" ? record.roundIndex : null,
    roundCodes: codes
      .filter((c) => c && (typeof c.code === "string" || typeof c.code === "number"))
      .map((c) => ({ code: String(c.code), label: typeof c.label === "string" ? c.label : "" })),
    reassessmentCode: typeof record.reassessmentCode === "string" ? record.reassessmentCode : null,
  };
}

/** Uploads the project file; returns what the server did about round (null from older servers). */
export async function uploadCep(projectId: string, file: Blob, onProgress?: Progress): Promise<RoundInfo | null> {
  const body = await upload<Record<string, unknown> | null>("PUT", `${p(projectId)}/cep`, file, "application/zip", onProgress);
  return toRoundInfo(body?.round);
}

/** What the server did about round in the current project file; null before any upload. */
export async function getRoundInfo(projectId: string): Promise<RoundInfo | null> {
  return toRoundInfo(await request<unknown>("GET", `${p(projectId)}/round`));
}

/** Which code of the survey's own round marks re-assessments (null: none). */
export async function setReassessmentCode(projectId: string, reassessmentCode: string | null): Promise<RoundInfo | null> {
  return toRoundInfo(await request<unknown>("PUT", `${p(projectId)}/round`, { json: { reassessmentCode } }));
}

/**
 * The project file as the coordinator uploaded it. When the server serves the upload
 * unchanged it keeps no separate original (404), and the served file is the upload.
 */
export async function downloadOriginalCep(projectId: string): Promise<Blob> {
  try {
    return await (await send("GET", `${p(projectId)}/cep/original`)).blob();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    return await (await send("GET", `${p(projectId)}/cep`)).blob();
  }
}

// --- invites ------------------------------------------------------------------------------

export async function createInvite(
  projectId: string,
  options: { role: Role; maxUses: number; expiresInDays: number | null; forUserId?: string },
): Promise<NewInvite> {
  const json: Record<string, unknown> = { role: options.role, maxUses: options.maxUses };
  if (options.expiresInDays) json.expiresInDays = options.expiresInDays;
  // A link for someone already in the project: the server makes it a one-person, one-week collector link.
  if (options.forUserId) json.forUserId = options.forUserId;
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

// --- dividing a plot file between people ---------------------------------------------

const f = (projectId: string, csvFileId: string) => `${p(projectId)}/csv-files/${encodeURIComponent(csvFileId)}`;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v ?? "")) : []);

/** A stored division from the server; null for a whole file (or anything unreadable). */
export function toDistribution(value: unknown): Distribution | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const order: DivisionOrder = d.order === "mixed" ? "mixed" : "file";
  const extra: { overlapPercent?: number; seed?: number } = {};
  if (typeof d.overlapPercent === "number" && d.overlapPercent > 0) extra.overlapPercent = d.overlapPercent;
  if (typeof d.seed === "number") extra.seed = d.seed;
  switch (d.mode) {
    case "manual":
      return { mode: "manual" };
    case "even":
      return { mode: "even", people: strings(d.people), order, ...extra };
    case "column":
      return {
        mode: "column",
        column: toCount(d.column),
        groups: Array.isArray(d.groups)
          ? d.groups.map((g: Record<string, unknown>) => ({ value: String(g?.value ?? ""), people: strings(g?.people) }))
          : [],
        order,
        ...extra,
      };
  }
  return null;
}

export function toDistributionState(body: unknown): DistributionState {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const people = Array.isArray(b.people) ? (b.people as Record<string, unknown>[]) : [];
  return {
    distribution: toDistribution(b.distribution),
    plotCount: toCount(b.plotCount),
    unassigned: toCount(b.unassigned),
    people: people.map((person) => ({
      userId: String(person.userId ?? ""),
      username: String(person.username ?? ""),
      plots: toCount(person.plots),
      overlap: toCount(person.overlap),
      submitted: toCount(person.submitted),
    })),
  };
}

export async function getCsvColumns(projectId: string, csvFileId: string): Promise<CsvColumns> {
  const body = await request<Record<string, unknown>>("GET", `${f(projectId, csvFileId)}/columns`);
  const columns = Array.isArray(body?.columns) ? (body.columns as Record<string, unknown>[]) : [];
  return {
    plotCount: toCount(body?.plotCount),
    hasHeader: body?.hasHeader === true,
    separator: typeof body?.separator === "string" ? body.separator : ",",
    columns: columns.map((c) => ({
      index: toCount(c.index),
      name: typeof c.name === "string" ? c.name : null,
      distinctCount: toCount(c.distinctCount),
      values: Array.isArray(c.values)
        ? c.values.map((v: Record<string, unknown>) => ({ value: String(v?.value ?? ""), count: toCount(v?.count) }))
        : null,
    })),
  };
}

export async function getDistribution(projectId: string, csvFileId: string): Promise<DistributionState> {
  return toDistributionState(await request<unknown>("GET", `${f(projectId, csvFileId)}/distribution`));
}

/** Divides the file's plots (or, with dryRun, only says what the result would be). */
export async function saveDistribution(projectId: string, csvFileId: string, distribution: Distribution, dryRun = false): Promise<DistributionState> {
  const json = dryRun ? { ...distribution, dryRun: true } : distribution;
  return toDistributionState(await request<unknown>("PUT", `${f(projectId, csvFileId)}/distribution`, { json }));
}

/** Gives every plot `fromUserId` has not submitted to `toUserId`. */
export async function moveUnfinished(
  projectId: string,
  csvFileId: string,
  fromUserId: string,
  toUserId: string,
): Promise<DistributionState & { moved: number }> {
  const body = await request<Record<string, unknown>>("POST", `${f(projectId, csvFileId)}/move-unfinished`, { json: { fromUserId, toUserId } });
  return { ...toDistributionState(body), moved: toCount(body?.moved) };
}

// --- quality ---------------------------------------------------------------------------------

const text = (value: unknown): string => (value == null ? "" : String(value));
const nullableText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [];
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

function toRate(value: unknown): Rate {
  const r = obj(value);
  return { compared: toCount(r.compared), agreeing: toCount(r.agreeing), rate: typeof r.rate === "number" && Number.isFinite(r.rate) ? r.rate : null };
}

export function toDecision(value: unknown): QualityDecision {
  const d = obj(value);
  const decision = d.decision === "check" || d.decision === "recheck" ? d.decision : "first";
  return { plot: text(d.plot), decision, comment: nullableText(d.comment), decidedBy: nullableText(d.decidedBy), decidedAt: toMillis(d.decidedAt) };
}

export function toNote(value: unknown): GuidanceNote {
  const n = obj(value);
  return {
    id: text(n.id),
    questionKey: text(n.questionKey),
    firstValue: nullableText(n.firstValue),
    checkValue: nullableText(n.checkValue),
    text: text(n.text),
    updatedBy: nullableText(n.updatedBy),
    updatedAt: toMillis(n.updatedAt),
  };
}

function toMargins(value: unknown): Record<string, number> {
  const margins: Record<string, number> = {};
  for (const [key, v] of Object.entries(obj(value))) {
    if (typeof v === "number" && Number.isFinite(v)) margins[key] = v;
  }
  return margins;
}

/** The Quality tab's figures from the server's answer, with every list present. */
/** Answer options as sent (a list of { code, label } per key); anything else is left out. */
function toOptions(value: unknown): AnswerOptions {
  const out: AnswerOptions = {};
  for (const [key, options] of Object.entries(obj(value))) {
    if (!Array.isArray(options)) continue;
    out[key] = options.filter((o) => o && typeof o === "object" && typeof (o as { code?: unknown }).code === "string").map((o) => ({ code: text(o.code), label: text(o.label) }));
  }
  return out;
}

export function toQualityData(body: unknown): QualityData {
  const b = obj(body);
  const beyond = obj(b.beyondOutline);
  return {
    plotsChecked: toCount(b.plotsChecked),
    plotsDiffering: toCount(b.plotsDiffering),
    questions: list(b.questions).map((q) => ({
      ...toRate(q),
      key: text(q.key),
      label: text(q.label) || text(q.key),
      kind: q.kind === "number" ? "number" : "choice",
      margin: typeof q.margin === "number" && Number.isFinite(q.margin) ? q.margin : null,
    })),
    confusions: list(b.confusions).map((c) => ({ key: text(c.key), first: text(c.first), check: text(c.check), count: toCount(c.count), plots: strings(c.plots) })),
    people: list(b.people).map((person) => ({
      username: text(person.username),
      asFirst: toRate(person.asFirst),
      asChecker: toRate(person.asChecker),
      weakest: list(person.weakest).map((w) => ({
        key: text(w.key),
        rate: typeof w.rate === "number" && Number.isFinite(w.rate) ? w.rate : null,
        compared: toCount(w.compared),
        differing: toCount(w.differing),
      })),
    })),
    weeks: list(b.weeks).map((w) => ({ week: text(w.week), compared: toCount(w.compared), agreeing: toCount(w.agreeing) })),
    differences: list(b.differences).map((d) => {
      const first = obj(d.first);
      const check = obj(d.check);
      return {
        plot: text(d.plot),
        first: { operator: text(first.operator), recordKey: text(first.recordKey) },
        check: { operator: text(check.operator), recordKey: text(check.recordKey) },
        fields: list(d.fields).map((f) => ({ key: text(f.key), first: text(f.first), check: text(f.check) })),
      };
    }),
    problems: list(b.problems).map((pr) => ({ kind: text(pr.kind), plot: text(pr.plot), recordKey: text(pr.recordKey), operator: text(pr.operator) })),
    problemsTotal: toCount(b.problemsTotal ?? b.problems),
    beyondOutline: { count: toCount(beyond.count), keys: strings(beyond.keys) },
    decisions: list(b.decisions).map(toDecision),
    notes: list(b.notes).map(toNote),
    margins: toMargins(obj(b.settings).margins),
    fastSeconds: toFastSeconds(obj(b.settings).fastSeconds),
    options: toOptions(b.options),
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
  };
}

/** The quality figures. A 503 "busy" (other projects' figures being worked out) is thrown as ApiError code "busy". */
export async function getQuality(projectId: string): Promise<QualityData> {
  return toQualityData(await request<unknown>("GET", `${p(projectId)}/quality`));
}

/** The "very fast" threshold of a project that has not set one, and the range it may take (as the server's). */
export const DEFAULT_FAST_SECONDS = 15;
export const MIN_FAST_SECONDS = 1;
export const MAX_FAST_SECONDS = 120;

export function toFastSeconds(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_FAST_SECONDS && value <= MAX_FAST_SECONDS ? value : DEFAULT_FAST_SECONDS;
}

/** Sets the "very fast" flag's threshold (whole seconds); returns it as saved. The margins stay as they are. */
export async function saveFastSeconds(projectId: string, fastSeconds: number): Promise<number> {
  const body = await request<{ fastSeconds?: unknown }>("PUT", `${p(projectId)}/quality/settings`, { json: { fastSeconds } });
  return toFastSeconds(body?.fastSeconds);
}

/** Replaces the number margins (percent, by margin key); returns them as saved. */
export async function saveQualityMargins(projectId: string, margins: Record<string, number>): Promise<Record<string, number>> {
  const body = await request<{ margins?: unknown }>("PUT", `${p(projectId)}/quality/settings`, { json: { margins } });
  return toMargins(body?.margins);
}

const decisionPath = (projectId: string, plot: string) => `${p(projectId)}/quality/decisions/${encodeURIComponent(plot)}`;

export async function setQualityDecision(projectId: string, plot: string, decision: DecisionKind, comment: string): Promise<QualityDecision> {
  const json = comment.trim() ? { decision, comment: comment.trim() } : { decision };
  return toDecision(await request<unknown>("PUT", decisionPath(projectId, plot), { json }));
}

/** Undoes a decision (a decision already gone counts as undone). */
export async function deleteQualityDecision(projectId: string, plot: string): Promise<void> {
  try {
    await send("DELETE", decisionPath(projectId, plot));
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

const notesPath = (projectId: string) => `${p(projectId)}/quality/notes`;

export async function createGuidanceNote(projectId: string, note: GuidanceNoteInput): Promise<GuidanceNote> {
  return toNote(await request<unknown>("POST", notesPath(projectId), { json: note }));
}

export async function updateGuidanceNote(projectId: string, id: string, note: GuidanceNoteInput): Promise<GuidanceNote> {
  return toNote(await request<unknown>("PUT", `${notesPath(projectId)}/${encodeURIComponent(id)}`, { json: note }));
}

/** Deletes a note (one already gone counts as deleted). */
export async function deleteGuidanceNote(projectId: string, id: string): Promise<void> {
  try {
    await send("DELETE", `${notesPath(projectId)}/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
  }
}

/** Where some plots are (the ones in no plot file are left out). */
export async function getPlotPlaces(projectId: string, plots: string[]): Promise<PlotPlaces> {
  if (plots.length === 0) return { places: [], unsupportedSrs: null };
  const body = await request<{ places?: unknown; unsupportedSrs?: unknown }>("POST", `${p(projectId)}/quality/places`, { json: { plots } });
  const places = list(body?.places)
    .map((place) => ({ plot: text(place.plot), lat: Number(place.lat), lon: Number(place.lon) }))
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
  return { places, unsupportedSrs: typeof body?.unsupportedSrs === "string" && body.unsupportedSrs !== "" ? body.unsupportedSrs : null };
}

// --- the AI assistant -------------------------------------------------------------------

export type AiRunKind = "report" | "follow_up" | "question";
export type AiRunStatus = "running" | "done" | "failed" | "refused";
export type FollowUpAction = "explain" | "draft_note" | "recheck";
export type FindingCause = "unclear_question" | "overlapping_options" | "person_habit" | "number_typing" | "other";
const CAUSES: FindingCause[] = ["unclear_question", "overlapping_options", "person_habit", "number_typing", "other"];

/** The assistant in a project: switched on here, and available on the server. */
export interface ProjectAi {
  enabled: boolean;
  available: boolean;
}

/** A run as listed: who, when and what, never its result. */
export interface AiRunSummary {
  id: string;
  kind: AiRunKind;
  status: AiRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  /** The username, null once the account is deleted. */
  startedBy: string | null;
  tokens: number;
  parentRunId: string | null;
  findingIndex: number | null;
  action: FollowUpAction | null;
  /** Why it failed (blocked, ai_timeout...) or off_topic for a refused question. */
  errorCode: string | null;
}

/** A finding of a report, with real names and plot ids (the model's text, shown as plain text only). */
export interface AiFinding {
  title: string;
  explanation: string;
  cause: FindingCause;
  /** Question keys, as in the quality figures. */
  questions: string[];
  persons: string[];
  plots: string[];
  suggestedNote: string | null;
}

export interface AiReport {
  summary: string;
  findings: AiFinding[];
  recheckPlots: string[];
  surveyChanges: { question: string; suggestion: string }[];
}

/** The answer of a follow-up or a question. */
export interface AiAnswer {
  text: string;
  plots: string[];
  note: string | null;
}

export interface AiRun extends AiRunSummary {
  /** The free question asked (questions only). */
  question: string | null;
  /** The tools used so far, in order. */
  tools: string[];
  report: AiReport | null;
  answer: AiAnswer | null;
  /** The server's refusal text, in the run's language (refused runs). */
  refusal: string | null;
}

export type AiStart =
  | { kind: "report" }
  | { kind: "follow_up"; parentRunId: string; findingIndex: number; action: FollowUpAction }
  | { kind: "question"; parentRunId: string; question: string };

const RUN_KINDS: AiRunKind[] = ["report", "follow_up", "question"];
const RUN_STATUSES: AiRunStatus[] = ["running", "done", "failed", "refused"];
const ACTIONS: FollowUpAction[] = ["explain", "draft_note", "recheck"];

function toRunSummary(value: unknown): AiRunSummary {
  const r = obj(value);
  return {
    id: text(r.id),
    kind: RUN_KINDS.includes(r.kind as AiRunKind) ? (r.kind as AiRunKind) : "report",
    status: RUN_STATUSES.includes(r.status as AiRunStatus) ? (r.status as AiRunStatus) : "failed",
    startedAt: toMillis(r.startedAt),
    finishedAt: toMillis(r.finishedAt),
    startedBy: nullableText(r.startedBy),
    tokens: toCount(r.tokens),
    parentRunId: nullableText(r.parentRunId),
    findingIndex: typeof r.findingIndex === "number" && Number.isInteger(r.findingIndex) ? r.findingIndex : null,
    action: ACTIONS.includes(r.action as FollowUpAction) ? (r.action as FollowUpAction) : null,
    errorCode: nullableText(r.errorCode),
  };
}

function toFinding(value: unknown): AiFinding {
  const f = obj(value);
  return {
    title: text(f.title),
    explanation: text(f.explanation),
    cause: CAUSES.includes(f.cause as FindingCause) ? (f.cause as FindingCause) : "other",
    questions: strings(f.questions),
    persons: strings(f.persons),
    plots: strings(f.plots),
    suggestedNote: nullableText(f.suggestedNote),
  };
}

/** One run with its result: a report for a report, an answer for a follow-up or a question. */
export function toAiRun(body: unknown): AiRun {
  const b = obj(body);
  const summary = toRunSummary(b);
  const result = b.result && typeof b.result === "object" ? obj(b.result) : null;
  const done = summary.status === "done" && result !== null;
  return {
    ...summary,
    question: nullableText(b.question),
    tools: strings(obj(b.progress).tools),
    report:
      done && summary.kind === "report"
        ? {
            summary: text(result.summary),
            findings: list(result.findings).map(toFinding),
            recheckPlots: strings(result.recheckPlots),
            surveyChanges: list(result.surveyChanges).map((c) => ({ question: text(c.question), suggestion: text(c.suggestion) })),
          }
        : null,
    answer: done && summary.kind !== "report" ? { text: text(result.text), plots: strings(result.plots), note: nullableText(result.note) } : null,
    refusal: nullableText(b.refusal),
  };
}

export async function getProjectAi(projectId: string): Promise<ProjectAi> {
  const body = obj(await request<unknown>("GET", `${p(projectId)}/ai`));
  return { enabled: body.enabled === true, available: body.available === true };
}

/** Switches the assistant on or off for a project (a person's session only: a project key gets 403 user_session_required). */
export async function setProjectAi(projectId: string, enabled: boolean): Promise<ProjectAi> {
  const body = obj(await request<unknown>("PUT", `${p(projectId)}/ai`, { json: { enabled } }));
  return { enabled: body.enabled === true, available: body.available === true };
}

/**
 * Starts a run in the dashboard's language; returns its id. Refusals: 409 busy, 429
 * ai_daily_limit / ai_monthly_limit with `resetsAt` (ms, or null for a limit of 0) in details.
 */
export async function startAiRun(projectId: string, start: AiStart, language: string): Promise<string> {
  const body = obj(await request<unknown>("POST", `${p(projectId)}/ai/runs`, { json: { ...start, language } }));
  return text(body.runId);
}

/** The project's runs, newest first, without their results. */
export async function listAiRuns(projectId: string): Promise<AiRunSummary[]> {
  const body = obj(await request<unknown>("GET", `${p(projectId)}/ai/runs`));
  return list(body.runs).map(toRunSummary);
}

export async function getAiRun(projectId: string, runId: string): Promise<AiRun> {
  return toAiRun(await request<unknown>("GET", `${p(projectId)}/ai/runs/${encodeURIComponent(runId)}`));
}

export interface AiUsageCounts {
  runs: number;
  reports: number;
  followUps: number;
  questions: number;
  failed: number;
  refused: number;
  tokens: number;
}

/** The assistant's use this UTC month, per project id (never names or content). */
export interface AiUsage {
  month: string;
  projects: (AiUsageCounts & { projectId: string })[];
  totals: AiUsageCounts;
}

function toUsageCounts(value: unknown): AiUsageCounts {
  const c = obj(value);
  return {
    runs: toCount(c.runs),
    reports: toCount(c.reports),
    followUps: toCount(c.followUps),
    questions: toCount(c.questions),
    failed: toCount(c.failed),
    refused: toCount(c.refused),
    tokens: toCount(c.tokens),
  };
}

export async function getAiUsage(): Promise<AiUsage> {
  const body = obj(await request<unknown>("GET", "/v1/admin/ai-usage"));
  return {
    month: text(body.month),
    projects: list(body.projects).map((row) => ({ projectId: text(row.projectId), ...toUsageCounts(row) })),
    totals: toUsageCounts(body.totals),
  };
}

// --- the printable reports ----------------------------------------------------------------

/** A guidance note as the reports show it (no author, no date). */
export interface ReportNote {
  id: string;
  questionKey: string;
  firstValue: string | null;
  checkValue: string | null;
  text: string;
}

/** A mix-up in a report: counts are checks; a few example plots and the notes about it. */
export interface ReportConfusion {
  key: string;
  label: string;
  first: string;
  check: string;
  checks: number;
  plots: string[];
  notes: ReportNote[];
}

/** A member's own figures (GET /my-quality): their plots checked by someone else, never who checked. */
export interface MyQuality {
  username: string;
  minChecks: number;
  asFirst: Rate;
  confusions: ReportConfusion[];
  /** The answer options of the questions of the mix-ups. */
  options: AnswerOptions;
  computedAt: number | null;
  stale: boolean;
}

/** The team report for training (GET /quality/team-report): no names. */
export interface TeamReport {
  minChecks: number;
  plotsChecked: number;
  plotsDiffering: number;
  questions: QuestionAgreement[];
  confusions: ReportConfusion[];
  notes: ReportNote[];
  /** The answer options of the report's choice questions. */
  options: AnswerOptions;
  computedAt: number | null;
  stale: boolean;
}

function toReportNote(value: unknown): ReportNote {
  const n = obj(value);
  return { id: text(n.id), questionKey: text(n.questionKey), firstValue: nullableText(n.firstValue), checkValue: nullableText(n.checkValue), text: text(n.text) };
}

/** A report's rate ({ checks, agreeing, rate }) as the dashboard's Rate. */
function toReportRate(value: unknown): Rate {
  const r = obj(value);
  return { compared: toCount(r.checks), agreeing: toCount(r.agreeing), rate: typeof r.rate === "number" && Number.isFinite(r.rate) ? r.rate : null };
}

function toReportConfusion(value: unknown): ReportConfusion {
  const c = obj(value);
  return {
    key: text(c.key),
    label: text(c.label) || text(c.key),
    first: text(c.first),
    check: text(c.check),
    checks: toCount(c.checks),
    plots: strings(c.plots),
    notes: list(c.notes).map(toReportNote),
  };
}

export async function getMyQuality(projectId: string): Promise<MyQuality> {
  const b = obj(await request<unknown>("GET", `${p(projectId)}/my-quality`));
  return {
    username: text(b.username),
    minChecks: toCount(b.minChecks),
    asFirst: toReportRate(b.asFirst),
    confusions: list(b.confusions).map(toReportConfusion),
    options: toOptions(b.options),
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
  };
}

export async function getTeamReport(projectId: string): Promise<TeamReport> {
  const b = obj(await request<unknown>("GET", `${p(projectId)}/quality/team-report`));
  return {
    minChecks: toCount(b.minChecks),
    plotsChecked: toCount(b.plotsChecked),
    plotsDiffering: toCount(b.plotsDiffering),
    questions: list(b.questions).map((q) => ({
      ...toReportRate(q),
      key: text(q.key),
      label: text(q.label) || text(q.key),
      kind: q.kind === "number" ? "number" : "choice",
      margin: typeof q.margin === "number" && Number.isFinite(q.margin) ? q.margin : null,
    })),
    confusions: list(b.confusions).map(toReportConfusion),
    notes: list(b.notes).map(toReportNote),
    options: toOptions(b.options),
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
  };
}

// --- data ------------------------------------------------------------------------------------

/** The collected data as a CSV file (fetched with the session, then saved by the page). */
export async function downloadExport(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/export.csv`);
  const disposition = response.headers.get("content-disposition") ?? "";
  // Prefer the UTF-8 name (filename*) over the ASCII fallback the server sends first.
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
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
  aiEnabled: false,
  aiReportsPerDay: 5,
  aiFollowUpsPerDay: 30,
  aiMonthlyTokens: 2_000_000,
  aiConfigured: false,
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
    aiEnabled: typeof b.aiEnabled === "boolean" ? b.aiEnabled : fallback.aiEnabled,
    aiReportsPerDay: limit(b.aiReportsPerDay, fallback.aiReportsPerDay),
    aiFollowUpsPerDay: limit(b.aiFollowUpsPerDay, fallback.aiFollowUpsPerDay),
    aiMonthlyTokens: limit(b.aiMonthlyTokens, fallback.aiMonthlyTokens),
    aiConfigured: typeof b.aiConfigured === "boolean" ? b.aiConfigured : fallback.aiConfigured,
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

// --- progress (the Progress tab) -----------------------------------------------------

export interface ProgressSettings {
  /** YYYY-MM-DD, or null. */
  deadline: string | null;
  /** null: every assigned plot. */
  targetPlots: number | null;
  quietDays: number;
}

export interface ProgressTotals {
  plots: number;
  assigned: number;
  notAssigned: number;
  submitted: number;
  started: number;
  notStarted: number;
}

export interface ProgressDay {
  date: string;
  /** Plots (submitted now) first submitted that day; checks are not counted. */
  submitted: number;
  /** Plots submitted by the end of the day, as things are now. */
  cumulative: number;
}

export interface Forecast {
  target: number;
  targetFrom: "setting" | "assigned";
  remaining: number;
  pacePerDay: number;
  paceDays: number;
  daysLeft: number | null;
  endDate: string | null;
  deadline: string | null;
  daysToDeadline: number | null;
  daysOver: number | null;
  neededPerDay: number | null;
}

export interface AttentionPerson {
  username: string;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  medianDelayMs: number | null;
}

export type AttentionKind =
  | "quiet"
  | "neverDownloaded"
  | "notAssigned"
  | "oldUnsentWork"
  | "differencesWaiting"
  | "storage"
  | "oldProjectFile"
  | "oldCollectEarth";

export const ATTENTION_KINDS: readonly AttentionKind[] = [
  "quiet",
  "neverDownloaded",
  "notAssigned",
  "oldUnsentWork",
  "differencesWaiting",
  "storage",
  "oldProjectFile",
  "oldCollectEarth",
];

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  people: AttentionPerson[];
  /** quiet */
  quietDays: number | null;
  /** oldCollectEarth: people whose Collect Earth could not be told. */
  unknownVersion: number;
  /** storage */
  level: "nearlyFull" | "over" | null;
  usedBytes: number | null;
  limitBytes: number | null;
}

export interface ProgressData {
  timeZone: string;
  today: string;
  /** When the figures are older than the records: the time they are from (newer ones are being worked out). */
  asOf: number | null;
  totals: ProgressTotals;
  daily: ProgressDay[];
  forecast: Forecast;
  /** Null for a reviewer. */
  attention: AttentionItem[] | null;
  settings: ProgressSettings;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (value: unknown): string | null => (typeof value === "string" && DATE_RE.test(value) ? value : null);
const toNumberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function toProgressSettings(value: unknown): ProgressSettings {
  const s = (value ?? {}) as Record<string, unknown>;
  const target = toNumberOrNull(s.targetPlots);
  const quiet = toNumberOrNull(s.quietDays);
  return { deadline: toDate(s.deadline), targetPlots: target !== null && target > 0 ? target : null, quietDays: quiet !== null && quiet > 0 ? quiet : 3 };
}

export function toProgressData(body: unknown): ProgressData {
  const b = (body ?? {}) as Record<string, unknown>;
  const t = (b.totals ?? {}) as Record<string, unknown>;
  const f = (b.forecast ?? {}) as Record<string, unknown>;
  const daily = Array.isArray(b.daily) ? (b.daily as Record<string, unknown>[]) : [];
  const attention = Array.isArray(b.attention) ? (b.attention as Record<string, unknown>[]) : null;
  return {
    timeZone: typeof b.timeZone === "string" ? b.timeZone : "UTC",
    today: toDate(b.today) ?? new Date().toISOString().slice(0, 10),
    asOf: toMillis(b.asOf),
    totals: {
      plots: toCount(t.plots),
      assigned: toCount(t.assigned),
      notAssigned: toCount(t.notAssigned),
      submitted: toCount(t.submitted),
      started: toCount(t.started),
      notStarted: toCount(t.notStarted),
    },
    daily: daily
      .filter((d) => toDate(d.date) !== null)
      .map((d) => ({ date: String(d.date), submitted: toCount(d.submitted), cumulative: toCount(d.cumulative) })),
    forecast: {
      target: toCount(f.target),
      targetFrom: f.targetFrom === "setting" ? "setting" : "assigned",
      remaining: toCount(f.remaining),
      pacePerDay: toNumberOrNull(f.pacePerDay) ?? 0,
      paceDays: toCount(f.paceDays) || 14,
      daysLeft: toNumberOrNull(f.daysLeft),
      endDate: toDate(f.endDate),
      deadline: toDate(f.deadline),
      daysToDeadline: toNumberOrNull(f.daysToDeadline),
      daysOver: toNumberOrNull(f.daysOver),
      neededPerDay: toNumberOrNull(f.neededPerDay),
    },
    attention:
      attention === null
        ? null
        : attention
            .filter((a) => ATTENTION_KINDS.includes(a.kind as AttentionKind))
            .map((a) => ({
              kind: a.kind as AttentionKind,
              count: toCount(a.count),
              people: (Array.isArray(a.people) ? (a.people as Record<string, unknown>[]) : []).map((person) => ({
                username: String(person.username ?? ""),
                lastSyncAt: toMillis(person.lastSyncAt),
                lastPlotsDownloadAt: toMillis(person.lastPlotsDownloadAt),
                medianDelayMs: toNumberOrNull(person.medianDelayMs),
              })),
              quietDays: toNumberOrNull(a.quietDays),
              unknownVersion: toCount(a.unknownVersion),
              level: a.level === "over" || a.level === "nearlyFull" ? a.level : null,
              usedBytes: toNumberOrNull(a.usedBytes),
              limitBytes: toNumberOrNull(a.limitBytes),
            })),
    settings: toProgressSettings(b.settings),
  };
}

/** The Progress tab's figures, with the days in the browser's time zone. */
export async function getProgress(projectId: string, timeZone: string, days = 90): Promise<ProgressData> {
  const query = new URLSearchParams({ days: String(days), tz: timeZone });
  return toProgressData(await request<unknown>("GET", `${p(projectId)}/progress?${query}`));
}

export async function getProgressSettings(projectId: string): Promise<ProgressSettings> {
  return toProgressSettings(await request<unknown>("GET", `${p(projectId)}/progress/settings`));
}

export async function saveProgressSettings(projectId: string, settings: ProgressSettings): Promise<ProgressSettings> {
  return toProgressSettings(await request<unknown>("PUT", `${p(projectId)}/progress/settings`, { json: settings }));
}

// --- people (the People tab, a person's page, My work) ------------------------------

export type PersonStatusKind = "noPlots" | "finished" | "neverStarted" | "quiet" | "working";

export interface PersonStatus {
  kind: PersonStatusKind;
  /** quiet: whole days since their last sync or plot download. */
  days: number | null;
  /** quiet: amber from the project's quiet days on, red from twice that. */
  level: "amber" | "red" | null;
}

export interface PersonRow {
  userId: string;
  username: string;
  role: Role;
  plots: { assigned: number; submitted: number; started: number; remaining: number; done: number | null };
  /** Null on My work: checks are blind there (copies are counted as plots). */
  checks: { assigned: number; submitted: number; remaining: number } | null;
  submittedLast7: number;
  medianPerDay: number | null;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  lastSubmittedAt: number | null;
  /** Null when the quality figures are not at hand. */
  agreement: Rate | null;
  status: PersonStatus;
}

export interface QualityAtHand {
  available: boolean;
  computedAt: number | null;
  stale: boolean;
}

export interface WeekPerson {
  userId: string;
  username: string;
  submitted: number;
}

/** An open invitation link; `forUsername`: made for someone already in the project, to get the new project file. */
export interface PeopleInvite extends Invite {
  forUsername: string | null;
}

export interface PeopleData {
  timeZone: string;
  today: string;
  quietDays: number;
  /** When the figures are older than the records: the time they are from (newer ones are being worked out). */
  asOf: number | null;
  quality: QualityAtHand;
  people: PersonRow[];
  invites: PeopleInvite[];
  week: { days: { date: string; submitted: number }[]; mostActive: WeekPerson[]; leastActive: WeekPerson[] };
}

export type PlotStatus = "submitted" | "doneByOther" | "started" | "notStarted";

export interface PersonFile {
  csvFileId: string;
  filename: string;
  divided: boolean;
  plots: { total: number; submitted: number; doneByOther: number; started: number; notStarted: number };
  /** Null on My work (copies are counted as plots there). */
  checks: { total: number; submitted: number; started: number; notStarted: number } | null;
  /** `kind` null on My work. */
  list: { plot: string; kind: "main" | "check" | null; status: PlotStatus }[];
  truncated: boolean;
}

export interface Speed {
  submissions: number;
  sessions: number;
  gaps: number;
  medianGapMs: number | null;
  veryFast: number;
  buckets: { upToMs: number; count: number }[];
}

export interface SyncHealth {
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastPlotsDownloadAt: number | null;
  lastCepDownloadAt: number | null;
  syncsCount: number;
  recordsReceived: number;
  cepUpdatedAt: number | null;
  oldProjectFile: boolean;
  collectEarth: { kind: "collect-earth" | "old-collect-earth" | "unknown"; version: string | null } | null;
}

export interface SentBack {
  plot: string;
  comment: string | null;
  decidedAt: number | null;
  decidedBy: string | null;
}

export interface PersonData {
  timeZone: string;
  today: string;
  quietDays: number;
  asOf: number | null;
  person: PersonRow;
  /** `checks` 0 on My work (`plots` counts both there). */
  calendar: { date: string; plots: number; checks: number }[];
  /** What removing them leaves behind (coordinators); null on My work. */
  removal: { plots: number; copies: number } | null;
  hours: number[];
  files: PersonFile[];
  speed: Speed;
  sync: SyncHealth;
  /** `flags`: their pattern flags by kind (coordinators' page, from the figures at hand); null on My work or without figures. */
  quality: QualityAtHand & { asFirst: Rate | null; asChecker: Rate | null; sentBack: SentBack[]; flags: FlagCounts | null };
}

const STATUS_KINDS: readonly PersonStatusKind[] = ["noPlots", "finished", "neverStarted", "quiet", "working"];
const PLOT_STATUSES: readonly PlotStatus[] = ["submitted", "doneByOther", "started", "notStarted"];
const toRole = (value: unknown): Role => (value === "admin" || value === "reviewer" ? value : "operator");
const toRateOrNull = (value: unknown): Rate | null => (value && typeof value === "object" ? toRate(value) : null);

function toQualityAtHand(value: unknown): QualityAtHand {
  const q = obj(value);
  return { available: q.available === true, computedAt: toMillis(q.computedAt), stale: q.stale === true };
}

export function toPersonRow(value: unknown): PersonRow {
  const r = obj(value);
  const plots = obj(r.plots);
  const checks = obj(r.checks);
  const status = obj(r.status);
  const kind = STATUS_KINDS.includes(status.kind as PersonStatusKind) ? (status.kind as PersonStatusKind) : "working";
  return {
    userId: text(r.userId),
    username: text(r.username),
    role: toRole(r.role),
    plots: {
      assigned: toCount(plots.assigned),
      submitted: toCount(plots.submitted),
      started: toCount(plots.started),
      remaining: toCount(plots.remaining),
      done: toNumberOrNull(plots.done),
    },
    checks:
      r.checks && typeof r.checks === "object"
        ? { assigned: toCount(checks.assigned), submitted: toCount(checks.submitted), remaining: toCount(checks.remaining) }
        : null,
    submittedLast7: toCount(r.submittedLast7),
    medianPerDay: toNumberOrNull(r.medianPerDay),
    lastSyncAt: toMillis(r.lastSyncAt),
    lastPlotsDownloadAt: toMillis(r.lastPlotsDownloadAt),
    lastSubmittedAt: toMillis(r.lastSubmittedAt),
    agreement: toRateOrNull(r.agreement),
    status: {
      kind,
      days: kind === "quiet" ? toNumberOrNull(status.days) : null,
      level: kind === "quiet" ? (status.level === "red" ? "red" : "amber") : null,
    },
  };
}

const toWeekPerson = (value: unknown): WeekPerson => {
  const w = obj(value);
  return { userId: text(w.userId), username: text(w.username), submitted: toCount(w.submitted) };
};

export function toPeopleData(body: unknown): PeopleData {
  const b = obj(body);
  const week = obj(b.week);
  return {
    timeZone: typeof b.timeZone === "string" ? b.timeZone : "UTC",
    today: toDate(b.today) ?? new Date().toISOString().slice(0, 10),
    quietDays: toCount(b.quietDays) || 3,
    asOf: toMillis(b.asOf),
    quality: toQualityAtHand(b.quality),
    people: list(b.people).map(toPersonRow),
    invites: list(b.invites).map((i) => ({
      id: text(i.id),
      role: toRole(i.role),
      maxUses: toCount(i.maxUses),
      usedCount: toCount(i.usedCount),
      expiresAt: toMillis(i.expiresAt),
      createdAt: toMillis(i.createdAt),
      forUsername: nullableText(i.forUsername),
    })),
    week: {
      days: list(week.days)
        .filter((d) => toDate(d.date) !== null)
        .map((d) => ({ date: String(d.date), submitted: toCount(d.submitted) })),
      mostActive: list(week.mostActive).map(toWeekPerson),
      leastActive: list(week.leastActive).map(toWeekPerson),
    },
  };
}

export function toPersonData(body: unknown): PersonData {
  const b = obj(body);
  const sync = obj(b.sync);
  const speed = obj(b.speed);
  const quality = obj(b.quality);
  const ce = sync.collectEarth && typeof sync.collectEarth === "object" ? obj(sync.collectEarth) : null;
  const hours = Array.isArray(b.hours) ? b.hours.map(toCount) : [];
  return {
    timeZone: typeof b.timeZone === "string" ? b.timeZone : "UTC",
    today: toDate(b.today) ?? new Date().toISOString().slice(0, 10),
    quietDays: toCount(b.quietDays) || 3,
    asOf: toMillis(b.asOf),
    person: toPersonRow(b.person),
    calendar: list(b.calendar)
      .filter((d) => toDate(d.date) !== null)
      .map((d) => ({ date: String(d.date), plots: toCount(d.plots), checks: toCount(d.checks) })),
    removal: b.removal && typeof b.removal === "object" ? { plots: toCount(obj(b.removal).plots), copies: toCount(obj(b.removal).copies) } : null,
    hours: Array.from({ length: 24 }, (_, i) => hours[i] ?? 0),
    files: list(b.files).map((f) => {
      const plots = obj(f.plots);
      const checks = obj(f.checks);
      return {
        csvFileId: text(f.csvFileId),
        filename: text(f.filename),
        divided: f.divided === true,
        plots: {
          total: toCount(plots.total),
          submitted: toCount(plots.submitted),
          doneByOther: toCount(plots.doneByOther),
          started: toCount(plots.started),
          notStarted: toCount(plots.notStarted),
        },
        checks:
          f.checks && typeof f.checks === "object"
            ? { total: toCount(checks.total), submitted: toCount(checks.submitted), started: toCount(checks.started), notStarted: toCount(checks.notStarted) }
            : null,
        list: list(f.list).map((x) => ({
          plot: text(x.plot),
          kind: x.kind === "check" ? "check" : x.kind === "main" ? "main" : null,
          status: PLOT_STATUSES.includes(x.status as PlotStatus) ? (x.status as PlotStatus) : "notStarted",
        })),
        truncated: f.truncated === true,
      };
    }),
    speed: {
      submissions: toCount(speed.submissions),
      sessions: toCount(speed.sessions),
      gaps: toCount(speed.gaps),
      medianGapMs: toNumberOrNull(speed.medianGapMs),
      veryFast: toCount(speed.veryFast),
      buckets: list(speed.buckets).map((x) => ({ upToMs: toCount(x.upToMs), count: toCount(x.count) })),
    },
    sync: {
      lastSeenAt: toMillis(sync.lastSeenAt),
      lastSyncAt: toMillis(sync.lastSyncAt),
      lastPlotsDownloadAt: toMillis(sync.lastPlotsDownloadAt),
      lastCepDownloadAt: toMillis(sync.lastCepDownloadAt),
      syncsCount: toCount(sync.syncsCount),
      recordsReceived: toCount(sync.recordsReceived),
      cepUpdatedAt: toMillis(sync.cepUpdatedAt),
      oldProjectFile: sync.oldProjectFile === true,
      collectEarth:
        ce === null
          ? null
          : {
              kind: ce.kind === "collect-earth" || ce.kind === "old-collect-earth" ? ce.kind : "unknown",
              version: nullableText(ce.version),
            },
    },
    quality: {
      ...toQualityAtHand(quality),
      asFirst: toRateOrNull(quality.asFirst),
      asChecker: toRateOrNull(quality.asChecker),
      sentBack: list(quality.sentBack).map((s) => ({ plot: text(s.plot), comment: nullableText(s.comment), decidedAt: toMillis(s.decidedAt), decidedBy: nullableText(s.decidedBy) })),
      flags: quality.flags && typeof quality.flags === "object" ? toFlagCounts(quality.flags) : null,
    },
  };
}

/** The People tab's table (coordinators), with the days in the browser's time zone. */
export async function getPeople(projectId: string, timeZone: string): Promise<PeopleData> {
  return toPeopleData(await request<unknown>("GET", `${p(projectId)}/people?${new URLSearchParams({ tz: timeZone })}`));
}

/** One person's page (coordinators). */
export async function getPerson(projectId: string, userId: string, timeZone: string): Promise<PersonData> {
  return toPersonData(await request<unknown>("GET", `${p(projectId)}/people/${encodeURIComponent(userId)}?${new URLSearchParams({ tz: timeZone })}`));
}

/** The signed-in person's own page ("My work", any member). */
export async function getMyWork(projectId: string, timeZone: string): Promise<PersonData> {
  return toPersonData(await request<unknown>("GET", `${p(projectId)}/my-work?${new URLSearchParams({ tz: timeZone })}`));
}

// --- answers per person (the Quality tab's Answers section, Task 4) -------------------

/** Which first assessments the answers count; null or "" for no filter. */
export interface AnswersFilter {
  person: string | null;
  file: string | null;
  /** A column of `file` (1 or more) and the value the plots have in it. */
  column: number | null;
  value: string | null;
  /** Days (YYYY-MM-DD) of when the plots were last saved, both included. */
  from: string | null;
  to: string | null;
}

export const NO_ANSWERS_FILTER: AnswersFilter = { person: null, file: null, column: null, value: null, from: null, to: null };

export interface AnswerCode {
  code: string;
  label: string;
  count: number;
}

export interface ChoiceAnswers {
  key: string;
  label: string;
  multiple: boolean;
  answered: number;
  blank: number;
  codes: AnswerCode[];
  /** counts in the order of codes. */
  people: { username: string; answered: number; counts: number[] }[];
  /** Flags on this question (all, not only those listed). */
  flags: number;
}

export interface NumberSpread {
  values: number;
  nonNumeric: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
}

export interface NumberAnswers {
  key: string;
  label: string;
  team: NumberSpread;
  people: ({ username: string } & NumberSpread)[];
}

export interface AnswerFlag {
  key: string;
  label: string;
  username: string;
  code: string;
  codeLabel: string;
  plots: number;
  count: number;
  share: number;
  others: { plots: number; count: number; share: number };
  z: number;
}

export interface AnswersData {
  plots: number;
  person: string | null;
  people: { username: string; plots: number }[];
  choices: ChoiceAnswers[];
  numbers: NumberAnswers[];
  flags: AnswerFlag[];
  flagsTotal: number;
  /** Comparisons made, and about how many flags chance alone would give among them. */
  tests: number;
  chanceFlags: number;
  computedAt: number | null;
  stale: boolean;
  timeZone: string;
  filters: { people: string[]; files: { id: string; filename: string }[] };
}

const counts = (value: unknown): number[] => (Array.isArray(value) ? value.map(toCount) : []);

function toSpread(value: unknown): NumberSpread {
  const v = obj(value);
  return { values: toCount(v.values), nonNumeric: toCount(v.nonNumeric), median: toNumberOrNull(v.median), q1: toNumberOrNull(v.q1), q3: toNumberOrNull(v.q3) };
}

export function toAnswersData(body: unknown): AnswersData {
  const b = obj(body);
  const filters = obj(b.filters);
  return {
    plots: toCount(b.plots),
    person: nullableText(b.person),
    people: list(b.people).map((p) => ({ username: text(p.username), plots: toCount(p.plots) })),
    choices: list(b.choices).map((c) => ({
      key: text(c.key),
      label: text(c.label) || text(c.key),
      multiple: c.multiple === true,
      answered: toCount(c.answered),
      blank: toCount(c.blank),
      codes: list(c.codes).map((code) => ({ code: text(code.code), label: text(code.label) || text(code.code), count: toCount(code.count) })),
      people: list(c.people).map((p) => ({ username: text(p.username), answered: toCount(p.answered), counts: counts(p.counts) })),
      flags: toCount(c.flags),
    })),
    numbers: list(b.numbers).map((n) => ({
      key: text(n.key),
      label: text(n.label) || text(n.key),
      team: toSpread(n.team),
      people: list(n.people).map((p) => ({ username: text(p.username), ...toSpread(p) })),
    })),
    flags: list(b.flags).map((f) => {
      const others = obj(f.others);
      return {
        key: text(f.key),
        label: text(f.label) || text(f.key),
        username: text(f.username),
        code: text(f.code),
        codeLabel: text(f.codeLabel) || text(f.code),
        plots: toCount(f.plots),
        count: toCount(f.count),
        share: toNumberOrNull(f.share) ?? 0,
        others: { plots: toCount(others.plots), count: toCount(others.count), share: toNumberOrNull(others.share) ?? 0 },
        z: toNumberOrNull(f.z) ?? 0,
      };
    }),
    flagsTotal: toCount(b.flagsTotal),
    tests: toCount(b.tests),
    chanceFlags: toNumberOrNull(b.chanceFlags) ?? 0,
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
    timeZone: text(b.timeZone) || "UTC",
    filters: {
      people: strings(filters.people),
      files: list(filters.files).map((f) => ({ id: text(f.id), filename: text(f.filename) })),
    },
  };
}

/** The query of a filter: only what is set, a column only with its file and value. */
export function answersQuery(filter: AnswersFilter, timeZone: string): URLSearchParams {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.file) {
    query.set("file", filter.file);
    if (filter.column !== null && filter.value !== null) {
      query.set("column", String(filter.column));
      query.set("value", filter.value);
    }
  }
  if (filter.from) query.set("from", filter.from);
  if (filter.to) query.set("to", filter.to);
  query.set("tz", timeZone);
  return query;
}

/** The first assessments' answers, by person (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export async function getAnswers(projectId: string, filter: AnswersFilter, timeZone: string): Promise<AnswersData> {
  return toAnswersData(await request<unknown>("GET", `${p(projectId)}/quality/answers?${answersQuery(filter, timeZone)}`));
}

export interface AnswerColumn {
  index: number;
  name: string | null;
  distinctCount: number;
  values: { value: string; count: number }[] | null;
}

/** A plot file's columns (not the id) and their values, to filter the answers by one. */
export async function getAnswerColumns(projectId: string, fileId: string): Promise<AnswerColumn[]> {
  const body = obj(await request<unknown>("GET", `${p(projectId)}/quality/answers/columns?${new URLSearchParams({ file: fileId })}`));
  return list(body.columns).map((c) => ({
    index: toCount(c.index),
    name: typeof c.name === "string" ? c.name : null,
    distinctCount: toCount(c.distinctCount),
    values: Array.isArray(c.values) ? list(c.values).map((v) => ({ value: text(v.value), count: toCount(v.count) })) : null,
  }));
}

// ---------------------------------------------------------------------------
// Pattern flags (Task 5)

export const FLAG_KINDS = ["very_fast", "same_as_before", "required_empty", "edited_after_decision", "two_main", "no_plot"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
export type FlagCounts = Record<FlagKind, number>;

/** One plot worth a look (GET /quality/flags). Only `operator` names a person. */
export interface PatternFlag {
  kind: FlagKind;
  plot: string;
  operator: string;
  at: number | null;
  /** very_fast */
  gapMs: number | null;
  /** very_fast, same_as_before: the person's plot before it. */
  previousPlot: string | null;
  /** same_as_before */
  runLength: number | null;
  firstPlot: string | null;
  /** required_empty */
  questions: { key: string; label: string }[];
  /** edited_after_decision */
  decision: DecisionKind | null;
  decidedAt: number | null;
}

export interface FlagsData {
  fastSeconds: number;
  plots: number;
  counts: FlagCounts;
  people: { username: string; counts: FlagCounts; total: number }[];
  total: number;
  flags: PatternFlag[];
  requiredQuestions: number;
  computedAt: number | null;
  stale: boolean;
}

export interface FlagsFilter {
  person: string | null;
  kind: FlagKind | null;
}

export const NO_FLAGS_FILTER: FlagsFilter = { person: null, kind: null };

export function toFlagCounts(value: unknown): FlagCounts {
  const v = obj(value);
  return Object.fromEntries(FLAG_KINDS.map((k) => [k, toCount(v[k])])) as FlagCounts;
}

const toFlagKind = (value: unknown): FlagKind | null => (FLAG_KINDS as readonly unknown[]).includes(value) ? (value as FlagKind) : null;

export function toFlagsData(body: unknown): FlagsData {
  const b = obj(body);
  return {
    fastSeconds: toFastSeconds(b.fastSeconds),
    plots: toCount(b.plots),
    counts: toFlagCounts(b.counts),
    people: list(b.people).map((p) => ({ username: text(p.username), counts: toFlagCounts(p.counts), total: toCount(p.total) })),
    total: toCount(b.total),
    flags: list(b.flags).flatMap((f): PatternFlag[] => {
      const kind = toFlagKind(f.kind);
      if (kind === null) return [];
      const d = obj(f.details);
      const decision = d.decision === "first" || d.decision === "check" || d.decision === "recheck" ? d.decision : null;
      return [
        {
          kind,
          plot: text(f.plot),
          operator: text(f.operator),
          at: toMillis(f.at),
          gapMs: toNumberOrNull(d.gapMs),
          previousPlot: nullableText(d.previousPlot),
          runLength: toNumberOrNull(d.runLength),
          firstPlot: nullableText(d.firstPlot),
          questions: list(d.questions).map((q) => ({ key: text(q.key), label: text(q.label) || text(q.key) })),
          decision,
          decidedAt: toMillis(d.decidedAt),
        },
      ];
    }),
    requiredQuestions: toCount(b.requiredQuestions),
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
  };
}

/** Plots worth a look (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export async function getFlags(projectId: string, filter: FlagsFilter): Promise<FlagsData> {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.kind) query.set("kind", filter.kind);
  const q = query.toString();
  return toFlagsData(await request<unknown>("GET", `${p(projectId)}/quality/flags${q ? `?${q}` : ""}`));
}

// --- survey health (Task 6) -----------------------------------------------------

export type HealthReason = "low_agreement" | "often_other" | "often_empty" | "often_changed";
export const HEALTH_REASONS: readonly HealthReason[] = ["low_agreement", "often_other", "often_empty", "often_changed"];

export interface HealthCodes {
  count: number;
  share: number | null;
  answers: { code: string; label: string; count: number }[];
}

/** One question of the survey, as survey health counts it (first assessments, except agreement and decisions). */
export interface HealthRow {
  key: string;
  label: string;
  kind: "choice" | "number";
  calculated: boolean;
  required: boolean;
  /** Shown only for some answers: its empty share is information, never a reason. */
  conditional: boolean;
  /** Inside a group of questions: whether it was left empty is never known. */
  inGroup: boolean;
  answered: number;
  blank: number;
  nonNumeric: number;
  /** The first assessments that say whether it was left empty, and of them those left empty; notKnown the others. */
  emptyBase: number;
  emptyBlank: number;
  notKnown: number;
  /** emptyBlank / emptyBase; null in a group or under minPlots (emptyWhy). */
  emptyShare: number | null;
  emptyWhy: "group" | "few_records" | null;
  other: HealthCodes | null;
  /** "None" alone: an answer of its own, for information (Decision 6). */
  none: HealthCodes | null;
  agreement: { compared: number; agreeing: number; rate: number | null } | null;
  decisions: { changed: number; share: number | null };
  reasons: HealthReason[];
}

export interface SurveyHealthData {
  plots: number;
  plotsChecked: number;
  decidedForCheck: number;
  questions: HealthRow[];
  questionsTotal: number;
  thresholds: { minPlots: number; lowAgreement: number; oftenOther: number; oftenEmpty: number; minChanged: number; oftenChanged: number };
  computedAt: number | null;
  stale: boolean;
}

const toShare = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const toHealthCodes = (value: unknown): HealthCodes | null => {
  if (!value || typeof value !== "object") return null;
  const o = obj(value);
  return {
    count: toCount(o.count),
    share: toShare(o.share),
    answers: list(o.answers).map((a) => ({ code: text(a.code), label: text(a.label) || text(a.code), count: toCount(a.count) })),
  };
};

export function toSurveyHealth(body: unknown): SurveyHealthData {
  const b = obj(body);
  const th = obj(b.thresholds);
  const threshold = (value: unknown, fallback: number) => toShare(value) ?? fallback;
  return {
    plots: toCount(b.plots),
    plotsChecked: toCount(b.plotsChecked),
    decidedForCheck: toCount(b.decidedForCheck),
    questions: list(b.questions).map((q): HealthRow => {
      const agreement = q.agreement && typeof q.agreement === "object" ? obj(q.agreement) : null;
      const decisions = obj(q.decisions);
      return {
        key: text(q.key),
        label: text(q.label) || text(q.key),
        kind: q.kind === "number" ? "number" : "choice",
        calculated: q.calculated === true,
        required: q.required === true,
        conditional: q.conditional === true,
        inGroup: q.inGroup === true,
        answered: toCount(q.answered),
        blank: toCount(q.blank),
        nonNumeric: toCount(q.nonNumeric),
        emptyBase: toCount(q.emptyBase),
        emptyBlank: toCount(q.emptyBlank),
        notKnown: toCount(q.notKnown),
        emptyShare: toShare(q.emptyShare),
        emptyWhy: q.emptyWhy === "group" || q.emptyWhy === "few_records" ? q.emptyWhy : null,
        other: toHealthCodes(q.other),
        none: toHealthCodes(q.none),
        agreement: agreement ? { compared: toCount(agreement.compared), agreeing: toCount(agreement.agreeing), rate: toShare(agreement.rate) } : null,
        decisions: { changed: toCount(decisions.changed), share: toShare(decisions.share) },
        reasons: (Array.isArray(q.reasons) ? q.reasons : []).filter((r): r is HealthReason => (HEALTH_REASONS as readonly unknown[]).includes(r)),
      };
    }),
    questionsTotal: toCount(b.questionsTotal),
    thresholds: {
      minPlots: threshold(th.minPlots, 20),
      lowAgreement: threshold(th.lowAgreement, 0.8),
      oftenOther: threshold(th.oftenOther, 0.1),
      oftenEmpty: threshold(th.oftenEmpty, 0.2),
      minChanged: threshold(th.minChanged, 5),
      oftenChanged: threshold(th.oftenChanged, 0.25),
    },
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
  };
}

/** Survey health (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export async function getSurveyHealth(projectId: string): Promise<SurveyHealthData> {
  return toSurveyHealth(await request<unknown>("GET", `${p(projectId)}/quality/survey-health`));
}
