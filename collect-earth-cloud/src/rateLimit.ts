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
 * request.ip is the real client because the server trusts only its own proxies' hops
 * (TRUST_PROXY_HOPS).
 */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /**
   * @param perMinute requests allowed per minute per key; 0 disables the limiter.
   * @param options.onRefused told of each request `guard` refuses (the server owner's counters).
   * @param options.windowMs the window's length (a minute by default; `perMinute` is then per window).
   */
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly options: { onRefused?: () => void; windowMs?: number } = {},
  ) {}

  private get windowMs(): number {
    return this.options.windowMs ?? WINDOW_MS;
  }

  /** Counts one hit; returns false when the key is over its limit for this window. */
  hit(key: string): boolean {
    if (this.perMinute <= 0) {
      return true;
    }
    const now = this.now();
    if (this.windows.size > SWEEP_THRESHOLD) {
      for (const [k, w] of this.windows) {
        if (now - w.start >= this.windowMs) {
          this.windows.delete(k);
        }
      }
    }
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
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
    return !!window && this.now() - window.start < this.windowMs && window.count >= this.perMinute;
  }

  /** preHandler limiting one named bucket (e.g. "login"); over the limit -> 429 rate_limited. */
  guard(bucket: string): preHandlerHookHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!this.hit(`${bucket} ${request.ip}`)) {
        this.options.onRefused?.();
        return reply
          .code(429)
          .header('retry-after', String(Math.ceil(this.windowMs / 1000)))
          .send(RATE_LIMITED);
      }
      return undefined;
    };
  }
}
