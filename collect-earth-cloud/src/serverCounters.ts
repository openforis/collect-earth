import type { CountersSnapshot, HourCounts } from './wire/serverAdmin.js';

export type { CountersSnapshot, HourCounts } from './wire/serverAdmin.js';

/** How many hours of counts are kept: the last 7 days. The totals go back to the start. */
export const COUNTER_HOURS = 7 * 24;

const HOUR_MS = 3_600_000;

export type CounterKind = 'failedLogin' | 'rateLimited';

/**
 * Failed logins and requests refused by the rate limiter, counted in memory by hour since
 * this process started (the server owner's panel, Task 11). Each instance counts its own;
 * a restart starts again from zero, which the panel says.
 */
export class ServerCounters {
  private readonly since: number;
  private readonly hours = new Map<number, HourCounts>();
  private readonly totals = { failedLogins: 0, rateLimited: 0 };
  private lateDraws = 0;
  private lastLateDrawAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.since = now();
  }

  /** Told of every count (the owner's alerts, src/ownerAlerts.ts). */
  onCount: ((kind: CounterKind) => void) | null = null;

  count(kind: CounterKind): void {
    this.onCount?.(kind);
    const hour = Math.floor(this.now() / HOUR_MS) * HOUR_MS;
    let h = this.hours.get(hour);
    if (!h) {
      h = { hour, failedLogins: 0, rateLimited: 0 };
      this.hours.set(hour, h);
      // Forget the hours before the window (the map holds at most COUNTER_HOURS + 1).
      const oldest = hour - (COUNTER_HOURS - 1) * HOUR_MS;
      for (const key of this.hours.keys()) {
        if (key < oldest) {
          this.hours.delete(key);
        }
      }
    }
    if (kind === 'failedLogin') {
      h.failedLogins += 1;
      this.totals.failedLogins += 1;
    } else {
      h.rateLimited += 1;
      this.totals.rateLimited += 1;
    }
  }

  /** An automatic draw past its request's wait (SamplingService). */
  lateDraw(): void {
    this.lateDraws += 1;
    this.lastLateDrawAt = this.now();
  }

  snapshot(): CountersSnapshot {
    const oldest = Math.floor(this.now() / HOUR_MS) * HOUR_MS - (COUNTER_HOURS - 1) * HOUR_MS;
    return {
      since: this.since,
      totals: { ...this.totals },
      hours: [...this.hours.values()]
        .filter((h) => h.hour >= oldest)
        .sort((a, b) => a.hour - b.hour)
        .map((h) => ({ ...h })),
      lateDraws: this.lateDraws,
      lastLateDrawAt: this.lastLateDrawAt,
    };
  }
}
