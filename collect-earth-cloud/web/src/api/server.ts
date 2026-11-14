// The server page (platform administrators): settings, accounts, projects, operations, alerts and messages.

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
} from "../../../src/wire/serverAdmin";
import { attachmentName } from "./data";
import { request, send } from "./transport";

// --- the owner's alerts (the server's src/ownerAlerts.ts) ---------------------------------------

export type { OwnerAlertKind, OwnerAlertsPage, StoredOwnerAlert as OwnerAlert } from "../../../src/wire/serverAdmin";

/** The alerts kept (newest first, in pages), how many are not seen, the thresholds and the webhook. */
export function getOwnerAlerts(page = 1): Promise<OwnerAlertsPage> {
  return request<OwnerAlertsPage>("GET", `/v1/admin/alerts?page=${page}&pageSize=10`);
}

/** Marks alerts seen (none given: every one not seen). */
export const markAlertsSeen = (ids?: string[]) => request<AlertsMarkedAnswer>("POST", "/v1/admin/alerts/seen", { json: ids ? { ids } : {} });

/** A test post to a webhook (the address typed, or the one saved). */
export const testAlertWebhook = (url?: string) => request<WebhookTestAnswer>("POST", "/v1/admin/alerts/webhook-test", { json: url ? { url } : {} });

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
export type { AccountFilter, AccountPage, AccountQuery, AccountSort } from "../../../src/wire/serverAdmin";

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

export type { MadeAccount } from "../../../src/wire/serverAdmin";

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

export type { ServerOverview } from "../../../src/wire/serverAdmin";

export function getServerOverview(): Promise<ServerOverview> {
  return request<ServerOverview>("GET", "/v1/admin/overview");
}

/** A reset link for the account, or that it was mailed to the account's confirmed address. */
export function makeResetLink(userId: string): Promise<ResetLinkAnswer> {
  return request<ResetLinkAnswer>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/password-reset`);
}

// --- The server page's projects and operations (stage C: routes/serverOps.ts, routes/mail.ts) ---

export type { AdminProjectRow as AdminProject, ProjectFilter, ProjectPage, ProjectQuery, ProjectSort } from "../../../src/wire/serverAdmin";
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
export type { ServerActionKind, ServerActivityEntry, ServerActivityPage } from "../../../src/wire/serverAdmin";
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

export type { CollectEarthVersions, MailCheck } from "../../../src/wire/serverAdmin";

export const getCollectEarthVersions = () => request<CollectEarthVersions>("GET", "/v1/admin/versions");

export const getMailCheck = () => request<MailCheck>("GET", "/v1/admin/mail");

/** Sends a test email to the administrator's own address. */
export const sendTestMail = (language: string) => request<TestMailAnswer>("POST", "/v1/admin/mail/test", { json: { language } });

// --- The server page's safety and communication (stage D) ---

/** Lifts the lock failed sign-ins set on an account. */
export const unlockUser = (userId: string) => request<UnlockAnswer>("POST", `/v1/admin/users/${encodeURIComponent(userId)}/unlock`);

export type { MessageAudience, MessagePreview, ServerMessage } from "../../../src/wire/serverAdmin";

/** How the message will read and how many it reaches. */
export const previewServerMessage = (m: ServerMessage, language: string) =>
  request<MessagePreview>("POST", "/v1/admin/messages/preview", { json: { ...m, language } });

/** Sends it; `recipients`: the count shown (a different one now is refused with the new count). */
export const sendServerMessage = (m: ServerMessage, recipients: number) =>
  request<MessageSentAnswer>("POST", "/v1/admin/messages", { json: { ...m, recipients } });
