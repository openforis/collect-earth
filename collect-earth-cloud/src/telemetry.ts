import { createHash } from 'node:crypto';
import { redactUrlsIn } from './logRedact.js';

/**
 * Error reports (Sentry) and usage events (Google Analytics 4, Measurement Protocol, from the
 * server: no cookie and no script in the browser), as the desktop app has them. Off unless the
 * server is started with TELEMETRY=1, so a self-hosted server sends nothing by default. Then:
 * - Sentry: SENTRY_DSN, or the desktop app's project; SENTRY_ENVIRONMENT (default "production").
 * - Google Analytics: GA_MEASUREMENT_ID (default the desktop app's property) and GA_API_SECRET,
 *   required (it cannot be in a public repository): without it no event is sent.
 * Nothing personal leaves: Sentry gets no request body, header, cookie or user; an event carries a
 * client id hashed from the project and account ids, and only kinds and counts as parameters.
 */

/** The desktop app's Sentry project (EarthApp.initializeSentry), its public key only. */
export const DESKTOP_SENTRY_DSN = 'https://24dd6a90c1e4461484712db99c3b3bb7@sentry.io/299626';
/** The desktop app's Google Analytics property (GAlogger). */
export const DESKTOP_GA_MEASUREMENT_ID = 'G-8K943HZKJZ';

export interface TelemetryConfig {
  sentryDsn: string | null;
  environment: string;
  gaMeasurementId: string | null;
  gaApiSecret: string | null;
}

export const NO_TELEMETRY: TelemetryConfig = { sentryDsn: null, environment: 'production', gaMeasurementId: null, gaApiSecret: null };

export function telemetryConfigOf(env: NodeJS.ProcessEnv): TelemetryConfig {
  const on = (env.TELEMETRY ?? '').trim().toLowerCase();
  if (!['', '0', '1', 'true', 'false'].includes(on)) throw new Error(`Invalid TELEMETRY "${env.TELEMETRY}" (expected 1 to send error reports and usage events, or 0 / unset)`);
  if (on !== '1' && on !== 'true') return NO_TELEMETRY;
  const text = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : null);
  const secret = text(env.GA_API_SECRET);
  return {
    sentryDsn: text(env.SENTRY_DSN) ?? DESKTOP_SENTRY_DSN,
    environment: text(env.SENTRY_ENVIRONMENT) ?? 'production',
    gaMeasurementId: secret ? (text(env.GA_MEASUREMENT_ID) ?? DESKTOP_GA_MEASUREMENT_ID) : null,
    gaApiSecret: secret,
  };
}

/** The events the server and the dashboard send, and the parameters each may carry (kinds and counts only). */
export const EVENTS = {
  training_set_created: ['kind', 'plots'],
  training_set_changed: ['kind', 'change'],
  training_set_deleted: ['kind'],
  training_members_set: ['people'],
  training_golden_set: ['from', 'plots'],
  training_attempts_started: ['people', 'scope'],
  training_records_synced: ['records'],
  training_file_downloaded: ['kind', 'attempt'],
  training_figures_viewed: ['role', 'sets'],
  my_training_viewed: ['sets', 'learning'],
  plot_file_replace_asked: ['held', 'submitted'],
  plot_file_replaced: [],
  plot_file_refused: ['reason'],
  // Sent by the dashboard (POST /v1/projects/:pid/telemetry): what the server cannot see.
  training_report_opened: ['kind'],
  training_report_printed: ['kind'],
} as const satisfies Record<string, readonly string[]>;
export type EventName = keyof typeof EVENTS;
/** Events the dashboard may send. */
export const DASHBOARD_EVENTS: readonly EventName[] = ['training_report_opened', 'training_report_printed'];

type Params = Record<string, string | number | boolean | null | undefined>;

/** A stable, anonymous client id for GA: a hash of the project and account ids (or the project alone). */
export function clientIdOf(projectId: string, userId: string | null | undefined): string {
  return createHash('sha256').update(`collect-earth-cloud:${projectId}:${userId ?? ''}`).digest('hex').slice(0, 32);
}

/** The parameters an event may carry, kept to short strings, numbers and booleans. */
export function cleanParams(name: EventName, params: Params): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of EVENTS[name] as readonly string[]) {
    const v = params[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v)) out[key] = v;
  }
  return out;
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

type Sender = (url: string, body: string) => Promise<void>;
interface Log {
  warn: (obj: object, msg?: string) => void;
}

const defaultSender: Sender = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(3000) });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
};

export class Telemetry {
  private config: TelemetryConfig = NO_TELEMETRY;
  private version = '';
  private log: Log | null = null;
  private sentry: typeof import('@sentry/node') | null = null;
  private sender: Sender = defaultSender;

  /** Sets the server's telemetry up (once, at start); Sentry is loaded only when it is on. */
  async configure(config: TelemetryConfig, version: string, log: Log): Promise<void> {
    this.config = config;
    this.version = version;
    this.log = log;
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

  /** For tests: where events go. */
  setSender(sender: Sender, config: Partial<TelemetryConfig> = {}): void {
    this.sender = sender;
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.config = NO_TELEMETRY;
    this.sender = defaultSender;
    this.sentry = null;
  }

  /** The dashboard's Sentry settings (no secret), when error reports are on. */
  dashboardConfig(): { sentryDsn: string | null; environment: string; release: string; events: boolean } | null {
    const events = Boolean(this.config.gaMeasurementId && this.config.gaApiSecret);
    if (!this.config.sentryDsn && !events) return null;
    return { sentryDsn: this.config.sentryDsn, environment: this.config.environment, release: `collect-earth-cloud@${this.version}`, events };
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

  /** Sends a usage event to Google Analytics, never waiting for it nor failing the caller. */
  event(name: EventName, who: { projectId: string; userId?: string | null }, params: Params = {}): void {
    const { gaMeasurementId: id, gaApiSecret: secret } = this.config;
    if (!id || !secret) return;
    const body = JSON.stringify({
      client_id: clientIdOf(who.projectId, who.userId),
      non_personalized_ads: true,
      events: [{ name, params: { ...cleanParams(name, params), app: 'cloud', version: this.version, engagement_time_msec: 1 } }],
    });
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(secret)}`;
    this.sender(url, body).catch((err: unknown) => this.log?.warn({ err: String(err) }, 'analytics event not sent'));
  }
}

/** The server's telemetry (configured in index.ts; a no-op until then, and in tests). */
export const telemetry = new Telemetry();
