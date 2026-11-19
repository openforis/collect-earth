// "Someone joined your project": the mail each coordinator of a project gets when a person joins it with an
// invitation link (registering, or signing in with an account they had). Optional: on unless the coordinator turns it
// off (Account page, or the mail's unsubscribe link, RFC 8058 one-click). In the dashboard's five languages, as plain
// text and simple HTML (digestText.ts's renderers). It names the person and the project, never anything collected.
import { fill, oneLine, renderHtml, renderText, type MailLine } from './digestText.js';
import type { MailMessage } from './mail.js';
import type { MailLanguage } from './types.js';
import type { Role } from './wire/account.js';
import type { GivenPlots } from './invitePlots.js';

const en = {
  summarySubject: '{server}: {count} more people joined {project}',
  summarySubjectOne: '{server}: one more person joined {project}',
  summaryIntro: 'Since the last email, {count} more people joined the project {project} with an invitation link:',
  summaryIntroOne: 'Since the last email, one more person joined the project {project} with an invitation link:',
  item: '{person}, as {role}',
  itemShare: '{person}, as {role}: {count} plots of {file}',
  itemWhole: '{person}, as {role}: the whole file {file}',
  itemNone: '{person}, as {role}: no plots left in {file}',
  itemNoPlots: '{person}, as {role}: no plots yet',
  summaryWho: 'Who joined',
  gotWhole: 'They got the plot file {file} whole ({count} plots), from the link.',
  gotShare: 'They got {count} plots of {file}, from the link.',
  /** A link sharing out the project's plots, not one file's: what {file} says */
  projectPlots: 'the project’s plots',
  gotNone: 'The link was to give them plots of {file}, but none is left: give them plots.',
  subject: '{server}: {person} joined {project}',
  intro: '{person} joined the project {project} as {role}, with an invitation link.',
  count: 'The project now has {count} people.',
  countOne: 'The project now has 1 person.',
  plots: 'Give them plots to do (Setup › Plots in the dashboard): until then Collect Earth has none for them.',
  open: 'See the project’s people',
  why: 'You get this email because you coordinate {project} on {server}.',
  stop: 'Stop these emails',
  account: 'Your account settings',
  operator: 'a collector',
  reviewer: 'a reviewer',
  admin: 'a coordinator',
};
type Words = typeof en;

const es: Words = {
  summarySubject: '{server}: {count} personas más se unieron a {project}',
  summarySubjectOne: '{server}: una persona más se unió a {project}',
  summaryIntro: 'Desde el último correo, {count} personas más se unieron al proyecto {project} con un enlace de invitación:',
  summaryIntroOne: 'Desde el último correo, una persona más se unió al proyecto {project} con un enlace de invitación:',
  item: '{person}, como {role}',
  itemShare: '{person}, como {role}: {count} parcelas de {file}',
  itemWhole: '{person}, como {role}: el archivo {file} completo',
  itemNone: '{person}, como {role}: no quedan parcelas en {file}',
  itemNoPlots: '{person}, como {role}: aún sin parcelas',
  summaryWho: 'Quién se unió',
  gotWhole: 'Recibió el archivo de parcelas {file} completo ({count} parcelas), por el enlace.',
  gotShare: 'Recibió {count} parcelas de {file}, por el enlace.',
  projectPlots: 'las parcelas del proyecto',
  gotNone: 'El enlace debía darle parcelas de {file}, pero no queda ninguna: asígnele parcelas.',
  subject: '{server}: {person} se unió a {project}',
  intro: '{person} se unió al proyecto {project} como {role}, con un enlace de invitación.',
  count: 'El proyecto tiene ahora {count} personas.',
  countOne: 'El proyecto tiene ahora 1 persona.',
  plots: 'Asígnele parcelas (Preparación › Parcelas en el panel): hasta entonces Collect Earth no tiene ninguna para esa persona.',
  open: 'Ver las personas del proyecto',
  why: 'Recibe este correo porque coordina {project} en {server}.',
  stop: 'Dejar de recibir estos correos',
  account: 'La configuración de su cuenta',
  operator: 'recolector',
  reviewer: 'revisor',
  admin: 'coordinador',
};

const fr: Words = {
  summarySubject: '{server} : {count} personnes de plus ont rejoint {project}',
  summarySubjectOne: '{server} : une personne de plus a rejoint {project}',
  summaryIntro: 'Depuis le dernier courriel, {count} personnes de plus ont rejoint le projet {project} avec un lien d’invitation :',
  summaryIntroOne: 'Depuis le dernier courriel, une personne de plus a rejoint le projet {project} avec un lien d’invitation :',
  item: '{person}, comme {role}',
  itemShare: '{person}, comme {role} : {count} parcelles de {file}',
  itemWhole: '{person}, comme {role} : le fichier {file} en entier',
  itemNone: '{person}, comme {role} : plus de parcelles dans {file}',
  itemNoPlots: '{person}, comme {role} : pas encore de parcelles',
  summaryWho: 'Qui a rejoint',
  gotWhole: 'Cette personne a reçu le fichier de parcelles {file} en entier ({count} parcelles), par le lien.',
  gotShare: 'Cette personne a reçu {count} parcelles de {file}, par le lien.',
  projectPlots: 'des parcelles du projet',
  gotNone: 'Le lien devait lui donner des parcelles de {file}, mais il n’en reste aucune : donnez-lui des parcelles.',
  subject: '{server} : {person} a rejoint {project}',
  intro: '{person} a rejoint le projet {project} comme {role}, avec un lien d’invitation.',
  count: 'Le projet compte maintenant {count} personnes.',
  countOne: 'Le projet compte maintenant 1 personne.',
  plots: 'Donnez-lui des parcelles à faire (Mise en place › Parcelles dans le tableau de bord) : d’ici là, Collect Earth n’en a aucune pour cette personne.',
  open: 'Voir les personnes du projet',
  why: 'Vous recevez ce courriel parce que vous coordonnez {project} sur {server}.',
  stop: 'Ne plus recevoir ces courriels',
  account: 'Les réglages de votre compte',
  operator: 'collecteur',
  reviewer: 'réviseur',
  admin: 'coordinateur',
};

const pt: Words = {
  summarySubject: '{server}: mais {count} pessoas entraram em {project}',
  summarySubjectOne: '{server}: mais uma pessoa entrou em {project}',
  summaryIntro: 'Desde o último e-mail, mais {count} pessoas entraram no projeto {project} com um link de convite:',
  summaryIntroOne: 'Desde o último e-mail, mais uma pessoa entrou no projeto {project} com um link de convite:',
  item: '{person}, como {role}',
  itemShare: '{person}, como {role}: {count} parcelas de {file}',
  itemWhole: '{person}, como {role}: o arquivo {file} inteiro',
  itemNone: '{person}, como {role}: não restam parcelas em {file}',
  itemNoPlots: '{person}, como {role}: ainda sem parcelas',
  summaryWho: 'Quem entrou',
  gotWhole: 'Recebeu o arquivo de parcelas {file} inteiro ({count} parcelas), pelo link.',
  gotShare: 'Recebeu {count} parcelas de {file}, pelo link.',
  projectPlots: 'das parcelas do projeto',
  gotNone: 'O link devia dar-lhe parcelas de {file}, mas não resta nenhuma: atribua-lhe parcelas.',
  subject: '{server}: {person} entrou em {project}',
  intro: '{person} entrou no projeto {project} como {role}, com um link de convite.',
  count: 'O projeto tem agora {count} pessoas.',
  countOne: 'O projeto tem agora 1 pessoa.',
  plots: 'Atribua-lhe parcelas (Preparação › Parcelas no painel): até lá o Collect Earth não tem nenhuma para essa pessoa.',
  open: 'Ver as pessoas do projeto',
  why: 'Recebe este e-mail porque coordena {project} em {server}.',
  stop: 'Deixar de receber estes e-mails',
  account: 'As configurações da sua conta',
  operator: 'coletor',
  reviewer: 'revisor',
  admin: 'coordenador',
};

const tr: Words = {
  summarySubject: '{server}: {project} projesine {count} kişi daha katıldı',
  summarySubjectOne: '{server}: {project} projesine bir kişi daha katıldı',
  summaryIntro: 'Son e-postadan bu yana {project} projesine davet bağlantısıyla {count} kişi daha katıldı:',
  summaryIntroOne: 'Son e-postadan bu yana {project} projesine davet bağlantısıyla bir kişi daha katıldı:',
  item: '{person}, {role} olarak',
  itemShare: '{person}, {role} olarak: {file} dosyasından {count} parsel',
  itemWhole: '{person}, {role} olarak: {file} dosyasının tamamı',
  itemNone: '{person}, {role} olarak: {file} dosyasında parsel kalmadı',
  itemNoPlots: '{person}, {role} olarak: henüz parsel yok',
  summaryWho: 'Katılanlar',
  gotWhole: 'Bağlantıdan {file} parsel dosyasının tamamını ({count} parsel) aldı.',
  gotShare: 'Bağlantıdan {file} dosyasından {count} parsel aldı.',
  projectPlots: 'projenin parselleri',
  gotNone: 'Bağlantı ona {file} dosyasından parsel verecekti ama hiç kalmadı: ona parsel verin.',
  subject: '{server}: {person}, {project} projesine katıldı',
  intro: '{person}, bir davet bağlantısıyla {project} projesine {role} olarak katıldı.',
  count: 'Projede artık {count} kişi var.',
  countOne: 'Projede artık 1 kişi var.',
  plots: 'Ona yapılacak parseller verin (panoda Kurulum › Parseller): o zamana kadar Collect Earth’te onun için parsel yok.',
  open: 'Projenin kişilerini görün',
  why: 'Bu e-postayı {server} üzerinde {project} projesini koordine ettiğiniz için alıyorsunuz.',
  stop: 'Bu e-postaları durdur',
  account: 'Hesap ayarlarınız',
  operator: 'veri toplayıcı',
  reviewer: 'denetçi',
  admin: 'koordinatör',
};

export const JOIN_WORDS: Record<MailLanguage, Words> = { en, es, fr, pt, tr };

export interface JoinMailContext {
  serverName: string;
  language: MailLanguage;
  /** The dashboard's address (PUBLIC_BASE_URL) */
  baseUrl: string;
  /** The one-click unsubscribe address of this coordinator's join mails */
  unsubscribeUrl: string;
}

export interface Joined {
  projectId: string;
  projectName: string;
  username: string;
  role: Role;
  /** People in the project now, the one who joined included */
  people: number;
  /** The plots the invitation link gave them (src/invitePlots.ts), or null */
  given?: GivenPlots | null;
}

/** What the mail says of the person's plots: those the link gave, or, for a collector without, to give them some */
function plotsLines(joined: Joined, w: (key: keyof Words, params?: Record<string, string | number>) => string, language: MailLanguage): MailLine[] {
  const g = joined.given;
  if (g) {
    const params = { file: g.filename === null ? w('projectPlots') : oneLine(g.filename), count: new Intl.NumberFormat(language).format(g.plots) };
    return [{ kind: 'para', text: w(g.plots === 0 ? 'gotNone' : g.mode === 'whole' ? 'gotWhole' : 'gotShare', params) }];
  }
  return joined.role === 'operator' ? [{ kind: 'para', text: w('plots') }] : [];
}

export function joinedMail(ctx: JoinMailContext, joined: Joined, to: string): MailMessage {
  const words = JOIN_WORDS[ctx.language] ?? JOIN_WORDS.en;
  const w = (key: keyof Words, params: Record<string, string | number> = {}) => fill(words[key], params);
  const p = { server: oneLine(ctx.serverName), person: oneLine(joined.username), project: oneLine(joined.projectName), role: w(joined.role) };
  const lines: MailLine[] = [
    { kind: 'para', text: w('intro', p) },
    { kind: 'para', text: joined.people === 1 ? w('countOne') : w('count', { count: new Intl.NumberFormat(ctx.language).format(joined.people) }) },
    ...plotsLines(joined, w, ctx.language),
    { kind: 'link', label: w('open'), url: `${ctx.baseUrl}/projects/${encodeURIComponent(joined.projectId)}/people` },
    { kind: 'rule' },
    { kind: 'para', text: w('why', p) },
    { kind: 'link', label: w('stop'), url: ctx.unsubscribeUrl },
    { kind: 'link', label: w('account'), url: `${ctx.baseUrl}/account` },
  ];
  return {
    to,
    subject: oneLine(w('subject', p)),
    text: renderText(lines, ctx.language),
    html: renderHtml(lines, ctx.language, ctx.serverName),
    tag: 'project.joined',
    headers: {
      'List-Unsubscribe': `<${ctx.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    },
  };
}

/** One person in a grouped mail: their name, role and the plots their link gave (by file name) */
export interface JoinedPerson {
  username: string;
  role: Role;
  /** `filename` null: the project's plots (a link over the project) */
  given: { filename: string | null; mode: 'whole' | 'share'; plots: number } | null;
}

/**
 * The grouped mail: the people who joined since the last mail about the project (src/routes/mail.ts sends the first join
 * at once, then at most one of these an hour), each with their role and plots.
 */
export function joinedSummaryMail(
  ctx: JoinMailContext,
  project: { projectId: string; projectName: string; people: number },
  joined: readonly JoinedPerson[],
  to: string,
): MailMessage {
  const words = JOIN_WORDS[ctx.language] ?? JOIN_WORDS.en;
  const w = (key: keyof Words, params: Record<string, string | number> = {}) => fill(words[key], params);
  const n = (v: number) => new Intl.NumberFormat(ctx.language).format(v);
  const p = { server: oneLine(ctx.serverName), project: oneLine(project.projectName), count: n(joined.length) };
  const item = (j: JoinedPerson): string => {
    const q = { person: oneLine(j.username), role: w(j.role) };
    const g = j.given;
    if (!g) return w(j.role === 'operator' ? 'itemNoPlots' : 'item', q);
    const f = { ...q, file: g.filename === null ? w('projectPlots') : oneLine(g.filename), count: n(g.plots) };
    return w(g.plots === 0 ? 'itemNone' : g.mode === 'whole' ? 'itemWhole' : 'itemShare', f);
  };
  const one = joined.length === 1;
  const lines: MailLine[] = [
    { kind: 'para', text: w(one ? 'summaryIntroOne' : 'summaryIntro', p) },
    { kind: 'list', label: w('summaryWho'), items: joined.map(item) },
    { kind: 'para', text: project.people === 1 ? w('countOne') : w('count', { count: n(project.people) }) },
    ...(joined.some((j) => j.role === 'operator' && (!j.given || j.given.plots === 0)) ? [{ kind: 'para', text: w('plots') } as MailLine] : []),
    { kind: 'link', label: w('open'), url: `${ctx.baseUrl}/projects/${encodeURIComponent(project.projectId)}/people` },
    { kind: 'rule' },
    { kind: 'para', text: w('why', p) },
    { kind: 'link', label: w('stop'), url: ctx.unsubscribeUrl },
    { kind: 'link', label: w('account'), url: `${ctx.baseUrl}/account` },
  ];
  return {
    to,
    subject: oneLine(w(one ? 'summarySubjectOne' : 'summarySubject', p)),
    text: renderText(lines, ctx.language),
    html: renderHtml(lines, ctx.language, ctx.serverName),
    tag: 'project.joined.summary',
    headers: {
      'List-Unsubscribe': `<${ctx.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
    },
  };
}
