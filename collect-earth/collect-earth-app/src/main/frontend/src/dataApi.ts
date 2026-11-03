import { apiGet, apiPost } from "./apiClient";
import type { ExportRequest } from "./exportDialog";
import type { ImportSummaryResult } from "./importDialog";

/** The calls of the Data menu (DataController, FilesController). */

export interface ExportAttribute { id: string; label: string; name: string; type: "KEY" | "SUMMARY"; position: number }

export interface ExportOptions { formats: string[]; attributes: ExportAttribute[]; lastExport: number | null; survey: string | null }

export const exportOptions = (signal?: AbortSignal) => apiGet<ExportOptions>("data/export/options", signal);

export const exportFileName = (request: Omit<ExportRequest, "path">, signal?: AbortSignal) =>
  apiPost<{ name: string; extension: string }>("data/export/fileName", request, signal);

/** Starts the export job; answers its id. */
export const startExport = (request: ExportRequest) => apiPost<{ id: string }>("jobs/export", request).then((r) => r.id);

export const csvInfo = (signal?: AbortSignal) => apiGet<{ keyAttributes: string[] }>("data/import/csvInfo", signal);

export const startImportSummary = (files: string[], includeNonFinished: boolean) =>
  apiPost<{ id: string }>("jobs/importSummary", { files, includeNonFinished }).then((r) => r.id);

export const startImport = (token: string, overwrite: string[]) => apiPost<{ id: string }>("jobs/import", { token, overwrite }).then((r) => r.id);

export const startUpdateCsv = (files: string[]) => apiPost<{ id: string }>("jobs/updateCsv", { files }).then((r) => r.id);

export const openFile = (path: string) => apiPost<void>("files/open", { path });

export const revealFile = (path: string) => apiPost<void>("files/reveal", { path });

/** Several files from the native dialog, none when the user cancelled. */
export async function chooseFiles(extensions: string[]): Promise<string[]> {
  const r = await apiPost<{ paths?: string[]; cancelled?: boolean }>("files/choose", { mode: "OPEN", extensions, multiple: true });
  return r.paths ?? [];
}

/** The summaries of a finished importSummary job, as its result holds them. */
export const summaryResultOf = (result: unknown): ImportSummaryResult | null =>
  result && typeof result === "object" && "files" in result ? (result as ImportSummaryResult) : null;
