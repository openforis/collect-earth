// The person's plots (docs/plans/2026-11-16-plots-from-the-server.md, stage 1): every plot a person holds in a cloud
// project, in one plot file, which Collect Earth keeps on the computer and reads as it reads a project's own plot file.
// The parts are the files `my-assignment` lists for the person (their whole files, their plots of divided files, the
// plots sent back to them to check again), as each is served to them (with the round and the coordinator's note
// columns); training sets stay apart.
//
// One file needs one set of columns, and Collect Earth reads the keys and the coordinates by position and gives the
// extra columns to the survey's questions by position:
// - the columns are those of the part with the most rows (the project's plot files have the survey's columns);
// - a part with as many columns, whose extra columns (after the keys and the coordinates) have the same names in
//   another order (any letter case), has its values put in that order (sameColumns: the rule a plot file added to a
//   project is held to, src/projectPlots.ts); the keys and coordinates may be named otherwise (lat, YCoordinate);
// - a part without a header row is taken as it is when it is no wider;
// - a part with other columns is left out, and said (`leftOut`): its plots would fill the wrong questions.
// A plot (its keys and its round) in two parts is written once, from the first: the plots sent back come first, so a
// plot's coordinator's note is kept. A row Collect Earth cannot read (`readable`: coordinates that are no numbers) is
// left out and counted, as one such row stops the plot file Google Earth Pro opens. With `plotFile`, a last column `plot_file` says which plot file each row comes
// from, for Collect Earth to keep in the record as it does with a project's own plot files.
import { createHash } from 'node:crypto';
import { fieldText, parsePlotFile, type PlotFile } from './plots.js';

export interface PlotFilePart {
  /** The plot file the rows come from: its id and name (the `plot_file` column) */
  csvFileId: string;
  filename: string;
  /** The file as the person gets it */
  data: Buffer;
}

export interface MergedPlots {
  data: Buffer;
  checksum: string;
  /** The rows to assess: a plot and its round, each once (a re-assessment counts apart) */
  plots: number;
  /** How many of them come from each plot file */
  sources: { csvFileId: string; filename: string; plots: number }[];
  /** The parts left out, with why */
  leftOut: { csvFileId: string; filename: string; reason: 'columns_differ' }[];
  /** Plots another part had already (written once) */
  repeated: number;
  /** Rows Collect Earth could not read (`readable`), left out: one such row stops Google Earth Pro's plot file */
  unreadable: number;
  /** The last column is the `plot_file` this added (with `plotFile`, unless the columns had one already) */
  plotFileColumn: boolean;
}

/** The name of the column that says each row's plot file. */
export const PLOT_FILE_COLUMN = 'plot_file';

const names = (file: PlotFile) => file.header?.fields.map((f) => f.trim().toLowerCase()) ?? null;

/**
 * Where each of the reference header's columns is in another header (an index per column), or null when they are not
 * the same columns: as many of them, and the extra columns (after the first `lead`: the keys and the two coordinates,
 * read by position, whatever their names) with the same names in any order and letter case, each once; a column with
 * no name is matched by its place.
 */
export function sameColumns(reference: readonly string[], other: readonly string[], lead: number): number[] | null {
  if (reference.length !== other.length) return null;
  const ref = reference.map((n) => n.trim().toLowerCase());
  const own = other.map((n) => n.trim().toLowerCase());
  if (ref.every((n, i) => n === own[i])) return ref.map((_, i) => i);
  const order: number[] = [];
  for (let i = 0; i < ref.length; i++) {
    if (i < lead || ref[i] === '') {
      if (i >= lead && own[i] !== '') return null;
      order.push(i);
      continue;
    }
    const at = own.indexOf(ref[i], lead);
    if (at < 0 || own.indexOf(ref[i], at + 1) >= 0 || ref.indexOf(ref[i], i + 1) >= 0) return null;
    order.push(at);
  }
  return order;
}

/**
 * The parts in one plot file: `keyCount` is the number of key columns of the files as served (the survey's keys, the
 * round with them), which make a row's plot. Separator `,`, line break `\n`, no BOM, each value quoted when it needs it.
 */
export function mergePlotFiles(
  parts: readonly PlotFilePart[],
  keyCount: number,
  options: { plotFile?: boolean; readable?: (fields: readonly string[]) => boolean } = {},
): MergedPlots {
  const parsed = parts.map((part) => ({ part, file: parsePlotFile(part.data, keyCount) }));
  // The columns: those of the part with a header and the most rows (the first of equals)
  let reference: (typeof parsed)[number] | null = null;
  for (const p of parsed) {
    if (p.file.header && (!reference || p.file.rows.length > reference.file.rows.length)) reference = p;
  }
  const referenceNames = reference ? names(reference.file)! : null;
  const width = referenceNames ? referenceNames.length : Math.max(0, ...parsed.map((p) => p.file.columnCount));
  const withPlotFile = options.plotFile === true && !(referenceNames ?? []).includes(PLOT_FILE_COLUMN);

  const lines: string[] = [];
  if (reference) {
    const header = reference.file.header!.fields.map((f) => fieldText(f, ','));
    if (withPlotFile) header.push(PLOT_FILE_COLUMN);
    lines.push(header.join(','));
  }
  const owner = new Map<string, number>();
  const counts = new Map<string, { csvFileId: string; filename: string; plots: number }>();
  const leftOut: MergedPlots['leftOut'] = [];
  // The plots of a part another had already, counted once each (a plot may have several rows)
  const repeated = new Set<string>();
  let unreadable = 0;
  parsed.forEach(({ part, file }, index) => {
    // Where each column's value is in this part's rows: null for the part's own order
    let order: number[] | null = null;
    const own = names(file);
    if (own && referenceNames) {
      const at = sameColumns(referenceNames, own, keyCount + 2);
      if (!at) {
        leftOut.push({ csvFileId: part.csvFileId, filename: part.filename, reason: 'columns_differ' });
        return;
      }
      order = at.every((i, n) => i === n) ? null : at;
    } else if (!own && file.columnCount > width) {
      leftOut.push({ csvFileId: part.csvFileId, filename: part.filename, reason: 'columns_differ' });
      return;
    }
    const plotFile = fieldText(part.filename, ',');
    for (const row of file.rows) {
      const values = order ? order.map((i) => row.fields[i] ?? '') : row.fields;
      if (options.readable && !options.readable(values)) {
        unreadable += 1;
        continue;
      }
      // A plot's rows (several when they share their keys) come from one part: the first that has it
      const first = owner.get(row.id);
      if (first === undefined) {
        owner.set(row.id, index);
        const count = counts.get(part.csvFileId) ?? { csvFileId: part.csvFileId, filename: part.filename, plots: 0 };
        count.plots += 1;
        counts.set(part.csvFileId, count);
      } else if (first !== index) {
        repeated.add(`${index}\u0000${row.id}`);
        continue;
      }
      const text = values.map((v) => fieldText(v, ','));
      if (withPlotFile) {
        // The plot file's name in the last column, after as many columns as the header has
        text.length = Math.min(text.length, width);
        while (text.length < width) text.push('');
        text.push(plotFile);
      }
      lines.push(text.join(','));
    }
  });
  const data = Buffer.from(lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
  return {
    data,
    checksum: createHash('sha256').update(data).digest('hex'),
    plots: owner.size,
    sources: [...counts.values()],
    leftOut,
    repeated: repeated.size,
    unreadable,
    plotFileColumn: withPlotFile,
  };
}

/**
 * What the person's plots depend on: the parts as listed (their ids and checksums), so a change of what they hold, of
 * a plot file's content, of the round or of the note changes it, and nothing else does. Asked every few minutes by
 * each Collect Earth: computed without building the file.
 */
export function myPlotsVersion(parts: readonly { csvFileId: string; checksum: string }[], also: readonly string[] = []): string {
  return createHash('sha256')
    .update(JSON.stringify(['my-plots/1', parts.map((p) => [p.csvFileId, p.checksum]), also]))
    .digest('hex')
    .slice(0, 32);
}
