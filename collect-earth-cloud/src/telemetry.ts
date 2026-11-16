import { redactUrlsIn } from './logRedact.js';
import type { DashboardTelemetry } from './wire/account.js';

/**
 * Error reports (Sentry), as the desktop app has them. Off unless the server is started with
 * TELEMETRY=1, so a self-hosted server sends nothing by default. Then SENTRY_DSN, or the desktop
 * app's project; SENTRY_ENVIRONMENT (default "production"). No usage events: only the desktop app
 * counts plots, when they are submitted. Nothing personal leaves: Sentry gets no request body,
 * header, cookie or user.
 */

/** The desktop app's Sentry project (EarthApp.initializeSentry), its public key only. */
export const DESKTOP_SENTRY_DSN = 'https://24dd6a90c1e4461484712db99c3b3bb7@sentry.io/299626';

export interface TelemetryConfig {
  sentryDsn: string | null;
  environment: string;
}

export const NO_TELEMETRY: TelemetryConfig = { sentryDsn: null, environment: 'production' };

export function telemetryConfigOf(env: NodeJS.ProcessEnv): TelemetryConfig {
  const on = (env.TELEMETRY ?? '').trim().toLowerCase();
  if (!['', '0', '1', 'true', 'false'].includes(on)) throw new Error(`Invalid TELEMETRY "${env.TELEMETRY}" (expected 1 to send error reports, or 0 / unset)`);
  if (on !== '1' && on !== 'true') return NO_TELEMETRY;
  const text = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : null);
  return {
    sentryDsn: text(env.SENTRY_DSN) ?? DESKTOP_SENTRY_DSN,
    environment: text(env.SENTRY_ENVIRONMENT) ?? 'production',
  };
}

/** What Sentry may keep of an event: no request body, headers, cookies, query string nor user. */
export function scrubEvent<E extends { request?: object; user?: unknown; transaction?: unknown }>(event: E): E {
  if (event.request) {
    const { url, method } = event.request as { url?: unknown; method?: unknown };
    // No query string, and no token in the path: an invitation, a password reset or a progress link
    // there is a working link for whoever reads the reports (logRedact's list of such paths)
    (event as { request?: object }).request = { url: typeof url === 'string' ? redactUrlsIn(url.split('?')[0]) : undefined, method };
  }
  if (typeof event.transaction === 'string') {
    (event as { transaction?: unknown }).transaction = redactUrlsIn(event.transaction);
  }
  delete event.user;
  return event;
}

export class Telemetry {
  private config: TelemetryConfig = NO_TELEMETRY;
  private version = '';
  private sentry: typeof import('@sentry/node') | null = null;

  /** Sets the server's telemetry up (once, at start); Sentry is loaded only when it is on. */
  async configure(config: TelemetryConfig, version: string): Promise<void> {
    this.config = config;
    this.version = version;
    if (config.sentryDsn) {
      const sentry = await import('@sentry/node');
      sentry.init({
        dsn: config.sentryDsn,
        release: `collect-earth-cloud@${version}`,
        environment: config.environment,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (crumb) => (crumb.category === 'console' || crumb.category === 'http' ? null : crumb),
      });
      sentry.setTag('app', 'cloud');
      this.sentry = sentry;
    }
  }

  /** The dashboard's Sentry settings (no secret), when error reports are on. */
  dashboardConfig(): DashboardTelemetry | null {
    if (!this.config.sentryDsn) return null;
    return { sentryDsn: this.config.sentryDsn, environment: this.config.environment, release: `collect-earth-cloud@${this.version}` };
  }

  /** Reports an error to Sentry with some tags (ids and kinds, never names). */
  captureError(err: unknown, tags: Record<string, string | undefined> = {}): void {
    if (!this.sentry) return;
    const sentry = this.sentry;
    sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(tags)) if (v !== undefined) scope.setTag(k, v);
      sentry.captureException(err);
    });
  }
}

/** The server's telemetry (configured in index.ts; a no-op until then, and in tests). */
export const telemetry = new Telemetry();
