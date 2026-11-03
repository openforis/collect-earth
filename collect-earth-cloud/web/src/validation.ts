import type { MessageKey } from "./i18n";

// The server's rules for new usernames and passwords (signup, setup, password change
// and reset), checked before sending so the person gets the answer straight away.

export const USERNAME_PATTERN = /^[A-Za-z0-9._\-@]{3,64}$/;
export const MIN_PASSWORD_LENGTH = 8;

export function usernameProblem(username: string): MessageKey | null {
  return USERNAME_PATTERN.test(username.trim()) ? null : "error.badUsername";
}

export function passwordProblem(password: string, repeated?: string): MessageKey | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "error.weakPassword";
  if (repeated !== undefined && repeated !== password) return "error.passwordsDiffer";
  return null;
}
