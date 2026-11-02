/** How many hours of counts are kept: the last 7 days. The totals go back to the start. */
export const COUNTER_HOURS = 7 * 24;

const HOUR_MS = 3_600_000;

export type CounterKind = 'failedLogin' | 'rateLimited';

export interface HourCounts {
  /** The hour's start (epoch ms, UTC). */
  hour: number;
  failedLogins: number;
  rateLimited: number;
}

export interface CountersSnapshot {
  /** When this server process started counting (epoch ms). */
  since: number;
  totals: { failedLogins: number; rateLimited: number };
  /** Hours with any count, oldest first, at most COUNTER_HOURS of the latest ones. */
  hours: HourCounts[];
}

/**
 * Failed logins and requests refused by the rate limiter, counted in memory by hour since
 * this process started (the server owner's panel, Task 11). Each instance counts its own;
 * a restart starts again from zero, which the panel says.
 */
export class ServerCounters {
  private readonly since: number;
  private readonly hours = new Map<number, HourCounts>();
  private readonly totals = { failedLogins: 0, rateLimited: 0 };

  constructor(private readonly now: () => number = Date.now) {
    this.since = now();
  }

  count(kind: CounterKind): void {
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

  snapshot(): CountersSnapshot {
    const oldest = Math.floor(this.now() / HOUR_MS) * HOUR_MS - (COUNTER_HOURS - 1) * HOUR_MS;
    return {
      since: this.since,
      totals: { ...this.totals },
      hours: [...this.hours.values()]
        .filter((h) => h.hour >= oldest)
        .sort((a, b) => a.hour - b.hour)
        .map((h) => ({ ...h })),
    };
  }
}
