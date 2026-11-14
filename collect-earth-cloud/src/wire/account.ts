// Accounts, sign-in, sign-up, the current user, two-step sign-in, email digests, invites, former members and
// server-info, as the server answers them. Types only: see README.md in this folder.
//
// /v1/auth/login, /v1/auth/register, /v1/join/:token and /v1/me are read by the Java desktop client too: these types
// describe that contract, they do not change it.
import type { ProjectStatus } from './projectSettings.js';

/** Membership role within a single project. Authority derives only from these. */
export type Role = 'admin' | 'reviewer' | 'operator';

/** Who may create projects with a session: every logged-in user, or platform admins only. */
export type ProjectCreation = 'anyone' | 'platform-admins';

// --- server-info ---

/** A base map's tiles, as Leaflet asks for them: `{z}/{x}/{y}` (and optionally `{s}`, `{r}`) in the URL. */
export interface MapTiles {
  url: string;
  /** Shown on the map, as the tile source asks (plain text). */
  attribution: string;
  /** Where the attribution links to; null for none. */
  attributionUrl: string | null;
  maxZoom: number;
}

/** The dashboard's error reports (Sentry) and usage events, when the server sends them (its TELEMETRY setting). */
export interface DashboardTelemetry {
  /** The public DSN only (https). */
  sentryDsn: string | null;
  environment: string;
  release: string;
  /** The server forwards the dashboard's usage events (POST /telemetry). */
  events: boolean;
}

/** GET /v1/server-info: what the dashboard needs before anyone logs in. */
export interface ServerInfo {
  needsSetup: boolean;
  signupOpen: boolean;
  projectCreation: ProjectCreation;
  version: string;
  /** Terms of use (http/https): when set, sign-up asks people to accept them. */
  termsUrl: string | null;
  contactEmail: string | null;
  /** Shown in the app bar instead of "Collect Earth Cloud". */
  serverName: string | null;
  /** The AI assistant can be switched on for a project (set up and switched on by the server owner). */
  aiAvailable: boolean;
  /** "Forgot your password?" mails a reset link to an account's confirmed address (the server sends email). */
  selfServiceReset: boolean;
  /** The shortest password the server accepts. */
  minPasswordLength: number;
  /** Open sign-up only with an address of these email domains; null: any. */
  signupDomains: string[] | null;
  /** The map of progress's base map (OpenStreetMap unless the server sets another). */
  mapTiles: MapTiles;
  /**
   * The dashboard runs on the person's own computer, for one person working alone (the server's
   * LOCAL_MODE): what is about other people or the server is hidden (src/localMode.ts).
   */
  localMode: boolean;
  /** Error reports and usage events; null when the server sends none. */
  telemetry: DashboardTelemetry | null;
  /**
   * Which build of the dashboard the server serves (a hash of its index.html, which names the build's hashed
   * files); null when it serves none. A page left open across an upgrade sees it change and offers to reload.
   */
  dashboardBuild: string | null;
}

// --- signing in and up ---

/** A new session: POST /v1/setup, POST /v1/auth/signup (201), and the start of login's and register's answers. */
export interface Session {
  token: string;
  userId: string;
  username: string;
}

/** The project an invitation joined, with the role the account has in it. */
export interface JoinedProject {
  projectId: string;
  projectName: string;
  role: Role;
}

/** POST /v1/auth/login: the session, and the project when an inviteToken came with the login (Collect Earth). */
export type LoginAnswer = Session & Partial<JoinedProject>;

/** POST /v1/auth/register (Collect Earth's Join cloud project): the new account's session and its project. */
export type RegisterAnswer = Session & JoinedProject;

/**
 * POST /v1/auth/signup: the session (201); or, when sign-up is limited to some email domains, no session until the
 * mailed link confirms the address (202).
 */
export type SignupAnswer = Session | { userId: string; username: string; emailConfirmationRequired: true };

// --- the current user ---

/** A user's membership of one project, with the project name for listings. */
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

/** GET /v1/me */
export interface Me {
  userId: string;
  username: string;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  /** Two-step sign-in: on for the account; required of it by the server (it coordinates or administers). */
  twoFactor: { enabled: boolean; required: boolean };
  /** The server owner's announcement, while it lasts (the dashboard lets each person dismiss it). */
  announcement: Announcement | null;
}

export interface ProjectRef {
  projectId: string;
  name: string;
}

/** GET /v1/me/deletion: what deleting the account would do, worked out from its memberships. */
export interface AccountDeletion {
  /** Projects the user is the only coordinator of while others are in them, or that hold records: refusal. */
  soleCoordinator: ProjectRef[];
  /** Projects with no records where the user is the only member and coordinator: deleted with the account. */
  deletedWithAccount: ProjectRef[];
  /** The last platform admin cannot leave: the server would have no owner. */
  lastPlatformAdmin: boolean;
}

// --- two-step sign-in ---

/** POST /v1/me/two-factor/setup: a new secret to put in an authenticator app, as text and as its QR code's address. */
export interface TwoFactorSetup {
  secret: string;
  uri: string;
}

/** POST /v1/me/two-factor/enable and /recovery-codes: the recovery codes, shown once. */
export interface RecoveryCodes {
  recoveryCodes: string[];
}

// --- email digests (Task 19) ---

/** 'coordinator': the weekly summary of the projects someone coordinates; 'collector': their own week. */
export type DigestKind = 'coordinator' | 'collector';

export interface DigestView {
  on: boolean;
  /** Turned off by the server after the mail server refused the address several weeks in a row. */
  stopped: boolean;
  /** The latest week done (mailed, or with nothing to tell). */
  lastSentWeek: string | null;
  /** The latest week a mail actually went for (YYYY-Www), and when. */
  lastMailedWeek: string | null;
  lastSentAt: number | null;
}

/** GET and PUT /v1/me/notifications, PUT /v1/me/email: the account's address and its digests. */
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

/** POST /v1/unsubscribe/:token: the digest turned off. */
export interface UnsubscribeAnswer {
  unsubscribed: true;
  kind: DigestKind;
}

// --- invites ---

/** An open invite as the project admin sees it (the token itself is only shown at creation). */
export interface InviteSummary {
  id: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number;
}

/** An open invitation link; `forUsername`: made for someone already in the project, to get the new project file. */
export interface OpenInvite extends InviteSummary {
  forUsername: string | null;
}

/** GET /v1/projects/:pid/invites */
export interface InvitesAnswer {
  invites: OpenInvite[];
}

/** POST /v1/projects/:pid/invites: the token (shown only here), its relative path and its absolute address. */
export interface NewInvite {
  inviteToken: string;
  joinPath: string;
  joinUrl: string;
  role: Role;
  maxUses: number;
  expiresAt: number | null;
}

/** GET /v1/join/:token: which project and role an invitation grants, before registering. */
export interface JoinPreview {
  projectId: string;
  projectName: string;
  role: Role;
  valid: boolean;
}

// --- former members ---

export interface FormerMember {
  /** Their name as on their records: a username, or former-member-N once anonymised. */
  operator: string;
  records: number;
  anonymized: boolean;
}

/** GET /v1/projects/:pid/former-members */
export interface FormerMembersAnswer {
  formerMembers: FormerMember[];
}

/** POST /v1/projects/:pid/former-members/anonymize: the pseudonym given, and on how many records. */
export interface AnonymizedAnswer {
  operator: string;
  records: number;
}

// --- local mode ---

/** POST /v1/local/sign-in-links (local mode, read by Collect Earth's "My dashboard"): a one-time sign-in link. */
export interface SignInLink {
  path: string;
  url: string;
  expiresInMs: number;
}
