// Checks a deployment's error reports against Sentry, with its own settings (TELEMETRY=1,
// SENTRY_DSN, ...): sends one test error to Sentry (environment "telemetry-check", so it is easy to
// find and resolve). Prints whether it worked.
//
//   TELEMETRY=1 npm run telemetry:check
import { scrubEvent, telemetryConfigOf } from '../src/telemetry.js';

const config = telemetryConfigOf(process.env);
if (!config.sentryDsn) {
  console.log('Telemetry is off: start this with TELEMETRY=1.');
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
}
process.exit(failed ? 1 : 0);
