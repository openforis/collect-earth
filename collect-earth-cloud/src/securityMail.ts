// The account's security mails: the self-service password reset link ("Forgot your password?") and
// the notices after a password change (on the account page or with any reset link) and after the
// email address is changed or removed (to the OLD address). In the dashboard's four languages, as
// plain text and simple HTML (digestText.ts's renderers). Transactional: no unsubscribe link, no
// tracking, and no link but the reset link itself or the dashboard's address.
import { fill, oneLine, renderHtml, renderText, type MailLine } from './digestText.js';
import { isTimeZone } from './days.js';
import type { MailMessage } from './mail.js';
import type { MailLanguage } from './types.js';

/** How long a reset link mailed by "Forgot your password?" works (an administrator's works 7 days). */
export const SELF_RESET_TTL_MS = 60 * 60 * 1000;

const en = {
  resetSubject: '{server}: reset your password',
  resetIntro: 'Hello, someone (we hope you) asked to reset the password of the account {name} on {server}.',
  resetAction: 'Choose a new password (the link works once, for one hour)',
  resetAfter: 'Choosing it signs the account out everywhere, Collect Earth included: sign in again with the new password.',
  resetIgnore: 'If it was not you, do nothing: the password stays as it is and the link stops working in an hour.',
  passwordSubject: '{server}: your password was changed',
  passwordChanged: 'The password of your {server} account {name} was changed on {when}.',
  passwordByUser: 'It was changed on the account page; the account’s other sessions, Collect Earth’s included, were signed out.',
  passwordByReset: 'It was changed with a password reset link; every session of the account, Collect Earth’s included, was signed out.',
  passwordNotYou: 'If this was not you, someone else may know your password: choose a new one at once with “Forgot your password?” on the sign-in page, and tell the administrator of the server.',
  emailSubject: '{server}: the email address of your account was changed',
  emailChanged: 'The email address of your {server} account {name} was changed on {when}, to {masked}. This address gets no more mail about the account.',
  emailRemoved: 'The email address of your {server} account {name} was removed on {when}. This address gets no more mail about the account.',
  emailNotYou: 'If this was not you, someone else may be signed in to your account: tell the administrator of the server at once, so they can disable it and give you a new password reset link.',
  contact: 'You can write to them at {email}.',
  dashboard: '{server}',
  why: 'This is an automatic notice about your account’s security, sent to the confirmed address of the account.',
};

type Words = typeof en;

const es: Words = {
  resetSubject: '{server}: restablezca su contraseña',
  resetIntro: 'Hola, alguien (esperamos que usted) pidió restablecer la contraseña de la cuenta {name} en {server}.',
  resetAction: 'Elegir una contraseña nueva (el enlace funciona una vez, durante una hora)',
  resetAfter: 'Al elegirla se cierran todas las sesiones de la cuenta, también la de Collect Earth: vuelva a iniciar sesión con la contraseña nueva.',
  resetIgnore: 'Si no fue usted, no haga nada: la contraseña sigue igual y el enlace deja de funcionar en una hora.',
  passwordSubject: '{server}: su contraseña se cambió',
  passwordChanged: 'La contraseña de su cuenta {name} de {server} se cambió el {when}.',
  passwordByUser: 'Se cambió en la página de la cuenta; las otras sesiones de la cuenta, también la de Collect Earth, se cerraron.',
  passwordByReset: 'Se cambió con un enlace para restablecer la contraseña; todas las sesiones de la cuenta, también la de Collect Earth, se cerraron.',
  passwordNotYou: 'Si no fue usted, otra persona puede conocer su contraseña: elija una nueva enseguida con «¿Olvidó su contraseña?» en la página de inicio de sesión, y avise al administrador del servidor.',
  emailSubject: '{server}: la dirección de correo de su cuenta se cambió',
  emailChanged: 'La dirección de correo de su cuenta {name} de {server} se cambió el {when}, por {masked}. Esta dirección ya no recibe correos sobre la cuenta.',
  emailRemoved: 'La dirección de correo de su cuenta {name} de {server} se quitó el {when}. Esta dirección ya no recibe correos sobre la cuenta.',
  emailNotYou: 'Si no fue usted, otra persona puede haber iniciado sesión en su cuenta: avise enseguida al administrador del servidor, para que la desactive y le dé un nuevo enlace para restablecer la contraseña.',
  contact: 'Puede escribirle a {email}.',
  dashboard: '{server}',
  why: 'Este es un aviso automático sobre la seguridad de su cuenta, enviado a la dirección confirmada de la cuenta.',
};

const fr: Words = {
  resetSubject: '{server} : réinitialisez votre mot de passe',
  resetIntro: 'Bonjour, quelqu’un (vous, nous l’espérons) a demandé à réinitialiser le mot de passe du compte {name} sur {server}.',
  resetAction: 'Choisir un nouveau mot de passe (le lien fonctionne une fois, pendant une heure)',
  resetAfter: 'Le choisir déconnecte le compte partout, Collect Earth compris : reconnectez-vous avec le nouveau mot de passe.',
  resetIgnore: 'Si ce n’était pas vous, ne faites rien : le mot de passe reste le même et le lien ne fonctionne plus dans une heure.',
  passwordSubject: '{server} : votre mot de passe a été changé',
  passwordChanged: 'Le mot de passe de votre compte {name} sur {server} a été changé le {when}.',
  passwordByUser: 'Il a été changé sur la page du compte ; les autres sessions du compte, celle de Collect Earth comprise, ont été déconnectées.',
  passwordByReset: 'Il a été changé avec un lien de réinitialisation du mot de passe ; toutes les sessions du compte, celle de Collect Earth comprise, ont été déconnectées.',
  passwordNotYou: 'Si ce n’était pas vous, quelqu’un d’autre connaît peut-être votre mot de passe : choisissez-en un nouveau tout de suite avec « Mot de passe oublié ? » sur la page de connexion, et prévenez l’administrateur du serveur.',
  emailSubject: '{server} : l’adresse courriel de votre compte a été changée',
  emailChanged: 'L’adresse courriel de votre compte {name} sur {server} a été changée le {when}, pour {masked}. Cette adresse ne reçoit plus de courriel au sujet du compte.',
  emailRemoved: 'L’adresse courriel de votre compte {name} sur {server} a été retirée le {when}. Cette adresse ne reçoit plus de courriel au sujet du compte.',
  emailNotYou: 'Si ce n’était pas vous, quelqu’un d’autre est peut-être connecté à votre compte : prévenez tout de suite l’administrateur du serveur, pour qu’il le désactive et vous donne un nouveau lien de réinitialisation du mot de passe.',
  contact: 'Vous pouvez lui écrire à {email}.',
  dashboard: '{server}',
  why: 'Ceci est un avis automatique sur la sécurité de votre compte, envoyé à l’adresse confirmée du compte.',
};

const pt: Words = {
  resetSubject: '{server}: redefina a sua senha',
  resetIntro: 'Olá, alguém (esperamos que você) pediu para redefinir a senha da conta {name} em {server}.',
  resetAction: 'Escolher uma senha nova (o link funciona uma vez, durante uma hora)',
  resetAfter: 'Ao escolhê-la, todas as sessões da conta são encerradas, inclusive a do Collect Earth: entre de novo com a senha nova.',
  resetIgnore: 'Se não foi você, não faça nada: a senha continua a mesma e o link deixa de funcionar em uma hora.',
  passwordSubject: '{server}: a sua senha foi alterada',
  passwordChanged: 'A senha da sua conta {name} em {server} foi alterada em {when}.',
  passwordByUser: 'Foi alterada na página da conta; as outras sessões da conta, inclusive a do Collect Earth, foram encerradas.',
  passwordByReset: 'Foi alterada com um link para redefinir a senha; todas as sessões da conta, inclusive a do Collect Earth, foram encerradas.',
  passwordNotYou: 'Se não foi você, outra pessoa pode conhecer a sua senha: escolha uma nova já com "Esqueceu a senha?" na página de entrada, e avise o administrador do servidor.',
  emailSubject: '{server}: o endereço de e-mail da sua conta foi alterado',
  emailChanged: 'O endereço de e-mail da sua conta {name} em {server} foi alterado em {when}, para {masked}. Este endereço não recebe mais e-mails sobre a conta.',
  emailRemoved: 'O endereço de e-mail da sua conta {name} em {server} foi removido em {when}. Este endereço não recebe mais e-mails sobre a conta.',
  emailNotYou: 'Se não foi você, outra pessoa pode ter entrado na sua conta: avise já o administrador do servidor, para que ele a desative e lhe dê um novo link para redefinir a senha.',
  contact: 'Você pode escrever para {email}.',
  dashboard: '{server}',
  why: 'Este é um aviso automático sobre a segurança da sua conta, enviado ao endereço confirmado da conta.',
};

export const SECURITY_WORDS: Record<MailLanguage, Words> = { en, es, fr, pt };

const wordsOf = (language: MailLanguage) => {
  const words = SECURITY_WORDS[language] ?? SECURITY_WORDS.en;
  return (key: keyof Words, params: Record<string, string> = {}) => fill(words[key], params);
};

/** No reply expected and no auto-reply wanted (RFC 3834); no List-Unsubscribe: these are not optional. */
const HEADERS = { 'Auto-Submitted': 'auto-generated' };

/**
 * An address shown only in part: its first character, then "…", the domain's first character, "…"
 * and the domain's last label (`m…@e….org`). Never the whole address.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '…';
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}…@${domain[0] ?? ''}…${tld}`;
}

/** A moment as the language writes it, in the account's time zone (UTC when it has none), the zone named. */
export function longMoment(at: number, language: MailLanguage, timeZone: string | null): string {
  const zone = timeZone !== null && isTimeZone(timeZone) ? timeZone : 'UTC';
  const text = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: zone }).format(new Date(at));
  return `${text} (${zone})`;
}

export interface SecurityContext {
  serverName: string;
  language: MailLanguage;
  username: string;
  /** The dashboard's address (PUBLIC_BASE_URL): the only link besides a reset link. */
  baseUrl: string;
  /** The server's contact address (Server settings), or null. */
  contactEmail: string | null;
}

function params(ctx: SecurityContext): Record<string, string> {
  return { server: oneLine(ctx.serverName), name: oneLine(ctx.username) };
}

function message(ctx: SecurityContext, to: string, subject: string, lines: MailLine[], tag: string): MailMessage {
  return { to, subject: oneLine(subject), text: renderText(lines, ctx.language), html: renderHtml(lines, ctx.language), tag, headers: HEADERS };
}

/** What to do when it was not you, then who to write to, then the dashboard's address. */
function closing(ctx: SecurityContext, notYou: string): MailLine[] {
  const w = wordsOf(ctx.language);
  const contact = ctx.contactEmail ? ` ${w('contact', { email: oneLine(ctx.contactEmail) })}` : '';
  return [
    { kind: 'para', text: `${notYou}${contact}` },
    { kind: 'link', label: w('dashboard', params(ctx)), url: ctx.baseUrl },
    { kind: 'rule' },
    { kind: 'para', text: w('why') },
  ];
}

/** The self-service reset link ("Forgot your password?"), to the account's confirmed address. */
export function resetLinkMail(ctx: SecurityContext, resetUrl: string, to: string): MailMessage {
  const w = wordsOf(ctx.language);
  const p = params(ctx);
  const lines: MailLine[] = [
    { kind: 'para', text: w('resetIntro', p) },
    { kind: 'link', label: w('resetAction'), url: resetUrl },
    { kind: 'para', text: w('resetAfter') },
    { kind: 'para', text: w('resetIgnore') },
  ];
  return message(ctx, to, w('resetSubject', p), lines, 'account.reset');
}

/** After a password change: on the account page ('changed') or with a reset link ('reset'). */
export function passwordChangedMail(ctx: SecurityContext, how: 'changed' | 'reset', when: string, to: string): MailMessage {
  const w = wordsOf(ctx.language);
  const p = { ...params(ctx), when };
  const lines: MailLine[] = [
    { kind: 'para', text: w('passwordChanged', p) },
    { kind: 'para', text: w(how === 'reset' ? 'passwordByReset' : 'passwordByUser') },
    ...closing(ctx, w('passwordNotYou')),
  ];
  return message(ctx, to, w('passwordSubject', p), lines, 'account.password-changed');
}

/** To the OLD confirmed address, after the address was changed (`newAddress`, shown masked) or removed (null). */
export function emailChangedMail(ctx: SecurityContext, newAddress: string | null, when: string, to: string): MailMessage {
  const w = wordsOf(ctx.language);
  const p = { ...params(ctx), when, masked: newAddress === null ? '' : maskEmail(newAddress) };
  const lines: MailLine[] = [
    { kind: 'para', text: w(newAddress === null ? 'emailRemoved' : 'emailChanged', p) },
    ...closing(ctx, w('emailNotYou')),
  ];
  return message(ctx, to, w('emailSubject', p), lines, 'account.email-changed');
}
