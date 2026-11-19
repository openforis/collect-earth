// The digests' words (Task 19), in the dashboard's five languages, and the mail written from a digest:
// plain text and an HTML version of the same lines (in the dashboard's look), every value escaped. Counts are written as
// "label: n" so no sentence needs a plural form; dates in the person's language.
import type { MailLanguage } from './types.js';

const en = {
  coordinatorSubject: '{server}: weekly summary, {start} to {end}',
  collectorSubject: '{server}: your week, {start} to {end}',
  coordinatorIntro: 'Hello {name}, here is the week of {start} to {end} ({zone} time) in the projects you coordinate.',
  collectorIntro: 'Hello {name}, here is your week of {start} to {end} ({zone} time).',
  project: 'Project: {name}',
  plotsWeek: 'Plots done this week',
  checksWeek: 'Quality checks done this week',
  plotsAll: 'Plots done in all',
  ofPlots: '{done} of {plots}',
  quiet: 'Quiet for more than {days} days (no sync and no plot download) with plots left to do',
  quietNone: 'Nobody with plots left to do has been quiet for more than {days} days.',
  waiting: 'Plots where a check differs from the first assessment, waiting for your decision',
  weeklyLink: 'The weekly summary',
  mySubmitted: 'Plots you submitted this week',
  myAll: 'Plots you submitted in all',
  myLeft: 'Plots you have left to do',
  sentBack: 'Plots sent back to you for another look (in Collect Earth, in the plot file "To check again – …")',
  myWorkLink: 'Your work',
  why: 'You get this email because you asked for it on your account page of {server}.',
  stop: 'Stop these emails (one click, no login)',
  account: 'Your account page',
  more: 'and {n} more',
  confirmSubject: '{server}: confirm your email address',
  confirmIntro: 'Hello, someone (we hope you) gave this address to an account on {server}, to get its emails.',
  confirmWhat: 'Confirming it means this address gets the emails that account asks for, about its projects on {server}: the weekly summaries it turns on and, for a coordinator, an email when someone joins a project; each with a link to stop it.',
  confirmAction: 'Confirm this address (the link works for 3 days)',
  confirmIgnore: 'If it was not you, do nothing: no other email goes to this address until it is confirmed.',
};

type Words = typeof en;

const es: Words = {
  coordinatorSubject: '{server}: resumen semanal, del {start} al {end}',
  collectorSubject: '{server}: su semana, del {start} al {end}',
  coordinatorIntro: 'Hola {name}, esta es la semana del {start} al {end} (hora de {zone}) en los proyectos que usted coordina.',
  collectorIntro: 'Hola {name}, esta es su semana del {start} al {end} (hora de {zone}).',
  project: 'Proyecto: {name}',
  plotsWeek: 'Parcelas hechas esta semana',
  checksWeek: 'Controles de calidad hechos esta semana',
  plotsAll: 'Parcelas hechas en total',
  ofPlots: '{done} de {plots}',
  quiet: 'Sin actividad desde hace más de {days} días (sin sincronizar ni descargar parcelas) y con parcelas por hacer',
  quietNone: 'Nadie con parcelas por hacer lleva más de {days} días sin actividad.',
  waiting: 'Parcelas en las que un control difiere de la primera evaluación, esperando su decisión',
  weeklyLink: 'El resumen semanal',
  mySubmitted: 'Parcelas que envió esta semana',
  myAll: 'Parcelas que envió en total',
  myLeft: 'Parcelas que le quedan por hacer',
  sentBack: 'Parcelas que le devolvieron para otra revisión (en Collect Earth, en el archivo de parcelas «To check again – …»)',
  myWorkLink: 'Su trabajo',
  why: 'Recibe este correo porque lo pidió en la página de su cuenta de {server}.',
  stop: 'Dejar de recibir estos correos (un clic, sin iniciar sesión)',
  account: 'La página de su cuenta',
  more: 'y {n} más',
  confirmSubject: '{server}: confirme su dirección de correo',
  confirmIntro: 'Hola, alguien (esperamos que usted) dio esta dirección a una cuenta en {server}, para recibir sus correos.',
  confirmWhat: 'Al confirmarla, esta dirección recibe los correos que esa cuenta pida, sobre sus proyectos en {server}: los resúmenes semanales que active y, para quien coordina, un correo cuando alguien se une a un proyecto; cada uno con un enlace para dejar de recibirlos.',
  confirmAction: 'Confirmar esta dirección (el enlace funciona durante 3 días)',
  confirmIgnore: 'Si no fue usted, no haga nada: no se envía ningún otro correo a esta dirección hasta que se confirme.',
};

const fr: Words = {
  coordinatorSubject: '{server} : résumé de la semaine, du {start} au {end}',
  collectorSubject: '{server} : votre semaine, du {start} au {end}',
  coordinatorIntro: 'Bonjour {name}, voici la semaine du {start} au {end} (heure de {zone}) dans les projets que vous coordonnez.',
  collectorIntro: 'Bonjour {name}, voici votre semaine du {start} au {end} (heure de {zone}).',
  project: 'Projet : {name}',
  plotsWeek: 'Parcelles faites cette semaine',
  checksWeek: 'Contrôles de qualité faits cette semaine',
  plotsAll: 'Parcelles faites en tout',
  ofPlots: '{done} sur {plots}',
  quiet: 'Sans activité depuis plus de {days} jours (ni synchronisation ni téléchargement de parcelles) avec des parcelles à faire',
  quietNone: 'Personne ayant des parcelles à faire n’est sans activité depuis plus de {days} jours.',
  waiting: 'Parcelles où un contrôle diffère de la première évaluation, en attente de votre décision',
  weeklyLink: 'Le résumé de la semaine',
  mySubmitted: 'Parcelles que vous avez envoyées cette semaine',
  myAll: 'Parcelles que vous avez envoyées en tout',
  myLeft: 'Parcelles qu’il vous reste à faire',
  sentBack: 'Parcelles qui vous ont été renvoyées pour un nouvel examen (dans Collect Earth, dans le fichier de parcelles « To check again – … »)',
  myWorkLink: 'Votre travail',
  why: 'Vous recevez ce courriel parce que vous l’avez demandé sur la page de votre compte de {server}.',
  stop: 'Ne plus recevoir ces courriels (un clic, sans connexion)',
  account: 'La page de votre compte',
  more: 'et {n} de plus',
  confirmSubject: '{server} : confirmez votre adresse e-mail',
  confirmIntro: 'Bonjour, quelqu’un (vous, nous l’espérons) a donné cette adresse à un compte sur {server}, pour recevoir ses courriels.',
  confirmWhat: 'La confirmer, c’est accepter que cette adresse reçoive les courriels que ce compte demande, sur ses projets sur {server} : les résumés de la semaine qu’il active et, pour qui coordonne, un courriel quand quelqu’un rejoint un projet ; chacun avec un lien pour les arrêter.',
  confirmAction: 'Confirmer cette adresse (le lien fonctionne pendant 3 jours)',
  confirmIgnore: 'Si ce n’était pas vous, ne faites rien : aucun autre courriel n’est envoyé à cette adresse tant qu’elle n’est pas confirmée.',
};

const pt: Words = {
  coordinatorSubject: '{server}: resumo semanal, de {start} a {end}',
  collectorSubject: '{server}: sua semana, de {start} a {end}',
  coordinatorIntro: 'Olá {name}, esta é a semana de {start} a {end} (hora de {zone}) nos projetos que você coordena.',
  collectorIntro: 'Olá {name}, esta é a sua semana de {start} a {end} (hora de {zone}).',
  project: 'Projeto: {name}',
  plotsWeek: 'Parcelas feitas esta semana',
  checksWeek: 'Controles de qualidade feitos esta semana',
  plotsAll: 'Parcelas feitas no total',
  ofPlots: '{done} de {plots}',
  quiet: 'Sem atividade há mais de {days} dias (sem sincronizar nem baixar parcelas) e com parcelas por fazer',
  quietNone: 'Ninguém com parcelas por fazer está sem atividade há mais de {days} dias.',
  waiting: 'Parcelas em que um controle difere da primeira avaliação, esperando a sua decisão',
  weeklyLink: 'O resumo semanal',
  mySubmitted: 'Parcelas que você enviou esta semana',
  myAll: 'Parcelas que você enviou no total',
  myLeft: 'Parcelas que faltam para você fazer',
  sentBack: 'Parcelas devolvidas a você para outra revisão (no Collect Earth, no arquivo de parcelas "To check again – …")',
  myWorkLink: 'Seu trabalho',
  why: 'Você recebe este e-mail porque o pediu na página da sua conta de {server}.',
  stop: 'Parar de receber estes e-mails (um clique, sem login)',
  account: 'A página da sua conta',
  more: 'e mais {n}',
  confirmSubject: '{server}: confirme o seu endereço de e-mail',
  confirmIntro: 'Olá, alguém (esperamos que você) deu este endereço a uma conta em {server}, para receber os seus e-mails.',
  confirmWhat: 'Ao confirmá-lo, este endereço recebe os e-mails que essa conta pedir, sobre os seus projetos em {server}: os resumos semanais que ligar e, para quem coordena, um e-mail quando alguém entra num projeto; cada um com um link para pará-los.',
  confirmAction: 'Confirmar este endereço (o link funciona por 3 dias)',
  confirmIgnore: 'Se não foi você, não faça nada: nenhum outro e-mail é enviado a este endereço até que seja confirmado.',
};

const tr: Words = {
  coordinatorSubject: '{server}: haftalık özet, {start} – {end}',
  collectorSubject: '{server}: haftanız, {start} – {end}',
  coordinatorIntro: 'Merhaba {name}, koordine ettiğiniz projelerin {start} – {end} haftasına ait özeti aşağıdadır ({zone} saatiyle).',
  collectorIntro: 'Merhaba {name}, {start} – {end} haftanızın özeti aşağıdadır ({zone} saatiyle).',
  project: 'Proje: {name}',
  plotsWeek: 'Bu hafta yapılan parseller',
  checksWeek: 'Bu hafta yapılan kalite kontrolleri',
  plotsAll: 'Toplamda yapılan parseller',
  ofPlots: '{done} / {plots}',
  quiet: '{days} günden fazla süredir sessiz olan (eşitleme ve parsel indirme yapmayan) ve yapılacak parselleri bulunan kişiler',
  quietNone: 'Yapılacak parseli olup {days} günden fazla süredir sessiz olan kimse yok.',
  waiting: 'Bir kontrolün ilk değerlendirmeden farklı olduğu, kararınızı bekleyen parseller',
  weeklyLink: 'Haftalık özet',
  mySubmitted: 'Bu hafta gönderdiğiniz parseller',
  myAll: 'Toplamda gönderdiğiniz parseller',
  myLeft: 'Yapmanız gereken kalan parseller',
  sentBack: 'Yeniden bakmanız için size geri gönderilen parseller (Collect Earth’te, “To check again – …” parsel dosyasında)',
  myWorkLink: 'Çalışmalarınız',
  why: 'Bu e-postayı, {server} hesap sayfanızda istediğiniz için alıyorsunuz.',
  stop: 'Bu e-postaları durdurun (tek tıklama, oturum açmadan)',
  account: 'Hesap sayfanız',
  more: 've {n} kişi daha',
  confirmSubject: '{server}: e-posta adresinizi onaylayın',
  confirmIntro: 'Merhaba, birisi (umarız sizsinizdir) e-postalarını almak için bu adresi {server} üzerindeki bir hesaba ekledi.',
  confirmWhat: 'Onayladığınızda bu adrese, o hesabın {server} üzerindeki projeleriyle ilgili istediği e-postalar gönderilir: açtığı haftalık özetler ve koordinatörse bir projeye biri katıldığında bir e-posta; her birinde e-postaları durdurmak için bir bağlantı vardır.',
  confirmAction: 'Bu adresi onaylayın (bağlantı 3 gün boyunca çalışır)',
  confirmIgnore: 'Bu adresi siz eklemediyseniz herhangi bir işlem yapmanıza gerek yok: adres onaylanana kadar bu adrese başka hiçbir e-posta gönderilmez.',
};

export const DIGEST_WORDS: Record<MailLanguage, Words> = { en, es, fr, pt, tr };
export type WordKey = keyof Words;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** One line of text, for a subject or a value: no control characters (a name can never add a header line). */
export function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
}

export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** A calendar day (YYYY-MM-DD) as the language writes it: "26 October 2026". */
export function longDate(date: string, language: MailLanguage): string {
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export function number(n: number, language: MailLanguage): string {
  return new Intl.NumberFormat(language).format(n);
}

/** What a mail says, as lines: built once, written as text and as HTML. */
export type MailLine =
  | { kind: 'para'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'value'; label: string; value: string }
  | { kind: 'list'; label: string; items: string[] }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'rule' };

/** What comes between a label and its value: French puts a space before the colon. */
export const colonOf = (language: MailLanguage) => (language === 'fr' ? ' : ' : ': ');

export function renderText(lines: readonly MailLine[], language: MailLanguage): string {
  const colon = colonOf(language);
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind === 'para') out.push(line.text, '');
    else if (line.kind === 'heading') out.push(line.text, '='.repeat(Math.min(60, line.text.length)));
    else if (line.kind === 'value') out.push(`${line.label}${colon}${line.value}`);
    else if (line.kind === 'list') out.push(`${line.label}${colon.trimEnd()}`, ...line.items.map((i) => `  - ${i}`));
    else if (line.kind === 'link') out.push(`${line.label}${colon}${line.url}`, '');
    else out.push('', '-- ', '');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** The Content-ID of the Collect Earth emblem the HTML shows: SmtpMailer attaches the image under it (src/mail.ts). */
export const EMBLEM_CID = 'emblem@collect-earth';

// The dashboard's look (web/src/shared/collectEarthTheme.ts) in what mail programs keep: tables and inline styles only
// (Gmail and Outlook drop or rewrite style sheets).
const FONT = "font-family:Roboto,'Segoe UI',Helvetica,Arial,sans-serif";
const PRIMARY = '#1565c0';
const TEXT = '#1f2933';
const MUTED = '#5f6b76';
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/** The lines of one part of the mail (its body, or its footer: `small`), every text and address escaped. */
function htmlBlocks(lines: readonly MailLine[], small: boolean, button: boolean): string {
  const out: string[] = [];
  let rows: string[] = [];
  const flush = () => {
    if (rows.length > 0) out.push(`<table ${TABLE} width="100%" style="margin:0 0 16px">${rows.join('')}</table>`);
    rows = [];
  };
  const cell = 'padding:8px 0;border-bottom:1px solid #e6e9ed';
  for (const line of lines) {
    if (line.kind === 'value') {
      rows.push(`<tr><td style="${cell};padding-right:16px">${escapeHtml(line.label)}</td><td align="right" style="${cell};font-weight:600;white-space:nowrap">${escapeHtml(line.value)}</td></tr>`);
      continue;
    }
    if (line.kind === 'list') {
      const items = line.items.map((i) => `<li style="margin:2px 0">${escapeHtml(i)}</li>`).join('');
      rows.push(`<tr><td colspan="2" style="${cell}">${escapeHtml(line.label)}<ul style="margin:6px 0 0;padding-left:20px">${items}</ul></td></tr>`);
      continue;
    }
    flush();
    // A line break typed in an administrators' message (a signature) stays one, as in the text version.
    if (line.kind === 'para') out.push(`<p style="margin:0 0 ${small ? 8 : 14}px">${escapeHtml(line.text).replace(/\n/g, '<br>')}</p>`);
    else if (line.kind === 'heading') out.push(`<h2 style="margin:26px 0 6px;${FONT};font-size:17px;line-height:1.3;font-weight:600;color:${TEXT}">${escapeHtml(line.text)}</h2>`);
    else if (line.kind === 'link' && button) {
      // A table cell coloured in, so the button shows in Outlook too (it ignores an <a>'s padding: mso-padding-alt).
      out.push(
        `<table ${TABLE} style="margin:6px 0 20px"><tr><td bgcolor="${PRIMARY}" style="border-radius:6px;mso-padding-alt:12px 24px">` +
          `<a href="${escapeHtml(line.url)}" style="display:inline-block;padding:12px 24px;${FONT};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(line.label)}</a></td></tr></table>`,
      );
    } else if (line.kind === 'link') {
      out.push(`<p style="margin:0 0 ${small ? 6 : 14}px"><a href="${escapeHtml(line.url)}" style="color:${PRIMARY};${small ? 'text-decoration:underline' : 'font-weight:600;text-decoration:none'}">${escapeHtml(line.label)}</a></p>`);
    }
  }
  flush();
  return out.join('');
}

/**
 * The HTML mail: a white card on the dashboard's grey, headed by the emblem and the server's name. What follows the first
 * `rule` is the footer (why the mail came, how to stop it), in small grey text. The body's link is a button when it is
 * the body's only one (the mail's action); several (a digest's projects) stay text links, never a column of buttons.
 */
export function renderHtml(lines: readonly MailLine[], language: MailLanguage, server: string): string {
  const split = lines.findIndex((l) => l.kind === 'rule');
  const body = split === -1 ? lines : lines.slice(0, split);
  const footer = split === -1 ? [] : lines.slice(split + 1);
  const button = body.filter((l) => l.kind === 'link').length === 1;
  // The inbox's preview line: the first sentence, not the header's server name.
  const first = lines.find((l) => l.kind === 'para');
  const preheader = first ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(first.text)}</div>` : '';
  const header =
    `<tr><td style="padding:16px 28px;border-bottom:3px solid ${PRIMARY}"><table ${TABLE}><tr>` +
    `<td style="padding-right:12px;vertical-align:middle"><img src="cid:${EMBLEM_CID}" width="44" height="44" alt="Collect Earth" style="display:block;border:0;width:44px;height:44px"></td>` +
    `<td style="vertical-align:middle;${FONT};font-size:18px;line-height:1.3;font-weight:600;color:${TEXT}">${escapeHtml(oneLine(server))}</td></tr></table></td></tr>`;
  const foot = footer.length === 0 ? '' : `<tr><td style="padding:16px 28px 20px;border-top:1px solid #e6e9ed;${FONT};font-size:12px;line-height:1.5;color:${MUTED}">${htmlBlocks(footer, true, false)}</td></tr>`;
  return (
    `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f6f8">${preheader}` +
    `<table ${TABLE} width="100%" style="background:#f4f6f8"><tr><td align="center" style="padding:24px 12px">` +
    // Outlook (Word) ignores max-width: a fixed 600 px table there.
    `<!--[if mso]><table ${TABLE} width="600"><tr><td><![endif]-->` +
    `<table ${TABLE} width="100%" style="max-width:600px;background:#ffffff;border:1px solid #dfe3e8;border-radius:10px">${header}` +
    `<tr><td style="padding:24px 28px 12px;${FONT};font-size:15px;line-height:1.5;color:${TEXT}">${htmlBlocks(body, false, button)}</td></tr>${foot}</table>` +
    `<!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`
  );
}
