// The project's plots are one set (docs/plans/2026-11-16-plots-from-the-server.md, stage 3). The plot files are where
// the plots came from (an upload, the project file, a design, SIGRID, CEO, a backup); what is divided between people,
// and what each person gets in one file (src/myPlots.ts), is the project's plots. Two rules make that possible, checked
// when a plot file is added or replaced:
// - a plot is in one plot file only: another file's plot would be the same record twice;
// - every plot file has the same columns: as many of them, and the same extra columns after the keys and the two
//   coordinates, in any order and letter case (sameColumns; Collect Earth reads the keys and the coordinates by place,
//   so they may be named lat, YCoordinate...). The project's first plot file sets them.
// A project from before the rules may break them: its plot files are flagged (oneSetFlags), and the person's plots
// leave out a file with other columns.
import { sameColumns } from './myPlots.js';
import { plotFileOf } from './plotFileCache.js';
import type { PlotFile } from './plots.js';
import type { Store } from './store/store.js';

/** Why a plot file breaks the rules, for the 409 */
export type OneSetRefusal =
  | { error: 'columns_differ'; reason: string; expected: string[] | null; found: string[] | null; file: string }
  | { error: 'plots_in_other_file'; reason: string; plots: string[]; count: number; files: string[] };

/** The plot files of the project as Collect Earth reads them (the round the server adds is not in them), but `except` */
async function projectFiles(store: Store, projectId: string, keyCount: number, except?: string) {
  const metas = (await store.listCsvFiles(projectId)).filter((m) => m.filename !== except);
  const files: { id: string; filename: string; plotFile: PlotFile }[] = [];
  for (const meta of metas) {
    const file = await store.getCsvFile(projectId, meta.id);
    if (file) files.push({ id: meta.id, filename: meta.filename, plotFile: plotFileOf(file, keyCount) });
  }
  return files;
}

/** The columns a project's plot files have: those of the one with the most plots (its header, or its width) */
function referenceOf(files: readonly { filename: string; plotFile: PlotFile }[]) {
  let best: (typeof files)[number] | null = null;
  for (const f of files) {
    if (!best || f.plotFile.plotIds.length > best.plotFile.plotIds.length) best = f;
  }
  return best;
}

/** Whether a file has the columns of the reference (sameColumns; without a header row, as many columns) */
function columnsMatch(reference: PlotFile, file: PlotFile, lead: number): boolean {
  if (reference.header && file.header) return sameColumns(reference.header.fields, file.header.fields, lead) !== null;
  return reference.columnCount === file.columnCount;
}

/**
 * Whether a plot file (named `filename`, its content `parsed` with `keyCount` key columns as uploaded) may join the
 * project's plots: the reason when it may not. Replacing a file of that name is held to the other files.
 */
export async function oneSetRefusal(store: Store, projectId: string, filename: string, parsed: PlotFile, keyCount: number): Promise<OneSetRefusal | null> {
  const others = await projectFiles(store, projectId, keyCount, filename);
  if (others.length === 0) return null;
  const reference = referenceOf(others)!;
  if (!columnsMatch(reference.plotFile, parsed, keyCount + 2)) {
    return {
      error: 'columns_differ',
      reason:
        `The project's plots are one set, so every plot file has the same columns. This file's columns differ from those of ${reference.filename}: ` +
        'as many columns are needed, and after the plot id and the coordinates the same names (in any order).',
      expected: reference.plotFile.header?.fields ?? null,
      found: parsed.header?.fields ?? null,
      file: reference.filename,
    };
  }
  const where = new Map<string, string>();
  for (const f of others) {
    for (const id of f.plotFile.plotIds) if (!where.has(id)) where.set(id, f.filename);
  }
  const clash = parsed.plotIds.filter((id) => where.has(id));
  if (clash.length > 0) {
    return {
      error: 'plots_in_other_file',
      reason: `The project's plots are one set, so a plot is in one plot file only. ${clash.length} plots of this file are in another plot file already: leave them out, or give them other ids.`,
      plots: clash.slice(0, 20),
      count: clash.length,
      files: [...new Set(clash.map((id) => where.get(id)!))].slice(0, 5),
    };
  }
  return null;
}

/** What breaks the rules in a project from before them, per plot file */
export interface OneSetFlags {
  /** Its columns are not the project's (the file with the most plots): the person's plots leave it out */
  columnsDiffer: boolean;
  /** Its plots that another plot file has too */
  sharedPlots: number;
}

/** The flags of each plot file of the project, by id (none broken: every flag false and 0) */
export async function oneSetFlags(store: Store, projectId: string, keyCount: number): Promise<Map<string, OneSetFlags>> {
  const files = await projectFiles(store, projectId, keyCount);
  const reference = referenceOf(files);
  const count = new Map<string, number>();
  for (const f of files) {
    for (const id of f.plotFile.plotIds) count.set(id, (count.get(id) ?? 0) + 1);
  }
  const flags = new Map<string, OneSetFlags>();
  for (const f of files) {
    flags.set(f.id, {
      columnsDiffer: reference !== null && f !== reference && !columnsMatch(reference.plotFile, f.plotFile, keyCount + 2),
      sharedPlots: f.plotFile.plotIds.filter((id) => (count.get(id) ?? 0) > 1).length,
    });
  }
  return flags;
}

/** The next plot number free in the project: 1 + the largest whole number among its plot ids (1 when none) */
export async function nextPlotNumber(store: Store, projectId: string, keyCount: number): Promise<number> {
  let max = 0;
  for (const f of await projectFiles(store, projectId, keyCount)) {
    for (const id of f.plotFile.plotIds) {
      const first = id.split(',')[0];
      if (/^\d{1,15}$/.test(first)) max = Math.max(max, Number(first));
    }
  }
  return max + 1;
}
