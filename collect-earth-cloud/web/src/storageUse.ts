import { formatBytes } from "./format";
import type { MessageKey, Translate } from "./i18n";

// How full a project is, in plain words: "Space used: 12 MB of 200 MB", with a warning
// when it is nearly full (90 %) and another when it is over. Collectors' plots are always
// received, even over the limit; only the coordinator's uploads are refused.

export type StorageLevel = "noLimit" | "ok" | "nearlyFull" | "over";

export const NEARLY_FULL = 0.9;

export function storageLevel(usedBytes: number, limitBytes: number | null): StorageLevel {
  if (limitBytes === null || limitBytes <= 0) return "noLimit";
  if (usedBytes > limitBytes) return "over";
  if (usedBytes >= limitBytes * NEARLY_FULL) return "nearlyFull";
  return "ok";
}

/** 0..100 for a progress bar (capped at 100 when over); null without a limit. */
export function storagePercent(usedBytes: number, limitBytes: number | null): number | null {
  if (limitBytes === null || limitBytes <= 0) return null;
  return Math.min(100, Math.max(0, (usedBytes / limitBytes) * 100));
}

/** "Space used: 12 MB of 200 MB" (or just "Space used: 12 MB" without a limit). */
export function storageText(usedBytes: number, limitBytes: number | null, t: Translate, language: string): string {
  const used = formatBytes(usedBytes, language);
  if (limitBytes === null || limitBytes <= 0) return t("storage.usedNoLimit", { used });
  return t("storage.used", { used, limit: formatBytes(limitBytes, language) });
}

/** The warning to show under the space used, if any. */
export function storageWarningKey(level: StorageLevel): MessageKey | null {
  if (level === "over") return "storage.over";
  if (level === "nearlyFull") return "storage.nearlyFull";
  return null;
}
