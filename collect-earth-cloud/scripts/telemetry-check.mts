// Checks a deployment's error reports and usage events against the real services, with its own settings
// (TELEMETRY=1, SENTRY_DSN, GA_API_SECRET, ...): sends one test error to Sentry (environment
// "telemetry-check", so it is easy to find and resolve) and asks Google Analytics' validation endpoint
// whether an event is well formed (nothing is recorded there). Prints what worked.
//
//   TELEMETRY=1 GA_API_SECRET=... npm run telemetry:check
import { clientIdOf, scrubEvent, telemetryConfigOf } from '../src/telemetry.js';

const config = telemetryConfigOf(process.env);
if (!config.sentryDsn && !config.gaApiSecret) {
  console.log('Telemetry is off: start this with TELEMETRY=1 (and GA_API_SECRET for usage events).');
  process.exit(1);
}
let failed = false;

if (config.sentryDsn) {
  // The same settings as the server (telemetry.configure), with a transport that tells the answer of Sentry:
  // flush() alone says the queue is empty even when the request failed.
  const sentry = await import('@sentry/node');
  let status: number | string = 'no answer';
  sentry.init({
    dsn: config.sentryDsn,
    environment: 'telemetry-check',
    release: 'collect-earth-cloud@check',
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    transport: (options) => {
      const inner = sentry.makeNodeTransport(options);
      return {
        send: async (envelope) => {
          try {
            const answer = await inner.send(envelope);
            status = answer.statusCode ?? 'no status';
            return answer;
          } catch (err) {
            status = String(err);
            throw err;
          }
        },
        flush: (timeout) => inner.flush(timeout),
      };
    },
  });
  sentry.captureException(new Error('Collect Earth Cloud telemetry check: a test error, safe to resolve'));
  await sentry.flush(10_000);
  const ok = typeof status === 'number' && status >= 200 && status < 300;
  console.log(ok ? `Sentry: test error accepted by ${new URL(config.sentryDsn).host} (environment "telemetry-check").` : `Sentry: the test error was not accepted (${status}).`);
  failed ||= !ok;
} else {
  console.log('Sentry: off.');
}

if (config.gaMeasurementId && config.gaApiSecret) {
  const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(config.gaMeasurementId)}&api_secret=${encodeURIComponent(config.gaApiSecret)}`;
  const body = { client_id: clientIdOf('telemetry-check', null), events: [{ name: 'training_set_created', params: { kind: 'learning', plots: 1, app: 'cloud', engagement_time_msec: 1 } }] };
  try {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const answer = (await res.json()) as { validationMessages?: { description?: string }[] };
    const problems = answer.validationMessages ?? [];
    console.log(problems.length === 0 ? `Google Analytics: the event is valid for ${config.gaMeasurementId}.` : `Google Analytics: ${problems.map((p) => p.description).join('; ')}`);
    failed ||= problems.length > 0;
  } catch (err) {
    console.log(`Google Analytics: could not be reached (${String(err)}).`);
    failed = true;
  }
} else {
  console.log('Google Analytics: off (GA_API_SECRET is not set).');
}
process.exit(failed ? 1 : 0);
