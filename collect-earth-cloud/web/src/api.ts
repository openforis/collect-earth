import type { MessageKey } from "./i18n";
import { getToken } from "./storage";

// Every call the dashboard makes to the Collect Earth Cloud server, in one place, with
// the response shapes it expects. Responses are normalised here (timestamps to epoch
// ms, counts to numbers, relative links to absolute ones) so the pages do not have to
// care about small differences between server versions.

export type Role = "admin" | "reviewer" | "operator";
export const ROLES: Role[] = ["operator", "reviewer", "admin"];
export type ProjectCreation = "anyone" | "platform-admins";
/** A project's lifecycle (the server's STATUS_MOVES): draft -> active -> closed (-> archived), closed -> active again. */
export type ProjectStatus = "draft" | "active" | "closed" | "archived";
export const STATUS_MOVES: Record<ProjectStatus, readonly ProjectStatus[]> = { draft: ["active"], active: ["closed"], closed: ["active", "archived"], archived: ["closed"] };

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
  /** "Forgot your password?" mails a reset link to an account's confirmed address (the server sends email). */
  selfServiceReset: boolean;
  /** The map of progress's base map (OpenStreetMap unless the server sets another). */
  mapTiles: MapTiles;
  /**
   * The dashboard runs on the person's own computer, for one person working alone (the server's
   * LOCAL_MODE): what is about other people or the server is hidden (src/localMode.ts).
   */
  localMode: boolean;
  /** Error reports (Sentry) and usage events, when the server sends them (its TELEMETRY setting). */
  telemetry?: DashboardTelemetry | null;
}

export interface DashboardTelemetry {
  sentryDsn: string | null;
  environment: string;
  release: string;
  /** The server forwards the dashboard's usage events (POST /telemetry). */
  events: boolean;
}

/** The server's telemetry settings, or null when they are off or unreadable (a DSN must be https). */
export function toTelemetry(value: unknown): DashboardTelemetry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const dsn = typeof v.sentryDsn === "string" && /^https:\/\/[^\s]+$/.test(v.sentryDsn) ? v.sentryDsn : null;
  const events = v.events === true;
  if (!dsn && !events) return null;
  return {
    sentryDsn: dsn,
    environment: typeof v.environment === "string" ? v.environment.slice(0, 64) : "production",
    release: typeof v.release === "string" ? v.release.slice(0, 100) : "collect-earth-cloud",
    events,
  };
}

/** Tells the server of a use of the dashboard it cannot see (it forwards it to Google Analytics, when it does). */
export function sendUsageEvent(projectId: string, name: "training_report_opened" | "training_report_printed", params: Record<string, string | number> = {}): void {
  request<unknown>("POST", `${p(projectId)}/telemetry`, { json: { name, params } }).catch(() => undefined);
}

/** A base map's tiles: a URL with {z}/{x}/{y}, the attribution the source asks for (plain text) and where it links. */
export interface MapTiles {
  url: string;
  attribution: string;
  attributionUrl: string | null;
  maxZoom: number;
}

/** OpenStreetMap's tiles: what a server that says nothing else uses. */
export const OSM_TILES: MapTiles = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
  maxZoom: 19,
};

/** The server's tiles when they are usable (an http(s) URL with {z}, {x} and {y}, an attribution), else OpenStreetMap's. */
export function toMapTiles(value: unknown): MapTiles {
  const m = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const url = safeUrl(m.url);
  const attribution = optionalText(m.attribution);
  if (!url || !attribution || !["{z}", "{x}", "{y}"].every((part) => url.includes(part))) return OSM_TILES;
  const maxZoom = Number(m.maxZoom);
  return {
    url,
    attribution,
    attributionUrl: safeUrl(m.attributionUrl),
    maxZoom: Number.isInteger(maxZoom) && maxZoom >= 1 && maxZoom <= 22 ? maxZoom : OSM_TILES.maxZoom,
  };
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
  status: ProjectStatus;
}

/** The server owner's message to everyone signed in; `until`: when it ends (epoch ms), null: until cleared. */
export interface Announcement {
  text: string;
  until: number | null;
}

export interface Me {
  userId: string;
  username: string;
  memberships: Membership[];
  isPlatformAdmin: boolean;
  announcement: Announcement | null;
  /** Two-step sign-in: on for the account; required of it by the server (it coordinates or administers). */
  twoFactor: { enabled: boolean; required: boolean };
}

export interface ProjectInfo {
  projectId: string;
  name: string;
  role: Role;
  status: ProjectStatus;
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
  /** The server administrator disabled the account: it cannot log in or sync. */
  disabled?: boolean;
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
  /** Given on upload of a file with a user column: how its plots were given out (the plots of unknown names were not). */
  assignment?: { assigned: number; checks: number; notAssigned: number; unknown: string[] };
  /** Given on upload: what may be wrong with the file, which was still taken. */
  warnings?: {
    /** Ids the survey's number keys cannot take. */
    badIds?: number;
    badIdExamples?: string[];
    duplicateIds: number;
    duplicateExamples: string[];
    badCoordinates: number;
    badCoordinateExamples: string[];
  };
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
  /** Whether the plots can be divided by place (order "nearby"), and why not. */
  nearby: NearbyInfo;
}

/**
 * Order "nearby" needs latitude and longitude: the survey's coordinates must be in latitude
 * and longitude ("other_srs" otherwise, with its `srid`) and some plots must have them
 * ("no_places"). `withoutPlace` plots are shared out last. "unknown": the server did not say.
 */
export interface NearbyInfo {
  available: boolean;
  reason: "other_srs" | "no_places" | "unknown" | null;
  withPlace: number;
  withoutPlace: number;
  srid: string | null;
}

export type DivisionOrder = "file" | "mixed" | "nearby";

/** How a plot file's plots are divided between people (what the server stores and applies). */
export type Distribution =
  | { mode: "whole" }
  | { mode: "manual"; order?: "nearby" }
  | { mode: "even"; people: string[]; percents?: number[]; order: DivisionOrder; overlapPercent?: number; seed?: number }
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
  /** Of the copies, those drawn by the automatic checks (the others came with the division). */
  sampled: number;
  /** Of the copies, those of reference plots (Task 14). */
  reference: number;
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
  /** Whoever decided has a record of the plot (a coordinator may decide their own plot). */
  byAssessor: boolean;
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
  /** The plot id as the collector sees it (keys hidden from the record list left out). */
  name: string;
}

/** The outline Collect Earth draws around a plot (from the project file), or only its place. */
export type PlotOutline = { kind: "square"; sideMeters: number } | { kind: "circle"; radiusMeters: number; vertices: number } | { kind: "place" };

/** The places asked for; none, with the system's id, when the survey's coordinates are not latitude and longitude. */
export interface PlotPlaces {
  places: PlotPlace[];
  outline: PlotOutline;
  unsupportedSrs: string | null;
}

function toOutline(value: unknown): PlotOutline {
  const o = obj(value);
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (o.kind === "square" && positive(o.sideMeters)) return { kind: "square", sideMeters: o.sideMeters };
  if (o.kind === "circle" && positive(o.radiusMeters) && positive(o.vertices) && Number.isInteger(o.vertices) && o.vertices >= 3 && o.vertices <= 400) {
    return { kind: "circle", radiusMeters: o.radiusMeters, vertices: o.vertices };
  }
  return { kind: "place" };
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
  /** The banner every signed-in person sees (plain text), and when it ends (epoch ms; null: until cleared). */
  announcement: string | null;
  announcementUntil: number | null;
  /** Coordinators and the server's administrators must use two-step sign-in. */
  twoFactorForCoordinators: boolean;
}

export interface AdminUser {
  userId: string;
  username: string;
  isPlatformAdmin: boolean;
  projects: number;
  /** Projects the person coordinates (what the per-account project limit counts). */
  coordinatedProjects: number;
  /** When a server administrator disabled the account, or null. */
  disabledAt: number | null;
  /** Who disabled it, or null. */
  disabledBy: string | null;
  /** Two-step sign-in is on for the account. */
  twoFactor: boolean;
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
  /** The coordinator's note in Collect Earth (Task 16); null from older servers and older files. */
  note: NoteInfo | null;
}

/** Whether the served project file carries the coordinator's note to Collect Earth, else why not. */
export interface NoteInfo {
  state: "added" | "none";
  /** Why the server did not add it, e.g. "records_exist". */
  refusal: string | null;
  /** The plot file column it is read from (added). */
  column: number | null;
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
  own_plot: "quality.ownPlot",
  no_such_plot: "quality.noSuchPlot",
  reference_plot: "plot.referenceNoDecision",
  map_changed: "map.changed",
  wrong_password: "error.wrongPassword",
  invalid_second_step: "error.invalidSecondStep",
  invalid_code: "error.invalidSecondStep",
  second_step_unreadable: "error.secondStepUnreadable",
  two_factor_required: "error.twoFactorRequired",
  set_up_two_factor_first: "error.setUpTwoFactorFirst",
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
  project_closed: "error.projectClosed",
  project_draft: "error.projectDraft",
  bad_transition: "error.badTransition",
  sole_coordinator: "error.soleCoordinator",
  last_platform_admin: "error.lastPlatformAdmin",
  last_enabled_admin: "error.lastEnabledAdmin",
  own_account: "error.ownAccount",
  account_disabled: "error.accountDisabled",
  terms_not_accepted: "error.termsNotAccepted",
  // Project file uploads (PUT /cep) refused once data exists or plots are divided.
  round_removed: "error.roundRemoved",
  note_removed: "error.noteRemoved",
  note_column_in_file: "error.noteColumnInFile",
  no_plots: "error.noPlots",
  training_plot_in_file: "error.trainingPlotInFile",
  training_plot_clash: "training.clash",
  // The Collect Earth backup (GET /exports/collect-backup).
  no_round_key: "backup.noRoundKey",
  no_project_file: "backup.noProjectFile",
  backup_busy: "backup.busy",
  // Progress links (POST /share-links).
  too_many_links: "shareLinks.tooMany",
  // Email digests (Task 19).
  invalid_email: "mail.invalidEmail",
  no_email: "mail.noEmail",
  too_many_confirmations: "mail.tooMany",
  invalid_stored_email: "mail.invalidStored",
  mail_failed: "mail.failed",
  already_confirmed: "mail.alreadyConfirmed",
  confirm_expired: "mail.confirmExpired",
  // The weekly summary (GET /weekly?week=): a week written right that the year does not have.
  no_such_week: "weekly.noSuchWeek",
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
  /** Send no session (a public page's request: the progress link). */
  anonymous?: boolean;
}

function headers(extra: Record<string, string> = {}, anonymous = false): Record<string, string> {
  const token = anonymous ? null : getToken();
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
      headers: headers(options.json !== undefined ? { "content-type": "application/json" } : {}, options.anonymous === true),
      ...(options.anonymous ? { credentials: "omit" as const, referrerPolicy: "no-referrer" as const } : {}),
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

/** A server without statuses (older) has active projects only. */
export function asStatus(value: unknown): ProjectStatus {
  return value === "draft" || value === "closed" || value === "archived" ? value : "active";
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
      selfServiceReset: info?.selfServiceReset === true,
      mapTiles: toMapTiles(info?.mapTiles),
      localMode: info?.localMode === true,
      telemetry: toTelemetry(info?.telemetry),
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
        selfServiceReset: false,
        mapTiles: OSM_TILES,
        localMode: false,
      };
    }
    throw error;
  }
}

export function setup(setupCode: string, username: string, password: string): Promise<Session> {
  return request<Session>("POST", "/v1/setup", { json: { setupCode, username, password }, noSessionEnd: true });
}

/** Logs in; with two-step sign-in, the server first answers second_step_required, then takes the code with the password. */
export function login(username: string, password: string, code?: string): Promise<Session> {
  return request<Session>("POST", "/v1/auth/login", { json: code ? { username, password, code } : { username, password }, noSessionEnd: true });
}

export function signup(username: string, password: string, email?: string, acceptTerms?: boolean, language?: string): Promise<Session> {
  const json: Record<string, string | boolean> = { username, password };
  if (email) json.email = email;
  // the confirmation mail of the address is written in the page's language
  if (email && language) json.language = language;
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
    memberships: Array.isArray(me?.memberships) ? me.memberships.map((m) => ({ ...m, role: asRole(m.role), status: asStatus(m.status) })) : [],
    isPlatformAdmin: me?.isPlatformAdmin === true,
    twoFactor: { enabled: me?.twoFactor?.enabled === true, required: me?.twoFactor?.required === true },
    announcement: toAnnouncement((me as { announcement?: unknown } | undefined)?.announcement),
  };
}

function toAnnouncement(value: unknown): Announcement | null {
  const a = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!a || typeof a.text !== "string" || !a.text.trim()) return null;
  return { text: a.text, until: typeof a.until === "number" && Number.isFinite(a.until) ? a.until : null };
}

// --- the owner's alerts (the server's src/ownerAlerts.ts) ---------------------------------------

export type OwnerAlertKind = "failed_logins" | "server_errors" | "sync_errors" | "storage";

export interface OwnerAlert {
  kind: OwnerAlertKind;
  at: number;
  count: number;
  projectId?: string;
}

/** The alerts this server instance raised since it started (newest first), and its thresholds. */
export async function getOwnerAlerts(): Promise<{ alerts: OwnerAlert[]; thresholds: Record<string, number> }> {
  const body = await request<{ alerts?: OwnerAlert[]; thresholds?: Record<string, number> }>("GET", "/v1/admin/alerts");
  return { alerts: Array.isArray(body?.alerts) ? body.alerts : [], thresholds: body?.thresholds ?? {} };
}

// --- former members (the server's src/routes/formerMembers.ts) -----------------------------------

export interface FormerMember {
  /** Their name as on their records: a username, or former-member-N once anonymised. */
  operator: string;
  records: number;
  anonymized: boolean;
}

export async function getFormerMembers(projectId: string): Promise<FormerMember[]> {
  return (await request<{ formerMembers: FormerMember[] }>("GET", `${p(projectId)}/former-members`)).formerMembers;
}

/** Renames a former member on everything they collected; gives the pseudonym and how many records. Cannot be undone. */
export async function anonymizeFormerMember(projectId: string, operator: string): Promise<{ operator: string; records: number }> {
  return request<{ operator: string; records: number }>("POST", `${p(projectId)}/former-members/anonymize`, { json: { operator } });
}

// --- two-step sign-in (the server's src/routes/twoFactor.ts) ------------------------------------

/** A new secret to put in an authenticator app: as text, and as the address its QR code holds. */
export async function startTwoFactor(): Promise<{ secret: string; uri: string }> {
  return request<{ secret: string; uri: string }>("POST", "/v1/me/two-factor/setup", { json: {} });
}

/** Turns two-step sign-in on with the app's first code; gives the recovery codes, shown once. */
export async function enableTwoFactor(code: string): Promise<string[]> {
  return (await request<{ recoveryCodes: string[] }>("POST", "/v1/me/two-factor/enable", { json: { code } })).recoveryCodes;
}

export async function disableTwoFactor(password: string): Promise<void> {
  await send("POST", "/v1/me/two-factor/disable", { json: { password } });
}

export async function newRecoveryCodes(password: string): Promise<string[]> {
  return (await request<{ recoveryCodes: string[] }>("POST", "/v1/me/two-factor/recovery-codes", { json: { password } })).recoveryCodes;
}

/** The server's administrator turns someone's two-step sign-in off (a lost phone): their sessions end. */
export async function resetUserTwoFactor(userId: string): Promise<void> {
  await send("POST", `/v1/admin/users/${encodeURIComponent(userId)}/two-factor/reset`, { json: {} });
}

/**
 * Changes the password: the server ends every other session of the account (Collect Earth's too) and
 * mails a notice, in `language`, to the account's confirmed address.
 */
export async function changePassword(currentPassword: string, newPassword: string, language?: string): Promise<void> {
  try {
    await send("PUT", "/v1/me/password", { json: { currentPassword, newPassword, ...(language ? { language } : {}) }, noSessionEnd: true });
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

// --- email digests (Task 19) ----------------------------------------------------

export type DigestKind = "coordinator" | "collector";

export interface DigestView {
  on: boolean;
  /** Turned off by the server after the mail server refused the address several weeks in a row. */
  stopped: boolean;
  lastSentWeek: string | null;
  /** The latest week a mail actually went for (YYYY-Www), and when. */
  lastMailedWeek: string | null;
  lastSentAt: number | null;
}

export interface Notifications {
  email: string | null;
  /** False: the stored address is not one email address (an older sign-up): it must be typed again. */
  emailValid: boolean;
  emailConfirmed: boolean;
  /** The language and time zone the mails are written in (null: never chosen). */
  language: string | null;
  timeZone: string | null;
  /** False: this server sends no email (no SMTP set up); the choices are kept. */
  sends: boolean;
  /** Which digests make sense: coordinating a project, collecting in one. */
  roles: Record<DigestKind, boolean>;
  digests: Record<DigestKind, DigestView>;
}

function toNotifications(body: unknown): Notifications {
  const b = (body ?? {}) as Record<string, unknown>;
  const roles = (b.roles ?? {}) as Record<string, unknown>;
  const digests = (b.digests ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const digest = (kind: DigestKind): DigestView => ({
    on: digests[kind]?.on === true,
    stopped: digests[kind]?.stopped === true,
    lastSentWeek: typeof digests[kind]?.lastSentWeek === "string" ? (digests[kind]!.lastSentWeek as string) : null,
    lastMailedWeek: typeof digests[kind]?.lastMailedWeek === "string" ? (digests[kind]!.lastMailedWeek as string) : null,
    lastSentAt: typeof digests[kind]?.lastSentAt === "number" ? (digests[kind]!.lastSentAt as number) : null,
  });
  return {
    email: typeof b.email === "string" ? b.email : null,
    emailValid: b.emailValid !== false,
    emailConfirmed: b.emailConfirmed === true,
    language: typeof b.language === "string" ? b.language : null,
    timeZone: typeof b.timeZone === "string" ? b.timeZone : null,
    sends: b.sends === true,
    roles: { coordinator: roles.coordinator === true, collector: roles.collector === true },
    digests: { coordinator: digest("coordinator"), collector: digest("collector") },
  };
}

export async function getNotifications(): Promise<Notifications> {
  return toNotifications(await request("GET", "/v1/me/notifications"));
}

/** Turns digests on or off, in the language and time zone given (the dashboard's); no zone keeps the stored one. */
export async function setNotifications(change: Partial<Record<DigestKind, boolean>> & { language: string; timeZone?: string | null }): Promise<Notifications> {
  const { timeZone, ...rest } = change;
  return toNotifications(await request("PUT", "/v1/me/notifications", { json: timeZone ? { ...rest, timeZone } : rest }));
}

/** Gives the account an email (null removes it); a new one gets a mail with a link to confirm it. */
export async function setEmail(email: string | null, language: string): Promise<Notifications> {
  return toNotifications(await request("PUT", "/v1/me/email", { json: { email, language } }));
}

export async function sendEmailConfirmation(language: string): Promise<void> {
  await send("POST", "/v1/me/email/confirmation", { json: { language } });
}

/** The confirmation link's page (no login needed). */
export async function confirmEmail(token: string): Promise<void> {
  await send("POST", "/v1/email/confirm", { json: { token }, anonymous: true, noSessionEnd: true });
}

/** The unsubscribe link's page (no login needed): turns that digest off. */
export async function unsubscribe(token: string): Promise<DigestKind> {
  const body = await request<{ kind?: unknown }>("POST", `/v1/unsubscribe/${encodeURIComponent(token)}`, { json: {}, anonymous: true, noSessionEnd: true });
  return body?.kind === "coordinator" ? "coordinator" : "collector";
}

/**
 * Whether a password reset link still works (asked when its page opens; the link is not used):
 * false for one used, expired or unknown. Other errors (offline…) are thrown.
 */
export async function checkResetLink(token: string): Promise<boolean> {
  try {
    await send("GET", `/v1/auth/reset/${encodeURIComponent(token)}`, { noSessionEnd: true });
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 410 || err.status === 404)) return false;
    throw err;
  }
}

export async function resetPassword(token: string, newPassword: string, language?: string): Promise<void> {
  await send("POST", "/v1/auth/reset", { json: { token, newPassword, ...(language ? { language } : {}) }, noSessionEnd: true });
}

/**
 * "Forgot your password?": asks the server to mail a reset link for `login` (a username or an email
 * address). The server answers the same whatever the account (202), so there is nothing to read back.
 */
export async function forgotPassword(login: string, language: string): Promise<void> {
  await send("POST", "/v1/auth/forgot", { json: { login, language }, anonymous: true, noSessionEnd: true });
}

// --- projects --------------------------------------------------------------------------

export async function listProjects(): Promise<Membership[]> {
  const body = await request<{ projects?: Membership[] }>("GET", "/v1/projects");
  return (body?.projects ?? []).map((m) => ({ ...m, role: asRole(m.role), status: asStatus(m.status) }));
}

export function createProject(name: string): Promise<{ projectId: string; name: string }> {
  return request("POST", "/v1/projects", { json: { name } });
}

export async function getProject(projectId: string): Promise<ProjectInfo> {
  const body = await request<{ projectId: string; name: string; role: string; status?: string }>("GET", p(projectId));
  return { projectId: body.projectId, name: body.name, role: asRole(body.role), status: asStatus(body.status) };
}

/** A new project (a draft) from this one: its survey, plot files and settings; with `members`, its people and who does which plots. */
export function copyProject(projectId: string, name: string, members: boolean): Promise<{ projectId: string; name: string }> {
  return request("POST", `${p(projectId)}/copy`, { json: { name, members } });
}

export async function setProjectStatus(projectId: string, status: ProjectStatus): Promise<ProjectStatus> {
  const body = await request<{ status?: string }>("PUT", `${p(projectId)}/status`, { json: { status } });
  return asStatus(body?.status);
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
    note: toNoteInfo(record.note),
  };
}

function toNoteInfo(body: unknown): NoteInfo | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const state = record.state === "added" ? "added" : "none";
  return {
    state,
    refusal: typeof record.refusal === "string" && record.refusal ? record.refusal : null,
    column: state === "added" && typeof record.column === "number" ? record.column : null,
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

export async function listInvites(projectId: string): Promise<PeopleInvite[]> {
  const body = await request<{ invites?: Record<string, unknown>[] } | Record<string, unknown>[]>("GET", `${p(projectId)}/invites`);
  const raw = Array.isArray(body) ? body : (body?.invites ?? []);
  return raw.map((i) => ({
    id: String(i.id ?? ""),
    role: asRole(i.role),
    maxUses: toCount(i.maxUses),
    usedCount: toCount(i.usedCount),
    expiresAt: toMillis(i.expiresAt),
    createdAt: toMillis(i.createdAt),
    forUsername: typeof i.forUsername === "string" && i.forUsername !== "" ? i.forUsername : null,
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
  return (body?.members ?? []).map((m) => ({ ...m, role: asRole(m.role), disabled: m.disabled === true }));
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

/**
 * Uploads (or replaces) a plot file. A replacement that drops plots people hold or submitted
 * is refused with code "replace_needs_confirm" (its details: ReplaceImpact) unless `confirmReplace`.
 */
export function uploadCsvFile(projectId: string, file: File, onProgress?: Progress, confirmReplace = false): Promise<CsvFile> {
  const query = confirmReplace ? "?confirm=replace" : "";
  return upload<CsvFile>("PUT", `${p(projectId)}/csv-files/${encodeURIComponent(file.name)}${query}`, file, "text/csv", onProgress);
}

/** How plot design lays out the plots over the area of interest. */
export type PlotDesign =
  | { method: "random"; count: number }
  | { method: "grid"; spacingMeters: number; randomOffset: boolean }
  | { method: "stratified"; field: string; allocation: "equal" | "proportional"; count: number };

/** The area of interest as sent: a GeoJSON text, or a zipped shapefile in base64. */
export type DesignArea = { geojson: string } | { shapefile: string };

/** The area as the server read it. */
export interface DesignFacts {
  features: number;
  fields: string[];
  areaKm2: number;
  /** Most plots a design may make. */
  max: number;
}

/** How many plots a design makes, laid out with `seed`. */
export interface DesignPlan extends DesignFacts {
  plots: number;
  tooMany: boolean;
  strata: { value: string; areaKm2: number; plots: number }[] | null;
  seed: number;
}

const designPath = (projectId: string) => `${p(projectId)}/plot-design`;

export const readDesignArea = (projectId: string, area: DesignArea) => request<DesignFacts>("POST", designPath(projectId), { json: area });

export const planPlotDesign = (projectId: string, area: DesignArea, design: PlotDesign, seed?: number) =>
  request<DesignPlan>("POST", designPath(projectId), { json: { ...area, design, seed } });

/** The plot file of a design (CSV text), to upload as any plot file. */
export async function generatePlotDesign(projectId: string, area: DesignArea, design: PlotDesign, seed: number): Promise<string> {
  const response = await send("POST", designPath(projectId), { json: { ...area, design, seed, generate: true } });
  return response.text();
}

/** What replacing a plot file would take out of the project (the "replace_needs_confirm" error's details). */
export interface ReplaceImpact {
  removedPlots: number;
  heldRemoved: number;
  submittedRemoved: number;
  keptPlots: number;
  newPlots: number;
  divided: boolean;
}

export function replaceImpactOf(error: unknown): ReplaceImpact | null {
  if (!(error instanceof ApiError) || error.code !== "replace_needs_confirm") return null;
  const d = error.details;
  const n = (key: string) => (typeof d[key] === "number" ? (d[key] as number) : 0);
  return {
    removedPlots: n("removedPlots"),
    heldRemoved: n("heldRemoved"),
    submittedRemoved: n("submittedRemoved"),
    keptPlots: n("keptPlots"),
    newPlots: n("newPlots"),
    divided: d.divided === true,
  };
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
  const order: DivisionOrder = d.order === "mixed" || d.order === "nearby" ? d.order : "file";
  const extra: { overlapPercent?: number; seed?: number } = {};
  if (typeof d.overlapPercent === "number" && d.overlapPercent > 0) extra.overlapPercent = d.overlapPercent;
  if (typeof d.seed === "number") extra.seed = d.seed;
  switch (d.mode) {
    case "manual":
      return d.order === "nearby" ? { mode: "manual", order: "nearby" } : { mode: "manual" };
    case "even": {
      const people = strings(d.people);
      const percents = Array.isArray(d.percents) && d.percents.length === people.length ? d.percents.map((p) => toCount(p)) : null;
      return { mode: "even", people, ...(percents ? { percents } : {}), order, ...extra };
    }
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
      sampled: toCount(person.sampled),
      reference: toCount(person.reference),
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
    nearby: toNearbyInfo(body?.nearby, toCount(body?.plotCount)),
  };
}

/**
 * The server's answer on order "nearby". A server that does not say (or gives no reason) does
 * not offer it, and the reason is "unknown": nothing is claimed about the file's places.
 */
export function toNearbyInfo(value: unknown, plotCount: number): NearbyInfo {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const reason = v.reason === "other_srs" || v.reason === "no_places" ? v.reason : null;
  if (v.available === true) {
    return { available: true, reason: null, withPlace: toCount(v.withPlace), withoutPlace: toCount(v.withoutPlace), srid: null };
  }
  if (reason === null) return { available: false, reason: "unknown", withPlace: 0, withoutPlace: 0, srid: null };
  return {
    available: false,
    reason,
    withPlace: 0,
    withoutPlace: v.withoutPlace === undefined ? plotCount : toCount(v.withoutPlace),
    srid: typeof v.srid === "string" ? v.srid : null,
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
): Promise<DistributionState & { moved: number; notMoved: number; droppedChecks: number }> {
  const body = await request<Record<string, unknown>>("POST", `${f(projectId, csvFileId)}/move-unfinished`, { json: { fromUserId, toUserId } });
  // notMoved: kept with `from` (`to` assessed or checked them); droppedChecks: copies to compare of plots `to` collects.
  return { ...toDistributionState(body), moved: toCount(body?.moved), notMoved: toCount(body?.notMoved), droppedChecks: toCount(body?.droppedChecks) };
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
  return { plot: text(d.plot), decision, comment: nullableText(d.comment), decidedBy: nullableText(d.decidedBy), decidedAt: toMillis(d.decidedAt), byAssessor: d.byAssessor === true };
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
  try {
    return toDecision(await request<unknown>("PUT", decisionPath(projectId, plot), { json }));
  } catch (error) {
    // A plot in no plot file and without records (or one a reviewer may not see) is a 404: say so plainly.
    if (error instanceof ApiError && error.status === 404) throw new ApiError(404, NO_SUCH_PLOT, error.reason, error.details);
    throw error;
  }
}

/** The code setQualityDecision gives a 404: the plot is not in this project (any more). */
export const NO_SUCH_PLOT = "no_such_plot";

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
  if (plots.length === 0) return { places: [], outline: { kind: "place" }, unsupportedSrs: null };
  const body = await request<{ places?: unknown; outline?: unknown; unsupportedSrs?: unknown }>("POST", `${p(projectId)}/quality/places`, { json: { plots } });
  const places = list(body?.places)
    .map((place) => ({ plot: text(place.plot), lat: Number(place.lat), lon: Number(place.lon), name: typeof place.name === "string" ? place.name : text(place.plot) }))
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
  return { places, outline: toOutline(body?.outline), unsupportedSrs: typeof body?.unsupportedSrs === "string" && body.unsupportedSrs !== "" ? body.unsupportedSrs : null };
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
  /** Who processes what is sent, and where (region "global": any of the provider's regions); null while unavailable. */
  where: { provider: string; model: string; region: string } | null;
}

function toWhere(v: unknown): ProjectAi["where"] {
  const w = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  return w && typeof w.provider === "string" ? { provider: w.provider, model: String(w.model ?? ""), region: String(w.region ?? "") } : null;
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
  return { enabled: body.enabled === true, available: body.available === true, where: toWhere(body.where) };
}

/** Switches the assistant on or off for a project (a person's session only: a project key gets 403 user_session_required). */
export async function setProjectAi(projectId: string, enabled: boolean): Promise<ProjectAi> {
  const body = obj(await request<unknown>("PUT", `${p(projectId)}/ai`, { json: { enabled } }));
  return { enabled: body.enabled === true, available: body.available === true, where: toWhere(body.where) };
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

/** The formats of the data download: a spreadsheet, or a map file with each plot's shape. */
export const EXPORT_FORMATS = ["csv", "geojson", "kml", "shp.zip"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The collected data as a CSV or map file (fetched with the session, then saved by the page). */
export async function downloadExport(projectId: string, format: ExportFormat = "csv"): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/export.${format}`);
  return { blob: await response.blob(), filename: attachmentName(response, `collect-earth-data.${format}`) };
}

/** The file name a download was sent with: the UTF-8 name (filename*) before the ASCII fallback the server sends first. */
function attachmentName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Which records a Collect Earth backup holds: the first assessments (round 1), or every round. */
export type BackupRounds = "1" | "all";

/** What a Collect Earth backup would hold with one choice. */
export interface BackupCounts {
  /** Records in the backup (one per plot and round). */
  records: number;
  /** Of them, not submitted. */
  drafts: number;
  /** Records of other rounds left out (the checks, with the first assessments only). */
  otherRounds: number;
  /** The collectors' measurements of reference plots, left out in every choice. */
  measurements: number;
  /** Records left out because another record has the same plot and round (Collect Earth keeps one). */
  sameKey: number;
  /** Some of the plots and rounds that had more than one record ("17,1"). */
  sameKeyExamples: string[];
  /** Records left out because the server has no XML for them. */
  noXml: number;
  /** About how large the file is, in bytes. */
  estimatedBytes: number;
}

export interface BackupSummary {
  /** A project file was uploaded (the backup carries its survey). */
  projectFile: boolean;
  /** The survey has the round key, so every round can go in the backup. */
  roundKey: boolean;
  /** The round codes of the first assessments ("1"; a survey's own codes), or null when they are told apart by who holds the plots. */
  firstCodes: string[] | null;
  /** The project file carries the coordinator's note (Task 16). */
  note: boolean;
  first: BackupCounts;
  /** Null without the round key. */
  all: BackupCounts | null;
}

function toBackupCounts(value: unknown): BackupCounts {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    records: toCount(v.records),
    drafts: toCount(v.drafts),
    otherRounds: toCount(v.otherRounds),
    measurements: toCount(v.measurements),
    sameKey: toCount(v.sameKey),
    sameKeyExamples: Array.isArray(v.sameKeyExamples) ? v.sameKeyExamples.filter((k): k is string => typeof k === "string") : [],
    noXml: toCount(v.noXml),
    estimatedBytes: toCount(v.estimatedBytes),
  };
}

export function toBackupSummary(value: unknown): BackupSummary {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rounds = v.rounds && typeof v.rounds === "object" ? (v.rounds as Record<string, unknown>) : {};
  const roundKey = v.roundKey === true;
  return {
    projectFile: v.projectFile === true,
    roundKey,
    firstCodes: Array.isArray(v.firstCodes) ? v.firstCodes.filter((c): c is string => typeof c === "string") : null,
    note: v.note === true,
    first: toBackupCounts(rounds["1"]),
    all: roundKey && rounds.all ? toBackupCounts(rounds.all) : null,
  };
}

/** What the Collect Earth backup would hold with each choice. */
export async function getBackupSummary(projectId: string): Promise<BackupSummary> {
  return toBackupSummary(await request<unknown>("GET", `${p(projectId)}/exports/collect-backup/summary`));
}

/**
 * A link to the Collect Earth backup (a zip of the survey and the records, for "Import new data
 * from ZIP"): used once within a minute, by the browser itself, which saves the file to disk as it
 * comes and shows its progress (the page holds none of it).
 */
export async function getBackupLink(projectId: string, rounds: BackupRounds): Promise<{ url: string; expiresAt: number }> {
  const body = await request<{ url?: unknown; expiresAt?: unknown }>("POST", `${p(projectId)}/exports/collect-backup/link`, { json: { rounds } });
  if (typeof body?.url !== "string" || !body.url.startsWith("/v1/collect-backup/")) throw new ApiError(500, "http_500");
  return { url: body.url, expiresAt: toMillis(body.expiresAt) ?? 0 };
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
  announcement: null,
  announcementUntil: null,
  twoFactorForCoordinators: false,
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
    announcement: text("announcement", fallback.announcement),
    announcementUntil: "announcementUntil" in b ? toMillis(b.announcementUntil) : fallback.announcementUntil,
    twoFactorForCoordinators: typeof b.twoFactorForCoordinators === "boolean" ? b.twoFactorForCoordinators : fallback.twoFactorForCoordinators,
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

function toAdminUser(u: Record<string, unknown>): AdminUser {
  return {
    userId: String(u.userId ?? ""),
    username: String(u.username ?? ""),
    isPlatformAdmin: u.isPlatformAdmin === true,
    projects: toCount(u.projects),
    coordinatedProjects: toCount(u.coordinatedProjects),
    disabledAt: toMillis(u.disabledAt),
    disabledBy: typeof u.disabledBy === "string" ? u.disabledBy : null,
    twoFactor: u.twoFactor === true,
  };
}

export async function listUsers(): Promise<AdminUser[]> {
  const body = await request<{ users?: Record<string, unknown>[] }>("GET", "/v1/admin/users");
  return (body?.users ?? []).map(toAdminUser);
}

/** Disables an account (it cannot log in; its sessions end) or enables it again; the account as it is now. */
export async function setUserDisabled(userId: string, disabled: boolean): Promise<AdminUser> {
  const body = await request<{ user?: Record<string, unknown> }>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/${disabled ? "disable" : "enable"}`);
  return toAdminUser(body?.user ?? {});
}

/** The server owner's panel: totals only, projects by id (never names, people or answers). */
export interface ServerOverview {
  asOf: number;
  users: { total: number; disabled: number; platformAdmins: number; active: number; signupsByWeek: { week: string; start: number; count: number }[] };
  projects: { total: number; active: number; storageBytes: number; largest: { projectId: string; storageBytes: number }[] };
  records: { received: number; receivedByDay: { day: number; count: number }[] };
  database: {
    backend: "memory" | "postgres";
    sizeBytes: number | null;
    version: string | null;
    migrations: { applied: number; shipped: number; latest: string | null; newestAppliedAt: number | null; missing: string[] } | null;
  };
  server: { version: string; startedAt: number };
  security: {
    since: number;
    totals: { failedLogins: number; rateLimited: number };
    hours: { hour: number; failedLogins: number; rateLimited: number }[];
    /** Automatic check draws worked out after their request's wait (stored nothing, tried again later), and the last one's time. */
    lateDraws: number;
    lastLateDrawAt: number | null;
  };
}

const countOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

export async function getServerOverview(): Promise<ServerOverview> {
  const b = obj(await request<unknown>("GET", "/v1/admin/overview"));
  const users = obj(b.users);
  const projects = obj(b.projects);
  const records = obj(b.records);
  const database = obj(b.database);
  const server = obj(b.server);
  const security = obj(b.security);
  const totals = obj(security.totals);
  const m = database.migrations && typeof database.migrations === "object" ? obj(database.migrations) : null;
  return {
    asOf: toMillis(b.asOf) ?? Date.now(),
    users: {
      total: toCount(users.total),
      disabled: toCount(users.disabled),
      platformAdmins: toCount(users.platformAdmins),
      active: toCount(users.active),
      signupsByWeek: list(users.signupsByWeek).map((w) => ({ week: text(w.week), start: toMillis(w.start) ?? 0, count: toCount(w.count) })),
    },
    projects: {
      total: toCount(projects.total),
      active: toCount(projects.active),
      storageBytes: toCount(projects.storageBytes),
      largest: list(projects.largest).map((p) => ({ projectId: text(p.projectId), storageBytes: toCount(p.storageBytes) })),
    },
    records: {
      received: toCount(records.received),
      receivedByDay: list(records.receivedByDay).map((d) => ({ day: toMillis(d.day) ?? 0, count: toCount(d.count) })),
    },
    database: {
      backend: database.backend === "postgres" ? "postgres" : "memory",
      sizeBytes: countOrNull(database.sizeBytes),
      version: typeof database.version === "string" ? database.version : null,
      migrations: m && {
        applied: toCount(m.applied),
        shipped: toCount(m.shipped),
        latest: typeof m.latest === "string" ? m.latest : null,
        newestAppliedAt: toMillis(m.newestAppliedAt),
        missing: Array.isArray(m.missing) ? m.missing.filter((x): x is string => typeof x === "string") : [],
      },
    },
    server: { version: text(server.version), startedAt: toMillis(server.startedAt) ?? 0 },
    security: {
      since: toMillis(security.since) ?? 0,
      totals: { failedLogins: toCount(totals.failedLogins), rateLimited: toCount(totals.rateLimited) },
      hours: list(security.hours).map((h) => ({ hour: toMillis(h.hour) ?? 0, failedLogins: toCount(h.failedLogins), rateLimited: toCount(h.rateLimited) })),
      lateDraws: toCount(security.lateDraws),
      lastLateDrawAt: toMillis(security.lastLateDrawAt),
    },
  };
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
  /** trainingFinished: the learning set, and whether they passed (null: no pass mark). */
  set?: string | null;
  passed?: boolean | null;
}

export type AttentionKind =
  | "quiet"
  | "neverDownloaded"
  | "notAssigned"
  | "oldUnsentWork"
  | "differencesWaiting"
  | "storage"
  | "oldProjectFile"
  | "oldCollectEarth"
  | "trainingFinished";

export const ATTENTION_KINDS: readonly AttentionKind[] = [
  "quiet",
  "neverDownloaded",
  "notAssigned",
  "oldUnsentWork",
  "differencesWaiting",
  "storage",
  "oldProjectFile",
  "oldCollectEarth",
  "trainingFinished",
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

/** One "needs attention" item (the Progress tab's cards, the bell). */
export function toAttentionItem(a: Record<string, unknown>): AttentionItem {
  return {
    kind: a.kind as AttentionKind,
    count: toCount(a.count),
    people: (Array.isArray(a.people) ? (a.people as Record<string, unknown>[]) : []).map((person) => ({
      username: String(person.username ?? ""),
      lastSyncAt: toMillis(person.lastSyncAt),
      lastPlotsDownloadAt: toMillis(person.lastPlotsDownloadAt),
      medianDelayMs: toNumberOrNull(person.medianDelayMs),
      ...(typeof person.set === "string" ? { set: person.set, passed: typeof person.passed === "boolean" ? person.passed : null } : {}),
    })),
    quietDays: toNumberOrNull(a.quietDays),
    unknownVersion: toCount(a.unknownVersion),
    level: a.level === "over" || a.level === "nearlyFull" ? a.level : null,
    usedBytes: toNumberOrNull(a.usedBytes),
    limitBytes: toNumberOrNull(a.limitBytes),
  };
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
        : attention.filter((a) => ATTENTION_KINDS.includes(a.kind as AttentionKind)).map(toAttentionItem),
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

// --- progress links for funders (Task 18) -------------------------------------------

/** A read-only progress link as coordinators list it (its token is shown only when it is made). */
export interface ShareLink {
  id: string;
  label: string;
  createdAt: number | null;
  /** The username of who made it; null for a project key or an account since deleted. */
  createdBy: string | null;
  lastUsedAt: number | null;
}

export interface NewShareLink {
  link: ShareLink;
  /** The whole address to give out (shown once). */
  url: string;
}

function toShareLink(value: unknown): ShareLink {
  const l = (value ?? {}) as Record<string, unknown>;
  return {
    id: String(l.id ?? ""),
    label: typeof l.label === "string" ? l.label : "",
    createdAt: toMillis(l.createdAt),
    createdBy: typeof l.createdBy === "string" ? l.createdBy : null,
    lastUsedAt: toMillis(l.lastUsedAt),
  };
}

export async function listShareLinks(projectId: string): Promise<ShareLink[]> {
  const body = await request<{ links?: unknown[] }>("GET", `${p(projectId)}/share-links`);
  return (Array.isArray(body?.links) ? body.links : []).map(toShareLink);
}

export async function createShareLink(projectId: string, label: string): Promise<NewShareLink> {
  const body = await request<Record<string, unknown>>("POST", `${p(projectId)}/share-links`, { json: { label } });
  const path = typeof body.path === "string" && body.path.startsWith("/p/") ? body.path : `/p/${encodeURIComponent(String(body.token ?? ""))}`;
  return { link: toShareLink(body.link), url: absoluteUrl(typeof body.url === "string" ? body.url : null, path) };
}

export async function revokeShareLink(projectId: string, linkId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/share-links/${encodeURIComponent(linkId)}`);
}

/** What a progress link shows: the project's name and the Progress tab's figures, never a name or an answer. */
export interface PublicProgressData {
  projectName: string;
  timeZone: string;
  today: string;
  asOf: number | null;
  totals: ProgressTotals;
  daily: ProgressDay[];
  forecast: Forecast;
  quality: {
    /** False when the server has no quality figures at hand yet. */
    available: boolean;
    /** Checked plots compared with their first assessment; rate null when too few to say. */
    agreement: { compared: number; agreeing: number; rate: number | null } | null;
    computedAt: number | null;
  };
}

export function toPublicProgress(body: unknown): PublicProgressData {
  const b = (body ?? {}) as Record<string, unknown>;
  const progress = toProgressData(b);
  const q = (b.quality ?? {}) as Record<string, unknown>;
  const a = q.agreement as Record<string, unknown> | null | undefined;
  return {
    projectName: String(((b.project ?? {}) as Record<string, unknown>).name ?? ""),
    timeZone: progress.timeZone,
    today: progress.today,
    asOf: progress.asOf,
    totals: progress.totals,
    daily: progress.daily,
    forecast: progress.forecast,
    quality: {
      available: q.available === true,
      agreement: a && typeof a === "object" ? { compared: toCount(a.compared), agreeing: toCount(a.agreeing), rate: toNumberOrNull(a.rate) } : null,
      computedAt: toMillis(q.computedAt),
    },
  };
}

/** A progress link's figures, asked without the session (the page is public; nobody needs to be logged in). */
export async function getPublicProgress(token: string, timeZone: string): Promise<PublicProgressData> {
  const query = new URLSearchParams({ tz: timeZone });
  return toPublicProgress(await request<unknown>("GET", `/v1/public/progress/${encodeURIComponent(token)}?${query}`, { anonymous: true, noSessionEnd: true }));
}

// --- people (the People tab, a person's page, My work) ------------------------------

export type PersonStatusKind = "noPlots" | "finished" | "neverStarted" | "quiet" | "working" | "disabled";

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
  /** The project's "very fast" threshold (fastSeconds) the count used. */
  veryFastSeconds: number;
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
  /** Submitted again since: it has left their "To check again" plot file. */
  submittedAgain: boolean;
  /** The "To check again" plot file it is in for them in Collect Earth, while waiting. */
  file: string | null;
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
  quality: QualityAtHand & { asFirst: Rate | null; asChecker: Rate | null; sentBack: SentBack[]; flags: FlagCounts | null; reference?: ReferencePerson | null };
}

const STATUS_KINDS: readonly PersonStatusKind[] = ["noPlots", "finished", "neverStarted", "quiet", "working", "disabled"];
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
      veryFastSeconds: toFastSeconds(speed.veryFastSeconds),
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
      sentBack: list(quality.sentBack).map((s) => ({ plot: text(s.plot), comment: nullableText(s.comment), decidedAt: toMillis(s.decidedAt), decidedBy: nullableText(s.decidedBy), submittedAgain: s.submittedAgain === true, file: nullableText(s.file) })),
      flags: quality.flags && typeof quality.flags === "object" ? toFlagCounts(quality.flags) : null,
      // Absent: the project has no reference plot (the line is not shown); null: none of theirs measured yet.
      ...(quality.reference === undefined ? {} : { reference: quality.reference && typeof quality.reference === "object" ? toReferencePerson(quality.reference) : null }),
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

/** One person's time per plot (GET /time-spent): Collect Earth's active time on their submitted plots. */
export interface PersonTime {
  username: string;
  timed: number;
  untimed: number;
  medianSeconds: number | null;
  q1Seconds: number | null;
  q3Seconds: number | null;
  totalSeconds: number;
  quick: number;
  /** Their timed plots in each band of `bandLimits` (one more: the last band is open). */
  bands: number[];
}

/** A plot done much quicker than the team usually takes. */
export interface QuickPlot {
  plot: string;
  operator: string;
  seconds: number;
  submittedAt: number;
}

/** The time spent on each plot (coordinators only). */
export interface TimeSpentData {
  timed: number;
  untimed: number;
  medianSeconds: number | null;
  q1Seconds: number | null;
  q3Seconds: number | null;
  /** Plots under this many seconds are quick; null while fewer than `minTimed` plots are timed. */
  quickBelowSeconds: number | null;
  quickShare: number;
  minTimed: number;
  bands: number[];
  bandLimits: number[];
  people: PersonTime[];
  quickCount: number;
  quick: QuickPlot[];
}

/** How long the interpreters take per plot, and the plots done much quicker than the team usually takes (coordinators). */
export async function getTimeSpent(projectId: string, person?: string): Promise<TimeSpentData> {
  const query = person === undefined ? "" : `?${new URLSearchParams({ person })}`;
  return request<TimeSpentData>("GET", `${p(projectId)}/time-spent${query}`);
}

// --- the analysis page (what replaces Saiku; the server's src/analysis.ts) -----------

export type AnalysisColumnType = "code" | "boolean" | "integer" | "real" | "text" | "date" | "time";

export interface AnalysisColumnModel {
  name: string;
  key: string;
  labels: Record<string, string>;
  type: AnalysisColumnType;
  list: string | null;
  calculated: boolean;
  multiple: boolean;
  fromPlotFile: boolean;
  /** A key attribute of the survey (the plot's id, the assessment round). Absent from an older server. */
  keyAttr?: boolean;
  /** For a code: the column of the code it refines (a land use's subdivision), else null. */
  parent?: string | null;
  /** The yes/no column the question is asked after (the year of a change, after "Any change?"), else null. */
  relevantIf?: string | null;
}

export interface AnalysisTableModel {
  name: string;
  labels: Record<string, string>;
  keyColumn: string | null;
  columns: AnalysisColumnModel[];
}

export interface AnalysisListItem {
  code: string;
  labels: Record<string, string>;
  parent: string | null;
  level: number;
}

export interface AnalysisModelData {
  languages: string[];
  tables: AnalysisTableModel[];
  lists: Record<string, AnalysisListItem[]>;
}

export interface AnalysisTableData {
  name: string;
  /** Each column's name and DuckDB type, in the CSV's order. */
  columns: [string, string][];
  rows: number;
  csv: string;
}

export interface AnalysisData {
  model: AnalysisModelData;
  /** "project": every record (coordinators, reviewers); "own": the person's own, without rounds (collectors). */
  scope: "project" | "own";
  /** Where the areas come from (the project file's region_areas.csv or areas_per_attribute.csv), or null: no areas. */
  areas: { source: string; plots: number; unmatched: number } | null;
  tables: AnalysisTableData[];
}

/** The survey's model and the rows of its tables, for the analysis page (any member). */
export async function getAnalysis(projectId: string): Promise<AnalysisData> {
  return request<AnalysisData>("GET", `${p(projectId)}/analysis`);
}

/** The analysis as one HTML file that opens with no server (fetched with the session, then saved by the page). */
export async function downloadAnalysisStandalone(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/analysis/standalone`);
  return { blob: await response.blob(), filename: attachmentName(response, "analysis.html") };
}

/** What the stand-alone file holds besides the page's data: its project, and when it was made. */
export interface StandaloneAnalysisData extends AnalysisData {
  project: { id: string; name: string };
  /** ISO 8601. */
  made: string;
}

/** A view a coordinator shared with the team (the analysis page). */
export interface SharedAnalysisView {
  name: string;
  table: string;
  language: string;
  config: Record<string, unknown>;
  savedBy: string;
  savedAt: number;
}

export async function getSharedAnalysisViews(projectId: string): Promise<SharedAnalysisView[]> {
  return (await request<{ views: SharedAnalysisView[] }>("GET", `${p(projectId)}/analysis/views`)).views;
}

/** Shares a view with the team (coordinators), replacing one of the same name and table; gives them all. */
export async function shareAnalysisView(projectId: string, view: { name: string; table: string; language: string; config: Record<string, unknown> }): Promise<SharedAnalysisView[]> {
  return (await request<{ views: SharedAnalysisView[] }>("PUT", `${p(projectId)}/analysis/views`, { json: view })).views;
}

/** A filter of a view proposed by the AI assistant, on codes (the server's src/ai/analysisViews.ts). */
export interface ProposedFilter {
  column: string;
  op: "is" | "isNot" | "yes" | "no" | "answered" | "notAnswered" | "atLeast" | "atMost";
  codes?: string[];
  value?: number | string;
}

/** A view of the analysis page proposed by the AI assistant from the survey's structure, by the cube's column ids. */
export interface ProposedView {
  title: string;
  why: string;
  rows: string[];
  columns: string[];
  measures: string[];
  chart: "table" | "bars" | "hbars" | "stacked" | "lines" | "areas" | "heatmap" | "treemap" | "sunburst";
  filters: ProposedFilter[];
  order: "largest" | "smallest" | "name";
}

/**
 * Views proposed by the AI assistant for a table of the analysis (coordinators of a project with the assistant on):
 * the server sends the model the survey's structure only, never the data. Counted against the project's AI limits.
 */
export async function proposeAnalysisViews(projectId: string, table: string, language: string): Promise<ProposedView[]> {
  const body = obj(await request<unknown>("POST", `${p(projectId)}/analysis/proposals`, { json: { table, language } }));
  return Array.isArray(body.views) ? (body.views as ProposedView[]) : [];
}

export async function deleteSharedAnalysisView(projectId: string, name: string, table: string): Promise<SharedAnalysisView[]> {
  return (await request<{ views: SharedAnalysisView[] }>("DELETE", `${p(projectId)}/analysis/views?${new URLSearchParams({ name, table })}`)).views;
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

/** A flag as sent, in a list of none (an unknown kind) or one. */
function toPatternFlags(f: Record<string, unknown>): PatternFlag[] {
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
}

export function toFlagsData(body: unknown): FlagsData {
  const b = obj(body);
  return {
    fastSeconds: toFastSeconds(b.fastSeconds),
    plots: toCount(b.plots),
    counts: toFlagCounts(b.counts),
    people: list(b.people).map((p) => ({ username: text(p.username), counts: toFlagCounts(p.counts), total: toCount(p.total) })),
    total: toCount(b.total),
    flags: list(b.flags).flatMap(toPatternFlags),
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

// --- automatic checks (Task 13) --------------------------------------------------

/** What a sampling rule asks: who may check (null = every collector; reviewers and coordinators only when chosen), the first N plots, X % a week (null = off). */
export interface SamplingCoreRule {
  checkers: string[] | null;
  firstN: number | null;
  percent: number | null;
}

export type SamplingFileRule = { use: "off" } | ({ use: "own" } & SamplingCoreRule);

/** The rule as saved (PUT /sampling): the project's, and the divided files that do not follow it. */
export interface SamplingRuleInput extends SamplingCoreRule {
  files: Record<string, SamplingFileRule>;
}

export interface SamplingDraw {
  at: number;
  /** Who pressed "Draw now"; null for an automatic draw (or one made with a project token). */
  by: string | null;
  automatic: boolean;
  drawn: number;
  firstN: number;
  percent: number;
  noChecker: number;
}

export interface SamplingFile {
  csvFileId: string;
  filename: string;
  use: "project" | "off" | "own";
  own: SamplingCoreRule | null;
  plots: number;
  submitted: number;
  sampledCopies: number;
  divisionCopies: number;
  /** Copies of reference plots (every collector has one of each). */
  referenceCopies: number;
  pending: number;
}

export interface SamplingChecker {
  userId: string;
  username: string;
  role: Role;
  eligible: boolean;
  disabled: boolean;
  open: number;
  done: number;
  sampled: number;
}

export interface SamplingView {
  rule: (SamplingRuleInput & { seed: number }) | null;
  active: boolean;
  intervalMinutes: number;
  due: boolean;
  nextAutomaticAt: number | null;
  lastDraw: SamplingDraw | null;
  /** When a draw last looked for plots to check (an empty one included). */
  lastCheckedAt: number | null;
  pending: { drawn: number; firstN: number; percent: number; noChecker: number };
  files: SamplingFile[];
  wholeFiles: { csvFileId: string; filename: string }[];
  checkers: SamplingChecker[];
  members: { userId: string; username: string; role: Role; disabled: boolean }[];
  noCheckers: boolean;
  /**
   * The reviewers and coordinators the rule (or a file's own rule) chooses as checkers: they can read the
   * first assessments on the dashboard, so their checks may not be blind (warning checkers_not_blind).
   */
  notBlindCheckers: string[];
}

const toLimit = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

function toCoreRule(value: unknown): SamplingCoreRule {
  const r = obj(value);
  return { checkers: Array.isArray(r.checkers) ? strings(r.checkers) : null, firstN: toLimit(r.firstN), percent: toLimit(r.percent) };
}

export function toSamplingView(body: unknown): SamplingView {
  const b = obj(body);
  let rule: SamplingView["rule"] = null;
  if (b.rule && typeof b.rule === "object") {
    const r = obj(b.rule);
    const files: Record<string, SamplingFileRule> = {};
    for (const [id, f] of Object.entries(obj(r.files))) {
      const use = obj(f).use;
      if (use === "off") files[id] = { use: "off" };
      else if (use === "own") files[id] = { use: "own", ...toCoreRule(f) };
    }
    rule = { ...toCoreRule(r), seed: typeof r.seed === "number" ? r.seed : 0, files };
  }
  const draw = b.lastDraw && typeof b.lastDraw === "object" ? obj(b.lastDraw) : null;
  const pending = obj(b.pending);
  const list = (value: unknown) => (Array.isArray(value) ? value.map(obj) : []);
  return {
    rule,
    active: b.active === true,
    intervalMinutes: toCount(b.intervalMinutes) || 10,
    due: b.due === true,
    nextAutomaticAt: toMillis(b.nextAutomaticAt),
    lastDraw: draw
      ? {
          at: toMillis(draw.at) ?? 0,
          by: typeof draw.by === "string" ? draw.by : null,
          automatic: draw.automatic === true,
          drawn: toCount(draw.drawn),
          firstN: toCount(draw.firstN),
          percent: toCount(draw.percent),
          noChecker: toCount(draw.noChecker),
        }
      : null,
    lastCheckedAt: toMillis(b.lastCheckedAt),
    pending: { drawn: toCount(pending.drawn), firstN: toCount(pending.firstN), percent: toCount(pending.percent), noChecker: toCount(pending.noChecker) },
    files: list(b.files).map((f) => ({
      csvFileId: String(f.csvFileId ?? ""),
      filename: String(f.filename ?? ""),
      use: f.use === "off" || f.use === "own" ? f.use : "project",
      own: f.own && typeof f.own === "object" ? toCoreRule(f.own) : null,
      plots: toCount(f.plots),
      submitted: toCount(f.submitted),
      sampledCopies: toCount(f.sampledCopies),
      divisionCopies: toCount(f.divisionCopies),
      referenceCopies: toCount(f.referenceCopies),
      pending: toCount(f.pending),
    })),
    wholeFiles: list(b.wholeFiles).map((f) => ({ csvFileId: String(f.csvFileId ?? ""), filename: String(f.filename ?? "") })),
    checkers: list(b.checkers).map((c) => ({
      userId: String(c.userId ?? ""),
      username: String(c.username ?? ""),
      role: toRole(c.role),
      eligible: c.eligible === true,
      disabled: c.disabled === true,
      open: toCount(c.open),
      done: toCount(c.done),
      sampled: toCount(c.sampled),
    })),
    members: list(b.members).map((m) => ({ userId: String(m.userId ?? ""), username: String(m.username ?? ""), role: toRole(m.role), disabled: m.disabled === true })),
    noCheckers: b.noCheckers === true,
    notBlindCheckers: obj(b.warning).code === "checkers_not_blind" ? strings(obj(b.warning).usernames) : [],
  };
}

export async function getSampling(projectId: string): Promise<SamplingView> {
  return toSamplingView(await request<unknown>("GET", `${p(projectId)}/sampling`));
}

export async function saveSampling(projectId: string, rule: SamplingRuleInput): Promise<SamplingView> {
  return toSamplingView(await request<unknown>("PUT", `${p(projectId)}/sampling`, { json: rule }));
}

/** "Draw now": the draw's counts and the section as it is after it. */
export async function drawSamplingNow(projectId: string): Promise<{ drawn: number; view: SamplingView }> {
  const body = obj(await request<unknown>("POST", `${p(projectId)}/sampling/draw`));
  return { drawn: toCount(obj(body.draw).drawn), view: toSamplingView(body.view) };
}

// --- reference plots (Task 14) ----------------------------------------------------

/** One person's accuracy against the reference: plots where every answer matched, and per question. */
export interface ReferencePerson {
  username: string;
  plots: Rate;
  questions: { key: string; label: string; compared: number; agreeing: number; rate: number | null }[];
}

export interface ReferenceFiguresView {
  /** Reference plots, those whose reference assessment is submitted, and the checks measured. */
  plots: number;
  assessed: number;
  checks: number;
  questions: (Rate & { key: string; label: string; kind: "choice" | "number" })[];
  people: ReferencePerson[];
  computedAt: number | null;
  stale: boolean;
}

export interface ReferencePlotRow {
  csvFileId: string;
  filename: string;
  plot: string;
  assessor: string;
  assessorUserId: string;
  /** The assessor is still a member of the project. */
  assessorInProject: boolean;
  addedAt: number | null;
  /** The reference assessment is submitted. */
  assessed: boolean;
  /** Collectors holding a copy, and of them those who submitted their check. */
  copies: number;
  checked: number;
}

/** What GET /reference answers: the figures; for coordinators also the reference set and what it can be built from. */
export interface ReferenceView {
  coordinator: boolean;
  count: number;
  figures: ReferenceFiguresView | null;
  max: number;
  plots: ReferencePlotRow[];
  files: { csvFileId: string; filename: string; plots: number; reference: number }[];
  wholeFiles: { csvFileId: string; filename: string }[];
  assessors: { userId: string; username: string; role: Role }[];
  collectors: number;
  people: { userId: string; username: string; copies: number; checked: number }[];
}

export function toReferencePerson(value: unknown): ReferencePerson {
  const p = obj(value);
  return {
    username: text(p.username),
    plots: toRate(p.plots),
    questions: list(p.questions).map((q) => ({ key: text(q.key), label: text(q.label) || text(q.key), ...toRate(q) })),
  };
}

export function toReferenceView(body: unknown): ReferenceView {
  const b = obj(body);
  const f = b.figures && typeof b.figures === "object" ? obj(b.figures) : null;
  return {
    coordinator: b.coordinator === true,
    count: toCount(b.count),
    figures: f
      ? {
          plots: toCount(f.plots),
          assessed: toCount(f.assessed),
          checks: toCount(f.checks),
          questions: list(f.questions).map((q) => ({ key: text(q.key), label: text(q.label) || text(q.key), kind: q.kind === "number" ? "number" : "choice", ...toRate(q) })),
          people: list(f.people).map(toReferencePerson),
          computedAt: toMillis(f.computedAt),
          stale: f.stale === true,
        }
      : null,
    max: toCount(b.max) || 500,
    plots: list(b.plots).map((r) => ({
      csvFileId: text(r.csvFileId),
      filename: text(r.filename),
      plot: text(r.plot),
      assessor: text(r.assessor),
      assessorUserId: text(r.assessorUserId),
      assessorInProject: r.assessorInProject !== false,
      addedAt: toMillis(r.addedAt),
      assessed: r.assessed === true,
      copies: toCount(r.copies),
      checked: toCount(r.checked),
    })),
    files: list(b.files).map((x) => ({ csvFileId: text(x.csvFileId), filename: text(x.filename), plots: toCount(x.plots), reference: toCount(x.reference) })),
    wholeFiles: list(b.wholeFiles).map((x) => ({ csvFileId: text(x.csvFileId), filename: text(x.filename) })),
    assessors: list(b.assessors).map((a) => ({ userId: text(a.userId), username: text(a.username), role: toRole(a.role) })),
    collectors: toCount(b.collectors),
    people: list(b.people).map((x) => ({ userId: text(x.userId), username: text(x.username), copies: toCount(x.copies), checked: toCount(x.checked) })),
  };
}

export async function getReference(projectId: string): Promise<ReferenceView> {
  return toReferenceView(await request<unknown>("GET", `${p(projectId)}/reference`));
}

/** Marks plots of a divided file as reference plots: the ids given, or `random` plots nobody has assessed. */
export async function markReference(
  projectId: string,
  body: { csvFileId: string; assessorUserId: string; plots: string[] } | { csvFileId: string; assessorUserId: string; random: number },
): Promise<{ marked: number; view: ReferenceView }> {
  const res = obj(await request<unknown>("POST", `${p(projectId)}/reference/plots`, { json: body }));
  return { marked: toCount(obj(res.result).marked), view: toReferenceView({ ...res, coordinator: true }) };
}

/** No longer reference plots: the copies of those who did not check them go. */
export async function unmarkReference(projectId: string, plots: { csvFileId: string; plot: string }[] | "all"): Promise<{ unmarked: number; view: ReferenceView }> {
  const res = obj(await request<unknown>("POST", `${p(projectId)}/reference/remove`, { json: plots === "all" ? { all: true } : { plots } }));
  return { unmarked: toCount(obj(res.result).unmarked), view: toReferenceView({ ...res, coordinator: true }) };
}

// --- the review queue (Task 7) ----------------------------------------------------

export type QueueSection = "difference" | "flag" | "resubmitted";
/** What the queue can be filtered by: a part, or a kind of flag (as the server's QUEUE_KINDS). */
export const QUEUE_KINDS = ["difference", ...FLAG_KINDS, "resubmitted"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

/** A plot decided "both need another look" that someone submitted again. */
export interface Resubmission {
  operator: string;
  at: number | null;
  decidedAt: number | null;
}

/** One plot of the review queue, with everything known about it. */
export interface QueueItem {
  plot: string;
  section: QueueSection;
  /** Everyone whose record is shown. */
  people: string[];
  /** Its checks that differ from the first assessment, with the answers; `changed`: the records changed since the figures (their answers no longer differ, or one is gone). */
  differences: (Difference & { changed: boolean })[];
  flags: PatternFlag[];
  resubmitted: Resubmission[];
  /** Decided "Both need another look": who it went back to and has not submitted it again yet, still in the project (null for other decisions). */
  waiting: string[] | null;
  /** Those of them no longer in the project or disabled: named apart, waited for by nobody. */
  left: string[];
  decision: QualityDecision | null;
}

export interface ReviewQueueData {
  items: QueueItem[];
  /** The cursor of the next page (null: none after these). */
  next: string | null;
  /** Plots in the queue (with the filters), listed or not. */
  total: number;
  counts: Record<QueueSection, number>;
  /** Everyone named in the queue, for the person filter. */
  people: string[];
  /** Only the newest flags (500) were looked at. */
  flagsCapped: boolean;
  /** A reviewer's own plots left out of the queue (someone else decides them); 0 for a coordinator. */
  excludedOwn: number;
  labels: Record<string, string>;
  options: AnswerOptions;
  computedAt: number | null;
  stale: boolean;
}

export interface QueueFilter {
  person: string | null;
  kind: QueueKind | null;
}

export const NO_QUEUE_FILTER: QueueFilter = { person: null, kind: null };

const QUEUE_SECTIONS: readonly QueueSection[] = ["difference", "flag", "resubmitted"];

function toDifference(value: unknown): Difference {
  const d = obj(value);
  const first = obj(d.first);
  const check = obj(d.check);
  return {
    plot: text(d.plot),
    first: { operator: text(first.operator), recordKey: text(first.recordKey) },
    check: { operator: text(check.operator), recordKey: text(check.recordKey) },
    fields: list(d.fields).map((f) => ({ key: text(f.key), first: text(f.first), check: text(f.check) })),
  };
}

export function toReviewQueue(body: unknown): ReviewQueueData {
  const b = obj(body);
  const counts = obj(b.counts);
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(obj(b.labels))) if (typeof label === "string") labels[key] = label;
  return {
    items: list(b.items).flatMap((i): QueueItem[] => {
      const section = QUEUE_SECTIONS.find((s) => s === i.section);
      if (!section) return [];
      return [
        {
          plot: text(i.plot),
          section,
          people: Array.isArray(i.people) ? i.people.filter((v): v is string => typeof v === "string") : [],
          differences: list(i.differences).map((d) => ({ ...toDifference(d), changed: d.changed === true })),
          flags: list(i.flags).flatMap(toPatternFlags),
          resubmitted: list(i.resubmitted).map((r) => ({ operator: text(r.operator), at: toMillis(r.at), decidedAt: toMillis(r.decidedAt) })),
          waiting: Array.isArray(i.waiting) ? i.waiting.filter((v): v is string => typeof v === "string") : null,
          left: Array.isArray(i.left) ? i.left.filter((v): v is string => typeof v === "string") : [],
          decision: i.decision && typeof i.decision === "object" ? toDecision(i.decision) : null,
        },
      ];
    }),
    next: typeof b.next === "string" && b.next !== "" ? b.next : null,
    total: toCount(b.total),
    counts: { difference: toCount(counts.difference), flag: toCount(counts.flag), resubmitted: toCount(counts.resubmitted) },
    people: strings(b.people),
    flagsCapped: b.flagsCapped === true,
    excludedOwn: toCount(b.excludedOwn),
    labels,
    options: toOptions(b.options),
    computedAt: toMillis(b.computedAt),
    stale: b.stale === true,
  };
}

/** The review queue (coordinators and reviewers), after the cursor `after` (a page's `next`). A 503 "busy" is thrown as ApiError code "busy". */
export async function getReviewQueue(projectId: string, filter: QueueFilter, after: string | null): Promise<ReviewQueueData> {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.kind) query.set("kind", filter.kind);
  if (after) query.set("after", after);
  const q = query.toString();
  return toReviewQueue(await request<unknown>("GET", `${p(projectId)}/quality/queue${q ? `?${q}` : ""}`));
}

export type BulkRule = "first_by_reviewer" | "check_by_reviewer";

export interface BulkResult {
  decision: DecisionKind;
  /** Plots decided (or, in a dry run, that would be). */
  count: number;
  /** The first of them (up to 20). */
  plots: string[];
  /** The run's id, kept with its decisions and in its audit entry (null for a dry run or nothing decided). */
  batch: string | null;
}

/** Bulk decisions (coordinators): `dryRun` only counts the plots the rule would decide. */
export async function bulkDecisions(projectId: string, rule: BulkRule, dryRun: boolean): Promise<BulkResult> {
  const body = obj(await request<unknown>("POST", `${p(projectId)}/quality/decisions:bulk${dryRun ? "?dryRun=1" : ""}`, { json: { rule } }));
  return { decision: toDecision({ decision: body.decision }).decision, count: toCount(body.count), plots: strings(body.plots), batch: typeof body.batch === "string" ? body.batch : null };
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

// --- plot search (Task 8) ---------------------------------------------------------

/** A plot found by its id (GET /plots/search). */
export interface PlotMatch {
  /** The plot unit, as the review queue and the decisions name it. */
  plot: string;
  /** The id the collector sees. */
  name: string;
  /** The plot files holding it. */
  files: { id: string; filename: string }[];
}

export interface PlotSearchResult {
  plots: PlotMatch[];
  /** Other plots match too: typing more narrows them. */
  more: boolean;
}

const toFileRef = (value: unknown): { id: string; filename: string }[] => {
  const f = obj(value);
  return typeof f.id === "string" && f.id !== "" ? [{ id: f.id, filename: text(f.filename) }] : [];
};

const onlyStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

export function toPlotSearch(body: unknown): PlotSearchResult {
  const b = obj(body);
  return {
    plots: list(b.plots).flatMap((m) => (typeof m.plot === "string" && m.plot !== "" ? [{ plot: m.plot, name: text(m.name) || m.plot, files: list(m.files).flatMap(toFileRef) }] : [])),
    more: b.more === true,
  };
}

/** Plots whose id starts with `query` (coordinators and reviewers); nothing is asked for an empty one. */
export async function searchPlots(projectId: string, query: string): Promise<PlotSearchResult> {
  const q = query.trim();
  if (q === "") return { plots: [], more: false };
  return toPlotSearch(await request<unknown>("GET", `${p(projectId)}/plots/search?${new URLSearchParams({ q }).toString()}`));
}

export type Assessment = "main" | "check" | "other";

/** One record of a plot: whose, which round, submitted or not, and its answers. */
export interface PlotRecordView {
  operator: string;
  recordKey: string;
  round: string;
  assessment: Assessment;
  submitted: boolean;
  deleted: boolean;
  modifiedOn: number | null;
  receivedAt: number | null;
  answers: Record<string, string>;
}

/** One plot's page (GET /plots/:plot). */
export interface PlotPageData {
  plot: string;
  name: string;
  /** Each plot file holding it, with who holds it there (main and quality-check copies; null for a reviewer: the files only). */
  files: { id: string; filename: string; divided: boolean; main: string[] | null; copies: string[] | null }[];
  records: PlotRecordView[];
  /** The questions answered, in the survey's order. */
  questions: { key: string; label: string }[];
  labels: Record<string, string>;
  options: AnswerOptions;
  decision: QualityDecision | null;
  /** The reviewer asking made a record of it: someone else decides it. */
  ownPlot: boolean;
  /** A reference plot (its checks are measured against it, never compared as differences); the assessor for coordinators. */
  reference: { assessor: string | null } | null;
  /** From the quality figures at hand; null when there are none (the Quality tab works them out). */
  flags: PatternFlag[] | null;
  differences: (Difference & { changed: boolean })[] | null;
  figures: { computedAt: number | null; stale: boolean } | null;
  place: { lat: number; lon: number; name: string } | null;
  outline: PlotOutline;
  unsupportedSrs: string | null;
}

const ASSESSMENTS: readonly Assessment[] = ["main", "check", "other"];

export function toPlotPage(body: unknown): PlotPageData {
  const b = obj(body);
  const labels: Record<string, string> = {};
  for (const [key, label] of Object.entries(obj(b.labels))) if (typeof label === "string") labels[key] = label;
  const place = obj(b.place);
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  const figures = b.figures && typeof b.figures === "object" ? obj(b.figures) : null;
  return {
    plot: text(b.plot),
    name: text(b.name) || text(b.plot),
    files: list(b.files).flatMap((f) =>
      toFileRef(f).map((ref) => ({ ...ref, divided: f.divided === true, main: Array.isArray(f.main) ? onlyStrings(f.main) : null, copies: Array.isArray(f.copies) ? onlyStrings(f.copies) : null })),
    ),
    records: list(b.records).map((r) => {
      const answers: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj(r.answers))) if (value !== null && value !== undefined) answers[key] = String(value);
      return {
        operator: text(r.operator),
        recordKey: text(r.recordKey),
        round: text(r.round),
        assessment: ASSESSMENTS.find((a) => a === r.assessment) ?? "other",
        submitted: r.submitted === true,
        deleted: r.deleted === true,
        modifiedOn: toMillis(r.modifiedOn),
        receivedAt: toMillis(r.receivedAt),
        answers,
      };
    }),
    questions: list(b.questions).map((q) => ({ key: text(q.key), label: text(q.label) || text(q.key) })),
    labels,
    options: toOptions(b.options),
    decision: b.decision && typeof b.decision === "object" ? toDecision(b.decision) : null,
    ownPlot: b.ownPlot === true,
    reference: b.reference && typeof b.reference === "object" ? { assessor: nullableText(obj(b.reference).assessor) } : null,
    flags: Array.isArray(b.flags) ? list(b.flags).flatMap(toPatternFlags) : null,
    differences: Array.isArray(b.differences) ? list(b.differences).map((d) => ({ ...toDifference(d), changed: d.changed === true })) : null,
    figures: figures ? { computedAt: toMillis(figures.computedAt), stale: figures.stale === true } : null,
    place: b.place && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, name: text(place.name) || text(b.plot) } : null,
    outline: toOutline(b.outline),
    unsupportedSrs: typeof b.unsupportedSrs === "string" && b.unsupportedSrs !== "" ? b.unsupportedSrs : null,
  };
}

/** One plot (coordinators and reviewers); a 404 for a plot in no plot file. */
export async function getPlotPage(projectId: string, plot: string): Promise<PlotPageData> {
  return toPlotPage(await request<unknown>("GET", `${p(projectId)}/plots/${encodeURIComponent(plot)}`));
}

// --- map of progress (Task 9) -------------------------------------------------------

/** A plot's status on the map, in the server's order of status codes. */
export const MAP_STATUSES = ["notStarted", "started", "submitted", "accepted", "recheck", "differs", "resubmitted"] as const;
export type MapStatus = (typeof MAP_STATUSES)[number];

export interface MapFile {
  id: string;
  filename: string;
  /** Its plots, and how many of them have a latitude and longitude. */
  plots: number;
  onMap: number;
}

/** Every plot on the map, in typed arrays (a large project has 100,000 or more). */
export interface MapPlots {
  version: string;
  /** Plots on the map. */
  total: number;
  lat: Float64Array;
  lon: Float64Array;
  /** Index in MAP_STATUSES. */
  status: Uint8Array;
  /** Index in `holders`; -1 for nobody (always for a reviewer). */
  holder: Int32Array;
  plots: string[];
  /** The id the collector sees of each plot (as plot search lists it); null when it is the plot id. */
  names: string[] | null;
  /** Plots per status, those off the map included. */
  counts: Record<MapStatus, number>;
  notOnMap: number;
  files: MapFile[];
  /** Coordinators: everyone holding a plot or who made a first assessment; null for a reviewer. */
  people: string[] | null;
  holders: string[][] | null;
  /** The quality figures the disagreements come from; null when none are at hand. */
  figures: { computedAt: number | null; stale: boolean } | null;
  /** Set when the plots' state is older than the records (newer figures are being worked out). */
  asOf: number | null;
  /** The survey's coordinate system when it is not latitude and longitude: no plot is on the map. */
  unsupportedSrs: string | null;
}

export interface MapFilters {
  file?: string | null;
  person?: string | null;
}

/** Times a map is read again from the start when the server no longer has it between its pages. */
const MAP_RESTARTS = 3;

/** One page of GET /map/plots, added to the map being read (made on the first page). */
export function addMapPage(map: MapPlots | null, body: unknown): MapPlots {
  const b = obj(body);
  // The server's status names, so a code is read by its name whatever their order.
  const names: unknown[] = Array.isArray(b.statuses) ? b.statuses : [...MAP_STATUSES];
  const codeOf = names.map((name) => Math.max(0, MAP_STATUSES.indexOf(name as MapStatus)));
  if (map === null) {
    const total = Math.max(0, Math.floor(Number(b.total) || 0));
    const counts = Object.fromEntries(MAP_STATUSES.map((s) => [s, 0])) as Record<MapStatus, number>;
    (Array.isArray(b.counts) ? b.counts : []).forEach((n: unknown, i: number) => {
      counts[MAP_STATUSES[codeOf[i] ?? 0]] += Number(n) || 0;
    });
    const figures = b.figures && typeof b.figures === "object" ? obj(b.figures) : null;
    map = {
      version: text(b.version),
      total,
      lat: new Float64Array(total),
      lon: new Float64Array(total),
      status: new Uint8Array(total),
      holder: new Int32Array(total).fill(-1),
      plots: new Array<string>(total).fill(""),
      names: Array.isArray(b.names) ? new Array<string>(total).fill("") : null,
      counts,
      notOnMap: Number(b.notOnMap) || 0,
      files: list(b.files).map((f) => ({ id: text(f.id), filename: text(f.filename), plots: Number(f.plots) || 0, onMap: Number(f.onMap) || 0 })),
      people: Array.isArray(b.people) ? onlyStrings(b.people) : null,
      holders: Array.isArray(b.holders) ? b.holders.map((h: unknown) => (Array.isArray(h) ? onlyStrings(h) : [])) : null,
      figures: figures ? { computedAt: toMillis(figures.computedAt), stale: figures.stale === true } : null,
      asOf: toMillis(b.asOf),
      unsupportedSrs: typeof b.unsupportedSrs === "string" && b.unsupportedSrs !== "" ? b.unsupportedSrs : null,
    };
  }
  const offset = Math.max(0, Math.floor(Number(b.offset) || 0));
  const points: unknown[] = Array.isArray(b.points) ? b.points : [];
  const plots: unknown[] = Array.isArray(b.plots) ? b.plots : [];
  const visible: unknown[] | null = Array.isArray(b.names) ? b.names : null;
  const holders = map.holders?.length ?? 0;
  for (let i = 0; i < points.length && offset + i < map.total; i++) {
    const point = Array.isArray(points[i]) ? (points[i] as unknown[]) : [];
    const at = offset + i;
    map.lat[at] = Number(point[0]);
    map.lon[at] = Number(point[1]);
    map.status[at] = codeOf[Number(point[2])] ?? 0;
    const holder = Number(point[3]);
    map.holder[at] = Number.isInteger(holder) && holder >= 0 && holder < holders ? holder : -1;
    map.plots[at] = typeof plots[i] === "string" ? (plots[i] as string) : "";
    if (map.names) map.names[at] = visible && typeof visible[i] === "string" ? (visible[i] as string) : map.plots[at];
  }
  return map;
}

/**
 * Every plot on the map (coordinators and reviewers), read page by page (20,000 a page);
 * `onProgress` says how many are read. The server builds a map on its first page and serves
 * the next ones from that build (`version`), so the pages agree; when it no longer has it
 * (409 map_changed), the map is read again from the start, at most MAP_RESTARTS times, then
 * that error is thrown: a map is never returned in part. `stopped()` true stops reading (the
 * page was left; what was read is returned and must not be shown).
 */
export async function getMapPlots(
  projectId: string,
  filters: MapFilters,
  onProgress?: (loaded: number, total: number) => void,
  stopped: () => boolean = () => false,
): Promise<MapPlots> {
  for (let attempt = 0; ; attempt++) {
    let map: MapPlots | null = null;
    let offset: number | null = 0;
    let changed = false;
    while (offset !== null) {
      const query = new URLSearchParams({ offset: String(offset) });
      if (filters.file) query.set("file", filters.file);
      if (filters.person) query.set("person", filters.person);
      if (map !== null) query.set("version", map.version);
      let body: Record<string, unknown>;
      try {
        body = obj(await request<unknown>("GET", `${p(projectId)}/map/plots?${query.toString()}`));
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "map_changed") || attempt >= MAP_RESTARTS) throw error;
        changed = true;
        break;
      }
      if (map !== null && text(body.version) !== map.version) {
        // A server that does not know versions: a map that changed is read again.
        if (attempt >= MAP_RESTARTS) throw new ApiError(409, "map_changed");
        changed = true;
        break;
      }
      map = addMapPage(map, body);
      const next = Number(body.next);
      offset = body.next === null || body.next === undefined || !Number.isInteger(next) || next <= offset ? null : next;
      onProgress?.(offset ?? map.total, map.total);
      if (stopped()) return map;
    }
    if (!changed) return map!;
  }
}

// --- activity: the log, the weekly summary, the downloads and the bell (coordinators) ----

export type RecordChange = "created" | "updated" | "submitted" | "resubmitted" | "unsubmitted" | "deleted";
const RECORD_CHANGES: readonly RecordChange[] = ["created", "updated", "submitted", "resubmitted", "unsubmitted", "deleted"];

/** What the log can be filtered by (the server's LOG_KINDS). */
export const LOG_KINDS = ["all", "records", "submitted", "resubmitted", "draft", "unsubmitted", "deleted", "coordinators", "decisions", "people", "files", "settings", "downloads"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export type LogItem =
  | {
      type: "record";
      id: string;
      /** When Collect Earth saved it (the collector's clock). */
      at: number;
      receivedAt: number | null;
      person: string;
      change: RecordChange;
      /** The plot's page id, or null for a plot in no plot file. */
      plot: string | null;
      /** The plot as the collector sees it. */
      name: string;
      assessment: "main" | "check" | "other";
      round: string;
    }
  | {
      type: "audit";
      id: string;
      at: number;
      /** Null: a project key, or someone no longer in the project. */
      person: string | null;
      action: string;
      details: Record<string, string | number | boolean | null>;
      plotName: string | null;
    };

export interface ActivityPage {
  items: LogItem[];
  next: string | null;
  /** user id -> their name now (null: the account is gone) and whether they left the project. */
  people: Record<string, { name: string | null; removed: boolean }>;
  /** plot file id -> its name, or null when it is gone. */
  files: Record<string, string | null>;
  /** The people the log can be filtered by. */
  persons: string[];
}

export interface ActivityQuery {
  person?: string | null;
  kind?: LogKind;
  /** ms since 1970: from (included) and to (not included). */
  from?: number | null;
  to?: number | null;
  cursor?: string | null;
  limit?: number;
}

function toDetails(value: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(obj(value))) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

export function toActivityPage(body: unknown): ActivityPage {
  const b = obj(body);
  const items: LogItem[] = [];
  for (const i of list(b.items)) {
    if (i.type === "record") {
      const change = RECORD_CHANGES.includes(i.change as RecordChange) ? (i.change as RecordChange) : "updated";
      const assessment = i.assessment === "check" || i.assessment === "other" ? i.assessment : "main";
      items.push({
        type: "record",
        id: text(i.id),
        at: toMillis(i.at) ?? 0,
        receivedAt: toMillis(i.receivedAt),
        person: text(i.person),
        change,
        plot: typeof i.plot === "string" ? i.plot : null,
        name: text(i.name),
        assessment,
        round: text(i.round),
      });
    } else if (i.type === "audit") {
      items.push({
        type: "audit",
        id: text(i.id),
        at: toMillis(i.at) ?? 0,
        person: typeof i.person === "string" ? i.person : null,
        action: text(i.action),
        details: toDetails(i.details),
        plotName: typeof i.plotName === "string" ? i.plotName : null,
      });
    }
  }
  const people: ActivityPage["people"] = {};
  for (const [id, v] of Object.entries(obj(b.people))) {
    const r = obj(v);
    people[id] = { name: typeof r.name === "string" ? r.name : null, removed: r.removed === true };
  }
  const files: ActivityPage["files"] = {};
  for (const [id, v] of Object.entries(obj(b.files))) files[id] = typeof v === "string" ? v : null;
  return { items, next: typeof b.next === "string" && b.next ? b.next : null, people, files, persons: strings(b.persons) };
}

/** One page of the activity log (coordinators). */
export async function getActivity(projectId: string, q: ActivityQuery = {}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (q.person) query.set("person", q.person);
  if (q.kind && q.kind !== "all") query.set("kind", q.kind);
  if (q.from != null) query.set("from", String(Math.round(q.from)));
  if (q.to != null) query.set("to", String(Math.round(q.to)));
  if (q.cursor) query.set("cursor", q.cursor);
  if (q.limit) query.set("limit", String(q.limit));
  const qs = query.toString();
  return toActivityPage(await request<unknown>("GET", `${p(projectId)}/activity${qs ? `?${qs}` : ""}`));
}

export interface WeeklyPerson {
  userId: string;
  username: string;
  role: Role;
  submitted: number;
  checks: number;
  status: PersonStatus;
  plots: PersonRow["plots"];
}

export interface WeeklyData {
  week: string;
  timeZone: string;
  start: string;
  end: string;
  current: boolean;
  asOf: number | null;
  progress: {
    days: { date: string; submitted: number; checks: number }[];
    submitted: number;
    checks: number;
    /** Collectors' records of reference plots submitted that week: measurements, counted apart from the checks. */
    referenceMeasurements: number;
    before: number;
    byEnd: number;
    totals: ProgressTotals;
  };
  people: WeeklyPerson[];
  quality: {
    available: boolean;
    computedAt: number | null;
    stale: boolean;
    week: Rate | null;
    overall: Rate | null;
    decided: { first: number; check: number; recheck: number; total: number };
    flags: { counts: Record<string, number>; total: number } | null;
  };
}

export function toWeeklyData(body: unknown): WeeklyData {
  const b = obj(body);
  const pr = obj(b.progress);
  const t = obj(pr.totals);
  const q = obj(b.quality);
  const d = obj(q.decided);
  const flags = q.flags && typeof q.flags === "object" ? obj(q.flags) : null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(flags?.counts))) counts[k] = toCount(v);
  return {
    week: text(b.week),
    timeZone: typeof b.timeZone === "string" ? b.timeZone : "UTC",
    start: toDate(b.start) ?? "",
    end: toDate(b.end) ?? "",
    current: b.current === true,
    asOf: toMillis(b.asOf),
    progress: {
      days: list(pr.days)
        .filter((x) => toDate(x.date) !== null)
        .map((x) => ({ date: String(x.date), submitted: toCount(x.submitted), checks: toCount(x.checks) })),
      submitted: toCount(pr.submitted),
      checks: toCount(pr.checks),
      referenceMeasurements: toCount(pr.referenceMeasurements),
      before: toCount(pr.before),
      byEnd: toCount(pr.byEnd),
      totals: {
        plots: toCount(t.plots),
        assigned: toCount(t.assigned),
        notAssigned: toCount(t.notAssigned),
        submitted: toCount(t.submitted),
        started: toCount(t.started),
        notStarted: toCount(t.notStarted),
      },
    },
    people: list(b.people).map((x) => {
      const row = toPersonRow({ ...x, submittedLast7: 0 });
      return { userId: row.userId, username: row.username, role: row.role, submitted: toCount(x.submitted), checks: toCount(x.checks), status: row.status, plots: row.plots };
    }),
    quality: {
      available: q.available === true,
      computedAt: toMillis(q.computedAt),
      stale: q.stale === true,
      week: q.week ? toRate(q.week) : null,
      overall: q.overall ? toRate(q.overall) : null,
      decided: { first: toCount(d.first), check: toCount(d.check), recheck: toCount(d.recheck), total: toCount(d.total) },
      flags: flags ? { counts, total: toCount(flags.total) } : null,
    },
  };
}

/** One ISO week's summary (null: the viewer's current week), its days in the browser's time zone. */
export async function getWeekly(projectId: string, week: string | null, timeZone: string): Promise<WeeklyData> {
  const query = new URLSearchParams({ tz: timeZone });
  if (week) query.set("week", week);
  return toWeeklyData(await request<unknown>("GET", `${p(projectId)}/weekly?${query}`));
}

export type ExportKind = "people" | "daily" | "decisions" | "differences";

export interface DailyRow {
  date: string;
  person: string;
  plots: number;
  checks: number;
  submittedAgain: number;
  drafts: number;
  reopened: number;
  deleted: number;
}

export interface DecisionRow {
  plot: string;
  name: string;
  decision: DecisionKind;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: number;
  /** Null when the figures were not at hand to tell. */
  byAssessor: boolean | null;
  bulk: boolean;
}

export interface DifferenceRow {
  plot: string;
  name: string;
  first: string;
  check: string;
  latest: boolean;
  decision: DecisionKind | null;
  /** Null for a pair changed or gone since the figures. */
  key: string | null;
  firstAnswer: string | null;
  checkAnswer: string | null;
  /** differs; changed: its answers no longer differ; gone: one of its records was deleted (both since the figures). */
  status: "differs" | "changed" | "gone";
}

export type ExportData =
  | { kind: "people"; today: string; rows: PersonRow[] }
  | { kind: "daily"; today: string; rows: DailyRow[] }
  | { kind: "decisions"; today: string; rows: DecisionRow[] }
  | { kind: "differences"; today: string; rows: DifferenceRow[]; labels: Record<string, string>; options: AnswerOptions; numbers: string[] };

const asDecision = (v: unknown): DecisionKind | null => (v === "first" || v === "check" || v === "recheck" ? v : null);

export function toExportData(kind: ExportKind, body: unknown): ExportData {
  const b = obj(body);
  const today = toDate(b.today) ?? new Date().toISOString().slice(0, 10);
  const rows = list(b.rows);
  switch (kind) {
    case "people":
      return { kind, today, rows: rows.map(toPersonRow) };
    case "daily":
      return {
        kind,
        today,
        rows: rows.map((r) => ({
          date: text(r.date),
          person: text(r.person),
          plots: toCount(r.plots),
          checks: toCount(r.checks),
          submittedAgain: toCount(r.submittedAgain),
          drafts: toCount(r.drafts),
          reopened: toCount(r.reopened),
          deleted: toCount(r.deleted),
        })),
      };
    case "decisions":
      return {
        kind,
        today,
        rows: rows.map((r) => ({
          plot: text(r.plot),
          name: text(r.name),
          decision: asDecision(r.decision) ?? "recheck",
          comment: typeof r.comment === "string" ? r.comment : null,
          decidedBy: typeof r.decidedBy === "string" ? r.decidedBy : null,
          decidedAt: toMillis(r.decidedAt) ?? 0,
          byAssessor: typeof r.byAssessor === "boolean" ? r.byAssessor : null,
          bulk: r.bulk === true,
        })),
      };
    case "differences": {
      const labels: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj(b.labels))) labels[k] = text(v);
      return {
        kind,
        today,
        labels,
        options: toOptions(b.options),
        numbers: strings(b.numbers),
        rows: rows.map((r) => ({
          plot: text(r.plot),
          name: text(r.name),
          first: text(r.first),
          check: text(r.check),
          latest: r.latest === true,
          decision: asDecision(r.decision),
          key: typeof r.key === "string" ? r.key : null,
          firstAnswer: typeof r.firstAnswer === "string" ? r.firstAnswer : null,
          checkAnswer: typeof r.checkAnswer === "string" ? r.checkAnswer : null,
          status: r.status === "changed" || r.status === "gone" ? r.status : "differs",
        })),
      };
    }
  }
}

/** The rows of a download (the server notes who downloaded what). */
export async function getExport(projectId: string, kind: ExportKind, timeZone: string): Promise<ExportData> {
  const query = new URLSearchParams({ tz: timeZone });
  return toExportData(kind, await request<unknown>("GET", `${p(projectId)}/exports/${kind}?${query}`));
}

export interface BellItem {
  key: string;
  read: boolean;
  item: AttentionItem;
}

export interface BellData {
  items: BellItem[];
  unread: number;
}

export function toBellData(body: unknown): BellData {
  const b = obj(body);
  const items = list(b.items)
    .filter((x) => ATTENTION_KINDS.includes(obj(x.item).kind as AttentionKind))
    .map((x) => ({ key: text(x.key), read: x.read === true, item: toAttentionItem(obj(x.item)) }));
  return { items, unread: items.filter((x) => !x.read).length };
}

/** The bell's "needs attention" items, with what this coordinator has read. */
export async function getAttention(projectId: string): Promise<BellData> {
  return toBellData(await request<unknown>("GET", `${p(projectId)}/attention`));
}

/** Marks items read (by key), or all of them. */
export async function markAttentionRead(projectId: string, keys: string[] | "all"): Promise<BellData> {
  return toBellData(await request<unknown>("POST", `${p(projectId)}/attention/read`, { json: keys === "all" ? { all: true } : { keys } }));
}

// --- Training: calibration and learning plots -----------------------------------------

export type TrainingKind = "calibration" | "learning";

/** Agreement as counts and their share (null with nothing compared). */
export interface TrainingShare {
  compared: number;
  agreeing: number;
  rate: number | null;
}

export interface TrainingPerson {
  userId: string;
  username: string;
  role: Role;
}

export interface TrainingSetSummary {
  id: string;
  kind: TrainingKind;
  name: string;
  filename: string;
  /** The file's name in Collect Earth ("Learning – plots.csv"). */
  servedName: string;
  plotCount: number;
  passMark: number | null;
  createdAt: number;
  participants: TrainingPerson[];
}

export interface TrainingListItem extends TrainingSetSummary {
  /** Plots with a golden interpretation. */
  golden: number;
  progress: { userId: string; attempt: number; submitted: number; accuracy: number | null; passed: boolean | null }[];
}

export interface TrainingList {
  sets: TrainingListItem[];
  members: TrainingPerson[];
  max: number;
}

export interface TrainingAnswerCount {
  value: string;
  count: number;
  people: string[];
}

export interface CalibrationCell {
  key: string;
  answers: TrainingAnswerCount[];
  pairs: TrainingShare;
  consensus: string | null;
}

export interface CalibrationFigures {
  participants: string[];
  plots: { plot: string; people: string[]; questions: CalibrationCell[] }[];
  questions: { key: string; label: string; kind: "choice" | "number"; pairs: TrainingShare; kappa: number | null }[];
  people: { username: string; plots: number; withConsensus: TrainingShare; byQuestion: Record<string, TrainingShare> }[];
  overall: TrainingShare;
}

export interface TrainingGolden {
  plotKey: string;
  answers: Record<string, string>;
  note: string | null;
  updatedAt: number;
  updatedBy: string | null;
}

export interface TrainingQuestion {
  key: string;
  label: string;
  kind: "choice" | "number";
  options: { code: string; label: string }[] | null;
  multiple: boolean;
}

export interface ScoredPlot {
  plot: string;
  submittedAt: number;
  answers: TrainingShare;
  right: boolean;
  questions: { key: string; label: string; golden: string; given: string; right: boolean }[];
  /** The coordinator's explanation (My work only). */
  note?: string | null;
}

export interface LearningScore {
  plots: number;
  submitted: number;
  answers: TrainingShare;
  plotsRight: number;
  byQuestion: Record<string, TrainingShare>;
  passed: boolean | null;
  byPlot: ScoredPlot[];
}

export interface TrainingAttemptPast {
  number: number;
  startedAt: number;
  closedAt: number | null;
  plots: number;
  submitted: number;
  answers: TrainingShare;
  plotsRight: number;
  passed: boolean | null;
}

export interface TrainingSetView {
  set: TrainingSetSummary;
  plots: string[];
  calibration: CalibrationFigures;
  golden: TrainingGolden[];
  questions: TrainingQuestion[];
  /** Golden answers' questions the survey no longer has (not scored). */
  staleQuestions?: string[];
  scores: { userId: string; username: string; attempt: { number: number; startedAt: number }; score: LearningScore; history: TrainingAttemptPast[] }[];
}

export interface MyTrainingSet {
  id: string;
  kind: TrainingKind;
  name: string;
  servedName: string;
  plotCount: number;
  passMark: number | null;
  attempt: { number: number; startedAt: number };
  submitted: number;
  /** Learning sets only. */
  score?: LearningScore;
  history?: TrainingAttemptPast[];
}

export async function getTraining(projectId: string): Promise<TrainingList> {
  return request<TrainingList>("GET", `${p(projectId)}/training`);
}

/** A new set from a CSV file. */
export function createTrainingSet(
  projectId: string,
  file: File,
  options: { kind: TrainingKind; name: string; passMark: number | null },
  onProgress?: Progress,
): Promise<TrainingSetSummary> {
  const q = new URLSearchParams({ kind: options.kind, name: options.name });
  if (options.passMark !== null) q.set("passMark", String(options.passMark));
  return upload<TrainingSetSummary>("PUT", `${p(projectId)}/training-sets/${encodeURIComponent(file.name)}?${q}`, file, "text/csv", onProgress);
}

export async function updateTrainingSet(projectId: string, setId: string, change: { name?: string; kind?: TrainingKind; passMark?: number | null }): Promise<TrainingSetSummary> {
  return request<TrainingSetSummary>("PATCH", `${p(projectId)}/training/${encodeURIComponent(setId)}`, { json: change });
}

export async function deleteTrainingSet(projectId: string, setId: string): Promise<void> {
  await request<unknown>("DELETE", `${p(projectId)}/training/${encodeURIComponent(setId)}`);
}

export async function setTrainingMembers(projectId: string, setId: string, userIds: string[]): Promise<void> {
  await request<unknown>("PUT", `${p(projectId)}/training/${encodeURIComponent(setId)}/members`, { json: { userIds } });
}

export async function getTrainingSet(projectId: string, setId: string): Promise<TrainingSetView> {
  return request<TrainingSetView>("GET", `${p(projectId)}/training/${encodeURIComponent(setId)}`);
}

export async function putTrainingGolden(projectId: string, setId: string, plot: string, answers: Record<string, string>, note: string | null): Promise<TrainingGolden> {
  return request<TrainingGolden>("PUT", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden/${encodeURIComponent(plot)}`, { json: { answers, note } });
}

/** Golden answers for every plot: the calibration's agreed answers, or one person's records. */
export async function goldenFrom(projectId: string, setId: string, from: { from: "consensus" } | { from: "person"; userId: string }): Promise<number> {
  const res = await request<{ plots?: number }>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden`, { json: from });
  return typeof res.plots === "number" ? res.plots : 0;
}

/** A training set's results as CSV: each person's attempts, or every answer scored. */
export async function downloadTrainingExport(projectId: string, setId: string, what: "scores" | "answers"): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/training/${encodeURIComponent(setId)}/export?what=${what}`);
  return { blob: await response.blob(), filename: attachmentName(response, `training-${what}.csv`) };
}

/** Takes the questions the survey no longer has out of every golden answer of a set. */
export async function pruneTrainingGolden(projectId: string, setId: string): Promise<number> {
  const res = await request<{ plots?: number }>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden/prune`);
  return typeof res.plots === "number" ? res.plots : 0;
}

export async function startTrainingAttempts(projectId: string, setId: string, who: { userIds: string[] } | { all: true }): Promise<number> {
  const res = await request<{ started?: number }>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/attempts`, { json: who });
  return typeof res.started === "number" ? res.started : 0;
}

export async function getMyTraining(projectId: string): Promise<MyTrainingSet[]> {
  const res = await request<{ sets?: MyTrainingSet[] }>("GET", `${p(projectId)}/training/mine`);
  return Array.isArray(res.sets) ? res.sets : [];
}

/** Calibration figures without anyone's name (reviewers). */
export interface AnonymousCalibration {
  participants: number;
  plots: { plot: string; people: number; questions: { key: string; answers: { value: string; count: number }[]; pairs: TrainingShare; consensus: string | null }[] }[];
  questions: CalibrationFigures["questions"];
  overall: TrainingShare;
}

export interface TrainingFiguresSet {
  id: string;
  kind: TrainingKind;
  name: string;
  plotCount: number;
  /** The caller takes part and has not submitted every plot yet: no figures. */
  takingPart?: { submitted: number };
  calibration?: AnonymousCalibration;
}

export async function getTrainingFigures(projectId: string): Promise<{ sets: TrainingFiguresSet[]; questions: TrainingQuestion[] }> {
  const res = await request<{ sets?: TrainingFiguresSet[]; questions?: TrainingQuestion[] }>("GET", `${p(projectId)}/training/figures`);
  return { sets: Array.isArray(res.sets) ? res.sets : [], questions: Array.isArray(res.questions) ? res.questions : [] };
}
