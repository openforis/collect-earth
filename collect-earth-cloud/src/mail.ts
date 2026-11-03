// Sending email (Task 19, Decision 5): one interface, three transports.
// - `log` (the default, and always in development): nothing is sent; the server log gets a short
//   summary (what kind of mail, the recipient's domain, the sizes), never the body, its links or the
//   full address.
// - `smtp`, only when SMTP_URL is set (with MAIL_FROM): nodemailer over TLS. smtps:// is TLS from the
//   start; smtp:// must upgrade with STARTTLS (requireTLS) unless the host is this machine (a local
//   relay). Certificates are always checked. Options in the URL (?ignoreTLS=…, ?tls.…) are refused,
//   so nothing in the environment can turn the checks off.
// - `test`: keeps the messages in memory for the tests. No test sends real mail.
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

/** For tests: keeps every message; `fail` makes a send throw (a mail server refusing). */
export class TestMailer implements Mailer {
  readonly transport = 'test' as const;
  readonly delivers = true;
  readonly sent: MailMessage[] = [];
  fail: ((message: MailMessage) => boolean) | null = null;

  async send(message: MailMessage): Promise<void> {
    if (this.fail?.(message)) throw new Error('the test mail server refused the message');
    this.sent.push(message);
  }
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

/** A From address: `name@domain` or `Name <name@domain>`, one line. */
export function isMailFrom(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const angle = /^[^<>]*<([^<>\s]+@[^<>\s]+\.[^<>\s]+)>$/.exec(value.trim());
  return angle !== null || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim());
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
    this.transporter = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: settings.requireTLS,
      ...(settings.auth ? { auth: settings.auth } : {}),
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: settings.host },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      // Never written to the log by nodemailer (its own logger is off by default).
      logger: false,
      debug: false,
    });
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
