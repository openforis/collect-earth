import type { RoundInfo } from './cep.js';
import { plotUnits, type PlotUnits } from './progress.js';
import { loadPlotContext, remember, sha256, type Log, type PlotContext } from './qualityService.js';
import type { Store } from './store/store.js';
import type { AssignmentDetail, CsvFile, Member } from './types.js';

/**
 * What the Progress and People pages work from, worked out once per project and kept:
 * the plot files' plots and who holds them (loadPlotContext), and every record resolved
 * per plot and per person (plotUnits with perOperator). Loading the records' states and
 * the plot files is most of a page's time on a large project (about 0.5 s for 100,000
 * records), so a page asks this cache instead, and only what is cheap and changes on its
 * own clock (member activity, invitation links, settings, decisions, the time zone) is
 * read and applied for each request.
 *
 * The state is kept under a version of its inputs: the store's records version (records
 * and divided holdings), the round info, the plot files (id, checksum, division), the
 * members (id, username) and the whole-file assignments. Reading those takes a few small
 * queries and no records. As the quality figures do (QualityService): one build at a time
 * per project; a state younger than `staleMs` whose inputs changed is served at once,
 * marked stale (the page says "as of HH:MM"), while a new one is built behind it.
 */

/** A state younger than this is served (stale) while a newer one is built. */
export const STATE_STALE_MS = 30_000;
/** At most this many projects are kept by default (PROJECT_STATES_KEPT; it was 6, Task 22 review B6: a state of 100,000 records is tens of MB). */
export const MAX_CACHED_STATES = 3;
/** A project not asked for in this long is dropped. */
export const STATE_IDLE_MS = 10 * 60_000;
/** A state built while a plot file could not be read is built again after this long (its inputs unchanged). */
export const STATE_RETRY_MS = 5000;

export interface ProjectState {
  version: string;
  /** When the inputs it was built from were read. */
  builtAt: number;
  info: RoundInfo | null;
  files: CsvFile[];
  members: Member[];
  assignments: AssignmentDetail[];
  context: PlotContext;
  units: PlotUnits;
  /** Set when a plot file could not be read (context.failed): the state lacks its plots and is built again after STATE_RETRY_MS. */
  failedAt?: number;
}

export interface ServedState {
  state: ProjectState;
  /** True when the inputs changed after state.builtAt (a newer state is being built). */
  stale: boolean;
  /** The members as they are now (roles are not part of the state's version). */
  members: Member[];
}

interface Inputs {
  version: string;
  at: number;
  info: RoundInfo | null;
  files: CsvFile[];
  members: Member[];
  assignments: AssignmentDetail[];
}

interface Entry {
  state: ProjectState | null;
  building: Promise<ProjectState> | null;
  lastUsed: number;
}

export class ProjectStateCache {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly staleMs: number;
  private readonly maxProjects: number;
  private readonly idleMs: number;
  /** How many states were built (for tests). */
  built = 0;

  constructor(
    private readonly store: Store,
    options: { now?: () => number; staleMs?: number; maxProjects?: number; idleMs?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.staleMs = options.staleMs ?? STATE_STALE_MS;
    this.maxProjects = options.maxProjects ?? MAX_CACHED_STATES;
    this.idleMs = options.idleMs ?? STATE_IDLE_MS;
  }

  /** With `fresh`, a state whose inputs changed is never served stale: the request waits for the new one (the check sampling). */
  async get(projectId: string, log: Log, options: { fresh?: boolean } = {}): Promise<ServedState> {
    this.sweep();
    const inputs = await this.inputs(projectId);
    let entry = this.entries.get(projectId);
    if (!entry) {
      entry = { state: null, building: null, lastUsed: inputs.at };
    }
    entry.lastUsed = inputs.at;
    remember(this.entries, projectId, entry, this.maxProjects);
    const state = entry.state;
    if (state && state.version === inputs.version && (state.failedAt === undefined || inputs.at - state.failedAt < STATE_RETRY_MS)) {
      return { state, stale: false, members: inputs.members };
    }
    if (state && !options.fresh && inputs.at - state.builtAt < this.staleMs) {
      this.build(projectId, entry, inputs, log).catch((err: unknown) => log.warn({ err, projectId }, 'project state: could not be brought up to date'));
      return { state, stale: true, members: inputs.members };
    }
    let fresh = await this.build(projectId, entry, inputs, log);
    if (options.fresh && fresh.version !== inputs.version) {
      // A build from older inputs was running: build once more from these.
      fresh = await this.build(projectId, entry, inputs, log);
    }
    return { state: fresh, stale: fresh.version !== inputs.version, members: inputs.members };
  }

  /** Drops a project's state (deleted projects). */
  forget(projectId: string): void {
    this.entries.delete(projectId);
  }

  private sweep(): void {
    const now = this.now();
    for (const [projectId, entry] of this.entries) {
      if (!entry.building && now - entry.lastUsed > this.idleMs) {
        this.entries.delete(projectId);
      }
    }
  }

  private async inputs(projectId: string): Promise<Inputs> {
    const at = this.now();
    const [records, info, files, members, assignments] = await Promise.all([
      this.store.qualityVersion(projectId),
      this.store.getRoundInfo(projectId),
      this.store.listCsvFiles(projectId),
      this.store.listMembers(projectId),
      this.store.listAssignments(projectId),
    ]);
    const version = sha256(
      JSON.stringify([
        records,
        info,
        files.map((f) => [f.id, f.checksum, f.distribution ?? null]),
        // Who is left out of the results, as the quality figures' version has it (rebuilt with them).
        members.map((m) => [m.userId, m.username, m.excluded ? 1 : 0]),
        assignments.map((a) => [a.userId, a.csvFileId]),
      ]),
    );
    return { version, at, info, files, members, assignments };
  }

  /** One build at a time per project: a request while one runs waits for it (its inputs are at most a moment older). */
  private build(projectId: string, entry: Entry, inputs: Inputs, log: Log): Promise<ProjectState> {
    if (entry.building) {
      return entry.building;
    }
    const building = (async () => {
      const [records, context] = await Promise.all([
        this.store.listRecordStates(projectId),
        loadPlotContext(this.store, projectId, log, { info: inputs.info, files: inputs.files, members: inputs.members }),
      ]);
      const units = plotUnits(
        {
          records,
          info: context.info,
          units: context.units,
          copyHolders: context.copyHolders,
          mainHolders: context.mainHolders,
          fileUnits: context.fileUnits,
          assignments: inputs.assignments,
        },
        true,
      );
      this.built += 1;
      const state: ProjectState = {
        version: inputs.version,
        builtAt: inputs.at,
        info: inputs.info,
        files: inputs.files,
        members: inputs.members,
        assignments: inputs.assignments,
        context,
        units,
        ...(context.failed ? { failedAt: inputs.at } : {}),
      };
      entry.state = state;
      return state;
    })();
    entry.building = building;
    building.then(
      () => {
        entry.building = null;
      },
      () => {
        entry.building = null;
      },
    );
    return building;
  }
}
