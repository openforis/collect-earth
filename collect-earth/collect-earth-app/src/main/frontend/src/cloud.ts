import { useCallback, useEffect, useState } from "react";
import type { MessageKey, Translate } from "./i18n";
import type { SaveState } from "./form/store";
import { APP_INFO_CHANGED } from "./notices";
import { cloudState, recordSync } from "./projectApi";
import type { Project } from "./settings";

/**
 * Where the open project keeps its data, and how its sending goes (GET /api/cloud/state): what the project chip of the
 * app bar, the cloud accounts of the settings and the save message of the form say.
 */
export interface CloudAccount { server: string; serverName: string; username: string }
export interface CloudProject {
  mode: "local" | "cloud";
  name: string;
  server: string | null;
  serverName: string | null;
  cloudProjectId: string | null;
  cloudProjectName: string | null;
  account: string | null;
  signedIn: boolean;
  /** The account's role in the cloud project (admin, reviewer, operator); absent from an older Collect Earth */
  role?: string | null;
  /** The account administers the cloud server */
  serverAdmin?: boolean | null;
}
export interface CloudSync {
  pending: number;
  failed: number;
  lastSyncedOn: string | null;
  lastError: string | null;
  online: boolean | null;
  needsSignIn: boolean;
}
export interface CloudState { project: CloudProject; sync: CloudSync | null; accounts: CloudAccount[] }
/** Where a record is (GET /api/cloud/recordSync) */
export type RecordSync = "local" | "pending" | "sent" | "failed";

/** How often the app bar reads the state of a cloud project while the window is shown */
export const CLOUD_STATE_POLL_MILLIS = 15000;
/** How often the form asks whether the plot saved has been sent */
export const RECORD_SYNC_POLL_MILLIS = 3000;

/** The server's name, else its address */
export const serverOf = (p: CloudProject): string => p.serverName ?? p.server ?? "";
/** The cloud project's name, else its id, else the local project's */
export const cloudProjectOf = (p: CloudProject): string => p.cloudProjectName ?? p.cloudProjectId ?? p.name;

export type ChipIcon = "computer" | "cloud" | "sent" | "waiting" | "offline" | "failed" | "signIn";
export interface ProjectChip {
  icon: ChipIcon;
  /** What the chip shows; the status (none when all is sent, the tick says it) after it */
  label: string;
  status: string | null;
  /** The whole of it, for a screen reader and the chip reduced to its icon */
  name: string;
  tip: string;
  color: "default" | "success" | "warning" | "error";
  /** What a click does: the sync status, the login, or nothing (a local project) */
  action: "status" | "signIn" | null;
}

/** The chip of the project in the app bar: on this computer, or the cloud project, its server and its sending. */
export function projectChip(state: CloudState, t: Translate, when: (iso: string) => string): ProjectChip {
  const p = state.project;
  if (p.mode === "local") {
    const accounts = state.accounts.map((a) => t("cloud.account", { server: a.serverName || a.server, username: a.username })).join(", ");
    const tip = t("cloud.localTip") + (accounts ? " " + t("cloud.localTipAccounts", { accounts }) : "");
    const label = t("cloud.local");
    return { icon: "computer", label, status: null, name: label, tip, color: "default", action: null };
  }
  const server = serverOf(p);
  const label = server ? t("cloud.cloud", { server }) : t("cloud.cloudNoServer");
  const s = state.sync;
  const project = cloudProjectOf(p);
  const role = roleOf(p.role, t);
  const account = p.account && (role ? p.account + " (" + role.name + ")" : p.account);
  const tip = [
    !server ? t("cloud.cloudTipNoServer", { project })
      : account ? t("cloud.cloudTip", { project, server, account }) : t("cloud.cloudTipNoAccount", { project, server }),
    s?.lastSyncedOn ? t("cloud.lastSync", { when: when(s.lastSyncedOn) }) : "",
  ].filter(Boolean).join(" ");
  const chip = (icon: ChipIcon, status: string | null, color: ProjectChip["color"], action: ProjectChip["action"] = "status", spoken = status): ProjectChip =>
    ({ icon, label, status, name: [label, spoken].filter(Boolean).join(" · "), tip, color, action });
  if (s?.needsSignIn) return chip("signIn", t("cloud.signInAgain"), "error", "signIn");
  if (!p.signedIn) return chip("signIn", t("cloud.notSignedIn"), "error", "signIn");
  // Without a sync (switched off) nothing is known of the sending: no tick
  if (!s) return chip("cloud", null, "default");
  if (s.failed > 0) return chip("failed", t("cloud.failed", { count: s.failed }), "warning");
  if (s.online === false) return chip("offline", s.pending > 0 ? t("cloud.offline", { count: s.pending }) : t("cloud.offlineNone"), "warning");
  if (s.pending > 0) return chip("waiting", t("cloud.waiting", { count: s.pending }), "warning");
  return chip("sent", null, "success", "status", t("cloud.allSent"));
}

// A Map, not an object: a role called "constructor" would find a property of every object
const ROLES = new Map<string, [MessageKey, MessageKey]>([
  ["admin", ["cloud.role.admin", "cloud.role.admin.help"]],
  ["reviewer", ["cloud.role.reviewer", "cloud.role.reviewer.help"]],
  ["operator", ["cloud.role.operator", "cloud.role.operator.help"]],
]);

/** A role in a cloud project, by the dashboard's name, and a line of what it does; null for none, or one not known */
export function roleOf(role: string | null | undefined, t: Translate): { name: string; help: string } | null {
  const keys = role ? ROLES.get(role) : undefined;
  return keys ? { name: t(keys[0]), help: t(keys[1]) } : null;
}

/**
 * The "you" chip of a cloud project: the account and its role (`short`: the account alone, for a narrow bar), the
 * whole of it as its name; its tooltip `signedIn` (the sign-in and the click), then what the role does and who changes it.
 */
export function youChip(p: CloudProject, operator: string | null, signedIn: string, t: Translate):
  { label: string; short: string; name: string; tip: string } {
  const account = p.account ?? operator ?? "";
  const role = roleOf(p.role, t);
  const label = role ? account + " · " + role.name : account;
  const what = [role?.name, p.serverAdmin ? t("cloud.serverAdmin") : null].filter(Boolean).join(" · ");
  const tip = [signedIn, what && (role ? what + ": " + role.help : what), role ? t("cloud.role.change") : ""].filter(Boolean).join(" ");
  return { label, short: account, name: label, tip };
}

/**
 * The server to show for each cloud project of Switch project's list: each its own when they are on several servers;
 * else none, the list saying it once (`list`). Null where the server is not told (an older Collect Earth).
 */
export function cloudProjectServers(projects: { server?: string | null; serverName?: string | null }[]): { list: string | null; each: (string | null)[] } {
  const each = projects.map((p) => p.serverName || p.server || null);
  const servers = new Set(projects.map((p) => p.server || p.serverName).filter(Boolean));
  return servers.size > 1 ? { list: null, each } : { list: each.find((s) => s !== null) ?? null, each: each.map(() => null) };
}

/**
 * The mark of a project in the settings' list of projects: on this computer, or a cloud project and its server, with
 * the cloud project's name when it is not the project's.
 */
export function projectMark(project: Project, t: Translate): { icon: "computer" | "cloud"; label: string; detail: string | null } {
  const c = project.cloud;
  if (!c) return { icon: "computer", label: t("cloud.local"), detail: null };
  const server = c.serverName || c.server;
  return {
    icon: "cloud",
    label: server ? t("cloud.cloud", { server }) : t("cloud.cloudNoServer"),
    detail: c.projectName && c.projectName !== project.name ? t("cloud.projectName", { project: c.projectName }) : null,
  };
}

/** The state of the project as /api/app tells it, until /api/cloud/state answers (or when it cannot). */
export function fallbackState(project: string | null, cloud: boolean): CloudState {
  return {
    project: { mode: cloud ? "cloud" : "local", name: project ?? "", server: null, serverName: null, cloudProjectId: null, cloudProjectName: null, account: null, signedIn: true },
    sync: null, accounts: [],
  };
}

/**
 * The state of the project, read now, again every CLOUD_STATE_POLL_MILLIS in a cloud project while the window is shown,
 * when it is shown again, and soon after the form saved a plot or the app's info changed (a sign-in, a sign-out).
 * Null until read. Also answers a way to read it again now, and to set it (from the answer of a sign-out).
 */
export function useCloudState(cloud: boolean): [CloudState | null, () => void, (state: CloudState) => void] {
  const [state, setState] = useState<CloudState | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (document.visibilityState !== "hidden") {
      // A read that fails keeps the state read before: the chip does not flicker back to what /api/app knows
      cloudState(controller.signal).then(setState, () => { /* read again at the next tick */ });
    }
    return () => controller.abort();
  }, [tick, cloud]);
  useEffect(() => {
    const timer = cloud ? window.setInterval(refresh, CLOUD_STATE_POLL_MILLIS) : undefined;
    let soon: number | undefined;
    // The form's save reaches the server's queue just after it answers: read a moment later
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data?.type === "ce:saved" || e.data?.type === "ce:dirty")) {
        window.clearTimeout(soon);
        soon = window.setTimeout(refresh, 1000);
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("message", onMessage);
    window.addEventListener(APP_INFO_CHANGED, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(soon);
      window.removeEventListener("message", onMessage);
      window.removeEventListener(APP_INFO_CHANGED, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cloud, refresh]);
  return [state, refresh, setState];
}

export type SaveIcon = "saving" | "edit" | "saved" | "waiting" | "sent" | "notSent" | "error";
export interface SaveView { key: MessageKey; icon: SaveIcon; color: "default" | "success" | "warning" | "error" }

/**
 * The save message of the form. Saved is "on this computer" until the cloud's sending says more: waiting, sent (the only
 * state that says "sent", and the only cloud-done icon), or not sent yet. `cloud` null: the project's mode is not known.
 */
export function saveView(state: SaveState, retrying: boolean, cloud: boolean | null, sync: RecordSync | null): SaveView {
  if (state === "saving") return { key: "entry.save.saving", icon: "saving", color: "default" };
  if (state === "error") return { key: retrying ? "entry.save.retrying" : "entry.save.error", icon: "error", color: "error" };
  if (state !== "saved") return { key: state === "unsaved" ? "entry.save.unsaved" : "entry.save.idle", icon: "edit", color: "default" };
  if (cloud && sync === "sent") return { key: "entry.save.sent", icon: "sent", color: "success" };
  if (cloud && sync === "failed") return { key: "entry.save.notSent", icon: "notSent", color: "warning" };
  if (cloud && sync !== null) return { key: "entry.save.waiting", icon: "waiting", color: "default" };
  return { key: "entry.save.saved", icon: "saved", color: "success" };
}

/** Whether the form stops asking about the record: it has an answer that will not change by itself */
export const syncSettled = (sync: RecordSync | null): boolean => sync === "sent" || sync === "failed";

/**
 * In the form: whether the project is a cloud one (null until known), and, once a save is done in one, where the record
 * of `key` is, asked every RECORD_SYNC_POLL_MILLIS until it is sent or failed. A new save, or another plot, asks anew.
 */
export function useRecordSync(key: string, saveState: SaveState): { cloud: boolean | null; sync: RecordSync | null } {
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [sync, setSync] = useState<RecordSync | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Not known (an older Collect Earth): the form says "on this computer", which is true either way
    cloudState(controller.signal).then((s) => setCloud(s.project.mode === "cloud"), () => { /* stays unknown */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setSync(null);
    if (!cloud || saveState !== "saved" || !key) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const ask = () => {
      recordSync(key, controller.signal).then((s) => {
        // An answer about the save before this one must not show
        if (controller.signal.aborted) return;
        setSync(s);
        if (!syncSettled(s)) timer = window.setTimeout(ask, RECORD_SYNC_POLL_MILLIS);
      }, () => { if (!controller.signal.aborted) timer = window.setTimeout(ask, RECORD_SYNC_POLL_MILLIS); });
    };
    ask();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [cloud, key, saveState]);
  return { cloud, sync };
}
