import type { IntroInfo } from "./intro";
import { apiGet, apiPost, apiPut } from "./apiClient";
import type { CloudState, RecordSync } from "./cloud";
import type { CloudStatus } from "./project";

/** The calls of the Project and Help menus (ProjectsController, CloudController, FilesController, HelpController, AppInfoController). */

export const importProject = (path: string) => apiPost<{ restart: boolean }>("projects/import", { path });

/** A file dropped on the page: its bytes go to the server, which answers where it kept them */
export const uploadFile = (file: File) => apiPost<{ path: string }>("files/upload?name=" + encodeURIComponent(file.name), file);

/** `account`: the account signed in here to the invitation's server, which can join with no password (null when none) */
export interface CloudPreview { baseUrl: string; inviteToken: string; projectId: string; projectName: string; role: string; account?: string | null }

export const cloudPreview = (url: string) => apiPost<CloudPreview>("cloud/preview", { url });

/** `useAccount`: join with the preview's `account`, no username or password (cloud.signInAgain when its sign-in ended) */
export interface JoinRequest { baseUrl: string; inviteToken: string; projectId: string; username: string; password: string; register: boolean; code?: string; useAccount?: boolean }

export const cloudJoin = (request: JoinRequest) => apiPost<{ restart: boolean }>("cloud/join", request);

/** With `code` once the server asked for two-step sign-in's code (cloud.secondStepRequired). */
export const cloudLogin = (username: string, password: string, code?: string) => apiPost<{ operator: string }>("cloud/login", code ? { username, password, code } : { username, password });

/** The Log in button of the settings: the token of the server typed there, for its field; nothing is saved */
export const cloudToken = (url: string, username: string, password: string, code?: string) =>
  apiPost<{ token: string }>("cloud/token", code ? { url, username, password, code } : { url, username, password });

/** `server`, `serverName`, `onThisComputer` (it is one of this computer's projects already): absent from an older Collect Earth */
export interface CloudProject {
  projectId: string; projectName: string; role: string; active: boolean;
  server?: string | null; serverName?: string | null; onThisComputer?: boolean | null;
}

/** The cloud projects of the user signed in here; none when nobody is */
export const cloudProjects = (signal?: AbortSignal) => apiGet<{ projects: CloudProject[] }>("cloud/projects", signal).then((r) => r.projects);

/** Opens one of them, with the sign-in kept: Collect Earth restarts with it. The server says which one when several are signed in. */
export const openCloudProject = (projectId: string, server?: string | null) =>
  apiPost<{ restart: boolean }>("cloud/projects/open", server ? { projectId, server } : { projectId });

export const cloudStatus =(signal?: AbortSignal) => apiGet<CloudStatus>("cloud/status", signal);

export const cloudSyncNow = () => apiPost<void>("cloud/syncNow");

/** Where the open project keeps its data, its sending, and the accounts signed in (cloud.ts) */
export const cloudState = (signal?: AbortSignal) => apiGet<CloudState>("cloud/state", signal);

/** Forgets the account of this server; answers the state after it */
export const cloudSignOut = (server: string) => apiPost<CloudState>("cloud/signOut", { server });

/** Where the record of these keys (comma-separated, as the plot's id) is: on this computer only, waiting, sent, failed */
export const recordSync = (key: string, signal?: AbortSignal) =>
  apiGet<{ state: RecordSync }>("cloud/recordSync?key=" + encodeURIComponent(key), signal).then((r) => r.state);

/** The records of the project on this computer: in all, the person's (under a name typed here before the join, or their username), the others */
export interface LocalRecords { count: number; mine: number; others: number; names: string[] }
export const localRecords = (signal?: AbortSignal) => apiGet<LocalRecords>("cloud/localRecords", signal);

/** Starts sending them to the cloud project; answers the job's id */
/** Sends the person's records; with `all`, those under other names too (they then count as the person's) */
export const startSendToCloud = (all = false) => apiPost<{ id: string }>(all ? "jobs/sendToCloud?all=true" : "jobs/sendToCloud").then((r) => r.id);

export const setLanguage = (language: string) => apiPut<void>("app/language", { language });

export const helpText = (name: "disclaimer" | "log", signal?: AbortSignal) => apiGet<{ path: string; text: string }>("help/text?name=" + name, signal);

export const setErrorsShown = (shown: boolean) => apiPut<void>("help/errorsShown", { shown });

/** What the introduction has shown since (never shown twice), and the switch of its tips; answers it as it is now */
export const saveIntro = (change: { seen?: string[]; tips?: boolean }) => apiPut<IntroInfo>("app/intro", change);
