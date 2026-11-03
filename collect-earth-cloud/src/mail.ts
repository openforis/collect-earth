// Sending email (Task 19, Decision 5): one interface, three transports.
// - `log` (the default, and always in development): nothing is sent; the server log gets a short
//   summary (what kind of mail, the recipient's domain, the sizes), never the body, its links or the
//   full address.
// - `smtp`, only when SMTP_URL is set (with MAIL_FROM): nodemailer over TLS. smtps:// is TLS from the
//   start; smtp:// must upgrade with STARTTLS (requireTLS) unless the host is this machine (a local
//   relay). Certificates are always checked. Options in the URL (?ignoreTLS=…, ?tls.…) are refused,
//   so nothing in the environment can turn the checks off.
// - `test`: keeps the messages in memory for the tests. No test sends real mail.
import { isIP } from 'node:net';
import { createTransport } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers (List-Unsubscribe…). */
  headers?: Record<string, string>;
  /** What kind of mail it is, for the log ('digest.coordinator', 'email.confirm'…). */
  tag: string;
}

export interface Mailer {
  readonly transport: 'log' | 'smtp' | 'test';
  /** False for the log transport: nothing reaches anyone (the digest then marks nothing sent). */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

interface Log {
  info(obj: object, msg: string): void;
}

/** The domain of an address, for the log (the address itself is personal data). */
export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '?' : `…${address.slice(at)}`;
}

/** No SMTP configured: writes a summary to the log, never the body nor its links. */
export class LogMailer implements Mailer {
  readonly transport = 'log' as const;
  readonly delivers = false;
  constructor(private readonly log: Log) {}

  async send(message: MailMessage): Promise<void> {
    this.log.info(
      {
        mail: {
          tag: message.tag,
          to: domainOf(message.to),
          textBytes: Buffer.byteLength(message.text),
          htmlBytes: Buffer.byteLength(message.html),
          headers: Object.keys(message.headers ?? {}),
        },
      },
      'mail not sent: no SMTP_URL is set (log transport)',
    );
  }
}

/** For tests: keeps every message; `fail` makes a send throw (a mail server refusing), with `failWith`'s fields. */
export class TestMailer implements Mailer {
  readonly transport = 'test' as const;
  readonly delivers = true;
  readonly sent: MailMessage[] = [];
  fail: ((message: MailMessage) => boolean) | null = null;
  failWith: { code?: string; responseCode?: number; command?: string } = {};

  async send(message: MailMessage): Promise<void> {
    if (this.fail?.(message)) throw Object.assign(new Error(`the test mail server refused ${message.to}`), this.failWith);
    this.sent.push(message);
  }
}

/**
 * What the log may say of a failed send: nodemailer's error code, the SMTP reply code and the
 * command. Never the message or the server's response, which may hold addresses.
 */
export function errorSummary(err: unknown): { code: string | null; responseCode: number | null; command: string | null } {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; command?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code.slice(0, 40) : null,
    responseCode: typeof e.responseCode === 'number' ? e.responseCode : null,
    command: typeof e.command === 'string' ? e.command.slice(0, 40) : null,
  };
}

/** A refusal for good (an SMTP 5xx reply: no such mailbox, refused): trying again the same week does not help. */
export function isPermanentFailure(err: unknown): boolean {
  const code = errorSummary(err).responseCode;
  return code !== null && code >= 500 && code < 600;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** TLS from the first byte (smtps://, port 465 by default). */
  secure: boolean;
  /** STARTTLS required (smtp:// to another machine): the mail is never sent in the clear. */
  requireTLS: boolean;
  auth: { user: string; pass: string } | null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * SMTP_URL read: `smtps://user:password@host[:465]` or `smtp://user:password@host[:587]` (STARTTLS
 * required), or `smtp://localhost[:25]` for a relay on this machine. Throws with a reason that never
 * holds the password.
 */
export function parseSmtpUrl(raw: string): SmtpSettings {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SMTP_URL is not a URL (smtps://user:password@host:465 or smtp://user:password@host:587)');
  }
  if (url.protocol !== 'smtps:' && url.protocol !== 'smtp:') {
    throw new Error('SMTP_URL must start with smtps:// (TLS) or smtp:// (STARTTLS)');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('SMTP_URL must not carry options (?…): TLS and certificate checks cannot be changed');
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    throw new Error('SMTP_URL must be only the server: smtps://user:password@host:port');
  }
  const host = url.hostname;
  if (host === '') throw new Error('SMTP_URL names no host');
  const secure = url.protocol === 'smtps:';
  const port = url.port === '' ? (secure ? 465 : 587) : Number(url.port);
  const local = LOCAL_HOSTS.has(host);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  return {
    host: host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host,
    port,
    secure,
    requireTLS: !secure && !local,
    auth: user === '' ? null : { user, pass },
  };
}

/**
 * A From address: `name@domain` or `Name <name@domain>`, one line, one address. A display name with
 * a comma or semicolon must be quoted (`"FAO, Forestry" <…>`): unquoted, it would read as two addresses.
 */
export function isMailFrom(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const text = value.trim();
  const angle = /^([^<>]*)<([^<>\s,;]+@[^<>\s,;]+\.[^<>\s,;]+)>$/.exec(text);
  if (angle) {
    const name = angle[1].trim();
    if (name.startsWith('"')) return /^"[^"\\]*"$/.test(name);
    return !/[,;"]/.test(name);
  }
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(text);
}

/** nodemailer's options for the settings: TLS required, certificates checked; the TLS name (SNI) only for a host name. */
export function transportOptions(settings: SmtpSettings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    ...(settings.auth ? { auth: settings.auth } : {}),
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' as const, ...(isIP(settings.host) === 0 ? { servername: settings.host } : {}) } as {
      rejectUnauthorized: true;
      minVersion: 'TLSv1.2';
      servername?: string;
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    // Never written to the log by nodemailer (its own logger is off by default).
    logger: false,
    debug: false,
  };
}

/** SMTP through nodemailer, over TLS only, certificates checked. */
export class SmtpMailer implements Mailer {
  readonly transport = 'smtp' as const;
  readonly delivers = true;
  private readonly transporter;

  constructor(
    settings: SmtpSettings,
    private readonly from: string,
  ) {
    this.transporter = createTransport(transportOptions(settings));
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });
  }
}

/** The server's mailer: SMTP when SMTP_URL and MAIL_FROM are set (config checked them), else the log. */
export function mailerFrom(config: { smtpUrl?: string; mailFrom?: string }, log: Log): Mailer {
  if (config.smtpUrl && config.mailFrom) return new SmtpMailer(parseSmtpUrl(config.smtpUrl), config.mailFrom);
  return new LogMailer(log);
}
