/**
 * The import dialogs' logic: what the summaries of the ZIP files say, the answers about the conflicting records, and
 * what the import job is told (ImportService on the server).
 */

export interface ImportConflict {
  keys: string[];
  modified: number | null;
  completion: number;
  existingModified: number | null;
  existingCompletion: number;
}

export interface ImportFileSummary {
  path: string;
  name: string;
  toImport: number;
  conflicts: ImportConflict[];
  errors: string[];
}

/** The result of the importSummary job */
export interface ImportSummaryResult { token: string | null; files: ImportFileSummary[] }

/** The paths whose conflicting records are to be overwritten: the files with conflicts the user said yes to. */
export function overwritePaths(files: ImportFileSummary[], answers: Record<string, boolean>): string[] {
  return files.filter((f) => f.conflicts.length > 0 && answers[f.path] === true).map((f) => f.path);
}

/** The counts the dialog shows before importing. */
export function totals(files: ImportFileSummary[], answers: Record<string, boolean>) {
  let toImport = 0, overwritten = 0, kept = 0, failed = 0;
  for (const f of files) {
    if (f.errors.length > 0 && f.toImport === 0 && f.conflicts.length === 0) failed++;
    toImport += f.toImport;
    if (answers[f.path] === true) overwritten += f.conflicts.length; else kept += f.conflicts.length;
  }
  return { toImport, overwritten, kept, failed, total: toImport + overwritten };
}

/** Whether there is anything to import: a token, and a record to import or a conflict to overwrite. */
export function canImport(result: ImportSummaryResult | null, answers: Record<string, boolean>): boolean {
  return result !== null && result.token !== null && totals(result.files, answers).total > 0;
}

/** The result of the updateCsv job */
export interface CsvUpdateFile { path: string; name: string; updated: number; errors: string[] }

export const csvFilesOf = (result: unknown): CsvUpdateFile[] =>
  result && typeof result === "object" && Array.isArray((result as { files?: unknown }).files) ? (result as { files: CsvUpdateFile[] }).files : [];
