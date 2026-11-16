// Invitation links that hand out plots: a link may carry a plot file, given to each person who joins with it (on
// registering or signing in with it, src/routes/auth.ts), so a group can start collecting as soon as each one joins,
// without the coordinator giving each person their plots by hand.
// - `whole`: the person gets the whole file (an assignment, as Setup › Plots gives one);
// - `share`: the person takes the next `count` plots of the file, in its order, that nobody holds and nobody has
//   submitted; the file is divided (manual) when it was whole and nobody had it. Nobody else's plots move. When the
//   file has no plots left, the person gets none (the coordinator's email says so).
import { plotFileOf } from './plotFileCache.js';
import type { Log } from './qualityService.js';
import { fileKeyCount, unitOfRecord } from './rounds.js';
import type { Store } from './store/store.js';
import type { InvitePlots } from './types.js';

export interface GivenPlots {
  /** null: the project's plots (a link over the project) */
  csvFileId: string | null;
  filename: string | null;
  mode: InvitePlots['mode'];
  /** Plots the person got: the file's plots (whole), or those taken (share, 0 when none was left) */
  plots: number;
}

/** What an invitation link's plots are when it is made: the reason it cannot be, or null. */
export async function invitePlotsRefusal(store: Store, projectId: string, plots: unknown): Promise<{ error: string; reason: string } | InvitePlots> {
  const p = (plots ?? {}) as { csvFileId?: unknown; mode?: unknown; count?: unknown };
  const validCount = typeof p.count === 'number' && Number.isInteger(p.count) && p.count >= 1 && p.count <= 100_000;
  // A share of the project's plots (all its plot files, one set: src/projectPlots.ts)
  if (p.csvFileId === null && p.mode === 'share') {
    if (!validCount) return { error: 'bad_request', reason: 'plots.count: a whole number of plots from 1 to 100000' };
    if ((await store.listCsvFiles(projectId)).length === 0) return { error: 'bad_request', reason: 'plots: the project has no plot file yet' };
    return { csvFileId: null, mode: 'share', count: p.count as number };
  }
  if (typeof p.csvFileId !== 'string' || (p.mode !== 'whole' && p.mode !== 'share')) {
    return { error: 'bad_request', reason: 'plots: { csvFileId (null: the project’s plots, a share), mode: whole | share, count (share) }' };
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
  if (plots.csvFileId === null) return giveProjectShare(store, projectId, userId, plots.count ?? 0);
  const file = await store.getCsvFile(projectId, plots.csvFileId);
  if (!file) return null;
  const info = await store.getRoundInfo(projectId);
  const plotFile = plotFileOf(file, fileKeyCount(info));
  if (plots.mode === 'whole') {
    const given = await store.addAssignment(projectId, file.id, userId);
    return { csvFileId: file.id, filename: file.filename, mode: 'whole', plots: given ? plotFile.plotIds.length : 0 };
  }
  // The plots to do, in the file's order: each once, none anybody submitted (a check too: left for the coordinator).
  // From the records' states only (no answers): a mapathon's people join many at once, each joining reads them.
  const units = new Set(plotFile.plotIds);
  const done = new Set<string>();
  for (const r of await store.listRecordStates(projectId)) {
    if (!r.activelySaved || r.deleted) continue;
    const unit = unitOfRecord(r.recordKey, units, info);
    if (unit !== null) done.add(unit);
  }
  const candidates = [...units].filter((id) => !done.has(id));
  const taken = await store.claimUnheldPlots(projectId, file.id, userId, candidates, plots.count ?? 0);
  if (taken === 'not_found') return null;
  if (taken === 'whole_assigned') {
    // Given whole to people since the link was made: no share is taken, and the coordinator's email says to give plots
    log.warn({ projectId, csvFileId: file.id }, 'invitation plots: the file is given whole to people now; no share taken');
    return null;
  }
  return { csvFileId: file.id, filename: file.filename, mode: 'share', plots: taken };
}

/**
 * A share of the project's plots: the next `count` plots nobody holds and nobody submitted, in the order of its plot
 * files and theirs (each file divided by hand when nobody had it; a file given whole to people is held).
 */
async function giveProjectShare(store: Store, projectId: string, userId: string, count: number): Promise<GivenPlots> {
  const info = await store.getRoundInfo(projectId);
  const keyCount = fileKeyCount(info);
  const states = await store.listRecordStates(projectId);
  let taken = 0;
  for (const meta of await store.listCsvFiles(projectId)) {
    if (taken >= count) break;
    const file = await store.getCsvFile(projectId, meta.id);
    if (!file) continue;
    const units = new Set(plotFileOf(file, keyCount).plotIds);
    const done = new Set<string>();
    for (const r of states) {
      if (!r.activelySaved || r.deleted) continue;
      const unit = unitOfRecord(r.recordKey, units, info);
      if (unit !== null) done.add(unit);
    }
    const got = await store.claimUnheldPlots(projectId, file.id, userId, [...units].filter((id) => !done.has(id)), count - taken);
    if (typeof got === 'number') taken += got;
  }
  return { csvFileId: null, filename: null, mode: 'share', plots: taken };
}
