/**
 * The notices the server wants the pages to show (NoticeService): announcements, the offer of a new version, the
 * errors logged, the server's warnings. The pages poll them and show the first.
 */
export interface NoticeOption { id: string; label: string }

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

/**
 * The notice to show: the first the server lists that this page has not answered. An answer already sent is not
 * shown again while the server has not yet taken it out (the next read may still list it).
 */
export function nextNotice(notices: Notice[], answered: Set<string>): Notice | null {
  return notices.find((n) => !answered.has(n.id)) ?? null;
}
