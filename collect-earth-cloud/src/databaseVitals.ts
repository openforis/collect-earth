// How the database kept up over the last hour, per server instance: how long requests waited for one of the pool's
// connections, and how many found none in time (answered 503 busy). Told to the server's owner with the alerts about
// errors (src/ownerAlerts.ts), because a database too small for its load first shows as requests waiting for it: on
// cloud.collectearth.org (load tests, November 2026) the server answered /health in half a second while every request
// that needed the database waited 10 to 20 s (DEPLOY.md, "Is the database big enough?").
//
// In memory, a minute at a time (60 buckets of a few numbers each): nothing grows with the load. Apart from
// postgres.ts, which the local build replaces, so the server reads it whatever the store.

/** A wait that is slow: one second (a healthy database gives a connection in a few milliseconds) */
export const SLOW_WAIT_MS = 1000;
const MINUTE_MS = 60_000;
const MINUTES = 60;
/** Upper bounds (ms) of the wait histogram's buckets, for the 95th percentile; the last one is "longer" */
const BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];

interface Minute {
  minute: number;
  waits: number;
  slow: number;
  busy: number;
  maxMs: number;
  histogram: number[];
}

/** The last hour of one instance's database waits */
export interface DatabaseSummary {
  /** Connections taken */
  waits: number;
  /** Of those, taken after SLOW_WAIT_MS or more */
  slow: number;
  /** Requests answered 503 busy: no connection came free within PG_CONNECT_TIMEOUT_MS */
  busy: number;
  /** The longest wait for a connection (ms) */
  maxWaitMs: number;
  /** 95 in 100 connections were taken within this (ms, the histogram's bucket bound; null without waits) */
  p95WaitMs: number | null;
}

export class DatabaseVitals {
  private readonly minutes: Minute[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  private current(): Minute {
    const minute = Math.floor(this.now() / MINUTE_MS);
    let m = this.minutes.at(-1);
    if (!m || m.minute !== minute) {
      m = { minute, waits: 0, slow: 0, busy: 0, maxMs: 0, histogram: new Array(BOUNDS.length + 1).fill(0) };
      this.minutes.push(m);
      while (this.minutes.length > MINUTES || (this.minutes.length > 0 && this.minutes[0].minute <= minute - MINUTES)) this.minutes.shift();
    }
    return m;
  }

  /** A connection taken after `ms` of waiting */
  noteWait(ms: number): void {
    const m = this.current();
    m.waits += 1;
    if (ms >= SLOW_WAIT_MS) m.slow += 1;
    if (ms > m.maxMs) m.maxMs = ms;
    const i = BOUNDS.findIndex((b) => ms <= b);
    m.histogram[i === -1 ? BOUNDS.length : i] += 1;
  }

  /** A request answered 503 busy: no connection came free in time */
  noteBusy(): void {
    this.current().busy += 1;
  }

  /** The last hour (the current minute and the 59 before it) */
  summary(): DatabaseSummary {
    const from = Math.floor(this.now() / MINUTE_MS) - MINUTES;
    const histogram = new Array(BOUNDS.length + 1).fill(0);
    const s: DatabaseSummary = { waits: 0, slow: 0, busy: 0, maxWaitMs: 0, p95WaitMs: null };
    for (const m of this.minutes) {
      if (m.minute <= from) continue;
      s.waits += m.waits;
      s.slow += m.slow;
      s.busy += m.busy;
      s.maxWaitMs = Math.max(s.maxWaitMs, m.maxMs);
      m.histogram.forEach((n, i) => (histogram[i] += n));
    }
    if (s.waits > 0) {
      let seen = 0;
      const at = Math.ceil(s.waits * 0.95);
      for (let i = 0; i < histogram.length; i++) {
        seen += histogram[i];
        if (seen >= at) {
          s.p95WaitMs = i < BOUNDS.length ? BOUNDS[i] : s.maxWaitMs;
          break;
        }
      }
    }
    return s;
  }
}

/** Whether the last hour shows the database not keeping up: a request answered busy, or a connection taken slowly */
export const databaseStruggled = (s: DatabaseSummary): boolean => s.busy > 0 || s.slow > 0;

/** The instance's own (the Postgres store writes to it; the server reads it for the alerts) */
export const databaseVitals = new DatabaseVitals();
