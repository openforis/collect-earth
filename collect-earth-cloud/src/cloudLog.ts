// How the server's log lines read in Google Cloud Logging, where Cloud Run sends what the server writes. Each line is
// pino's JSON; Cloud Logging takes a few fields of it as the entry's own:
//   - `severity`: pino writes its level as a number (`level`: 40 warn, 50 error), which Cloud Logging does not read, so
//     every line had no severity and `severity>=ERROR` found none. Each line now says it as Cloud Logging names it,
//     and keeps the number (the owner's error mail reads it: src/errorLog.ts);
//   - `message`: the line's text (pino's `msg`), which the log viewer shows as the entry's summary;
//   - `logging.googleapis.com/trace`: the request's trace (Cloud Run's x-cloud-trace-context), which groups a request's
//     lines with Cloud Run's own line for it ("show entries for this trace"); it needs the Google Cloud project
//     (GOOGLE_CLOUD_PROJECT, which deploy/gcp/deploy.sh sets). The trace id is also in `trace`, to search by;
//   - `stack_trace`: an error's stack (a failed request's `failure`, a background task's `err`), where Error Reporting
//     looks for one.
// Nothing here is Google's only: on another host the lines are the same JSON with a few more fields.
import { redactUrlsIn } from './logRedact.js';

/** The text of a line: `message`, as Cloud Logging shows it (pino's default is `msg`). */
export const MESSAGE_KEY = 'message';

const SEVERITY: Record<string, string> = { trace: 'DEBUG', debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL' };

/** Cloud Logging's severity of a pino level. */
export function severityOf(label: string): string {
  return SEVERITY[label] ?? 'DEFAULT';
}

/** The stack of what failed, when a line is about an error: a failed request's `failure`, or an `err`. */
function stackOf(object: Record<string, unknown>): string | null {
  const failure = object.failure as { stack?: unknown } | undefined;
  if (failure && typeof failure.stack === 'string') return failure.stack;
  const err = object.err as { stack?: unknown } | undefined;
  // pino's `err` is still the Error here (the serializer runs after the formatters); its stack, redacted as a failure's is
  if (err && typeof err.stack === 'string') return redactUrlsIn(err.stack);
  return null;
}

/** pino's formatters for the server's logger. */
export const logFormatters = {
  level: (label: string, number: number) => ({ level: number, severity: severityOf(label) }),
  log: (object: Record<string, unknown>) => {
    const stack = stackOf(object);
    return stack ? { ...object, stack_trace: stack } : object;
  },
};

const TRACE_ID = /^[0-9a-f]{32}$/i;

/**
 * The fields of a request's lines that name its trace, from Cloud Run's x-cloud-trace-context
 * (`TRACE_ID/SPAN_ID;o=1`): none without one, or one that is no trace id.
 */
export function traceFields(header: string | string[] | undefined, project: string | undefined): Record<string, string> {
  const value = Array.isArray(header) ? header[0] : header;
  const id = value?.split('/')[0]?.trim() ?? '';
  if (!TRACE_ID.test(id)) return {};
  const trace = id.toLowerCase();
  return project ? { 'logging.googleapis.com/trace': `projects/${project}/traces/${trace}`, trace } : { trace };
}

/** At most this much of a client's User-Agent is written: enough for Collect Earth's version or the browser. */
export const MAX_CLIENT = 160;

/**
 * Who a request was for, on its lines when it fails or is written: the project and the account (their ids, never a
 * name or an address), and the client (Collect Earth and its version, or the browser). Empty fields are left out.
 */
export function whoOf(request: { membership?: { projectId?: string; userId?: string }; userId?: string; headers: Record<string, string | string[] | undefined> }): Record<string, string> {
  const who: Record<string, string> = {};
  const project = request.membership?.projectId;
  const user = request.membership?.userId ?? request.userId;
  const agent = request.headers['user-agent'];
  const client = (Array.isArray(agent) ? agent[0] : agent)?.trim();
  if (project) who.projectId = project;
  if (user) who.userId = user;
  if (client) who.client = client.slice(0, MAX_CLIENT);
  return who;
}
