import { describe, expect, it } from 'vitest';
import { ServerCounters, COUNTER_HOURS } from '../src/serverCounters.js';
import { RateLimiter } from '../src/rateLimit.js';

const HOUR = 3_600_000;

describe('ServerCounters', () => {
  it('counts failed logins and refusals by hour since the server started', () => {
    let now = Date.UTC(2026, 10, 2, 9, 15);
    const c = new ServerCounters(() => now);
    c.count('failedLogin');
    c.count('failedLogin');
    c.count('rateLimited');
    now += HOUR;
    c.count('rateLimited');
    const s = c.snapshot();
    expect(s.since).toBe(Date.UTC(2026, 10, 2, 9, 15));
    expect(s.totals).toEqual({ failedLogins: 2, rateLimited: 2 });
    expect(s.hours).toEqual([
      { hour: Date.UTC(2026, 10, 2, 9), failedLogins: 2, rateLimited: 1 },
      { hour: Date.UTC(2026, 10, 2, 10), failedLogins: 0, rateLimited: 1 },
    ]);
  });

  it(`keeps the hours of the last ${COUNTER_HOURS / 24} days only, the totals since the start`, () => {
    let now = Date.UTC(2026, 0, 1);
    const c = new ServerCounters(() => now);
    for (let h = 0; h < COUNTER_HOURS + 10; h++) {
      c.count('failedLogin');
      now += HOUR;
    }
    now -= HOUR; // the hour of the last count
    const s = c.snapshot();
    expect(s.totals.failedLogins).toBe(COUNTER_HOURS + 10);
    expect(s.hours.length).toBe(COUNTER_HOURS);
    expect(s.hours[0].hour).toBe(Date.UTC(2026, 0, 1) + 10 * HOUR);
  });

  it('is told by the rate limiter of each request it refuses', async () => {
    let refused = 0;
    const limiter = new RateLimiter(1, Date.now, { onRefused: () => refused++ });
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
    expect(refused).toBe(0); // hit() alone does not count: only a refused request does
    const guard = limiter.guard('login');
    const reply = { code: () => reply, header: () => reply, send: () => reply };
    const request = { ip: '10.0.0.1' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (guard as any)(request, reply);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (guard as any)(request, reply);
    expect(refused).toBe(1);
  });
});
