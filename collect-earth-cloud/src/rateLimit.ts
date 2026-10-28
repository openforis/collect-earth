import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

const WINDOW_MS = 60 * 1000;
/** Above this many tracked keys, expired windows are swept on the next hit. */
const SWEEP_THRESHOLD = 10_000;

export const RATE_LIMITED = { error: 'rate_limited', reason: 'too many attempts, wait a minute and try again' };

interface Window {
  start: number;
  count: number;
}

/**
 * Fixed-window, in-memory request counter keyed by (bucket, client IP). Good
 * enough against password guessing on a single instance; with several instances
 * each one counts on its own, which only loosens the limit, never blocks wrongly.
 * request.ip is the real client because the server runs with trustProxy.
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /** @param perMinute requests allowed per minute per key; 0 disables the limiter. */
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one hit; returns false when the key is over its limit for this window. */
  hit(key: string): boolean {
    if (this.perMinute <= 0) {
      return true;
    }
    const now = this.now();
    if (this.windows.size > SWEEP_THRESHOLD) {
      for (const [k, w] of this.windows) {
        if (now - w.start >= WINDOW_MS) {
          this.windows.delete(k);
        }
      }
    }
    const window = this.windows.get(key);
    if (!window || now - window.start >= WINDOW_MS) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.perMinute;
  }

  /** True when the key has used up its limit for this window; does not count a hit. */
  blocked(key: string): boolean {
    if (this.perMinute <= 0) {
      return false;
    }
    const window = this.windows.get(key);
    return !!window && this.now() - window.start < WINDOW_MS && window.count >= this.perMinute;
  }

  /** preHandler limiting one named bucket (e.g. "login"); over the limit -> 429 rate_limited. */
  guard(bucket: string): preHandlerHookHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!this.hit(`${bucket} ${request.ip}`)) {
        return reply
          .code(429)
          .header('retry-after', String(WINDOW_MS / 1000))
          .send(RATE_LIMITED);
      }
      return undefined;
    };
  }
}
