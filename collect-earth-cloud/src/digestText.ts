// The digests' words (Task 19), in the dashboard's four languages, and the mail written from a digest:
// plain text and a simple HTML version of the same lines, every value escaped. Counts are written as
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
  confirmIntro: 'Hello, someone (we hope you) gave this address to an account on {server}, to get its weekly emails.',
  confirmWhat: 'Confirming it means this address gets the weekly emails that account asks for, about its projects on {server}: one a week, each with a link to stop it.',
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
  confirmIntro: 'Hola, alguien (esperamos que usted) dio esta dirección a una cuenta en {server}, para recibir sus correos semanales.',
  confirmWhat: 'Al confirmarla, esta dirección recibe los correos semanales que esa cuenta pida, sobre sus proyectos en {server}: uno por semana, cada uno con un enlace para dejar de recibirlos.',
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
  confirmIntro: 'Bonjour, quelqu’un (vous, nous l’espérons) a donné cette adresse à un compte sur {server}, pour recevoir ses courriels de la semaine.',
  confirmWhat: 'La confirmer, c’est accepter que cette adresse reçoive les courriels de la semaine que ce compte demande, sur ses projets sur {server} : un par semaine, chacun avec un lien pour les arrêter.',
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
  confirmIntro: 'Olá, alguém (esperamos que você) deu este endereço a uma conta em {server}, para receber os seus e-mails semanais.',
  confirmWhat: 'Ao confirmá-lo, este endereço recebe os e-mails semanais que essa conta pedir, sobre os seus projetos em {server}: um por semana, cada um com um link para pará-los.',
  confirmAction: 'Confirmar este endereço (o link funciona por 3 dias)',
  confirmIgnore: 'Se não foi você, não faça nada: nenhum outro e-mail é enviado a este endereço até que seja confirmado.',
};

export const DIGEST_WORDS: Record<MailLanguage, Words> = { en, es, fr, pt };
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

export function renderHtml(lines: readonly MailLine[], language: MailLanguage): string {
  const colon = escapeHtml(colonOf(language));
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) out.push('</ul>');
    inList = false;
  };
  for (const line of lines) {
    if (line.kind === 'value') {
      if (!inList) out.push('<ul style="padding-left:20px;margin:8px 0">');
      inList = true;
      out.push(`<li>${escapeHtml(line.label)}${colon}<strong>${escapeHtml(line.value)}</strong></li>`);
      continue;
    }
    if (line.kind === 'list') {
      if (!inList) out.push('<ul style="padding-left:20px;margin:8px 0">');
      inList = true;
      out.push(`<li>${escapeHtml(line.label)}${colon.trimEnd()}<ul>${line.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul></li>`);
      continue;
    }
    closeList();
    if (line.kind === 'para') out.push(`<p style="margin:8px 0">${escapeHtml(line.text)}</p>`);
    else if (line.kind === 'heading') out.push(`<h2 style="font-size:17px;margin:20px 0 4px">${escapeHtml(line.text)}</h2>`);
    else if (line.kind === 'link') out.push(`<p style="margin:8px 0"><a href="${escapeHtml(line.url)}">${escapeHtml(line.label)}</a></p>`);
    else out.push('<hr style="border:0;border-top:1px solid #ccc;margin:20px 0">');
  }
  closeList();
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#1a1a1a;max-width:640px">${out.join('')}</body></html>`;
}
