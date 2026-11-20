// Alerts for the server's owner (recommendation 8 of the data review): what should make someone look at the server,
// told to them rather than waiting on a page nobody opens. Four signs, each over the last hour or at its last check:
//  - failed logins: someone may be guessing passwords;
//  - server errors (answers 500 and above): something is broken;
//  - records refused when Collect Earth sends them: interpreters' work is not arriving;
//  - a project near its storage limit (Server settings): its uploads will soon be refused.
// When one passes its threshold: a log line made to be alerted on (`ownerAlert`, for Google Cloud's log-based alerts),
// the server panel's list, and a mail to every server administrator with a confirmed address (when the server sends
// mail), and a post to the server's Slack or Teams webhook when one is set (src/alertWebhook.ts). Each alert is kept
// (owner_alerts, migration 042): the server page shows their history and which were seen. The thresholds are server
// settings (alert*). The same alert is raised at most once every six hours (a project's storage once a day), so a long
// problem is not a flood. Counted per server instance, in memory, as the panel's counters are: a restart starts again.
// The mail of "many server errors" carries the instance's recent warnings and errors as a file (src/errorLog.ts, at most
// 500 KB, the newest), so the administrator sees what failed; the webhook's post does not (a chat channel is wider).
// The alerts about errors (server errors, records refused) say how the database kept up in the same hour when it did
// not (src/databaseVitals.ts): busy answers and slow waits for a connection are how a database too small for its load
// shows first (DEPLOY.md, "Is the database big enough?").
import type { FastifyBaseLogger } from 'fastify';
import { postWebhook, type Fetch } from './alertWebhook.js';
import { fill, renderHtml, renderText, type MailLine } from './digestText.js';
import type { MailAttachment, Mailer } from './mail.js';
import type { Store } from './store/store.js';
import { databaseStruggled, type DatabaseSummary } from './databaseVitals.js';
import type { MailLanguage } from './types.js';
import type { AlertSignal, AlertThresholds, OwnerAlertKind as AlertKind } from './wire/serverAdmin.js';

export interface OwnerAlert {
  kind: AlertKind;
  /** When it was raised (epoch ms). */
  at: number;
  /** How many in the hour, or the project's use in percent of its limit. */
  count: number;
  /** For storage: the project. */
  projectId?: string;
  /** For the alerts about errors: the database's last hour on this instance, when it did not keep up. */
  database?: AlertDatabase;
}

/** The database's last hour as an alert tells it, with how long a request waits for a connection (PG_CONNECT_TIMEOUT_MS) */
export type AlertDatabase = DatabaseSummary & { connectTimeoutMs: number };

/** The alerts that say how the database kept up: those about errors, which a database too slow causes */
const WITH_DATABASE: ReadonlySet<AlertKind> = new Set(['server_errors', 'sync_errors']);

/** How many in one hour raise an alert, by default (the server settings alertFailedLogins...). */
export const THRESHOLDS: Record<AlertSignal, number> = { failedLogin: 50, serverError: 20, syncError: 50 };
/** A project's storage alert, in percent of its limit, by default (alertStoragePercent). */
export const STORAGE_PERCENT = 90;

/** The thresholds the server settings say. */
export function thresholdsOf(settings: { alertFailedLogins: number; alertServerErrors: number; alertSyncErrors: number; alertStoragePercent: number }): AlertThresholds {
  return { failedLogin: settings.alertFailedLogins, serverError: settings.alertServerErrors, syncError: settings.alertSyncErrors, storagePercent: settings.alertStoragePercent };
}
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
  private thresholds: AlertThresholds = { ...THRESHOLDS, storagePercent: STORAGE_PERCENT };

  constructor(
    private readonly options: { now?: () => number; notify?: (alert: OwnerAlert) => Promise<void> | void; database?: () => AlertDatabase } = {},
  ) {}

  /** The thresholds from the server settings (read at start, after a change, and every few minutes). */
  setThresholds(t: AlertThresholds): void {
    this.thresholds = { ...t };
  }

  currentThresholds(): AlertThresholds {
    return { ...this.thresholds };
  }

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
    const threshold = this.thresholds[signal];
    if (list.length > threshold) list.splice(0, list.length - threshold);
    if (list.length >= threshold) {
      const alert: OwnerAlert = { kind: KIND_OF[signal], at: now, count: list.length };
      const database = WITH_DATABASE.has(alert.kind) ? this.options.database?.() : undefined;
      if (database && databaseStruggled(database)) alert.database = database;
      this.raise(alert, KIND_OF[signal], COOLDOWN_MS);
    }
  }

  /** Each project's storage against the server's limit (0: no limit, nothing to check). */
  checkStorage(projects: readonly { projectId: string; storageBytes: number }[], limitMb: number): void {
    if (!limitMb) return;
    const limit = limitMb * 1024 * 1024;
    for (const p of projects) {
      const percent = Math.floor((p.storageBytes / limit) * 100);
      if (percent >= this.thresholds.storagePercent) this.raise({ kind: 'storage', at: this.now(), count: percent, projectId: p.projectId }, `storage ${p.projectId}`, STORAGE_COOLDOWN_MS);
    }
  }

  /**
   * Two-step sign-in's secrets that no key of the server reads (src/twoFactorCheck.ts, at start): the people who have
   * them cannot sign in but with a recovery code. Raised at each start where it is so, as it will not mend by itself.
   */
  twoFactorUnreadable(count: number): void {
    if (count > 0) this.raise({ kind: 'two_factor_keys', at: this.now(), count }, 'two_factor_keys', 0);
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
  two_factor_keys: 'two-step sign-in cannot be checked',
  two_factor_keysText: 'The server cannot read the two-step sign-in of {count} accounts it checked when it started: those people can only sign in with a recovery code. Its key changed: put back the TWO_FACTOR_KEY it had (the server log names the keys missing), or turn their two-step sign-in off in the server panel.',
  footer: 'This mail goes to the administrators of {server}. The same alert is sent at most once every six hours.',
  errorLogAttached: 'The server\'s most recent warnings and errors are attached ({file}, at most 500 KB, the newest last).',
  databaseIntro: 'The database in the last hour, on the server instance that raised this alert:',
  databaseBusy: '{busy} requests found no free connection to the database within {timeout} s and were answered "busy".',
  databaseSlow: '{slow} requests waited more than a second for a connection, the longest {max} s (a few milliseconds when the database keeps up).',
  databaseAdvice: 'Requests waiting for the database mean it cannot keep up with the load: look at its CPU and memory in the Cloud SQL console, and see "Is the database big enough?" in the server\'s DEPLOY.md.',
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
  two_factor_keys: 'no se puede comprobar la verificación en dos pasos',
  two_factor_keysText: 'El servidor no puede leer la verificación en dos pasos de {count} cuentas que comprobó al arrancar: esas personas solo pueden entrar con un código de recuperación. Su clave cambió: vuelva a poner la TWO_FACTOR_KEY que tenía (el registro del servidor indica las claves que faltan), o desactive su verificación en dos pasos en el panel del servidor.',
  footer: 'Este correo va a los administradores de {server}. La misma alerta se envía como mucho una vez cada seis horas.',
  errorLogAttached: 'Se adjuntan las advertencias y errores más recientes del servidor ({file}, como mucho 500 KB, los más nuevos al final).',
  databaseIntro: 'La base de datos en la última hora, en la instancia del servidor que dio esta alerta:',
  databaseBusy: '{busy} solicitudes no encontraron una conexión libre con la base de datos en {timeout} s y recibieron la respuesta «ocupado».',
  databaseSlow: '{slow} solicitudes esperaron más de un segundo por una conexión, la más larga {max} s (unos milisegundos cuando la base de datos da abasto).',
  databaseAdvice: 'Que las solicitudes esperen a la base de datos significa que no da abasto con la carga: mire su CPU y su memoria en la consola de Cloud SQL, y vea «Is the database big enough?» en el DEPLOY.md del servidor.',
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
  two_factor_keys: 'la validation en deux étapes ne peut pas être vérifiée',
  two_factor_keysText: 'Le serveur ne peut pas lire la validation en deux étapes de {count} comptes vérifiés à son démarrage : ces personnes ne peuvent se connecter qu\'avec un code de récupération. Sa clé a changé : remettez la TWO_FACTOR_KEY qu\'il avait (le journal du serveur nomme les clés manquantes), ou désactivez leur validation en deux étapes dans le panneau du serveur.',
  footer: 'Ce message va aux administrateurs de {server}. La même alerte est envoyée au plus une fois toutes les six heures.',
  errorLogAttached: 'Les avertissements et erreurs les plus récents du serveur sont joints ({file}, 500 Ko au plus, les plus récents à la fin).',
  databaseIntro: 'La base de données dans la dernière heure, sur l\'instance du serveur qui a donné cette alerte :',
  databaseBusy: '{busy} requêtes n\'ont trouvé aucune connexion libre à la base de données en {timeout} s et ont reçu la réponse « occupé ».',
  databaseSlow: '{slow} requêtes ont attendu plus d\'une seconde une connexion, la plus longue {max} s (quelques millisecondes quand la base de données suit).',
  databaseAdvice: 'Des requêtes qui attendent la base de données signifient qu\'elle ne suit pas la charge : regardez son processeur et sa mémoire dans la console Cloud SQL, et voyez « Is the database big enough? » dans le DEPLOY.md du serveur.',
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
  two_factor_keys: 'a verificação em duas etapas não pode ser conferida',
  two_factor_keysText: 'O servidor não consegue ler a verificação em duas etapas de {count} contas que conferiu ao iniciar: essas pessoas só conseguem entrar com um código de recuperação. A chave mudou: recoloque a TWO_FACTOR_KEY que ele tinha (o log do servidor indica as chaves que faltam), ou desative a verificação em duas etapas delas no painel do servidor.',
  footer: 'Este e-mail vai para os administradores de {server}. O mesmo alerta é enviado no máximo uma vez a cada seis horas.',
  errorLogAttached: 'Os avisos e erros mais recentes do servidor estão em anexo ({file}, no máximo 500 KB, os mais novos no fim).',
  databaseIntro: 'O banco de dados na última hora, na instância do servidor que deu este alerta:',
  databaseBusy: '{busy} pedidos não encontraram uma conexão livre com o banco de dados em {timeout} s e receberam a resposta "ocupado".',
  databaseSlow: '{slow} pedidos esperaram mais de um segundo por uma conexão, o mais longo {max} s (alguns milissegundos quando o banco de dados dá conta).',
  databaseAdvice: 'Pedidos esperando pelo banco de dados significam que ele não dá conta da carga: veja a CPU e a memória dele no console do Cloud SQL, e veja "Is the database big enough?" no DEPLOY.md do servidor.',
};
const tr: AlertTexts = {
  subject: '{server}: {what}',
  failed_logins: 'çok sayıda başarısız oturum açma denemesi',
  server_errors: 'çok sayıda sunucu hatası',
  sync_errors: 'Collect Earth kayıtları reddedildi',
  storage: 'bir proje depolama sınırına yaklaştı',
  failed_loginsText: 'Son bir saatte {count} başarısız oturum açma denemesi oldu. Birisi parolaları tahmin etmeye çalışıyor olabilir: sunucu panelini inceleyin ve koordinatörler için iki adımlı oturum açmayı değerlendirin.',
  server_errorsText: 'Sunucu son bir saatte {count} isteğe hatayla yanıt verdi. Neyin başarısız olduğunu görmek için sunucu günlüğüne bakın.',
  sync_errorsText: 'Sunucu son bir saatte Collect Earth’ten gönderilen {count} kaydı reddetti: veri toplayıcıların çalışmaları sunucuya ulaşmıyor olabilir. Sunucu günlüğüne bakın.',
  storageText: '{project} projesinin depolama kullanımı sınırın %{count} düzeyinde. Sunucu ayarlarından sınırı yükseltin ya da projenin koordinatörlerinden artık ihtiyaç duymadıkları verileri silmelerini isteyin.',
  two_factor_keys: 'iki adımlı oturum açma doğrulanamıyor',
  two_factor_keysText: 'Sunucu, başlarken denetlediği {count} hesabın iki adımlı oturum açma bilgisini okuyamıyor: bu kişiler yalnızca bir kurtarma koduyla oturum açabilir. Anahtar değişti: sunucunun önceki TWO_FACTOR_KEY değerini geri koyun (eksik anahtarlar sunucu günlüğünde yazar) ya da bu kişilerin iki adımlı oturum açmasını sunucu panelinden kapatın.',
  footer: 'Bu e-posta {server} yöneticilerine gönderilir. Aynı uyarı en fazla altı saatte bir gönderilir.',
  errorLogAttached: 'Sunucunun en son uyarıları ve hataları ektedir ({file}, en fazla 500 KB, en yeniler sonda).',
  databaseIntro: 'Son bir saatte veritabanı, bu uyarıyı veren sunucu örneğinde:',
  databaseBusy: '{busy} istek {timeout} sn içinde veritabanına boş bir bağlantı bulamadı ve "meşgul" yanıtı aldı.',
  databaseSlow: '{slow} istek bir bağlantı için bir saniyeden uzun bekledi, en uzunu {max} sn (veritabanı yetiştiğinde birkaç milisaniye).',
  databaseAdvice: 'İsteklerin veritabanını beklemesi, veritabanının yüke yetişemediği anlamına gelir: Cloud SQL konsolunda işlemci ve bellek kullanımına bakın ve sunucunun DEPLOY.md dosyasındaki "Is the database big enough?" bölümünü okuyun.',
};
const TEXTS: Record<MailLanguage, AlertTexts> = { en, es, fr, pt, tr };

/** The mail of an alert, in a language; `attached`: the name of the error log sent with it (said in the mail). */
export function alertMail(alert: OwnerAlert, language: MailLanguage, server: string, projectName: string | null, attached: string | null = null): { subject: string; text: string; html: string } {
  const t = TEXTS[language] ?? en;
  const body = t[`${alert.kind}Text` as keyof AlertTexts];
  const lines: MailLine[] = [
    { kind: 'para', text: fill(body, { count: String(alert.count), project: projectName ?? alert.projectId ?? '' }) },
    ...(alert.database ? [{ kind: 'para' as const, text: databaseText(alert.database, language) }] : []),
    ...(attached ? [{ kind: 'para' as const, text: fill(t.errorLogAttached, { file: attached }) }] : []),
    { kind: 'rule' },
    { kind: 'para', text: fill(t.footer, { server }) },
  ];
  return { subject: fill(t.subject, { server, what: t[alert.kind] }), text: renderText(lines, language), html: renderHtml(lines, language, server) };
}

/**
 * The file a "many server errors" mail carries: the recent warnings and errors (src/errorLog.ts), named for the server
 * and the time, or null when there is nothing to attach (another kind of alert, or no line kept).
 */
export function errorLogAttachment(alert: Pick<OwnerAlert, 'kind' | 'at'>, server: string, log: string | null): MailAttachment | null {
  if (alert.kind !== 'server_errors' || !log) return null;
  const name = server.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
  const when = new Date(alert.at).toISOString().slice(0, 16).replace(':', '-');
  return { filename: `${name}-errors-${when}Z.log`, content: log, contentType: 'text/plain; charset=utf-8' };
}

/** An alert in words for a chat channel (the webhook): a project by its id only, never its name. */
export function alertForChannel(alert: Pick<OwnerAlert, 'kind' | 'count' | 'projectId' | 'database'>, language: MailLanguage, server: string): { title: string; text: string } {
  const t = TEXTS[language] ?? en;
  const text = fill(t[`${alert.kind}Text` as keyof AlertTexts], { count: String(alert.count), project: alert.projectId ?? '' });
  return {
    title: fill(t.subject, { server, what: t[alert.kind] }),
    text: alert.database ? `${text}\n\n${databaseText(alert.database, language)}` : text,
  };
}

/** How the database kept up, in words: the busy answers, the slow waits, and what to look at */
export function databaseText(d: AlertDatabase, language: MailLanguage): string {
  const t = TEXTS[language] ?? en;
  const seconds = (ms: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(ms / 1000);
  const parts = [t.databaseIntro];
  if (d.busy > 0) parts.push(fill(t.databaseBusy, { busy: String(d.busy), timeout: seconds(d.connectTimeoutMs) }));
  if (d.slow > 0) parts.push(fill(t.databaseSlow, { slow: String(d.slow), max: seconds(d.maxWaitMs) }));
  parts.push(t.databaseAdvice);
  return parts.join(' ');
}

/**
 * What an alert does: a log line to be alerted on (always), kept for the server page (owner_alerts), a mail to every
 * enabled server administrator whose address is confirmed, in their language, and a post to the webhook when one is set.
 */
export function ownerNotifier(store: Store, mailer: Mailer, log: FastifyBaseLogger, serverName: () => Promise<string>, fetchImpl?: Fetch, errorLog?: () => string | null) {
  return async (alert: OwnerAlert) => {
    log.error({ ownerAlert: alert.kind, count: alert.count, projectId: alert.projectId, database: alert.database }, `owner alert: ${alert.kind}`);
    try {
      await store.appendOwnerAlert({ kind: alert.kind, at: alert.at, count: alert.count, projectId: alert.projectId ?? null });
    } catch (err) {
      log.warn({ err }, 'owner alert: could not be kept');
    }
    try {
      const { alertWebhookUrl } = await store.getSettings();
      if (alertWebhookUrl) {
        const { title, text } = alertForChannel(alert, 'en', await serverName());
        const posted = await postWebhook(alertWebhookUrl, title, text, fetchImpl);
        if (!posted.sent) log.warn({ status: posted.status }, 'owner alert: the webhook refused it');
      }
    } catch (err) {
      log.warn({ err }, 'owner alert: the webhook could not be reached');
    }
    try {
      const server = await serverName();
      const project = alert.projectId ? ((await store.getProject(alert.projectId).catch(() => null))?.name ?? null) : null;
      const admins = (await store.listUsers()).filter((u) => u.isPlatformAdmin && u.disabledAt === null);
      // the log as it is when the alert is raised, the same file for every administrator
      const attachment = errorLogAttachment(alert, server, alert.kind === 'server_errors' ? (errorLog?.() ?? null) : null);
      for (const admin of admins) {
        const mail = await store.getAccountMail(admin.userId);
        if (!mail?.email || !mail.emailConfirmedAt) continue;
        const m = alertMail(alert, mail.language ?? 'en', server, project, attachment?.filename ?? null);
        await mailer.send({ to: mail.email, ...m, tag: `owner.alert.${alert.kind}`, ...(attachment ? { attachments: [attachment] } : {}) });
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
