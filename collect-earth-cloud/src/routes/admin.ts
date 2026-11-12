import { telemetry } from '../telemetry.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiAvailable } from '../ai/available.js';
import { limitWindows } from '../ai/service.js';
import { checkCredentials, checkPassword, isEmailAddress, isUuid, publicBaseUrl, setupCodesMatch } from '../accountRules.js';
import { OSM_TILES, type Config } from '../config.js';
import { hashPassword } from '../password.js';
import { requirePlatformAdmin } from '../plugins/projectAuth.js';
import type { RateLimiter } from '../rateLimit.js';
import type { ServerCounters } from '../serverCounters.js';
import { buildOverview, statsWindow, type ServerOverview } from '../serverPanel.js';
import { migrationFiles } from '../store/migrate.js';
import { UsernameTakenError } from '../store/memory.js';
import { isStoredTime, type Store } from '../store/store.js';
import { MAIL_LANGUAGES, type MailLanguage, type ProjectCreation, type ServerSettings } from '../types.js';
import type { AccountMailHooks } from './mail.js';
import { accountDeletionPlan } from './auth.js';
import { accountsCsv, parseAccountQuery, parseNewAccounts, queryAccounts } from '../accounts.js';
import { generateToken } from '../auth.js';
import { logServerAction } from '../serverActivity.js';

/** How long the link of an account a server administrator made works: a week, for its person to find it. */
const WELCOME_TTL_MS = 7 * 24 * 3600 * 1000;

interface SetupBody {
  setupCode?: string;
  username?: string;
  password?: string;
}

interface SignupBody {
  username?: string;
  password?: string;
  email?: string;
  acceptTerms?: boolean;
  /** The page's language, for the confirmation mail. */
  language?: string;
}

interface ResetBody {
  token?: string;
  newPassword?: string;
  /** The page's language, for the notice mailed after the change. */
  language?: string;
}

const PROJECT_CREATION_VALUES: ProjectCreation[] = ['anyone', 'platform-admins'];
const RESET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long the server owner's panel is kept per instance. */
const OVERVIEW_KEPT_MS = 60_000;
const MAX_LIMIT = 1_000_000;
const MAX_TEXT_SETTING = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An http(s) URL, or null if the text is not one. */
function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

type SettingResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** A whole number 0..MAX_LIMIT (0 = no limit). */
function limitSetting(name: string, value: unknown): SettingResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_LIMIT) {
    return { ok: false, reason: `${name} must be a whole number from 0 (no limit) to ${MAX_LIMIT}` };
  }
  return { ok: true, value };
}

/** The AI limits (each per project: a day's reports, a day's follow-ups and questions, a month's tokens) and their largest value; 0 = none allowed. */
const AI_LIMITS = { aiReportsPerDay: 1000, aiFollowUpsPerDay: 10_000, aiMonthlyTokens: 10_000_000_000 } as const;

/** A whole number 0..max, where 0 allows none (the AI limits). */
function quotaSetting(name: string, value: unknown, max: number): SettingResult<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    return { ok: false, reason: `${name} must be a whole number from 0 (none allowed) to ${max}` };
  }
  return { ok: true, value };
}

/** Optional text: null or "" clears it; otherwise checked by `check`, which returns the value to store or null. */
function textSetting(name: string, value: unknown, check: (v: string) => string | null, what: string): SettingResult<string | null> {
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string' || value.trim().length > MAX_TEXT_SETTING) {
    return { ok: false, reason: `${name} must be ${what} (at most ${MAX_TEXT_SETTING} characters) or empty` };
  }
  const checked = check(value.trim());
  return checked === null ? { ok: false, reason: `${name} must be ${what} or empty` } : { ok: true, value: checked };
}

export interface AdminRouteOptions {
  /** The setup code in force (SETUP_CODE, or the one generated at boot). */
  setupCode: string;
  version: string;
  /** The clock of the AI usage month and of the server owner's panel; Date.now by default. */
  now?: () => number;
  /** Failed logins and refused requests (the server owner's panel); none counted when absent. */
  counters?: ServerCounters;
  /** When this process started (epoch ms). */
  startedAt?: number;
  /** The mail routes' confirmation sender, for an address given at sign-up, and the notice after a reset. */
  accountMail?: AccountMailHooks;
  /** Whether "Forgot your password?" can mail a reset link: the server's mail really delivers. */
  selfServiceReset?: boolean;
}

/**
 * Server-level routes for the web dashboard: server info, first-run setup, open
 * sign-up, password reset, and the platform admin's settings/users pages. None of
 * these is project-scoped and none returns project data: a platform admin is not a
 * member of any project and sees only accounts, project COUNTS and, on the panel, project
 * ids with their sizes (§4b).
 */
export async function registerAdminRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
  limiter: RateLimiter,
  options: AdminRouteOptions,
): Promise<void> {
  // Public: what the dashboard needs before anyone logs in.
  app.get('/v1/server-info', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (config.localMode) {
      // The local mode (src/local.ts): one person, signed in by the desktop. Nothing to set up,
      // no sign-up, no new project, no AI; `localMode` tells the dashboard to hide the rest.
      return reply.send({
        localMode: true,
        needsSetup: false,
        signupOpen: false,
        projectCreation: 'platform-admins',
        version: options.version,
        termsUrl: null,
        contactEmail: null,
        serverName: null,
        aiAvailable: false,
        selfServiceReset: false,
        mapTiles: config.mapTiles ?? OSM_TILES,
      });
    }
    const settings = await store.getSettings();
    return reply.send({
      needsSetup: !(await store.hasPlatformAdmin()),
      signupOpen: settings.signupOpen,
      projectCreation: settings.projectCreation,
      version: options.version,
      termsUrl: settings.termsUrl,
      contactEmail: settings.contactEmail,
      serverName: settings.serverName,
      // Whether the AI assistant can be switched on for a project. Never the key or the Vertex settings.
      aiAvailable: aiAvailable(config, settings),
      // "Forgot your password?" mails a reset link (to an account's confirmed address): mail is set up.
      selfServiceReset: options.selfServiceReset === true,
      // The map of progress's base map (OpenStreetMap unless the server sets another).
      mapTiles: config.mapTiles ?? OSM_TILES,
      // The dashboard's error reports (Sentry), when the server sends them: its public DSN only.
      telemetry: telemetry.dashboardConfig(),
    });
  });

  // First-run setup: creates the platform admin. Gated by the setup code so a
  // stranger cannot claim a freshly deployed public server. Once done, always 409.
  app.post('/v1/setup', { preHandler: limiter.guard('setup') }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (await store.hasPlatformAdmin()) {
      return reply.code(409).send({ error: 'already_set_up' });
    }
    const body = (request.body ?? {}) as SetupBody;
    const setupCode = typeof body.setupCode === 'string' ? body.setupCode : '';
    if (!setupCodesMatch(setupCode, options.setupCode)) {
      return reply.code(403).send({ error: 'bad_setup_code' });
    }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rule = checkCredentials(username, password);
    if (rule) {
      return reply.code(400).send(rule);
    }
    let user;
    try {
      user = await store.createFirstPlatformAdmin({ username, passwordHash: await hashPassword(password) });
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        return reply.code(409).send({ error: 'username_taken' });
      }
      throw err;
    }
    if (!user) {
      // Lost a race with a concurrent setup.
      return reply.code(409).send({ error: 'already_set_up' });
    }
    const token = await store.createSession(user.id);
    return reply.code(201).send({ token, userId: user.id, username: user.username });
  });

  // Open sign-up (only when the platform admin turned it on). Accounts made through
  // an invite use /v1/auth/register and are always allowed.
  app.post('/v1/auth/signup', { preHandler: limiter.guard('signup') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const settings = await store.getSettings();
    if (!settings.signupOpen) {
      return reply.code(403).send({ error: 'signup_closed' });
    }
    const body = (request.body ?? {}) as SignupBody;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const email = typeof body.email === 'string' && body.email.trim().length > 0 ? body.email.trim() : null;
    const rule = checkCredentials(username, password);
    if (rule) {
      return reply.code(400).send(rule);
    }
    // The same rule as the account page (Task 19 review): one address, or none.
    if (email !== null && !isEmailAddress(email)) {
      return reply.code(400).send({ error: 'invalid_email', reason: 'that is not one email address' });
    }
    // When the server has terms of use, the person must accept them to sign up.
    if (settings.termsUrl && body.acceptTerms !== true) {
      return reply.code(400).send({ error: 'terms_not_accepted', reason: 'the terms of use must be accepted' });
    }
    const termsAcceptedAt = settings.termsUrl ? Date.now() : null;
    let userId: string;
    try {
      userId = (await store.createUser({ username, passwordHash: await hashPassword(password), email, termsAcceptedAt })).id;
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        return reply.code(409).send({ error: 'username_taken' });
      }
      throw err;
    }
    const token = await store.createSession(userId);
    // An address given here gets its confirmation link, as one given on the account page does: the
    // account page says a link was sent. A refused or failed send leaves the account made; the
    // person can send it again from there.
    const sendConfirmation = options.accountMail?.sendConfirmation;
    if (email !== null && sendConfirmation) {
      const language: MailLanguage = (MAIL_LANGUAGES as readonly unknown[]).includes(body.language) ? (body.language as MailLanguage) : 'en';
      try {
        await sendConfirmation(request, userId, email, language);
      } catch {
        // logged by sendConfirmation
      }
    }
    return reply.code(201).send({ token, userId, username });
  });

  // Whether a reset link still works, checked when its page opens (so a used or expired link says
  // so before a password is typed). Read only: the link is not used. The token is in the path
  // (redacted from the log, logRedact.ts); the same rate limit as the reset itself.
  app.get('/v1/auth/reset/:token', { preHandler: limiter.guard('reset') }, async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    reply.header('referrer-policy', 'no-referrer');
    const token = (request.params as { token: string }).token.trim();
    if (!token || !(await store.checkPasswordReset(token, Date.now()))) {
      return reply.code(410).send({ error: 'invalid_reset_token', reason: 'the link is unknown, used or expired' });
    }
    return reply.send({ valid: true });
  });

  // Password reset with a link a platform admin issued, or one "Forgot your password?" mailed. Single
  // use; revokes every session of the user (desktop client included) so a leaked session dies too,
  // and mails the notice of the change to the account's confirmed address.
  app.post('/v1/auth/reset', { preHandler: limiter.guard('reset') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as ResetBody;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!token) {
      return reply.code(400).send({ error: 'bad_request', reason: 'token and newPassword are required' });
    }
    // Check the password before consuming, so a too-short attempt does not burn the link.
    const rule = checkPassword(newPassword);
    if (rule) {
      return reply.code(400).send(rule);
    }
    const userId = await store.consumePasswordReset(token, Date.now());
    if (!userId) {
      return reply.code(410).send({ error: 'invalid_reset_token', reason: 'the link is unknown, used or expired' });
    }
    await store.setPassword(userId, await hashPassword(newPassword));
    await store.deleteUserSessions(userId);
    options.accountMail?.passwordChanged?.(request, userId, 'reset', body.language);
    return reply.code(204).send();
  });

  app.get(
    '/v1/admin/settings',
    { preHandler: requirePlatformAdmin(store) },
    // aiConfigured: only whether the AI configuration is there (never the key or the Vertex settings).
    async (_request: FastifyRequest, reply: FastifyReply) => reply.send({ ...(await store.getSettings()), aiConfigured: config.aiConfigured === true }),
  );

  app.put(
    '/v1/admin/settings',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: Partial<ServerSettings> = {};
      if (body.signupOpen !== undefined) {
        if (typeof body.signupOpen !== 'boolean') {
          return reply.code(400).send({ error: 'bad_request', reason: 'signupOpen must be true or false' });
        }
        patch.signupOpen = body.signupOpen;
      }
      if (body.twoFactorForCoordinators !== undefined) {
        if (typeof body.twoFactorForCoordinators !== 'boolean') {
          return reply.code(400).send({ error: 'bad_request', reason: 'twoFactorForCoordinators must be true or false' });
        }
        // The administrator who turns it on must have it, or the server panel would lock them out at once
        const own = body.twoFactorForCoordinators ? await store.getTwoFactor(request.userId!) : null;
        if (body.twoFactorForCoordinators && !(own?.enabledAt && own.secretEnc)) {
          return reply.code(409).send({ error: 'set_up_two_factor_first', reason: 'set up two-step sign-in on your own account first' });
        }
        patch.twoFactorForCoordinators = body.twoFactorForCoordinators;
      }
      if (body.aiEnabled !== undefined) {
        if (typeof body.aiEnabled !== 'boolean') {
          return reply.code(400).send({ error: 'bad_request', reason: 'aiEnabled must be true or false' });
        }
        patch.aiEnabled = body.aiEnabled;
      }
      for (const [key, max] of Object.entries(AI_LIMITS) as [keyof typeof AI_LIMITS, number][]) {
        if (body[key] !== undefined) {
          const r = quotaSetting(key, body[key], max);
          if (!r.ok) {
            return reply.code(400).send({ error: 'bad_request', reason: r.reason });
          }
          patch[key] = r.value;
        }
      }
      if (body.projectCreation !== undefined) {
        if (!PROJECT_CREATION_VALUES.includes(body.projectCreation as ProjectCreation)) {
          return reply.code(400).send({ error: 'bad_request', reason: 'projectCreation must be "anyone" or "platform-admins"' });
        }
        patch.projectCreation = body.projectCreation as ProjectCreation;
      }
      for (const key of ['maxProjectsPerUser', 'maxProjectStorageMb'] as const) {
        if (body[key] !== undefined) {
          const r = limitSetting(key, body[key]);
          if (!r.ok) {
            return reply.code(400).send({ error: 'bad_request', reason: r.reason });
          }
          patch[key] = r.value;
        }
      }
      const texts = [
        ['termsUrl', httpUrl, 'an http:// or https:// address'],
        ['contactEmail', (v: string) => (EMAIL_RE.test(v) ? v : null), 'an email address'],
        ['serverName', (v: string) => v, 'a name'],
      ] as const;
      for (const [key, check, what] of texts) {
        if (body[key] !== undefined) {
          const r = textSetting(key, body[key], check, what);
          if (!r.ok) {
            return reply.code(400).send({ error: 'bad_request', reason: r.reason });
          }
          patch[key] = r.value;
        }
      }
      // The announcement banner: plain text (shown as text, never as HTML) and when it ends.
      if (body.announcement !== undefined) {
        const r = textSetting('announcement', body.announcement, (v) => v, 'a short message');
        if (!r.ok) {
          return reply.code(400).send({ error: 'bad_request', reason: r.reason });
        }
        patch.announcement = r.value;
      }
      if (body.announcementUntil !== undefined) {
        if (body.announcementUntil !== null && !isStoredTime(body.announcementUntil)) {
          return reply.code(400).send({ error: 'bad_request', reason: 'announcementUntil must be a time (epoch ms) or null' });
        }
        patch.announcementUntil = body.announcementUntil as number | null;
      }
      const before = await store.getSettings();
      const after = await store.updateSettings(patch);
      // Which settings changed: a switch or a number with its new value, a text only as changed
      const changed: Record<string, string | number | boolean | null> = {};
      for (const key of Object.keys(patch) as (keyof ServerSettings)[]) {
        const value = after[key];
        if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
        changed[key] = typeof value === 'boolean' || typeof value === 'number' || value === null ? value : 'changed';
      }
      if (Object.keys(changed).length > 0) await logServerAction(store, request, { action: 'settings.changed', details: changed });
      return reply.send({ ...after, aiConfigured: config.aiConfigured === true });
    },
  );

  // Accounts with a project count only — no project names or ids (§4b).
  // The accounts, searched, filtered, sorted and in pages (src/accounts.ts): ?q=&filter=&sort=&desc=&page=&pageSize=.
  // No project names: how many projects each account is in only (§4b).
  app.get(
    '/v1/admin/users',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) =>
      reply.header('cache-control', 'no-store').send(queryAccounts(await store.listUsers(), parseAccountQuery(request.query), Date.now())),
  );

  // The same accounts as a CSV, every page of them
  app.get(
    '/v1/admin/users.csv',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = { ...parseAccountQuery(request.query), page: 1, pageSize: Number.MAX_SAFE_INTEGER };
      const { users } = queryAccounts(await store.listUsers(), query, Date.now());
      await logServerAction(store, request, { action: 'accounts.exported', details: { accounts: users.length } });
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="accounts.csv"')
        .header('cache-control', 'no-store')
        .send(accountsCsv(users));
    },
  );

  // Accounts a server administrator makes, also when sign-up is closed: each gets a link to choose its password (seven
  // days), mailed to the address given when the server sends mail (then not shown here), else given to pass on.
  app.post(
    '/v1/admin/users',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const accounts = parseNewAccounts(request.body);
      if (!Array.isArray(accounts)) return reply.code(400).send({ error: 'bad_request', ...accounts });
      const body = (request.body ?? {}) as { mail?: unknown; language?: unknown };
      const results: {
        username: string;
        status: 'created' | 'taken';
        userId?: string;
        mailed?: boolean;
        setPasswordUrl?: string;
        expiresAt?: number;
      }[] = [];
      for (const a of accounts) {
        if (await store.isAccountUsername(a.username)) {
          results.push({ username: a.username, status: 'taken' });
          continue;
        }
        let user;
        try {
          // A password nobody knows: the account is used once its person chose one with the link
          user = await store.createUser({ username: a.username, passwordHash: await hashPassword(generateToken()), email: a.email });
        } catch (err) {
          if (err instanceof UsernameTakenError) {
            results.push({ username: a.username, status: 'taken' });
            continue;
          }
          throw err;
        }
        const expiresAt = Date.now() + WELCOME_TTL_MS;
        const token = await store.createPasswordReset(user.id, expiresAt);
        const url = `${publicBaseUrl(config, request)}/reset/${token}`;
        const mailed = a.email !== null && body.mail !== false && (await options.accountMail?.mailWelcome?.(request, user.id, a.email, body.language, url)) === true;
        results.push({ username: a.username, status: 'created', userId: user.id, mailed, expiresAt, ...(mailed ? {} : { setPasswordUrl: url }) });
        await logServerAction(store, request, { action: 'account.created', targetUserId: user.id, targetName: user.username, details: { mailed } });
      }
      kept = null;
      return reply.code(201).send({ results });
    },
  );

  // Makes an account a server administrator, or takes the role back: not one's own (the page would close on them), never
  // the last enabled one.
  app.post(
    '/v1/admin/users/:uid/platform-admin',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      const on = ((request.body ?? {}) as { on?: unknown }).on;
      if (!isUuid(uid)) return reply.code(404).send({ error: 'not_found' });
      if (typeof on !== 'boolean') return reply.code(400).send({ error: 'bad_request', reason: 'on must be true or false' });
      if (uid === request.userId) return reply.code(409).send({ error: 'own_account', reason: 'another administrator changes your own role' });
      const result = await store.setPlatformAdmin(uid, on);
      if (result === 'not_found') return reply.code(404).send({ error: 'not_found' });
      if (result === 'last_platform_admin') return reply.code(409).send({ error: 'last_enabled_admin', reason: 'the server must keep one enabled platform admin' });
      kept = null;
      const user = (await store.listUsers()).find((u) => u.userId === uid);
      await logServerAction(store, request, { action: on ? 'account.admin_granted' : 'account.admin_removed', targetUserId: uid, targetName: user?.username ?? null });
      return reply.send({ user });
    },
  );

  // Ends every session of an account, Collect Earth's included: it signs in again (a lost laptop, a shared password).
  app.post(
    '/v1/admin/users/:uid/sign-out',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      const target = isUuid(uid) ? await store.getUserById(uid) : null;
      if (!target) return reply.code(404).send({ error: 'not_found' });
      if (uid === request.userId) return reply.code(409).send({ error: 'own_account', reason: 'sign out of your own sessions from your account page' });
      await store.deleteUserSessions(uid);
      await logServerAction(store, request, { action: 'account.signed_out', targetUserId: uid, targetName: target.username });
      return reply.send({ signedOut: true });
    },
  );

  // Deletes an account, as its person could (DELETE /v1/me): its sessions, memberships and personal data go, the plots it
  // collected stay in their projects under its name, the projects only it was in go with it. Refused for one's own
  // account, the last administrator, and the only coordinator of a project others work in (its ids are told). The
  // account's username is typed again to confirm.
  app.delete(
    '/v1/admin/users/:uid',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      const user = isUuid(uid) ? await store.getUserById(uid) : null;
      if (!user) return reply.code(404).send({ error: 'not_found' });
      if (uid === request.userId) return reply.code(409).send({ error: 'own_account', reason: 'delete your own account from your account page' });
      const confirm = ((request.body ?? {}) as { confirm?: unknown }).confirm;
      if (confirm !== user.username) return reply.code(400).send({ error: 'confirm_username', reason: 'type the account\'s username to confirm' });
      const plan = await accountDeletionPlan(store, user.id, user.isPlatformAdmin);
      if (plan.lastPlatformAdmin) return reply.code(409).send({ error: 'last_enabled_admin', reason: 'the server must keep one enabled platform admin' });
      if (plan.soleCoordinator.length > 0) {
        return reply.code(409).send({ error: 'sole_coordinator', projectIds: plan.soleCoordinator.map((p) => p.projectId) });
      }
      if ((await store.deleteUser(user.id)) === 'last_platform_admin') {
        return reply.code(409).send({ error: 'last_enabled_admin', reason: 'the server must keep one enabled platform admin' });
      }
      for (const p of plan.deletedWithAccount) await store.deleteProject(p.projectId);
      kept = null;
      await logServerAction(store, request, { action: 'account.deleted', targetName: user.username, details: { projectsDeleted: plan.deletedWithAccount.length } });
      return reply.send({ deleted: true, projectsDeleted: plan.deletedWithAccount.length });
    },
  );

  // The AI assistant's use this calendar month (UTC), per project: counts and tokens by
  // project id only, never a name, a question, a result or who asked (§4b).
  app.get(
    '/v1/admin/ai-usage',
    { preHandler: requirePlatformAdmin(store) },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const w = limitWindows((options.now ?? Date.now)());
      const usage = await store.aiUsageSince(w.monthStart);
      const projects = usage
        .map((u) => ({ ...u, tokens: u.inputTokens + u.outputTokens }))
        .sort((a, b) => b.tokens - a.tokens || (a.projectId < b.projectId ? -1 : 1));
      const sum = (k: 'runs' | 'reports' | 'followUps' | 'questions' | 'failed' | 'refused' | 'inputTokens' | 'outputTokens' | 'tokens') =>
        projects.reduce((n, p) => n + p[k], 0);
      return reply.send({
        month: new Date(w.monthStart).toISOString().slice(0, 7),
        from: w.monthStart,
        until: w.nextMonth,
        projects,
        totals: {
          runs: sum('runs'),
          reports: sum('reports'),
          followUps: sum('followUps'),
          questions: sum('questions'),
          failed: sum('failed'),
          refused: sum('refused'),
          inputTokens: sum('inputTokens'),
          outputTokens: sum('outputTokens'),
          tokens: sum('tokens'),
        },
      });
    },
  );

  // The server owner's panel (Task 11): totals across projects, never a project's name, a
  // person's name or an answer; projects appear by id with their size only (§4b). It reads
  // every project, so it is kept a minute per instance (its asOf says how old it is),
  // dropped when an account is disabled or enabled, and behind the rate limiter.
  let kept: { at: number; body: ServerOverview } | null = null;
  app.get(
    '/v1/admin/overview',
    { preHandler: [limiter.guard('admin'), requirePlatformAdmin(store)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const now = (options.now ?? Date.now)();
      if (kept && now >= kept.at && now - kept.at < OVERVIEW_KEPT_MS) {
        return reply.send(kept.body);
      }
      const [stats, health] = await Promise.all([store.platformStats(statsWindow(now)), store.databaseHealth()]);
      const body = buildOverview({
        now,
        stats,
        health,
        backend: config.storeBackend,
        shippedMigrations: migrationFiles(),
        version: options.version,
        startedAt: options.startedAt ?? now,
        security: options.counters?.snapshot() ?? { since: options.startedAt ?? now, totals: { failedLogins: 0, rateLimited: 0 }, hours: [], lateDraws: 0, lastLateDrawAt: null },
      });
      kept = { at: now, body };
      return reply.send(body);
    },
  );

  /** The reference copies of every project of the account, after it was disabled or enabled (Task 14). */
  async function syncProjectsOf(request: FastifyRequest, userId: string): Promise<void> {
    const sync = request.server.referenceSync;
    if (!sync) return;
    for (const m of await store.listMemberships(userId)) await sync(m.projectId, request.log);
  }

  // Disable an account: it cannot log in, its sessions (Collect Earth's too) and reset links
  // go. Not yourself, not the last enabled platform admin. Written to the server log (there is
  // no project to hold it in audit_log); who and when stay on the account (disabledAt/By).
  app.post(
    '/v1/admin/users/:uid/disable',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      if (!isUuid(uid)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (uid === request.userId) {
        return reply.code(409).send({ error: 'own_account', reason: 'you cannot disable your own account' });
      }
      const result = await store.disableUser(uid, request.userId!);
      if (result === 'not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (result === 'last_platform_admin') {
        return reply.code(409).send({ error: 'last_enabled_admin', reason: 'the server must keep one enabled platform admin' });
      }
      kept = null;
      const disabled = (await store.listUsers()).find((u) => u.userId === uid);
      await logServerAction(store, request, { action: 'account.disabled', targetUserId: uid, targetName: disabled?.username ?? null });
      await syncProjectsOf(request, uid);
      return reply.send({ user: disabled });
    },
  );

  app.post(
    '/v1/admin/users/:uid/enable',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      if (!isUuid(uid) || (await store.enableUser(uid)) === 'not_found') {
        return reply.code(404).send({ error: 'not_found' });
      }
      kept = null;
      const enabled = (await store.listUsers()).find((u) => u.userId === uid);
      await logServerAction(store, request, { action: 'account.enabled', targetUserId: uid, targetName: enabled?.username ?? null });
      await syncProjectsOf(request, uid);
      return reply.send({ user: enabled });
    },
  );

  // Issue a reset link. Platform admin only: a project admin resetting a user who
  // also belongs to another project would reach across the tenant boundary. An account
  // with a confirmed address gets it by mail (202 { mailed }), never shown to the
  // administrator, who could otherwise sign in as any coordinator and see their projects;
  // only an account no mail can reach gets a link the administrator passes on (201).
  app.post(
    '/v1/admin/users/:uid/password-reset',
    { preHandler: requirePlatformAdmin(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const uid = (request.params as { uid: string }).uid;
      const user = isUuid(uid) ? await store.getUserById(uid) : null;
      if (!user) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (user.disabledAt) {
        return reply.code(409).send({ error: 'account_disabled', reason: 'enable the account first' });
      }
      if (await options.accountMail?.mailResetLink?.(request, user.id)) {
        await logServerAction(store, request, { action: 'account.reset_mailed', targetUserId: user.id, targetName: user.username });
        return reply.code(202).send({ mailed: true });
      }
      const expiresAt = Date.now() + RESET_TTL_MS;
      // Null when the account was disabled meanwhile: the store checks it in the same statement.
      const token = await store.createPasswordReset(user.id, expiresAt);
      if (token === null) {
        return reply.code(409).send({ error: 'account_disabled', reason: 'enable the account first' });
      }
      await logServerAction(store, request, { action: 'account.reset_link', targetUserId: user.id, targetName: user.username });
      return reply.code(201).send({ resetUrl: `${publicBaseUrl(config, request)}/reset/${token}`, expiresAt });
    },
  );
}
