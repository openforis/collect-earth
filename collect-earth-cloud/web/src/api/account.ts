// The server's info, signing in and up, the current account, two-step sign-in, email digests and invites.

import type {
  AccountDeletion,
  DigestKind,
  InvitesAnswer,
  JoinPreview,
  LoginAnswer,
  Me,
  NewInvite,
  Notifications,
  OpenInvite,
  RecoveryCodes,
  ServerInfo,
  Session,
  SignupAnswer,
  TwoFactorSetup,
  UnsubscribeAnswer,
} from "../../../src/wire/account";
import { ApiError, p, request, safeUrl, send } from "./transport";
import { Role } from "./common";

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

export type { DigestKind, DigestView, Notifications } from "../../../src/wire/account";

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
