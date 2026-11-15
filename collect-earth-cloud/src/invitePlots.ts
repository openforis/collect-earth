// Invitation links that hand out plots: a link may carry a plot file, given to each person who joins with it (on
// registering or signing in with it, src/routes/auth.ts), so a group can start collecting as soon as each one joins,
// without the coordinator giving each person their plots by hand.
// - `whole`: the person gets the whole file (an assignment, as Setup › Plots gives one);
// - `share`: the person takes the next `count` plots of the file, in its order, that nobody holds and nobody has
//   submitted; the file is divided (manual) when it was whole and nobody had it. Nobody else's plots move. When the
//   file has no plots left, the person gets none (the coordinator's email says so).
import { loadFile } from './routes/division.js';
import type { Log } from './qualityService.js';
import type { Store } from './store/store.js';
import type { InvitePlots } from './types.js';

export interface GivenPlots {
  csvFileId: string;
  filename: string;
  mode: InvitePlots['mode'];
  /** Plots the person got: the file's plots (whole), or those taken (share, 0 when none was left) */
  plots: number;
}

/** What an invitation link's plots are when it is made: the reason it cannot be, or null. */
export async function invitePlotsRefusal(store: Store, projectId: string, plots: unknown): Promise<{ error: string; reason: string } | InvitePlots> {
  const p = (plots ?? {}) as { csvFileId?: unknown; mode?: unknown; count?: unknown };
  if (typeof p.csvFileId !== 'string' || (p.mode !== 'whole' && p.mode !== 'share')) {
    return { error: 'bad_request', reason: 'plots: { csvFileId, mode: whole | share, count (share) }' };
  }
  const file = (await store.listCsvFiles(projectId)).find((f) => f.id === p.csvFileId);
  if (!file) return { error: 'bad_request', reason: 'plots: no such plot file in the project' };
  if (p.mode === 'whole') {
    if (file.distribution) return { error: 'file_divided', reason: 'this plot file is divided between people: give each person a number of plots of it instead' };
    return { csvFileId: file.id, mode: 'whole', count: null };
  }
  if (typeof p.count !== 'number' || !Number.isInteger(p.count) || p.count < 1 || p.count > 100_000) {
    return { error: 'bad_request', reason: 'plots.count: a whole number of plots from 1 to 100000' };
  }
  if (!file.distribution && (await store.listAssignments(projectId)).some((a) => a.csvFileId === file.id)) {
    return { error: 'file_whole_assigned', reason: 'people already have this whole plot file: give it whole, or choose another file' };
  }
  return { csvFileId: file.id, mode: 'share', count: p.count };
}

/** At the join: gives the person the link's plots. Null when the link gives none or its file is gone. */
export async function giveInvitePlots(store: Store, projectId: string, userId: string, plots: InvitePlots | null, log: Log): Promise<GivenPlots | null> {
  if (!plots) return null;
  const loaded = await loadFile(store, projectId, plots.csvFileId, log);
  if (!loaded) return null;
  const { file, plotFile, submitted } = loaded;
  if (plots.mode === 'whole') {
    const given = await store.addAssignment(projectId, file.id, userId);
    return { csvFileId: file.id, filename: file.filename, mode: 'whole', plots: given ? plotFile.plotIds.length : 0 };
  }
  // The plots to do, in the file's order: each once, none somebody submitted
  const candidates = [...new Set(plotFile.plotIds)].filter((id) => !((submitted.get(id)?.main.size ?? 0) > 0));
  const taken = await store.claimUnheldPlots(projectId, file.id, userId, candidates, plots.count ?? 0);
  if (taken === 'not_found') return null;
  if (taken === 'whole_assigned') log.warn({ projectId, csvFileId: file.id }, 'invitation plots: the file is given whole to people now; no share taken');
  return { csvFileId: file.id, filename: file.filename, mode: 'share', plots: typeof taken === 'number' ? taken : 0 };
}
