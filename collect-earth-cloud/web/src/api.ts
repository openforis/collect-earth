import { unzipSync } from "fflate";
import type { MessageKey } from "./i18n";
import { getToken } from "./storage";
import type { BackupFormat, BackupLinkAnswer, BackupRounds, BackupSummary, ExportChoices } from "../../src/wire/data";
import type {
  Assignment,
  AssignmentDetail,
  AssignmentsAnswer,
  CsvColumns,
  CsvFilesAnswer,
  CsvUploadAnswer,
  DesignArea,
  DesignFacts,
  DesignPlan,
  DistributionSummary,
  DivisionBody,
  ListedCsvFile,
  MoveUnfinishedAnswer,
  PlotColumn,
  PlotDesign,
  RebalanceAnswer,
  ReplaceImpact,
  SigridCountries,
  SigridFacts,
} from "../../src/wire/plotFiles";
import type {
  AccountDeletion,
  AnonymizedAnswer,
  DigestKind,
  FormerMember,
  FormerMembersAnswer,
  InvitesAnswer,
  JoinPreview,
  LoginAnswer,
  MapTiles,
  Me,
  Membership,
  NewInvite,
  Notifications,
  OpenInvite,
  RecoveryCodes,
  ServerInfo,
  Session,
  SignupAnswer,
  TwoFactorSetup,
  UnsubscribeAnswer,
} from "../../src/wire/account";
import type { BellAnswer, ProgressAnswer, ProgressSettings, PublicProgress } from "../../src/wire/progress";
import type {
  NewShareLinkAnswer,
  ProjectAi,
  ProjectCopyAnswer,
  ProjectStatus,
  ProjectStatusAnswer,
  ShareLink,
  ShareLinksAnswer,
} from "../../src/wire/projectSettings";
import type {
  BackupImportAnswer,
  BackupImportPreview,
  CeoFetchAnswer,
  CeoImportAnswer,
  CeoImportPreview,
  CepUploadAnswer,
  CollectImportPreview,
  CollectImportResult,
  ImageryAnswer,
  Member,
  MembersAnswer,
  NewProjectAnswer,
  Overview,
  PeriodHeaderAnswer,
  Periods,
  PlotLayout,
  PlotLayoutAnswer,
  PlotLayoutChangeAnswer,
  PlotPeriodsAnswer,
  ProjectInfo,
  ProjectListAnswer,
  PropertiesValues,
  RepeatAnswer,
  RepeatAreaAnswer,
  RepeatChange,
  RepeatPreview,
  RoundAnswer,
  RoundInfo,
} from "../../src/wire/projects";
import type {
  HealthReason,
  ReferenceAnswer,
  ReferenceAnswersReport,
  ReferenceChangeAnswer,
  ReferenceMarkBody,
  ReferencePerson,
  SamplingDrawAnswer,
  SamplingRuleInput,
  SamplingView,
  SurveyHealthAnswer,
} from "../../src/wire/checks";
import type { BulkDecisionAnswer, BulkRule, PlotPageAnswer, PlotSearchAnswer, ReviewQueueAnswer, ReviewQueueItem } from "../../src/wire/review";
import type { MapFile, MapPage, MapStatus } from "../../src/wire/map";
import type {
  AnswerColumnsAnswer,
  AnswersAnswer,
  DecisionKind,
  FlagCounts,
  FlagKind,
  FlagsAnswer,
  Flag as PatternFlag,
  GuidanceNote,
  GuidanceNoteInput,
  PlotPlaces,
  PublicDecision as QualityDecision,
  QualityAnswer,
  QualitySettingsAnswer,
} from "../../src/wire/quality";
import type { AiRunAnswer, AiRunListed, AiRunsAnswer, AiRunStartBody, AiRunStarted, AiStart, AiUsageAnswer } from "../../src/wire/ai";
import type { MyQualityAnswer, TeamReportAnswer } from "../../src/wire/reports";
import type {
  AccountAnswer,
  AccountDeletedAnswer,
  AccountFilter,
  AccountPage,
  AccountQuery,
  AccountSort,
  AlertsMarkedAnswer,
  CollectEarthVersions,
  MadeAccount,
  MadeAccountsAnswer,
  MailCheck,
  MessagePreview,
  MessageSentAnswer,
  OwnerAlertsPage,
  ProjectArchivedAnswer,
  ProjectFilter,
  ProjectHandedAnswer,
  ProjectPage,
  ProjectQuery,
  ProjectSort,
  ResetLinkAnswer,
  ServerActionKind,
  ServerActivityPage,
  ServerMessage,
  ServerOverview,
  SettingsChange,
  ShownSettings,
  TestMailAnswer,
  UnlockAnswer,
  UserSummary,
  WebhookTestAnswer,
} from "../../src/wire/serverAdmin";
import type { PeopleAnswer, PersonAnswer, TimeSpent } from "../../src/wire/people";
import type { ActivityPage, ExportAnswer, ExportKind, WeeklyAnswer } from "../../src/wire/activity";
import type {
  AnalysisAnswer,
  AreaSettings,
  AreaSettingsAnswer,
  AreasAnswer,
  IpccCategory,
  IpccExports,
  ListItem,
  ProposedView,
  ProposedViewsAnswer,
  SharedAnalysisView,
  SharedAnalysisViewInput,
  SharedAnalysisViewsAnswer,
  UncertaintyAnswer,
  UncertaintySettings,
  UncertaintySettingsAnswer,
  UncertaintySetup,
} from "../../src/wire/analysis";
import type {
  AttemptsAnswer,
  GoldenFromAnswer,
  GoldenPruneAnswer,
  MyTrainingAnswer,
  MyTrainingSet,
  TrainingFiguresAnswer,
  TrainingGolden,
  TrainingKind,
  TrainingList,
  TrainingSetSummary,
  TrainingSetView,
} from "../../src/wire/training";

// Every call the dashboard makes to the Collect Earth Cloud server, in one place.
//
// The dashboard is built and shipped with the server, so it never talks to another version of it.
// Where the answer's type is in the server's src/wire/ folder, it is imported from there and the
// answer is used as it comes: a field the server renames fails the typecheck. The other areas
// still have their own copy of the types and a clean-up function per answer (to be moved to
// src/wire/ one area at a time; see its README.md).

export type Role = "admin" | "reviewer" | "operator";
export const ROLES: Role[] = ["operator", "reviewer", "admin"];
export type { ProjectCreation } from "../../src/wire/account";
export type { ProjectStatus } from "../../src/wire/projectSettings";
/** A project's lifecycle (the server's STATUS_MOVES): draft -> active -> closed (-> archived), closed -> active again. */
export const STATUS_MOVES: Record<ProjectStatus, readonly ProjectStatus[]> = { draft: ["active"], active: ["closed"], closed: ["active", "archived"], archived: ["closed"] };

export type { Announcement, DashboardTelemetry, MapTiles, Me, Membership, ServerInfo, Session } from "../../src/wire/account";

/** Tells the server of a use of the dashboard it cannot see (it forwards it to Google Analytics, when it does). */
export function sendUsageEvent(projectId: string, name: "training_report_opened" | "training_report_printed", params: Record<string, string | number> = {}): void {
  request<unknown>("POST", `${p(projectId)}/telemetry`, { json: { name, params } }).catch(() => undefined);
}

/** OpenStreetMap's tiles (the server's default base map). */
export const OSM_TILES: MapTiles = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
  maxZoom: 19,
};

export type { CepInfo, OperatorProgress, Overview, ProjectInfo } from "../../src/wire/projects";

/** An open invite as the People tab reads it (GET /people; the invites' own list is the server's OpenInvite). */
export interface Invite {
  id: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number | null;
}

export type { JoinPreview, NewInvite, OpenInvite } from "../../src/wire/account";

export type { Member } from "../../src/wire/projects";
export type {
  Assignment,
  AssignmentDetail,
  CsvColumns,
  CsvFile,
  CsvFileWarnings,
  DistributionSummary,
  DivisionBody,
  DivisionOrder,
  ListedCsvFile,
  NearbyAvailability,
  PersonShare,
  PlotColumn,
  StoredDistribution,
} from "../../src/wire/plotFiles";

/** Agreement over some checks; rate (0..1) is null when there are too few checks to judge. */
export interface Rate {
  compared: number;
  agreeing: number;
  rate: number | null;
}

export type { AccountDeletion, ProjectRef } from "../../src/wire/account";
export type { ResetLinkAnswer as ResetLink, SettingsChange, ShownSettings as ServerSettings, UserSummary as AdminUser } from "../../src/wire/serverAdmin";

export type { CodeItem, NoteInfo, RoundInfo, RoundState } from "../../src/wire/projects";

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
  account_locked: "error.accountLocked",
  email_not_confirmed: "error.emailNotConfirmed",
  email_domain_not_allowed: "error.emailDomainNotAllowed",
  webhook_not_allowed: "error.webhookNotAllowed",
  webhook_refused: "error.webhookRefused",
  message_too_soon: "error.messageTooSoon",
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
  sigrid_unreachable: "sigrid.unreachable",
  ceo_unreachable: "ceoImport.unreachable",
  ceo_not_found: "ceoImport.notFound",
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day (YYYY-MM-DD), or null. */
const toDate = (value: unknown): string | null => (typeof value === "string" && DATE_RE.test(value) ? value : null);

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

/** A server without statuses (older) has active projects only. */
export function asStatus(value: unknown): ProjectStatus {
  return value === "draft" || value === "closed" || value === "archived" ? value : "active";
}

const p = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}`;

void [toDate]; // merge: drop when unused

// --- server & account --------------------------------------------------------------

export async function getServerInfo(): Promise<ServerInfo> {
  const info = await request<ServerInfo>("GET", "/v1/server-info", { noSessionEnd: true });
  // The terms link goes in an href: an http(s) address only.
  return { ...info, termsUrl: safeUrl(info.termsUrl) };
}

export function setup(setupCode: string, username: string, password: string): Promise<Session> {
  return request<Session>("POST", "/v1/setup", { json: { setupCode, username, password }, noSessionEnd: true });
}

/** Logs in; with two-step sign-in, the server first answers second_step_required, then takes the code with the password. */
export function login(username: string, password: string, code?: string): Promise<LoginAnswer> {
  return request<LoginAnswer>("POST", "/v1/auth/login", { json: code ? { username, password, code } : { username, password }, noSessionEnd: true });
}

/** Creates an account; null when the server signs it in only once the mailed link is opened (sign-up limited to some domains). */
export async function signup(username: string, password: string, email?: string, acceptTerms?: boolean, language?: string): Promise<Session | null> {
  const json: Record<string, string | boolean> = { username, password };
  if (email) json.email = email;
  // the confirmation mail of the address is written in the page's language
  if (email && language) json.language = language;
  if (acceptTerms) json.acceptTerms = true;
  const answer = await request<SignupAnswer>("POST", "/v1/auth/signup", { json, noSessionEnd: true });
  return "token" in answer ? answer : null;
}

export async function logout(): Promise<void> {
  await send("POST", "/v1/auth/logout", { noSessionEnd: true });
}

/** Ends every other session of the account; this one stays. */
export async function logoutOthers(): Promise<void> {
  await send("POST", "/v1/auth/logout-others");
}

export function getMe(): Promise<Me> {
  return request<Me>("GET", "/v1/me");
}

// --- the owner's alerts (the server's src/ownerAlerts.ts) ---------------------------------------

export type { OwnerAlertKind, OwnerAlertsPage, StoredOwnerAlert as OwnerAlert } from "../../src/wire/serverAdmin";

/** The alerts kept (newest first, in pages), how many are not seen, the thresholds and the webhook. */
export function getOwnerAlerts(page = 1): Promise<OwnerAlertsPage> {
  return request<OwnerAlertsPage>("GET", `/v1/admin/alerts?page=${page}&pageSize=10`);
}

/** Marks alerts seen (none given: every one not seen). */
export const markAlertsSeen = (ids?: string[]) => request<AlertsMarkedAnswer>("POST", "/v1/admin/alerts/seen", { json: ids ? { ids } : {} });

/** A test post to a webhook (the address typed, or the one saved). */
export const testAlertWebhook = (url?: string) => request<WebhookTestAnswer>("POST", "/v1/admin/alerts/webhook-test", { json: url ? { url } : {} });

// --- former members (the server's src/routes/formerMembers.ts) -----------------------------------

export type { FormerMember } from "../../src/wire/account";

export async function getFormerMembers(projectId: string): Promise<FormerMember[]> {
  return (await request<FormerMembersAnswer>("GET", `${p(projectId)}/former-members`)).formerMembers;
}

/** Renames a former member on everything they collected; gives the pseudonym and how many records. Cannot be undone. */
export function anonymizeFormerMember(projectId: string, operator: string): Promise<AnonymizedAnswer> {
  return request<AnonymizedAnswer>("POST", `${p(projectId)}/former-members/anonymize`, { json: { operator } });
}

// --- two-step sign-in (the server's src/routes/twoFactor.ts) ------------------------------------

/** A new secret to put in an authenticator app: as text, and as the address its QR code holds. */
export function startTwoFactor(): Promise<TwoFactorSetup> {
  return request<TwoFactorSetup>("POST", "/v1/me/two-factor/setup", { json: {} });
}

/** Turns two-step sign-in on with the account password and the app's first code; gives the recovery codes, shown once. */
export async function enableTwoFactor(code: string, password: string): Promise<string[]> {
  return (await request<RecoveryCodes>("POST", "/v1/me/two-factor/enable", { json: { code, password } })).recoveryCodes;
}

export async function disableTwoFactor(password: string): Promise<void> {
  await send("POST", "/v1/me/two-factor/disable", { json: { password } });
}

export async function newRecoveryCodes(password: string): Promise<string[]> {
  return (await request<RecoveryCodes>("POST", "/v1/me/two-factor/recovery-codes", { json: { password } })).recoveryCodes;
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

export function getAccountDeletion(): Promise<AccountDeletion> {
  return request<AccountDeletion>("GET", "/v1/me/deletion");
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

export type { DigestKind, DigestView, Notifications } from "../../src/wire/account";

export function getNotifications(): Promise<Notifications> {
  return request<Notifications>("GET", "/v1/me/notifications");
}

/** Turns digests on or off, in the language and time zone given (the dashboard's); no zone keeps the stored one. */
export function setNotifications(change: Partial<Record<DigestKind, boolean>> & { language: string; timeZone?: string | null }): Promise<Notifications> {
  const { timeZone, ...rest } = change;
  return request<Notifications>("PUT", "/v1/me/notifications", { json: timeZone ? { ...rest, timeZone } : rest });
}

/**
 * Gives the account an email (null removes it); a new one gets a mail with a link to confirm it. A change asks
 * for the account's current password: a 401 is then a wrong password (wrong_password), not a session ended.
 */
export async function setEmail(email: string | null, language: string, currentPassword: string): Promise<Notifications> {
  try {
    return await request<Notifications>("PUT", "/v1/me/email", { json: { email, language, currentPassword }, noSessionEnd: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw new ApiError(401, "wrong_password", error.reason);
    throw error;
  }
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
  return (await request<UnsubscribeAnswer>("POST", `/v1/unsubscribe/${encodeURIComponent(token)}`, { json: {}, anonymous: true, noSessionEnd: true })).kind;
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
  return (await request<ProjectListAnswer>("GET", "/v1/projects")).projects;
}

export function createProject(name: string): Promise<NewProjectAnswer> {
  return request("POST", "/v1/projects", { json: { name } });
}

export type { CeoImportAnswer, CeoImportPreview, CeoImportSummary, CeoReportEntry, ImportedPlotFile } from "../../src/wire/projects";

/** CEO's files, as saved: the project (required), its plot list, its sample data (CSV); null when not given. */
export interface CeoFiles {
  project: string;
  plots: string | null;
  answers: string | null;
  /** the questions asked per sample point, a table with a row per point (Part E); per plot otherwise */
  perPoint?: boolean;
}

const ceoBody = (files: CeoFiles) => ({
  ceoProject: files.project,
  ...(files.plots !== null ? { ceoPlots: files.plots } : {}),
  ...(files.answers !== null ? { ceoAnswers: files.answers } : {}),
  ...(files.perPoint ? { perPoint: true } : {}),
});

/** A CEO project and its plot list, as text, read by the server from Collect Earth Online by the project's number. */
export function fetchCeoProject(ceoProjectId: string): Promise<CeoFetchAnswer> {
  return request("POST", "/v1/projects/from-ceo/fetch", { json: { ceoProjectId } });
}

/**
 * What a project saved from Collect Earth Online (its get-project-by-id file, as text) would become, with its plots
 * when CEO's plot list (get-project-plots) is given, and its answers with CEO's sample data; nothing is stored.
 */
export function previewCeoImport(files: CeoFiles): Promise<CeoImportPreview> {
  return request("POST", "/v1/projects/from-ceo/preview", { json: ceoBody(files) });
}

/** A new project from a project saved from Collect Earth Online: its survey, rules and plots; the caller is its coordinator. */
export function importCeoProject(
  files: CeoFiles,
  name: string,
  /** CEO collector's email -> the username of their account here (the others get a pseudonym) */
  collectors: Record<string, string>,
): Promise<CeoImportAnswer> {
  return request("POST", "/v1/projects/from-ceo", { json: { ...ceoBody(files), name, collectors } });
}

export type { BackupImportAnswer, BackupImportPreview, PlotLayout } from "../../src/wire/projects";

/** A backup and the project's original plot file, as sent: the zip in base64, the plot file as text. */
export interface BackupFiles {
  backup: string;
  plotFile: string | null;
  plotFileName: string | null;
}

const backupBody = (files: BackupFiles) => ({
  backup: files.backup,
  ...(files.plotFile !== null ? { plotFile: files.plotFile, plotFileName: files.plotFileName ?? undefined } : {}),
});

/** A file's bytes in base64, read in pieces (String.fromCharCode takes a limited number of arguments). */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** What a Collect Earth backup would make, with its original plot file when given; nothing is stored. */
export function previewBackupImport(files: BackupFiles): Promise<BackupImportPreview> {
  return request("POST", "/v1/projects/from-backup/preview", { json: backupBody(files) });
}

/** A new project from a Collect Earth backup: its survey, plots and records; the caller is its coordinator. */
export function importBackup(
  files: BackupFiles,
  name: string,
  layout: PlotLayout,
  /** a name typed in Collect Earth -> the username of their account here (the others keep the name) */
  collectors: Record<string, string>,
): Promise<BackupImportAnswer> {
  return request("POST", "/v1/projects/from-backup", { json: { ...backupBody(files), name, layout, collectors } });
}

export function getProject(projectId: string): Promise<ProjectInfo> {
  return request("GET", p(projectId));
}

/** A new project (a draft) from this one: its survey, plot files and settings; with `members`, its people and who does which plots. */
export function copyProject(projectId: string, name: string, members: boolean): Promise<ProjectCopyAnswer> {
  return request("POST", `${p(projectId)}/copy`, { json: { name, members } });
}

export type { HeaderQuestion, MatchReport, RepeatAnswer, RepeatPreview } from "../../src/wire/projects";

export function previewRepeat(projectId: string, projectFile: string | null): Promise<RepeatPreview> {
  return request("POST", `${p(projectId)}/repeat/preview`, { json: projectFile ? { projectFile } : {} });
}

/** A new project (a draft) that collects this one's plots again, with this one's answers as an earlier period. */
export function repeatSurvey(
  projectId: string,
  body: { name: string; label: string; earlierLabel: string; members: boolean; headerQuestions: string[]; plots: "all" | "collected"; projectFile: string | null },
): Promise<RepeatAnswer> {
  const { projectFile, ...rest } = body;
  return request("POST", `${p(projectId)}/repeat`, { json: { ...rest, ...(projectFile ? { projectFile } : {}) } });
}

export type { Periods, RepeatSettings } from "../../src/wire/projects";

export function getPeriods(projectId: string): Promise<Periods> {
  return request("GET", `${p(projectId)}/periods`);
}

export function setPeriodHeader(projectId: string, headerQuestions: string[]): Promise<PeriodHeaderAnswer> {
  return request("PUT", `${p(projectId)}/periods/header`, { json: { headerQuestions } });
}

export type { ChangeOutcome, ChangeRow, PeriodStatusAnswer, RepeatChange } from "../../src/wire/projects";
export type { AreaEstimate, ChangeAreas } from "../../src/wire/data";

const changeQuery = (question: string | null, period: string | null) =>
  [question ? `question=${encodeURIComponent(question)}` : "", period ? `period=${encodeURIComponent(period)}` : ""].filter(Boolean).join("&");

export function getRepeatChange(projectId: string, question: string | null, period: string | null): Promise<RepeatChange> {
  const query = changeQuery(question, period);
  return request("GET", `${p(projectId)}/periods/change${query ? `?${query}` : ""}`);
}

/** The comparison as a file: a row per plot, each period's answer, the collector's answer and the outcome. */
export async function downloadRepeatChange(projectId: string, question: string | null, period: string | null): Promise<{ blob: Blob; filename: string }> {
  const query = changeQuery(question, period);
  const response = await send("GET", `${p(projectId)}/periods/change.csv${query ? `?${query}` : ""}`);
  return { blob: await response.blob(), filename: attachmentName(response, "change.csv") };
}

/** The areas of the changes as a file: the outcomes, the transitions, the corrections and each answer's area. */
export async function downloadRepeatChangeAreas(projectId: string, question: string | null, period: string | null): Promise<{ blob: Blob; filename: string }> {
  const query = changeQuery(question, period);
  const response = await send("GET", `${p(projectId)}/periods/change-areas.csv${query ? `?${query}` : ""}`);
  return { blob: await response.blob(), filename: attachmentName(response, "change-areas.csv") };
}

/** Every period of a repeat survey side by side, one row per plot (coordinators): each question's answer in each period. */
export async function downloadPeriodsExport(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/periods/export.csv`);
  return { blob: await response.blob(), filename: attachmentName(response, "periods.csv") };
}

/** The total area in hectares of a repeat survey whose project file has no areas file; null clears it. */
export function setRepeatArea(projectId: string, totalArea: number | null): Promise<RepeatAreaAnswer> {
  return request("PUT", `${p(projectId)}/periods/area`, { json: { totalArea } });
}

export type { PlotPeriod, PlotPeriodsAnswer } from "../../src/wire/projects";

/** One plot's answers in the earlier periods, with the questions' labels and the answers' names (from the survey). */
export function getPlotPeriods(projectId: string, plot: string): Promise<PlotPeriodsAnswer> {
  return request("GET", `${p(projectId)}/periods/plots/${encodeURIComponent(plot)}`);
}

export async function setProjectStatus(projectId: string, status: ProjectStatus): Promise<ProjectStatus> {
  return (await request<ProjectStatusAnswer>("PUT", `${p(projectId)}/status`, { json: { status } })).status;
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await send("PATCH", p(projectId), { json: { name } });
}

/** Deletes the project and everything in it; confirmName must be the project name. */
export async function deleteProject(projectId: string, confirmName: string): Promise<void> {
  await send("DELETE", p(projectId), { json: { confirmName } });
}

export function getOverview(projectId: string): Promise<Overview> {
  return request("GET", `${p(projectId)}/overview`);
}

/** Uploads the project file; answers what the server did about round. */
export async function uploadCep(projectId: string, file: Blob, onProgress?: Progress): Promise<RoundInfo> {
  return (await upload<CepUploadAnswer>("PUT", `${p(projectId)}/cep`, file, "application/zip", onProgress)).round;
}

export type { CollectImportPreview, CollectImportResult } from "../../src/wire/projects";

/** `query`: collectImportQuery, the accounts the coordinator named for the operators. */
export function previewCollectImport(projectId: string, file: Blob, query: string, onProgress?: Progress): Promise<CollectImportPreview> {
  return upload<CollectImportPreview>("POST", `${p(projectId)}/records/import/preview${query}`, file, "application/zip", onProgress);
}

export function importCollectData(projectId: string, file: Blob, query: string, onProgress?: Progress): Promise<CollectImportResult> {
  return upload<CollectImportResult>("POST", `${p(projectId)}/records/import${query}`, file, "application/zip", onProgress);
}

/** What the server did about round in the current project file; null before any upload. */
export function getRoundInfo(projectId: string): Promise<RoundAnswer> {
  return request("GET", `${p(projectId)}/round`);
}

export type { ImageryAnswer, PlotLayoutAnswer, PlotLayoutChangeAnswer, PropertiesValues } from "../../src/wire/projects";

/** The plot layout keys the project file has (Collect Earth's Settings > Plot), and whether records exist. */
export function getPlotLayout(projectId: string): Promise<PlotLayoutAnswer> {
  return request("GET", `${p(projectId)}/plot-layout`);
}

/** Writes the changed plot layout settings into the project file; answers the layout as it is now. */
export function setPlotLayout(projectId: string, changes: PropertiesValues): Promise<PlotLayoutChangeAnswer> {
  return request("PUT", `${p(projectId)}/plot-layout`, { json: changes });
}

/** The imagery window keys the project file has (Collect Earth's Settings > Imagery, without the Planet key). */
export function getImagery(projectId: string): Promise<ImageryAnswer> {
  return request("GET", `${p(projectId)}/imagery`);
}

/** Writes the changed imagery window settings into the project file; answers them as they are now. */
export function setImagery(projectId: string, changes: PropertiesValues): Promise<ImageryAnswer> {
  return request("PUT", `${p(projectId)}/imagery`, { json: changes });
}

/** Which code of the survey's own round marks re-assessments (null: none). */
export function setReassessmentCode(projectId: string, reassessmentCode: string | null): Promise<RoundInfo> {
  return request("PUT", `${p(projectId)}/round`, { json: { reassessmentCode } });
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

export function createInvite(
  projectId: string,
  options: { role: Role; maxUses: number; expiresInDays: number | null; forUserId?: string },
): Promise<NewInvite> {
  const json: { role: Role; maxUses: number; expiresInDays?: number; forUserId?: string } = { role: options.role, maxUses: options.maxUses };
  if (options.expiresInDays) json.expiresInDays = options.expiresInDays;
  // A link for someone already in the project: the server makes it a one-person, one-week collector link.
  if (options.forUserId) json.forUserId = options.forUserId;
  return request<NewInvite>("POST", `${p(projectId)}/invites`, { json });
}

export async function listInvites(projectId: string): Promise<OpenInvite[]> {
  return (await request<InvitesAnswer>("GET", `${p(projectId)}/invites`)).invites;
}

export async function revokeInvite(projectId: string, inviteId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/invites/${encodeURIComponent(inviteId)}`);
}

export function previewInvite(token: string): Promise<JoinPreview> {
  return request<JoinPreview>("GET", `/v1/join/${encodeURIComponent(token)}`, { noSessionEnd: true });
}

// --- people -----------------------------------------------------------------------------------

export async function listMembers(projectId: string): Promise<Member[]> {
  return (await request<MembersAnswer>("GET", `${p(projectId)}/members`)).members;
}

export async function setMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
  await send("PUT", `${p(projectId)}/members/${encodeURIComponent(userId)}`, { json: { role } });
}

/** Ends every session of a member (a lost laptop): they stay in the project and log in again. */
export async function signOutMember(projectId: string, userId: string): Promise<void> {
  await send("POST", `${p(projectId)}/members/${encodeURIComponent(userId)}/sign-out`);
}

/** Leaves a member's records out of the results (with an optional reason), or puts them back. */
export async function setMemberExcluded(projectId: string, userId: string, excluded: boolean, reason = ""): Promise<void> {
  const json = excluded && reason.trim() ? { excluded, reason: reason.trim() } : { excluded };
  await send("PUT", `${p(projectId)}/members/${encodeURIComponent(userId)}/excluded`, { json });
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/members/${encodeURIComponent(userId)}`);
}

// --- plot files and assignments ----------------------------------------------------------

export async function listCsvFiles(projectId: string): Promise<ListedCsvFile[]> {
  return (await request<CsvFilesAnswer>("GET", `${p(projectId)}/csv-files`)).csvFiles;
}

/**
 * Uploads (or replaces) a plot file. A replacement that drops plots people hold or submitted
 * is refused with code "replace_needs_confirm" (its details: ReplaceImpact) unless `confirmReplace`.
 */
export function uploadCsvFile(projectId: string, file: File, onProgress?: Progress, confirmReplace = false): Promise<CsvUploadAnswer> {
  const query = confirmReplace ? "?confirm=replace" : "";
  return upload<CsvUploadAnswer>("PUT", `${p(projectId)}/csv-files/${encodeURIComponent(file.name)}${query}`, file, "text/csv", onProgress);
}

/** The plot files a project file brings in its grid folder (grid/*.csv, sub-folders left out). */
export const cepGridFiles = (cep: Blob) => zipCsvFiles(cep, "grid/");

/** The CSV files directly in a folder of a zip ("grid/" of a .cep, "files/ce_grid/" of Collect's .collect backup). */
export async function zipCsvFiles(zip: Blob, folder: string): Promise<File[]> {
  const isCsv = (name: string) => name.toLowerCase().startsWith(folder) && /^[^/]+\.csv$/i.test(name.slice(folder.length));
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()), { filter: (f) => isCsv(f.name) });
  return Object.entries(entries).map(([name, data]) => new File([data], name.slice(folder.length), { type: "text/csv" }));
}

/**
 * Plot files joined into one named `name`: those with the header most of them share (compared without
 * quotes, spaces or a BOM) become one file, its header once and every file's rows after it, byte for
 * byte (the text encoding is kept). The others are returned to add as they are.
 */
export async function mergeGridFiles(files: File[], name: string): Promise<{ merged: File | null; separate: File[] }> {
  const parts = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const end = bytes.indexOf(10);
      const headerEnd = end === -1 ? bytes.length : end + 1;
      // shortcut: a header whose names hold quoted commas compares as other columns, and its file is then added on its own.
      const header = new TextDecoder("latin1").decode(bytes.subarray(0, headerEnd)).replace(/^(﻿|ï»¿)/, "").replace(/["\s]/g, "");
      return { file, bytes, headerEnd, header };
    }),
  );
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p.header, (counts.get(p.header) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const same = parts.filter((p) => p.header === common);
  const separate = parts.filter((p) => p.header !== common).map((p) => p.file);
  if (same.length < 2) return { merged: null, separate: files };
  const chunks: Uint8Array<ArrayBuffer>[] = [same[0].bytes.subarray(0, same[0].headerEnd)];
  if (same[0].bytes[same[0].headerEnd - 1] !== 10) chunks.push(new Uint8Array([10]));
  for (const p of same) {
    const rows = p.bytes.subarray(p.headerEnd);
    if (rows.length === 0) continue;
    chunks.push(rows);
    if (rows[rows.length - 1] !== 10) chunks.push(new Uint8Array([10]));
  }
  return { merged: new File(chunks, name, { type: "text/csv" }), separate };
}

export type { CsvUploadAnswer, DesignArea, DesignFacts, DesignPlan, DesignStratum, PlotDesign } from "../../src/wire/plotFiles";

const designPath = (projectId: string) => `${p(projectId)}/plot-design`;

export const readDesignArea = (projectId: string, area: DesignArea) => request<DesignFacts>("POST", designPath(projectId), { json: area });

export const planPlotDesign = (projectId: string, area: DesignArea, design: PlotDesign, seed?: number) =>
  request<DesignPlan>("POST", designPath(projectId), { json: { ...area, design, seed } });

/** The plot file of a design (CSV text), to upload as any plot file. */
export async function generatePlotDesign(projectId: string, area: DesignArea, design: PlotDesign, seed: number): Promise<string> {
  const response = await send("POST", designPath(projectId), { json: { ...area, design, seed, generate: true } });
  return response.text();
}

export type { SigridCountries, SigridCountry, SigridFacts } from "../../src/wire/plotFiles";

/** What a SIGRID choice is: the country, its provinces and districts (none: all of it), an area to clip to. */
export type SigridChoice = {
  country: string;
  spacingKm?: number;
  provinces: string[];
  districts: { province: string; district: string }[];
} & ({ geojson: string } | { shapefile: string } | object);


const sigridPath = (projectId: string) => `${p(projectId)}/sigrid`;

export const listSigridCountries = (projectId: string) => request<SigridCountries>("GET", `${sigridPath(projectId)}/countries`);

export const planSigrid = (projectId: string, choice: SigridChoice) => request<SigridFacts>("POST", sigridPath(projectId), { json: choice });

/** The plot file of a SIGRID choice (CSV text, its ids SIGRID's CE_ID), to upload as any plot file. */
export async function generateSigrid(projectId: string, choice: SigridChoice): Promise<string> {
  const response = await send("POST", sigridPath(projectId), { json: { ...choice, generate: true } });
  return response.text();
}

export type { ReplaceImpact } from "../../src/wire/plotFiles";

/** What replacing a plot file would take out of the project: the details of the 409 "replace_needs_confirm" error. */
export function replaceImpactOf(error: unknown): ReplaceImpact | null {
  return error instanceof ApiError && error.code === "replace_needs_confirm" ? (error.details as unknown as ReplaceImpact) : null;
}

export async function listAssignments(projectId: string): Promise<AssignmentDetail[]> {
  return (await request<AssignmentsAnswer>("GET", `${p(projectId)}/assignments`)).assignments;
}

export async function saveAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
  await send("PUT", `${p(projectId)}/assignments`, { json: { assignments } });
}

// --- dividing a plot file between people ---------------------------------------------

const f = (projectId: string, csvFileId: string) => `${p(projectId)}/csv-files/${encodeURIComponent(csvFileId)}`;

export function getCsvColumns(projectId: string, csvFileId: string): Promise<CsvColumns> {
  return request("GET", `${f(projectId, csvFileId)}/columns`);
}

export function getDistribution(projectId: string, csvFileId: string): Promise<DistributionSummary> {
  return request("GET", `${f(projectId, csvFileId)}/distribution`);
}

/** Divides the file's plots (or, with dryRun, only says what the result would be). */
export function saveDistribution(projectId: string, csvFileId: string, distribution: DivisionBody, dryRun = false): Promise<DistributionSummary> {
  const json: DivisionBody = dryRun ? { ...distribution, dryRun: true } : distribution;
  return request("PUT", `${f(projectId, csvFileId)}/distribution`, { json });
}

/**
 * Gives the plots `fromUserId` has not submitted to `toUserId`: all of them, or (`which`) `count` of the plots
 * they have to assess (the last of their list), or only `plots` (picked on the map).
 */
export function moveUnfinished(
  projectId: string,
  csvFileId: string,
  fromUserId: string,
  toUserId: string,
  which: { count?: number; plots?: string[] } = {},
): Promise<MoveUnfinishedAnswer> {
  return request("POST", `${f(projectId, csvFileId)}/move-unfinished`, { json: { fromUserId, toUserId, ...which } });
}

export type { MoveUnfinishedAnswer, RebalanceAnswer, RebalanceMove, RebalancePlan } from "../../src/wire/plotFiles";

/**
 * Shares again the plots still to assess of `people` by their weights (1 and 1: equally; 0: gives all away); what is
 * submitted stays. `dryRun`: the plan only, nothing saved. A file given whole has nothing to share (ApiError 409).
 */
export function rebalance(
  projectId: string,
  csvFileId: string,
  people: { userId: string; weight: number }[],
  dryRun: boolean,
): Promise<RebalanceAnswer> {
  return request("POST", `${f(projectId, csvFileId)}/rebalance`, { json: { people, dryRun } });
}

// --- quality ---------------------------------------------------------------------------------

const text = (value: unknown): string => (value == null ? "" : String(value));
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : [];
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

export type {
  AnswerOptions,
  Confusion,
  DataProblem,
  DataProblemKind,
  DecisionKind,
  Difference,
  GuidanceNote,
  GuidanceNoteInput,
  PersonQuality,
  PlotOutline,
  PlotPlace,
  PlotPlaces,
  PublicDecision as QualityDecision,
  QualityAnswer,
  QualitySettingsAnswer,
  QuestionAgreement,
  WeekAgreement,
} from "../../src/wire/quality";

// merge: the people, review queue, plot search and activity sections still read their answers with these; drop when unused.
function toRate(value: unknown): Rate {
  const r = obj(value);
  return { compared: toCount(r.compared), agreeing: toCount(r.agreeing), rate: typeof r.rate === "number" && Number.isFinite(r.rate) ? r.rate : null };
}

export function toDecision(value: unknown): QualityDecision {
  return value as QualityDecision;
}

/** The quality figures. A 503 "busy" (other projects' figures being worked out) is thrown as ApiError code "busy". */
export function getQuality(projectId: string): Promise<QualityAnswer> {
  return request("GET", `${p(projectId)}/quality`);
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
  return (await request<QualitySettingsAnswer>("PUT", `${p(projectId)}/quality/settings`, { json: { fastSeconds } })).fastSeconds;
}

/** Replaces the number margins (percent, by margin key); returns them as saved. */
export async function saveQualityMargins(projectId: string, margins: Record<string, number>): Promise<Record<string, number>> {
  return (await request<QualitySettingsAnswer>("PUT", `${p(projectId)}/quality/settings`, { json: { margins } })).margins;
}

const decisionPath = (projectId: string, plot: string) => `${p(projectId)}/quality/decisions/${encodeURIComponent(plot)}`;

export async function setQualityDecision(projectId: string, plot: string, decision: DecisionKind, comment: string): Promise<QualityDecision> {
  const json = comment.trim() ? { decision, comment: comment.trim() } : { decision };
  try {
    return await request<QualityDecision>("PUT", decisionPath(projectId, plot), { json });
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

export function createGuidanceNote(projectId: string, note: GuidanceNoteInput): Promise<GuidanceNote> {
  return request("POST", notesPath(projectId), { json: note });
}

export function updateGuidanceNote(projectId: string, id: string, note: GuidanceNoteInput): Promise<GuidanceNote> {
  return request("PUT", `${notesPath(projectId)}/${encodeURIComponent(id)}`, { json: note });
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
  if (plots.length === 0) return { places: [], outline: { kind: "place" } };
  return request("POST", `${p(projectId)}/quality/places`, { json: { plots } });
}

// --- the AI assistant -------------------------------------------------------------------

export type {
  AiAnswer,
  AiFinding,
  AiReport,
  AiRunAnswer,
  AiRunKind,
  AiRunListed,
  AiRunStatus,
  AiStart,
  AiUsageAnswer,
  AiUsageCounts,
  FindingCause,
  FollowUpAction,
} from "../../src/wire/ai";

/** The assistant in a project: switched on here, and available on the server. */
export type { ProjectAi } from "../../src/wire/projectSettings";

export function getProjectAi(projectId: string): Promise<ProjectAi> {
  return request("GET", `${p(projectId)}/ai`);
}

/** Switches the assistant on or off for a project (a person's session only: a project key gets 403 user_session_required). */
export function setProjectAi(projectId: string, enabled: boolean): Promise<ProjectAi> {
  return request("PUT", `${p(projectId)}/ai`, { json: { enabled } });
}

/**
 * Starts a run in the dashboard's language; returns its id. Refusals: 409 busy, 429
 * ai_daily_limit / ai_monthly_limit with `resetsAt` (ms, or null for a limit of 0) in details.
 */
export async function startAiRun(projectId: string, start: AiStart, language: string): Promise<string> {
  const json: AiRunStartBody = { ...start, language };
  return (await request<AiRunStarted>("POST", `${p(projectId)}/ai/runs`, { json })).runId;
}

/** The project's runs, newest first, without their results. */
export async function listAiRuns(projectId: string): Promise<AiRunListed[]> {
  return (await request<AiRunsAnswer>("GET", `${p(projectId)}/ai/runs`)).runs;
}

export function getAiRun(projectId: string, runId: string): Promise<AiRunAnswer> {
  return request("GET", `${p(projectId)}/ai/runs/${encodeURIComponent(runId)}`);
}

/** The assistant's use this UTC month, per project id (never names or content). */
export function getAiUsage(): Promise<AiUsageAnswer> {
  return request("GET", "/v1/admin/ai-usage");
}

// --- the printable reports ----------------------------------------------------------------

export type { MyQualityAnswer, ReportConfusion, ReportNote, ReportRate, TeamReportAnswer } from "../../src/wire/reports";

export function getMyQuality(projectId: string): Promise<MyQualityAnswer> {
  return request("GET", `${p(projectId)}/my-quality`);
}

export function getTeamReport(projectId: string): Promise<TeamReportAnswer> {
  return request("GET", `${p(projectId)}/quality/team-report`);
}

// --- data ------------------------------------------------------------------------------------

/** The formats of the data download: a spreadsheet, or a map file with each plot's shape. */
export const EXPORT_FORMATS = ["csv", "geojson", "kml", "shp.zip"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Which records a data download keeps: all, those changed since your last download or since a time (ms), or those with an answer. */
export type ExportRecords = { kind: "all" } | { kind: "last" } | { kind: "date"; since: number } | { kind: "answer"; question: string; value: string };

export interface ExportOptions {
  /** The person's language: the CSV's separators, and the labels' language. */
  language: string;
  /** A CSV only: without the plot locations. */
  withoutPositions?: boolean;
  /** Also the records of people left out of the results. */
  includeExcluded?: boolean;
  /** Each code answer's label after it. */
  labels?: boolean;
  records?: ExportRecords;
}

/** The collected data as a CSV or map file (fetched with the session, then saved by the page). */
export async function downloadExport(projectId: string, format: ExportFormat, options: ExportOptions): Promise<{ blob: Blob; filename: string }> {
  const query = new URLSearchParams({ lang: options.language });
  if (format === "csv" && options.withoutPositions) query.set("coordinates", "none");
  if (options.includeExcluded) query.set("excluded", "include");
  if (options.labels) query.set("labels", "include");
  const records = options.records;
  if (records?.kind === "last") query.set("since", "last");
  if (records?.kind === "date") query.set("since", new Date(records.since).toISOString());
  if (records?.kind === "answer") {
    query.set("question", records.question);
    query.set("value", records.value);
  }
  const response = await send("GET", `${p(projectId)}/export.${format}?${query}`);
  return { blob: await response.blob(), filename: attachmentName(response, `collect-earth-data.${format}`) };
}

export type { ExportChoices } from "../../src/wire/data";

export const getExportChoices = (projectId: string) => request<ExportChoices>("GET", `${p(projectId)}/export/choices`);

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

export type { BackupCounts, BackupFormat, BackupLinkAnswer, BackupRounds, BackupSummary } from "../../src/wire/data";

/** What the Collect Earth backup would hold with each choice. */
export function getBackupSummary(projectId: string): Promise<BackupSummary> {
  return request("GET", `${p(projectId)}/exports/collect-backup/summary`);
}

/**
 * A link to the Collect Earth backup (a zip of the survey and the records, for "Import new data
 * from ZIP", or OpenForis Collect's own backup): used once within a minute, by the browser itself,
 * which saves the file to disk as it comes and shows its progress (the page holds none of it).
 */
export async function getBackupLink(projectId: string, rounds: BackupRounds, format: BackupFormat): Promise<BackupLinkAnswer> {
  const link = await request<BackupLinkAnswer>("POST", `${p(projectId)}/exports/collect-backup/link`, { json: { rounds, format } });
  // The browser is sent to it: only a link of this server's backup is followed.
  if (!link.url.startsWith("/v1/collect-backup/")) throw new ApiError(500, "http_500");
  return link;
}

// --- platform admin ---------------------------------------------------------------------

export function getServerSettings(): Promise<ShownSettings> {
  return request<ShownSettings>("GET", "/v1/admin/settings");
}

/** Saves some settings; returns all of them as the server now has them. */
export function saveServerSettings(changes: SettingsChange): Promise<ShownSettings> {
  return request<ShownSettings>("PUT", "/v1/admin/settings", { json: changes });
}

/** The server page's accounts list: what is searched, the filter, the order and the page. */
export const ACCOUNT_FILTERS = ["all", "admins", "disabled", "locked", "twoFactor", "noTwoFactor", "inactive", "noEmail"] as const satisfies readonly AccountFilter[];
export const ACCOUNT_SORTS = ["name", "created", "lastActive", "projects"] as const satisfies readonly AccountSort[];
export type { AccountFilter, AccountPage, AccountQuery, AccountSort } from "../../src/wire/serverAdmin";

/** A list's query string (the accounts', the projects'): what is searched, the filter, the order and the page. */
const accountQueryString = (q: Partial<AccountQuery> | ProjectQuery) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export function listUsers(query: Partial<AccountQuery> = {}): Promise<AccountPage> {
  return request<AccountPage>("GET", `/v1/admin/users?${accountQueryString(query)}`);
}

/** The accounts the search and filter find, every page, as CSV. */
export async function downloadUsersCsv(query: Partial<AccountQuery>): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `/v1/admin/users.csv?${accountQueryString({ q: query.q, filter: query.filter, sort: query.sort, desc: query.desc })}`);
  return { blob: await response.blob(), filename: attachmentName(response, "accounts.csv") };
}

export type { MadeAccount } from "../../src/wire/serverAdmin";

/** Makes accounts (also when sign-up is closed); `mail`: their links mailed to the addresses given, when the server sends mail. */
export async function createAccounts(accounts: { username: string; email: string | null }[], mail: boolean, language: string): Promise<MadeAccount[]> {
  return (await request<MadeAccountsAnswer>("POST", "/v1/admin/users", { json: { accounts, mail, language } })).results;
}

/** Makes an account a server administrator, or takes the role back; the account as it is now. */
export async function setPlatformAdmin(userId: string, on: boolean): Promise<UserSummary> {
  return (await request<AccountAnswer>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/platform-admin`, { json: { on } })).user;
}

/** Ends every session of an account, Collect Earth's included. */
export async function signOutUser(userId: string): Promise<void> {
  await send("POST", `/v1/admin/users/${encodeURIComponent(userId)}/sign-out`, { json: {} });
}

/** Deletes an account, its username typed again to confirm; the projects only it was in go with it. */
export function deleteUserAccount(userId: string, confirm: string): Promise<AccountDeletedAnswer> {
  return request<AccountDeletedAnswer>("DELETE", `/v1/admin/users/${encodeURIComponent(userId)}`, { json: { confirm } });
}

/** Disables an account (it cannot log in; its sessions end) or enables it again; the account as it is now. */
export async function setUserDisabled(userId: string, disabled: boolean): Promise<UserSummary> {
  return (await request<AccountAnswer>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/${disabled ? "disable" : "enable"}`)).user;
}

export type { ServerOverview } from "../../src/wire/serverAdmin";

export function getServerOverview(): Promise<ServerOverview> {
  return request<ServerOverview>("GET", "/v1/admin/overview");
}

/** A reset link for the account, or that it was mailed to the account's confirmed address. */
export function makeResetLink(userId: string): Promise<ResetLinkAnswer> {
  return request<ResetLinkAnswer>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/password-reset`);
}

// --- progress (the Progress tab) -----------------------------------------------------

// The types are the server's own (src/wire/progress.ts): the answers are used as they come.
export type {
  AttentionItem,
  AttentionKind,
  AttentionPerson,
  BellAnswer,
  Forecast,
  ProgressAnswer,
  ProgressDay,
  ProgressSettings,
  ProgressTotals,
  PublicProgress,
} from "../../src/wire/progress";

/** The Progress tab's figures, with the days in the browser's time zone. */
export function getProgress(projectId: string, timeZone: string, days = 90): Promise<ProgressAnswer> {
  const query = new URLSearchParams({ days: String(days), tz: timeZone });
  return request("GET", `${p(projectId)}/progress?${query}`);
}

export function getProgressSettings(projectId: string): Promise<ProgressSettings> {
  return request("GET", `${p(projectId)}/progress/settings`);
}

export function saveProgressSettings(projectId: string, settings: ProgressSettings): Promise<ProgressSettings> {
  return request("PUT", `${p(projectId)}/progress/settings`, { json: settings });
}

// --- progress links for funders (Task 18) -------------------------------------------

export type { NewShareLinkAnswer, ShareLink } from "../../src/wire/projectSettings";

export async function listShareLinks(projectId: string): Promise<ShareLink[]> {
  return (await request<ShareLinksAnswer>("GET", `${p(projectId)}/share-links`)).links;
}

/** A new link; its token and address are shown this once. */
export function createShareLink(projectId: string, label: string): Promise<NewShareLinkAnswer> {
  return request("POST", `${p(projectId)}/share-links`, { json: { label } });
}

export async function revokeShareLink(projectId: string, linkId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/share-links/${encodeURIComponent(linkId)}`);
}

/** A progress link's figures, asked without the session (the page is public; nobody needs to be logged in). */
export function getPublicProgress(token: string, timeZone: string): Promise<PublicProgress> {
  const query = new URLSearchParams({ tz: timeZone });
  return request("GET", `/v1/public/progress/${encodeURIComponent(token)}?${query}`, { anonymous: true, noSessionEnd: true });
}

// --- people (the People tab, a person's page, My work) ------------------------------

export type {
  InviteRow,
  PeopleAnswer,
  PersonAnswer,
  PersonDetail,
  PersonFile,
  PersonRow,
  PersonStatus,
  PersonTime,
  PlotStatus,
  QualityAtHand,
  QuickPlot,
  SentBack,
  Speed,
  SyncHealth,
  TimeSpent,
  WeekSummary,
} from "../../src/wire/people";

/** An open invitation link as listInvites gives it; `forUsername`: made for someone already in the project, to get the new project file. */
export interface PeopleInvite extends Invite {
  forUsername: string | null;
}

/** The People tab's table (coordinators), with the days in the browser's time zone. */
export function getPeople(projectId: string, timeZone: string): Promise<PeopleAnswer> {
  return request("GET", `${p(projectId)}/people?${new URLSearchParams({ tz: timeZone })}`);
}

/** One person's page (coordinators). */
export function getPerson(projectId: string, userId: string, timeZone: string): Promise<PersonAnswer> {
  return request("GET", `${p(projectId)}/people/${encodeURIComponent(userId)}?${new URLSearchParams({ tz: timeZone })}`);
}

/** How long the interpreters take per plot, and the plots done much quicker than the team usually takes (coordinators). */
export function getTimeSpent(projectId: string, person?: string): Promise<TimeSpent> {
  const query = person === undefined ? "" : `?${new URLSearchParams({ person })}`;
  return request("GET", `${p(projectId)}/time-spent${query}`);
}

// --- the analysis page (what replaces Saiku; the server's src/analysis.ts) -----------

export type {
  AnalysisAnswer,
  AnalysisColumn,
  AnalysisModel,
  AnalysisTable,
  AreasSource,
  ColumnType,
  ListItem,
  ProposedFilter,
  ProposedView,
  SharedAnalysisView,
  SharedAnalysisViewInput,
  StandaloneAnalysis,
  TableData,
} from "../../src/wire/analysis";

/** A code list's item; the name ExportChoices (the data section) still uses. */
export type AnalysisListItem = ListItem;

/** The survey's model and the rows of its tables, for the analysis page (any member). */
export function getAnalysis(projectId: string): Promise<AnalysisAnswer> {
  return request("GET", `${p(projectId)}/analysis`);
}

/** The analysis as one HTML file that opens with no server (fetched with the session, then saved by the page). */
export async function downloadAnalysisStandalone(projectId: string, withoutPositions = false): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/analysis/standalone${withoutPositions ? "?coordinates=none" : ""}`);
  return { blob: await response.blob(), filename: attachmentName(response, "analysis.html") };
}

export async function getSharedAnalysisViews(projectId: string): Promise<SharedAnalysisView[]> {
  return (await request<SharedAnalysisViewsAnswer>("GET", `${p(projectId)}/analysis/views`)).views;
}

/** Shares a view with the team (coordinators), replacing one of the same name and table; gives them all. */
export async function shareAnalysisView(projectId: string, view: SharedAnalysisViewInput): Promise<SharedAnalysisView[]> {
  return (await request<SharedAnalysisViewsAnswer>("PUT", `${p(projectId)}/analysis/views`, { json: view })).views;
}

/**
 * Views proposed by the AI assistant for a table of the analysis (coordinators of a project with the assistant on):
 * the server sends the model the survey's structure only, never the data. Counted against the project's AI limits.
 */
export async function proposeAnalysisViews(projectId: string, table: string, language: string): Promise<ProposedView[]> {
  return (await request<ProposedViewsAnswer>("POST", `${p(projectId)}/analysis/proposals`, { json: { table, language } })).views;
}

export async function deleteSharedAnalysisView(projectId: string, name: string, table: string): Promise<SharedAnalysisView[]> {
  return (await request<SharedAnalysisViewsAnswer>("DELETE", `${p(projectId)}/analysis/views?${new URLSearchParams({ name, table })}`)).views;
}

/** The signed-in person's own page ("My work", any member). */
export function getMyWork(projectId: string, timeZone: string): Promise<PersonAnswer> {
  return request("GET", `${p(projectId)}/my-work?${new URLSearchParams({ tz: timeZone })}`);
}

// --- answers per person (the Quality tab's Answers section, Task 4) -------------------

export type { AnswerColumnsAnswer, AnswerFlag, AnswersAnswer, ChoiceStats, CodeCount, NumberStats, Spread } from "../../src/wire/quality";

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
export function getAnswers(projectId: string, filter: AnswersFilter, timeZone: string): Promise<AnswersAnswer> {
  return request("GET", `${p(projectId)}/quality/answers?${answersQuery(filter, timeZone)}`);
}

/** A plot file's columns (not the id) and their values, to filter the answers by one. */
export async function getAnswerColumns(projectId: string, fileId: string): Promise<PlotColumn[]> {
  return (await request<AnswerColumnsAnswer>("GET", `${p(projectId)}/quality/answers/columns?${new URLSearchParams({ file: fileId })}`)).columns;
}

// ---------------------------------------------------------------------------
// Pattern flags (Task 5)

export type { Flag as PatternFlag, FlagCounts, FlagDetails, FlagKind, FlagsAnswer } from "../../src/wire/quality";

export const FLAG_KINDS: readonly FlagKind[] = ["very_fast", "same_as_before", "required_empty", "edited_after_decision", "two_main", "no_plot"];

export interface FlagsFilter {
  person: string | null;
  kind: FlagKind | null;
}

export const NO_FLAGS_FILTER: FlagsFilter = { person: null, kind: null };

// merge: the people, review queue and plot search sections still read their answers with these; drop when unused.
export function toFlagCounts(value: unknown): FlagCounts {
  const v = obj(value);
  return Object.fromEntries(FLAG_KINDS.map((k) => [k, toCount(v[k])])) as FlagCounts;
}

function toPatternFlags(f: Record<string, unknown>): PatternFlag[] {
  return (FLAG_KINDS as readonly unknown[]).includes(f.kind) ? [f as unknown as PatternFlag] : [];
}

/** Plots worth a look (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export function getFlags(projectId: string, filter: FlagsFilter): Promise<FlagsAnswer> {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.kind) query.set("kind", filter.kind);
  const q = query.toString();
  return request("GET", `${p(projectId)}/quality/flags${q ? `?${q}` : ""}`);
}

// --- automatic checks (Task 13) --------------------------------------------------

export type {
  SamplingChecker,
  SamplingCore,
  SamplingDraw,
  SamplingDrawAnswer,
  SamplingFile,
  SamplingFileRule,
  SamplingRule,
  SamplingRuleInput,
  SamplingView,
} from "../../src/wire/checks";

export function getSampling(projectId: string): Promise<SamplingView> {
  return request("GET", `${p(projectId)}/sampling`);
}

export function saveSampling(projectId: string, rule: SamplingRuleInput): Promise<SamplingView> {
  return request("PUT", `${p(projectId)}/sampling`, { json: rule });
}

/** "Draw now": the draw's counts and the section as it is after it. */
export function drawSamplingNow(projectId: string): Promise<SamplingDrawAnswer> {
  return request("POST", `${p(projectId)}/sampling/draw`);
}

// --- reference plots (Task 14) ----------------------------------------------------

export type {
  ExternalReferenceFigures,
  ReferenceAnswer,
  ReferenceAnswersReport,
  ReferenceChangeAnswer,
  ReferenceChangeResult,
  ReferenceFiguresAnswer,
  ReferenceMarkBody,
  ReferencePerson,
  ReferencePlotRow,
  ReferenceQuestion,
  ReferenceSet,
} from "../../src/wire/checks";

// merge: the people section's toPersonData still reads a person's reference line with it.
export function toReferencePerson(value: unknown): ReferencePerson {
  const p = obj(value);
  return {
    username: text(p.username),
    plots: toRate(p.plots),
    questions: list(p.questions).map((q) => ({ key: text(q.key), label: text(q.label) || text(q.key), ...toRate(q) })),
  };
}

/** Uploads a reference set (a CSV, or a JSON array for a .json file); it replaces the one the project had. */
export function uploadReferenceAnswers(projectId: string, file: File): Promise<ReferenceAnswersReport> {
  const json = file.name.toLowerCase().endsWith(".json");
  return upload("PUT", `${p(projectId)}/reference/answers`, file, json ? "application/json" : "text/csv");
}

export async function deleteReferenceAnswers(projectId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/reference/answers`);
}

export function getReference(projectId: string): Promise<ReferenceAnswer> {
  return request("GET", `${p(projectId)}/reference`);
}

/** Marks plots of a divided file as reference plots: the ids given, or `random` plots nobody has assessed. */
export function markReference(projectId: string, body: ReferenceMarkBody): Promise<ReferenceChangeAnswer> {
  return request("POST", `${p(projectId)}/reference/plots`, { json: body });
}

/** No longer reference plots: the copies of those who did not check them go. */
export function unmarkReference(projectId: string, plots: { csvFileId: string; plot: string }[] | "all"): Promise<ReferenceChangeAnswer> {
  return request("POST", `${p(projectId)}/reference/remove`, { json: plots === "all" ? { all: true } : { plots } });
}

// --- the review queue (Task 7) ----------------------------------------------------

export type { BulkDecisionAnswer, BulkRule, PlotDecision, QueueSection, Resubmission, ReviewQueueAnswer, ReviewQueueItem } from "../../src/wire/review";
/** What the queue can be filtered by: a part, or a kind of flag (as the server's QUEUE_KINDS). */
export const QUEUE_KINDS = ["difference", ...FLAG_KINDS, "resubmitted"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

// merge: the flags are the pattern flags section's PatternFlag (toPatternFlags) until that section
// uses the server's Flag; then QueueItem and ReviewQueueData are ReviewQueueItem and ReviewQueueAnswer.
/** One plot of the review queue, with everything known about it. */
export type QueueItem = Omit<ReviewQueueItem, "flags"> & { flags: PatternFlag[] };
export type ReviewQueueData = Omit<ReviewQueueAnswer, "items"> & { items: QueueItem[] };

export interface QueueFilter {
  person: string | null;
  kind: QueueKind | null;
}

export const NO_QUEUE_FILTER: QueueFilter = { person: null, kind: null };

/** The review queue (coordinators and reviewers), after the cursor `after` (a page's `next`). A 503 "busy" is thrown as ApiError code "busy". */
export async function getReviewQueue(projectId: string, filter: QueueFilter, after: string | null): Promise<ReviewQueueData> {
  const query = new URLSearchParams();
  if (filter.person) query.set("person", filter.person);
  if (filter.kind) query.set("kind", filter.kind);
  if (after) query.set("after", after);
  const q = query.toString();
  const queue = await request<ReviewQueueAnswer>("GET", `${p(projectId)}/quality/queue${q ? `?${q}` : ""}`);
  return { ...queue, items: queue.items.map((item) => ({ ...item, flags: item.flags.flatMap((f) => toPatternFlags({ ...f })) })) };
}

/** Bulk decisions (coordinators): `dryRun` only counts the plots the rule would decide. */
export function bulkDecisions(projectId: string, rule: BulkRule, dryRun: boolean): Promise<BulkDecisionAnswer> {
  return request("POST", `${p(projectId)}/quality/decisions:bulk${dryRun ? "?dryRun=1" : ""}`, { json: { rule } });
}

// --- survey health (Task 6) -----------------------------------------------------

export type { HealthCodes, HealthReason, HealthRow, SurveyHealthAnswer } from "../../src/wire/checks";
export const HEALTH_REASONS: readonly HealthReason[] = ["low_agreement", "often_other", "often_empty", "often_changed"];

/** Survey health (coordinators and reviewers). A 503 "busy" is thrown as ApiError code "busy". */
export function getSurveyHealth(projectId: string): Promise<SurveyHealthAnswer> {
  return request("GET", `${p(projectId)}/quality/survey-health`);
}

// --- plot search (Task 8) ---------------------------------------------------------

export type { Assessment, PlotMatch, PlotPageAnswer, PlotPageFile, PlotPageRecord, PlotSearchAnswer } from "../../src/wire/review";

/** Plots whose id starts with `query` (coordinators and reviewers); nothing is asked for an empty one. */
export async function searchPlots(projectId: string, query: string): Promise<PlotSearchAnswer> {
  const q = query.trim();
  if (q === "") return { plots: [], more: false };
  return request("GET", `${p(projectId)}/plots/search?${new URLSearchParams({ q }).toString()}`);
}

// merge: the flags are the pattern flags section's PatternFlag (toPatternFlags), and the decision the
// quality section's QualityDecision (what setQualityDecision answers), until those sections use the
// server's types; then PlotPageData is PlotPageAnswer.
/** One plot's page (GET /plots/:plot). */
export type PlotPageData = Omit<PlotPageAnswer, "flags" | "decision"> & { flags: PatternFlag[] | null; decision: QualityDecision | null };

/** One plot (coordinators and reviewers); a 404 for a plot in no plot file. */
export async function getPlotPage(projectId: string, plot: string): Promise<PlotPageData> {
  const page = await request<PlotPageAnswer>("GET", `${p(projectId)}/plots/${encodeURIComponent(plot)}`);
  return { ...page, flags: page.flags && page.flags.flatMap((f) => toPatternFlags({ ...f })) };
}

// --- map of progress (Task 9) -------------------------------------------------------

export type { MapFile, MapPage, MapStatus } from "../../src/wire/map";
/** A plot's status on the map, in the server's order of status codes (its GEO_STATUSES). */
export const MAP_STATUSES = ["notStarted", "started", "submitted", "accepted", "recheck", "differs", "resubmitted"] as const satisfies readonly MapStatus[];

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
  /** Coordinators: each plot's plot file, an index in `files` (-1 when several list it); null for a reviewer. */
  file: Int32Array | null;
  /** Coordinators: 1 for a reference plot (it never moves); null for a reviewer. */
  reference: Uint8Array | null;
  /** Plots per status, those off the map included. */
  counts: Record<MapStatus, number>;
  notOnMap: number;
  files: MapFile[];
  /** Coordinators: everyone holding a plot or who made a first assessment; null for a reviewer. */
  people: string[] | null;
  holders: string[][] | null;
  /** The quality figures the disagreements come from; null when none are at hand. */
  figures: MapPage["figures"];
  /** Set when the plots' state is older than the records (newer figures are being worked out). */
  asOf: number | null;
  /** The survey's coordinate system when it is not latitude and longitude: no plot is on the map. */
  unsupportedSrs?: string;
}

export interface MapFilters {
  file?: string | null;
  person?: string | null;
}

/** Times a map is read again from the start when the server no longer has it between its pages. */
const MAP_RESTARTS = 3;

/** One page of GET /map/plots, added to the map being read (made on the first page). */
export function addMapPage(map: MapPlots | null, page: MapPage): MapPlots {
  // A point's status is an index in the page's `statuses`: read by its name.
  const codeOf = page.statuses.map((name) => MAP_STATUSES.indexOf(name));
  if (map === null) {
    const total = page.total;
    const counts = Object.fromEntries(MAP_STATUSES.map((s) => [s, 0])) as Record<MapStatus, number>;
    page.counts.forEach((n, i) => {
      counts[page.statuses[i]] += n;
    });
    const coordinator = page.file !== undefined;
    map = {
      version: page.version,
      total,
      lat: new Float64Array(total),
      lon: new Float64Array(total),
      status: new Uint8Array(total),
      holder: new Int32Array(total).fill(-1),
      plots: new Array<string>(total).fill(""),
      names: page.names ? new Array<string>(total).fill("") : null,
      file: coordinator ? new Int32Array(total).fill(-1) : null,
      reference: coordinator ? new Uint8Array(total) : null,
      counts,
      notOnMap: page.notOnMap,
      files: page.files,
      people: page.people,
      holders: page.holders,
      figures: page.figures,
      asOf: page.asOf,
      ...(page.unsupportedSrs !== undefined ? { unsupportedSrs: page.unsupportedSrs } : {}),
    };
  }
  const { offset, points } = page;
  for (let i = 0; i < points.length && offset + i < map.total; i++) {
    const [lat, lon, status, holder] = points[i];
    const at = offset + i;
    map.lat[at] = lat;
    map.lon[at] = lon;
    map.status[at] = codeOf[status];
    map.holder[at] = holder;
    map.plots[at] = page.plots[i];
    if (map.names) map.names[at] = page.names?.[i] ?? map.plots[at];
    if (map.file && page.file) map.file[at] = page.file[i];
  }
  // The reference plots of this page, by their index in the whole map.
  if (map.reference) for (const at of page.reference ?? []) map.reference[at] = 1;
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
      let page: MapPage;
      try {
        page = await request<MapPage>("GET", `${p(projectId)}/map/plots?${query.toString()}`);
      } catch (error) {
        if (!(error instanceof ApiError && error.code === "map_changed") || attempt >= MAP_RESTARTS) throw error;
        changed = true;
        break;
      }
      map = addMapPage(map, page);
      offset = page.next;
      onProgress?.(offset ?? map.total, map.total);
      if (stopped()) return map;
    }
    if (!changed) return map!;
  }
}

// --- activity: the log, the weekly summary, the downloads and the bell (coordinators) ----

export type {
  ActivityPage,
  DailyRow,
  DecisionRow,
  DifferenceRow,
  ExportAnswer,
  ExportFigures,
  ExportKind,
  LogItem,
  RecordChange,
  WeeklyAnswer,
  WeeklyPerson,
  WeeklySummary,
} from "../../src/wire/activity";

/** What the log can be filtered by (the server's LOG_KINDS). */
export const LOG_KINDS = ["all", "records", "submitted", "resubmitted", "draft", "unsubmitted", "deleted", "coordinators", "decisions", "people", "files", "settings", "downloads"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface ActivityQuery {
  person?: string | null;
  kind?: LogKind;
  /** ms since 1970: from (included) and to (not included). */
  from?: number | null;
  to?: number | null;
  cursor?: string | null;
  limit?: number;
}

/** One page of the activity log (coordinators). */
export function getActivity(projectId: string, q: ActivityQuery = {}): Promise<ActivityPage> {
  const query = new URLSearchParams();
  if (q.person) query.set("person", q.person);
  if (q.kind && q.kind !== "all") query.set("kind", q.kind);
  if (q.from != null) query.set("from", String(Math.round(q.from)));
  if (q.to != null) query.set("to", String(Math.round(q.to)));
  if (q.cursor) query.set("cursor", q.cursor);
  if (q.limit) query.set("limit", String(q.limit));
  const qs = query.toString();
  return request("GET", `${p(projectId)}/activity${qs ? `?${qs}` : ""}`);
}

/** One ISO week's summary (null: the viewer's current week), its days in the browser's time zone. */
export function getWeekly(projectId: string, week: string | null, timeZone: string): Promise<WeeklyAnswer> {
  const query = new URLSearchParams({ tz: timeZone });
  if (week) query.set("week", week);
  return request("GET", `${p(projectId)}/weekly?${query}`);
}

/** The rows of a download (the server notes who downloaded what). */
export function getExport<K extends ExportKind>(projectId: string, kind: K, timeZone: string): Promise<Extract<ExportAnswer, { kind: K }>> {
  const query = new URLSearchParams({ tz: timeZone });
  return request("GET", `${p(projectId)}/exports/${kind}?${query}`);
}

/** The bell's "needs attention" items, with what this coordinator has read. */
export function getAttention(projectId: string): Promise<BellAnswer> {
  return request("GET", `${p(projectId)}/attention`);
}

/** Marks items read (by key), or all of them. */
export function markAttentionRead(projectId: string, keys: string[] | "all"): Promise<BellAnswer> {
  return request("POST", `${p(projectId)}/attention/read`, { json: keys === "all" ? { all: true } : { keys } });
}

// --- Training: calibration and learning plots -----------------------------------------

export type {
  AnonymousCalibration,
  AnswerCount,
  CalibrationCell,
  CalibrationFigures,
  CalibrationPerson,
  CalibrationPlot,
  CalibrationQuestion,
  LearningScore,
  MyScoredPlot,
  MyTrainingSet,
  ScoredAnswer,
  ScoredPlot,
  Share,
  TrainingAttemptPast,
  TrainingAttemptStart,
  TrainingFiguresAnswer,
  TrainingFiguresSet,
  TrainingGolden,
  TrainingKind,
  TrainingList,
  TrainingListItem,
  TrainingPerson,
  TrainingQuestion,
  TrainingSetSummary,
  TrainingSetView,
} from "../../src/wire/training";

export function getTraining(projectId: string): Promise<TrainingList> {
  return request("GET", `${p(projectId)}/training`);
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

export function updateTrainingSet(projectId: string, setId: string, change: { name?: string; kind?: TrainingKind; passMark?: number | null }): Promise<TrainingSetSummary> {
  return request("PATCH", `${p(projectId)}/training/${encodeURIComponent(setId)}`, { json: change });
}

export async function deleteTrainingSet(projectId: string, setId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/training/${encodeURIComponent(setId)}`);
}

export async function setTrainingMembers(projectId: string, setId: string, userIds: string[]): Promise<void> {
  await send("PUT", `${p(projectId)}/training/${encodeURIComponent(setId)}/members`, { json: { userIds } });
}

export function getTrainingSet(projectId: string, setId: string): Promise<TrainingSetView> {
  return request("GET", `${p(projectId)}/training/${encodeURIComponent(setId)}`);
}

export function putTrainingGolden(projectId: string, setId: string, plot: string, answers: Record<string, string>, note: string | null): Promise<TrainingGolden> {
  return request("PUT", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden/${encodeURIComponent(plot)}`, { json: { answers, note } });
}

/** Golden answers for every plot: the calibration's agreed answers, or one person's records. */
export async function goldenFrom(projectId: string, setId: string, from: { from: "consensus" } | { from: "person"; userId: string }): Promise<number> {
  return (await request<GoldenFromAnswer>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden`, { json: from })).plots;
}

/** A training set's results as CSV: each person's attempts, or every answer scored. */
export async function downloadTrainingExport(projectId: string, setId: string, what: "scores" | "answers"): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/training/${encodeURIComponent(setId)}/export?what=${what}`);
  return { blob: await response.blob(), filename: attachmentName(response, `training-${what}.csv`) };
}

/** Takes the questions the survey no longer has out of every golden answer of a set; gives the plots changed. */
export async function pruneTrainingGolden(projectId: string, setId: string): Promise<number> {
  return (await request<GoldenPruneAnswer>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden/prune`)).plots;
}

export async function startTrainingAttempts(projectId: string, setId: string, who: { userIds: string[] } | { all: true }): Promise<number> {
  return (await request<AttemptsAnswer>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/attempts`, { json: who })).started;
}

export async function getMyTraining(projectId: string): Promise<MyTrainingSet[]> {
  return (await request<MyTrainingAnswer>("GET", `${p(projectId)}/training/mine`)).sets;
}

/** Calibration figures without anyone's name (reviewers), and the survey's questions for them. */
export function getTrainingFigures(projectId: string): Promise<TrainingFiguresAnswer> {
  return request("GET", `${p(projectId)}/training/figures`);
}

export type {
  AreaSettings,
  AreaSettingsAnswer,
  AreasAnswer,
  Estimate,
  ForestRow,
  IpccCategory,
  IpccExports,
  StrataAreas,
  UncertaintyAnswer,
  UncertaintyQuestion,
  UncertaintyResult,
  UncertaintySettings,
  UncertaintySettingsAnswer,
  UncertaintySetup,
} from "../../src/wire/analysis";

/** The six IPCC land categories (the server's src/uncertainty.ts). */
export const IPCC_CATEGORIES = ["forest", "cropland", "grassland", "wetland", "settlement", "other"] as const satisfies readonly IpccCategory[];

export function getUncertaintySetup(projectId: string): Promise<UncertaintySetup> {
  return request("GET", `${p(projectId)}/uncertainty/settings`);
}

export async function saveUncertaintySettings(projectId: string, settings: UncertaintySettings): Promise<UncertaintySettings> {
  return (await request<UncertaintySettingsAnswer>("PUT", `${p(projectId)}/uncertainty/settings`, { json: settings })).settings;
}

/** The project's strata and areas; with `columns`, the strata those columns would make (nothing saved). */
export const getAreas = (projectId: string, columns?: string[]) =>
  request<AreasAnswer>("GET", `${p(projectId)}/areas${columns ? `?columns=${encodeURIComponent(columns.join(","))}` : ""}`);

/** Saves the strata and areas, or one total area; null: back to the project file's areas file. */
export const saveAreas = (projectId: string, settings: AreaSettings | null) => request<AreaSettingsAnswer>("PUT", `${p(projectId)}/areas`, { json: { settings } });

/** Saves the strata of an areas_per_attribute.csv (Collect Earth's: the columns, then area). */
export const uploadAreasFile = (projectId: string, file: string) => request<AreaSettingsAnswer>("PUT", `${p(projectId)}/areas`, { json: { file } });

/** The strata as areas_per_attribute.csv. */
export async function downloadAreasFile(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/areas/file`);
  return { blob: await response.blob(), filename: attachmentName(response, "areas_per_attribute.csv") };
}

export type IpccFile = "matrix" | "matrix-strata" | "plots" | "land-units" | "timeseries";
export const IPCC_FILES: readonly IpccFile[] = ["matrix", "matrix-strata", "plots", "land-units", "timeseries"];
/** The management types of each IPCC category (the server's MANAGEMENT_TYPES). */
export const IPCC_MANAGEMENT: Record<string, readonly string[]> = {
  F: ["MANAGED", "UNMANAGED"],
  C: ["ANNUAL", "PERENNIAL"],
  G: ["MANAGED", "UNMANAGED"],
  W: ["MANAGED", "UNMANAGED"],
  S: ["TREED", "OTHER"],
  O: ["MANAGED", "UNMANAGED"],
};

export const getIpccExports = (projectId: string) => request<IpccExports>("GET", `${p(projectId)}/exports/ipcc`);

export async function downloadIpccFile(projectId: string, file: IpccFile): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/exports/ipcc/${file}`);
  return { blob: await response.blob(), filename: attachmentName(response, `${file}.txt`) };
}

/** The file for the IPCC Inventory Software; `management` by "<category>/<code>". */
export async function downloadIpccGhgi(projectId: string, choices: { country: string; region: string; management: Record<string, string> }): Promise<{ blob: Blob; filename: string }> {
  const response = await send("POST", `${p(projectId)}/exports/ipcc/ghgi`, { json: choices });
  return { blob: await response.blob(), filename: attachmentName(response, "GHGi_tool_data.xml") };
}

export function getUncertainty(projectId: string): Promise<UncertaintyAnswer> {
  return request("GET", `${p(projectId)}/uncertainty`);
}

/** The copy of a CEO project's plot and sample shapes into the project (src/routes/ceoShapes.ts). */
export type CeoShapesProgress =
  | { state: "none" }
  | { state: "reading" | "done"; total: number; done: number; missing: number; error: string | null };

export function getCeoShapes(projectId: string): Promise<CeoShapesProgress> {
  return request("GET", `${p(projectId)}/ceo-shapes`);
}

/** Reads the next plots' shapes from CEO (about 20 seconds); once all are read, the plot files get them. */
export function stepCeoShapes(projectId: string): Promise<CeoShapesProgress> {
  return request("POST", `${p(projectId)}/ceo-shapes/step`);
}

// --- The server page's projects and operations (stage C: routes/serverOps.ts, routes/mail.ts) ---

export type { AdminProjectRow as AdminProject, ProjectFilter, ProjectPage, ProjectQuery, ProjectSort } from "../../src/wire/serverAdmin";
export const PROJECT_FILTERS = ["all", "noCoordinator", "draft", "active", "closed", "archived"] as const satisfies readonly ProjectFilter[];
export const PROJECT_SORTS = ["lastActivity", "created", "storage", "people"] as const satisfies readonly ProjectSort[];

export function listAdminProjects(query: ProjectQuery): Promise<ProjectPage> {
  return request<ProjectPage>("GET", `/v1/admin/projects?${accountQueryString(query)}`);
}

/** Archives a project, or restores an archived one as closed. */
export const setProjectArchived = (projectId: string, archived: boolean) =>
  request<ProjectArchivedAnswer>("POST", `/v1/admin/projects/${encodeURIComponent(projectId)}/archive`, { json: { archived } });

/** Makes an account (by its username) a coordinator of the project. */
export const handProjectTo = (projectId: string, username: string) =>
  request<ProjectHandedAnswer>("POST", `/v1/admin/projects/${encodeURIComponent(projectId)}/coordinator`, { json: { username } });

export const SERVER_ACTION_KINDS = ["settings", "account", "project", "mail", "message", "alerts"] as const satisfies readonly ServerActionKind[];
export type { ServerActionKind, ServerActivityEntry, ServerActivityPage } from "../../src/wire/serverAdmin";
export interface ServerActivityQuery {
  actor: string;
  kind: ServerActionKind | "";
  page: number;
  pageSize: number;
}

const serverActivityQueryString = (q: Partial<ServerActivityQuery>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString();

export function getServerActivity(query: ServerActivityQuery): Promise<ServerActivityPage> {
  return request<ServerActivityPage>("GET", `/v1/admin/activity?${serverActivityQueryString(query)}`);
}

export async function downloadServerActivity(query: Pick<ServerActivityQuery, "actor" | "kind">): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `/v1/admin/activity.csv?${serverActivityQueryString(query)}`);
  return { blob: await response.blob(), filename: attachmentName(response, "server-activity.csv") };
}

export type { CollectEarthVersions, MailCheck } from "../../src/wire/serverAdmin";

export const getCollectEarthVersions = () => request<CollectEarthVersions>("GET", "/v1/admin/versions");

export const getMailCheck = () => request<MailCheck>("GET", "/v1/admin/mail");

/** Sends a test email to the administrator's own address. */
export const sendTestMail = (language: string) => request<TestMailAnswer>("POST", "/v1/admin/mail/test", { json: { language } });

// --- The server page's safety and communication (stage D) ---

/** Lifts the lock failed sign-ins set on an account. */
export const unlockUser = (userId: string) => request<UnlockAnswer>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/unlock`);

export type { MessageAudience, MessagePreview, ServerMessage } from "../../src/wire/serverAdmin";

/** How the message will read and how many it reaches. */
export const previewServerMessage = (m: ServerMessage, language: string) =>
  request<MessagePreview>("POST", "/v1/admin/messages/preview", { json: { ...m, language } });

/** Sends it; `recipients`: the count shown (a different one now is refused with the new count). */
export const sendServerMessage = (m: ServerMessage, recipients: number) =>
  request<MessageSentAnswer>("POST", "/v1/admin/messages", { json: { ...m, recipients } });
