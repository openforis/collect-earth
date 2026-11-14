// How the dashboard calls the server: the requests, uploads with progress, and the errors as people read them.

import type { MessageKey } from "../i18n";
import { getToken } from "../storage";
import type { ProjectStatus } from "../../../src/wire/projectSettings";
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

export async function send(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
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

export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  return (await parseBody(response)) as T;
}

/** Upload progress, 0..1. */
export type Progress = (fraction: number) => void;

/** Sends a raw file body (fetch cannot report upload progress, XMLHttpRequest can). */
export function upload<T>(method: string, path: string, body: Blob, contentType: string, onProgress?: Progress): Promise<T> {
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

/** Optional text from the server: null when missing or empty. */
function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** An http(s) link, or null: a terms link is put in an href, so nothing else gets through. */
export function safeUrl(value: unknown): string | null {
  const text = optionalText(value);
  return text && /^https?:\/\//i.test(text) ? text : null;
}

/** A status read from free-form data (an audit entry's details); anything else reads as active. */
export function asStatus(value: unknown): ProjectStatus {
  return value === "draft" || value === "closed" || value === "archived" ? value : "active";
}

export const p = (projectId: string) => `/v1/projects/${encodeURIComponent(projectId)}`;
