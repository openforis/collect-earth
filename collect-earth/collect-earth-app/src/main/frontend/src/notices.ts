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
