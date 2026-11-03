import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { collectorMail, confirmMail, coordinatorMail, dueWeek, previousWeek, type CollectorProject, type CoordinatorProject, type DigestContext } from '../src/digest.js';
import { DIGEST_WORDS, escapeHtml, oneLine } from '../src/digestText.js';
import { isEmailAddress } from '../src/accountRules.js';
import { linkSecret } from '../src/backupLink.js';
import { errorSummary, isMailFrom, isPermanentFailure, LogMailer, mailerFrom, parseSmtpUrl, SmtpMailer, transportOptions } from '../src/mail.js';
import { mailSecret, readConfirmToken, readUnsubscribeToken, writeConfirmToken, writeUnsubscribeToken, CONFIRM_TTL_MS } from '../src/mailLinks.js';
import { MAIL_LANGUAGES, type MailLanguage } from '../src/types.js';

const SECRET = Buffer.alloc(32, 7);
const OTHER = Buffer.alloc(32, 8);

describe('the mail transport (Task 19)', () => {
  it('reads SMTP_URL: TLS from the start, STARTTLS required elsewhere, plain only on this machine, no options', () => {
    expect(parseSmtpUrl('smtps://mailer:p%40ss@smtp.example.org')).toEqual({ host: 'smtp.example.org', port: 465, secure: true, requireTLS: false, auth: { user: 'mailer', pass: 'p@ss' } });
    expect(parseSmtpUrl('smtp://mailer:pw@smtp.example.org:2525')).toEqual({ host: 'smtp.example.org', port: 2525, secure: false, requireTLS: true, auth: { user: 'mailer', pass: 'pw' } });
    expect(parseSmtpUrl('smtp://smtp.example.org')).toMatchObject({ port: 587, requireTLS: true, auth: null });
    expect(parseSmtpUrl('smtp://localhost:25')).toMatchObject({ host: 'localhost', port: 25, requireTLS: false });
    expect(parseSmtpUrl('smtp://127.0.0.1')).toMatchObject({ requireTLS: false });
    expect(parseSmtpUrl('smtp://[::1]:25')).toMatchObject({ host: '::1', requireTLS: false });
    for (const bad of ['smtp://u:secretpw@smtp.example.org?ignoreTLS=true', 'smtps://u:secretpw@smtp.example.org/?tls.rejectUnauthorized=false', 'http://u:secretpw@smtp.example.org', 'not a url secretpw', 'smtp://u:secretpw@smtp.example.org/path']) {
      let message = '';
      try {
        parseSmtpUrl(bad);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, bad).not.toBe('');
      expect(message).not.toContain('secretpw');
    }
  });

  it('config: mail is off unless SMTP_URL is set, MAIL_FROM is required with it, DIGEST_SECRET must be long', () => {
    expect(loadConfig({})).toMatchObject({ smtpUrl: undefined, mailFrom: undefined, digestSecret: undefined });
    expect(() => loadConfig({ SMTP_URL: 'smtps://u:p@smtp.example.org' })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ SMTP_URL: 'smtp://u:p@smtp.example.org?ignoreTLS=true', MAIL_FROM: 'a@example.org' })).toThrow(/options/);
    expect(() => loadConfig({ MAIL_FROM: 'not an address' })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ DIGEST_SECRET: 'short' })).toThrow(/DIGEST_SECRET/);
    const smtp = { SMTP_URL: 'smtps://u:p@smtp.example.org', MAIL_FROM: 'Collect Earth Cloud <noreply@example.org>', PUBLIC_BASE_URL: 'https://ce.example.org', LINK_SECRET: 'L'.repeat(32) };
    expect(loadConfig({ ...smtp, DIGEST_SECRET: 'x'.repeat(32) })).toMatchObject({
      smtpUrl: 'smtps://u:p@smtp.example.org',
      mailFrom: 'Collect Earth Cloud <noreply@example.org>',
      digestSecret: 'x'.repeat(32),
    });
    // The mails' links never come from a request: with SMTP the base address is required.
    expect(() => loadConfig({ ...smtp, PUBLIC_BASE_URL: '' })).toThrow(/PUBLIC_BASE_URL/);
    expect(loadConfig({ ...smtp, PUBLIC_BASE_URL: '', RENDER_EXTERNAL_URL: 'https://ce.onrender.com' }).smtpUrl).toBeDefined();
    // And a key of their own: never one worked out from DATABASE_URL.
    expect(() => loadConfig({ ...smtp, LINK_SECRET: '' })).toThrow(/LINK_SECRET/);
    expect(() => loadConfig({ ...smtp, LINK_SECRET: 'short' })).toThrow(/LINK_SECRET/);
    // Cloud Scheduler's OIDC token: both settings or neither.
    expect(() => loadConfig({ DIGEST_OIDC_AUDIENCE: 'https://ce.example.org/v1/internal/digest' })).toThrow(/DIGEST_OIDC_EMAIL/);
    expect(loadConfig({ DIGEST_OIDC_AUDIENCE: 'https://a/v1/internal/digest', DIGEST_OIDC_EMAIL: 'sched@p.iam.gserviceaccount.com' })).toMatchObject({
      digestOidc: { audience: 'https://a/v1/internal/digest', email: 'sched@p.iam.gserviceaccount.com' },
    });
    // X-Forwarded-Host is not trusted unless asked.
    expect(loadConfig({}).trustForwardedHost).toBe(false);
    expect(loadConfig({ TRUST_FORWARDED_HOST: 'true' }).trustForwardedHost).toBe(true);
  });

  it('MAIL_FROM: a display name with an unquoted comma or semicolon is refused; TLS names only for host names', () => {
    expect(isMailFrom('noreply@example.org')).toBe(true);
    expect(isMailFrom('Collect Earth Cloud <noreply@example.org>')).toBe(true);
    expect(isMailFrom('"FAO, Forestry" <noreply@example.org>')).toBe(true);
    expect(isMailFrom('FAO, Forestry <noreply@example.org>')).toBe(false);
    expect(isMailFrom('FAO; x <noreply@example.org>')).toBe(false);
    expect(isMailFrom('a@example.org, b@example.org')).toBe(false);
    expect(transportOptions(parseSmtpUrl('smtps://u:p@smtp.example.org')).tls).toMatchObject({ rejectUnauthorized: true, servername: 'smtp.example.org' });
    expect(transportOptions(parseSmtpUrl('smtp://127.0.0.1:25')).tls.servername).toBeUndefined();
    expect(transportOptions(parseSmtpUrl('smtp://[::1]:25')).tls.servername).toBeUndefined();
  });

  it("a send's error is logged by its code only (a mail server's message may hold addresses)", () => {
    const err = Object.assign(new Error('550 5.1.1 <maria@example.org>: Recipient address rejected'), { code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', response: '550 <maria@example.org>' });
    expect(errorSummary(err)).toEqual({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' });
    expect(JSON.stringify(errorSummary(err))).not.toContain('maria');
    expect(errorSummary(new Error('x'))).toEqual({ code: null, responseCode: null, command: null });
    expect(isPermanentFailure(err)).toBe(true);
    expect(isPermanentFailure(Object.assign(new Error('x'), { responseCode: 451 }))).toBe(false);
    expect(isPermanentFailure(new Error('timeout'))).toBe(false);
  });

  it('one address only, at most 254 characters', () => {
    expect(isEmailAddress('maria@example.org')).toBe(true);
    for (const bad of ['maria', 'a@b', 'a b@example.org', 'a@example.org,b@example.org', 'a@example.org;b@example.org', 'a@@example.org', 'a@b@example.org', '<a@example.org>', `${'a'.repeat(250)}@example.org`, 'a@example.org\n', ' a@example.org', 'a\\b@example.org']) {
      expect(isEmailAddress(bad), bad).toBe(false);
    }
  });

  it("the mails' key: LINK_SECRET only, never worked out from DATABASE_URL", () => {
    expect(mailSecret({ linkSecret: 'L'.repeat(32) }).equals(mailSecret({ linkSecret: 'L'.repeat(32), databaseUrl: 'postgres://x' }))).toBe(true);
    expect(mailSecret({ databaseUrl: 'postgres://x' }).equals(mailSecret({ databaseUrl: 'postgres://x' }))).toBe(false);
    expect(mailSecret({ linkSecret: 'L'.repeat(32) }).equals(linkSecret({ linkSecret: 'L'.repeat(32) }))).toBe(false);
  });

  it('the log transport is the default: it writes a summary, never the body, its links or the address', async () => {
    const lines: { obj: object; msg: string }[] = [];
    const log = { info: (obj: object, msg: string) => lines.push({ obj, msg }) };
    const mailer = mailerFrom({}, log);
    expect(mailer).toBeInstanceOf(LogMailer);
    expect(mailer.delivers).toBe(false);
    await mailer.send({ to: 'maria.secret@example.org', subject: 'Subject', text: 'text https://x/v1/unsubscribe/TOKEN123', html: '<a href="https://x/v1/unsubscribe/TOKEN123">x</a>', tag: 'digest.collector', headers: { 'List-Unsubscribe': '<https://x/v1/unsubscribe/TOKEN123>' } });
    expect(lines).toHaveLength(1);
    const written = JSON.stringify(lines);
    expect(written).toContain('digest.collector');
    expect(written).toContain('…@example.org');
    expect(written).not.toContain('TOKEN123');
    expect(written).not.toContain('maria.secret');
    expect(written).not.toContain('https://');
    // With SMTP configured, nodemailer (nothing is sent until a mail is).
    expect(mailerFrom({ smtpUrl: 'smtps://u:p@smtp.example.org', mailFrom: 'a@example.org' }, log)).toBeInstanceOf(SmtpMailer);
  });
});

describe('the mails\' links (Task 19)', () => {
  it('an unsubscribe token is tied to the account and the kind, does not expire, and cannot be changed', () => {
    const token = writeUnsubscribeToken('user-1', 'collector', SECRET);
    expect(readUnsubscribeToken(token, SECRET)).toEqual({ userId: 'user-1', kind: 'collector' });
    expect(readUnsubscribeToken(token, OTHER)).toBeNull();
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'user-2', k: 'collector' })).toString('base64url');
    expect(readUnsubscribeToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(readUnsubscribeToken(`${payload}.${sig}x`, SECRET)).toBeNull();
    expect(readUnsubscribeToken('nonsense', SECRET)).toBeNull();
    expect(readUnsubscribeToken(42, SECRET)).toBeNull();
    // Not a confirmation link, and a confirmation link is not an unsubscribe one.
    expect(readConfirmToken(token, SECRET, 0)).toBeNull();
    expect(readUnsubscribeToken(writeConfirmToken('user-1', 'a@example.org', SECRET, 0), SECRET)).toBeNull();
  });

  it('a confirmation token is tied to the account and the address, and expires', () => {
    const now = 1_800_000_000_000;
    const token = writeConfirmToken('user-1', 'maria@example.org', SECRET, now);
    const read = readConfirmToken(token, SECRET, now + 1000);
    expect(read).not.toBeNull();
    expect(read).not.toBe('expired');
    if (read && read !== 'expired') {
      expect(read.userId).toBe('user-1');
      expect(read.matches('maria@example.org')).toBe(true);
      expect(read.matches('other@example.org')).toBe(false);
    }
    expect(readConfirmToken(token, SECRET, now + CONFIRM_TTL_MS)).toBe('expired');
    expect(readConfirmToken(token, OTHER, now)).toBeNull();
  });
});

describe('the digests\' words (Task 19)', () => {
  const coordinator: CoordinatorProject[] = [
    { projectId: 'p1', name: 'Forest <script>alert(1)</script> & co', submitted: 1234, checks: 5, byEnd: 2000, plots: 5000, quiet: { days: 3, people: ['ben', 'jose'] }, differencesWaiting: 7, hasChecks: true },
    { projectId: 'p2', name: 'Wetlands', submitted: 0, checks: 0, byEnd: 10, plots: 10, quiet: { days: 4, people: [] }, differencesWaiting: null, hasChecks: false },
  ];
  const collector: CollectorProject[] = [{ projectId: 'p1', name: 'Forest', submitted: 12, submittedAll: 40, assigned: 50, remaining: 10, sentBack: 2 }];
  const ctx = (language: MailLanguage): DigestContext => ({
    serverName: 'Cloud\r\nBcc: x@evil.example',
    baseUrl: 'https://ce.example.org',
    language,
    timeZone: 'Europe/Madrid',
    week: '2026-W44',
    username: 'maria',
    unsubscribeUrl: 'https://ce.example.org/v1/unsubscribe/TOKEN',
  });

  it('every language has every text, filled, and they are not English', () => {
    const keys = Object.keys(DIGEST_WORDS.en).sort();
    for (const language of MAIL_LANGUAGES) {
      expect(Object.keys(DIGEST_WORDS[language]).sort(), language).toEqual(keys);
      for (const key of keys) {
        const text = DIGEST_WORDS[language][key as keyof typeof DIGEST_WORDS.en];
        expect(text.trim(), `${language} ${key}`).not.toBe('');
        if (language !== 'en' && !['ofPlots'].includes(key)) expect(text, `${language} ${key}`).not.toBe(DIGEST_WORDS.en[key as keyof typeof DIGEST_WORDS.en]);
      }
    }
  });

  it('the coordinators\' mail in 4 languages: the week, each project, the quiet people, the waiting differences, the links, escaped', () => {
    const expected: Record<MailLanguage, { subject: RegExp; words: string[]; number: string }> = {
      en: { subject: /weekly summary, October 26, 2026 to November 1, 2026/, words: ['Plots done this week', 'Quiet for more than 3 days', 'waiting for your decision'], number: '1,234' },
      es: { subject: /resumen semanal, del 26 de octubre de 2026 al 1 de noviembre de 2026/, words: ['Parcelas hechas esta semana', 'más de 3 días', 'esperando su decisión'], number: '1234' },
      fr: { subject: /résumé de la semaine, du 26 octobre 2026 au 1 novembre 2026/, words: ['Parcelles faites cette semaine', 'plus de 3 jours', 'en attente de votre décision'], number: '1\u202f234' },
      pt: { subject: /resumo semanal, de 26 de outubro de 2026 a 1 de novembro de 2026/, words: ['Parcelas feitas esta semana', 'mais de 3 dias', 'esperando a sua decisão'], number: '1.234' },
    };
    for (const language of MAIL_LANGUAGES) {
      const mail = coordinatorMail(ctx(language), coordinator, 0, 'owner@example.org');
      const e = expected[language];
      expect(mail.subject, language).toMatch(e.subject);
      expect(mail.subject).not.toMatch(/[\r\n]/);
      for (const word of e.words) {
        expect(mail.text, `${language} ${word}`).toContain(word);
        expect(mail.html, `${language} ${word}`).toContain(escapeHtml(word));
      }
      expect(mail.text, language).toContain(e.number);
      expect(mail.text).not.toMatch(/\{\w+\}/);
      expect(mail.text).toContain('  - ben');
      expect(mail.text).toContain('https://ce.example.org/projects/p1/activity/week/2026-W44');
      expect(mail.text).toContain('https://ce.example.org/v1/unsubscribe/TOKEN');
      // The project's name is escaped in the HTML, never markup.
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('Forest &lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
      // No checks line where the project has none, no waiting line without the figures.
      const wetlands = mail.text.slice(mail.text.indexOf('Wetlands'));
      expect(wetlands.split('\n').filter((l) => l.includes(': ')).length).toBeGreaterThan(0);
      expect(mail.headers).toEqual({ 'List-Unsubscribe': '<https://ce.example.org/v1/unsubscribe/TOKEN>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'Auto-Submitted': 'auto-generated' });
      expect(mail.tag).toBe('digest.coordinator');
    }
    const en = coordinatorMail(ctx('en'), coordinator, 0, 'owner@example.org').text;
    const wetlands = en.slice(en.indexOf('Project: Wetlands'));
    expect(wetlands).not.toContain('Quality checks done');
    expect(wetlands).not.toContain('waiting for your decision');
    expect(wetlands).toContain('Nobody with plots left to do has been quiet for more than 4 days.');
  });

  it("a collector's mail in 4 languages: their own numbers, the plots sent back, their link; nobody else's name", () => {
    const words: Record<MailLanguage, string[]> = {
      en: ['Plots you submitted this week: 12', 'Plots you submitted in all: 40', 'Plots you have left to do: 10', 'To check again – …'],
      es: ['Parcelas que envió esta semana: 12', 'Parcelas que envió en total: 40', 'Parcelas que le quedan por hacer: 10', 'To check again – …'],
      fr: ['Parcelles que vous avez envoyées cette semaine : 12', 'Parcelles qu’il vous reste à faire : 10', 'To check again – …'],
      pt: ['Parcelas que você enviou esta semana: 12', 'Parcelas que você enviou no total: 40', 'Parcelas que faltam para você fazer: 10', 'To check again – …'],
    };
    for (const language of MAIL_LANGUAGES) {
      const mail = collectorMail(ctx(language), collector, 0, 'maria@example.org');
      for (const w of words[language]) expect(mail.text, `${language} ${w}`).toContain(w);
      expect(mail.text).toContain('https://ce.example.org/projects/p1/my-work');
      expect(mail.text).toContain('maria');
      expect(mail.tag).toBe('digest.collector');
      expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    }
  });

  const intro: Record<MailLanguage, string> = {
    en: 'an account on Cloud',
    es: 'una cuenta en Cloud',
    fr: 'un compte sur Cloud',
    pt: 'uma conta em Cloud',
  };
  const other: Record<MailLanguage, string> = {
    en: 'no other email goes to this address',
    es: 'no se envía ningún otro correo a esta dirección',
    fr: 'aucun autre courriel n’est envoyé à cette adresse',
    pt: 'nenhum outro e-mail é enviado a este endereço',
  };

  it('the confirmation mail in 4 languages', () => {
    const subjects: Record<MailLanguage, string> = { en: 'confirm your email address', es: 'confirme su dirección de correo', fr: 'confirmez votre adresse e-mail', pt: 'confirme o seu endereço de e-mail' };
    for (const language of MAIL_LANGUAGES) {
      const mail = confirmMail({ serverName: 'Cloud', language, confirmUrl: 'https://ce.example.org/confirm-email/T' }, 'someone@example.org');
      expect(mail.subject).toBe(`Cloud: ${subjects[language]}`.replace('Cloud: ', language === 'fr' ? 'Cloud : ' : 'Cloud: '));
      expect(mail.text).toContain('https://ce.example.org/confirm-email/T');
      expect(mail.html).toContain('href="https://ce.example.org/confirm-email/T"');
      // An account on the server, never its username (the address may not be theirs).
      expect(mail.text).toContain(intro[language]);
      expect(mail.text).toContain(other[language]);
    }
  });

  it('the quiet people: at most 20 named, then how many more', () => {
    const people = Array.from({ length: 23 }, (_, i) => `person${String(i).padStart(2, '0')}`);
    const more: Record<MailLanguage, string> = { en: 'and 3 more', es: 'y 3 más', fr: 'et 3 de plus', pt: 'e mais 3' };
    for (const language of MAIL_LANGUAGES) {
      const mail = coordinatorMail(ctx(language), [{ ...coordinator[0], quiet: { days: 3, people } }], 0, 'o@example.org');
      expect(mail.text).toContain('person19');
      expect(mail.text).not.toContain('person20');
      expect(mail.text, language).toContain(more[language]);
    }
  });

  it('weeks: the last whole one in the zone; names are one line', () => {
    // Monday 2 November 2026, 06:00 UTC: in Madrid the week of 26 October is over; in Honolulu it is still Sunday.
    const monday = Date.UTC(2026, 10, 2, 6);
    expect(dueWeek(monday, 'Europe/Madrid')).toBe('2026-W44');
    expect(dueWeek(monday, 'Pacific/Honolulu')).toBe('2026-W43');
    expect(previousWeek('2026-W01')).toBe('2025-W52');
    expect(previousWeek('2021-W01')).toBe('2020-W53');
    expect(oneLine('a\r\nb\u0007c')).toBe('a b c');
  });
});
