// The view logic of "New project from a Collect Earth backup" (pages/BackupImportDialog.tsx): what the plot layout comes
// to, whether it can be made, and whether a backup fits in one request.
import type { MessageKey } from "./i18n";
import type { PlotLayout } from "./api";

/**
 * The largest backup sent in one go: it travels in base64 (a third larger) inside a request of at most 32 MB, with the
 * plot file beside it.
 */
export const MAX_BACKUP_BYTES = 23 * 1024 * 1024;

/** Megabytes, one decimal, as the message shows them. */
export const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** A square's side and a plot's area, in metres and hectares; null when the layout is not one Collect Earth makes. */
export function layoutSize(l: PlotLayout): { side: number | null; areaHa: number } | null {
  if (!(l.distance > 0)) return null;
  if (l.shape === "CIRCLE") return { side: null, areaHa: (Math.PI * l.distance ** 2) / 10_000 };
  const n = Math.round(Math.sqrt(Math.max(l.points, 1)));
  const side = (n - 1) * l.distance + 2 * l.boundary;
  return side > 0 ? { side, areaHa: side ** 2 / 10_000 } : null;
}

/** What is wrong with a layout, as a message; null when it can be made. */
export function layoutProblem(l: PlotLayout): MessageKey | null {
  if (l.shape === "SQUARE" && l.points > 1 && !Number.isInteger(Math.sqrt(l.points))) return "backupImport.squarePoints";
  if (!Number.isInteger(l.points) || l.points < 0 || !(l.distance >= 0.1) || !(l.boundary >= 0) || !(l.pointSide >= 0.1)) return "error.required";
  return null;
}

/** A number of metres or hectares, at most two decimals, as people read them. */
export const round2 = (n: number) => String(Math.round(n * 100) / 100);

/** A CSV file's text: UTF-8, or Windows-1252 when it is not (older plot files), so accented strata keep their letters. */
export function csvText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
