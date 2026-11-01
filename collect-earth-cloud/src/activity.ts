import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isCollectEarthAgent } from './clientVersion.js';
import type { Store } from './store/store.js';
import type { AuditAction, AuditDetails, MemberActivityPatch } from './types.js';

/** A User-Agent longer than this is cut (member_activity.client_agent). */
export const MAX_CLIENT_AGENT_CHARS = 200;

/** At most one write of a member's activity per this long (per server instance). */
export const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/** Members kept in memory before the idle ones are forgotten (at most one scan a minute). */
const PRUNE_ABOVE = 1000;

/** What one request did, besides being seen. */
export interface ActivityNote {
  sync?: { records: number };
  plotsDownload?: boolean;
  cepDownload?: boolean;
  /**
   * The raw User-Agent, from the routes Collect Earth calls only, and only when it is
   * Collect Earth's (a coordinator's browser downloading from the dashboard would replace it).
   */
  clientAgent?: string | null;
}

interface Pending {
  projectId: string;
  userId: string;
  patch: MemberActivityPatch | null;
  lastWriteAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Keeps member_activity up to date without a database write per request: a member's
 * first call of the minute is written during the call (note() is awaited before the
 * answer is sent), and the calls of the minute after it are added up in memory
 * (latest times, summed counters, the last client agent) and written by the member's
 * first call once the minute is over. Each server instance coalesces its own calls;
 * the store's upsert adds them up, so several instances still count right.
 *
 * On Cloud Run (request-based billing) the CPU is throttled once an answer is sent, so
 * nothing relies on work after it: a timer also writes what is pending a minute after
 * the last write, but only as a best effort, and close() (the app's onClose) writes
 * what is left. A member who stops calling may leave up to a minute unwritten until
 * then.
 *
 * A write never fails a request: errors go to `onError`, and the patch is kept for the
 * next write.
 */
export class ActivityRecorder {
  private readonly pending = new Map<string, Pending>();
  private readonly writes = new Set<Promise<void>>();
  private readonly intervalMs: number;
  private readonly pruneAbove: number;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;
  private lastPruneAt = -Infinity;

  constructor(
    private readonly store: Pick<Store, 'touchMemberActivity'>,
    options: { intervalMs?: number; pruneAbove?: number; now?: () => number; onError?: (err: unknown) => void } = {},
  ) {
    this.intervalMs = options.intervalMs ?? ACTIVITY_WRITE_INTERVAL_MS;
    this.pruneAbove = options.pruneAbove ?? PRUNE_ABOVE;
    this.now = options.now ?? (() => Date.now());
    this.onError = options.onError ?? (() => {});
  }

  /**
   * A member's call to the project (any authenticated call), and what it did. Resolves
   * once the write that is due, if any, is done (it never rejects).
   */
  async note(projectId: string, userId: string, note: ActivityNote = {}): Promise<void> {
    const key = `${projectId} ${userId}`;
    const now = this.now();
    let entry = this.pending.get(key);
    if (!entry) {
      this.prune(now);
      entry = { projectId, userId, patch: null, lastWriteAt: -Infinity, timer: null };
      this.pending.set(key, entry);
    }
    entry.patch = mergePatch(entry.patch, patchOf(note, now));
    const wait = entry.lastWriteAt + this.intervalMs - now;
    if (wait <= 0) {
      await this.write(entry);
      return;
    }
    if (entry.timer === null) {
      const due = entry;
      due.timer = setTimeout(() => {
        due.timer = null;
        void this.write(due);
      }, wait);
      due.timer.unref?.();
    }
  }

  /** Writes everything pending now and waits for every write under way. */
  async flush(): Promise<void> {
    for (const entry of this.pending.values()) {
      void this.write(entry);
    }
    await Promise.all([...this.writes]);
  }

  async close(): Promise<void> {
    await this.flush();
    this.pending.clear();
  }

  /** How many members are held in memory (for tests). */
  size(): number {
    return this.pending.size;
  }

  /**
   * Forgets members with nothing pending whose last write is over a minute old (as if
   * never seen), when many are held: one scan a minute at most, not one per new member.
   */
  private prune(now: number): void {
    if (this.pending.size < this.pruneAbove || now - this.lastPruneAt < this.intervalMs) {
      return;
    }
    this.lastPruneAt = now;
    for (const [key, entry] of this.pending) {
      if (entry.patch === null && entry.timer === null && entry.lastWriteAt + this.intervalMs <= now) {
        this.pending.delete(key);
      }
    }
  }

  private write(entry: Pending): Promise<void> {
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const patch = entry.patch;
    if (patch === null) {
      return Promise.resolve();
    }
    entry.patch = null;
    entry.lastWriteAt = this.now();
    const write = this.store
      .touchMemberActivity(entry.projectId, entry.userId, patch)
      .catch((err) => {
        // Kept, under what came meanwhile, for the next write.
        entry.patch = entry.patch === null ? patch : mergePatch(patch, entry.patch);
        this.onError(err);
      })
      .finally(() => this.writes.delete(write));
    this.writes.add(write);
    return write;
  }
}

function patchOf(note: ActivityNote, now: number): MemberActivityPatch {
  const patch: MemberActivityPatch = { lastSeenAt: now };
  if (note.sync) {
    patch.lastSyncAt = now;
    patch.syncs = 1;
    patch.recordsReceived = note.sync.records;
  }
  if (note.plotsDownload) {
    patch.lastPlotsDownloadAt = now;
  }
  if (note.cepDownload) {
    patch.lastCepDownloadAt = now;
  }
  if (note.clientAgent) {
    patch.clientAgent = note.clientAgent;
  }
  return patch;
}

/** Two patches as one: the later of each time, the sum of each counter, the newer client agent. */
function mergePatch(a: MemberActivityPatch | null, b: MemberActivityPatch): MemberActivityPatch {
  if (a === null) {
    return b;
  }
  const out: MemberActivityPatch = { ...a };
  for (const k of ['lastSeenAt', 'lastSyncAt', 'lastPlotsDownloadAt', 'lastCepDownloadAt'] as const) {
    if (b[k] !== undefined) out[k] = Math.max(a[k] ?? -Infinity, b[k]!);
  }
  for (const k of ['syncs', 'recordsReceived'] as const) {
    if (b[k] !== undefined) out[k] = (a[k] ?? 0) + b[k]!;
  }
  if (b.clientAgent !== undefined) out.clientAgent = b.clientAgent;
  return out;
}

/** The raw User-Agent header, cut at MAX_CLIENT_AGENT_CHARS; null when none. Parsed by clientVersion.ts. */
export function clientAgentOf(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value ? value.slice(0, MAX_CLIENT_AGENT_CHARS) : null;
}

declare module 'fastify' {
  interface FastifyInstance {
    activity: ActivityRecorder;
  }
  interface FastifyRequest {
    /** What this request did, written before it is answered (registerActivity). */
    activityNote?: ActivityNote;
  }
}

/**
 * Says what a request did for its member's activity. With `desktop` the request is
 * one Collect Earth makes, and its User-Agent is kept when it is Collect Earth's (the
 * dashboard calls some of those routes too: a plot file's content, the CEP). A CEP
 * download counts only when Collect Earth makes it.
 */
export function noteActivity(request: FastifyRequest, note: Omit<ActivityNote, 'clientAgent'>, options: { desktop?: boolean } = {}): void {
  const merged: ActivityNote = { ...request.activityNote };
  if (note.sync) merged.sync = { records: (merged.sync?.records ?? 0) + note.sync.records };
  if (note.plotsDownload) merged.plotsDownload = true;
  const agent = options.desktop ? clientAgentOf(request.headers['user-agent']) : null;
  const collectEarth = isCollectEarthAgent(agent);
  // Only Collect Earth's download is the project file it works with (a CEP downloaded in
  // a browser is not): the Progress tab's "old project file" card compares this time.
  if (note.cepDownload && collectEarth) merged.cepDownload = true;
  if (collectEarth) merged.clientAgent = agent;
  request.activityNote = merged;
}

/**
 * Every request of a project member (a user session, not a project token) counts as
 * seen, with what the route noted. Written before the answer is sent (onSend), not
 * after it (see ActivityRecorder); pending activity is written on close.
 */
export function registerActivity(app: FastifyInstance, recorder: ActivityRecorder): void {
  app.decorate('activity', recorder);
  app.addHook('onSend', async (request, _reply, payload) => {
    const m = request.membership;
    if (m?.userId) {
      await recorder.note(m.projectId, m.userId, request.activityNote ?? {});
    }
    return payload;
  });
  app.addHook('onClose', async () => {
    await recorder.close();
  });
}

/**
 * Logs a coordinator action of this request (the actor is its user, or none for a
 * project token). `details` holds ids and counts only, never answers. A failed write
 * is logged and does not undo or fail the action, which is already done.
 */
export async function audit(store: Store, request: FastifyRequest, action: AuditAction, details: AuditDetails = {}): Promise<void> {
  const projectId = request.membership?.projectId;
  if (!projectId) {
    return;
  }
  try {
    await store.appendAudit(projectId, { actorUserId: request.membership?.userId ?? null, action, details });
  } catch (err) {
    request.log.error({ err, action }, 'audit log write failed');
  }
}
