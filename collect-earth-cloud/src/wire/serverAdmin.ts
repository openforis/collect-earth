// The server page (server administrators only): settings, accounts, the owner's panel and alerts, the projects
// directory, the activity log, Collect Earth versions, mail and messages, as the server answers them.
// Types only: see README.md in this folder.
import type { DigestKind, ProjectCreation } from './account.js';
import type { ProjectStatus } from './projectSettings.js';

// --- settings ---

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
  /** The AI assistant may be used on this server (it also needs the AI_VERTEX_* configuration). */
  aiEnabled: boolean;
  /** AI reports per project per UTC day; 0 = none allowed. */
  aiReportsPerDay: number;
  /** AI follow-ups and questions per project per UTC day; 0 = none allowed. */
  aiFollowUpsPerDay: number;
  /**
   * AI tokens (input + output) per project per calendar month (UTC); 0 = none allowed.
   * Per project: the server's total can reach this times the number of projects.
   */
  aiMonthlyTokens: number;
  /** A short plain-text message shown at the top of every dashboard page to everyone signed in; null: none. */
  announcement: string | null;
  /** When the announcement stops being shown (epoch ms); null: until it is cleared. */
  announcementUntil: number | null;
  /**
   * Coordinators (project admins) and the server's administrators must use two-step sign-in (src/twoFactor.ts): until
   * they set it up, their coordinator and administration pages are refused (two_factor_required).
   */
  twoFactorForCoordinators: boolean;
  /** Owner alerts (src/ownerAlerts.ts): how many in one hour raise one, and a project's storage in percent of its limit. */
  alertFailedLogins: number;
  alertServerErrors: number;
  alertSyncErrors: number;
  alertStoragePercent: number;
  /**
   * A Slack or Microsoft Teams incoming webhook the alerts are posted to as well (src/alertWebhook.ts); null: none.
   * A secret of sorts (whoever has it can post to the channel): never sent back, only whether one is set and its host.
   */
  alertWebhookUrl: string | null;
  /** Open sign-up only with an email address of these domains (comma-separated, lower case); null: any address or none. */
  signupDomains: string | null;
  /** The shortest password accepted (sign-up, a change, a reset), from MIN_PASSWORD_LENGTH to 64. */
  minPasswordLength: number;
  /** An account is locked after this many failed sign-ins in a row (0: never), for loginLockMinutes. */
  loginLockFailures: number;
  loginLockMinutes: number;
}

/** The alerts' Slack or Teams webhook, as it is shown: its service and host only. */
export interface AlertWebhook {
  kind: 'slack' | 'teams';
  host: string;
}

/** GET and PUT /v1/admin/settings: the settings as an administrator reads them. */
export interface ShownSettings extends Omit<ServerSettings, 'alertWebhookUrl'> {
  alertWebhook: AlertWebhook | null;
  /** Whether the server has its AI configuration (never the key or the Vertex settings). */
  aiConfigured: boolean;
}

/** PUT /v1/admin/settings: the settings to change; alertWebhookUrl sets a new webhook (null or "" removes it). */
export type SettingsChange = Partial<ServerSettings>;

// --- the owner's alerts ---

export type OwnerAlertKind = 'failed_logins' | 'server_errors' | 'sync_errors' | 'storage' | 'two_factor_keys';
export type AlertSignal = 'failedLogin' | 'serverError' | 'syncError';

/** The thresholds in force: the signals' per hour and a project's storage in percent. */
export type AlertThresholds = Record<AlertSignal, number> & { storagePercent: number };

/** One alert raised for the server's administrators, as kept (owner_alerts, migration 042). */
export interface StoredOwnerAlert {
  id: string;
  kind: OwnerAlertKind;
  at: number;
  count: number;
  projectId: string | null;
  seenAt: number | null;
  /** Who marked it seen (a username), or null. */
  seenBy: string | null;
}

/** GET /v1/admin/alerts: the alerts kept, newest first, in pages; the thresholds and whether a webhook is set. */
export interface OwnerAlertsPage {
  alerts: StoredOwnerAlert[];
  total: number;
  /** Alerts not marked seen, of all kept */
  unseen: number;
  page: number;
  pages: number;
  pageSize: number;
  thresholds: AlertThresholds;
  webhook: AlertWebhook | null;
}

/** POST /v1/admin/alerts/seen */
export interface AlertsMarkedAnswer {
  marked: number;
}

/** POST /v1/admin/alerts/webhook-test */
export interface WebhookTestAnswer {
  sent: true;
}

// --- accounts ---

/** One account in the platform admin's user list: a project COUNT only, never names (§4b). */
export interface UserSummary {
  userId: string;
  username: string;
  isPlatformAdmin: boolean;
  /** Projects the account belongs to, in any role. */
  projects: number;
  /** Projects the account coordinates (admin role): what maxProjectsPerUser counts. */
  coordinatedProjects: number;
  /** When the account was disabled (epoch ms), or null. */
  disabledAt: number | null;
  /** Who disabled it (a username), or null (enabled, or that account was deleted since). */
  disabledBy: string | null;
  /** Two-step sign-in is on for the account. */
  twoFactor: boolean;
  /** When the account was made (epoch ms). */
  createdAt: number;
  /** When it last signed in or used a session, the dashboard or Collect Earth (epoch ms), or null: never since this was kept. */
  lastActiveAt: number | null;
  /** Its email address, and whether the person confirmed it. */
  email: string | null;
  emailConfirmed: boolean;
  /** Locked after failed sign-ins until then (epoch ms), or null. */
  lockedUntil: number | null;
}

export type AccountFilter = 'all' | 'admins' | 'disabled' | 'locked' | 'twoFactor' | 'noTwoFactor' | 'inactive' | 'noEmail';
export type AccountSort = 'name' | 'created' | 'lastActive' | 'projects';

/** GET /v1/admin/users?q=&filter=&sort=&desc=&page=&pageSize= (a query string, read with defaults). */
export interface AccountQuery {
  /** Searched in the name and the address, any case */
  q: string;
  filter: AccountFilter;
  sort: AccountSort;
  desc: boolean;
  /** From 1 */
  page: number;
  pageSize: number;
}

/** GET /v1/admin/users */
export interface AccountPage {
  users: UserSummary[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  /** The accounts of each filter, among those the search finds */
  counts: Record<AccountFilter, number>;
}

/** POST /v1/admin/users/:uid/platform-admin, /disable and /enable: the account as it is now. */
export interface AccountAnswer {
  user: UserSummary;
}

/** One account the administrator made: its link to choose its password, unless it was mailed. */
export type MadeAccount =
  | { username: string; status: 'taken' }
  | { username: string; status: 'created'; userId: string; mailed: boolean; expiresAt: number; setPasswordUrl?: string };

/** POST /v1/admin/users */
export interface MadeAccountsAnswer {
  results: MadeAccount[];
}

/** POST /v1/admin/users/:uid/sign-out */
export interface SignedOutAnswer {
  signedOut: true;
}

/** POST /v1/admin/users/:uid/unlock: whether it was locked. */
export interface UnlockAnswer {
  unlocked: boolean;
}

/** DELETE /v1/admin/users/:uid: the projects only it was in went with it. */
export interface AccountDeletedAnswer {
  deleted: true;
  projectsDeleted: number;
}

/**
 * POST /v1/admin/users/:uid/password-reset: mailed to the account's confirmed address (202), or a link the
 * administrator passes on (201).
 */
export type ResetLinkAnswer = { mailed: true } | { resetUrl: string; expiresAt: number };

// --- the owner's panel ---

/** A count for one UTC day (epoch ms of its midnight). */
export interface DayCount {
  day: number;
  count: number;
}

export interface HourCounts {
  /** The hour's start (epoch ms, UTC). */
  hour: number;
  failedLogins: number;
  rateLimited: number;
}

export interface CountersSnapshot {
  /** When this server process started counting (epoch ms). */
  since: number;
  totals: { failedLogins: number; rateLimited: number };
  /** Hours with any count, oldest first, at most COUNTER_HOURS of the latest ones. */
  hours: HourCounts[];
  /**
   * Automatic check draws worked out after their request had answered, so not stored then (Task 22
   * review): a project whose draws are always this slow gets its checks only from "Draw now" or a
   * later, quicker draw. Since the process started, and when the last one was.
   */
  lateDraws: number;
  lastLateDrawAt: number | null;
}

/** GET /v1/admin/overview: totals only, projects by id (never names, people or answers). */
export interface ServerOverview {
  asOf: number;
  users: {
    total: number;
    disabled: number;
    platformAdmins: number;
    /** Seen in a project or logged in within ACTIVE_DAYS. */
    active: number;
    /** Accounts made per ISO week (UTC), oldest first, SIGNUP_WEEKS of them, empty weeks included. */
    signupsByWeek: { week: string; start: number; count: number }[];
  };
  projects: {
    total: number;
    /** With a member seen or a record received within ACTIVE_DAYS. */
    active: number;
    storageBytes: number;
    /** The largest projects by id (no names: §4b), largest first. */
    largest: { projectId: string; storageBytes: number }[];
  };
  records: {
    /** Records stored in the RECEIVED_DAYS days shown. */
    received: number;
    receivedByDay: DayCount[];
  };
  database: {
    backend: 'memory' | 'postgres';
    sizeBytes: number | null;
    version: string | null;
    /** null on the memory store. `missing`: files this server ships that are not recorded as run. */
    migrations: { applied: number; shipped: number; latest: string | null; newestAppliedAt: number | null; missing: string[] } | null;
  };
  server: { version: string; startedAt: number };
  /** Failed logins and refused requests by hour, counted in memory by this instance since it started. */
  security: CountersSnapshot;
}

// --- projects ---

/** One project in the server administrator's directory: by id only, never its name (§4b). */
export interface AdminProject {
  projectId: string;
  status: ProjectStatus;
  createdAt: number;
  /** The latest of a member seen, a sync and a record stored (epoch ms); null when none yet. */
  lastActivityAt: number | null;
  storageBytes: number;
  /** Its people, any role. */
  people: number;
  /** Its coordinators whose account is enabled. */
  coordinators: number;
  /** Of those, the ones active since the `activeSince` asked (users.last_active_at). */
  activeCoordinators: number;
}

/** A project of the directory as listed: not archived, and no coordinator active in 90 days, is flagged. */
export interface AdminProjectRow extends AdminProject {
  needsCoordinator: boolean;
}

export type ProjectFilter = 'all' | 'noCoordinator' | ProjectStatus;
export type ProjectSort = 'lastActivity' | 'created' | 'storage' | 'people';

/** GET /v1/admin/projects?q=&filter=&sort=&desc=&page=&pageSize= (a query string, read with defaults). */
export interface ProjectQuery {
  /** Part of a project id, any case */
  q: string;
  filter: ProjectFilter;
  sort: ProjectSort;
  desc: boolean;
  page: number;
  pageSize: number;
}

/** GET /v1/admin/projects */
export interface ProjectPage {
  projects: AdminProjectRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  counts: Record<ProjectFilter, number>;
}

/** POST /v1/admin/projects/:pid/archive */
export interface ProjectArchivedAnswer {
  projectId: string;
  status: ProjectStatus;
}

/** POST /v1/admin/projects/:pid/coordinator */
export interface ProjectHandedAnswer {
  projectId: string;
  userId: string;
  username: string;
  wasMember: boolean;
}

// --- the server activity log ---

/** What the server activity log keeps: server administrators' actions (migration 041). */
export type ServerAction =
  | 'settings.changed'
  | 'account.created'
  | 'account.disabled'
  | 'account.enabled'
  | 'account.admin_granted'
  | 'account.admin_removed'
  | 'account.signed_out'
  | 'account.deleted'
  | 'account.reset_link'
  | 'account.reset_mailed'
  | 'account.two_factor_off'
  | 'accounts.exported'
  | 'project.archived'
  | 'project.restored'
  | 'project.coordinator'
  | 'mail.test'
  | 'message.sent'
  | 'alerts.seen'
  | 'account.unlocked';

/** The kinds the log is filtered by: an action's first word ("accounts" counts as "account"). */
export type ServerActionKind = 'settings' | 'account' | 'project' | 'mail' | 'message' | 'alerts';

export interface ServerActivityEntry {
  id: string;
  at: number;
  actorUserId: string | null;
  /** The actor's username when it acted (kept when the account is deleted). */
  actor: string | null;
  action: ServerAction;
  targetUserId: string | null;
  target: string | null;
  projectId: string | null;
  /** Ids, names of settings and counts: never a password, a link or a project's name. */
  details: Record<string, string | number | boolean | null>;
}

/** GET /v1/admin/activity?actor=&kind=&page=&pageSize= */
export interface ServerActivityPage {
  entries: ServerActivityEntry[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  /** Who appears in the log, for its filter */
  actors: string[];
}

// --- Collect Earth versions ---

export interface VersionRow {
  /** The version; null for the old releases that sent none, or a Collect Earth that could not read its own. */
  version: string | null;
  /** 'old': a release before Collect Earth sent its version (CollectEarth-cloud-sync). */
  kind: 'version' | 'old' | 'unnamed';
  accounts: number;
  /** Older than the latest: those accounts should update. */
  outdated: boolean;
}

/** GET /v1/admin/versions: the Collect Earth versions the accounts used in the last `days` days. */
export interface CollectEarthVersions {
  days: number;
  latest: string | null;
  latestConfigured: boolean;
  versions: VersionRow[];
  accounts: number;
  outdatedAccounts: number;
}

// --- mail and messages ---

/** A weekly mail stopped after the mail server refused the address several weeks in a row. */
export interface StoppedDigest {
  userId: string;
  username: string;
  email: string | null;
  kind: DigestKind;
  failures: number;
  stoppedAt: number;
}

/** GET /v1/admin/mail: how the server sends mail, and the weekly mails stopped because the mail server refused the address. */
export interface MailCheck {
  delivers: boolean;
  transport: 'log' | 'smtp' | 'test';
  from: string | null;
  /** The mail server's host and port from SMTP_URL, never its user or password. */
  server: { host: string; port: number | null; secure: boolean } | null;
  publicBaseUrl: string | null;
  digestJob: boolean;
  ownAddress: string | null;
  ownAddressConfirmed: boolean;
  stopped: StoppedDigest[];
}

/** POST /v1/admin/mail/test: sent to the administrator's own address. */
export interface TestMailAnswer {
  sent: true;
  to: string;
}

export type MessageAudience = 'coordinators' | 'everyone';

/** POST /v1/admin/messages/preview and /messages: the message (with `language` for the preview, `recipients` to send). */
export interface ServerMessage {
  audience: MessageAudience;
  subject: string;
  text: string;
}

/** POST /v1/admin/messages/preview: how the message will read and how many it reaches. */
export interface MessagePreview {
  recipients: number;
  subject: string;
  text: string;
  delivers: boolean;
  /** When the next message may go (one an hour), or null: now */
  nextAllowedAt: number | null;
}

/** POST /v1/admin/messages */
export interface MessageSentAnswer {
  recipients: number;
  sent: number;
  failed: number;
}
