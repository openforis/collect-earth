// The view logic of the server page's safety settings (pages/ServerSettings.tsx, stage D): whole numbers in a range,
// the sign-up domains and the alerts' webhook read as the server reads them, so a mistake is said before saving.

/** A whole number from min to max as typed, or null. */
export function wholeIn(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The sign-up domains as typed (commas, spaces or new lines between them): "a.org,b.org", null for none, undefined when wrong. */
export function signupDomainsOf(text: string): string | null | undefined {
  const domains = [...new Set(text.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter((d) => d !== ""))];
  if (domains.length === 0) return null;
  if (domains.length > 20 || domains.some((d) => d.length > 253 || !DOMAIN_RE.test(d))) return undefined;
  return domains.join(",");
}

/** Whether an address is a Slack or Microsoft Teams incoming webhook the server posts to (src/alertWebhook.ts). */
export function isWebhookUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port !== "" && url.port !== "443")) return false;
  const h = url.hostname.toLowerCase();
  return h === "hooks.slack.com" || h.endsWith(".webhook.office.com") || h.endsWith(".logic.azure.com") || h.endsWith(".api.powerplatform.com");
}

/** Whether an address is of one of the domains (or their subdomains); true when sign-up is not limited. */
export function emailInDomains(email: string, domains: readonly string[] | null | undefined): boolean {
  if (!domains || domains.length === 0) return true;
  const host = email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
