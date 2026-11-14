/**
 * The notices the server wants the pages to show (NoticeService): announcements, the offer of a new version, the
 * errors logged, the server's warnings. The pages poll them and show the first.
 */
export interface NoticeOption {
  id: string;
  label: string;
  /** A line under the label of a choice (a file's number of plots, say) */
  detail?: string;
  /** Listed in the notice to pick from (Notice.choice), not a button: sent as "true" */
  choice?: string | boolean;
}

/** The options of a notice listed in it to pick from, and those that are its buttons */
export function splitOptions(options: NoticeOption[]): { choices: NoticeOption[]; buttons: NoticeOption[] } {
  const isChoice = (o: NoticeOption) => o.choice === true || o.choice === "true";
  return { choices: options.filter(isChoice), buttons: options.filter((o) => !isChoice(o)) };
}

export interface Notice {
  id: string;
  kind: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  /** The message is HTML (the announcements, the server's notices) rather than text */
  html: boolean;
  options: NoticeOption[];
}

export const NOTICES_POLL_MILLIS = 5000;

/** The event the pages read the app's info again on (useAppInfo) */
export const APP_INFO_CHANGED = "collectEarth:appInfoChanged";
/**
 * The notices after which the app's info has changed: the cloud sign-in the server no longer takes
 * (CloudSyncService.signedOut), after which the login is asked for again.
 */
export function changesAppInfo(notice: Notice): boolean {
  return notice.kind === "cloudSignedOut";
}

/** The event that opens Data > Send this computer's records to the cloud project (AppBar) */
export const SEND_TO_CLOUD = "collectEarth:sendToCloud";
/** The offer made after joining a cloud project (CloudRecordsSender), answered with its Send option */
export function opensSendToCloud(notice: Notice, option: string): boolean {
  return notice.kind === "cloudSendRecords" && option === "send";
}

/**
 * The notice to show: the first the server lists that this page has not answered. An answer already sent is not
 * shown again while the server has not yet taken it out (the next read may still list it).
 */
export function nextNotice(notices: Notice[], answered: Set<string>): Notice | null {
  return notices.find((n) => !answered.has(n.id)) ?? null;
}

const ALLOWED_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "b", "strong", "i", "em", "u", "ul", "ol", "li", "br", "a"]);

/**
 * The HTML of a notice reduced to plain formatting and http(s)/mailto links: announcements come from openforis.org and
 * would otherwise run on this page, whose API takes no credentials. Fails closed: the output holds only the tags made
 * here and escaped text, so markup this does not understand shows as text, never as markup. (A string scan, not
 * DOMParser, so that the tests, which run without a DOM, check the real thing.)
 */
export function sanitizeNoticeHtml(html: string): string {
  const escape = (text: string) => text.replace(/&(?!#?\w+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const cleaned = html.replace(/<!--[\s\S]*?(-->|$)/g, "")
    .replace(/<(script|style|iframe|object|embed|template|svg|math|noscript|textarea|title)\b[\s\S]*?(<\/\1\s*>|$)/gi, "");
  let out = "";
  let last = 0;
  for (const m of cleaned.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    out += escape(cleaned.slice(last, m.index));
    last = m.index + m[0].length;
    const [, closing, name, attrs] = m;
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (tag === "br") out += closing ? "" : "<br>";
    else if (closing) out += `</${tag}>`;
    else if (tag === "a") {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
      const url = href ? (href[1] ?? href[2] ?? href[3]).trim() : "";
      out += /^(https?:|mailto:)/i.test(url) ? `<a href="${escape(url)}">` : "<a>";
    } else out += `<${tag}>`;
  }
  return out + escape(cleaned.slice(last));
}
