// The view logic of the server page's accounts (pages/ServerAccounts.tsx): the list of accounts to make, read as it is
// typed, and how long ago an account was active.

/** The server's rule for a username (src/accountRules.ts) */
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const MAX_NEW_ACCOUNTS = 100;

export interface AccountProblem {
  kind: "username" | "email" | "twice" | "tooMany";
  /** The line, from 1 (0 for the list as a whole) */
  line: number;
  value: string;
}

/**
 * The accounts to make from what is typed: one per line, "username" or "username, email" (a comma, semicolon, tab or
 * spaces between them); empty lines skipped. The problems found, each with its line, as the server would refuse them.
 */
export function accountsToMake(text: string): { accounts: { username: string; email: string | null }[]; problems: AccountProblem[] } {
  const accounts: { username: string; email: string | null }[] = [];
  const problems: AccountProblem[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    const [username, email = "", ...rest] = line.split(/\s*[,;\t]\s*|\s+/).filter((p) => p !== "");
    if (!USERNAME_RE.test(username)) {
      problems.push({ kind: "username", line: i + 1, value: username });
      return;
    }
    if (rest.length > 0 || (email !== "" && !EMAIL_RE.test(email))) {
      problems.push({ kind: "email", line: i + 1, value: [email, ...rest].join(" ") });
      return;
    }
    if (seen.has(username.toLowerCase())) {
      problems.push({ kind: "twice", line: i + 1, value: username });
      return;
    }
    seen.add(username.toLowerCase());
    accounts.push({ username, email: email === "" ? null : email });
  });
  if (accounts.length > MAX_NEW_ACCOUNTS) problems.push({ kind: "tooMany", line: 0, value: String(MAX_NEW_ACCOUNTS) });
  return { accounts, problems };
}

/** How long ago, in words of the language ("2 days ago", "hace 3 horas"): minutes, hours, days, months or years. */
export function sinceText(at: number, now: number, language: string): string {
  const seconds = Math.round((at - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 365 * 86400], ["month", 30 * 86400], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const format = (value: number, unit: Intl.RelativeTimeFormatUnit) => {
    try {
      return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(value, unit);
    } catch {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(value, unit);
    }
  };
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format(Math.round(seconds / size), unit);
  }
  return format(0, "minute");
}

/** A project's id as the Projects list shows it: its first 8 characters (the whole id is on hover). */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * The filter chips worth showing: "all", the one chosen, and those that would find something (all of them while the
 * counts are not loaded).
 */
export function chipsToShow<F extends string>(filters: readonly F[], chosen: F, counts: Record<F, number> | undefined): F[] {
  return filters.filter((f) => f === "all" || f === chosen || !counts || counts[f] > 0);
}
