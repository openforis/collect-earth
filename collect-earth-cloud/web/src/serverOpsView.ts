// The view logic of the server page's projects and operations (pages/ServerProjects.tsx, pages/ServerOperations.tsx):
// one entry of the server activity log as a sentence, and a project id shortened for reading.
import type { ServerActivityEntry } from "./api";
import { formatNumber } from "./format";
import type { MessageKey } from "./i18n";

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The label of each server setting, as the Settings section shows it. */
export const SETTING_LABELS: Record<string, MessageKey> = {
  signupOpen: "server.signupOpen",
  projectCreation: "server.projectCreation",
  maxProjectsPerUser: "server.maxProjects",
  maxProjectStorageMb: "server.maxStorage",
  termsUrl: "server.termsUrl",
  contactEmail: "server.contactEmail",
  serverName: "server.serverName",
  aiEnabled: "server.aiEnabled",
  aiReportsPerDay: "server.aiReports",
  aiFollowUpsPerDay: "server.aiFollowUps",
  aiMonthlyTokens: "server.aiTokens",
  announcement: "server.announcementText",
  announcementUntil: "server.announcementUntil",
  twoFactorForCoordinators: "server.twoFactorRequired",
  alertFailedLogins: "server.alertFailedLogins",
  alertServerErrors: "server.alertServerErrors",
  alertSyncErrors: "server.alertSyncErrors",
  alertStoragePercent: "server.alertStoragePercent",
  alertWebhookUrl: "server.alertWebhook",
  signupDomains: "server.signupDomains",
  minPasswordLength: "server.minPassword",
  loginLockFailures: "server.lockFailures",
  loginLockMinutes: "server.lockMinutes",
};

/** A project id's first part ("3f2a9c1b…"): the whole id is in the entry's details and the CSV. */
export const shortId = (id: string) => (id.length > 9 ? `${id.slice(0, 8)}…` : id);

/** The settings changed, by their labels: a switch "on" or "off", a number with its value, a text only named. */
function settingsText(t: T, details: ServerActivityEntry["details"], language: string): string {
  return Object.entries(details)
    .map(([key, value]) => {
      const label = SETTING_LABELS[key] ? t(SETTING_LABELS[key]) : key;
      if (key === "projectCreation") return label;
      if (typeof value === "boolean") return `${label}: ${t(value ? "serverLog.on" : "serverLog.off")}`;
      if (key === "announcementUntil") return value === null ? `${label}: ${t("serverLog.cleared")}` : label;
      if (typeof value === "number") return `${label}: ${formatNumber(value, language)}`;
      if (value === null) return `${label}: ${t("serverLog.cleared")}`;
      return label;
    })
    .join("; ");
}

/** One entry of the server activity log in words: "ana disabled ben", "owner changed Open sign-up: on". */
export function activitySentence(t: T, e: ServerActivityEntry, language: string): string {
  const p = {
    actor: e.actor ?? t("serverLog.someone"),
    target: e.target ?? "?",
    project: e.projectId ? shortId(e.projectId) : "?",
  };
  const d = e.details;
  switch (e.action) {
    case "settings.changed":
      return t("serverLog.settings.changed", { ...p, settings: settingsText(t, d, language) });
    case "account.created":
      return t(d.mailed === true ? "serverLog.account.createdMailed" : "serverLog.account.created", p);
    case "account.deleted":
      return typeof d.projectsDeleted === "number" && d.projectsDeleted > 0
        ? t("serverLog.account.deletedWithProjects", { ...p, count: formatNumber(d.projectsDeleted, language) })
        : t("serverLog.account.deleted", p);
    case "accounts.exported":
      return t("serverLog.accounts.exported", { ...p, count: formatNumber(typeof d.accounts === "number" ? d.accounts : 0, language) });
    case "mail.test":
      return d.sent === false
        ? t("serverLog.mail.testRefused", { ...p, code: String(d.responseCode ?? d.code ?? "?") })
        : t("serverLog.mail.test", p);
    case "message.sent":
      return t("serverLog.message.sent", { ...p, subject: String(d.subject ?? ""), count: formatNumber(typeof d.recipients === "number" ? d.recipients : 0, language) });
    case "alerts.seen":
      return d.count === 1 ? t("serverLog.alerts.seenOne", p) : t("serverLog.alerts.seen", { ...p, count: formatNumber(typeof d.count === "number" ? d.count : 0, language) });
    case "account.unlocked":
    case "account.disabled":
    case "account.enabled":
    case "account.admin_granted":
    case "account.admin_removed":
    case "account.signed_out":
    case "account.reset_link":
    case "account.reset_mailed":
    case "account.two_factor_off":
    case "project.archived":
    case "project.restored":
    case "project.coordinator":
      return t(`serverLog.${e.action}` as MessageKey, p);
    default:
      return t("serverLog.unknown", { ...p, action: e.action });
  }
}
