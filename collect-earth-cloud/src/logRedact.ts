// Secrets that travel in addresses (Task 18 review): a progress link, an invitation, a password
// reset page, a backup download and a mail's unsubscribe and confirm links (Task 19) carry their
// token in the path, so the request log would hold working links. The server's own log lines get
// the address with that segment replaced; the platform's request log (Cloud Run's
// httpRequest.requestUrl) still has the full address (DEPLOY.md).
import type { FastifyRequest } from 'fastify';

/** Paths whose next segment is a secret token. */
const SECRET_PREFIXES = ['/v1/public/progress/', '/p/', '/v1/join/', '/join/', '/reset/', '/v1/collect-backup/', '/v1/unsubscribe/', '/unsubscribe/', '/confirm-email/'];
/** Query parameters that may hold a token. */
const SECRET_PARAMS = /([?&](?:token|inviteToken|resetToken)=)[^&#]*/gi;

export const REDACTED = '<redacted>';

/** The address with any token in it replaced by <redacted>. */
export function redactUrl(url: string): string {
  const q = url.search(/[?#]/);
  let path = q === -1 ? url : url.slice(0, q);
  const rest = q === -1 ? '' : url.slice(q);
  for (const prefix of SECRET_PREFIXES) {
    if (path.startsWith(prefix) && path.length > prefix.length) {
      const after = path.slice(prefix.length);
      const slash = after.indexOf('/');
      path = `${prefix}${REDACTED}${slash === -1 ? '' : after.slice(slash)}`;
      break;
    }
  }
  return path + rest.replace(SECRET_PARAMS, `$1${REDACTED}`);
}

/** The request as the log writes it: Fastify's default fields, with the address redacted. */
export function requestSerializer(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: redactUrl(request.url),
    hostname: request.hostname,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
