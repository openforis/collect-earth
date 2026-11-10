// Alerts for the server's owner (recommendation 8 of the data review): what should make someone look at the server,
// told to them rather than waiting on a page nobody opens. Four signs, each over the last hour or at its last check:
//  - failed logins: someone may be guessing passwords;
//  - server errors (answers 500 and above): something is broken;
//  - records refused when Collect Earth sends them: interpreters' work is not arriving;
//  - a project near its storage limit (Server settings): its uploads will soon be refused.
// When one passes its threshold: a log line made to be alerted on (`ownerAlert`, for Google Cloud's log-based alerts),
// the server panel's list, and a mail to every server administrator with a confirmed address (when the server sends
// mail). The same alert is raised at most once every six hours (a project's storage once a day), so a long problem is
// not a flood. Counted per server instance, in memory, as the panel's counters are: a restart starts again.
import type { FastifyBaseLogger } from 'fastify';
import { fill, renderHtml, renderText, type MailLine } from './digestText.js';
import type { Mailer } from './mail.js';
import type { Store } from './store/store.js';
import type { MailLanguage } from './types.js';

export type AlertKind = 'failed_logins' | 'server_errors' | 'sync_errors' | 'storage';
export type AlertSignal = 'failedLogin' | 'serverError' | 'syncError';

export interface OwnerAlert {
  kind: AlertKind;
  /** When it was raised (epoch ms). */
  at: number;
  /** How many in the hour, or the project's use in percent of its limit. */
  count: number;
  /** For storage: the project. */
  projectId?: string;
}

/** How many in one hour raise an alert. */
export const THRESHOLDS: Record<AlertSignal, number> = { failedLogin: 50, serverError: 20, syncError: 50 };
/** A project's storage alert, in percent of its limit. */
export const STORAGE_PERCENT = 90;
const KIND_OF: Record<AlertSignal, AlertKind> = { failedLogin: 'failed_logins', serverError: 'server_errors', syncError: 'sync_errors' };
const HOUR_MS = 3_600_000;
const COOLDOWN_MS = 6 * HOUR_MS;
const STORAGE_COOLDOWN_MS = 24 * HOUR_MS;
const KEEP = 50;

export class OwnerAlerts {
  /** The times of the last hour's signals, per kind (oldest first). */
  private readonly times: Record<AlertSignal, number[]> = { failedLogin: [], serverError: [], syncError: [] };
  private readonly lastRaised = new Map<string, number>();
  private readonly raised: OwnerAlert[] = [];

  constructor(private readonly options: { now?: () => number; notify?: (alert: OwnerAlert) => Promise<void> | void } = {}) {}

  private now() {
    return (this.options.now ?? Date.now)();
  }

  /** A signal (or n of them): raises its alert when the last hour's count reaches the threshold. */
  note(signal: AlertSignal, n = 1): void {
    if (n <= 0) return;
    const now = this.now();
    const list = this.times[signal];
    for (let i = 0; i < n; i++) list.push(now);
    while (list.length && list[0] <= now - HOUR_MS) list.shift();
    // never more than the threshold kept: the count that matters is "at least that many"
    if (list.length > THRESHOLDS[signal]) list.splice(0, list.length - THRESHOLDS[signal]);
    if (list.length >= THRESHOLDS[signal]) this.raise({ kind: KIND_OF[signal], at: now, count: list.length }, KIND_OF[signal], COOLDOWN_MS);
  }

  /** Each project's storage against the server's limit (0: no limit, nothing to check). */
  checkStorage(projects: readonly { projectId: string; storageBytes: number }[], limitMb: number): void {
    if (!limitMb) return;
    const limit = limitMb * 1024 * 1024;
    for (const p of projects) {
      const percent = Math.floor((p.storageBytes / limit) * 100);
      if (percent >= STORAGE_PERCENT) this.raise({ kind: 'storage', at: this.now(), count: percent, projectId: p.projectId }, `storage ${p.projectId}`, STORAGE_COOLDOWN_MS);
    }
  }

  private raise(alert: OwnerAlert, key: string, cooldown: number): void {
    const last = this.lastRaised.get(key);
    if (last !== undefined && alert.at - last < cooldown) return;
    this.lastRaised.set(key, alert.at);
    this.raised.unshift(alert);
    if (this.raised.length > KEEP) this.raised.length = KEEP;
    void Promise.resolve(this.options.notify?.(alert)).catch(() => {});
  }

  /** The alerts raised since this instance started, newest first (at most 50). */
  recent(): OwnerAlert[] {
    return this.raised.map((a) => ({ ...a }));
  }
}

// --- telling the owner -----------------------------------------------------------------------------------------------

const en = {
  subject: '{server}: {what}',
  failed_logins: 'many failed logins',
  server_errors: 'many server errors',
  sync_errors: 'records from Collect Earth refused',
  storage: 'a project is near its storage limit',
  failed_loginsText: 'There were {count} failed logins in the last hour. Someone may be guessing passwords: look at the server panel, and consider two-step sign-in for coordinators.',
  server_errorsText: 'The server answered {count} requests with an error in the last hour. Look at the server log for what failed.',
  sync_errorsText: 'The server refused {count} records sent by Collect Earth in the last hour: interpreters\' work may not be arriving. Look at the server log.',
  storageText: 'The project {project} uses {count}% of its storage limit. Raise the limit in the server settings, or ask its coordinators to remove what they no longer need.',
  footer: 'This mail goes to the administrators of {server}. The same alert is sent at most once every six hours.',
};
type AlertTexts = typeof en;
const es: AlertTexts = {
  subject: '{server}: {what}',
  failed_logins: 'muchos inicios de sesión fallidos',
  server_errors: 'muchos errores del servidor',
  sync_errors: 'registros de Collect Earth rechazados',
  storage: 'un proyecto está cerca de su límite de almacenamiento',
  failed_loginsText: 'Hubo {count} inicios de sesión fallidos en la última hora. Alguien podría estar adivinando contraseñas: mire el panel del servidor y considere la verificación en dos pasos para los coordinadores.',
  server_errorsText: 'El servidor respondió con un error a {count} solicitudes en la última hora. Mire el registro del servidor para ver qué falló.',
  sync_errorsText: 'El servidor rechazó {count} registros enviados por Collect Earth en la última hora: el trabajo de los intérpretes podría no estar llegando. Mire el registro del servidor.',
  storageText: 'El proyecto {project} usa el {count} % de su límite de almacenamiento. Suba el límite en la configuración del servidor, o pida a sus coordinadores que borren lo que ya no necesitan.',
  footer: 'Este correo va a los administradores de {server}. La misma alerta se envía como mucho una vez cada seis horas.',
};
const fr: AlertTexts = {
  subject: '{server} : {what}',
  failed_logins: 'beaucoup de connexions échouées',
  server_errors: 'beaucoup d\'erreurs du serveur',
  sync_errors: 'enregistrements de Collect Earth refusés',
  storage: 'un projet approche de sa limite de stockage',
  failed_loginsText: 'Il y a eu {count} connexions échouées dans la dernière heure. Quelqu\'un essaie peut-être de deviner des mots de passe : regardez le panneau du serveur, et envisagez la validation en deux étapes pour les coordinateurs.',
  server_errorsText: 'Le serveur a répondu par une erreur à {count} requêtes dans la dernière heure. Regardez le journal du serveur pour voir ce qui a échoué.',
  sync_errorsText: 'Le serveur a refusé {count} enregistrements envoyés par Collect Earth dans la dernière heure : le travail des interprètes n\'arrive peut-être pas. Regardez le journal du serveur.',
  storageText: 'Le projet {project} utilise {count} % de sa limite de stockage. Augmentez la limite dans les réglages du serveur, ou demandez à ses coordinateurs de supprimer ce dont ils n\'ont plus besoin.',
  footer: 'Ce message va aux administrateurs de {server}. La même alerte est envoyée au plus une fois toutes les six heures.',
};
const pt: AlertTexts = {
  subject: '{server}: {what}',
  failed_logins: 'muitas tentativas de entrada falhadas',
  server_errors: 'muitos erros do servidor',
  sync_errors: 'registros do Collect Earth recusados',
  storage: 'um projeto está perto do limite de armazenamento',
  failed_loginsText: 'Houve {count} tentativas de entrada falhadas na última hora. Alguém pode estar tentando adivinhar senhas: veja o painel do servidor e considere a verificação em duas etapas para os coordenadores.',
  server_errorsText: 'O servidor respondeu com erro a {count} pedidos na última hora. Veja o log do servidor para saber o que falhou.',
  sync_errorsText: 'O servidor recusou {count} registros enviados pelo Collect Earth na última hora: o trabalho dos intérpretes pode não estar chegando. Veja o log do servidor.',
  storageText: 'O projeto {project} usa {count}% do limite de armazenamento. Aumente o limite nas configurações do servidor, ou peça aos coordenadores que apaguem o que já não precisam.',
  footer: 'Este e-mail vai para os administradores de {server}. O mesmo alerta é enviado no máximo uma vez a cada seis horas.',
};
const TEXTS: Record<MailLanguage, AlertTexts> = { en, es, fr, pt };

/** The mail of an alert, in a language. */
export function alertMail(alert: OwnerAlert, language: MailLanguage, server: string, projectName: string | null): { subject: string; text: string; html: string } {
  const t = TEXTS[language] ?? en;
  const body = t[`${alert.kind}Text` as keyof AlertTexts];
  const lines: MailLine[] = [
    { kind: 'para', text: fill(body, { count: String(alert.count), project: projectName ?? alert.projectId ?? '' }) },
    { kind: 'rule' },
    { kind: 'para', text: fill(t.footer, { server }) },
  ];
  return { subject: fill(t.subject, { server, what: t[alert.kind] }), text: renderText(lines, language), html: renderHtml(lines, language) };
}

/**
 * What an alert does: a log line to be alerted on (always), and a mail to every enabled server administrator whose
 * address is confirmed, in their language.
 */
export function ownerNotifier(store: Store, mailer: Mailer, log: FastifyBaseLogger, serverName: () => Promise<string>) {
  return async (alert: OwnerAlert) => {
    log.error({ ownerAlert: alert.kind, count: alert.count, projectId: alert.projectId }, `owner alert: ${alert.kind}`);
    try {
      const server = await serverName();
      const project = alert.projectId ? ((await store.getProject(alert.projectId).catch(() => null))?.name ?? null) : null;
      const admins = (await store.listUsers()).filter((u) => u.isPlatformAdmin && u.disabledAt === null);
      for (const admin of admins) {
        const mail = await store.getAccountMail(admin.userId);
        if (!mail?.email || !mail.emailConfirmedAt) continue;
        const m = alertMail(alert, mail.language ?? 'en', server, project);
        await mailer.send({ to: mail.email, ...m, tag: `owner.alert.${alert.kind}` });
      }
    } catch (err) {
      log.warn({ err }, 'owner alert: the mail could not be sent');
    }
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The owner's alerts (src/ownerAlerts.ts): routes tell it of what they see (records refused). */
    ownerAlerts?: OwnerAlerts;
  }
}
