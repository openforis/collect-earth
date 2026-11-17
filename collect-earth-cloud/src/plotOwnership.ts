import type { Store } from './store/store.js';
import type { RoundInfo } from './types.js';
import { plotIdsOf } from './plotFileCache.js';
import { fileKeyCount } from './rounds.js';

/**
 * Whose a plot is, for someone asking about it: `own` when they hold it (in a divided plot file, as a main plot or a
 * quality-check copy, or in a whole plot file given to them), `others` when only other people do, `free` when the
 * project gave it to nobody (a project that does not divide its plots, or a plot of no plot file).
 *
 * What a collector may do with a plot that is not theirs goes by this, never by whether they have a record of it:
 * anybody can send a record of any plot.
 */
export type PlotOwnership = 'own' | 'others' | 'free';

/**
 * Reads the project's plot files and holdings once, for several plots (a batch of records). `userId` null: no person
 * (a project token), who holds nothing. `names`: the plot as asked for and as the plot files name it. `only`: the
 * names of the one plot asked about, when that is all (the divided files' holdings of those plots alone are read).
 */
export async function plotOwnershipOf(store: Store, projectId: string, userId: string | null, info: RoundInfo | null, only?: readonly string[]): Promise<(names: readonly string[]) => PlotOwnership> {
  const mine = new Set<string>();
  const theirs = new Set<string>();
  const files = new Map((await store.listCsvFiles(projectId)).map((f) => [f.id, f]));
  const divided = [...files.values()].filter((f) => f.distribution != null).map((f) => f.id);
  for (const held of only ? await store.listPlotHolders(projectId, divided, only) : await store.listDividedHoldings(projectId)) {
    (held.userId === userId ? mine : theirs).add(held.plotKey);
  }
  const ids = new Map<string, readonly string[]>();
  for (const given of await store.listAssignments(projectId)) {
    const meta = files.get(given.csvFileId);
    if (!meta || meta.distribution != null) continue;
    let plots = ids.get(meta.id);
    if (!plots) {
      const file = await store.getCsvFile(projectId, meta.id);
      plots = file ? plotIdsOf(file, fileKeyCount(info)) : [];
      ids.set(meta.id, plots);
    }
    const into = given.userId === userId ? mine : theirs;
    for (const id of plots) into.add(id);
  }
  return (names) => (names.some((n) => mine.has(n)) ? 'own' : names.some((n) => theirs.has(n)) ? 'others' : 'free');
}
