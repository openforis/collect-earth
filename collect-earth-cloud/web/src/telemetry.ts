import type { DashboardTelemetry } from "./api";

/**
 * The dashboard's error reports (Sentry), when the server sends them (its TELEMETRY setting). The
 * Sentry SDK is loaded only then. Nothing personal: no user, no request bodies, the tokens of
 * links (invitations, resets, progress links, mail links) taken out of every address.
 */

/** An address without its query, and with the token of a link replaced. */
export function scrubUrl(url: string): string {
  const noQuery = url.split(/[?#]/)[0];
  return noQuery.replace(/\/(join|reset|p|progress|unsubscribe|confirm-email)\/[^/]+/g, "/$1/:token");
}

interface SentryEventLike {
  request?: { url?: string; headers?: unknown; cookies?: unknown; data?: unknown; query_string?: unknown };
  user?: unknown;
  breadcrumbs?: { data?: Record<string, unknown>; message?: string; category?: string }[];
}

export function scrubEvent<E extends SentryEventLike>(event: E): E {
  delete event.user;
  if (event.request) event.request = { url: event.request.url ? scrubUrl(event.request.url) : undefined };
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.data && typeof crumb.data.url === "string") crumb.data.url = scrubUrl(crumb.data.url);
    if (crumb.data && typeof crumb.data.to === "string") crumb.data.to = scrubUrl(crumb.data.to);
    if (crumb.data && typeof crumb.data.from === "string") crumb.data.from = scrubUrl(crumb.data.from);
  }
  return event;
}

let started = false;

/** Starts Sentry once, when the server gives a DSN; never fails the page. */
export async function startErrorReports(config: DashboardTelemetry | null | undefined): Promise<void> {
  if (started || !config?.sentryDsn) return;
  started = true;
  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn: config.sentryDsn,
      release: config.release,
      environment: config.environment,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Console messages can hold anything a page logged.
      beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
      beforeSend: (event) => scrubEvent(event),
    });
    Sentry.setTag("app", "dashboard");
  } catch {
    started = false;
  }
}
