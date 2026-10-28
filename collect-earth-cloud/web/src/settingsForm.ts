import type { ServerSettings } from "./api";
import type { MessageKey } from "./i18n";

// The server page's limits and "about this server" boxes: text in, settings out, with
// the same rules the server applies (so most mistakes are caught before saving).

export interface SettingsDraft {
  maxProjectsPerUser: string;
  maxProjectStorageMb: string;
  serverName: string;
  termsUrl: string;
  contactEmail: string;
}

export type DraftProblems = Partial<Record<keyof SettingsDraft, MessageKey>>;

const MAX_LIMIT = 1_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function draftOf(settings: ServerSettings): SettingsDraft {
  return {
    maxProjectsPerUser: String(settings.maxProjectsPerUser),
    maxProjectStorageMb: String(settings.maxProjectStorageMb),
    serverName: settings.serverName ?? "",
    termsUrl: settings.termsUrl ?? "",
    contactEmail: settings.contactEmail ?? "",
  };
}

/** A whole number 0..1 000 000 ("" counts as 0, no limit); null when it is not one. */
export function parseLimit(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n <= MAX_LIMIT ? n : null;
}

export function isWebAddress(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The settings to save, or the problems to show next to each box. */
export function readDraft(draft: SettingsDraft): { changes: Partial<ServerSettings>; problems: DraftProblems } {
  const problems: DraftProblems = {};
  const maxProjectsPerUser = parseLimit(draft.maxProjectsPerUser);
  const maxProjectStorageMb = parseLimit(draft.maxProjectStorageMb);
  if (maxProjectsPerUser === null) problems.maxProjectsPerUser = "server.badNumber";
  if (maxProjectStorageMb === null) problems.maxProjectStorageMb = "server.badNumber";
  const termsUrl = draft.termsUrl.trim();
  if (termsUrl && !isWebAddress(termsUrl)) problems.termsUrl = "server.badUrl";
  const contactEmail = draft.contactEmail.trim();
  if (contactEmail && !EMAIL_RE.test(contactEmail)) problems.contactEmail = "server.badEmail";
  const serverName = draft.serverName.trim();
  return {
    problems,
    changes: {
      maxProjectsPerUser: maxProjectsPerUser ?? 0,
      maxProjectStorageMb: maxProjectStorageMb ?? 0,
      serverName: serverName || null,
      termsUrl: termsUrl || null,
      contactEmail: contactEmail || null,
    },
  };
}
