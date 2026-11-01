import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Store } from './store/store.js';
import type { AuditAction, AuditDetails, MemberActivityPatch } from './types.js';

/** A User-Agent longer than this is cut (member_activity.client_agent). */
export const MAX_CLIENT_AGENT_CHARS = 200;

/** At most one write of a member's activity per this long (per server instance). */
export const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/** Members kept in memory before the idle ones are forgotten. */
const PRUNE_ABOVE = 1000;

/** What one request did, besides being seen. */
export interface ActivityNote {
  sync?: { records: number };
  plotsDownload?: boolean;
  cepDownload?: boolean;
  /** The raw User-Agent, from the routes Collect Earth calls only (a browser's would replace it). */
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
 * Keeps member_activity up to date without a database write per request: the first
 * call of a member is written at once, and the calls of the next minute are added up
 * in memory (latest times, summed counters, the last client agent) and written once,
 * a minute after that write. Each server instance coalesces its own calls; the
 * store's upsert adds them up, so several instances still count right.
 *
 * A write never fails a request: errors go to `onError`. What is pending when the
 * server stops is written by close() (the app's onClose); a crash loses at most a
 * minute of it.
 */
export class ActivityRecorder {
  private readonly pending = new Map<string, Pending>();
  private readonly writes = new Set<Promise<void>>();
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly onError: (err: unknown) => void;

  constructor(
    private readonly store: Pick<Store, 'touchMemberActivity'>,
    options: { intervalMs?: number; now?: () => number; onError?: (err: unknown) => void } = {},
  ) {
    this.intervalMs = options.intervalMs ?? ACTIVITY_WRITE_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
    this.onError = options.onError ?? (() => {});
  }

  /** A member's call to the project (any authenticated call), and what it did. */
  note(projectId: string, userId: string, note: ActivityNote = {}): void {
    const key = `${projectId} ${userId}`;
    const now = this.now();
    let entry = this.pending.get(key);
    if (!entry) {
      this.prune(now);
      entry = { projectId, userId, patch: null, lastWriteAt: -Infinity, timer: null };
      this.pending.set(key, entry);
    }
    entry.patch = mergePatch(entry.patch, patchOf(note, now));
    if (entry.timer !== null) {
      return;
    }
    const wait = entry.lastWriteAt + this.intervalMs - now;
    if (wait <= 0) {
      this.write(entry);
      return;
    }
    entry.timer = setTimeout(() => {
      entry.timer = null;
      this.write(entry);
    }, wait);
    entry.timer.unref?.();
  }

  /** Writes everything pending now and waits for every write under way. */
  async flush(): Promise<void> {
    for (const entry of this.pending.values()) {
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      this.write(entry);
    }
    await Promise.all([...this.writes]);
  }

  /** Forgets members with nothing pending whose last write is over a minute old (as if never seen). */
  private prune(now: number): void {
    if (this.pending.size < PRUNE_ABOVE) {
      return;
    }
    for (const [key, entry] of this.pending) {
      if (entry.patch === null && entry.timer === null && entry.lastWriteAt + this.intervalMs <= now) {
        this.pending.delete(key);
      }
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.pending.clear();
  }

  private write(entry: Pending): void {
    const patch = entry.patch;
    if (patch === null) {
      return;
    }
    entry.patch = null;
    entry.lastWriteAt = this.now();
    const write = this.store
      .touchMemberActivity(entry.projectId, entry.userId, patch)
      .catch((err) => this.onError(err))
      .finally(() => this.writes.delete(write));
    this.writes.add(write);
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

/** The raw User-Agent header, cut at MAX_CLIENT_AGENT_CHARS; null when none. Parsed later (Task 21). */
export function clientAgentOf(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value ? value.slice(0, MAX_CLIENT_AGENT_CHARS) : null;
}

declare module 'fastify' {
  interface FastifyInstance {
    activity: ActivityRecorder;
  }
  interface FastifyRequest {
    /** What this request did, written when it has been answered (registerActivity). */
    activityNote?: ActivityNote;
  }
}

/**
 * Says what a request did for its member's activity. With `desktop` the request is
 * one Collect Earth makes, and its User-Agent is kept.
 */
export function noteActivity(request: FastifyRequest, note: Omit<ActivityNote, 'clientAgent'>, options: { desktop?: boolean } = {}): void {
  const merged: ActivityNote = { ...request.activityNote };
  if (note.sync) merged.sync = { records: (merged.sync?.records ?? 0) + note.sync.records };
  if (note.plotsDownload) merged.plotsDownload = true;
  if (note.cepDownload) merged.cepDownload = true;
  if (options.desktop) merged.clientAgent = clientAgentOf(request.headers['user-agent']);
  request.activityNote = merged;
}

/**
 * Every answered request of a project member (a user session, not a project token)
 * counts as seen, with what the route noted. Pending activity is written on close.
 */
export function registerActivity(app: FastifyInstance, recorder: ActivityRecorder): void {
  app.decorate('activity', recorder);
  app.addHook('onResponse', async (request) => {
    const m = request.membership;
    if (m?.userId) {
      recorder.note(m.projectId, m.userId, request.activityNote ?? {});
    }
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
